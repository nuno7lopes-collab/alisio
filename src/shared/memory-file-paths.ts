export const AGENT_INSTRUCTIONS_FILE_NAME = "AGENTS.md";
export const AGENT_TOOLS_FILE_NAME = "TOOLS.md";
export const AGENT_HEARTBEAT_FILE_NAME = "HEARTBEAT.md";
export const SETUP_BOOTSTRAP_FILE_NAME = "BOOTSTRAP.md";
export const AGENT_IDENTITY_FILE_NAME = "IDENTITY.md";
export const AGENT_SOUL_FILE_NAME = "SOUL.md";
export const USER_PREFERENCES_FILE_NAME = "USER.md";
export const PRIMARY_MEMORY_FILE_NAME = "MEMORY.md";
export const MANUAL_MEMORY_NOTES_DIR = "memory";
export const MEMORY_BACKLOG_NOTES_DIR = `${MANUAL_MEMORY_NOTES_DIR}/backlog`;

export type MemoryNoteRole = "main" | "topic" | "daily" | "backlog";

export type CanonicalMemoryFileKind =
  | "agent_instructions"
  | "agent_tools"
  | "agent_heartbeat"
  | "setup_bootstrap"
  | "identity"
  | "soul"
  | "preferences"
  | "main_memory"
  | "topic_note"
  | "daily_note"
  | "backlog_note";

export type CanonicalMemoryFileGroup = "agent" | "setup" | "identity" | "memory";

const ROOT_FILE_KIND_BY_NAME: Record<string, CanonicalMemoryFileKind> = {
  [AGENT_INSTRUCTIONS_FILE_NAME]: "agent_instructions",
  [AGENT_TOOLS_FILE_NAME]: "agent_tools",
  [AGENT_HEARTBEAT_FILE_NAME]: "agent_heartbeat",
  [SETUP_BOOTSTRAP_FILE_NAME]: "setup_bootstrap",
  [AGENT_IDENTITY_FILE_NAME]: "identity",
  [AGENT_SOUL_FILE_NAME]: "soul",
  [USER_PREFERENCES_FILE_NAME]: "preferences",
  [PRIMARY_MEMORY_FILE_NAME]: "main_memory",
};

const MEMORY_NOTE_KIND_BY_ROLE: Record<MemoryNoteRole, CanonicalMemoryFileKind> = {
  main: "main_memory",
  topic: "topic_note",
  daily: "daily_note",
  backlog: "backlog_note",
};

const MEMORY_FILE_GROUP_BY_KIND: Record<CanonicalMemoryFileKind, CanonicalMemoryFileGroup> = {
  agent_instructions: "agent",
  agent_tools: "agent",
  agent_heartbeat: "agent",
  setup_bootstrap: "setup",
  identity: "identity",
  soul: "identity",
  preferences: "identity",
  main_memory: "memory",
  topic_note: "memory",
  daily_note: "memory",
  backlog_note: "memory",
};

const MEMORY_FILE_SORT_RANK: Record<CanonicalMemoryFileKind, number> = {
  agent_instructions: 10,
  agent_tools: 20,
  agent_heartbeat: 30,
  setup_bootstrap: 40,
  identity: 50,
  soul: 60,
  preferences: 70,
  main_memory: 80,
  topic_note: 90,
  daily_note: 100,
  backlog_note: 110,
};

const DAILY_MEMORY_NOTE_RE = /(^|\/)\d{4}-\d{2}-\d{2}\.md$/i;

