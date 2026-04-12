import type { MemoryStateEventDraft } from "alisio/plugin-sdk/memory-core-state";
import type { CancellationToken } from "../cancellation.js";
import {
  choosePageMergeWinner,
  chooseProjectionWinner,
  findPotentialPageDuplicates,
  listPagesAfter,
  mergePageMetadata,
  readPrimaryProjection,
  type SleepPageSnapshot,
} from "../canonical.js";
import type { GaiaSleepWriteFacade } from "../gaia.js";
import type { SqliteMemoryJobStore } from "../store.js";
import type {
  DedupCursor,
  MemorySleepJobResult,
  MemoryJobCheckpointReason,
  SleepClock,
} from "../types.js";
import { createEventId } from "../utils.js";

const PAGE_BATCH_LIMIT = 8;
const CHECKPOINT_EVENT_THRESHOLD = 6;
const CHECKPOINT_SIZE_THRESHOLD_BYTES = 4_096;

function createInitialCursor(): DedupCursor {
  return {
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
  page: SleepPageSnapshot;
  duplicate: SleepPageSnapshot;
  similarity: number;
  reason: string;
}): boolean {
  return params.store.appendAuditEvent({
    jobId: params.jobId,
    profileId: params.profileId,
    kind: "dedup",
    eventType: "MERGE_PROPOSED",
    entityId: params.page.pageId,
    targetEntityId: params.duplicate.pageId,
    dedupeKey: ["page-proposal", params.page.pageId, params.duplicate.pageId, params.reason].join(
      ":",
    ),
    payload: {
      title: params.page.title,
      duplicateTitle: params.duplicate.title,
      similarity: params.similarity,
      reason: params.reason,
    },
  });
}

async function persistCheckpoint(params: {
  gaia: GaiaSleepWriteFacade;
  cursor: DedupCursor;
  checkpointCursor?: DedupCursor;
  jobId: string;
  profileId: string;
  reason: MemoryJobCheckpointReason;
  requestCheckpoint?: boolean;
}): Promise<void> {
  await params.gaia.recordJobCheckpoint({
    jobId: params.jobId,
    profileId: params.profileId,
    kind: "dedup",
    reason: params.reason,
    cursor: params.checkpointCursor ?? params.cursor,
    pendingEventCount: params.cursor.checkpoint.pendingEventCount,
    pendingPayloadBytes: params.cursor.checkpoint.pendingPayloadBytes,
    requestCheckpoint: params.requestCheckpoint,
  });
  resetCheckpoint(params.cursor);
}

function buildMergeDrafts(params: {
  winner: SleepPageSnapshot;
  loser: SleepPageSnapshot;
  nowMs: number;
}): MemoryStateEventDraft[] {
  const mergedMetadata = mergePageMetadata({
    winner: params.winner,
    loser: params.loser,
  });
  return [
    {
      actorId: "gaia-sleep",
      eventId: createEventId(
        "sleep-merge-page",
        `${params.winner.pageId}:${params.loser.pageId}:metadata`,
      ),
      pageId: params.winner.pageId,
      source: "sleep/dedup",
      batchId: `dedup:${params.winner.pageId}:${params.loser.pageId}`,
      type: "PAGE_METADATA_UPDATED",
      payload: {
        pageId: params.winner.pageId,
        title: params.winner.title,
        slug: params.winner.slug,
        aliases: mergedMetadata.aliases,
        tags: mergedMetadata.tags,
        updatedAtMs: params.nowMs,
      },
    },
    {
      actorId: "gaia-sleep",
      eventId: createEventId("sleep-merge-tombstone", params.loser.pageId),
      pageId: params.loser.pageId,
      source: "sleep/dedup",
      batchId: `dedup:${params.winner.pageId}:${params.loser.pageId}`,
      type: "PAGE_TOMBSTONED",
      payload: {
        pageId: params.loser.pageId,
        tombstoned: true,
        updatedAtMs: params.nowMs,
      },
    },
  ];
}

