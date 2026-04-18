import path from "node:path";
import YAML from "yaml";
import type { MemoryStateEventDraft } from "alisio/plugin-sdk/memory-core-state";
import {
  buildCanonicalMemoryNotePath,
  slugifyMemoryNotePathComponent,
} from "alisio/plugin-sdk/memory-core-host-runtime-core";
import type { CancellationToken } from "../cancellation.js";
import {
  listPagesAfter,
  readPageByRelativePath,
  readPrimaryProjection,
  readProjectionByRelativePath,
  type SleepPageSnapshot,
  type SleepProjectionSnapshot,
} from "../canonical.js";
import type { GaiaSleepWriteFacade } from "../gaia.js";
import {
  buildLongTermJobId,
  createInitialLongTermCursor,
} from "./long-term.js";
import type { SqliteMemoryJobStore } from "../store.js";
import {
  buildPromotionSummary,
  extractPromotedItems,
} from "../promotion-text.js";
import type {
  BacklogPromoteCursor,
  MemorySleepJobResult,
  MemoryJobCheckpointReason,
  SleepClock,
} from "../types.js";
import { createEventId, hashText, stableStringify, uniqueStrings } from "../utils.js";

const BATCH_LIMIT = 12;
const CHECKPOINT_EVENT_THRESHOLD = 8;
const CHECKPOINT_SIZE_THRESHOLD_BYTES = 8_192;
const BACKLOG_PATH_RE = /^memory\/backlog(?:\/(\d{4}-\d{2}-\d{2}))?\/([^/]+)\.md$/i;
const TOPIC_SECTION_START = "<!-- alisio:auto-backlog-topic:start -->";
const TOPIC_SECTION_END = "<!-- alisio:auto-backlog-topic:end -->";
const DAILY_SECTION_START = "<!-- alisio:auto-backlog-daily:start -->";
const DAILY_SECTION_END = "<!-- alisio:auto-backlog-daily:end -->";

type ParsedBacklogNote = {
  dateStamp: string;
  timeLabel: string;
  sessionAction: string;
  summary: string;
  items: string[];
  topicSlug: string;
  topicTitle: string;
};

