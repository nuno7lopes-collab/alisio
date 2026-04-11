import type { CancellationToken } from "../cancellation.js";
import {
  attachmentExists,
  extractAttachmentPaths,
  isLowConfidence,
  listEntitiesAfter,
  listProjectionsAfter,
  readContradictingClaims,
  readPrimaryProjection,
  resolveClaimPolarity,
} from "../canonical.js";
import type { SqliteMemoryJobStore } from "../store.js";
import type { HealthCursor, MemorySleepJobResult } from "../types.js";
import { createEventId } from "../utils.js";

const ENTITY_BATCH_LIMIT = 16;
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

export function buildHealthJobId(workspaceScope: string): string {
  return `health:${workspaceScope}`;
}

export function runHealthSlice(params: {
  store: SqliteMemoryJobStore;
  profileId: string;
  workspaceScope: string;
  workspaceDir: string;
  sliceDeadlineMs: number;
  token: CancellationToken;
  shouldPreempt?: () => boolean;
}): MemorySleepJobResult<HealthCursor> {
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

  const preempt = () => {
    params.token.cancel("active-session");
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
      resetCheckpoint(cursor);
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
      return preempt();
    }
    params.token.throwIfCancelled();
    if (cursor.phase === "staleClaims") {
      const entities = listEntitiesAfter({
        db: params.store.db,
        profileId: params.profileId,
        workspaceScope: params.workspaceScope,
        afterEntityId: cursor.lastItemId,
        limit: ENTITY_BATCH_LIMIT,
        kinds: ["claim"],
      });
      if (entities.length === 0) {
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
      for (const entity of entities) {
        if (params.shouldPreempt?.()) {
          return preempt();
        }
        params.token.throwIfCancelled();
        cursor.lastItemId = entity.entityId;
        if (Date.now() - entity.updatedAtMs >= STALE_CLAIM_MS) {
          appendFinding(cursor, "staleClaims", {
            id: createEventId("health-stale", entity.entityId),
            severity: "warn",
            itemType: "entity",
            itemId: entity.entityId,
            title: entity.title,
            detail: "claim has not been refreshed recently",
          });
          params.store.incrementTelemetry(params.profileId, "health_findings_counts.staleClaims");
          mergeCounts(workDoneCounts, {
            "health_findings_counts.staleClaims": 1,
          });
        } else {
          notePayload(cursor, entity.entityId.length, false);
        }
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
      const entities = listEntitiesAfter({
        db: params.store.db,
        profileId: params.profileId,
        workspaceScope: params.workspaceScope,
        afterEntityId: cursor.lastItemId,
        limit: ENTITY_BATCH_LIMIT,
        kinds: ["claim"],
      });
      if (entities.length === 0) {
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
      for (const entity of entities) {
        if (params.shouldPreempt?.()) {
          return preempt();
        }
        params.token.throwIfCancelled();
        cursor.lastItemId = entity.entityId;
        const projection = readPrimaryProjection(
          params.store.db,
          params.profileId,
          params.workspaceScope,
          entity.entityId,
        );
        const polarity = resolveClaimPolarity(entity, projection);
        if (polarity) {
          const contradictions = readContradictingClaims({
            db: params.store.db,
            entity,
            polarity,
          });
          for (const contradiction of contradictions) {
            appendFinding(cursor, "contradictions", {
              id: createEventId(
                "health-contradiction",
                `${entity.entityId}:${contradiction.entityId}`,
              ),
              severity: "error",
              itemType: "entity",
              itemId: entity.entityId,
              title: entity.title,
              detail: `contradicting claim also exists (${contradiction.entityId})`,
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
          notePayload(cursor, entity.entityId.length, false);
        }
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
        profileId: params.profileId,
        workspaceScope: params.workspaceScope,
        afterProjectionId: cursor.lastItemId,
        limit: PROJECTION_BATCH_LIMIT,
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
          return preempt();
        }
        params.token.throwIfCancelled();
        cursor.lastItemId = projection.projectionId;
        const entity = params.store.db
          .prepare(
            `SELECT 1 AS ok
             FROM entities
             WHERE profile_id = ? AND workspace_scope = ? AND entity_id = ?
             LIMIT 1`,
          )
          .get(params.profileId, params.workspaceScope, projection.entityId) as
          | { ok: number }
          | undefined;
        if (!entity) {
          appendFinding(cursor, "orphanPages", {
            id: createEventId("health-orphan", projection.projectionId),
            severity: "error",
            itemType: "projection",
            itemId: projection.projectionId,
            title: projection.relativePath,
            detail: "projection points to a missing entity",
            path: projection.relativePath,
          });
          params.store.incrementTelemetry(params.profileId, "health_findings_counts.orphanPages");
          mergeCounts(workDoneCounts, {
            "health_findings_counts.orphanPages": 1,
          });
        } else {
          notePayload(cursor, projection.projectionId.length, false);
        }
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
        profileId: params.profileId,
        workspaceScope: params.workspaceScope,
        afterProjectionId: cursor.lastItemId,
        limit: PROJECTION_BATCH_LIMIT,
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
          return preempt();
        }
        params.token.throwIfCancelled();
        cursor.lastItemId = projection.projectionId;
        const paths = extractAttachmentPaths({
          projection,
          workspaceDir: params.workspaceDir,
        });
        for (const attachmentPath of paths) {
          if (!attachmentExists(attachmentPath)) {
            appendFinding(cursor, "brokenAttachments", {
              id: createEventId(
                "health-attachment",
                `${projection.projectionId}:${attachmentPath}`,
              ),
              severity: "warn",
              itemType: "attachment",
              itemId: projection.projectionId,
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
          notePayload(cursor, projection.projectionId.length, false);
        }
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

    const entities = listEntitiesAfter({
      db: params.store.db,
      profileId: params.profileId,
      workspaceScope: params.workspaceScope,
      afterEntityId: cursor.lastItemId,
      limit: ENTITY_BATCH_LIMIT,
    });
    if (entities.length === 0) {
      cursor.dashboard.generatedAtMs = Date.now();
      params.store.transaction(() => {
        params.store.writeReport({
          jobId,
          profileId: params.profileId,
          kind: "health",
          report: cursor.dashboard,
        });
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
          },
        });
        params.store.appendAuditEvent({
          jobId,
          profileId: params.profileId,
          kind: "health",
          eventType: "CHECKPOINT_CREATED",
          payload: {
            reason: "cycle-complete",
            cursor,
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

    for (const entity of entities) {
      if (params.shouldPreempt?.()) {
        return preempt();
      }
      params.token.throwIfCancelled();
      cursor.lastItemId = entity.entityId;
      const confidence = isLowConfidence(entity);
      if (confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD) {
        appendFinding(cursor, "lowConfidenceItems", {
          id: createEventId("health-confidence", entity.entityId),
          severity: "warn",
          itemType: "entity",
          itemId: entity.entityId,
          title: entity.title,
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
        notePayload(cursor, entity.entityId.length, false);
      }

      if (shouldCheckpoint(cursor)) {
        params.store.appendAuditEvent({
          jobId,
          profileId: params.profileId,
          kind: "health",
          eventType: "CHECKPOINT_CREATED",
          payload: {
            reason: "threshold",
            cursor,
          },
        });
        resetCheckpoint(cursor);
      }

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
