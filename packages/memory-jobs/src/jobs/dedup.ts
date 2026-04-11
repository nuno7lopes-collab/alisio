import type { CancellationToken } from "../cancellation.js";
import {
  chooseEntityMergeWinner,
  chooseProjectionWinner,
  deleteProjection,
  findPotentialEntityDuplicates,
  findPotentialProjectionDuplicates,
  listEntitiesAfter,
  listProjectionsAfter,
  mergeEntities,
  type CanonicalEntitySnapshot,
  type CanonicalProjectionSnapshot,
} from "../canonical.js";
import type { SqliteMemoryJobStore } from "../store.js";
import type { DedupCursor, MemorySleepJobResult } from "../types.js";

const ENTITY_BATCH_LIMIT = 8;
const PROJECTION_BATCH_LIMIT = 12;
const CHECKPOINT_EVENT_THRESHOLD = 6;
const CHECKPOINT_SIZE_THRESHOLD_BYTES = 4_096;

function createInitialCursor(): DedupCursor {
  return {
    phase: "entities",
    checkpoint: {
      pendingEventCount: 0,
      pendingPayloadBytes: 0,
    },
  };
}

function shouldCheckpoint(cursor: DedupCursor): boolean {
  return (
    cursor.checkpoint.pendingEventCount >= CHECKPOINT_EVENT_THRESHOLD ||
    cursor.checkpoint.pendingPayloadBytes >= CHECKPOINT_SIZE_THRESHOLD_BYTES
  );
}

function notePayload(cursor: DedupCursor, payloadBytes: number, mutated: boolean): void {
  cursor.checkpoint.pendingPayloadBytes += payloadBytes;
  if (mutated) {
    cursor.checkpoint.pendingEventCount += 1;
  }
}

function resetCheckpoint(cursor: DedupCursor): void {
  cursor.checkpoint.pendingEventCount = 0;
  cursor.checkpoint.pendingPayloadBytes = 0;
}