type NoteTarget = {
  pageId: string;
  title: string;
  relativePath: string;
  projectionKind: string;
  existingPage?: SleepPageSnapshot;
  existingProjection?: SleepProjectionSnapshot;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createInitialCursor(): BacklogPromoteCursor {
  return {
    checkpoint: {
      pendingEventCount: 0,
      pendingPayloadBytes: 0,
    },
  };
}

function shouldCheckpoint(cursor: BacklogPromoteCursor): boolean {
  return (
    cursor.checkpoint.pendingEventCount >= CHECKPOINT_EVENT_THRESHOLD ||
    cursor.checkpoint.pendingPayloadBytes >= CHECKPOINT_SIZE_THRESHOLD_BYTES
  );
}

function notePayload(cursor: BacklogPromoteCursor, payloadBytes: number, mutated: boolean): void {
  cursor.checkpoint.pendingPayloadBytes += payloadBytes;
  if (mutated) {
    cursor.checkpoint.pendingEventCount += 1;
  }
}

function resetCheckpoint(cursor: BacklogPromoteCursor): void {
  cursor.checkpoint.pendingEventCount = 0;
  cursor.checkpoint.pendingPayloadBytes = 0;
}

function mergeCounts(target: Record<string, number>, next: Record<string, number>): void {
  for (const [key, value] of Object.entries(next)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function normalizeDocument(markdown: string): string {
  const trimmed = markdown.trim();
  return trimmed ? `${trimmed}\n` : "";
}

function humanizeSlug(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseFrontmatter(markdown: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (!markdown.startsWith("---")) {
    return {
      frontmatter: {},
      body: markdown,
    };
  }
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      frontmatter: {},
      body: markdown,
    };
  }
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(match[1] ?? "");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    frontmatter = {};
  }
  return {
    frontmatter,
    body: markdown.slice(match[0].length),
  };
}

function trimSummaryCandidate(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 159).trimEnd()}…`;
}

function isGenericTopicSlug(value: string): boolean {
  return !value || /^\d+$/.test(value) || /^(?:backlog|session|note)$/i.test(value);
}

function resolveTopicSlug(params: {
  relativePath: string;
  summary: string;
  items: readonly string[];
}): string {
  const baseSlug = path.posix.basename(params.relativePath, ".md");
  const preferredSeed =
    !isGenericTopicSlug(baseSlug) && baseSlug !== "backlog"
      ? baseSlug
      : params.items[0] ?? params.summary;
  const slug = slugifyMemoryNotePathComponent(preferredSeed || baseSlug || "topic");
  return slug.slice(0, 80).replace(/-+$/g, "") || "topic";
}

function formatTimeLabel(value: Date): string {
  const iso = value.toISOString();
  return `${iso.slice(11, 16)} UTC`;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseBacklogNote(params: {
  page: SleepPageSnapshot;
  projection: SleepProjectionSnapshot;
}): ParsedBacklogNote | undefined {
  const match = BACKLOG_PATH_RE.exec(params.projection.relativePath);
  if (!match) {
    return undefined;
  }
  const parsed = parseFrontmatter(params.projection.markdownBody);
  const capturedAt =
    normalizeString(parsed.frontmatter.capturedAt) ||
    new Date(params.page.updatedAtMs).toISOString();
  const capturedAtDate = new Date(capturedAt);
  const resolvedCapturedDate = Number.isNaN(capturedAtDate.getTime())
    ? new Date(params.page.updatedAtMs)
    : capturedAtDate;
  const dateStamp = match[1] ?? resolvedCapturedDate.toISOString().slice(0, 10);
  const items = extractPromotedItems(parsed.body);
  const summary = buildPromotionSummary({
    summary: normalizeString(parsed.frontmatter.summary),
    items,
    fallback: params.page.title,
  });
  const topicSlug = resolveTopicSlug({
    relativePath: params.projection.relativePath,
    summary,
    items,
  });
  return {
    dateStamp,
    timeLabel: Number.isNaN(capturedAtDate.getTime())
      ? "00:00 UTC"
      : formatTimeLabel(capturedAtDate),
    sessionAction: normalizeString(parsed.frontmatter.sessionAction) || "new",
    summary: trimSummaryCandidate(summary),
    items,
    topicSlug,
    topicTitle: humanizeSlug(topicSlug) || params.page.title || "Topic",
  };
}

function entryMarkers(sourcePageId: string): {
  start: string;
  end: string;
} {
  return {
    start: `<!-- alisio:auto-backlog-entry:${sourcePageId}:start -->`,
    end: `<!-- alisio:auto-backlog-entry:${sourcePageId}:end -->`,
  };
}

function stripManagedSection(markdown: string, start: string, end: string): {
  base: string;
  sectionBody: string;
} {
  const sectionRe = new RegExp(`${escapeRegExp(start)}([\\s\\S]*?)${escapeRegExp(end)}`, "m");
  const match = sectionRe.exec(markdown);
  if (!match) {
    return {
      base: markdown.trim(),
      sectionBody: "",
    };
  }
  return {
    base: markdown.replace(sectionRe, "").replace(/\n{3,}/g, "\n\n").trim(),
    sectionBody: (match[1] ?? "").trim(),
  };
}

function upsertManagedSection(params: {
  existingMarkdown?: string;
  defaultTitle: string;
  sectionStart: string;
  sectionEnd: string;
  sectionHeading?: string;
  entryId: string;
  entryMarkdown: string;
}): string {
  const existing = params.existingMarkdown ?? "";
  const { base, sectionBody } = stripManagedSection(
    existing,
    params.sectionStart,
    params.sectionEnd,
  );
  const markers = entryMarkers(params.entryId);
  const entryRe = new RegExp(
    `${escapeRegExp(markers.start)}[\\s\\S]*?${escapeRegExp(markers.end)}\\n*`,
    "g",
  );
  const headingRe = params.sectionHeading
    ? new RegExp(`^${escapeRegExp(params.sectionHeading)}\\n*`, "m")
    : null;
  const existingEntries = sectionBody
    .replace(entryRe, "")
    .replace(headingRe ?? /$^/, "")
    .trim();
  const parts = [
    params.sectionStart,
    ...(params.sectionHeading ? [params.sectionHeading, ""] : []),
    markers.start,
    params.entryMarkdown.trim(),
    markers.end,
    ...(existingEntries ? ["", existingEntries] : []),
    params.sectionEnd,
  ];
  const autoSection = parts.join("\n").trim();
  const root = base || `# ${params.defaultTitle}`;
  return normalizeDocument(`${root}\n\n${autoSection}`);
}

function resolvePageId(relativePath: string): string {
  return hashText(`page:${relativePath}`);
}

