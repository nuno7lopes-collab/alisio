import { parseAgentSessionKey } from "../../../../src/routing/session-key.js";
import { t } from "../../i18n/index.ts";
import {
  resolveAgentIdDisplayLabel,
  resolvePrimaryAssistantAgentId,
  type AgentDisplayOptions,
} from "./agent-display.ts";

const CHANNEL_LABELS: Record<string, string> = {
  bluebubbles: "iMessage",
  telegram: "Telegram",
  discord: "Discord",
  signal: "Signal",
  slack: "Slack",
  whatsapp: "WhatsApp",
  matrix: "Matrix",
  email: "Email",
  sms: "SMS",
};

const KNOWN_CHANNEL_KEYS = Object.keys(CHANNEL_LABELS);

export type SessionKeyInfo = {
  prefix: string;
  fallbackName: string;
};

export type SessionDisplayRow = {
  label?: string | null;
  displayName?: string | null;
  derivedTitle?: string | null;
  lastMessagePreview?: string | null;
  sessionId?: string | null;
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function channelLabel(channel: string): string {
  const normalized = channel.trim().toLowerCase();
  return CHANNEL_LABELS[normalized] ?? capitalize(channel.trim());
}

function isPrimarySessionAgent(agentId: string, options: AgentDisplayOptions): boolean {
  return agentId.trim().toLowerCase() === resolvePrimaryAssistantAgentId(options).toLowerCase();
}

function isDashboardSessionKey(key: string): boolean {
  return (parseAgentSessionKey(key)?.rest ?? "").startsWith("dashboard:");
}

function isSyntheticDashboardSessionCandidate(
  key: string,
  row: SessionDisplayRow | undefined,
  value: string,
): boolean {
  const trimmed = value.trim();
  if (!trimmed || !isDashboardSessionKey(key) || row?.label?.trim()) {
    return false;
  }
  const sessionIdPrefix = row?.sessionId?.trim().slice(0, 8);
  if (sessionIdPrefix) {
    const normalizedValue = trimmed.toLowerCase();
    const normalizedPrefix = sessionIdPrefix.toLowerCase();
    if (
      normalizedValue === normalizedPrefix ||
      new RegExp(`^${normalizedPrefix} \\(\\d{4}-\\d{2}-\\d{2}\\)$`, "i").test(normalizedValue)
    ) {
      return true;
    }
  }
  return /^[a-f0-9]{8}(?: \(\d{4}-\d{2}-\d{2}\))?$/i.test(trimmed);
}

export function parseSessionKey(key: string, options: AgentDisplayOptions = {}): SessionKeyInfo {
  const raw = key.trim();
  if (!raw) {
    return { prefix: "", fallbackName: "" };
  }
  const normalized = raw.toLowerCase();
  const parsed = parseAgentSessionKey(raw);

  if (raw === "main") {
    return { prefix: "", fallbackName: t("alisio.shell.sessions.main") };
  }
  if (parsed?.rest === "main") {
    if (isPrimarySessionAgent(parsed.agentId, options)) {
      return { prefix: "", fallbackName: t("alisio.shell.sessions.main") };
    }
    const agentLabel = resolveAgentIdDisplayLabel(parsed.agentId, options) ?? parsed.agentId;
    return {
      prefix: "",
      fallbackName: `${agentLabel} / ${t("alisio.shell.sessions.main")}`,
    };
  }
  if ((parsed?.rest ?? "").startsWith("dashboard:")) {
    return { prefix: "", fallbackName: t("chat.newConversation") };
  }
  if (normalized.includes(":subagent:") || (parsed?.rest ?? "").startsWith("subagent:")) {
    return {
      prefix: `${t("alisio.shell.sessions.subagentPrefix")}:`,
      fallbackName: `${t("alisio.shell.sessions.subagentPrefix")}:`,
    };
  }
  if (normalized.startsWith("cron:") || (parsed?.rest ?? "").startsWith("cron:")) {
    return {
      prefix: `${t("alisio.shell.sessions.cronPrefix")}:`,
      fallbackName: `${t("alisio.shell.sessions.cronJob")}:`,
    };
  }

  const directMatch = raw.match(/^agent:[^:]+:([^:]+):direct:(.+)$/i);
  if (directMatch) {
    return {
      prefix: "",
      fallbackName: `${channelLabel(directMatch[1])} · ${directMatch[2]}`,
    };
  }

  const groupMatch = raw.match(/^agent:[^:]+:([^:]+):group:(.+)$/i);
  if (groupMatch) {
    return {
      prefix: "",
      fallbackName: t("alisio.shell.sessions.channelGroup", {
        channel: channelLabel(groupMatch[1]),
      }),
    };
  }

  for (const channel of KNOWN_CHANNEL_KEYS) {
    if (normalized === channel || normalized.startsWith(`${channel}:`)) {
      return {
        prefix: "",
        fallbackName: t("alisio.shell.sessions.channelSession", {
          channel: channelLabel(channel),
        }),
      };
    }
  }

  return { prefix: "", fallbackName: raw };
}

export function resolveSessionDisplayName(
  key: string,
  row?: SessionDisplayRow,
  options: AgentDisplayOptions = {},
): string {
  const label = row?.label?.trim() || "";
  const displayName = row?.displayName?.trim() || "";
  const derivedTitle = row?.derivedTitle?.trim() || "";
  const { prefix, fallbackName } = parseSessionKey(key, options);

  const applyTypedPrefix = (value: string): string => {
    if (!prefix) {
      return value;
    }
    const prefixPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*`, "i");
    return prefixPattern.test(value) ? value : `${prefix} ${value}`;
  };

  if (label && label !== key) {
    return applyTypedPrefix(label);
  }
  if (
    displayName &&
    displayName !== key &&
    !isSyntheticDashboardSessionCandidate(key, row, displayName)
  ) {
    return applyTypedPrefix(displayName);
  }
  if (
    derivedTitle &&
    derivedTitle !== key &&
    !isSyntheticDashboardSessionCandidate(key, row, derivedTitle)
  ) {
    return applyTypedPrefix(derivedTitle);
  }
  return fallbackName;
}
