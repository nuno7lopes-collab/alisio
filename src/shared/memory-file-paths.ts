export const PRIMARY_MEMORY_FILE_NAME = "MEMORY.md";
export const LEGACY_MEMORY_FILE_NAME = "memory.md";
export const LEGACY_MEMORY_NOTES_DIR = "memory";
export const OBSIDIAN_MEMORY_TOOL_PREFIX = "obsidian";
export const OBSIDIAN_DAILY_NOTES_DIR = "daily";
export const OBSIDIAN_LONG_TERM_FILE_NAME = "long-term.md";

export function normalizeMemoryFileName(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

export function isLegacyLongTermMemoryFileName(name: string): boolean {
  const normalized = normalizeMemoryFileName(name);
  return normalized === PRIMARY_MEMORY_FILE_NAME || normalized === LEGACY_MEMORY_FILE_NAME;
}

export function isObsidianMemoryToolPath(name: string): boolean {
  const normalized = normalizeMemoryFileName(name);
  return (
    normalized.startsWith(`${OBSIDIAN_MEMORY_TOOL_PREFIX}/`) &&
    normalized.toLowerCase().endsWith(".md")
  );
}

export function isLongTermMemoryFileName(name: string): boolean {
  const normalized = normalizeMemoryFileName(name);
  if (isLegacyLongTermMemoryFileName(normalized)) {
    return true;
  }
  return (
    normalized.startsWith(`${OBSIDIAN_MEMORY_TOOL_PREFIX}/`) &&
    normalized.toLowerCase().endsWith(`/${OBSIDIAN_LONG_TERM_FILE_NAME}`)
  );
}

export function isMemoryNoteFileName(name: string): boolean {
  const normalized = normalizeMemoryFileName(name);
  if (
    normalized.startsWith(`${LEGACY_MEMORY_NOTES_DIR}/`) &&
    normalized.toLowerCase().endsWith(".md")
  ) {
    return true;
  }
  return isObsidianMemoryToolPath(normalized) && !isLongTermMemoryFileName(normalized);
}

export function getLongTermMemoryFilePriority(name: string): number {
  const normalized = normalizeMemoryFileName(name);
  if (
    normalized.startsWith(`${OBSIDIAN_MEMORY_TOOL_PREFIX}/`) &&
    normalized.toLowerCase().endsWith(`/${OBSIDIAN_LONG_TERM_FILE_NAME}`)
  ) {
    return 0;
  }
  if (normalized === PRIMARY_MEMORY_FILE_NAME) {
    return 1;
  }
  if (normalized === LEGACY_MEMORY_FILE_NAME) {
    return 2;
  }
  return 3;
}

function dirnamePosix(value: string): string {
  const segments = normalizeMemoryFileName(value).split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

function joinPosix(...parts: string[]): string {
  return parts
    .map((part) => normalizeMemoryFileName(part))
    .filter(Boolean)
    .join("/");
}

export function resolveManualMemoryNoteRoot(existingNames: Iterable<string> = []): string {
  const normalized = Array.from(existingNames, (entry) =>
    normalizeMemoryFileName(String(entry)),
  ).filter(Boolean);

  const obsidianNote = normalized.find(
    (name) => isMemoryNoteFileName(name) && name.startsWith(`${OBSIDIAN_MEMORY_TOOL_PREFIX}/`),
  );
  if (obsidianNote) {
    return dirnamePosix(obsidianNote);
  }

  const obsidianLongTerm = normalized.find(
    (name) => isLongTermMemoryFileName(name) && name.startsWith(`${OBSIDIAN_MEMORY_TOOL_PREFIX}/`),
  );
  if (obsidianLongTerm) {
    return joinPosix(dirnamePosix(obsidianLongTerm), OBSIDIAN_DAILY_NOTES_DIR);
  }

  const legacyNote = normalized.find((name) => isMemoryNoteFileName(name));
  if (legacyNote) {
    return dirnamePosix(legacyNote) || LEGACY_MEMORY_NOTES_DIR;
  }

  return LEGACY_MEMORY_NOTES_DIR;
}
