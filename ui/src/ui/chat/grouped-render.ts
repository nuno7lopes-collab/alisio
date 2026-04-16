import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import { getSafeLocalStorage } from "../../local-storage.ts";
import type { AssistantIdentity } from "../assistant-identity.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import { openExternalUrlSafe } from "../open-external-url.ts";
import { detectTextDirection } from "../text-direction.ts";
import type { TaskProposalDraft, TaskProposalRecord } from "../types.ts";
import type { ChatRunActivity, MessageGroup, ToolCard } from "../types/chat-types.ts";
import { agentLogoUrl } from "../views/agents-utils.ts";
import { isImageChatAttachmentMimeType } from "./attachment-support.ts";
import { renderCopyAsMarkdownButton } from "./copy-as-markdown.ts";
import {
  extractTextCached,
  extractThinkingSummaryText,
  extractThinkingSummary,
} from "./message-extract.ts";
import { isToolResultMessage, normalizeRoleForGrouping } from "./message-normalizer.ts";
import { isTtsSupported, speakText, stopTts, isTtsSpeaking } from "./speech.ts";
import { extractTaskProposalBlocks, findPersistedTaskProposal } from "./task-proposals.ts";
import { extractToolCards, renderToolCardStack } from "./tool-cards.ts";

const chatText = (key: string, params?: Record<string, string>) => t(`alisio.chat.${key}`, params);
const MESSAGE_COLLAPSE_CHAR_THRESHOLD = 1_400;
const MESSAGE_COLLAPSE_LINE_THRESHOLD = 16;
const MESSAGE_COLLAPSE_CODE_BLOCK_THRESHOLD = 900;
const CANVAS_ACTION_CHAR_THRESHOLD = 1_100;
const CANVAS_ACTION_LINE_THRESHOLD = 16;

type ImageBlock = {
  url: string;
  alt?: string;
};

type AttachmentBlock = {
  label: string;
  mimeType: string;
};

function extractImages(message: unknown): ImageBlock[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const images: ImageBlock[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;

      if (b.type === "image") {
        // Handle source object format (from sendChatMessage)
        const source = b.source as Record<string, unknown> | undefined;
        if (source?.type === "base64" && typeof source.data === "string") {
          const data = source.data;
          const mediaType = (source.media_type as string) || "image/png";
          // If data is already a data URL, use it directly
          const url = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
          images.push({ url });
        } else if (typeof b.url === "string") {
          images.push({ url: b.url });
        }
      } else if (b.type === "image_url") {
        // OpenAI format
        const imageUrl = b.image_url as Record<string, unknown> | undefined;
        if (typeof imageUrl?.url === "string") {
          images.push({ url: imageUrl.url });
        }
      }
    }
  }

  return images;
}

function extractAttachments(message: unknown): AttachmentBlock[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const attachments: AttachmentBlock[] = [];
  if (!Array.isArray(content)) {
    return attachments;
  }

  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const entry = block as Record<string, unknown>;
    if (entry.type !== "attachment") {
      continue;
    }
    const mimeType =
      typeof entry.mimeType === "string" && entry.mimeType.trim()
        ? entry.mimeType.trim()
        : "application/octet-stream";
    const fileName =
      typeof entry.fileName === "string" && entry.fileName.trim() ? entry.fileName.trim() : null;
    attachments.push({
      label: fileName ?? mimeType,
      mimeType,
    });
  }

  return attachments;
}

function resolveRunActivityLabel(activity: ChatRunActivity): string {
  switch (activity.phase) {
    case "tools":
      return chatText("runStatus.tools");
    case "writing":
      return chatText("runStatus.writing");
    case "finalizing":
      return chatText("runStatus.finalizing");
    case "thinking":
    default:
      return chatText("runStatus.thinking");
  }
}

function resolveRunActivityMeta(activity: ChatRunActivity): string | null {
  if (activity.phase === "tools" && activity.activeToolCount > 0) {
    return chatText("runStatus.activeTools", {
      count: String(activity.activeToolCount),
    });
  }
  if (activity.completedToolCount > 0) {
    return chatText("runStatus.completedTools", {
      count: String(activity.completedToolCount),
    });
  }
  return null;
}

function renderRunActivityChip(activity: ChatRunActivity) {
  const meta = resolveRunActivityMeta(activity);
  return html`
    <span class="chat-run-status__chip" data-phase=${activity.phase}>
      <span class="chat-run-status__icon" aria-hidden="true">${icons.loader}</span>
      <span class="chat-run-status__label">${resolveRunActivityLabel(activity)}</span>
      ${meta ? html`<span class="chat-run-status__meta">${meta}</span>` : nothing}
    </span>
  `;
}