function resolveNoteTarget(params: {
  db: SqliteMemoryJobStore["db"];
  relativePath: string;
  defaultTitle: string;
}): NoteTarget {
  const existingPage = readPageByRelativePath(params.db, params.relativePath);
  const existingProjection = readProjectionByRelativePath({
    db: params.db,
    relativePath: params.relativePath,
    workspaceDir: ".",
  });
  return {
    pageId: existingPage?.pageId ?? resolvePageId(params.relativePath),
    title: existingPage?.title ?? params.defaultTitle,
    relativePath: params.relativePath,
    projectionKind: existingProjection?.kind ?? `md-path:${params.relativePath}`,
    ...(existingPage ? { existingPage } : {}),
    ...(existingProjection ? { existingProjection } : {}),
  };
}

function buildTopicEntry(params: ParsedBacklogNote): string {
  const detailItems = uniqueStrings(
    params.items.filter((item) => item && item !== params.summary).slice(0, 4),
  );
  const lines = [
    `### ${params.dateStamp} ${params.timeLabel}`,
    "",
    `- Summary: ${params.summary}`,
    `- Captured via /${params.sessionAction}`,
  ];
  if (detailItems.length > 0) {
    lines.push("- Details:");
    for (const item of detailItems) {
      lines.push(`  - ${item}`);
    }
  }
  return lines.join("\n");
}

function buildDailyEntry(params: ParsedBacklogNote): string {
  return [`## ${params.timeLabel}`, "", `- ${params.topicTitle}: ${params.summary}`].join("\n");
}

function buildPageUpdateDrafts(params: {
  pageId: string;
  title: string;
  relativePath: string;
  projectionKind: string;
  existingPage?: SleepPageSnapshot;
  markdownBody: string;
  tags: readonly string[];
  aliases: readonly string[];
  sourcePageId: string;
  nowMs: number;
}): MemoryStateEventDraft[] {
  return [
    {
      actorId: "gaia-sleep",
      eventId: createEventId(
        "sleep-backlog-page-metadata",
        stableStringify([
          params.pageId,
          params.title,
          params.relativePath,
          params.tags,
          params.aliases,
        ]),
      ),
      pageId: params.pageId,
      source: "sleep/backlog-promote",
      batchId: `backlog-promote:${params.sourcePageId}`,
      type: "PAGE_METADATA_UPDATED",
      payload: {
        pageId: params.pageId,
        title: params.title,
        slug: params.existingPage?.slug ?? slugifyMemoryNotePathComponent(params.title),
        aliases: [...params.aliases],
        tags: [...params.tags],
        updatedAtMs: params.nowMs,
      },
    },
    {
      actorId: "gaia-sleep",
      eventId: createEventId(
        "sleep-backlog-page-projection",
        stableStringify([params.pageId, params.relativePath, hashText(params.markdownBody)]),
      ),
      pageId: params.pageId,
      source: "sleep/backlog-promote",
      batchId: `backlog-promote:${params.sourcePageId}`,
      type: "PROJECTION_SET",
      payload: {
        pageId: params.pageId,
        kind: params.projectionKind,
        markdownBody: params.markdownBody,
      },
    },
  ];
}