function normalizeTaxonomyEntry(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeTaxonomyList(value: readonly unknown[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = new Set<string>();
  for (const entry of value) {
    const cleaned = normalizeTaxonomyEntry(entry);
    if (cleaned) {
      normalized.add(cleaned);
    }
  }
  return Array.from(normalized);
}

function normalizeDateStamp(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export function normalizeMemoryFileName(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

export function isLongTermMemoryFileName(name: string): boolean {
  return normalizeMemoryFileName(name) === PRIMARY_MEMORY_FILE_NAME;
}

export function isMemoryNoteFileName(name: string): boolean {
  const normalized = normalizeMemoryFileName(name);
  return (
    normalized.startsWith(`${MANUAL_MEMORY_NOTES_DIR}/`) && normalized.toLowerCase().endsWith(".md")
  );
}

export function isDailyMemoryNoteFileName(name: string): boolean {
  return DAILY_MEMORY_NOTE_RE.test(normalizeMemoryFileName(name));
}

export function normalizeMemoryNoteRole(value: unknown): MemoryNoteRole | null {
  const normalized = normalizeTaxonomyEntry(value);
  if (
    normalized === "main" ||
    normalized === "topic" ||
    normalized === "daily" ||
    normalized === "backlog"
  ) {
    return normalized;
  }
  return null;
}

export function resolveCanonicalMemoryFileKind(name: string): CanonicalMemoryFileKind | null {
  const normalized = normalizeMemoryFileName(name);
  const rootKind = ROOT_FILE_KIND_BY_NAME[normalized];
  if (rootKind) {
    return rootKind;
  }
  if (!isMemoryNoteFileName(normalized)) {
    return null;
  }
  const noteRole = resolveMemoryNoteRole({ path: normalized });
  return MEMORY_NOTE_KIND_BY_ROLE[noteRole];
}

export function isCanonicalMemoryFileName(name: string): boolean {
  return resolveCanonicalMemoryFileKind(name) !== null;
}

export function getCanonicalMemoryFileGroup(
  kind: CanonicalMemoryFileKind,
): CanonicalMemoryFileGroup {
  return MEMORY_FILE_GROUP_BY_KIND[kind];
}

export function isCanonicalOperationalMemoryKind(kind: CanonicalMemoryFileKind): boolean {
  return kind === "topic_note" || kind === "daily_note" || kind === "backlog_note";
}

export function getCanonicalMemoryFileSortRank(kind: CanonicalMemoryFileKind): number {
  return MEMORY_FILE_SORT_RANK[kind];
}

export function slugifyMemoryNotePathComponent(value: string, fallback = "note"): string {
  const normalized = value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function buildCanonicalMemoryNotePath(params: {
  role: MemoryNoteRole;
  title?: string | null;
  slug?: string | null;
  dateStamp?: string | null;
}): string {
  const slugSource = params.slug?.trim() || params.title?.trim() || "note";
  const slug = slugifyMemoryNotePathComponent(slugSource);
  const dateStamp = normalizeDateStamp(params.dateStamp) ?? normalizeDateStamp(params.title);
  switch (params.role) {
    case "main":
      return PRIMARY_MEMORY_FILE_NAME;
    case "daily":
      return `${MANUAL_MEMORY_NOTES_DIR}/${dateStamp ?? slug}.md`;
    case "backlog":
      return dateStamp
        ? `${MEMORY_BACKLOG_NOTES_DIR}/${dateStamp}/${slug}.md`
        : `${MEMORY_BACKLOG_NOTES_DIR}/${slug}.md`;
    case "topic":
    default:
      return `${MANUAL_MEMORY_NOTES_DIR}/${slug}.md`;
  }
}

export function resolveMemoryNoteRole(params: {
  path?: string | null;
  memoryRole?: unknown;
  tags?: readonly unknown[] | null;
  collections?: readonly unknown[] | null;
}): MemoryNoteRole {
  const explicitRole = normalizeMemoryNoteRole(params.memoryRole);
  if (explicitRole) {
    return explicitRole;
  }
  const normalizedPath = normalizeMemoryFileName(params.path ?? "").toLowerCase();
  if (normalizedPath === PRIMARY_MEMORY_FILE_NAME.toLowerCase()) {
    return "main";
  }
  const tags = normalizeTaxonomyList(params.tags);
  const collections = normalizeTaxonomyList(params.collections);
  if (
    normalizedPath.startsWith(`${MEMORY_BACKLOG_NOTES_DIR}/`) ||
    normalizedPath.startsWith("backlog/") ||
    tags.includes("backlog") ||
    collections.includes("backlog")
  ) {
    return "backlog";
  }
  if (
    isDailyMemoryNoteFileName(normalizedPath) ||
    tags.includes("daily") ||
    collections.includes("daily")
  ) {
    return "daily";
  }
  return "topic";
}

export function getLongTermMemoryFilePriority(name: string): number {
  return isLongTermMemoryFileName(name) ? 0 : 1;
}

export function resolveManualMemoryNoteRoot(existingNames: Iterable<string> = []): string {
  void existingNames;
  return MANUAL_MEMORY_NOTES_DIR;
}
