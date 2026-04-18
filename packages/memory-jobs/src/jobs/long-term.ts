import type { DatabaseSync } from "node:sqlite";
import type { MemoryStateEventDraft } from "alisio/plugin-sdk/memory-core-state";
import type { CancellationToken } from "../cancellation.js";
import {
  listPagesAfter,
  readPage,
  readPrimaryProjection,
  type SleepProjectionSnapshot,
} from "../canonical.js";
import type { GaiaSleepWriteFacade } from "../gaia.js";
import { extractPromotedItems } from "../promotion-text.js";
import type { SqliteMemoryJobStore } from "../store.js";
import type {
  LongTermCursor,
  LongTermSummaryCursor,
  MemorySleepJobResult,
  MemoryJobCheckpointReason,
  SleepClock,
} from "../types.js";
import { createEventId, hashText, stableStringify, uniqueStrings } from "../utils.js";

const BATCH_LIMIT = 12;
const CHECKPOINT_EVENT_THRESHOLD = 8;
const CHECKPOINT_SIZE_THRESHOLD_BYTES = 8_192;
const DAILY_NOTE_PATH_RE = /^memory\/(\d{4}-\d{2}-\d{2})\.md$/;
const ROOT_PAGE_ID = "memory-root";
const ROOT_TITLE = "Memory";
const ROOT_SLUG = "memory-root";
const ROOT_PROJECTION_KIND = "md-path:MEMORY.md";
const AUTO_SECTION_START = "<!-- alisio:auto-long-term:start -->";
const AUTO_SECTION_END = "<!-- alisio:auto-long-term:end -->";
const AUTO_SECTION_HEADING = "## Auto-promoted long-term memory";
const AUTO_SECTION_NOTE =
  "> Maintained automatically from canonical `memory/YYYY-MM-DD.md` notes.";
