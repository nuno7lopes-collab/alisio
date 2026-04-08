import type {
  ChannelAccountSnapshot,
  ChannelStatusIssue,
} from "alisio/plugin-sdk/channel-contract";
import {
  appendMatchMetadata,
  asString,
  isRecord,
  resolveEnabledConfiguredAccountId,
} from "alisio/plugin-sdk/status-helpers";
import { redactSensitiveText } from "alisio/plugin-sdk/text-runtime";

type DiscordIntentSummary = {
  messageContent?: "enabled" | "limited" | "disabled";
};

type DiscordApplicationSummary = {
  intents?: DiscordIntentSummary;
};

type DiscordAccountStatus = {
  accountId?: unknown;
  enabled?: unknown;
  configured?: unknown;
  running?: unknown;
  connected?: unknown;
  reconnectAttempts?: unknown;
  lastDisconnect?: unknown;
  lastError?: unknown;
  healthState?: unknown;
  application?: unknown;
  audit?: unknown;
};

type DiscordPermissionsAuditSummary = {
  unresolvedChannels?: number;
  channels?: Array<{
    channelId: string;
    ok?: boolean;
    missing?: string[];
    error?: string | null;
    matchKey?: string;
    matchSource?: string;
  }>;
};

function readDiscordAccountStatus(value: ChannelAccountSnapshot): DiscordAccountStatus | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    accountId: value.accountId,
    enabled: value.enabled,
    configured: value.configured,
    running: value.running,
    connected: value.connected,
    reconnectAttempts: value.reconnectAttempts,
    lastDisconnect: value.lastDisconnect,
    lastError: value.lastError,
    healthState: value.healthState,
    application: value.application,
    audit: value.audit,
  };
}

function readDiscordDisconnectStatus(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }
  return typeof value.status === "number" && Number.isFinite(value.status) ? value.status : null;
}

function readDiscordApplicationSummary(value: unknown): DiscordApplicationSummary {
  if (!isRecord(value)) {
    return {};
  }
  const intentsRaw = value.intents;
  if (!isRecord(intentsRaw)) {
    return {};
  }
  return {
    intents: {
      messageContent:
        intentsRaw.messageContent === "enabled" ||
        intentsRaw.messageContent === "limited" ||
        intentsRaw.messageContent === "disabled"
          ? intentsRaw.messageContent
          : undefined,
    },
  };
}

function readDiscordPermissionsAuditSummary(value: unknown): DiscordPermissionsAuditSummary {
  if (!isRecord(value)) {
    return {};
  }
  const unresolvedChannels =
    typeof value.unresolvedChannels === "number" && Number.isFinite(value.unresolvedChannels)
      ? value.unresolvedChannels
      : undefined;
  const channelsRaw = value.channels;
  const channels = Array.isArray(channelsRaw)
    ? (channelsRaw
        .map((entry) => {
          if (!isRecord(entry)) {
            return null;
          }
          const channelId = asString(entry.channelId);
          if (!channelId) {
            return null;
          }
          const ok = typeof entry.ok === "boolean" ? entry.ok : undefined;
          const missing = Array.isArray(entry.missing)
            ? entry.missing.map((v) => asString(v)).filter(Boolean)
            : undefined;
          const error = asString(entry.error) ?? null;
          const matchKey = asString(entry.matchKey) ?? undefined;
          const matchSource = asString(entry.matchSource) ?? undefined;
          return {
            channelId,
            ok,
            missing: missing?.length ? missing : undefined,
            error,
            matchKey,
            matchSource,
          };
        })
        .filter(Boolean) as DiscordPermissionsAuditSummary["channels"])
    : undefined;
  return { unresolvedChannels, channels };
}

export function collectDiscordStatusIssues(
  accounts: ChannelAccountSnapshot[],
): ChannelStatusIssue[] {
  const issues: ChannelStatusIssue[] = [];
  for (const entry of accounts) {
    const account = readDiscordAccountStatus(entry);
    if (!account) {
      continue;
    }
    const accountId = resolveEnabledConfiguredAccountId(account);
    if (!accountId) {
      continue;
    }

    const app = readDiscordApplicationSummary(account.application);
    const messageContent = app.intents?.messageContent;
    if (messageContent === "disabled") {
      issues.push({
        channel: "discord",
        accountId,
        kind: "intent",
        message: "Message Content Intent is disabled. Bot may not see normal channel messages.",
        fix: "Enable Message Content Intent in Discord Dev Portal → Bot → Privileged Gateway Intents, or require mention-only operation.",
      });
    }

    const running = account.running === true;
    const connected = account.connected === true;
    const reconnectAttempts =
      typeof account.reconnectAttempts === "number" && Number.isFinite(account.reconnectAttempts)
        ? account.reconnectAttempts
        : null;
    const lastErrorRaw = asString(account.lastError);
    const lastError = lastErrorRaw ? redactSensitiveText(lastErrorRaw) : null;
    const healthState = asString(account.healthState);
    const disconnectStatus = readDiscordDisconnectStatus(account.lastDisconnect);
    if (!connected && (running || reconnectAttempts !== null || lastError || disconnectStatus)) {
      const privilegedIntentsError =
        disconnectStatus === 4014 ||
        lastError?.toLowerCase().includes("privileged gateway intents") === true;
      const stateLabel =
        healthState === "reconnecting"
          ? "Discord gateway reconnecting"
          : healthState === "stopped"
            ? "Discord gateway stopped"
            : "Discord gateway disconnected";
      issues.push({
        channel: "discord",
        accountId,
        kind: "runtime",
        message: `${stateLabel}${reconnectAttempts != null ? ` (reconnectAttempts=${reconnectAttempts})` : ""}${lastError ? `: ${lastError}` : "."}`,
        fix: privilegedIntentsError
          ? "Enable the required privileged gateway intents in the Discord Developer Portal, then rerun channels status --probe or restart the gateway."
          : "Check the Discord token, intents, and channel permissions, then rerun channels status --probe or restart the gateway.",
      });
    }

    const audit = readDiscordPermissionsAuditSummary(account.audit);
    if (audit.unresolvedChannels && audit.unresolvedChannels > 0) {
      issues.push({
        channel: "discord",
        accountId,
        kind: "config",
        message: `Some configured guild channels are not numeric IDs (unresolvedChannels=${audit.unresolvedChannels}). Permission audit can only check numeric channel IDs.`,
        fix: "Use numeric channel IDs as keys in channels.discord.guilds.*.channels (then rerun channels status --probe).",
      });
    }
    for (const channel of audit.channels ?? []) {
      if (channel.ok === true) {
        continue;
      }
      const missing = channel.missing?.length ? ` missing ${channel.missing.join(", ")}` : "";
      const error = channel.error ? `: ${channel.error}` : "";
      const baseMessage = `Channel ${channel.channelId} permission check failed.${missing}${error}`;
      issues.push({
        channel: "discord",
        accountId,
        kind: "permissions",
        message: appendMatchMetadata(baseMessage, {
          matchKey: channel.matchKey,
          matchSource: channel.matchSource,
        }),
        fix: "Ensure the bot role can view + send in this channel (and that channel overrides don't deny it).",
      });
    }
  }
  return issues;
}
