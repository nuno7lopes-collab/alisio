import { html, nothing } from "lit";
import {
  isToolCallContentType,
  isToolResultContentType,
  resolveToolBlockArgs,
  resolveToolUseId,
} from "../../../../src/chat/tool-content.js";
import { canonicalToolStreamMarkerKey } from "../../brand-compat.ts";
import { truncateText } from "../format.ts";
import { icons } from "../icons.ts";
import { formatToolDetail, resolveToolDisplay } from "../tool-display.ts";
import type { ToolCard } from "../types/chat-types.ts";
import { connectorBrandStyle, getConnectorBranding } from "../views/connector-branding.ts";
import { extractTextCached } from "./message-extract.ts";
import { isToolResultMessage } from "./message-normalizer.ts";
import { formatToolOutputForSidebar } from "./tool-helpers.ts";

type ToolTimelineEntry = {
  name: string;
  args?: unknown;
  text?: unknown;
  details?: unknown;
  toolCallId?: string;
  phase?: "start" | "update" | "result";
  isError?: boolean;
  meta?: string;
};

type ToolStateTone = "active" | "done" | "error";

type ToolState = {
  label: string;
  tone: ToolStateTone;
  icon: "loader" | "check" | "x";
};

const TOOL_CARD_VALUE_CHAR_LIMIT = 4_000;

type ConnectorAuthRequiredDetails = {
  status: "auth_required";
  connectorId: string;
  message?: string;
  reconnectRequired?: boolean;
};

function extractToolMessageMeta(message: unknown): {
  toolCallId?: string;
  phase?: "start" | "update" | "result";
  isError?: boolean;
  meta?: string;
} {
  const m = message as Record<string, unknown>;
  const toolCallId =
    (typeof m.toolCallId === "string" && m.toolCallId) ||
    (typeof m.toolUseId === "string" && m.toolUseId) ||
    (typeof m.tool_call_id === "string" && m.tool_call_id) ||
    (typeof m.tool_use_id === "string" && m.tool_use_id) ||
    undefined;
  const phase =
    m.toolPhase === "start" || m.toolPhase === "update" || m.toolPhase === "result"
      ? m.toolPhase
      : undefined;
  const meta = typeof m.toolMeta === "string" && m.toolMeta.trim() ? m.toolMeta.trim() : undefined;
  const preferredMarker = m[canonicalToolStreamMarkerKey];
  const marker =
    preferredMarker && typeof preferredMarker === "object"
      ? (preferredMarker as Record<string, unknown>)
      : undefined;
  const markerPhase =
    marker?.phase === "start" || marker?.phase === "update" || marker?.phase === "result"
      ? marker.phase
      : undefined;
  const markerMeta =
    typeof marker?.meta === "string" && marker.meta.trim() ? marker.meta.trim() : undefined;
  return {
    toolCallId,
    phase: markerPhase ?? phase,
    isError: Boolean(marker?.isError ?? m.toolError),
    meta: markerMeta ?? meta,
  };
}

const resolveToolBlockId = (item: Record<string, unknown>): string | undefined =>
  resolveToolUseId(item) ||
  (typeof item.call_id === "string" && item.call_id.trim()) ||
  (typeof item.callId === "string" && item.callId.trim()) ||
  (typeof item.toolCallId === "string" && item.toolCallId.trim()) ||
  (typeof item.tool_call_id === "string" && item.tool_call_id.trim()) ||
  undefined;

const extractStandaloneToolResultValue = (message: unknown): unknown => {
  const m = message as Record<string, unknown>;
  if ("toolOutput" in m) {
    return m.toolOutput;
  }
  if ("output" in m) {
    return m.output;
  }
  if ("result" in m) {
    return m.result;
  }
  if ("error" in m) {
    return m.error;
  }
  return extractTextCached(message) ?? undefined;
};

const extractStandaloneToolResultDetails = (message: unknown): unknown => {
  const m = message as Record<string, unknown>;
  if ("toolResultDetails" in m) {
    return m.toolResultDetails;
  }
  if ("details" in m) {
    return m.details;
  }
  const result = m.result;
  if (result && typeof result === "object" && "details" in (result as Record<string, unknown>)) {
    return (result as Record<string, unknown>).details;
  }
  return undefined;
};