function buildPromotionDrafts(params: {
  sourcePage: SleepPageSnapshot;
  parsed: ParsedBacklogNote;
  store: SqliteMemoryJobStore;
  nowMs: number;
}): {
  drafts: MemoryStateEventDraft[];
  topicTarget: NoteTarget;
  dailyTarget: NoteTarget;
} {
  const topicRelativePath = buildCanonicalMemoryNotePath({
    role: "topic",
    slug: params.parsed.topicSlug,
    title: params.parsed.topicTitle,
  });
  const dailyRelativePath = buildCanonicalMemoryNotePath({
    role: "daily",
    dateStamp: params.parsed.dateStamp,
  });
  const topicTarget = resolveNoteTarget({
    db: params.store.db,
    relativePath: topicRelativePath,
    defaultTitle: params.parsed.topicTitle,
  });
  const dailyTarget = resolveNoteTarget({
    db: params.store.db,
    relativePath: dailyRelativePath,
    defaultTitle: params.parsed.dateStamp,
  });
  const topicMarkdown = upsertManagedSection({
    existingMarkdown: topicTarget.existingProjection?.markdownBody,
    defaultTitle: topicTarget.title,
    sectionStart: TOPIC_SECTION_START,
    sectionEnd: TOPIC_SECTION_END,
    sectionHeading: "## Promoted backlog",
    entryId: params.sourcePage.pageId,
    entryMarkdown: buildTopicEntry(params.parsed),
  });
  const dailyMarkdown = upsertManagedSection({
    existingMarkdown: dailyTarget.existingProjection?.markdownBody,
    defaultTitle: dailyTarget.title,
    sectionStart: DAILY_SECTION_START,
    sectionEnd: DAILY_SECTION_END,
    entryId: params.sourcePage.pageId,
    entryMarkdown: buildDailyEntry(params.parsed),
  });
  const drafts = [
    ...buildPageUpdateDrafts({
      pageId: topicTarget.pageId,
      title: topicTarget.title,
      relativePath: topicTarget.relativePath,
      projectionKind: topicTarget.projectionKind,
      existingPage: topicTarget.existingPage,
      markdownBody: topicMarkdown,
      tags: uniqueStrings([...(topicTarget.existingPage?.tags ?? []), "topic"]),
      aliases: uniqueStrings([
        ...(topicTarget.existingPage?.aliases ?? []),
        params.parsed.topicTitle,
        params.parsed.topicSlug,
      ]),
      sourcePageId: params.sourcePage.pageId,
      nowMs: params.nowMs,
    }),
    ...buildPageUpdateDrafts({
      pageId: dailyTarget.pageId,
      title: dailyTarget.title,
      relativePath: dailyTarget.relativePath,
      projectionKind: dailyTarget.projectionKind,
      existingPage: dailyTarget.existingPage,
      markdownBody: dailyMarkdown,
      tags: uniqueStrings([...(dailyTarget.existingPage?.tags ?? []), "daily"]),
      aliases: uniqueStrings([
        ...(dailyTarget.existingPage?.aliases ?? []),
        params.parsed.dateStamp,
        path.posix.basename(dailyTarget.relativePath),
      ]),
      sourcePageId: params.sourcePage.pageId,
      nowMs: params.nowMs,
    }),
    {
      actorId: "gaia-sleep",
      eventId: createEventId("sleep-backlog-tombstone", params.sourcePage.pageId),
      pageId: params.sourcePage.pageId,
      source: "sleep/backlog-promote",
      batchId: `backlog-promote:${params.sourcePage.pageId}`,
      type: "PAGE_TOMBSTONED",
      payload: {
        pageId: params.sourcePage.pageId,
        tombstoned: true,
        updatedAtMs: params.nowMs,
      },
    },
  ] satisfies MemoryStateEventDraft[];

  return {
    drafts,
    topicTarget,
    dailyTarget,
  };
}

async function persistCheckpoint(params: {
  gaia: GaiaSleepWriteFacade;
  cursor: BacklogPromoteCursor;
  checkpointCursor?: BacklogPromoteCursor;
  jobId: string;
  profileId: string;
  reason: MemoryJobCheckpointReason;
  requestCheckpoint?: boolean;
}): Promise<void> {
  await params.gaia.recordJobCheckpoint({
    jobId: params.jobId,
    profileId: params.profileId,
    kind: "backlog-promote",
    reason: params.reason,
    cursor: params.checkpointCursor ?? params.cursor,
    pendingEventCount: params.cursor.checkpoint.pendingEventCount,
    pendingPayloadBytes: params.cursor.checkpoint.pendingPayloadBytes,
    requestCheckpoint: params.requestCheckpoint,
  });
  resetCheckpoint(params.cursor);
}

async function resetLongTermCursor(params: {
  store: SqliteMemoryJobStore;
  gaia: GaiaSleepWriteFacade;
  profileId: string;
  workspaceScope: string;
}): Promise<void> {
  const cursor = createInitialLongTermCursor();
  const jobId = buildLongTermJobId(params.workspaceScope);
  await params.gaia.recordJobCheckpoint({
    jobId,
    profileId: params.profileId,
    kind: "long-term",
    reason: "cycle-complete",
    cursor,
    pendingEventCount: 0,
    pendingPayloadBytes: 0,
  });
  params.store.saveJobRecord({
    jobId,
    profileId: params.profileId,
    kind: "long-term",
    status: "idle",
    cursor,
  });
}

export function buildBacklogPromoteJobId(workspaceScope: string): string {
  return `backlog-promote:${workspaceScope}`;
}