function mergeCounts(target: Record<string, number>, next: Record<string, number>): void {
  for (const [key, value] of Object.entries(next)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function appendMergeProposal(params: {
  store: SqliteMemoryJobStore;
  jobId: string;
  profileId: string;
  entity: CanonicalEntitySnapshot;
  duplicate: CanonicalEntitySnapshot;
  similarity: number;
  reason: string;
}): boolean {
  return params.store.appendAuditEvent({
    jobId: params.jobId,
    profileId: params.profileId,
    kind: "dedup",
    eventType: "MERGE_PROPOSED",
    entityId: params.entity.entityId,
    targetEntityId: params.duplicate.entityId,
    dedupeKey: [
      "entity-proposal",
      params.entity.entityId,
      params.duplicate.entityId,
      params.reason,
    ].join(":"),
    payload: {
      entityTitle: params.entity.title,
      duplicateTitle: params.duplicate.title,
      similarity: params.similarity,
      reason: params.reason,
    },
  });
}

function appendProjectionProposal(params: {
  store: SqliteMemoryJobStore;
  jobId: string;
  profileId: string;
  projection: CanonicalProjectionSnapshot;
  duplicate: CanonicalProjectionSnapshot;
  similarity: number;
  reason: string;
}): boolean {
  return params.store.appendAuditEvent({
    jobId: params.jobId,
    profileId: params.profileId,
    kind: "dedup",
    eventType: "PROJECTION_MERGE_PROPOSED",
    entityId: params.projection.projectionId,
    targetEntityId: params.duplicate.projectionId,
    dedupeKey: [
      "projection-proposal",
      params.projection.projectionId,
      params.duplicate.projectionId,
      params.reason,
    ].join(":"),
    payload: {
      projectionPath: params.projection.relativePath,
      duplicatePath: params.duplicate.relativePath,
      similarity: params.similarity,
      reason: params.reason,
    },
  });
}

export function buildDedupJobId(workspaceScope: string): string {
  return `dedup:${workspaceScope}`;
}

export function runDedupSlice(params: {
  store: SqliteMemoryJobStore;
  profileId: string;
  workspaceScope: string;
  sliceDeadlineMs: number;
  token: CancellationToken;
  autoMergeConfirmed: boolean;
  shouldPreempt?: () => boolean;
}): MemorySleepJobResult<DedupCursor> {
  const jobId = buildDedupJobId(params.workspaceScope);
  const { cursor } = params.store.readJobRecord({
    jobId,
    profileId: params.profileId,
    kind: "dedup",
    initialCursor: createInitialCursor(),
  });
  params.store.saveJobRecord({
    jobId,
    profileId: params.profileId,
    kind: "dedup",
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
        kind: "dedup",
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
        kind: "dedup",
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
    if (cursor.phase === "entities") {
      const batch = listEntitiesAfter({
        db: params.store.db,
        profileId: params.profileId,
        workspaceScope: params.workspaceScope,
        afterEntityId: cursor.lastEntityId,
        limit: ENTITY_BATCH_LIMIT,
        kinds: ["claim", "procedure"],
      });
      if (batch.length === 0) {
        cursor.phase = "projections";
        cursor.lastEntityId = undefined;
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "dedup",
          status: "running",
          cursor,
        });
        continue;
      }

      for (const entity of batch) {
        if (params.shouldPreempt?.()) {
          return preempt();
        }
        params.token.throwIfCancelled();
        const duplicates = findPotentialEntityDuplicates({
          db: params.store.db,
          entity,
        });
        cursor.lastEntityId = entity.entityId;

        params.store.transaction(() => {
          for (const duplicate of duplicates) {
            if (!params.autoMergeConfirmed) {
              const inserted = appendMergeProposal({
                store: params.store,
                jobId,
                profileId: params.profileId,
                entity,
                duplicate: duplicate.candidate,
                similarity: duplicate.similarity,
                reason: duplicate.reason,
              });
              if (inserted) {
                params.store.incrementTelemetry(
                  params.profileId,
                  "sleep_work_done_counts.merge_proposal",
                );
                mergeCounts(workDoneCounts, {
                  "sleep_work_done_counts.merge_proposal": 1,
                });
              }
              notePayload(cursor, JSON.stringify(duplicate).length, false);
              continue;
            }

            const plan = chooseEntityMergeWinner({
              db: params.store.db,
              left: entity,
              right: duplicate.candidate,
            });
            const mergeResult = mergeEntities({
              db: params.store.db,
              winner: plan.winner,
              loser: plan.loser,
              nowMs: Date.now(),
            });
            params.store.appendAuditEvent({
              jobId,
              profileId: params.profileId,
              kind: "dedup",
              eventType: "ENTITY_MERGED",
              entityId: plan.winner.entityId,
              targetEntityId: plan.loser.entityId,
              payload: {
                winnerTitle: plan.winner.title,
                loserTitle: plan.loser.title,
                similarity: duplicate.similarity,
                reason: duplicate.reason,
              },
            });
            params.store.appendAuditEvent({
              jobId,
              profileId: params.profileId,
              kind: "dedup",
              eventType: "ENTITY_DELETED",
              entityId: plan.loser.entityId,
              targetEntityId: plan.winner.entityId,
              payload: {
                deletedEntityId: plan.loser.entityId,
                mergedInto: plan.winner.entityId,
              },
            });
            for (const projectionId of mergeResult.deletedProjectionIds) {
              params.store.appendAuditEvent({
                jobId,
                profileId: params.profileId,
                kind: "dedup",
                eventType: "PROJECTION_DELETED",
                entityId: projectionId,
                targetEntityId: plan.winner.entityId,
                payload: {
                  deletedProjectionId: projectionId,
                  mergedInto: plan.winner.entityId,
                },
              });
            }
            for (const relationId of mergeResult.deletedRelationIds) {
              params.store.appendAuditEvent({
                jobId,
                profileId: params.profileId,
                kind: "dedup",
                eventType: "RELATION_DELETED",
                entityId: relationId,
                targetEntityId: plan.winner.entityId,
                payload: {
                  deletedRelationId: relationId,
                  mergedInto: plan.winner.entityId,
                },
              });
            }
            params.store.incrementTelemetry(
              params.profileId,
              "sleep_work_done_counts.entity_merge",
            );
            mergeCounts(workDoneCounts, {
              "sleep_work_done_counts.entity_merge": 1,
            });
            notePayload(cursor, JSON.stringify(duplicate).length, true);
          }

          if (shouldCheckpoint(cursor)) {
            params.store.appendAuditEvent({
              jobId,
              profileId: params.profileId,
              kind: "dedup",
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
            kind: "dedup",
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
      continue;
    }

    const batch = listProjectionsAfter({
      db: params.store.db,
      profileId: params.profileId,
      workspaceScope: params.workspaceScope,
      afterProjectionId: cursor.lastProjectionId,
      limit: PROJECTION_BATCH_LIMIT,
    });
    if (batch.length === 0) {
      if (cursor.checkpoint.pendingEventCount > 0 || cursor.checkpoint.pendingPayloadBytes > 0) {
        params.store.transaction(() => {
          params.store.appendAuditEvent({
            jobId,
            profileId: params.profileId,
            kind: "dedup",
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
            kind: "dedup",
            status: "idle",
            cursor: createInitialCursor(),
          });
        });
      } else {
        params.store.saveJobRecord({
          jobId,
          profileId: params.profileId,
          kind: "dedup",
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

    for (const projection of batch) {
      if (params.shouldPreempt?.()) {
        return preempt();
      }
      params.token.throwIfCancelled();
      const duplicates = findPotentialProjectionDuplicates({
        db: params.store.db,
        projection,
      });
      cursor.lastProjectionId = projection.projectionId;

      params.store.transaction(() => {
        for (const duplicate of duplicates) {
          if (!params.autoMergeConfirmed) {
            const inserted = appendProjectionProposal({
              store: params.store,
              jobId,
              profileId: params.profileId,
              projection,
              duplicate: duplicate.candidate,
              similarity: duplicate.similarity,
              reason: duplicate.reason,
            });
            if (inserted) {
              params.store.incrementTelemetry(
                params.profileId,
                "sleep_work_done_counts.projection_merge_proposal",
              );
              mergeCounts(workDoneCounts, {
                "sleep_work_done_counts.projection_merge_proposal": 1,
              });
            }
            notePayload(cursor, JSON.stringify(duplicate).length, false);
            continue;
          }

          const plan = chooseProjectionWinner(projection, duplicate.candidate);
          deleteProjection(params.store.db, plan.loser.projectionId);
          params.store.appendAuditEvent({
            jobId,
            profileId: params.profileId,
            kind: "dedup",
            eventType: "PROJECTION_DELETED",
            entityId: plan.loser.projectionId,
            targetEntityId: plan.winner.projectionId,
            payload: {
              deletedProjectionId: plan.loser.projectionId,
              keptProjectionId: plan.winner.projectionId,
              reason: duplicate.reason,
              similarity: duplicate.similarity,
            },
          });
          params.store.incrementTelemetry(
            params.profileId,
            "sleep_work_done_counts.projection_merge",
          );
          mergeCounts(workDoneCounts, {
            "sleep_work_done_counts.projection_merge": 1,
          });
          notePayload(cursor, JSON.stringify(duplicate).length, true);
        }

        if (shouldCheckpoint(cursor)) {
          params.store.appendAuditEvent({
            jobId,
            profileId: params.profileId,
            kind: "dedup",
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
          kind: "dedup",
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