const extractToolResultValue = (item: Record<string, unknown>): unknown => {
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  if (Array.isArray(item.content)) {
    const textParts = item.content
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const part = entry as Record<string, unknown>;
        return part.type === "text" && typeof part.text === "string" ? part.text : null;
      })
      .filter((value): value is string => typeof value === "string");
    if (textParts.length > 0) {
      return textParts.join("\n");
    }
    return item.content;
  }
  if ("output" in item) {
    return item.output;
  }
  if ("result" in item) {
    return item.result;
  }
  if ("error" in item) {
    return item.error;
  }
  return undefined;
};

const extractToolResultDetails = (item: Record<string, unknown>): unknown => {
  if ("details" in item) {
    return item.details;
  }
  if ("toolResultDetails" in item) {
    return item.toolResultDetails;
  }
  return undefined;
};

function readConnectorAuthRequiredDetails(value: unknown): ConnectorAuthRequiredDetails | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.status !== "auth_required") {
    return null;
  }
  const connectorId =
    typeof record.connectorId === "string" && record.connectorId.trim()
      ? record.connectorId.trim()
      : null;
  if (!connectorId) {
    return null;
  }
  return {
    status: "auth_required",
    connectorId,
    ...(typeof record.message === "string" && record.message.trim()
      ? { message: record.message.trim() }
      : {}),
    ...(typeof record.reconnectRequired === "boolean"
      ? { reconnectRequired: record.reconnectRequired }
      : {}),
  };
}

