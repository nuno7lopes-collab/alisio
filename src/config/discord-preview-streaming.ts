export type StreamingMode = "off" | "partial" | "block" | "progress";
export type DiscordPreviewStreamMode = "off" | "partial" | "block";
export type TelegramPreviewStreamMode = "off" | "partial" | "block";
export type SlackLegacyDraftStreamMode = "replace" | "status_final" | "append";

function normalizeStreamingMode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function parseStreamingMode(value: unknown): StreamingMode | null {
  const normalized = normalizeStreamingMode(value);
  if (
    normalized === "off" ||
    normalized === "partial" ||
    normalized === "block" ||
    normalized === "progress"
  ) {
    return normalized;
  }
  return null;
}

export function parseDiscordPreviewStreamMode(value: unknown): DiscordPreviewStreamMode | null {
  const parsed = parseStreamingMode(value);
  if (!parsed) {
    return null;
  }
  return parsed === "progress" ? "partial" : parsed;
}

export function mapStreamingModeToSlackLegacyDraftStreamMode(mode: StreamingMode) {
  if (mode === "block") {
    return "append" as const;
  }
  if (mode === "progress") {
    return "status_final" as const;
  }
  return "replace" as const;
}

export function resolveTelegramPreviewStreamMode(
  params: {
    streaming?: unknown;
  } = {},
): TelegramPreviewStreamMode {
  const parsedStreaming = parseStreamingMode(params.streaming);
  if (parsedStreaming) {
    if (parsedStreaming === "progress") {
      return "partial";
    }
    return parsedStreaming;
  }
  return "partial";
}

export function resolveDiscordPreviewStreamMode(
  params: {
    streaming?: unknown;
  } = {},
): DiscordPreviewStreamMode {
  const parsedStreaming = parseDiscordPreviewStreamMode(params.streaming);
  if (parsedStreaming) {
    return parsedStreaming;
  }
  // Discord preview streaming edits can hit aggressive rate limits, especially
  // when multiple gateways or multiple bots share the same account/server. Keep
  // the default off unless the operator opts in explicitly.
  return "off";
}

export function resolveSlackStreamingMode(
  params: {
    streaming?: unknown;
  } = {},
): StreamingMode {
  const parsedStreaming = parseStreamingMode(params.streaming);
  if (parsedStreaming) {
    return parsedStreaming;
  }
  return "partial";
}

export function resolveSlackNativeStreaming(
  params: {
    nativeStreaming?: unknown;
    streaming?: unknown;
  } = {},
): boolean {
  if (typeof params.nativeStreaming === "boolean") {
    return params.nativeStreaming;
  }
  return true;
}
