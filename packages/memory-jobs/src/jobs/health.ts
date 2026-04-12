import type { MemoryStateEventDraft } from "alisio/plugin-sdk/memory-core-state";
import type { CancellationToken } from "../cancellation.js";
import {
  attachmentExists,
  extractAttachmentPaths,
  isLowConfidence,
  listClaimsAfter,
  listPagesAfter,
  listProjectionsAfter,
  readContradictingClaims,
  readPage,
  readPrimaryProjection,
  resolveClaimPolarity,
} from "../canonical.js";
import type { GaiaSleepWriteFacade } from "../gaia.js";
import type { SqliteMemoryJobStore } from "../store.js";
import type { HealthCursor, MemorySleepJobResult } from "../types.js";
import { createEventId } from "../utils.js";

const CLAIM_BATCH_LIMIT = 16;
const PAGE_BATCH_LIMIT = 16;
const PROJECTION_BATCH_LIMIT = 16;
const STALE_CLAIM_MS = 30 * 24 * 60 * 60_000;
const LOW_CONFIDENCE_THRESHOLD = 0.55;
const CHECKPOINT_EVENT_THRESHOLD = 8;
const CHECKPOINT_SIZE_THRESHOLD_BYTES = 8_192;
type HealthDashboardCategory = Exclude<keyof HealthCursor["dashboard"], "generatedAtMs">;

function createInitialDashboard(nowMs: number) {
  return {
    generatedAtMs: nowMs,
    staleClaims: [],
    contradictions: [],
    orphanPages: [],
    brokenAttachments: [],
    lowConfidenceItems: [],
  };
}

function createInitialCursor(nowMs = Date.now()): HealthCursor {
  return {
    phase: "staleClaims",
    dashboard: createInitialDashboard(nowMs),
    checkpoint: {
      pendingEventCount: 0,
      pendingPayloadBytes: 0,
    },
  };
}

function shouldCheckpoint(cursor: HealthCursor): boolean {
  return (
    cursor.checkpoint.pendingEventCount >= CHECKPOINT_EVENT_THRESHOLD ||
    cursor.checkpoint.pendingPayloadBytes >= CHECKPOINT_SIZE_THRESHOLD_BYTES
  );
}

function notePayload(cursor: HealthCursor, payloadBytes: number, findingAdded: boolean): void {
  cursor.checkpoint.pendingPayloadBytes += payloadBytes;
  if (findingAdded) {
    cursor.checkpoint.pendingEventCount += 1;
  }
}

function resetCheckpoint(cursor: HealthCursor): void {
  cursor.checkpoint.pendingEventCount = 0;
  cursor.checkpoint.pendingPayloadBytes = 0;
}

