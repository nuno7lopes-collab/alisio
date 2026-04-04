import { buildUsageHttpErrorSnapshot, fetchJson } from "./provider-usage.fetch.shared.js";
import { clampPercent, PROVIDER_LABELS } from "./provider-usage.shared.js";
import type { ProviderUsageSnapshot, UsageWindow } from "./provider-usage.types.js";

export type CodexUsageTelemetryWindow = {
  durationMinutes: number;
  usedPercent: number;
  resetAt?: number;
};

export type CodexUsageTelemetrySnapshot = {
  planType?: string;
  credits?: number;
  primaryWindow?: CodexUsageTelemetryWindow;
  secondaryWindow?: CodexUsageTelemetryWindow;
};

type CodexUsageResponse = {
  rate_limit?: {
    primary_window?: {
      limit_window_seconds?: number;
      used_percent?: number;
      reset_at?: number;
    };
    secondary_window?: {
      limit_window_seconds?: number;
      used_percent?: number;
      reset_at?: number;
    };
  };
  plan_type?: string;
  credits?: { balance?: number | string | null };
};

const WEEKLY_RESET_GAP_SECONDS = 3 * 24 * 60 * 60;

function resolveCreditsBalance(value: number | string | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeTelemetryWindow(window: {
  limit_window_seconds?: number;
  used_percent?: number;
  reset_at?: number;
}): CodexUsageTelemetryWindow {
  return {
    durationMinutes: Math.max(1, Math.round((window.limit_window_seconds || 0) / 60) || 0),
    usedPercent: clampPercent(window.used_percent || 0),
    ...(window.reset_at ? { resetAt: window.reset_at * 1000 } : {}),
  };
}

function resolveSecondaryWindowLabel(params: {
  windowHours: number;
  secondaryResetAt?: number;
  primaryResetAt?: number;
}): string {
  if (params.windowHours >= 168) {
    return "Week";
  }
  if (params.windowHours < 24) {
    return `${params.windowHours}h`;
  }
  // Codex occasionally reports a 24h secondary window while exposing a
  // weekly reset cadence in reset timestamps. Prefer cadence in that case.
  if (
    typeof params.secondaryResetAt === "number" &&
    typeof params.primaryResetAt === "number" &&
    params.secondaryResetAt - params.primaryResetAt >= WEEKLY_RESET_GAP_SECONDS
  ) {
    return "Week";
  }
  return "Day";
}

export async function fetchCodexUsageTelemetry(
  token: string,
  accountId: string | undefined,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<CodexUsageTelemetrySnapshot> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "CodexBar",
    Accept: "application/json",
  };
  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  const res = await fetchJson(
    "https://chatgpt.com/backend-api/wham/usage",
    { method: "GET", headers },
    timeoutMs,
    fetchFn,
  );

  if (!res.ok) {
    const errorSnapshot = buildUsageHttpErrorSnapshot({
      provider: "openai-codex",
      status: res.status,
      tokenExpiredStatuses: [401, 403],
    });
    throw new Error(errorSnapshot.error || `HTTP ${res.status}`);
  }

  const data = (await res.json()) as CodexUsageResponse;
  const credits = resolveCreditsBalance(data.credits?.balance);
  return {
    ...(typeof data.plan_type === "string" && data.plan_type.trim()
      ? { planType: data.plan_type.trim() }
      : {}),
    ...(credits !== undefined ? { credits } : {}),
    ...(data.rate_limit?.primary_window
      ? { primaryWindow: normalizeTelemetryWindow(data.rate_limit.primary_window) }
      : {}),
    ...(data.rate_limit?.secondary_window
      ? { secondaryWindow: normalizeTelemetryWindow(data.rate_limit.secondary_window) }
      : {}),
  };
}

export async function fetchCodexUsage(
  token: string,
  accountId: string | undefined,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<ProviderUsageSnapshot> {
  try {
    const telemetry = await fetchCodexUsageTelemetry(token, accountId, timeoutMs, fetchFn);
    const windows: UsageWindow[] = [];

    if (telemetry.primaryWindow) {
      const windowHours = Math.round(
        (telemetry.primaryWindow.durationMinutes * 60 || 10800) / 3600,
      );
      windows.push({
        label: `${windowHours}h`,
        usedPercent: telemetry.primaryWindow.usedPercent,
        resetAt: telemetry.primaryWindow.resetAt,
      });
    }

    if (telemetry.secondaryWindow) {
      const windowHours = Math.round(
        (telemetry.secondaryWindow.durationMinutes * 60 || 86400) / 3600,
      );
      const label = resolveSecondaryWindowLabel({
        windowHours,
        primaryResetAt:
          typeof telemetry.primaryWindow?.resetAt === "number"
            ? Math.round(telemetry.primaryWindow.resetAt / 1000)
            : undefined,
        secondaryResetAt:
          typeof telemetry.secondaryWindow.resetAt === "number"
            ? Math.round(telemetry.secondaryWindow.resetAt / 1000)
            : undefined,
      });
      windows.push({
        label,
        usedPercent: telemetry.secondaryWindow.usedPercent,
        resetAt: telemetry.secondaryWindow.resetAt,
      });
    }

    let plan = telemetry.planType;
    if (typeof telemetry.credits === "number") {
      plan = plan
        ? `${plan} ($${telemetry.credits.toFixed(2)})`
        : `$${telemetry.credits.toFixed(2)}`;
    }

    return {
      provider: "openai-codex",
      displayName: PROVIDER_LABELS["openai-codex"],
      windows,
      plan,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Token expired") {
      return buildUsageHttpErrorSnapshot({
        provider: "openai-codex",
        status: 401,
        tokenExpiredStatuses: [401, 403],
      });
    }
    return {
      provider: "openai-codex",
      displayName: PROVIDER_LABELS["openai-codex"],
      windows: [],
      error: message,
    };
  }
}