function buildProjectionMergeDrafts(params: {
  store: SqliteMemoryJobStore;
  winner: SleepPageSnapshot;
  loser: SleepPageSnapshot;
  workspaceDir: string;
  nowMs: number;
}): MemoryStateEventDraft[] {
  const winnerProjection = readPrimaryProjection(
    params.store.db,
    params.winner.pageId,
    params.workspaceDir,
  );
  const loserProjection = readPrimaryProjection(
    params.store.db,
    params.loser.pageId,
    params.workspaceDir,
  );
  const drafts = buildMergeDrafts({
    winner: params.winner,
    loser: params.loser,
    nowMs: params.nowMs,
  });
  if (winnerProjection && loserProjection) {
    const preferredProjection = chooseProjectionWinner(winnerProjection, loserProjection).winner;
    if (
      preferredProjection.pageId === params.loser.pageId &&
      preferredProjection.markdownBody.trim()
    ) {
      drafts.push({
        actorId: "gaia-sleep",
        eventId: createEventId(
          "sleep-merge-projection",
          `${params.winner.pageId}:${params.loser.pageId}:${preferredProjection.kind}`,
        ),
        pageId: params.winner.pageId,
        source: "sleep/dedup",
        batchId: `dedup:${params.winner.pageId}:${params.loser.pageId}`,
        type: "PROJECTION_SET",
        payload: {
          pageId: params.winner.pageId,
          kind: preferredProjection.kind,
          markdownBody: preferredProjection.markdownBody,
        },
      });
    }
  }

  if (params.winner.claim || params.loser.claim) {
    const sourceClaim = params.winner.claim ?? params.loser.claim!;
    drafts.push({
      actorId: "gaia-sleep",
      eventId: createEventId(
        "sleep-merge-claim-winner",
        `${params.winner.pageId}:${params.loser.pageId}:winner`,
      ),
      pageId: params.winner.pageId,
      source: "sleep/dedup",
      batchId: `dedup:${params.winner.pageId}:${params.loser.pageId}`,
      type: "CLAIM_UPSERTED",
      payload: {
        claimId: params.winner.pageId,
        subject: sourceClaim.subject,
        predicate: sourceClaim.predicate,
        object: sourceClaim.object,
        confidence: Math.max(
          params.winner.claim?.confidence ?? 0,
          params.loser.claim?.confidence ?? 0,
        ),
        status: "active",
        updatedAtMs: params.nowMs,
      },
    });
    if (params.loser.claim) {
      drafts.push({
        actorId: "gaia-sleep",
        eventId: createEventId("sleep-merge-claim-loser", params.loser.pageId),
        pageId: params.loser.pageId,
        source: "sleep/dedup",
        batchId: `dedup:${params.winner.pageId}:${params.loser.pageId}`,
        type: "CLAIM_UPSERTED",
        payload: {
          claimId: params.loser.pageId,
          subject: params.loser.claim.subject,
          predicate: params.loser.claim.predicate,
          object: params.loser.claim.object,
          confidence: params.loser.claim.confidence,
          status: "merged",
          updatedAtMs: params.nowMs,
        },
      });
    }
  }
  return drafts;
}

export function buildDedupJobId(workspaceScope: string): string {
  return `dedup:${workspaceScope}`;
}

export async function runDedupSlice(params: {
  store: SqliteMemoryJobStore;
  gaia: GaiaSleepWriteFacade;
  profileId: string;
  workspaceScope: string;
  workspaceDir: string;
  sliceDeadlineMs: number;
  token: CancellationToken;
  clock: SleepClock;
  autoMergeConfirmed: boolean;
  shouldPreempt?: () => boolean;
}): Promise<MemorySleepJobResult<DedupCursor>> {
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
        kind: "dedup",
        eventType: "CHECKPOINT_CREATED",
        payload: {
          reason: "preempted",
          cursor,
        },
      });
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
        kind: "dedup",
        eventType: "CHECKPOINT_CREATED",
        payload: {
          reason: "budget-exhausted",
          cursor,
        },
      });
      params.store.saveJobRecord({
        jobId,
        profileId: params.profileId,
        kind: "dedup",
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
      limit: PAGE_BATCH_LIMIT,
      taggedAnyOf: ["claim", "procedure"],
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
        kind: "dedup",
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
      const duplicates = findPotentialPageDuplicates({
        db: params.store.db,
        page,
        workspaceDir: params.workspaceDir,
      });
      cursor.lastPageId = page.pageId;

      for (const duplicate of duplicates) {
        if (!params.autoMergeConfirmed) {
          const inserted = appendMergeProposal({
            store: params.store,
            jobId,
            profileId: params.profileId,
            page,
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

        const plan = choosePageMergeWinner({
          db: params.store.db,
          left: page,
          right: duplicate.candidate,
        });
        const drafts = buildProjectionMergeDrafts({
          store: params.store,
          winner: plan.winner,
          loser: plan.loser,
          workspaceDir: params.workspaceDir,
          nowMs: params.clock.now(),
        });
        const writeResult = await params.gaia.writeEvents(drafts);
        if (writeResult.events.length > 0) {
          params.store.transaction(() => {
            params.store.appendAuditEvent({
              jobId,
              profileId: params.profileId,
              kind: "dedup",
              eventType: "ENTITY_MERGED",
              entityId: plan.winner.pageId,
              targetEntityId: plan.loser.pageId,
              payload: {
                winnerTitle: plan.winner.title,
                loserTitle: plan.loser.title,
                similarity: duplicate.similarity,
                reason: duplicate.reason,
                ledgerEventIds: writeResult.events.map((event) => event.eventId),
              },
            });
            params.store.appendAuditEvent({
              jobId,
              profileId: params.profileId,
              kind: "dedup",
              eventType: "ENTITY_DELETED",
              entityId: plan.loser.pageId,
              targetEntityId: plan.winner.pageId,
              payload: {
                deletedEntityId: plan.loser.pageId,
                tombstonedInto: plan.winner.pageId,
              },
            });
          });
          params.store.incrementTelemetry(params.profileId, "sleep_work_done_counts.entity_merge");
          mergeCounts(workDoneCounts, {
            "sleep_work_done_counts.entity_merge": 1,
          });
          notePayload(cursor, JSON.stringify(duplicate).length, true);
        } else {
          notePayload(cursor, JSON.stringify(duplicate).length, false);
        }
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
        kind: "dedup",
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
