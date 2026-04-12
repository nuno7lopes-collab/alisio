export const PRIMARY_MEMORY_FILE_NAME = "MEMORY.md";
export const MANUAL_MEMORY_NOTES_DIR = "memory";

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

export function getLongTermMemoryFilePriority(name: string): number {
  return isLongTermMemoryFileName(name) ? 0 : 1;
}

export function resolveManualMemoryNoteRoot(existingNames: Iterable<string> = []): string {
  const normalized = Array.from(existingNames, (entry) =>
    normalizeMemoryFileName(String(entry)),
  ).filter(Boolean);

  const legacyNote = normalized.find((name) => isMemoryNoteFileName(name));
  if (legacyNote) {
    const segments = legacyNote.split("/").filter(Boolean);
    segments.pop();
    return segments.join("/") || MANUAL_MEMORY_NOTES_DIR;
  }

  return MANUAL_MEMORY_NOTES_DIR;
}
