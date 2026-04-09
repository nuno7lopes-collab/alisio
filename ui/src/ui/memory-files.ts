import {
  getLongTermMemoryFilePriority,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
  normalizeMemoryFileName,
  PRIMARY_MEMORY_FILE_NAME,
  resolveManualMemoryNoteRoot,
} from "../../../src/shared/memory-file-paths.js";

export {
  getLongTermMemoryFilePriority,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
  normalizeMemoryFileName,
  PRIMARY_MEMORY_FILE_NAME,
};

export function parseMemoryNoteFileName(name: string): {
  date: string | null;
  slug: string;
  basename: string;
} {
  const normalized = normalizeMemoryFileName(name);
  const basename = normalized.split("/").pop() ?? normalized;
  const stem = basename.replace(/\.md$/i, "");
  const match = /^(\d{4}-\d{2}-\d{2})(?:-(.+))?$/.exec(stem);
  return {
    date: match?.[1] ?? null,
    slug: match?.[2] ?? stem,
    basename,
  };
}

export function humanizeMemoryNoteTitle(name: string): string {
  const { date, slug, basename } = parseMemoryNoteFileName(name);
  if (!slug || slug === date) {
    return date ?? basename.replace(/\.md$/i, "");
  }
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function slugifyMemoryNoteTitle(value: string): string {
  return value
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function todayMemoryDate(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildMemoryNoteName(
  date: string,
  title: string,
  existingNames: Iterable<string> = [],
): string {
  const safeDate = isIsoDate(date) ? date : todayMemoryDate();
  const slug = slugifyMemoryNoteTitle(title);
  const baseName = slug ? `${safeDate}-${slug}` : safeDate;
  const used = new Set(Array.from(existingNames, (entry) => normalizeMemoryFileName(entry)));
  const root = resolveManualMemoryNoteRoot(existingNames);
  let candidate = `${root}/${baseName}.md`;
  if (!used.has(candidate)) {
    return candidate;
  }
  let index = 2;
  while (used.has(`${root}/${baseName}-${index}.md`)) {
    index += 1;
  }
  return `${root}/${baseName}-${index}.md`;
}
