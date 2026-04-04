import { formatDurationHuman } from "../../../src/infra/format-time/format-duration.ts";
import { stripAssistantInternalScaffolding } from "../../../src/shared/text/assistant-visible-text.js";
import { i18n, t } from "../i18n/index.ts";

export { formatDurationHuman };

export function formatRelativeTimestamp(
  timestampMs: number | null | undefined,
  options?: { dateFallback?: boolean; timezone?: string; fallback?: string },
): string {
  const fallback = options?.fallback ?? t("common.na");
  if (timestampMs == null || !Number.isFinite(timestampMs)) {
    return fallback;
  }

  const locale = i18n.getLocale();
  const diffMs = timestampMs - Date.now();
  const absMs = Math.abs(diffMs);

  if (options?.dateFallback && absMs > 7 * 24 * 60 * 60 * 1000) {
    try {
      return new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        ...(options.timezone ? { timeZone: options.timezone } : {}),
      }).format(new Date(timestampMs));
    } catch {
      return fallback;
    }
  }

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (absMs < minute) {
    return formatter.format(0, "minute");
  }
  if (absMs < hour) {
    return formatter.format(Math.round(diffMs / minute), "minute");
  }
  if (absMs < 48 * hour) {
    return formatter.format(Math.round(diffMs / hour), "hour");
  }
  return formatter.format(Math.round(diffMs / day), "day");
}

export function formatMs(ms?: number | null): string {
  if (!ms && ms !== 0) {
    return t("common.na");
  }
  return new Date(ms).toLocaleString(i18n.getLocale());
}

export function formatList(values?: Array<string | null | undefined>): string {
  if (!values || values.length === 0) {
    return t("common.none");
  }
  return values.filter((v): v is string => Boolean(v && v.trim())).join(", ");
}

export function clampText(value: string, max = 120): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function truncateText(
  value: string,
  max: number,
): {
  text: string;
  truncated: boolean;
  total: number;
} {
  if (value.length <= max) {
    return { text: value, truncated: false, total: value.length };
  }
  return {
    text: value.slice(0, Math.max(0, max)),
    truncated: true,
    total: value.length,
  };
}

export function toNumber(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseList(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function stripThinkingTags(value: string): string {
  return stripAssistantInternalScaffolding(value);
}

export function formatCost(cost: number | null | undefined, fallback = "$0.00"): string {
  if (cost == null || !Number.isFinite(cost)) {
    return fallback;
  }
  if (cost === 0) {
    return "$0.00";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number | null | undefined, fallback = "0"): string {
  if (tokens == null || !Number.isFinite(tokens)) {
    return fallback;
  }
  if (tokens < 1000) {
    return String(Math.round(tokens));
  }
  if (tokens < 1_000_000) {
    const k = tokens / 1000;
    return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
  }
  const m = tokens / 1_000_000;
  return m < 10 ? `${m.toFixed(1)}M` : `${Math.round(m)}M`;
}

export function formatPercent(value: number | null | undefined, fallback = "—"): string {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }
  return `${(value * 100).toFixed(1)}%`;
}