export function renderRunStatusGroup(
  activity: ChatRunActivity,
  assistant?: AssistantIdentity,
  basePath?: string,
) {
  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant, basePath)}
      <div class="chat-group-messages">
        <div class="chat-run-status" role="status" aria-live="polite">
          ${renderRunActivityChip(activity)}
        </div>
      </div>
    </div>
  `;
}

export function renderStreamingGroup(
  text: string,
  startedAt: number,
  activity: ChatRunActivity | null,
  onOpenSidebar?: (content: string) => void,
  assistant?: AssistantIdentity,
  basePath?: string,
  sessionKey?: string,
) {
  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant, basePath)}
      <div class="chat-group-messages">
        ${renderGroupedMessage(
          {
            role: "assistant",
            content: [{ type: "text", text }],
            timestamp: startedAt,
          },
          { isStreaming: true, showReasoning: false, sessionKey: sessionKey ?? "" },
          onOpenSidebar,
        )}
        ${activity
          ? html`<div class="chat-group-footer chat-group-footer--active">
              ${renderRunActivityChip(activity)}
            </div>`
          : nothing}
      </div>
    </div>
  `;
}

export function renderMessageGroup(
  group: MessageGroup,
  opts: {
    onOpenSidebar?: (content: string) => void;
    showReasoning: boolean;
    showToolCalls?: boolean;
    onBeginConnector?: (connectorId: string) => void;
    assistantName?: string;
    assistantAvatar?: string | null;
    basePath?: string;
    contextWindow?: number | null;
    onDelete?: () => void;
    sessionKey: string;
    taskProposals?: readonly TaskProposalRecord[] | null;
    taskProposalBusy?: boolean;
    onSaveTaskProposal?: (proposal: TaskProposalDraft) => void;
    onResolveTaskProposal?: (
      proposal: TaskProposalDraft,
      decision: "approved" | "rejected",
    ) => void;
    onLaunchTaskProposal?: (
      proposal: TaskProposalDraft,
      persisted: TaskProposalRecord | null,
    ) => void;
    onOpenTaskSession?: (sessionKey: string) => void;
    onOpenTasks?: () => void;
  },
) {
  const normalizedRole = normalizeRoleForGrouping(group.role);
  const assistantName = opts.assistantName ?? "Assistant";
  const userLabel = group.senderLabel?.trim();
  const who =
    normalizedRole === "user"
      ? (userLabel ?? "You")
      : normalizedRole === "assistant"
        ? assistantName
        : normalizedRole === "tool"
          ? "Tool"
          : normalizedRole;
  const roleClass =
    normalizedRole === "user"
      ? "user"
      : normalizedRole === "assistant"
        ? "assistant"
        : normalizedRole === "tool"
          ? "tool"
          : "other";
  const timestamp = new Date(group.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const groupMarkdown = extractGroupDisplayMarkdown(group.messages, opts.sessionKey);
  const canCopyGroupMarkdown = Boolean(groupMarkdown);
  const canExpandGroup =
    normalizedRole === "assistant" &&
    Boolean(opts.onOpenSidebar && groupMarkdown && shouldOfferCanvas(groupMarkdown));

  // Aggregate usage/cost/model across all messages in the group
  const meta = extractGroupMeta(group, opts.contextWindow ?? null);

  return html`
    <div class="chat-group ${roleClass}">
      ${renderAvatar(
        group.role,
        {
          name: assistantName,
          avatar: opts.assistantAvatar ?? null,
        },
        opts.basePath,
      )}
      <div class="chat-group-messages">
        ${group.messages.map((item, index) =>
          renderGroupedMessage(
            item.message,
            {
              isStreaming: group.isStreaming && index === group.messages.length - 1,
              showReasoning: opts.showReasoning,
              showToolCalls: opts.showToolCalls ?? true,
              onBeginConnector: opts.onBeginConnector,
              sessionKey: opts.sessionKey,
              taskProposals: opts.taskProposals,
              taskProposalBusy: opts.taskProposalBusy,
              onSaveTaskProposal: opts.onSaveTaskProposal,
              onResolveTaskProposal: opts.onResolveTaskProposal,
              onLaunchTaskProposal: opts.onLaunchTaskProposal,
              onOpenTaskSession: opts.onOpenTaskSession,
              onOpenTasks: opts.onOpenTasks,
            },
            opts.onOpenSidebar,
          ),
        )}
        <div class="chat-group-footer">
          <span class="chat-sender-name">${who}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
          ${renderMessageMeta(meta)}
          ${canCopyGroupMarkdown ||
          canExpandGroup ||
          (normalizedRole === "assistant" && isTtsSupported()) ||
          Boolean(opts.onDelete)
            ? html`
                <span class="chat-group-footer-actions">
                  ${canCopyGroupMarkdown ? renderCopyAsMarkdownButton(groupMarkdown!) : nothing}
                  ${canExpandGroup ? renderExpandButton(groupMarkdown!, opts.onOpenSidebar!) : nothing}
                  ${normalizedRole === "assistant" && isTtsSupported()
                    ? renderTtsButton(group)
                    : nothing}
                  ${opts.onDelete
                    ? renderDeleteButton(opts.onDelete, normalizedRole === "user" ? "left" : "right")
                    : nothing}
                </span>
              `
            : nothing}
        </div>
      </div>
    </div>
  `;
}

// ── Per-message metadata (tokens, cost, model, context %) ──

type GroupMeta = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  model: string | null;
  contextPercent: number | null;
};

