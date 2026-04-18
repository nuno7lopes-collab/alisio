import { normalizeTextKey } from "./text.js";

const SESSION_HEADING_RE = /^##\s+(\d{2}:\d{2})(?::\d{2})?\s+UTC\b/i;
const MAX_ITEMS_PER_SECTION = 8;
const MAX_SECTION_LINES = 3;
const MAX_ITEM_CHARS = 240;

function isMetadataNoise(line: string): boolean {
  return (
    /^- \*\*(?:Captured At|Action|Session Key|Session ID|Source)\*\*:/i.test(line) ||
    /^#{1,6}\s+Conversation Summary\b/i.test(line) ||
    /^Current time:/i.test(line) ||
    line.startsWith("```") ||
    /^<!--.*-->$/.test(line)
  );
}

function normalizePromotedLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^(?:user|assistant|system):\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateItem(value: string, maxChars = MAX_ITEM_CHARS): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

function dedupeItems(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeTextKey(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(value);
  }
  return out;
}

function buildSessionItem(label: string | undefined, lines: readonly string[]): string | undefined {
  const cleaned = dedupeItems(lines).slice(0, MAX_SECTION_LINES);
  if (cleaned.length === 0) {
    return undefined;
  }
  const summary = cleaned.join(" / ");
  return truncateItem(label ? `**${label}** ${summary}` : summary);
}

function isGenericSummary(value: string): boolean {
  const normalized = normalizeTextKey(value);
  return (
    !normalized ||
    normalized === "session snapshot pending promotion" ||
    normalized === "no transcript summary was available for this session snapshot"
  );
}

export function extractPromotedItems(markdownBody: string): string[] {
  const lines = markdownBody.split(/\r?\n/);
  const sessionItems: string[] = [];
  const genericItems: string[] = [];
  let currentSessionLabel: string | undefined;
  let currentSessionLines: string[] = [];

  const flushSession = () => {
    const item = buildSessionItem(currentSessionLabel, currentSessionLines);
    if (item) {
      sessionItems.push(item);
    }
    currentSessionLabel = undefined;
    currentSessionLines = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const sessionMatch = SESSION_HEADING_RE.exec(trimmed);
    if (sessionMatch) {
      flushSession();
      currentSessionLabel = `${sessionMatch[1]} UTC`;
      continue;
    }
    if (!trimmed) {
      continue;
    }
    if (isMetadataNoise(trimmed)) {
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      flushSession();
      continue;
    }
    const cleaned = normalizePromotedLine(trimmed);
    if (!cleaned) {
      continue;
    }
    if (currentSessionLabel) {
      currentSessionLines.push(cleaned);
      continue;
    }
    genericItems.push(truncateItem(cleaned));
  }

  flushSession();
  return dedupeItems([...sessionItems, ...genericItems]).slice(0, MAX_ITEMS_PER_SECTION);
}

export function buildPromotionSummary(params: {
  summary?: string | null;
  items?: readonly string[];
  fallback?: string;
}): string {
  const summary = params.summary?.trim() ?? "";
  if (!isGenericSummary(summary)) {
    return truncateItem(summary);
  }
  for (const item of params.items ?? []) {
    const normalized = item.trim();
    if (!isGenericSummary(normalized)) {
      return truncateItem(normalized);
    }
  }
  const fallback = params.fallback?.trim() || "Promoted memory note.";
  return truncateItem(fallback);
}