function mergeCounts(target: Record<string, number>, next: Record<string, number>): void {
  for (const [key, value] of Object.entries(next)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function appendFinding<T extends HealthDashboardCategory>(
  cursor: HealthCursor,
  category: T,
  finding: HealthCursor["dashboard"][T][number],
): void {
  const existingIds = new Set(cursor.dashboard[category].map((entry) => entry.id));
  if (existingIds.has(finding.id)) {
    notePayload(cursor, JSON.stringify(finding).length, false);
    return;
  }
  cursor.dashboard[category].push(finding);
  notePayload(cursor, JSON.stringify(finding).length, true);
}

async function persistCheckpoint(params: {
  gaia: GaiaSleepWriteFacade;
  cursor: HealthCursor;
  jobId: string;
  profileId: string;
  reason: "threshold" | "preempted" | "cycle-complete";
  requestCheckpoint?: boolean;
}): Promise<void> {
  await params.gaia.recordJobCheckpoint({
    jobId: params.jobId,
    profileId: params.profileId,
    kind: "health",
    reason: params.reason,
    cursor: params.cursor,
    pendingEventCount: params.cursor.checkpoint.pendingEventCount,
    pendingPayloadBytes: params.cursor.checkpoint.pendingPayloadBytes,
    requestCheckpoint: params.requestCheckpoint,
  });
  resetCheckpoint(params.cursor);
}

async function maybeCheckpoint(params: {
  gaia: GaiaSleepWriteFacade;
  cursor: HealthCursor;
  jobId: string;
  profileId: string;
}): Promise<void> {
  if (!shouldCheckpoint(params.cursor)) {
    return;
  }
  await persistCheckpoint({
    gaia: params.gaia,
    cursor: params.cursor,
    jobId: params.jobId,
    profileId: params.profileId,
    reason: "threshold",
    requestCheckpoint: true,
  });
}

function buildDashboardDraft(
  jobId: string,
  dashboard: HealthCursor["dashboard"],
): MemoryStateEventDraft {
  return {
    actorId: "gaia-sleep",
    eventId: createEventId("sleep-health-dashboard", `${jobId}:${dashboard.generatedAtMs}`),
    source: "sleep/health",
    batchId: jobId,
    type: "DASHBOARD_SET",
    payload: {
      kind: jobId,
      json: dashboard as unknown as Record<string, unknown>,
      updatedAtMs: dashboard.generatedAtMs,
    },
  };
}

export function buildHealthJobId(workspaceScope: string): string {
  return `health:${workspaceScope}`;
}

export async function runHealthSlice(params: {
  store: SqliteMemoryJobStore;
  gaia: GaiaSleepWriteFacade;
  profileId: string;
  workspaceScope: string;
  workspaceDir: string;
  sliceDeadlineMs: number;
  token: CancellationToken;
  shouldPreempt?: () => boolean;
}): Promise<MemorySleepJobResult<HealthCursor>> {
  const jobId = buildHealthJobId(params.workspaceScope);
  const { cursor } = params.store.readJobRecord({
    jobId,
    profileId: params.profileId,
    kind: "health",
    initialCursor: createInitialCursor(),
  });
  params.store.saveJobRecord({
    jobId,
    profileId: params.profileId,
    kind: "health",
    status: "running",
    cursor,
  });

  const workDoneCounts: Record<string, number> = {};

  const preempt = async () => {
    params.token.cancel("active-session");
    await persistCheckpoint({
      gaia: params.gaia,
      cursor,
      jobId,
      profileId: params.profileId,
      reason: "preempted",
      requestCheckpoint:
        cursor.checkpoint.pendingEventCount > 0 || cursor.checkpoint.pendingPayloadBytes > 0,
    });
    params.store.transaction(() => {
      params.store.appendAuditEvent({
        jobId,
        profileId: params.profileId,
        kind: "health",
        eventType: "CHECKPOINT_CREATED",
        payload: {
          reason: "preempted",
          cursor,
        },
      });
      params.store.saveJobRecord({
        jobId,
        profileId: params.profileId,
        kind: "health",
        status: "paused",
        cursor,
      });
    });
    return {
      status: "preempted" as const,
      cursor,
      workDoneCounts,
      healthDashboard: cursor.dashboard,
    };
  };

  while (Date.now() < params.sliceDeadlineMs) {
    if (params.shouldPreempt?.()) {
      return await preempt();
    }
    params.token.throwIfCancelled();
    if (cursor.phase === "staleClaims") {
      const claims = listClaimsAfter({
        db: params.store.db,
        afterClaimId: cursor.lastItemId,
        limit: CLAIM_BATCH_LIMIT,
        statuses: ["active"],
      });
      if (claims.length === 0) {
        cursor.phase = "contradictions";
        cursor.lastItemId = undefined;
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "health",
          status: "running",
          cursor,
        });
        continue;
      }
      for (const claim of claims) {
        if (params.shouldPreempt?.()) {
          return await preempt();
        }
        params.token.throwIfCancelled();
        cursor.lastItemId = claim.claimId;
        const page = readPage(params.store.db, claim.claimId);
        if (Date.now() - claim.updatedAtMs >= STALE_CLAIM_MS) {
          appendFinding(cursor, "staleClaims", {
            id: createEventId("health-stale", claim.claimId),
            severity: "warn",
            itemType: "entity",
            itemId: claim.claimId,
            title: page?.title ?? claim.object,
            detail: "claim has not been refreshed recently",
          });
          params.store.incrementTelemetry(params.profileId, "health_findings_counts.staleClaims");
          mergeCounts(workDoneCounts, {
            "health_findings_counts.staleClaims": 1,
          });
        } else {
          notePayload(cursor, claim.claimId.length, false);
        }
        await maybeCheckpoint({
          gaia: params.gaia,
          cursor,
          jobId,
          profileId: params.profileId,
        });
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "health",
          status: "running",
          cursor,
        });
      }
      continue;
    }

    if (cursor.phase === "contradictions") {
      const claims = listClaimsAfter({
        db: params.store.db,
        afterClaimId: cursor.lastItemId,
        limit: CLAIM_BATCH_LIMIT,
        statuses: ["active"],
      });
      if (claims.length === 0) {
        cursor.phase = "orphanPages";
        cursor.lastItemId = undefined;
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "health",
          status: "running",
          cursor,
        });
        continue;
      }
      for (const claim of claims) {
        if (params.shouldPreempt?.()) {
          return await preempt();
        }
        params.token.throwIfCancelled();
        cursor.lastItemId = claim.claimId;
        const projection = readPrimaryProjection(
          params.store.db,
          claim.claimId,
          params.workspaceDir,
        );
        const polarity = resolveClaimPolarity(claim, projection);
        if (polarity != null) {
          const contradictions = readContradictingClaims({
            db: params.store.db,
            claim,
            polarity,
            workspaceDir: params.workspaceDir,
          });
          for (const contradiction of contradictions) {
            const page = readPage(params.store.db, claim.claimId);
            appendFinding(cursor, "contradictions", {
              id: createEventId(
                "health-contradiction",
                `${claim.claimId}:${contradiction.claimId}`,
              ),
              severity: "error",
              itemType: "entity",
              itemId: claim.claimId,
              title: page?.title ?? claim.object,
              detail: `contradicting claim also exists (${contradiction.claimId})`,
            });
            params.store.incrementTelemetry(
              params.profileId,
              "health_findings_counts.contradictions",
            );
            mergeCounts(workDoneCounts, {
              "health_findings_counts.contradictions": 1,
            });
          }
        } else {
          notePayload(cursor, claim.claimId.length, false);
        }
        await maybeCheckpoint({
          gaia: params.gaia,
          cursor,
          jobId,
          profileId: params.profileId,
        });
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "health",
          status: "running",
          cursor,
        });
      }
      continue;
    }

    if (cursor.phase === "orphanPages") {
      const projections = listProjectionsAfter({
        db: params.store.db,
        afterProjectionKey: cursor.lastItemId,
        limit: PROJECTION_BATCH_LIMIT,
        workspaceDir: params.workspaceDir,
      });
      if (projections.length === 0) {
        cursor.phase = "brokenAttachments";
        cursor.lastItemId = undefined;
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "health",
          status: "running",
          cursor,
        });
        continue;
      }
      for (const projection of projections) {
        if (params.shouldPreempt?.()) {
          return await preempt();
        }
        params.token.throwIfCancelled();
        cursor.lastItemId = `${projection.pageId}:${projection.kind}`;
        const page = readPage(params.store.db, projection.pageId);
        if (!page) {
          appendFinding(cursor, "orphanPages", {
            id: createEventId("health-orphan", `${projection.pageId}:${projection.kind}`),
            severity: "error",
            itemType: "projection",
            itemId: projection.pageId,
            title: projection.relativePath,
            detail: "projection points to a missing page",
            path: projection.relativePath,
          });
          params.store.incrementTelemetry(params.profileId, "health_findings_counts.orphanPages");
          mergeCounts(workDoneCounts, {
            "health_findings_counts.orphanPages": 1,
          });
        } else {
          notePayload(cursor, projection.pageId.length, false);
        }
        await maybeCheckpoint({
          gaia: params.gaia,
          cursor,
          jobId,
          profileId: params.profileId,
        });
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "health",
          status: "running",
          cursor,
        });
      }
      continue;
    }

    if (cursor.phase === "brokenAttachments") {
      const projections = listProjectionsAfter({
        db: params.store.db,
        afterProjectionKey: cursor.lastItemId,
        limit: PROJECTION_BATCH_LIMIT,
        workspaceDir: params.workspaceDir,
      });
      if (projections.length === 0) {
        cursor.phase = "lowConfidenceItems";
        cursor.lastItemId = undefined;
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "health",
          status: "running",
          cursor,
        });
        continue;
      }
      for (const projection of projections) {
        if (params.shouldPreempt?.()) {
          return await preempt();
        }
        params.token.throwIfCancelled();
        cursor.lastItemId = `${projection.pageId}:${projection.kind}`;
        const paths = extractAttachmentPaths({
          projection,
          workspaceDir: params.workspaceDir,
        });
        for (const attachmentPath of paths) {
          if (!attachmentExists(attachmentPath)) {
            appendFinding(cursor, "brokenAttachments", {
              id: createEventId(
                "health-attachment",
                `${projection.pageId}:${projection.kind}:${attachmentPath}`,
              ),
              severity: "warn",
              itemType: "attachment",
              itemId: projection.pageId,
              title: projection.relativePath,
              detail: "attachment path does not exist on disk",
              path: attachmentPath,
            });
            params.store.incrementTelemetry(
              params.profileId,
              "health_findings_counts.brokenAttachments",
            );
            mergeCounts(workDoneCounts, {
              "health_findings_counts.brokenAttachments": 1,
            });
          }
        }
        if (paths.length === 0) {
          notePayload(cursor, projection.pageId.length, false);
        }
        await maybeCheckpoint({
          gaia: params.gaia,
          cursor,
          jobId,
          profileId: params.profileId,
        });
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "health",
          status: "running",
          cursor,
        });
      }
      continue;
    }

    const pages = listPagesAfter({
      db: params.store.db,
      afterPageId: cursor.lastItemId,
      limit: PAGE_BATCH_LIMIT,
      includeTombstoned: false,
    });
    if (pages.length === 0) {
      cursor.dashboard.generatedAtMs = Date.now();
      const writeResult = await params.gaia.writeEvents([
        buildDashboardDraft(jobId, cursor.dashboard),
      ]);
      if (cursor.checkpoint.pendingEventCount > 0 || cursor.checkpoint.pendingPayloadBytes > 0) {
        await persistCheckpoint({
          gaia: params.gaia,
          cursor,
          jobId,
          profileId: params.profileId,
          reason: "cycle-complete",
          requestCheckpoint: true,
        });
      }
      params.store.transaction(() => {
        params.store.appendAuditEvent({
          jobId,
          profileId: params.profileId,
          kind: "health",
          eventType: "DASHBOARD_UPDATED",
          payload: {
            summary: {
              staleClaims: cursor.dashboard.staleClaims.length,
              contradictions: cursor.dashboard.contradictions.length,
              orphanPages: cursor.dashboard.orphanPages.length,
              brokenAttachments: cursor.dashboard.brokenAttachments.length,
              lowConfidenceItems: cursor.dashboard.lowConfidenceItems.length,
            },
            ledgerEventIds: writeResult.events.map((event) => event.eventId),
          },
        });
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "health",
          status: "idle",
          cursor: createInitialCursor(Date.now()),
        });
      });
      return {
        status: "completed",
        cursor: createInitialCursor(Date.now()),
        workDoneCounts,
        healthDashboard: cursor.dashboard,
      };
    }

    for (const page of pages) {
      if (params.shouldPreempt?.()) {
        return await preempt();
      }
      params.token.throwIfCancelled();
      cursor.lastItemId = page.pageId;
      const confidence = isLowConfidence(page);
      if (confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD) {
        appendFinding(cursor, "lowConfidenceItems", {
          id: createEventId("health-confidence", page.pageId),
          severity: "warn",
          itemType: "entity",
          itemId: page.pageId,
          title: page.title,
          detail: "item confidence is below the default threshold",
          score: confidence,
        });
        params.store.incrementTelemetry(
          params.profileId,
          "health_findings_counts.lowConfidenceItems",
        );
        mergeCounts(workDoneCounts, {
          "health_findings_counts.lowConfidenceItems": 1,
        });
      } else {
        notePayload(cursor, page.pageId.length, false);
      }
      await maybeCheckpoint({
        gaia: params.gaia,
        cursor,
        jobId,
        profileId: params.profileId,
      });
      params.store.saveJobRecord({
        jobId,
        profileId: params.profileId,
        kind: "health",
        status: "running",
        cursor,
      });
    }
  }

  return {
    status: "budget-exhausted",
    cursor,
    workDoneCounts,
    healthDashboard: cursor.dashboard,
  };
}