function extractGroupMeta(group: MessageGroup, contextWindow: number | null): GroupMeta | null {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let model: string | null = null;
  let hasUsage = false;

  for (const { message } of group.messages) {
    const m = message as Record<string, unknown>;
    if (m.role !== "assistant") {
      continue;
    }
    const usage = m.usage as Record<string, number> | undefined;
    if (usage) {
      hasUsage = true;
      input += usage.input ?? usage.inputTokens ?? 0;
      output += usage.output ?? usage.outputTokens ?? 0;
      cacheRead += usage.cacheRead ?? usage.cache_read_input_tokens ?? 0;
      cacheWrite += usage.cacheWrite ?? usage.cache_creation_input_tokens ?? 0;
    }
    const c = m.cost as Record<string, number> | undefined;
    if (c?.total) {
      cost += c.total;
    }
    if (typeof m.model === "string" && m.model !== "gateway-injected") {
      model = m.model;
    }
  }

  if (!hasUsage && !model) {
    return null;
  }

  const contextPercent =
    contextWindow && input > 0 ? Math.min(Math.round((input / contextWindow) * 100), 100) : null;

  return { input, output, cacheRead, cacheWrite, cost, model, contextPercent };
}

/** Compact token count formatter (e.g. 128000 → "128k"). */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

function renderMessageMeta(meta: GroupMeta | null) {
  if (!meta) {
    return nothing;
  }

  const parts: Array<ReturnType<typeof html>> = [];

  // Token counts: ↑input ↓output
  if (meta.input) {
    parts.push(html`<span class="msg-meta__tokens">↑${fmtTokens(meta.input)}</span>`);
  }
  if (meta.output) {
    parts.push(html`<span class="msg-meta__tokens">↓${fmtTokens(meta.output)}</span>`);
  }

  // Cache: R/W
  if (meta.cacheRead) {
    parts.push(html`<span class="msg-meta__cache">R${fmtTokens(meta.cacheRead)}</span>`);
  }
  if (meta.cacheWrite) {
    parts.push(html`<span class="msg-meta__cache">W${fmtTokens(meta.cacheWrite)}</span>`);
  }

  // Cost
  if (meta.cost > 0) {
    parts.push(html`<span class="msg-meta__cost">$${meta.cost.toFixed(4)}</span>`);
  }

  // Context %
  if (meta.contextPercent !== null) {
    const pct = meta.contextPercent;
    const cls =
      pct >= 90
        ? "msg-meta__ctx msg-meta__ctx--danger"
        : pct >= 75
          ? "msg-meta__ctx msg-meta__ctx--warn"
          : "msg-meta__ctx";
    parts.push(html`<span class="${cls}">${pct}% ctx</span>`);
  }

  // Model
  if (meta.model) {
    // Shorten model name: strip provider prefix if present (e.g. "anthropic/claude-3.5-sonnet" → "claude-3.5-sonnet")
    const shortModel = meta.model.includes("/") ? meta.model.split("/").pop()! : meta.model;
    parts.push(html`<span class="msg-meta__model">${shortModel}</span>`);
  }

  if (parts.length === 0) {
    return nothing;
  }

  return html`<span class="msg-meta">${parts}</span>`;
}

function extractGroupText(group: MessageGroup): string {
  const parts: string[] = [];
  for (const { message } of group.messages) {
    const text = extractTextCached(message);
    if (text?.trim()) {
      parts.push(text.trim());
    }
  }
  return parts.join("\n\n");
}

function extractMessageDisplayMarkdown(message: unknown, sessionKey: string): string | null {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "";
  const extractedText = extractTextCached(message);
  const markdownBase = extractedText?.trim() ? extractedText : null;
  if (!markdownBase) {
    return null;
  }
  if (role !== "assistant") {
    return markdownBase;
  }
  const taskProposalBlock = extractTaskProposalBlocks({
    markdown: markdownBase,
    requesterSessionKey: sessionKey,
    message,
  });
  const markdown = taskProposalBlock.cleanedMarkdown?.trim() ? taskProposalBlock.cleanedMarkdown : null;
  return markdown;
}

function extractGroupDisplayMarkdown(
  messages: Array<{ message: unknown; key: string }>,
  sessionKey: string,
): string | null {
  const parts = messages
    .map((entry) => extractMessageDisplayMarkdown(entry.message, sessionKey))
    .filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join("\n\n") : null;
}

const SKIP_DELETE_CONFIRM_KEY = "alisio:skipDeleteConfirm";