function humanizeConnectorId(connectorId: string): string {
  const words = connectorId.split("-").filter(Boolean);
  if (words.length === 0) {
    return connectorId;
  }
  return words
    .map((part) => {
      const normalized = part.toLowerCase();
      if (normalized === "gmail") {
        return "Gmail";
      }
      if (normalized === "github") {
        return "GitHub";
      }
      if (normalized === "youtube") {
        return "YouTube";
      }
      if (normalized === "google") {
        return "Google";
      }
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join(" ");
}

function resolveConnectorProviderLabel(connectorId: string): string {
  if (
    connectorId.startsWith("gmail-") ||
    connectorId.startsWith("google-") ||
    connectorId === "youtube"
  ) {
    return "Google";
  }
  if (connectorId === "github") {
    return "GitHub";
  }
  if (connectorId === "notion") {
    return "Notion";
  }
  if (connectorId === "vercel") {
    return "Vercel";
  }
  if (connectorId === "facebook" || connectorId === "instagram") {
    return "Meta";
  }
  return humanizeConnectorId(connectorId);
}

function renderConnectorAuthCallout(
  details: ConnectorAuthRequiredDetails,
  onBeginConnector?: (connectorId: string) => void,
) {
  const providerLabel = resolveConnectorProviderLabel(details.connectorId);
  const branding = getConnectorBranding(details.connectorId, providerLabel);
  return html`
    <div class="callout chat-tool-auth-callout" style=${connectorBrandStyle(branding)}>
      <div class="chat-tool-auth-callout__head">
        <span class="chat-tool-auth-callout__icon">
          <img src=${branding.logoUrl} alt="" loading="lazy" decoding="async" />
        </span>
        <div class="chat-tool-auth-callout__copy">
          <div class="chat-tool-auth-callout__title">
            ${humanizeConnectorId(details.connectorId)}
          </div>
          ${details.message
            ? html`<div class="chat-tool-auth-callout__text">${details.message}</div>`
            : nothing}
        </div>
      </div>
      ${onBeginConnector
        ? html`
            <div class="chat-tool-auth-callout__actions">
              <button
                class="btn btn--xs primary"
                type="button"
                @click=${(event: Event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onBeginConnector(details.connectorId);
                }}
              >
                ${details.reconnectRequired ? "Reconnect" : "Connect"} ${providerLabel}
              </button>
            </div>
          `
        : nothing}
    </div>
  `;
}

export function extractToolCards(message: unknown): ToolCard[] {
  const m = message as Record<string, unknown>;
  const content = normalizeContent(m.content);
  const cards: ToolCard[] = [];
  const messageMeta = extractToolMessageMeta(message);

  for (const item of content) {
    const isToolCall =
      isToolCallContentType(item.type) ||
      (typeof item.name === "string" && resolveToolBlockArgs(item) != null);
    if (isToolCall) {
      const toolCallId = resolveToolBlockId(item) ?? messageMeta.toolCallId;
      cards.push({
        kind: "call",
        name: (item.name as string) ?? "tool",
        args: coerceArgs(resolveToolBlockArgs(item)),
        toolCallId,
        phase: messageMeta.phase,
        isError: messageMeta.isError,
        meta: messageMeta.meta,
      });
    }
  }

  for (const item of content) {
    if (!isToolResultContentType(item.type)) {
      continue;
    }
    const text = extractToolResultValue(item);
    const name = typeof item.name === "string" ? item.name : "tool";
    const toolCallId = resolveToolBlockId(item) ?? messageMeta.toolCallId;
    cards.push({
      kind: "result",
      name,
      text,
      details: extractToolResultDetails(item),
      toolCallId,
      phase: messageMeta.phase,
      isError: messageMeta.isError,
      meta: messageMeta.meta,
    });
  }

  if (isToolResultMessage(message) && !cards.some((card) => card.kind === "result")) {
    const name =
      (typeof m.toolName === "string" && m.toolName) ||
      (typeof m.tool_name === "string" && m.tool_name) ||
      "tool";
    const text = extractStandaloneToolResultValue(message);
    cards.push({
      kind: "result",
      name,
      text,
      details: extractStandaloneToolResultDetails(message),
      toolCallId: messageMeta.toolCallId,
      phase: messageMeta.phase,
      isError: messageMeta.isError,
      meta: messageMeta.meta,
    });
  }

  return cards;
}

function mergeToolCards(cards: ToolCard[]): ToolTimelineEntry[] {
  const entries: ToolTimelineEntry[] = [];
  const pendingById = new Map<string, number>();
  const pendingByName = new Map<string, number[]>();

  const queuePendingName = (name: string, index: number) => {
    const list = pendingByName.get(name) ?? [];
    list.push(index);
    pendingByName.set(name, list);
  };

  const consumePendingName = (name: string): number | undefined => {
    const list = pendingByName.get(name);
    if (!list || list.length === 0) {
      return undefined;
    }
    const index = list.shift();
    if (!list.length) {
      pendingByName.delete(name);
    }
    return index;
  };

  for (const card of cards) {
    if (card.kind === "call") {
      const entry: ToolTimelineEntry = {
        name: card.name,
        args: card.args,
        toolCallId: card.toolCallId,
        phase: card.phase,
        isError: card.isError,
        meta: card.meta,
      };
      const index = entries.push(entry) - 1;
      if (card.toolCallId) {
        pendingById.set(card.toolCallId, index);
      } else {
        queuePendingName(card.name, index);
      }
      continue;
    }

    const matchedIndex =
      (card.toolCallId ? pendingById.get(card.toolCallId) : undefined) ??
      consumePendingName(card.name);
    if (matchedIndex == null) {
      entries.push({
        name: card.name,
        text: card.text,
        details: card.details,
        toolCallId: card.toolCallId,
        phase: card.phase,
        isError: card.isError,
        meta: card.meta,
      });
      continue;
    }

    const entry = entries[matchedIndex];
    entry.text = card.text ?? entry.text;
    entry.details = card.details ?? entry.details;
    entry.phase = card.phase ?? entry.phase;
    entry.isError = card.isError ?? entry.isError;
    entry.meta = card.meta ?? entry.meta;
  }

  return entries;
}

function resolveToolState(entry: ToolTimelineEntry): ToolState {
  const authRequired = readConnectorAuthRequiredDetails(entry.details);
  if (authRequired) {
    return {
      label: authRequired.reconnectRequired ? "Reconnect" : "Needs auth",
      tone: "error",
      icon: "x",
    };
  }
  const outputText = stringifyToolValue(entry.text);
  if (entry.phase === "start" || entry.phase === "update") {
    return { label: "Running", tone: "active", icon: "loader" };
  }
  if (entry.isError) {
    const rejected =
      typeof outputText === "string" &&
      (/\brejected\b/i.test(outputText) || /"status"\s*:\s*"rejected"/i.test(outputText));
    return { label: rejected ? "Rejected" : "Error", tone: "error", icon: "x" };
  }
  return { label: "Done", tone: "done", icon: "check" };
}

function stringifyToolValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function renderToolSection(label: string, value: string, tone: "input" | "output" | "error") {
  return html`
    <section class="chat-tool-card__section chat-tool-card__section--${tone}">
      <div class="chat-tool-card__section-label">${label}</div>
      <pre class="chat-tool-card__section-content mono"><code>${value}</code></pre>
    </section>
  `;
}

function formatToolSectionValue(value: unknown): {
  full: string | null;
  preview: string | null;
  truncated: boolean;
} {
  const full = stringifyToolValue(value);
  if (!full) {
    return { full: null, preview: null, truncated: false };
  }
  const shortened = truncateText(full, TOOL_CARD_VALUE_CHAR_LIMIT);
  if (!shortened.truncated) {
    return { full, preview: full, truncated: false };
  }
  return {
    full,
    preview: `${shortened.text}\n\n… truncated (${shortened.total} chars, showing first ${shortened.text.length}).`,
    truncated: true,
  };
}

function renderToolTimelineEntry(
  entry: ToolTimelineEntry,
  onOpenSidebar?: (content: string) => void,
  onBeginConnector?: (connectorId: string) => void,
) {
  const display = resolveToolDisplay({ name: entry.name, args: entry.args, meta: entry.meta });
  const detail = formatToolDetail(display);
  const input = formatToolSectionValue(entry.args);
  const output = formatToolSectionValue(entry.text);
  const state = resolveToolState(entry);
  const authRequired = readConnectorAuthRequiredDetails(entry.details);
  const openText = output.full ?? input.full;
  const canOpenSidebar = Boolean(onOpenSidebar && openText);
  // Keep tool cards collapsed by default; users can expand them manually if needed.
  const shouldOpen = false;
  const openSidebar = () => {
    if (!canOpenSidebar || !openText) {
      return;
    }
    onOpenSidebar?.(formatToolOutputForSidebar(openText));
  };

  return html`
    <details
      class="chat-tool-card chat-tool-card__details chat-tool-card__details--${state.tone}"
      ?open=${shouldOpen}
      @click=${(event: Event) => {
        if (!canOpenSidebar) {
          return;
        }
        const target = event.target as HTMLElement | null;
        if (
          target?.closest(".chat-tool-card__summary") ||
          target?.closest(".chat-tool-card__open") ||
          target?.closest(".chat-tool-card__section-content")
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openSidebar();
      }}
    >
      <summary class="chat-tool-card__summary">
        <span class="chat-tool-card__summary-left">
          <span class="chat-tool-card__chevron">${icons.chevronRight}</span>
          <span class="chat-tool-card__icon">${icons[display.icon]}</span>
          <span class="chat-tool-card__summary-copy">
            <span class="chat-tool-card__title">${display.label}</span>
            ${detail ? html`<span class="chat-tool-card__detail">${detail}</span>` : nothing}
          </span>
        </span>
        <span class="chat-tool-card__state chat-tool-card__state--${state.tone}">
          <span class="chat-tool-card__state-icon">${icons[state.icon]}</span>
          <span>${state.label}</span>
        </span>
      </summary>
      <div class="chat-tool-card__body">
        ${authRequired ? renderConnectorAuthCallout(authRequired, onBeginConnector) : nothing}
        ${input.preview ? renderToolSection("Input", input.preview, "input") : nothing}
        ${!authRequired && output.preview
          ? renderToolSection(
              state.tone === "error" ? "Error" : "Output",
              output.preview,
              state.tone === "error" ? "error" : "output",
            )
          : state.tone === "active"
            ? html` <div class="chat-tool-card__pending">Waiting for tool output.</div> `
            : nothing}
        ${canOpenSidebar
          ? html`
              <div class="chat-tool-card__footer">
                <button
                  class="btn btn--xs chat-tool-card__open"
                  type="button"
                  @click=${(event: Event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openSidebar();
                  }}
                >
                  ${output.full ? "Open full output" : "Open full input"}
                </button>
              </div>
            `
          : nothing}
      </div>
    </details>
  `;
}

export function renderToolCardSidebar(
  card: ToolCard,
  onOpenSidebar?: (content: string) => void,
  onBeginConnector?: (connectorId: string) => void,
) {
  const [entry] = mergeToolCards([card]);
  return renderToolTimelineEntry(entry, onOpenSidebar, onBeginConnector);
}

export function renderToolCardStack(
  toolCards: ToolCard[],
  onOpenSidebar?: (content: string) => void,
  onBeginConnector?: (connectorId: string) => void,
) {
  const entries = mergeToolCards(toolCards);
  if (entries.length === 0) {
    return nothing;
  }
  return html`
    <div class="chat-tool-stack">
      ${entries.map((entry) => renderToolTimelineEntry(entry, onOpenSidebar, onBeginConnector))}
    </div>
  `;
}

function normalizeContent(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(Boolean) as Array<Record<string, unknown>>;
}

function coerceArgs(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}