export async function runBacklogPromoteSlice(params: {
  store: SqliteMemoryJobStore;
  gaia: GaiaSleepWriteFacade;
  profileId: string;
  workspaceScope: string;
  workspaceDir: string;
  sliceDeadlineMs: number;
  token: CancellationToken;
  clock: SleepClock;
  shouldPreempt?: () => boolean;
}): Promise<MemorySleepJobResult<BacklogPromoteCursor>> {
  const jobId = buildBacklogPromoteJobId(params.workspaceScope);
  const { cursor } = params.store.readJobRecord({
    jobId,
    profileId: params.profileId,
    kind: "backlog-promote",
    initialCursor: createInitialCursor(),
  });
  params.store.saveJobRecord({
    jobId,
    profileId: params.profileId,
    kind: "backlog-promote",
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
        kind: "backlog-promote",
        eventType: "CHECKPOINT_CREATED",
        payload: {
          reason: "preempted",
          cursor,
        },
      });
      params.store.saveJobRecord({
        jobId,
        profileId: params.profileId,
        kind: "backlog-promote",
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
        kind: "backlog-promote",
        eventType: "CHECKPOINT_CREATED",
        payload: {
          reason: "budget-exhausted",
          cursor,
        },
      });
      params.store.saveJobRecord({
        jobId,
        profileId: params.profileId,
        kind: "backlog-promote",
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
        kind: "backlog-promote",
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
      const parsed =
        projection &&
        (page.tags.includes("backlog") || BACKLOG_PATH_RE.test(projection.relativePath))
          ? parseBacklogNote({
              page,
              projection,
            })
          : undefined;

      if (!projection || !parsed) {
        notePayload(
          cursor,
          projection?.relativePath.length ?? page.pageId.length,
          false,
        );
      } else {
        const promoted = buildPromotionDrafts({
          sourcePage: page,
          parsed,
          store: params.store,
          nowMs: params.clock.now(),
        });
        const writeResult = await params.gaia.writeEvents(promoted.drafts, {
          materializeMarkdown: true,
        });
        await resetLongTermCursor({
          store: params.store,
          gaia: params.gaia,
          profileId: params.profileId,
          workspaceScope: params.workspaceScope,
        });
        params.store.transaction(() => {
          const insertedTopic = params.store.appendAuditEvent({
            jobId,
            profileId: params.profileId,
            kind: "backlog-promote",
            eventType: "PROMOTED_TO_TOPIC",
            entityId: page.pageId,
            targetEntityId: promoted.topicTarget.pageId,
            dedupeKey: `backlog-topic:${page.pageId}`,
            payload: {
              sourcePath: projection.relativePath,
              targetPath: promoted.topicTarget.relativePath,
              topicTitle: promoted.topicTarget.title,
              summary: parsed.summary,
              itemCount: parsed.items.length,
              ledgerEventIds: writeResult.events.map((event) => event.eventId),
            },
          });
          const insertedDaily = params.store.appendAuditEvent({
            jobId,
            profileId: params.profileId,
            kind: "backlog-promote",
            eventType: "PROMOTED_TO_DAILY",
            entityId: page.pageId,
            targetEntityId: promoted.dailyTarget.pageId,
            dedupeKey: `backlog-daily:${page.pageId}`,
            payload: {
              sourcePath: projection.relativePath,
              targetPath: promoted.dailyTarget.relativePath,
              dateStamp: parsed.dateStamp,
              summary: parsed.summary,
              ledgerEventIds: writeResult.events.map((event) => event.eventId),
            },
          });
          const insertedCleanup = params.store.appendAuditEvent({
            jobId,
            profileId: params.profileId,
            kind: "backlog-promote",
            eventType: "PROJECTION_DELETED",
            entityId: page.pageId,
            dedupeKey: `backlog-cleanup:${page.pageId}`,
            payload: {
              relativePath: projection.relativePath,
              reason: "backlog-promoted",
            },
          });
          if (insertedTopic) {
            params.store.incrementTelemetry(
              params.profileId,
              "sleep_work_done_counts.promoted_backlog_topic",
            );
            mergeCounts(workDoneCounts, {
              "sleep_work_done_counts.promoted_backlog_topic": 1,
            });
          }
          if (insertedDaily) {
            params.store.incrementTelemetry(
              params.profileId,
              "sleep_work_done_counts.promoted_backlog_daily",
            );
            mergeCounts(workDoneCounts, {
              "sleep_work_done_counts.promoted_backlog_daily": 1,
            });
          }
          if (insertedCleanup) {
            params.store.incrementTelemetry(
              params.profileId,
              "sleep_work_done_counts.promoted_backlog_cleanup",
            );
            mergeCounts(workDoneCounts, {
              "sleep_work_done_counts.promoted_backlog_cleanup": 1,
            });
          }
          params.store.saveJobRecord({
            jobId,
            profileId: params.profileId,
            kind: "backlog-promote",
            status: "running",
            cursor,
          });
        });
        notePayload(
          cursor,
          JSON.stringify({
            pageId: page.pageId,
            topicPath: promoted.topicTarget.relativePath,
            dailyPath: promoted.dailyTarget.relativePath,
            summary: parsed.summary,
          }).length,
          true,
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
        kind: "backlog-promote",
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