type DeleteConfirmSide = "left" | "right";

function shouldSkipDeleteConfirm(): boolean {
  try {
    const storage = getSafeLocalStorage();
    if (!storage) {
      return false;
    }
    if (storage.getItem(SKIP_DELETE_CONFIRM_KEY) === "1") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function renderDeleteButton(onDelete: () => void, side: DeleteConfirmSide) {
  return html`
    <span class="chat-delete-wrap">
      <button
        class="chat-group-delete"
        title=${chatText("actions.delete")}
        aria-label=${chatText("actions.deleteMessage")}
        @click=${(e: Event) => {
          if (shouldSkipDeleteConfirm()) {
            onDelete();
            return;
          }
          const btn = e.currentTarget as HTMLElement;
          const wrap = btn.closest(".chat-delete-wrap") as HTMLElement;
          const existing = wrap?.querySelector(".chat-delete-confirm");
          if (existing) {
            existing.remove();
            return;
          }
          const popover = document.createElement("div");
          popover.className = `chat-delete-confirm chat-delete-confirm--${side}`;
          popover.innerHTML = `
            <p class="chat-delete-confirm__text">${chatText("actions.deleteConfirm")}</p>
            <label class="chat-delete-confirm__remember">
              <input type="checkbox" class="chat-delete-confirm__check" />
              <span>${chatText("actions.skipDeleteConfirm")}</span>
            </label>
            <div class="chat-delete-confirm__actions">
              <button class="chat-delete-confirm__cancel" type="button">${chatText("actions.cancel")}</button>
              <button class="chat-delete-confirm__yes" type="button">${chatText("actions.delete")}</button>
            </div>
          `;
          wrap.appendChild(popover);

          const cancel = popover.querySelector(".chat-delete-confirm__cancel")!;
          const yes = popover.querySelector(".chat-delete-confirm__yes")!;
          const check = popover.querySelector(".chat-delete-confirm__check") as HTMLInputElement;

          let closeOnOutside: ((evt: MouseEvent) => void) | null = null;
          const cleanup = () => {
            popover.remove();
            if (closeOnOutside) {
              document.removeEventListener("click", closeOnOutside, true);
              closeOnOutside = null;
            }
          };

          cancel.addEventListener("click", cleanup);
          yes.addEventListener("click", () => {
            if (check.checked) {
              try {
                getSafeLocalStorage()?.setItem(SKIP_DELETE_CONFIRM_KEY, "1");
              } catch {}
            }
            cleanup();
            onDelete();
          });

          // Close on click outside
          closeOnOutside = (evt: MouseEvent) => {
            if (!popover.contains(evt.target as Node) && evt.target !== btn) {
              cleanup();
            }
          };
          requestAnimationFrame(() => {
            if (closeOnOutside) {
              document.addEventListener("click", closeOnOutside, true);
            }
          });
        }}
      >
        ${icons.trash ?? icons.x}
      </button>
    </span>
  `;
}

function renderTtsButton(group: MessageGroup) {
  return html`
    <button
      class="btn btn--xs chat-tts-btn"
      type="button"
      title=${isTtsSpeaking() ? chatText("actions.stopSpeaking") : chatText("actions.readAloud")}
      aria-label=${isTtsSpeaking()
        ? chatText("actions.stopSpeaking")
        : chatText("actions.readAloud")}
      @click=${(e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement;
        if (isTtsSpeaking()) {
          stopTts();
          btn.classList.remove("chat-tts-btn--active");
          btn.title = chatText("actions.readAloud");
          return;
        }
        const text = extractGroupText(group);
        if (!text) {
          return;
        }
        btn.classList.add("chat-tts-btn--active");
        btn.title = chatText("actions.stopSpeaking");
        speakText(text, {
          onEnd: () => {
            if (btn.isConnected) {
              btn.classList.remove("chat-tts-btn--active");
              btn.title = chatText("actions.readAloud");
            }
          },
          onError: () => {
            if (btn.isConnected) {
              btn.classList.remove("chat-tts-btn--active");
              btn.title = chatText("actions.readAloud");
            }
          },
        });
      }}
    >
      ${icons.volume2}
    </button>
  `;
}

function renderAvatar(
  role: string,
  assistant?: Pick<AssistantIdentity, "name" | "avatar">,
  basePath?: string,
) {
  const normalized = normalizeRoleForGrouping(role);
  const assistantName = assistant?.name?.trim() || "Assistant";
  const assistantAvatar = assistant?.avatar?.trim() || "";
  const initial =
    normalized === "user"
      ? html`
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <circle cx="12" cy="8" r="4" />
            <path d="M20 21a8 8 0 1 0-16 0" />
          </svg>
        `
      : normalized === "assistant"
        ? html`
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M12 2l2.4 7.2H22l-6 4.8 2.4 7.2L12 16l-6.4 5.2L8 14 2 9.2h7.6z" />
            </svg>
          `
        : normalized === "tool"
          ? html`
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path
                  d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53a7.76 7.76 0 0 0 .07-1 7.76 7.76 0 0 0-.07-.97l2.11-1.63a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.15 7.15 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65a7.15 7.15 0 0 0-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64L4.57 11a7.9 7.9 0 0 0 0 1.94l-2.11 1.69a.49.49 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.72 1.69.98l.38 2.65c.05.24.26.42.49.42h4c.23 0 .44-.18.49-.42l.38-2.65a7.15 7.15 0 0 0 1.69-.98l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.49.49 0 0 0-.12-.64z"
                />
              </svg>
            `
          : html`
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <circle cx="12" cy="12" r="10" />
                <text
                  x="12"
                  y="16.5"
                  text-anchor="middle"
                  font-size="14"
                  font-weight="600"
                  fill="var(--bg, #fff)"
                >
                  ?
                </text>
              </svg>
            `;
  const className =
    normalized === "user"
      ? "user"
      : normalized === "assistant"
        ? "assistant"
        : normalized === "tool"
          ? "tool"
          : "other";

  if (assistantAvatar && normalized === "assistant") {
    if (isAvatarUrl(assistantAvatar)) {
      return html`<img
        class="chat-avatar ${className}"
        src="${assistantAvatar}"
        alt="${assistantName}"
      />`;
    }
    return html`<img
      class="chat-avatar ${className} chat-avatar--logo"
      src="${agentLogoUrl(basePath ?? "")}"
      alt="${assistantName}"
    />`;
  }

  if (normalized === "assistant") {
    const logoUrl = agentLogoUrl(basePath ?? "");
    return html`<img
      class="chat-avatar ${className} chat-avatar--logo"
      src="${logoUrl}"
      alt="${assistantName}"
    />`;
  }

  return html`<div class="chat-avatar ${className}">${initial}</div>`;
}

function isAvatarUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/") // Relative paths from avatar endpoint
  );
}

