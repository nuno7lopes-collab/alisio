export const PRIMARY_MEMORY_FILE_NAME = "MEMORY.md";
export const MANUAL_MEMORY_NOTES_DIR = "memory";
export const MEMORY_BACKLOG_NOTES_DIR = `${MANUAL_MEMORY_NOTES_DIR}/backlog`;

export type MemoryNoteRole = "main" | "topic" | "daily" | "backlog";

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
