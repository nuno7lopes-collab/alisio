import { createHash, randomUUID } from "node:crypto";

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function parseJsonRecord(value: string | undefined | null): Record<string, unknown> {
  if (!value?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseJsonValue<T>(value: string | undefined | null, fallback: T): T {
  if (!value?.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createEventId(prefix: string, seed?: string): string {
  return seed ? `${prefix}-${hashText(seed).slice(0, 20)}` : `${prefix}-${randomUUID()}`;
}

export function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "no") {
      return false;
    }
  }
  return undefined;
}

export function uniqueStrings(values: Iterable<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