function renderMessageImages(images: ImageBlock[]) {
  if (images.length === 0) {
    return nothing;
  }

  const openImage = (url: string) => {
    openExternalUrlSafe(url, { allowDataImage: true });
  };

  return html`
    <div class="chat-message-images">
      ${images.map(
        (img) => html`
          <img
            src=${img.url}
            alt=${img.alt ?? "Attached image"}
            class="chat-message-image"
            @click=${() => openImage(img.url)}
          />
        `,
      )}
    </div>
  `;
}

function renderMessageAttachments(attachments: AttachmentBlock[]) {
  if (attachments.length === 0) {
    return nothing;
  }
  return html`
    <div class="chat-attachments-preview chat-message-attachments alisio-chat__attachments">
      ${attachments.map((attachment) => {
        const isImage = isImageChatAttachmentMimeType(attachment.mimeType);
        const isAudio = attachment.mimeType.startsWith("audio/");
        const icon = isImage ? icons.image : isAudio ? icons.radio : icons.fileText;
        return html`
          <div class="alisio-chat__attachment-pill">
            <span class="alisio-chat__attachment-pill-media" aria-hidden="true">${icon}</span>
            <span class="alisio-chat__attachment-pill-label" title=${attachment.label}>
              ${attachment.label}
            </span>
          </div>
        `;
      })}
    </div>
  `;
}

/** Render tool cards inside a collapsed `<details>` element. */
function renderToolCards(
  toolCards: ToolCard[],
  onOpenSidebar?: (content: string) => void,
  onBeginConnector?: (connectorId: string) => void,
) {
  return renderToolCardStack(toolCards, onOpenSidebar, onBeginConnector);
}

/**
 * Max characters for auto-detecting and pretty-printing JSON.
 * Prevents DoS from large JSON payloads in assistant/tool messages.
 */
const MAX_JSON_AUTOPARSE_CHARS = 20_000;

/**
 * Detect whether a trimmed string is a JSON object or array.
 * Must start with `{`/`[` and end with `}`/`]` and parse successfully.
 * Size-capped to prevent render-loop DoS from large JSON messages.
 */
function detectJson(text: string): { parsed: unknown; pretty: string } | null {
  const t = text.trim();

  // Enforce size cap to prevent UI freeze from multi-MB JSON payloads
  if (t.length > MAX_JSON_AUTOPARSE_CHARS) {
    return null;
  }

  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      const parsed = JSON.parse(t);
      return { parsed, pretty: JSON.stringify(parsed, null, 2) };
    } catch {
      return null;
    }
  }
  return null;
}

/** Build a short summary label for collapsed JSON (type + key count or array length). */
function jsonSummaryLabel(parsed: unknown): string {
  if (Array.isArray(parsed)) {
    return `Array (${parsed.length} item${parsed.length === 1 ? "" : "s"})`;
  }
  if (parsed && typeof parsed === "object") {
    const keys = Object.keys(parsed as Record<string, unknown>);
    if (keys.length <= 4) {
      return `{ ${keys.join(", ")} }`;
    }
    return `Object (${keys.length} keys)`;
  }
  return "JSON";
}

