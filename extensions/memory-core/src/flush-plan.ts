import os from "node:os";
import path from "node:path";
import {
  DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR,
  parseNonNegativeByteSize,
  resolveCronStyleNow,
  SILENT_REPLY_TOKEN,
  type MemoryFlushPlan,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/memory-core-host-runtime-core";

export const DEFAULT_MEMORY_FLUSH_SOFT_TOKENS = 4000;
export const DEFAULT_MEMORY_FLUSH_FORCE_TRANSCRIPT_BYTES = 2 * 1024 * 1024;
const DEFAULT_OBSIDIAN_MEMORY_PATH = "Alisio Memory";
const LEGACY_MEMORY_PATH = "memory";

const MEMORY_FLUSH_TARGET_HINT =
  "Store durable memories only in memory/YYYY-MM-DD.md (create memory/ if needed).";
const MEMORY_FLUSH_APPEND_ONLY_HINT =
  "If memory/YYYY-MM-DD.md already exists, APPEND new content only and do not overwrite existing entries.";
const MEMORY_FLUSH_READ_ONLY_HINT =
  "Treat workspace bootstrap/reference files such as MEMORY.md, SOUL.md, TOOLS.md, and AGENTS.md as read-only during this flush; never overwrite, replace, or edit them.";
const MEMORY_FLUSH_REQUIRED_HINTS = [
  MEMORY_FLUSH_TARGET_HINT,
  MEMORY_FLUSH_APPEND_ONLY_HINT,
  MEMORY_FLUSH_READ_ONLY_HINT,
];

export const DEFAULT_MEMORY_FLUSH_PROMPT = [
  "Pre-compaction memory flush.",
  MEMORY_FLUSH_TARGET_HINT,
  MEMORY_FLUSH_READ_ONLY_HINT,
  MEMORY_FLUSH_APPEND_ONLY_HINT,
  "Do NOT create timestamped variant files (e.g., YYYY-MM-DD-HHMM.md); always use the canonical YYYY-MM-DD.md filename.",
  `If nothing to store, reply with ${SILENT_REPLY_TOKEN}.`,
].join(" ");

export const DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT = [
  "Pre-compaction memory flush turn.",
  "The session is near auto-compaction; capture durable memories to disk.",
  MEMORY_FLUSH_TARGET_HINT,
  MEMORY_FLUSH_READ_ONLY_HINT,
  MEMORY_FLUSH_APPEND_ONLY_HINT,
  `You may reply, but usually ${SILENT_REPLY_TOKEN} is correct.`,
].join(" ");

function formatDateStampInTimezone(nowMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (year && month && day) {
    return `${year}-${month}-${day}`;
  }
  return new Date(nowMs).toISOString().slice(0, 10);
}

function normalizeNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const int = Math.floor(value);
  return int >= 0 ? int : null;
}

function ensureNoReplyHint(text: string): string {
  if (text.includes(SILENT_REPLY_TOKEN)) {
    return text;
  }
  return `${text}\n\nIf no user-visible reply is needed, start with ${SILENT_REPLY_TOKEN}.`;
}

function ensureMemoryFlushSafetyHints(
  text: string,
  requiredHints = MEMORY_FLUSH_REQUIRED_HINTS,
): string {
  let next = text.trim();
  for (const hint of requiredHints) {
    if (!next.includes(hint)) {
      next = next ? `${next}\n\n${hint}` : hint;
    }
  }
  return next;
}

function appendCurrentTimeLine(text: string, timeLine: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed) {
    return timeLine;
  }
  if (trimmed.includes("Current time:")) {
    return trimmed;
  }
  return `${trimmed}\n${timeLine}`;
}

function resolveHomePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

function normalizeMemorySubpath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error("memory.memoryPath must not be empty");
  }
  if (path.isAbsolute(trimmed)) {
    throw new Error("memory.memoryPath must be a relative path");
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error('memory.memoryPath must not contain "." or ".." segments');
  }
  return segments.join("/");
}

