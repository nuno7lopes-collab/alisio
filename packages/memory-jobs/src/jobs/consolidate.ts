import type { MemoryStateEventDraft } from "alisio/plugin-sdk/memory-core-state";
import type { CancellationToken } from "../cancellation.js";
import {
  isLikelyCandidate,
  listPagesAfter,
  readPrimaryProjection,
  type SleepPageSnapshot,
} from "../canonical.js";
import type { GaiaSleepWriteFacade } from "../gaia.js";
import type { SqliteMemoryJobStore } from "../store.js";
import { countInstructionalSteps } from "../text.js";
import type {
  ConsolidateCursor,
  MemorySleepJobResult,
  MemoryJobCheckpointReason,
  SleepClock,
} from "../types.js";
import { createEventId, normalizeNumber, uniqueStrings } from "../utils.js";

const BATCH_LIMIT = 16;
const CHECKPOINT_EVENT_THRESHOLD = 8;
const CHECKPOINT_SIZE_THRESHOLD_BYTES = 4_096;

function createInitialCursor(): ConsolidateCursor {
  return {
    checkpoint: {
      pendingEventCount: 0,
      pendingPayloadBytes: 0,
    },
  };
}

function mergeCounts(target: Record<string, number>, next: Record<string, number>): void {
  for (const [key, value] of Object.entries(next)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function computePromotion(page: SleepPageSnapshot, body: string) {
  const confidence =
    page.claim?.confidence ?? normalizeNumber(body.match(/confidence:\s*([0-9.]+)/i)?.[1]) ?? 0.2;
  const evidenceCount =
    normalizeNumber(body.match(/evidence:\s*(\d+)/i)?.[1]) ??
    Math.max(0, Math.floor((body.match(/\[[^\]]+]/g)?.length ?? 0) / 2));
  const recurrenceCount = normalizeNumber(body.match(/recurrence:\s*(\d+)/i)?.[1]) ?? 0;
  const steps = countInstructionalSteps(body);
  const quality = Math.min(1, page.title.length / 80 + body.length / 800);
  const score = Math.min(
    1,
    confidence * 0.55 +
      Math.min(1, evidenceCount / 4) * 0.2 +
      Math.min(1, recurrenceCount / 3) * 0.15 +
      quality * 0.1 +
      (steps >= 2 ? 0.1 : 0),
  );

  if (steps >= 2 && score >= 0.74) {
    return {
      nextKind: "procedure" as const,
      score,
      reason: `score=${score.toFixed(2)} steps=${steps}`,
    };
  }
  if (score >= 0.62) {
    return {
      nextKind: "claim" as const,
      score,
      reason: `score=${score.toFixed(2)} evidence=${evidenceCount}`,
    };
  }
  return undefined;
}

function shouldCheckpoint(cursor: ConsolidateCursor): boolean {
  return (
    cursor.checkpoint.pendingEventCount >= CHECKPOINT_EVENT_THRESHOLD ||
    cursor.checkpoint.pendingPayloadBytes >= CHECKPOINT_SIZE_THRESHOLD_BYTES
  );
}

function notePayload(cursor: ConsolidateCursor, payloadBytes: number, mutated: boolean): void {
  cursor.checkpoint.pendingPayloadBytes += payloadBytes;
  if (mutated) {
    cursor.checkpoint.pendingEventCount += 1;
  }
}

function resetCheckpoint(cursor: ConsolidateCursor): void {
  cursor.checkpoint.pendingEventCount = 0;
  cursor.checkpoint.pendingPayloadBytes = 0;
}

function buildPromotionDrafts(params: {
  page: SleepPageSnapshot;
  nextKind: "claim" | "procedure";
  score: number;
  reason: string;
  nowMs: number;
}): MemoryStateEventDraft[] {
  const tags = uniqueStrings([
    ...params.page.tags.filter((tag) => tag !== "candidate"),
    params.nextKind,
  ]);
  const drafts: MemoryStateEventDraft[] = [
    {
      actorId: "gaia-sleep",
      eventId: createEventId(
        "sleep-promote-page",
        `${params.page.pageId}:${params.nextKind}:${params.reason}`,
      ),
      pageId: params.page.pageId,
      source: "sleep/consolidate",
      batchId: `consolidate:${params.page.pageId}`,
      type: "PAGE_METADATA_UPDATED",
      payload: {
        pageId: params.page.pageId,
        title: params.page.title,
        slug: params.page.slug,
        aliases: params.page.aliases,
        tags,
        updatedAtMs: params.nowMs,
      },
    },
  ];
  if (params.nextKind === "claim") {
    drafts.push({
      actorId: "gaia-sleep",
      eventId: createEventId("sleep-promote-claim", params.page.pageId),
      pageId: params.page.pageId,
      source: "sleep/consolidate",
      batchId: `consolidate:${params.page.pageId}`,
      type: "CLAIM_UPSERTED",
      payload: {
        claimId: params.page.pageId,
        subject: params.page.pageId,
        predicate: "states",
        object: params.page.title,
        confidence: params.score,
        status: "active",
        updatedAtMs: params.nowMs,
      },
    });
  }
  return drafts;
}

async function persistCheckpoint(params: {
  gaia: GaiaSleepWriteFacade;
  cursor: ConsolidateCursor;
  checkpointCursor?: ConsolidateCursor;
  jobId: string;
  profileId: string;
  reason: MemoryJobCheckpointReason;
  requestCheckpoint?: boolean;
}): Promise<void> {
  await params.gaia.recordJobCheckpoint({
    jobId: params.jobId,
    profileId: params.profileId,
    kind: "consolidate",
    reason: params.reason,
    cursor: params.checkpointCursor ?? params.cursor,
    pendingEventCount: params.cursor.checkpoint.pendingEventCount,
    pendingPayloadBytes: params.cursor.checkpoint.pendingPayloadBytes,
    requestCheckpoint: params.requestCheckpoint,
  });
  resetCheckpoint(params.cursor);
}

export function buildConsolidateJobId(workspaceScope: string): string {
  return `consolidate:${workspaceScope}`;
}

export async function runConsolidateSlice(params: {
  store: SqliteMemoryJobStore;
  gaia: GaiaSleepWriteFacade;
  profileId: string;
  workspaceScope: string;
  workspaceDir: string;
  sliceDeadlineMs: number;
  token: CancellationToken;
  clock: SleepClock;
  shouldPreempt?: () => boolean;
}): Promise<MemorySleepJobResult<ConsolidateCursor>> {
  const jobId = buildConsolidateJobId(params.workspaceScope);
  const { cursor } = params.store.readJobRecord({
    jobId,
    profileId: params.profileId,
    kind: "consolidate",
    initialCursor: createInitialCursor(),
  });
  params.store.saveJobRecord({
    jobId,
    profileId: params.profileId,
    kind: "consolidate",
    status: "running",
    cursor,
  });

  const workDoneCounts: Record<string, number> = {};
  const shouldRequestCheckpoint = () =>
    cursor.checkpoint.pendingEventCount > 0 || cursor.checkpoint.pendingPayloadBytes > 0;

  const preempt = async () => {
    params.token.cancel("active-session");
    await persistCheckpoint({
      gaia: params.gaia,
      cursor,
      jobId,
      profileId: params.profileId,
      reason: "preempted",
      requestCheckpoint: shouldRequestCheckpoint(),
    });
    params.store.transaction(() => {
      params.store.appendAuditEvent({
        jobId,
        profileId: params.profileId,
        kind: "consolidate",
        eventType: "CHECKPOINT_CREATED",
        payload: {
          reason: "preempted",
          cursor,
        },
      });
      params.store.saveJobRecord({
        jobId,
        profileId: params.profileId,
        kind: "consolidate",
        status: "paused",
        cursor,
      });
    });
    return {
      status: "preempted" as const,
      cursor,
      workDoneCounts,
    };
  };

  const budgetExhausted = async () => {
    await persistCheckpoint({
      gaia: params.gaia,
      cursor,
      jobId,
      profileId: params.profileId,
      reason: "budget-exhausted",
      requestCheckpoint: shouldRequestCheckpoint(),
    });
    params.store.transaction(() => {
      params.store.appendAuditEvent({
        jobId,
        profileId: params.profileId,
        kind: "consolidate",
        eventType: "CHECKPOINT_CREATED",
        payload: {
          reason: "budget-exhausted",
          cursor,
        },
      });
      params.store.saveJobRecord({
        jobId,
        profileId: params.profileId,
        kind: "consolidate",
        status: "paused",
        cursor,
      });
    });
    return {
      status: "budget-exhausted" as const,
      cursor,
      workDoneCounts,
    };
  };

  while (params.clock.now() < params.sliceDeadlineMs) {
    if (params.shouldPreempt?.()) {
      return await preempt();
    }
    params.token.throwIfCancelled();
    const batch = listPagesAfter({
      db: params.store.db,
      afterPageId: cursor.lastPageId,
      limit: BATCH_LIMIT,
      includeTombstoned: false,
    });
    if (batch.length === 0) {
      const completedCursor = createInitialCursor();
      await persistCheckpoint({
        gaia: params.gaia,
        cursor,
        checkpointCursor: completedCursor,
        jobId,
        profileId: params.profileId,
        reason: "cycle-complete",
        requestCheckpoint: shouldRequestCheckpoint(),
      });
      params.store.saveJobRecord({
        jobId,
        profileId: params.profileId,
        kind: "consolidate",
        status: "idle",
        cursor: completedCursor,
      });
      return {
        status: "completed",
        cursor: completedCursor,
        workDoneCounts,
      };
    }

    for (const page of batch) {
      if (params.shouldPreempt?.()) {
        return await preempt();
      }
      params.token.throwIfCancelled();
      const projection = readPrimaryProjection(params.store.db, page.pageId, params.workspaceDir);
      const body = projection?.markdownBody ?? "";
      const promotion = isLikelyCandidate(page) ? computePromotion(page, body) : undefined;
      cursor.lastPageId = page.pageId;

      if (promotion && !page.tags.includes(promotion.nextKind)) {
        const drafts = buildPromotionDrafts({
          page,
          nextKind: promotion.nextKind,
          score: promotion.score,
          reason: promotion.reason,
          nowMs: params.clock.now(),
        });
        const writeResult = await params.gaia.writeEvents(drafts);
        if (writeResult.events.length > 0) {
          params.store.transaction(() => {
            const eventType =
              promotion.nextKind === "procedure" ? "PROMOTED_TO_PROCEDURE" : "PROMOTED_TO_CLAIM";
            const inserted = params.store.appendAuditEvent({
              jobId,
              profileId: params.profileId,
              kind: "consolidate",
              eventType,
              entityId: page.pageId,
              payload: {
                title: page.title,
                nextKind: promotion.nextKind,
                score: promotion.score,
                reason: promotion.reason,
                ledgerEventIds: writeResult.events.map((event) => event.eventId),
              },
            });
            if (inserted) {
              const metricKey =
                promotion.nextKind === "procedure"
                  ? "sleep_work_done_counts.promoted_procedure"
                  : "sleep_work_done_counts.promoted_claim";
              params.store.incrementTelemetry(params.profileId, metricKey);
              mergeCounts(workDoneCounts, {
                [metricKey]: 1,
              });
            }
            params.store.saveJobRecord({
              jobId,
              profileId: params.profileId,
              kind: "consolidate",
              status: "running",
              cursor,
            });
          });
          notePayload(
            cursor,
            JSON.stringify({
              pageId: page.pageId,
              nextKind: promotion.nextKind,
              reason: promotion.reason,
            }).length,
            true,
          );
        } else {
          notePayload(cursor, page.pageId.length, false);
        }
      } else {
        notePayload(cursor, page.pageId.length, false);
      }

      if (shouldCheckpoint(cursor)) {
        await persistCheckpoint({
          gaia: params.gaia,
          cursor,
          jobId,
          profileId: params.profileId,
          reason: "threshold",
          requestCheckpoint: true,
        });
      }

      params.store.saveJobRecord({
        jobId,
        profileId: params.profileId,
        kind: "consolidate",
        status: "running",
        cursor,
      });

      if (params.clock.now() >= params.sliceDeadlineMs) {
        return await budgetExhausted();
      }
    }
  }

  return await budgetExhausted();
}