function renderExpandButton(markdown: string, onOpenSidebar: (content: string) => void) {
  return html`
    <button
      class="btn btn--xs chat-expand-btn"
      type="button"
      title=${chatText("actions.openInCanvas")}
      aria-label=${chatText("actions.openInCanvas")}
      @click=${() => onOpenSidebar(markdown)}
    >
      <span class="chat-expand-btn__icon" aria-hidden="true">${icons.panelRightOpen}</span>
    </button>
  `;
}

function countMeaningfulLines(markdown: string): number {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function shouldCollapseMessage(role: string, markdown: string): boolean {
  if (normalizeRoleForGrouping(role) !== "user") {
    return false;
  }
  const lineCount = countMeaningfulLines(markdown);
  if (lineCount >= MESSAGE_COLLAPSE_LINE_THRESHOLD) {
    return true;
  }
  if (markdown.length >= MESSAGE_COLLAPSE_CHAR_THRESHOLD) {
    return true;
  }
  return /```/.test(markdown) && markdown.length >= MESSAGE_COLLAPSE_CODE_BLOCK_THRESHOLD;
}

function shouldOfferCanvas(markdown: string): boolean {
  const lineCount = countMeaningfulLines(markdown);
  const hasStructuredLayout =
    /```|\|/.test(markdown) ||
    /(^|\n)\s*[-*]\s/.test(markdown) ||
    /(^|\n)\s*\d+\.\s/.test(markdown) ||
    /(^|\n)\s*>/.test(markdown);
  if (markdown.length >= CANVAS_ACTION_CHAR_THRESHOLD) {
    return true;
  }
  if (lineCount >= CANVAS_ACTION_LINE_THRESHOLD) {
    return true;
  }
  return hasStructuredLayout && (markdown.length >= 420 || lineCount >= 8);
}

function renderMarkdownMessage(role: string, markdown: string) {
  const messageBody = html`
    <div class="chat-text" dir="${detectTextDirection(markdown)}">
      ${unsafeHTML(toSanitizedMarkdownHtml(markdown))}
    </div>
  `;

  if (!shouldCollapseMessage(role, markdown)) {
    return messageBody;
  }

  return html`
    <details class="chat-message-collapse">
      <div class="chat-message-collapse__content">${messageBody}</div>
      <summary class="chat-message-collapse__toggle">
        <span class="chat-message-collapse__toggle-copy">
          <span class="chat-message-collapse__toggle-label chat-message-collapse__toggle-label--closed">
            ${chatText("actions.showMore")}
          </span>
          <span class="chat-message-collapse__toggle-label chat-message-collapse__toggle-label--open">
            ${chatText("actions.showLess")}
          </span>
        </span>
        <span class="chat-message-collapse__toggle-icon" aria-hidden="true">
          ${icons.chevronRight}
        </span>
      </summary>
    </details>
  `;
}

function renderThinkingPanel(message: unknown) {
  const thinkingSummary = extractThinkingSummary(message);
  if (!thinkingSummary) {
    return nothing;
  }

  if (thinkingSummary.source === "summary") {
    const extractedThinking = extractThinkingSummaryText(message);
    if (!extractedThinking) {
      return nothing;
    }
    return html`
      <details class="chat-thinking-collapse chat-thinking-panel">
        <summary class="chat-thinking-summary chat-thinking-panel__summary">
          <span class="chat-thinking-summary__lead">
            <span class="chat-thinking-summary__icon">${icons.brain}</span>
            <span class="chat-thinking-summary__copy">
              <span class="chat-thinking-summary__label">${chatText("thinkingPanel.label")}</span>
              <span class="chat-thinking-summary__meta">${chatText("thinkingPanel.summary")}</span>
            </span>
          </span>
          <span class="chat-thinking-summary__badges">
            <span class="chat-thinking-summary__badge">${chatText("thinkingPanel.summary")}</span>
            <span class="chat-thinking-summary__badge chat-thinking-summary__badge--done">
              ${chatText("thinkingPanel.done")}
            </span>
          </span>
          ${thinkingSummary.preview
            ? html`<span class="chat-thinking-summary__preview">${thinkingSummary.preview}</span>`
            : nothing}
        </summary>
        <div class="chat-thinking-body chat-text" dir="${detectTextDirection(extractedThinking)}">
          ${unsafeHTML(toSanitizedMarkdownHtml(extractedThinking))}
        </div>
      </details>
    `;
  }

  return html`
    <div class="chat-thinking-summary-card chat-thinking-panel chat-thinking-panel--hidden" role="note">
      <div class="chat-thinking-summary chat-thinking-summary--static">
        <span class="chat-thinking-summary__lead">
          <span class="chat-thinking-summary__icon">${icons.brain}</span>
          <span class="chat-thinking-summary__copy">
            <span class="chat-thinking-summary__label">${chatText("thinkingPanel.label")}</span>
            <span class="chat-thinking-summary__meta">${chatText("thinkingPanel.hidden")}</span>
          </span>
        </span>
        <span class="chat-thinking-summary__badges">
          <span class="chat-thinking-summary__badge">${chatText("thinkingPanel.hidden")}</span>
          <span class="chat-thinking-summary__badge chat-thinking-summary__badge--done">
            ${chatText("thinkingPanel.done")}
          </span>
        </span>
        <span class="chat-thinking-summary__preview">${chatText("thinkingPanel.hiddenPreview")}</span>
      </div>
    </div>
  `;
}

function renderGroupedMessage(
  message: unknown,
  opts: {
    isStreaming: boolean;
    showReasoning: boolean;
    showToolCalls?: boolean;
    onBeginConnector?: (connectorId: string) => void;
    sessionKey: string;
    taskProposals?: readonly TaskProposalRecord[] | null;
    taskProposalBusy?: boolean;
    onSaveTaskProposal?: (proposal: TaskProposalDraft) => void;
    onResolveTaskProposal?: (
      proposal: TaskProposalDraft,
      decision: "approved" | "rejected",
    ) => void;
    onLaunchTaskProposal?: (
      proposal: TaskProposalDraft,
      persisted: TaskProposalRecord | null,
    ) => void;
    onOpenTaskSession?: (sessionKey: string) => void;
    onOpenTasks?: () => void;
  },
  onOpenSidebar?: (content: string) => void,
) {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "unknown";
  const normalizedRole = normalizeRoleForGrouping(role);
  const isToolResult =
    isToolResultMessage(message) ||
    role.toLowerCase() === "toolresult" ||
    role.toLowerCase() === "tool_result" ||
    typeof m.toolCallId === "string" ||
    typeof m.tool_call_id === "string";

  const toolCards = (opts.showToolCalls ?? true) ? extractToolCards(message) : [];
  const hasToolCards = toolCards.length > 0;
  const images = extractImages(message);
  const hasImages = images.length > 0;
  const attachments = extractAttachments(message);
  const hasAttachments = attachments.length > 0;

  const extractedText = extractTextCached(message);
  const markdownBase = extractedText?.trim() ? extractedText : null;
  const taskProposalBlock =
    role === "assistant" && markdownBase
      ? extractTaskProposalBlocks({
          markdown: markdownBase,
          requesterSessionKey: opts.sessionKey,
          message,
        })
      : { cleanedMarkdown: markdownBase, proposals: [] };
  const markdown = taskProposalBlock.cleanedMarkdown;
  const taskProposalCards = taskProposalBlock.proposals.map((proposal) =>
    renderTaskProposalCard({
      proposal,
      persisted: findPersistedTaskProposal(opts.taskProposals, proposal),
      busy: Boolean(opts.taskProposalBusy),
      onSave: opts.onSaveTaskProposal,
      onResolve: opts.onResolveTaskProposal,
      onLaunch: opts.onLaunchTaskProposal,
      onOpenTaskSession: opts.onOpenTaskSession,
      onOpenTasks: opts.onOpenTasks,
    }),
  );
  const thinkingPanel =
    opts.showReasoning && role === "assistant" ? renderThinkingPanel(message) : nothing;

  // Detect pure-JSON messages and render as collapsible block
  const jsonResult = markdown && !opts.isStreaming ? detectJson(markdown) : null;
  const renderedMessageContent = jsonResult
    ? html`<details class="chat-json-collapse">
        <summary class="chat-json-summary">
          <span class="chat-json-badge">JSON</span>
          <span class="chat-json-label">${jsonSummaryLabel(jsonResult.parsed)}</span>
        </summary>
        <pre class="chat-json-content"><code>${jsonResult.pretty}</code></pre>
      </details>`
    : markdown
      ? renderMarkdownMessage(role, markdown)
      : nothing;

  if (!markdown && hasToolCards && isToolResult) {
    return renderToolCards(toolCards, onOpenSidebar, opts.onBeginConnector);
  }

  // Suppress empty bubbles when tool cards are the only content and toggle is off
  const visibleToolCards = hasToolCards && (opts.showToolCalls ?? true);
  if (
    !markdown &&
    !visibleToolCards &&
    !hasImages &&
    !hasAttachments &&
    taskProposalCards.length === 0
  ) {
    return nothing;
  }

  const isToolMessage = normalizedRole === "tool" || isToolResult;
  const bubbleClasses = ["chat-bubble", opts.isStreaming ? "streaming" : "", "fade-in"]
    .filter(Boolean)
    .join(" ");

  return html`
    <div class="${bubbleClasses}">
      ${isToolMessage
        ? html`
            <div class="chat-tool-msg-body chat-tool-msg-body--flat">
              ${renderMessageImages(images)} ${renderMessageAttachments(attachments)}
              ${thinkingPanel}
              ${hasToolCards ? nothing : renderedMessageContent}
              ${hasToolCards
                ? renderToolCardStack(toolCards, onOpenSidebar, opts.onBeginConnector)
                : nothing}
              ${taskProposalCards.length > 0
                ? html`<div style="display: grid; gap: 10px; margin-top: 12px;">
                    ${taskProposalCards}
                  </div>`
                : nothing}
            </div>
          `
        : html`
            ${renderMessageImages(images)} ${renderMessageAttachments(attachments)} ${thinkingPanel}
            ${renderedMessageContent}
            ${hasToolCards
              ? renderToolCardStack(toolCards, onOpenSidebar, opts.onBeginConnector)
              : nothing}
            ${taskProposalCards.length > 0
              ? html`<div style="display: grid; gap: 10px; margin-top: 12px;">
                  ${taskProposalCards}
                </div>`
              : nothing}
          `}
    </div>
  `;
}

function renderTaskProposalCard(params: {
  proposal: TaskProposalDraft;
  persisted: TaskProposalRecord | null;
  busy: boolean;
  onSave?: (proposal: TaskProposalDraft) => void;
  onResolve?: (proposal: TaskProposalDraft, decision: "approved" | "rejected") => void;
  onLaunch?: (proposal: TaskProposalDraft, persisted: TaskProposalRecord | null) => void;
  onOpenTaskSession?: (sessionKey: string) => void;
  onOpenTasks?: () => void;
}) {
  const proposal = params.proposal;
  const persisted = params.persisted;
  const launchedSessionKey = persisted?.launchedSessionKey?.trim() || null;
  const launchable = persisted?.decision === "approved" && !persisted.launchedRunId?.trim();
  const decisionLabel = persisted?.decision ?? "draft";
  const details = proposal.summary?.trim() || proposal.rationale?.trim() || proposal.title;

  return html`
    <div
      style="display: grid; gap: 10px; padding: 12px; border-radius: 14px; border: 1px solid var(--hairline, rgba(255,255,255,0.12)); background: color-mix(in srgb, var(--card-bg, rgba(255,255,255,0.04)) 88%, transparent);"
    >
      <div style="display: flex; justify-content: space-between; gap: 12px;">
        <div style="font-weight: 600;">${proposal.title}</div>
        <div class="muted">${decisionLabel}</div>
      </div>
      <div class="list-sub">${proposal.kind} proposal</div>
      <div>${details}</div>
      ${proposal.acceptance.length > 0
        ? html`
            <div class="list-sub">
              ${proposal.acceptance
                .slice(0, 3)
                .map(
                  (item, index) =>
                    html`${index > 0 ? html`<span> · </span>` : nothing}<span>${item}</span>`,
                )}
            </div>
          `
        : nothing}
      ${persisted?.linkedTask
        ? html`
            <div class="list-sub">
              Linked task: ${persisted.linkedTask.status} · ${persisted.linkedTask.runtime} ·
              ${persisted.linkedTask.taskId}
            </div>
          `
        : persisted?.launchedRunId?.trim()
          ? html`<div class="list-sub">Launched run: ${persisted.launchedRunId}</div>`
          : nothing}
      <div class="row" style="gap: 8px; flex-wrap: wrap;">
        ${!persisted && params.onSave
          ? html`
              <button
                class="btn"
                ?disabled=${params.busy}
                @click=${() => params.onSave?.(proposal)}
              >
                Save to inbox
              </button>
            `
          : nothing}
        ${(persisted?.decision ?? "pending") === "pending" && params.onResolve
          ? html`
              <button
                class="btn btn--primary"
                ?disabled=${params.busy}
                @click=${() => params.onResolve?.(proposal, "approved")}
              >
                Approve
              </button>
              <button
                class="btn"
                ?disabled=${params.busy}
                @click=${() => params.onResolve?.(proposal, "rejected")}
              >
                Reject
              </button>
            `
          : nothing}
        ${launchable && params.onLaunch
          ? html`
              <button
                class="btn btn--primary"
                ?disabled=${params.busy}
                @click=${() => params.onLaunch?.(proposal, persisted)}
              >
                Launch
              </button>
            `
          : nothing}
        ${launchedSessionKey && params.onOpenTaskSession
          ? html`
              <button
                class="btn"
                ?disabled=${params.busy}
                @click=${() => params.onOpenTaskSession?.(launchedSessionKey)}
              >
                Open launched chat
              </button>
            `
          : nothing}
        ${params.onOpenTasks
          ? html`
              <button class="btn" ?disabled=${params.busy} @click=${() => params.onOpenTasks?.()}>
                Open tasks
              </button>
            `
          : nothing}
      </div>
    </div>
  `;
}