function resolveMemoryFlushTarget(params: { cfg?: OpenClawConfig; dateStamp: string }): {
  path: string;
  obsidian: boolean;
} {
  const rawVaultPath = params.cfg?.memory?.vaultPath?.trim();
  const rawMemoryPath = params.cfg?.memory?.memoryPath?.trim();
  const normalizedMemoryPath = rawMemoryPath ? normalizeMemorySubpath(rawMemoryPath) : null;
  if (rawVaultPath) {
    const vaultRoot = resolveHomePath(rawVaultPath);
    const memoryPath = normalizedMemoryPath ?? DEFAULT_OBSIDIAN_MEMORY_PATH;
    return {
      path: path.join(vaultRoot, ...memoryPath.split("/"), "daily", `${params.dateStamp}.md`),
      obsidian: true,
    };
  }
  if (normalizedMemoryPath && normalizedMemoryPath !== LEGACY_MEMORY_PATH) {
    return {
      path: path.posix.join(normalizedMemoryPath, "daily", `${params.dateStamp}.md`),
      obsidian: true,
    };
  }
  return {
    path: `memory/${params.dateStamp}.md`,
    obsidian: false,
  };
}

export function buildMemoryFlushPlan(
  params: {
    cfg?: OpenClawConfig;
    nowMs?: number;
  } = {},
): MemoryFlushPlan | null {
  const resolved = params;
  const nowMs = Number.isFinite(resolved.nowMs) ? (resolved.nowMs as number) : Date.now();
  const cfg = resolved.cfg;
  const defaults = cfg?.agents?.defaults?.compaction?.memoryFlush;
  if (defaults?.enabled === false) {
    return null;
  }

  const softThresholdTokens =
    normalizeNonNegativeInt(defaults?.softThresholdTokens) ?? DEFAULT_MEMORY_FLUSH_SOFT_TOKENS;
  const forceFlushTranscriptBytes =
    parseNonNegativeByteSize(defaults?.forceFlushTranscriptBytes) ??
    DEFAULT_MEMORY_FLUSH_FORCE_TRANSCRIPT_BYTES;
  const reserveTokensFloor =
    normalizeNonNegativeInt(cfg?.agents?.defaults?.compaction?.reserveTokensFloor) ??
    DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR;

  const { timeLine, userTimezone } = resolveCronStyleNow(cfg ?? {}, nowMs);
  const dateStamp = formatDateStampInTimezone(nowMs, userTimezone);
  const target = resolveMemoryFlushTarget({ cfg, dateStamp });
  const targetHint = `Store durable memories only in ${target.path}.`;
  const appendOnlyHint = `If ${target.path} already exists, APPEND new content only and do not overwrite existing entries.`;
  const requiredHints = [targetHint, appendOnlyHint, MEMORY_FLUSH_READ_ONLY_HINT];

  const promptBase = ensureNoReplyHint(
    ensureMemoryFlushSafetyHints(
      (defaults?.prompt?.trim() || DEFAULT_MEMORY_FLUSH_PROMPT)
        .replaceAll(MEMORY_FLUSH_TARGET_HINT, targetHint)
        .replaceAll(MEMORY_FLUSH_APPEND_ONLY_HINT, appendOnlyHint),
      requiredHints,
    ),
  );
  const systemPrompt = ensureNoReplyHint(
    ensureMemoryFlushSafetyHints(
      (defaults?.systemPrompt?.trim() || DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT)
        .replaceAll(MEMORY_FLUSH_TARGET_HINT, targetHint)
        .replaceAll(MEMORY_FLUSH_APPEND_ONLY_HINT, appendOnlyHint),
      requiredHints,
    ),
  );
  const prompt = appendCurrentTimeLine(promptBase.replaceAll("YYYY-MM-DD", dateStamp), timeLine);
  const obsidianPrompt =
    target.obsidian && !prompt.includes("frontmatter")
      ? `${prompt}\n\nIf the note already has frontmatter or headings, preserve them and append only the new durable memory content.`
      : prompt;

  return {
    softThresholdTokens,
    forceFlushTranscriptBytes,
    reserveTokensFloor,
    prompt: obsidianPrompt,
    systemPrompt: systemPrompt.replaceAll("YYYY-MM-DD", dateStamp),
    relativePath: target.path,
  };
}
