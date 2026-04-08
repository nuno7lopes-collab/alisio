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

type TelegramAccountStatus = {
  accountId?: unknown;
  enabled?: unknown;
  configured?: unknown;
  running?: unknown;
  connected?: unknown;
  reconnectAttempts?: unknown;
  lastError?: unknown;
  healthState?: unknown;
  lastDisconnect?: unknown;
  dmOnboardingState?: unknown;
  pendingPairingRequests?: unknown;
  allowUnmentionedGroups?: unknown;
  audit?: unknown;
};

type TelegramGroupMembershipAuditSummary = {
  unresolvedGroups?: number;
  hasWildcardUnmentionedGroups?: boolean;
  groups?: Array<{
    chatId: string;
    ok?: boolean;
    status?: string | null;
    error?: string | null;
    matchKey?: string;
    matchSource?: string;
  }>;
};

function readTelegramAccountStatus(value: ChannelAccountSnapshot): TelegramAccountStatus | null {
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
    lastError: value.lastError,
    healthState: value.healthState,
    lastDisconnect: value.lastDisconnect,
    dmOnboardingState: value.dmOnboardingState,
    pendingPairingRequests: value.pendingPairingRequests,
    allowUnmentionedGroups: value.allowUnmentionedGroups,
    audit: value.audit,
  };
}

function readTelegramDisconnectStatus(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }
  return typeof value.status === "number" && Number.isFinite(value.status) ? value.status : null;
}

function readTelegramGroupMembershipAuditSummary(
  value: unknown,
): TelegramGroupMembershipAuditSummary {
  if (!isRecord(value)) {
    return {};
  }
  const unresolvedGroups =
    typeof value.unresolvedGroups === "number" && Number.isFinite(value.unresolvedGroups)
      ? value.unresolvedGroups
      : undefined;
  const hasWildcardUnmentionedGroups =
    typeof value.hasWildcardUnmentionedGroups === "boolean"
      ? value.hasWildcardUnmentionedGroups
      : undefined;
  const groupsRaw = value.groups;
  const groups = Array.isArray(groupsRaw)
    ? (groupsRaw
        .map((entry) => {
          if (!isRecord(entry)) {
            return null;
          }
          const chatId = asString(entry.chatId);
          if (!chatId) {
            return null;
          }
          const ok = typeof entry.ok === "boolean" ? entry.ok : undefined;
          const status = asString(entry.status) ?? null;
          const error = asString(entry.error) ?? null;
          const matchKey = asString(entry.matchKey) ?? undefined;
          const matchSource = asString(entry.matchSource) ?? undefined;
          return { chatId, ok, status, error, matchKey, matchSource };
        })
        .filter(Boolean) as TelegramGroupMembershipAuditSummary["groups"])
    : undefined;
  return { unresolvedGroups, hasWildcardUnmentionedGroups, groups };
}

export function collectTelegramStatusIssues(
  accounts: ChannelAccountSnapshot[],
): ChannelStatusIssue[] {
  const issues: ChannelStatusIssue[] = [];
  for (const entry of accounts) {
    const account = readTelegramAccountStatus(entry);
    if (!account) {
      continue;
    }
    const accountId = resolveEnabledConfiguredAccountId(account);
    if (!accountId) {
      continue;
    }

    const dmOnboardingState =
      account.dmOnboardingState === "waiting_for_first_dm" ||
      account.dmOnboardingState === "pending_approval"
        ? account.dmOnboardingState
        : null;
    const pendingPairingRequests =
      typeof account.pendingPairingRequests === "number" &&
      Number.isFinite(account.pendingPairingRequests)
        ? account.pendingPairingRequests
        : 0;
    if (dmOnboardingState === "waiting_for_first_dm") {
      issues.push({
        channel: "telegram",
        accountId,
        kind: "intent",
        message: "Telegram token is configured, but your Telegram account is not linked yet.",
        fix: "Open Finish setup in Channels and use the Telegram setup link to approve your account automatically.",
      });
    }
    if (dmOnboardingState === "pending_approval") {
      const requestLabel =
        pendingPairingRequests === 1
          ? "1 pending Telegram DM approval request"
          : `${pendingPairingRequests} pending Telegram DM approval requests`;
      issues.push({
        channel: "telegram",
        accountId,
        kind: "intent",
        message: `${requestLabel} waiting for approval before the first conversation can start.`,
        fix: "Approve the detected Telegram request in Channels, or reopen Finish setup and use the Telegram setup link for your own account.",
      });
    }

    if (account.allowUnmentionedGroups === true) {
      issues.push({
        channel: "telegram",
        accountId,
        kind: "config",
        message:
          "Config allows unmentioned group messages (requireMention=false). Telegram Bot API privacy mode will block most group messages unless disabled.",
        fix: "In BotFather run /setprivacy → Disable for this bot (then restart the gateway).",
      });
    }

    const audit = readTelegramGroupMembershipAuditSummary(account.audit);
    if (audit.hasWildcardUnmentionedGroups === true) {
      issues.push({
        channel: "telegram",
        accountId,
        kind: "config",
        message:
          'Telegram groups config uses "*" with requireMention=false; membership probing is not possible without explicit group IDs.',
        fix: "Add explicit numeric group ids under channels.telegram.groups (or per-account groups) to enable probing.",
      });
    }
    if (audit.unresolvedGroups && audit.unresolvedGroups > 0) {
      issues.push({
        channel: "telegram",
        accountId,
        kind: "config",
        message: `Some configured Telegram groups are not numeric IDs (unresolvedGroups=${audit.unresolvedGroups}). Membership probe can only check numeric group IDs.`,
        fix: "Use numeric chat IDs (e.g. -100...) as keys in channels.telegram.groups for requireMention=false groups.",
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
    const disconnectStatus = readTelegramDisconnectStatus(account.lastDisconnect);
    const hasConflict =
      disconnectStatus === 409 ||
      lastError?.toLowerCase().includes("getupdates conflict") === true ||
      lastError?.toLowerCase().includes("other getupdates request") === true;
    if (healthState === "reconnecting" || healthState === "stopped" || (running && !connected)) {
      const stateLabel = hasConflict
        ? "Telegram polling conflict"
        : healthState === "reconnecting"
          ? "Telegram bot is reconnecting"
          : healthState === "stopped"
            ? "Telegram monitor stopped"
            : "Telegram bot is disconnected";
      issues.push({
        channel: "telegram",
        accountId,
        kind: "runtime",
        message: `${stateLabel}${reconnectAttempts != null ? ` (reconnectAttempts=${reconnectAttempts})` : ""}${lastError ? `: ${lastError}` : "."}`,
        fix: hasConflict
          ? "Stop the other polling or webhook consumer that is using this bot token, then restart the gateway."
          : "Check the Telegram token, proxy/network settings, and rerun channels status --probe. If it persists, restart the gateway.",
      });
    }
    for (const group of audit.groups ?? []) {
      if (group.ok === true) {
        continue;
      }
      const status = group.status ? ` status=${group.status}` : "";
      const err = group.error ? `: ${group.error}` : "";
      const baseMessage = `Group ${group.chatId} not reachable by bot.${status}${err}`;
      issues.push({
        channel: "telegram",
        accountId,
        kind: "runtime",
        message: appendMatchMetadata(baseMessage, {
          matchKey: group.matchKey,
          matchSource: group.matchSource,
        }),
        fix: "Invite the bot to the group, finish Telegram DM approval in Channels, and restart the gateway.",
      });
    }
  }
  return issues;
}