const MAX_ITEMS_PER_DAY = 8;
const AUTO_SECTION_RE = new RegExp(
  `${escapeRegExp(AUTO_SECTION_START)}[\\s\\S]*?${escapeRegExp(AUTO_SECTION_END)}`,
  "m",
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createInitialLongTermCursor(): LongTermCursor {
  return {
    summaries: [],
    checkpoint: {
      pendingEventCount: 0,
      pendingPayloadBytes: 0,
    },
  };
}

function shouldCheckpoint(cursor: LongTermCursor): boolean {
  return (
    cursor.checkpoint.pendingEventCount >= CHECKPOINT_EVENT_THRESHOLD ||
    cursor.checkpoint.pendingPayloadBytes >= CHECKPOINT_SIZE_THRESHOLD_BYTES
  );
}

function notePayload(cursor: LongTermCursor, payloadBytes: number, mutated: boolean): void {
  cursor.checkpoint.pendingPayloadBytes += payloadBytes;
  if (mutated) {
    cursor.checkpoint.pendingEventCount += 1;
  }
}

function resetCheckpoint(cursor: LongTermCursor): void {
  cursor.checkpoint.pendingEventCount = 0;
  cursor.checkpoint.pendingPayloadBytes = 0;
}

function mergeCounts(target: Record<string, number>, next: Record<string, number>): void {
  for (const [key, value] of Object.entries(next)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function buildSummaryFromProjection(
  projection: SleepProjectionSnapshot,
): LongTermSummaryCursor | undefined {
  const match = DAILY_NOTE_PATH_RE.exec(projection.relativePath);
  if (!match) {
    return undefined;
  }
  const items = extractPromotedItems(projection.markdownBody).slice(0, MAX_ITEMS_PER_DAY);
  if (items.length === 0) {
    return undefined;
  }
  return {
    pageId: projection.pageId,
    dateStamp: match[1],
    relativePath: projection.relativePath,
    updatedAtMs: projection.updatedAtMs,
    items,
  };
}

function upsertSummary(cursor: LongTermCursor, summary: LongTermSummaryCursor): boolean {
  const existingIndex = cursor.summaries.findIndex((entry) => entry.pageId === summary.pageId);
  if (existingIndex === -1) {
    cursor.summaries.push(summary);
    return true;
  }
  if (stableStringify(cursor.summaries[existingIndex]) === stableStringify(summary)) {
    return false;
  }
  cursor.summaries[existingIndex] = summary;
  return true;
}

function buildAutoSection(summaries: readonly LongTermSummaryCursor[]): string | undefined {
  if (summaries.length === 0) {
    return undefined;
  }
  const lines = [AUTO_SECTION_START, AUTO_SECTION_HEADING, "", AUTO_SECTION_NOTE, ""];
  for (const summary of summaries) {
    lines.push(`### ${summary.dateStamp}`, "");
    for (const item of summary.items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  lines.push(AUTO_SECTION_END);
  return lines.join("\n").trim();
}

function normalizeDocument(markdown: string): string {
  const trimmed = markdown.trim();
  return trimmed ? `${trimmed}\n` : "";
}

function mergeRootMarkdown(params: {
  existingMarkdown?: string;
  autoSection?: string;
}): string | undefined {
  const existingWithoutAuto = params.existingMarkdown
    ? params.existingMarkdown.replace(AUTO_SECTION_RE, "").replace(/\n{3,}/g, "\n\n").trim()
    : "";

  if (params.autoSection) {
    const base = existingWithoutAuto || `# ${ROOT_TITLE}`;
    return normalizeDocument(`${base}\n\n${params.autoSection}`);
  }
  if (existingWithoutAuto) {
    return normalizeDocument(existingWithoutAuto);
  }
  if (params.existingMarkdown?.includes(AUTO_SECTION_START)) {
    return normalizeDocument(`# ${ROOT_TITLE}`);
  }
  return undefined;
}

function buildLongTermDrafts(params: {
  db: DatabaseSync;
  nowMs: number;
  existingMarkdown?: string;
  existingProjectionKind?: string;
  nextMarkdown?: string;
}): MemoryStateEventDraft[] {
  const drafts: MemoryStateEventDraft[] = [];
  const rootPage = readPage(params.db, ROOT_PAGE_ID);
  const currentPage = Boolean(rootPage || params.nextMarkdown);
  const nextTitle = rootPage?.title ?? ROOT_TITLE;
  const nextSlug = rootPage?.slug ?? ROOT_SLUG;
  const nextAliases = uniqueStrings([...(rootPage?.aliases ?? []), ROOT_PAGE_ID, "MEMORY.md"]);
  const nextTags = uniqueStrings([...(rootPage?.tags ?? []), "evergreen", "long-term"]);
  const metadataChanged =
    !rootPage ||
    rootPage.title !== nextTitle ||
    rootPage.slug !== nextSlug ||
    rootPage.tombstoned ||
    stableStringify(rootPage.aliases) !== stableStringify(nextAliases) ||
    stableStringify(rootPage.tags) !== stableStringify(nextTags);

  if (currentPage && metadataChanged) {
    drafts.push({
      actorId: "gaia-sleep",
      eventId: createEventId(
        "sleep-long-term-metadata",
        stableStringify({
          title: nextTitle,
          slug: nextSlug,
          aliases: nextAliases,
          tags: nextTags,
        }),
      ),
      pageId: ROOT_PAGE_ID,
      source: "sleep/long-term",
      batchId: "long-term:memory-root",
      type: "PAGE_METADATA_UPDATED",
      payload: {
        pageId: ROOT_PAGE_ID,
        title: nextTitle,
        slug: nextSlug,
        aliases: nextAliases,
        tags: nextTags,
        updatedAtMs: params.nowMs,
      },
    });
  }

  const normalizedCurrent = normalizeDocument(params.existingMarkdown ?? "");
  const normalizedNext = normalizeDocument(params.nextMarkdown ?? "");
  if (normalizedCurrent !== normalizedNext && normalizedNext) {
    drafts.push({
      actorId: "gaia-sleep",
      eventId: createEventId("sleep-long-term-projection", hashText(normalizedNext)),
      pageId: ROOT_PAGE_ID,
      source: "sleep/long-term",
      batchId: "long-term:memory-root",
      type: "PROJECTION_SET",
      payload: {
        pageId: ROOT_PAGE_ID,
        kind: params.existingProjectionKind ?? ROOT_PROJECTION_KIND,
        markdownBody: normalizedNext,
      },
    });
  }

  return drafts;
}

async function persistCheckpoint(params: {
  gaia: GaiaSleepWriteFacade;
  cursor: LongTermCursor;
  checkpointCursor?: LongTermCursor;
  jobId: string;
  profileId: string;
  reason: MemoryJobCheckpointReason;
  requestCheckpoint?: boolean;
}): Promise<void> {
  await params.gaia.recordJobCheckpoint({
    jobId: params.jobId,
    profileId: params.profileId,
    kind: "long-term",
    reason: params.reason,
    cursor: params.checkpointCursor ?? params.cursor,
    pendingEventCount: params.cursor.checkpoint.pendingEventCount,
    pendingPayloadBytes: params.cursor.checkpoint.pendingPayloadBytes,
    requestCheckpoint: params.requestCheckpoint,
  });
  resetCheckpoint(params.cursor);
}

export function buildLongTermJobId(workspaceScope: string): string {
  return `long-term:${workspaceScope}`;
}

export async function runLongTermSlice(params: {
  store: SqliteMemoryJobStore;
  gaia: GaiaSleepWriteFacade;
  profileId: string;
  workspaceScope: string;
  workspaceDir: string;
  sliceDeadlineMs: number;
  token: CancellationToken;
  clock: SleepClock;
  shouldPreempt?: () => boolean;
}): Promise<MemorySleepJobResult<LongTermCursor>> {
  const jobId = buildLongTermJobId(params.workspaceScope);
  const { cursor } = params.store.readJobRecord({
    jobId,
    profileId: params.profileId,
    kind: "long-term",
    initialCursor: createInitialLongTermCursor(),
  });
  params.store.saveJobRecord({
    jobId,
    profileId: params.profileId,
    kind: "long-term",
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
        kind: "long-term",
        eventType: "CHECKPOINT_CREATED",
        payload: {
          reason: "preempted",
          cursor,
        },
      });
      params.store.saveJobRecord({
        jobId,
        profileId: params.profileId,
        kind: "long-term",
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
        kind: "long-term",
        eventType: "CHECKPOINT_CREATED",
        payload: {
          reason: "budget-exhausted",
          cursor,
        },
      });
      params.store.saveJobRecord({
        jobId,
        profileId: params.profileId,
        kind: "long-term",
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
      if (params.shouldPreempt?.()) {
        return await preempt();
      }
      const rootProjection = readPrimaryProjection(params.store.db, ROOT_PAGE_ID, params.workspaceDir);
      const sortedSummaries = [...cursor.summaries].toSorted((left, right) => {
        if (left.dateStamp !== right.dateStamp) {
          return right.dateStamp.localeCompare(left.dateStamp);
        }
        return right.updatedAtMs - left.updatedAtMs;
      });
      const nextMarkdown = mergeRootMarkdown({
        existingMarkdown: rootProjection?.markdownBody,
        autoSection: buildAutoSection(sortedSummaries),
      });
      const drafts = buildLongTermDrafts({
        db: params.store.db,
        nowMs: params.clock.now(),
        existingMarkdown: rootProjection?.markdownBody,
        existingProjectionKind:
          rootProjection?.relativePath === "MEMORY.md" ? rootProjection.kind : undefined,
        nextMarkdown,
      });
      if (drafts.length > 0) {
        const writeResult = await params.gaia.writeEvents(drafts, {
          materializeMarkdown: true,
        });
        if (writeResult.events.length > 0) {
          const totalItems = sortedSummaries.reduce((sum, summary) => sum + summary.items.length, 0);
          params.store.transaction(() => {
            const inserted = params.store.appendAuditEvent({
              jobId,
              profileId: params.profileId,
              kind: "long-term",
              eventType: "PROMOTED_TO_LONG_TERM",
              entityId: ROOT_PAGE_ID,
              dedupeKey: nextMarkdown ? `long-term:${hashText(nextMarkdown)}` : undefined,
              payload: {
                pageId: ROOT_PAGE_ID,
                relativePath: "MEMORY.md",
                datesPromoted: sortedSummaries.length,
                itemCount: totalItems,
                ledgerEventIds: writeResult.events.map((event) => event.eventId),
              },
            });
            if (inserted) {
              params.store.incrementTelemetry(
                params.profileId,
                "sleep_work_done_counts.promoted_long_term_updates",
              );
              params.store.incrementTelemetry(
                params.profileId,
                "sleep_work_done_counts.promoted_long_term_items",
                totalItems,
              );
              mergeCounts(workDoneCounts, {
                "sleep_work_done_counts.promoted_long_term_updates": 1,
                "sleep_work_done_counts.promoted_long_term_items": totalItems,
              });
            }
            params.store.saveJobRecord({
              jobId,
              profileId: params.profileId,
              kind: "long-term",
              status: "running",
              cursor,
            });
          });
          notePayload(
            cursor,
            JSON.stringify({
              dates: sortedSummaries.length,
              items: totalItems,
            }).length,
            true,
          );
        }
      }

      const completedCursor = createInitialLongTermCursor();
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
        kind: "long-term",
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
      cursor.lastPageId = page.pageId;
      const projection = readPrimaryProjection(params.store.db, page.pageId, params.workspaceDir);
      if (!projection) {
        notePayload(cursor, page.pageId.length, false);
      } else {
        const summary = buildSummaryFromProjection(projection);
        const changed = summary ? upsertSummary(cursor, summary) : false;
        notePayload(
          cursor,
          summary
            ? JSON.stringify({
                pageId: summary.pageId,
                dateStamp: summary.dateStamp,
                items: summary.items,
              }).length
            : projection.relativePath.length,
          changed,
        );
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
        kind: "long-term",
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
