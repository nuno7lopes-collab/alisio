import type { CancellationToken } from "../cancellation.js";
import {
  isLikelyCandidate,
  listEntitiesAfter,
  readPrimaryProjection,
  updateEntityKind,
  type CanonicalEntitySnapshot,
} from "../canonical.js";
import type { SqliteMemoryJobStore } from "../store.js";
import { countInstructionalSteps } from "../text.js";
import type { ConsolidateCursor, MemorySleepJobResult } from "../types.js";
import { normalizeNumber } from "../utils.js";

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

function computePromotion(entity: CanonicalEntitySnapshot, body: string) {
  const confidence =
    normalizeNumber(entity.metadata.confidence) ??
    normalizeNumber(entity.metadata.score) ??
    normalizeNumber(entity.metadata.claimConfidence) ??
    0.2;
  const evidenceCount =
    normalizeNumber(entity.metadata.evidenceCount) ??
    normalizeNumber(entity.metadata.seenCount) ??
    (Array.isArray(entity.metadata.evidence) ? entity.metadata.evidence.length : 0) ??
    0;
  const recurrenceCount =
    normalizeNumber(entity.metadata.recurrenceCount) ??
    normalizeNumber(entity.metadata.occurrenceCount) ??
    0;
  const steps = countInstructionalSteps(body);
  const quality = Math.min(1, entity.title.length / 80 + body.length / 800);
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
      nextKind: "procedure",
      score,
      reason: `score=${score.toFixed(2)} steps=${steps}`,
    };
  }
  if (score >= 0.62) {
    return {
      nextKind: "claim",
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

export function buildConsolidateJobId(workspaceScope: string): string {
  return `consolidate:${workspaceScope}`;
}

export function runConsolidateSlice(params: {
  store: SqliteMemoryJobStore;
  profileId: string;
  workspaceScope: string;
  sliceDeadlineMs: number;
  token: CancellationToken;
  shouldPreempt?: () => boolean;
}): MemorySleepJobResult<ConsolidateCursor> {
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

  const preempt = () => {
    params.token.cancel("active-session");
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
      resetCheckpoint(cursor);
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

  while (Date.now() < params.sliceDeadlineMs) {
    if (params.shouldPreempt?.()) {
      return preempt();
    }
    params.token.throwIfCancelled();
    const batch = listEntitiesAfter({
      db: params.store.db,
      profileId: params.profileId,
      workspaceScope: params.workspaceScope,
      afterEntityId: cursor.lastEntityId,
      limit: BATCH_LIMIT,
    });
    if (batch.length === 0) {
      if (cursor.checkpoint.pendingEventCount > 0 || cursor.checkpoint.pendingPayloadBytes > 0) {
        params.store.transaction(() => {
          params.store.appendAuditEvent({
            jobId,
            profileId: params.profileId,
            kind: "consolidate",
            eventType: "CHECKPOINT_CREATED",
            payload: {
              reason: "cycle-complete",
              cursor,
            },
          });
          resetCheckpoint(cursor);
          params.store.saveJobRecord({
            jobId,
            profileId: params.profileId,
            kind: "consolidate",
            status: "idle",
            cursor: createInitialCursor(),
          });
        });
      } else {
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "consolidate",
          status: "idle",
          cursor: createInitialCursor(),
        });
      }
      return {
        status: "completed",
        cursor: createInitialCursor(),
        workDoneCounts,
      };
    }

    for (const entity of batch) {
      if (params.shouldPreempt?.()) {
        return preempt();
      }
      params.token.throwIfCancelled();
      const projection = readPrimaryProjection(
        params.store.db,
        params.profileId,
        params.workspaceScope,
        entity.entityId,
      );
      const body = projection?.markdownBody ?? "";
      const promotion = isLikelyCandidate(entity) ? computePromotion(entity, body) : undefined;
      cursor.lastEntityId = entity.entityId;

      params.store.transaction(() => {
        if (promotion && entity.kind !== promotion.nextKind) {
          updateEntityKind({
            db: params.store.db,
            entity,
            nextKind: promotion.nextKind,
            score: promotion.score,
            reason: promotion.reason,
            nowMs: Date.now(),
          });
          const eventType =
            promotion.nextKind === "procedure" ? "PROMOTED_TO_PROCEDURE" : "PROMOTED_TO_CLAIM";
          const inserted = params.store.appendAuditEvent({
            jobId,
            profileId: params.profileId,
            kind: "consolidate",
            eventType,
            entityId: entity.entityId,
            payload: {
              title: entity.title,
              nextKind: promotion.nextKind,
              score: promotion.score,
              reason: promotion.reason,
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
          notePayload(
            cursor,
            JSON.stringify({
              entityId: entity.entityId,
              nextKind: promotion.nextKind,
              reason: promotion.reason,
            }).length,
            true,
          );
        } else {
          notePayload(cursor, entity.entityId.length, false);
        }

        if (shouldCheckpoint(cursor)) {
          params.store.appendAuditEvent({
            jobId,
            profileId: params.profileId,
            kind: "consolidate",
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
          kind: "consolidate",
          status: "running",
          cursor,
        });
      });

      if (Date.now() >= params.sliceDeadlineMs) {
        return {
          status: "budget-exhausted",
          cursor,
          workDoneCounts,
        };
      }
    }
  }

  return {
    status: "budget-exhausted",
    cursor,
    workDoneCounts,
  };
}
