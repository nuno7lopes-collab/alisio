import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { canonicalToolStreamMarkerKey } from "../../brand-compat.ts";
import { t } from "../../i18n/index.ts";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isImageChatAttachmentMimeType,
  isSupportedChatAttachmentFile,
} from "../chat/attachment-support.ts";
import { DeletedMessages } from "../chat/deleted-messages.ts";
import {
  renderMessageGroup,
  renderRunStatusGroup,
  renderStreamingGroup,
} from "../chat/grouped-render.ts";
import { InputHistory } from "../chat/input-history.ts";
import { normalizeMessage, normalizeRoleForGrouping } from "../chat/message-normalizer.ts";
import { PinnedMessages } from "../chat/pinned-messages.ts";
import { getPinnedMessageSummary } from "../chat/pinned-summary.ts";
import { messageMatchesSearchQuery } from "../chat/search-match.ts";
import { getOrCreateSessionCacheValue } from "../chat/session-cache.ts";
import {
  SLASH_COMMANDS,
  getSlashCommandCompletions,
  type SlashCommandCategory,
  type SlashCommandDef,
} from "../chat/slash-commands.ts";
import { isSttSupported, startStt, stopStt } from "../chat/speech.ts";
import type { BrowserPaneObserver, BrowserPaneSurfaceKind } from "../controllers/browser-pane.ts";
import type { ChatRuntimeSetupHint } from "../controllers/chat.ts";
import type { ExecApprovalAuditEntry, ExecApprovalRequest } from "../controllers/exec-approval.ts";
import type {
  SecurityAccessDiagnostics,
  SecurityAccessMode,
} from "../controllers/security-access.ts";
import { icons } from "../icons.ts";
import { detectTextDirection } from "../text-direction.ts";
import type {
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
  GatewaySessionRow,
  SessionsListResult,
  TaskProposalDraft,
  TaskProposalRecord,
} from "../types.ts";
import type { ChatItem, ChatRunActivity, MessageGroup } from "../types/chat-types.ts";
import type { ChatAttachment, ChatQueueItem } from "../ui-types.ts";
import { agentLogoUrl, resolveAgentAvatarUrl } from "./agents-utils.ts";
import { renderBrowserPane } from "./browser-pane.ts";
import { renderChatSecurityAccessStrip, renderChatSecurityQueue } from "./chat-security.ts";
import { connectorBrandStyle, getConnectorBranding } from "./connector-branding.ts";
import { buildConnectorRows, type ConnectorRow } from "./connector-state.ts";
import { renderSkeletonLines, renderSkeletonPill } from "./loading-skeleton.ts";
import "../components/resizable-divider.ts";

export type CompactionIndicatorStatus = {
  active: boolean;
  startedAt: number | null;
  completedAt: number | null;
};

export type FallbackIndicatorStatus = {
  phase?: "active" | "cleared";
  selected: string;
  active: string;
  previous?: string;
  reason?: string;
  attempts: string[];
  occurredAt: number;
};

export type ChatProps = {
  sessionKey: string;
  showThinking: boolean;
  showToolCalls: boolean;
  loading: boolean;
  sending: boolean;
  canAbort?: boolean;
  finalizing?: boolean;
  compactionStatus?: CompactionIndicatorStatus | null;
  fallbackStatus?: FallbackIndicatorStatus | null;
  messages: unknown[];
  toolMessages: unknown[];
  streamSegments: Array<{ text: string; ts: number }>;
  stream: string | null;
  streamStartedAt: number | null;
  assistantAvatarUrl?: string | null;
  draft: string;
  queue: ChatQueueItem[];
  connected: boolean;
  canSend: boolean;
  accessMode?: SecurityAccessMode | null;
  accessModeLoading?: boolean;
  accessModeBusy?: boolean;
  securityDiagnostics?: SecurityAccessDiagnostics | null;
  approvalQueue?: ExecApprovalRequest[];
  approvalAuditTrail?: ExecApprovalAuditEntry[];
  approvalBusy?: boolean;
  nativeShellLoading?: boolean;
  nativeShellError?: string | null;
  nativeShellState?: import("../types.ts").NativeShellState | null;
  taskProposals?: TaskProposalRecord[] | null;
  taskProposalBusy?: boolean;
  disabledReason: string | null;
  error: string | null;
  runtimeSetupHint?: ChatRuntimeSetupHint | null;
  sessions: SessionsListResult | null;
  focusMode: boolean;
  sidebarOpen?: boolean;
  sidebarContent?: string | null;
  sidebarError?: string | null;
  browserPaneSurfaceKind?: BrowserPaneSurfaceKind;
  browserPaneObserver?: BrowserPaneObserver | null;
  splitRatio?: number;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId?: string | null;
  attachments?: ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  showNewMessages?: boolean;
  onScrollToBottom?: () => void;
  onToggleFocusMode: () => void;
  onApplyAccessMode?: (mode: Exclude<SecurityAccessMode, "custom">) => void;
  onResolveApproval?: (
    entry: ExecApprovalRequest,
    decision: "allow-once" | "allow-always" | "deny",
  ) => void;
  onSaveTaskProposal?: (proposal: TaskProposalDraft) => void;
  onResolveTaskProposal?: (proposal: TaskProposalDraft, decision: "approved" | "rejected") => void;
  onLaunchTaskProposal?: (
    proposal: TaskProposalDraft,
    persisted: TaskProposalRecord | null,
  ) => void;
  onOpenTasks?: () => void;
  onOpenTaskSession?: (sessionKey: string) => void;
  onOpenNativeSettings?: () => void;
  getDraft?: () => string;
  onDraftChange: (next: string) => void;
  onOpenRuntimeSetup?: () => void;
  onBeginConnector?: (connectorId: string) => void;
  onRequestUpdate?: () => void;
  onSend: () => void;
  onAbort?: () => void;
  onQueueRemove: (id: string) => void;
  onOpenSidebar?: (content: string) => void;
  onCloseSidebar?: () => void;
  onSelectBrowserPaneSurface?: (surface: BrowserPaneSurfaceKind) => void;
  onSplitRatioChange?: (ratio: number) => void;
  onChatScroll?: (event: Event) => void;
  composerModelSelect?: TemplateResult | typeof nothing;
  basePath?: string;
  viewerDisplayName?: string | null;
  connectorCatalog?: AlisioConnectorDefinition[];
  connectorAuthorizations?: AlisioConnectorAuthorization[];
  onOpenAuthentications?: () => void;
};

const COMPACTION_TOAST_DURATION_MS = 5000;
const FALLBACK_TOAST_DURATION_MS = 8000;

const chatText = (key: string, params?: Record<string, string>) => t(`alisio.chat.${key}`, params);

function getSlashCategoryLabel(category: SlashCommandCategory): string {
  switch (category) {
    case "session":
      return chatText("slash.categories.session");
    case "model":
      return chatText("slash.categories.model");
    case "agents":
      return chatText("slash.categories.agents");
    case "tools":
      return chatText("slash.categories.tools");
  }
}

function getSlashCommandDescription(cmd: SlashCommandDef): string {
  switch (cmd.key) {
    case "clear":
      return chatText("slash.descriptions.clear");
    case "redirect":
      return chatText("slash.descriptions.redirect");
    default:
      return cmd.description;
  }
}

// Persistent instances keyed by session
const inputHistories = new Map<string, InputHistory>();
const pinnedMessagesMap = new Map<string, PinnedMessages>();
const deletedMessagesMap = new Map<string, DeletedMessages>();

function getInputHistory(sessionKey: string): InputHistory {
  return getOrCreateSessionCacheValue(inputHistories, sessionKey, () => new InputHistory());
}

function getPinnedMessages(sessionKey: string): PinnedMessages {
  return getOrCreateSessionCacheValue(
    pinnedMessagesMap,
    sessionKey,
    () => new PinnedMessages(sessionKey),
  );
}

function getDeletedMessages(sessionKey: string): DeletedMessages {
  return getOrCreateSessionCacheValue(
    deletedMessagesMap,
    sessionKey,
    () => new DeletedMessages(sessionKey),
  );
}

interface ChatEphemeralState {
  sttRecording: boolean;
  sttInterimText: string;
  sttStartedAt: number | null;
  composerNotice: string | null;
  slashMenuOpen: boolean;
  slashMenuItems: SlashCommandDef[];
  slashMenuIndex: number;
  slashMenuMode: "command" | "args";
  slashMenuCommand: SlashCommandDef | null;
  slashMenuArgItems: string[];
  searchOpen: boolean;
  searchQuery: string;
  pinnedExpanded: boolean;
}

function createChatEphemeralState(): ChatEphemeralState {
  return {
    sttRecording: false,
    sttInterimText: "",
    sttStartedAt: null,
    composerNotice: null,
    slashMenuOpen: false,
    slashMenuItems: [],
    slashMenuIndex: 0,
    slashMenuMode: "command",
    slashMenuCommand: null,
    slashMenuArgItems: [],
    searchOpen: false,
    searchQuery: "",
    pinnedExpanded: false,
  };
}

const vs = createChatEphemeralState();
let activeEphemeralSessionKey: string | null = null;
let sttTicker: ReturnType<typeof setInterval> | null = null;
let sttTickerRequestUpdate: (() => void) | null = null;

function stopSttTicker() {
  if (sttTicker !== null) {
    clearInterval(sttTicker);
    sttTicker = null;
  }
  sttTickerRequestUpdate = null;
}

function startSttTicker(requestUpdate: () => void) {
  sttTickerRequestUpdate = requestUpdate;
  if (sttTicker !== null) {
    return;
  }
  sttTicker = setInterval(() => {
    sttTickerRequestUpdate?.();
  }, 250);
}

function clearSttComposerState() {
  vs.sttRecording = false;
  vs.sttInterimText = "";
  vs.sttStartedAt = null;
  stopSttTicker();
}

/**
 * Reset chat view ephemeral state when navigating away.
 * Stops STT recording and clears search/slash UI that should not survive navigation.
 */
export function resetChatViewState() {
  if (vs.sttRecording) {
    stopStt();
  }
  clearSttComposerState();
  activeEphemeralSessionKey = null;
  Object.assign(vs, createChatEphemeralState());
}

export const cleanupChatModuleState = resetChatViewState;

function syncChatViewStateForSession(sessionKey: string) {
  if (activeEphemeralSessionKey === sessionKey) {
    return;
  }
  if (vs.sttRecording) {
    stopStt();
  }
  clearSttComposerState();
  activeEphemeralSessionKey = sessionKey;
  Object.assign(vs, createChatEphemeralState());
}

function adjustTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
}

function setComposerNotice(message: string | null) {
  vs.composerNotice = message?.trim() ? message : null;
}

function buildUnsupportedAttachmentsNotice(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return chatText("compose.unsupportedAttachments", { count: String(count) });
}

function formatRecordingElapsed(startedAt: number | null): string {
  if (!startedAt) {
    return "0:00";
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderCompactionIndicator(status: CompactionIndicatorStatus | null | undefined) {
  if (!status) {
    return nothing;
  }
  if (status.active) {
    return html`
      <div
        class="compaction-indicator compaction-indicator--active"
        role="status"
        aria-live="polite"
      >
        ${icons.loader} ${chatText("compaction.active")}
      </div>
    `;
  }
  if (status.completedAt) {
    const elapsed = Date.now() - status.completedAt;
    if (elapsed < COMPACTION_TOAST_DURATION_MS) {
      return html`
        <div
          class="compaction-indicator compaction-indicator--complete"
          role="status"
          aria-live="polite"
        >
          ${icons.check} ${chatText("compaction.complete")}
        </div>
      `;
    }
  }
  return nothing;
}

function renderFallbackIndicator(status: FallbackIndicatorStatus | null | undefined) {
  if (!status) {
    return nothing;
  }
  const phase = status.phase ?? "active";
  const elapsed = Date.now() - status.occurredAt;
  if (elapsed >= FALLBACK_TOAST_DURATION_MS) {
    return nothing;
  }
  const details = [
    chatText("fallback.selected", { value: status.selected }),
    phase === "cleared"
      ? chatText("fallback.active", { value: status.selected })
      : chatText("fallback.active", { value: status.active }),
    phase === "cleared" && status.previous
      ? chatText("fallback.previous", { value: status.previous })
      : null,
    status.reason ? chatText("fallback.reason", { value: status.reason }) : null,
    status.attempts.length > 0
      ? chatText("fallback.attempts", { value: status.attempts.slice(0, 3).join(" | ") })
      : null,
  ]
    .filter(Boolean)
    .join(" • ");
  const message =
    phase === "cleared"
      ? chatText("fallback.clearedMessage", { value: status.selected })
      : chatText("fallback.activeMessage", { value: status.active });
  const className =
    phase === "cleared"
      ? "compaction-indicator compaction-indicator--fallback-cleared"
      : "compaction-indicator compaction-indicator--fallback";
  const icon = phase === "cleared" ? icons.check : icons.brain;
  return html`
    <div class=${className} role="status" aria-live="polite" title=${details}>
      ${icon} ${message}
    </div>
  `;
}

/**
 * Compact notice when context usage reaches 85%+.
 * Progressively shifts from amber (85%) to red (90%+).
 */
/** Parse a 6-digit CSS hex color string to [r, g, b] integer components. */
function parseHexRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    return null;
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function getThemeNoticeColors() {
  const rootStyle = getComputedStyle(document.documentElement);
  const warnHex = rootStyle.getPropertyValue("--warn").trim() || "#f59e0b";
  const dangerHex = rootStyle.getPropertyValue("--danger").trim() || "#ef4444";
  return {
    warnHex,
    dangerHex,
    warnRgb: parseHexRgb(warnHex) ?? [245, 158, 11],
    dangerRgb: parseHexRgb(dangerHex) ?? [239, 68, 68],
  };
}

function renderContextNotice(
  session: GatewaySessionRow | undefined,
  defaultContextTokens: number | null,
  opts?: { hidden?: boolean },
) {
  if (opts?.hidden) {
    return nothing;
  }
  if (session?.totalTokensFresh === false) {
    return nothing;
  }
  const used = session?.totalTokens ?? 0;
  const limit = session?.contextTokens ?? defaultContextTokens ?? 0;
  if (!used || !limit) {
    return nothing;
  }
  const ratio = used / limit;
  if (ratio < 0.85) {
    return nothing;
  }
  const pct = Math.min(Math.round(ratio * 100), 100);
  // Read theme semantic tokens so color tracks the active theme (Dash, dark, light …)
  const { warnRgb, dangerRgb } = getThemeNoticeColors();
  const [wr, wg, wb] = warnRgb;
  const [dr, dg, db] = dangerRgb;
  // Blend from --warn at 85% usage to --danger at 95%+ usage
  const t = Math.min(Math.max((ratio - 0.85) / 0.1, 0), 1);
  const r = Math.round(wr + (dr - wr) * t);
  const g = Math.round(wg + (dg - wg) * t);
  const b = Math.round(wb + (db - wb) * t);
  const color = `rgb(${r}, ${g}, ${b})`;
  const bgOpacity = 0.08 + 0.08 * t;
  const bg = `rgba(${r}, ${g}, ${b}, ${bgOpacity})`;
  return html`
    <div class="context-notice" role="status" style="--ctx-color:${color};--ctx-bg:${bg}">
      <svg
        class="context-notice__icon"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span>${chatText("context.used", { pct: String(pct) })}</span>
      <span class="context-notice__detail">
        ${chatText("context.usage", {
          used: formatTokensCompact(used),
          limit: formatTokensCompact(limit),
        })}
      </span>
    </div>
  `;
}

/** Format token count compactly (e.g. 128000 → "128k"). */
function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function handlePaste(e: ClipboardEvent, props: ChatProps, requestUpdate: () => void) {
  const items = e.clipboardData?.items;
  if (!items || !props.onAttachmentsChange) {
    return;
  }
  const imageItems: DataTransferItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      imageItems.push(item);
    }
  }
  if (imageItems.length === 0) {
    return;
  }
  e.preventDefault();
  setComposerNotice(null);
  for (const item of imageItems) {
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = reader.result as string;
      const newAttachment: ChatAttachment = {
        id: generateAttachmentId(),
        dataUrl,
        mimeType: file.type,
        ...(file.name ? { fileName: file.name } : {}),
      };
      const current = props.attachments ?? [];
      props.onAttachmentsChange?.([...current, newAttachment]);
      requestUpdate();
    });
    reader.readAsDataURL(file);
  }
}

function handleFileSelect(e: Event, props: ChatProps, requestUpdate: () => void) {
  const input = e.target as HTMLInputElement;
  if (!input.files || !props.onAttachmentsChange) {
    return;
  }
  const current = props.attachments ?? [];
  const additions: ChatAttachment[] = [];
  let pending = 0;
  let unsupported = 0;
  for (const file of input.files) {
    if (!isSupportedChatAttachmentFile(file)) {
      unsupported++;
      continue;
    }
    pending++;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      additions.push({
        id: generateAttachmentId(),
        dataUrl: reader.result as string,
        mimeType: file.type,
        ...(file.name ? { fileName: file.name } : {}),
      });
      pending--;
      if (pending === 0) {
        props.onAttachmentsChange?.([...current, ...additions]);
        setComposerNotice(buildUnsupportedAttachmentsNotice(unsupported));
        requestUpdate();
      }
    });
    reader.readAsDataURL(file);
  }
  if (pending === 0) {
    setComposerNotice(buildUnsupportedAttachmentsNotice(unsupported));
    requestUpdate();
  }
  input.value = "";
}

function handleDrop(e: DragEvent, props: ChatProps, requestUpdate: () => void) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files || !props.onAttachmentsChange) {
    return;
  }
  const current = props.attachments ?? [];
  const additions: ChatAttachment[] = [];
  let pending = 0;
  let unsupported = 0;
  for (const file of files) {
    if (!isSupportedChatAttachmentFile(file)) {
      unsupported++;
      continue;
    }
    pending++;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      additions.push({
        id: generateAttachmentId(),
        dataUrl: reader.result as string,
        mimeType: file.type,
        ...(file.name ? { fileName: file.name } : {}),
      });
      pending--;
      if (pending === 0) {
        props.onAttachmentsChange?.([...current, ...additions]);
        setComposerNotice(buildUnsupportedAttachmentsNotice(unsupported));
        requestUpdate();
      }
    });
    reader.readAsDataURL(file);
  }
  if (pending === 0) {
    setComposerNotice(buildUnsupportedAttachmentsNotice(unsupported));
    requestUpdate();
  }
}

function resolveAttachmentPreviewLabel(att: ChatAttachment): string {
  if (att.fileName?.trim()) {
    return att.fileName.trim();
  }
  if (att.mimeType.startsWith("image/")) {
    return chatText("attachments.preview");
  }
  if (att.mimeType.startsWith("audio/")) {
    return chatText("compose.voiceInput");
  }
  return att.mimeType;
}

function renderAttachmentPreview(props: ChatProps): TemplateResult | typeof nothing {
  const attachments = props.attachments ?? [];
  if (attachments.length === 0) {
    return nothing;
  }
  return html`
    <div class="chat-attachments-preview alisio-chat__attachments">
      ${attachments.map(
        (att) => html`
          <div class="alisio-chat__attachment-pill">
            <span class="alisio-chat__attachment-pill-media" aria-hidden="true">
              ${isImageChatAttachmentMimeType(att.mimeType)
                ? html`<img src=${att.dataUrl} alt=${chatText("attachments.preview")} />`
                : att.mimeType.startsWith("audio/")
                  ? icons.radio
                  : icons.fileText}
            </span>
            <span
              class="alisio-chat__attachment-pill-label"
              title=${resolveAttachmentPreviewLabel(att)}
            >
              ${resolveAttachmentPreviewLabel(att)}
            </span>
            <button
              class="alisio-chat__attachment-pill-remove"
              type="button"
              aria-label=${chatText("attachments.remove")}
              @click=${() => {
                const next = (props.attachments ?? []).filter((a) => a.id !== att.id);
                props.onAttachmentsChange?.(next);
              }}
            >
              ${icons.x}
            </button>
          </div>
        `,
      )}
    </div>
  `;
}

const RECORDING_WAVE_PATTERN = [12, 22, 34, 18, 28, 16, 30, 14, 26, 20, 32, 18] as const;

function renderRecordingWaveform(): TemplateResult {
  return html`
    <div class="alisio-chat__recording-wave" role="status" aria-live="polite">
      <div class="alisio-chat__recording-wave-track" aria-hidden="true">
        ${RECORDING_WAVE_PATTERN.map(
          (height, index) => html`
            <span
              class="alisio-chat__recording-wave-bar"
              style=${`--wave-height:${height}px;--wave-delay:${index * 90}ms;`}
            ></span>
          `,
        )}
      </div>
      <span class="alisio-chat__recording-wave-time"
        >${formatRecordingElapsed(vs.sttStartedAt)}</span
      >
    </div>
  `;
}

function resetSlashMenuState(): void {
  vs.slashMenuMode = "command";
  vs.slashMenuCommand = null;
  vs.slashMenuArgItems = [];
  vs.slashMenuItems = [];
}

function updateSlashMenu(value: string, requestUpdate: () => void): void {
  // Arg mode: /command <partial-arg>
  const argMatch = value.match(/^\/(\S+)\s(.*)$/);
  if (argMatch) {
    const cmdName = argMatch[1].toLowerCase();
    const argFilter = argMatch[2].toLowerCase();
    const cmd = SLASH_COMMANDS.find((c) => c.name === cmdName);
    if (cmd?.argOptions?.length) {
      const filtered = argFilter
        ? cmd.argOptions.filter((opt) => opt.toLowerCase().startsWith(argFilter))
        : cmd.argOptions;
      if (filtered.length > 0) {
        vs.slashMenuMode = "args";
        vs.slashMenuCommand = cmd;
        vs.slashMenuArgItems = filtered;
        vs.slashMenuOpen = true;
        vs.slashMenuIndex = 0;
        vs.slashMenuItems = [];
        requestUpdate();
        return;
      }
    }
    vs.slashMenuOpen = false;
    resetSlashMenuState();
    requestUpdate();
    return;
  }

  // Command mode: /partial-command
  const match = value.match(/^\/(\S*)$/);
  if (match) {
    const items = getSlashCommandCompletions(match[1]);
    vs.slashMenuItems = items;
    vs.slashMenuOpen = items.length > 0;
    vs.slashMenuIndex = 0;
    vs.slashMenuMode = "command";
    vs.slashMenuCommand = null;
    vs.slashMenuArgItems = [];
  } else {
    vs.slashMenuOpen = false;
    resetSlashMenuState();
  }
  requestUpdate();
}

function selectSlashCommand(
  cmd: SlashCommandDef,
  props: ChatProps,
  requestUpdate: () => void,
): void {
  // Transition to arg picker when the command has fixed options
  if (cmd.argOptions?.length) {
    props.onDraftChange(`/${cmd.name} `);
    vs.slashMenuMode = "args";
    vs.slashMenuCommand = cmd;
    vs.slashMenuArgItems = cmd.argOptions;
    vs.slashMenuOpen = true;
    vs.slashMenuIndex = 0;
    vs.slashMenuItems = [];
    requestUpdate();
    return;
  }

  vs.slashMenuOpen = false;
  resetSlashMenuState();

  if (cmd.executeLocal && !cmd.args) {
    props.onDraftChange(`/${cmd.name}`);
    requestUpdate();
    props.onSend();
  } else {
    props.onDraftChange(`/${cmd.name} `);
    requestUpdate();
  }
}

function tabCompleteSlashCommand(
  cmd: SlashCommandDef,
  props: ChatProps,
  requestUpdate: () => void,
): void {
  // Tab: fill in the command text without executing
  if (cmd.argOptions?.length) {
    props.onDraftChange(`/${cmd.name} `);
    vs.slashMenuMode = "args";
    vs.slashMenuCommand = cmd;
    vs.slashMenuArgItems = cmd.argOptions;
    vs.slashMenuOpen = true;
    vs.slashMenuIndex = 0;
    vs.slashMenuItems = [];
    requestUpdate();
    return;
  }

  vs.slashMenuOpen = false;
  resetSlashMenuState();
  props.onDraftChange(cmd.args ? `/${cmd.name} ` : `/${cmd.name}`);
  requestUpdate();
}

function selectSlashArg(
  arg: string,
  props: ChatProps,
  requestUpdate: () => void,
  execute: boolean,
): void {
  const cmdName = vs.slashMenuCommand?.name ?? "";
  vs.slashMenuOpen = false;
  resetSlashMenuState();
  props.onDraftChange(`/${cmdName} ${arg}`);
  requestUpdate();
  if (execute) {
    props.onSend();
  }
}

function tokenEstimate(draft: string): string | null {
  if (draft.length < 100) {
    return null;
  }
  return `~${Math.ceil(draft.length / 4)} tokens`;
}

const WELCOME_FEATURED_CONNECTORS = [
  {
    connectActionKey: "welcome.featuredApps.gmailReadConnectAction",
    id: "gmail-read",
    connectedActionKey: "welcome.featuredApps.gmailReadConnectedAction",
    promptKey: "welcome.featuredApps.gmailReadPrompt",
  },
  {
    connectActionKey: "welcome.featuredApps.gmailSendConnectAction",
    id: "gmail-send",
    connectedActionKey: "welcome.featuredApps.gmailSendConnectedAction",
    promptKey: "welcome.featuredApps.gmailSendPrompt",
  },
  {
    connectActionKey: "welcome.featuredApps.googleCalendarConnectAction",
    id: "google-calendar",
    connectedActionKey: "welcome.featuredApps.googleCalendarConnectedAction",
    promptKey: "welcome.featuredApps.googleCalendarPrompt",
  },
] as const;

type WelcomeFeaturedConnector = (typeof WELCOME_FEATURED_CONNECTORS)[number];
type WelcomeConnectorEntry = {
  config: WelcomeFeaturedConnector;
  row: ConnectorRow;
};

function extractWelcomeFirstName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) {
    return null;
  }
  const [first = ""] = trimmed.split(/\s+/);
  const normalized = first.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return normalized || null;
}

function applyWelcomePrompt(props: ChatProps, text: string): void {
  props.onDraftChange(text);
  if (props.connected && props.canSend) {
    props.onSend();
  }
}

function buildWelcomeConnectorEntries(props: ChatProps): WelcomeConnectorEntry[] {
  if (!props.connectorCatalog?.length) {
    return [];
  }
  const rows = buildConnectorRows(props.connectorCatalog, props.connectorAuthorizations ?? []);
  const rowsById = new Map(rows.map((row) => [row.definition.id, row]));
  return WELCOME_FEATURED_CONNECTORS.map((config) => {
    const row = rowsById.get(config.id);
    return row ? { config, row } : null;
  }).filter((entry): entry is WelcomeConnectorEntry => entry !== null);
}

function resolveWelcomeConnectorActionLabel(entry: WelcomeConnectorEntry): string {
  switch (entry.row.status) {
    case "connected":
      return chatText(entry.config.connectedActionKey);
    case "needs_reconnect":
      return chatText("welcome.featuredApps.reconnect");
    case "setup_required":
      return chatText("welcome.featuredApps.configure");
    case "ready":
      return chatText(entry.config.connectActionKey);
    case "in_review":
    case "unavailable":
    default:
      return chatText("welcome.featuredApps.openApps");
  }
}

function handleWelcomeConnectorAction(props: ChatProps, entry: WelcomeConnectorEntry): void {
  switch (entry.row.status) {
    case "connected":
      applyWelcomePrompt(props, chatText(entry.config.promptKey));
      return;
    case "needs_reconnect":
    case "ready":
      props.onBeginConnector?.(entry.row.definition.id);
      return;
    case "setup_required":
    case "in_review":
    case "unavailable":
    default:
      props.onOpenAuthentications?.();
  }
}

function renderWelcomeState(props: ChatProps): TemplateResult {
  const name = props.assistantName || chatText("defaultAssistantName");
  const avatar = resolveAgentAvatarUrl({
    identity: {
      avatar: props.assistantAvatar ?? undefined,
      avatarUrl: props.assistantAvatarUrl ?? undefined,
    },
  });
  const logoUrl = agentLogoUrl(props.basePath ?? "");
  const firstName = extractWelcomeFirstName(props.viewerDisplayName);
  const greeting = firstName
    ? chatText("welcome.greetingNamed", { name: firstName })
    : chatText("welcome.greetingGeneric");
  const visibleFeaturedConnectors = props.connected
    ? buildWelcomeConnectorEntries(props).filter(
        (entry) =>
          entry.row.status === "connected" ||
          entry.row.status === "ready" ||
          entry.row.status === "needs_reconnect",
      )
    : [];
  const quickActions = props.connected
    ? [
        {
          icon: icons.penLine,
          onClick: () => {
            if (props.onOpenTasks) {
              props.onOpenTasks();
              return;
            }
            applyWelcomePrompt(props, chatText("welcome.quickActions.newTaskPrompt"));
          },
          title: chatText("welcome.quickActions.newTaskTitle"),
        },
        {
          icon: icons.scrollText,
          onClick: () => {
            applyWelcomePrompt(props, chatText("welcome.quickActions.resumePrompt"));
          },
          title: chatText("welcome.quickActions.resumeTitle"),
        },
        {
          icon: icons.monitor,
          onClick: () => {
            applyWelcomePrompt(props, chatText("welcome.quickActions.systemPrompt"));
          },
          title: chatText("welcome.quickActions.systemTitle"),
        },
      ]
    : props.onOpenRuntimeSetup
      ? [
          {
            icon: icons.settings,
            onClick: props.onOpenRuntimeSetup,
            title: chatText("welcome.quickActions.openSetupTitle"),
          },
        ]
      : [];

  return html`
    <div class="agent-chat__welcome" style="--agent-color: var(--accent)">
      <div class="agent-chat__welcome-glow"></div>
      ${avatar
        ? html`<img
            src=${avatar}
            alt=${name}
            style="width:56px; height:56px; border-radius:50%; object-fit:cover;"
          />`
        : html`<div class="agent-chat__avatar agent-chat__avatar--logo">
            <img src=${logoUrl} alt="Alisio" />
          </div>`}
      <div class="agent-chat__welcome-hero">
        <h2>${greeting}</h2>
        <p class="agent-chat__welcome-title">
          ${props.connected
            ? chatText("welcome.titleConnected")
            : chatText("welcome.titleDisconnected")}
        </p>
        <div class="agent-chat__welcome-actions">
          ${quickActions.map(
            (action) => html`
              <button type="button" class="agent-chat__welcome-action" @click=${action.onClick}>
                <span class="agent-chat__welcome-action-icon" aria-hidden="true"
                  >${action.icon}</span
                >
                <span class="agent-chat__welcome-action-label">${action.title}</span>
              </button>
            `,
          )}
        </div>
      </div>
      ${visibleFeaturedConnectors.length > 0
        ? html`
            <div class="agent-chat__welcome-apps">
              ${visibleFeaturedConnectors.map((entry) => {
                const providerLabel = entry.row.definition.providerLabel ?? entry.row.definition.id;
                const brand = getConnectorBranding(entry.row.definition.id, providerLabel);
                return html`
                  <button
                    type="button"
                    class="agent-chat__welcome-app"
                    style=${connectorBrandStyle(brand)}
                    @click=${() => handleWelcomeConnectorAction(props, entry)}
                  >
                    <span class="agent-chat__welcome-app-logo">
                      <img src=${brand.logoUrl} alt="" />
                    </span>
                    <span class="agent-chat__welcome-app-label">
                      ${resolveWelcomeConnectorActionLabel(entry)}
                    </span>
                  </button>
                `;
              })}
              ${props.onOpenAuthentications
                ? html`
                    <button
                      type="button"
                      class="agent-chat__welcome-app agent-chat__welcome-app--ghost"
                      @click=${props.onOpenAuthentications}
                    >
                      <span class="agent-chat__welcome-app-label"
                        >${chatText("welcome.openApps")}</span
                      >
                    </button>
                  `
                : nothing}
            </div>
          `
        : nothing}
    </div>
  `;
}

function renderChatSkeletonGroup(opts: {
  role: "assistant" | "user";
  lines: readonly ("short" | "medium" | "long")[];
}): TemplateResult {
  return html`
    <div class="chat-group ${opts.role} chat-group--skeleton" aria-hidden="true">
      <div class="chat-avatar ${opts.role} skeleton chat-avatar--skeleton"></div>
      <div class="chat-group-messages">
        <div class="chat-bubble chat-bubble--skeleton">
          ${renderSkeletonLines(opts.lines, {
            compact: true,
            className: "alisio-chat__skeleton-copy",
          })}
        </div>
        <div class="chat-group-footer chat-group-footer--skeleton">
          ${renderSkeletonPill({
            small: true,
            className: "alisio-chat__skeleton-meta",
          })}
        </div>
      </div>
    </div>
  `;
}

function renderChatLoadingSkeleton(): TemplateResult {
  return html`
    <div class="chat-loading-skeleton" role="status" aria-label=${chatText("loading")}>
      ${renderChatSkeletonGroup({ role: "assistant", lines: ["long", "medium", "short"] })}
      ${renderChatSkeletonGroup({ role: "user", lines: ["medium"] })}
      ${renderChatSkeletonGroup({ role: "assistant", lines: ["long", "short"] })}
      ${renderChatSkeletonGroup({ role: "assistant", lines: ["medium", "long", "short"] })}
    </div>
  `;
}

function renderThreadRefreshIndicator(): TemplateResult {
  return html`
    <div class="alisio-chat__refresh-indicator" role="status" aria-live="polite">
      <span class="chat-run-status__chip chat-run-status__chip--refresh">
        <span class="chat-run-status__icon" aria-hidden="true">${icons.loader}</span>
        <span class="chat-run-status__label">${chatText("loading")}</span>
      </span>
    </div>
  `;
}

function renderSearchBar(requestUpdate: () => void): TemplateResult | typeof nothing {
  if (!vs.searchOpen) {
    return nothing;
  }
  return html`
    <div class="agent-chat__search-bar">
      ${icons.search}
      <input
        type="text"
        placeholder=${chatText("searchPlaceholder")}
        aria-label=${chatText("searchAria")}
        .value=${vs.searchQuery}
        @input=${(e: Event) => {
          vs.searchQuery = (e.target as HTMLInputElement).value;
          requestUpdate();
        }}
      />
      <button
        class="btn btn--ghost"
        aria-label=${chatText("searchClose")}
        @click=${() => {
          vs.searchOpen = false;
          vs.searchQuery = "";
          requestUpdate();
        }}
      >
        ${icons.x}
      </button>
    </div>
  `;
}

function renderPinnedSection(
  props: ChatProps,
  pinned: PinnedMessages,
  requestUpdate: () => void,
): TemplateResult | typeof nothing {
  const messages = Array.isArray(props.messages) ? props.messages : [];
  const entries: Array<{ index: number; text: string; role: string }> = [];
  for (const idx of pinned.indices) {
    const msg = messages[idx] as Record<string, unknown> | undefined;
    if (!msg) {
      continue;
    }
    const text = getPinnedMessageSummary(msg);
    const role = typeof msg.role === "string" ? msg.role : "unknown";
    entries.push({ index: idx, text, role });
  }
  if (entries.length === 0) {
    return nothing;
  }
  return html`
    <div class="agent-chat__pinned">
      <button
        class="agent-chat__pinned-toggle"
        @click=${() => {
          vs.pinnedExpanded = !vs.pinnedExpanded;
          requestUpdate();
        }}
      >
        ${icons.bookmark} ${chatText("pinned.count", { count: String(entries.length) })}
        <span class="collapse-chevron ${vs.pinnedExpanded ? "" : "collapse-chevron--collapsed"}"
          >${icons.chevronDown}</span
        >
      </button>
      ${vs.pinnedExpanded
        ? html`
            <div class="agent-chat__pinned-list">
              ${entries.map(
                ({ index, text, role }) => html`
                  <div class="agent-chat__pinned-item">
                    <span class="agent-chat__pinned-role"
                      >${role === "user"
                        ? chatText("pinned.roleUser")
                        : chatText("pinned.roleAssistant")}</span
                    >
                    <span class="agent-chat__pinned-text"
                      >${text.slice(0, 100)}${text.length > 100 ? "..." : ""}</span
                    >
                    <button
                      class="btn btn--ghost"
                      @click=${() => {
                        pinned.unpin(index);
                        requestUpdate();
                      }}
                      title=${chatText("pinned.unpin")}
                    >
                      ${icons.x}
                    </button>
                  </div>
                `,
              )}
            </div>
          `
        : nothing}
    </div>
  `;
}

function renderSlashMenu(
  requestUpdate: () => void,
  props: ChatProps,
): TemplateResult | typeof nothing {
  if (!vs.slashMenuOpen) {
    return nothing;
  }

  // Arg-picker mode: show options for the selected command
  if (vs.slashMenuMode === "args" && vs.slashMenuCommand && vs.slashMenuArgItems.length > 0) {
    return html`
      <div class="slash-menu" role="listbox" aria-label=${chatText("slash.argsAria")}>
        <div class="slash-menu-group">
          <div class="slash-menu-group__label">
            /${vs.slashMenuCommand.name} ${getSlashCommandDescription(vs.slashMenuCommand)}
          </div>
          ${vs.slashMenuArgItems.map(
            (arg, i) => html`
              <div
                class="slash-menu-item ${i === vs.slashMenuIndex ? "slash-menu-item--active" : ""}"
                role="option"
                aria-selected=${i === vs.slashMenuIndex}
                @click=${() => selectSlashArg(arg, props, requestUpdate, true)}
                @mouseenter=${() => {
                  vs.slashMenuIndex = i;
                  requestUpdate();
                }}
              >
                ${vs.slashMenuCommand?.icon
                  ? html`<span class="slash-menu-icon">${icons[vs.slashMenuCommand.icon]}</span>`
                  : nothing}
                <span class="slash-menu-name">${arg}</span>
                <span class="slash-menu-desc">/${vs.slashMenuCommand?.name} ${arg}</span>
              </div>
            `,
          )}
        </div>
        <div class="slash-menu-footer">${chatText("slash.footerArgs")}</div>
      </div>
    `;
  }

  // Command mode: show grouped commands
  if (vs.slashMenuItems.length === 0) {
    return nothing;
  }

  const grouped = new Map<
    SlashCommandCategory,
    Array<{ cmd: SlashCommandDef; globalIdx: number }>
  >();
  for (let i = 0; i < vs.slashMenuItems.length; i++) {
    const cmd = vs.slashMenuItems[i];
    const cat = cmd.category ?? "session";
    let list = grouped.get(cat);
    if (!list) {
      list = [];
      grouped.set(cat, list);
    }
    list.push({ cmd, globalIdx: i });
  }

  const sections: TemplateResult[] = [];
  for (const [cat, entries] of grouped) {
    sections.push(html`
      <div class="slash-menu-group">
        <div class="slash-menu-group__label">${getSlashCategoryLabel(cat)}</div>
        ${entries.map(
          ({ cmd, globalIdx }) => html`
            <div
              class="slash-menu-item ${globalIdx === vs.slashMenuIndex
                ? "slash-menu-item--active"
                : ""}"
              role="option"
              aria-selected=${globalIdx === vs.slashMenuIndex}
              @click=${() => selectSlashCommand(cmd, props, requestUpdate)}
              @mouseenter=${() => {
                vs.slashMenuIndex = globalIdx;
                requestUpdate();
              }}
            >
              ${cmd.icon ? html`<span class="slash-menu-icon">${icons[cmd.icon]}</span>` : nothing}
              <span class="slash-menu-name">/${cmd.name}</span>
              ${cmd.args ? html`<span class="slash-menu-args">${cmd.args}</span>` : nothing}
              <span class="slash-menu-desc">${getSlashCommandDescription(cmd)}</span>
              ${cmd.argOptions?.length
                ? html`<span class="slash-menu-badge"
                    >${chatText("slash.options", {
                      count: String(cmd.argOptions.length),
                    })}</span
                  >`
                : cmd.executeLocal && !cmd.args
                  ? html` <span class="slash-menu-badge">${chatText("slash.instant")}</span> `
                  : nothing}
            </div>
          `,
        )}
      </div>
    `);
  }

  return html`
    <div class="slash-menu" role="listbox" aria-label=${chatText("slash.commandsAria")}>
      ${sections}
      <div class="slash-menu-footer">${chatText("slash.footerCommands")}</div>
    </div>
  `;
}

export function renderChat(props: ChatProps) {
  syncChatViewStateForSession(props.sessionKey);

  const canCompose = props.connected;
  const canSendMessage = props.connected && props.canSend;
  const isBusy = Boolean(
    props.sending || props.stream !== null || props.canAbort || props.finalizing,
  );
  const canAbort = Boolean(props.canAbort && props.onAbort);
  const activeSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
  const reasoningLevel = activeSession?.reasoningLevel ?? "off";
  const showReasoning = props.showThinking && reasoningLevel !== "off";
  const assistantIdentity = {
    name: props.assistantName,
    avatar:
      resolveAgentAvatarUrl({
        identity: {
          avatar: props.assistantAvatar ?? undefined,
          avatarUrl: props.assistantAvatarUrl ?? undefined,
        },
      }) ?? null,
  };
  const pinned = getPinnedMessages(props.sessionKey);
  const deleted = getDeletedMessages(props.sessionKey);
  const inputHistory = getInputHistory(props.sessionKey);
  const hasAttachments = (props.attachments?.length ?? 0) > 0;
  const tokens = tokenEstimate(props.draft);

  const placeholder = props.connected
    ? hasAttachments
      ? chatText("compose.placeholderWithAttachments")
      : chatText("compose.placeholder", {
          assistant: props.assistantName || chatText("defaultAssistantName"),
        })
    : chatText("compose.placeholderDisconnected");

  const requestUpdate = props.onRequestUpdate ?? (() => {});
  const getDraft = props.getDraft ?? (() => props.draft);
  let fileInputEl: HTMLInputElement | null = null;

  const splitRatio = props.splitRatio ?? 0.6;
  const browserPaneMarkdown = {
    content: props.sidebarContent ?? null,
    error: props.sidebarError ?? null,
  };
  const sidebarOpen = Boolean(
    props.sidebarOpen &&
    props.onCloseSidebar &&
    (props.browserPaneObserver || browserPaneMarkdown.content || browserPaneMarkdown.error),
  );

  const handleCodeBlockCopy = (e: Event) => {
    const btn = (e.target as HTMLElement).closest(".code-block-copy");
    if (!btn) {
      return;
    }
    const code = (btn as HTMLElement).dataset.code ?? "";
    navigator.clipboard.writeText(code).then(
      () => {
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 1500);
      },
      () => {},
    );
  };

  const chatItems = buildChatItems(props);
  const isEmpty = chatItems.length === 0 && !props.loading;

  const thread = html`
    <div
      class="chat-thread"
      role="log"
      aria-live="polite"
      aria-busy=${props.loading ? "true" : "false"}
      @scroll=${props.onChatScroll}
      @click=${handleCodeBlockCopy}
    >
      <div class="chat-thread-inner alisio-chat__thread">
        ${props.loading && chatItems.length > 0 ? renderThreadRefreshIndicator() : nothing}
        ${props.loading && chatItems.length === 0 ? renderChatLoadingSkeleton() : nothing}
        ${isEmpty && !vs.searchOpen ? renderWelcomeState(props) : nothing}
        ${isEmpty && vs.searchOpen
          ? html` <div class="agent-chat__empty">${chatText("noMatchingMessages")}</div> `
          : nothing}
        ${repeat(
          chatItems,
          (item) => item.key,
          (item) => {
            if (item.kind === "divider") {
              return html`
                <div class="chat-divider" role="separator" data-ts=${String(item.timestamp)}>
                  <span class="chat-divider__line"></span>
                  <span class="chat-divider__label">${item.label}</span>
                  <span class="chat-divider__line"></span>
                </div>
              `;
            }
            if (item.kind === "run-status") {
              return renderRunStatusGroup(item.activity, assistantIdentity, props.basePath);
            }
            if (item.kind === "stream") {
              return renderStreamingGroup(
                item.text,
                item.startedAt,
                item.activity,
                props.onOpenSidebar,
                assistantIdentity,
                props.basePath,
              );
            }
            if (item.kind === "group") {
              if (deleted.has(item.key)) {
                return nothing;
              }
              return renderMessageGroup(item, {
                onOpenSidebar: props.onOpenSidebar,
                showReasoning,
                showToolCalls: props.showToolCalls,
                onBeginConnector: props.onBeginConnector,
                assistantName: props.assistantName,
                assistantAvatar: assistantIdentity.avatar,
                basePath: props.basePath,
                contextWindow:
                  activeSession?.contextTokens ?? props.sessions?.defaults?.contextTokens ?? null,
                onDelete: () => {
                  deleted.delete(item.key);
                  requestUpdate();
                },
                sessionKey: props.sessionKey,
                taskProposals: props.taskProposals,
                taskProposalBusy: props.taskProposalBusy,
                onSaveTaskProposal: props.onSaveTaskProposal,
                onResolveTaskProposal: props.onResolveTaskProposal,
                onLaunchTaskProposal: props.onLaunchTaskProposal,
                onOpenTaskSession: props.onOpenTaskSession,
                onOpenTasks: props.onOpenTasks,
              });
            }
            return nothing;
          },
        )}
      </div>
    </div>
  `;

  const handleKeyDown = (e: KeyboardEvent) => {
    // Slash menu navigation — arg mode
    if (vs.slashMenuOpen && vs.slashMenuMode === "args" && vs.slashMenuArgItems.length > 0) {
      const len = vs.slashMenuArgItems.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex + 1) % len;
          requestUpdate();
          return;
        case "ArrowUp":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex - 1 + len) % len;
          requestUpdate();
          return;
        case "Tab":
          e.preventDefault();
          selectSlashArg(vs.slashMenuArgItems[vs.slashMenuIndex], props, requestUpdate, false);
          return;
        case "Enter":
          e.preventDefault();
          selectSlashArg(vs.slashMenuArgItems[vs.slashMenuIndex], props, requestUpdate, true);
          return;
        case "Escape":
          e.preventDefault();
          vs.slashMenuOpen = false;
          resetSlashMenuState();
          requestUpdate();
          return;
      }
    }

    // Slash menu navigation — command mode
    if (vs.slashMenuOpen && vs.slashMenuItems.length > 0) {
      const len = vs.slashMenuItems.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex + 1) % len;
          requestUpdate();
          return;
        case "ArrowUp":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex - 1 + len) % len;
          requestUpdate();
          return;
        case "Tab":
          e.preventDefault();
          tabCompleteSlashCommand(vs.slashMenuItems[vs.slashMenuIndex], props, requestUpdate);
          return;
        case "Enter":
          e.preventDefault();
          selectSlashCommand(vs.slashMenuItems[vs.slashMenuIndex], props, requestUpdate);
          return;
        case "Escape":
          e.preventDefault();
          vs.slashMenuOpen = false;
          resetSlashMenuState();
          requestUpdate();
          return;
      }
    }

    // Input history (only when input is empty)
    if (!props.draft.trim()) {
      if (e.key === "ArrowUp") {
        const prev = inputHistory.up();
        if (prev !== null) {
          e.preventDefault();
          props.onDraftChange(prev);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        const next = inputHistory.down();
        e.preventDefault();
        props.onDraftChange(next ?? "");
        return;
      }
    }

    // Cmd+F for search
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
      e.preventDefault();
      vs.searchOpen = !vs.searchOpen;
      if (!vs.searchOpen) {
        vs.searchQuery = "";
      }
      requestUpdate();
      return;
    }

    // Send on Enter (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      if (!canSendMessage) {
        return;
      }
      e.preventDefault();
      if (canCompose) {
        if (props.draft.trim()) {
          inputHistory.push(props.draft);
        }
        props.onSend();
      }
    }
  };

  const runtimeSetupCallout = props.runtimeSetupHint
    ? html`
        <div class="callout info alisio-chat__setup-callout" role="status" aria-live="polite">
          <div class="alisio-chat__setup-copy">
            <strong>${props.runtimeSetupHint.title}</strong>
            <span>${props.runtimeSetupHint.message}</span>
          </div>
          ${props.onOpenRuntimeSetup
            ? html`
                <button class="btn btn--sm" type="button" @click=${props.onOpenRuntimeSetup}>
                  ${props.runtimeSetupHint.ctaLabel}
                </button>
              `
            : nothing}
        </div>
      `
    : nothing;

  const securityConsoleProps = {
    assistantName: props.assistantName,
    assistantAgentId: props.assistantAgentId ?? null,
    accessMode: props.accessMode,
    accessModeLoading: props.accessModeLoading,
    accessModeBusy: props.accessModeBusy,
    securityDiagnostics: props.securityDiagnostics ?? null,
    connected: props.connected,
    approvalQueue: props.approvalQueue ?? [],
    approvalAuditTrail: props.approvalAuditTrail ?? [],
    approvalBusy: props.approvalBusy,
    nativeShellLoading: props.nativeShellLoading,
    nativeShellError: props.nativeShellError ?? null,
    nativeShellState: props.nativeShellState ?? null,
    onApplyAccessMode: props.onApplyAccessMode,
    onResolveApproval: props.onResolveApproval,
    onOpenNativeSettings: props.onOpenNativeSettings,
  } satisfies Parameters<typeof renderChatSecurityAccessStrip>[0];
  const securityQueue = renderChatSecurityQueue(securityConsoleProps);
  const securityAccessStrip = renderChatSecurityAccessStrip(securityConsoleProps);
  const hasComposerFooter = Boolean(tokens) || securityAccessStrip !== nothing;

  const stopRecording = () => {
    stopStt();
    clearSttComposerState();
    requestUpdate();
  };

  const toggleRecording = () => {
    if (vs.sttRecording) {
      stopRecording();
      return;
    }
    const started = startStt({
      onTranscript: (text, isFinal) => {
        if (isFinal) {
          const current = getDraft();
          const sep = current && !current.endsWith(" ") ? " " : "";
          props.onDraftChange(current + sep + text);
          vs.sttInterimText = "";
        } else {
          vs.sttInterimText = text;
        }
        requestUpdate();
      },
      onStart: () => {
        setComposerNotice(null);
        vs.sttRecording = true;
        vs.sttStartedAt ??= Date.now();
        startSttTicker(requestUpdate);
        requestUpdate();
      },
      onEnd: () => {
        clearSttComposerState();
        requestUpdate();
      },
      onError: (error) => {
        clearSttComposerState();
        setComposerNotice(
          error === "not-allowed" || error === "service-not-allowed"
            ? chatText("compose.voiceInputBlocked")
            : chatText("compose.voiceInputFailed"),
        );
        requestUpdate();
      },
    });
    if (started) {
      vs.sttRecording = true;
      vs.sttStartedAt = Date.now();
      startSttTicker(requestUpdate);
      requestUpdate();
    }
  };

  const handleSendClick = () => {
    if (props.draft.trim()) {
      inputHistory.push(props.draft);
    }
    props.onSend();
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    adjustTextareaHeight(target);
    updateSlashMenu(target.value, requestUpdate);
    inputHistory.reset();
    if (vs.composerNotice) {
      setComposerNotice(null);
    }
    props.onDraftChange(target.value);
  };

  return html`
    <section
      class="card chat alisio-chat ${isEmpty ? "alisio-chat--empty" : ""}"
      @drop=${(e: DragEvent) => handleDrop(e, props, requestUpdate)}
      @dragover=${(e: DragEvent) => e.preventDefault()}
    >
      ${props.disabledReason ? html`<div class="callout">${props.disabledReason}</div>` : nothing}
      ${runtimeSetupCallout}
      ${props.error && !props.runtimeSetupHint
        ? html`<div class="callout danger">${props.error}</div>`
        : nothing}
      ${vs.composerNotice ? html`<div class="callout">${vs.composerNotice}</div>` : nothing}
      ${props.focusMode
        ? html`
            <button
              class="chat-focus-exit"
              type="button"
              @click=${props.onToggleFocusMode}
              aria-label=${chatText("focus.exit")}
              title=${chatText("focus.exit")}
            >
              ${icons.x}
            </button>
          `
        : nothing}
      ${renderSearchBar(requestUpdate)} ${renderPinnedSection(props, pinned, requestUpdate)}

      <div
        class="chat-split-container alisio-chat__workspace ${sidebarOpen
          ? "chat-split-container--open"
          : ""}"
      >
        <div
          class="chat-main alisio-chat__main"
          style="flex: ${sidebarOpen ? `0 0 ${splitRatio * 100}%` : "1 1 100%"}"
        >
          ${thread}
        </div>

        ${sidebarOpen
          ? html`
              <resizable-divider
                .splitRatio=${splitRatio}
                @resize=${(e: CustomEvent) => props.onSplitRatioChange?.(e.detail.splitRatio)}
              ></resizable-divider>
              <div class="chat-sidebar">
                ${renderBrowserPane({
                  observer: props.browserPaneObserver ?? null,
                  markdown: browserPaneMarkdown,
                  selectedSurface: props.browserPaneSurfaceKind ?? "observer",
                  onSelectSurface: props.onSelectBrowserPaneSurface,
                  onClose: props.onCloseSidebar!,
                  onViewRawText: () => {
                    if (!props.sidebarContent || !props.onOpenSidebar) {
                      return;
                    }
                    props.onOpenSidebar(`\`\`\`\n${props.sidebarContent}\n\`\`\``);
                  },
                })}
              </div>
            `
          : nothing}
      </div>

      ${props.queue.length
        ? html`
            <div class="chat-queue" role="status" aria-live="polite">
              <div class="chat-queue__title">
                ${chatText("queue.title", { count: String(props.queue.length) })}
              </div>
              <div class="chat-queue__list">
                ${props.queue.map((item, index) => {
                  const queueText =
                    item.text ||
                    (item.attachments?.length
                      ? chatText("compose.fileAttachment", {
                          count: String(item.attachments.length),
                        })
                      : "");
                  const queueTone = item.pendingRunId ? "current" : isBusy ? "next" : "ready";
                  const queueState = item.pendingRunId
                    ? chatText("queue.pendingCurrent")
                    : isBusy
                      ? chatText("queue.pendingNext")
                      : chatText("queue.ready");
                  return html`
                    <div class="chat-queue__item chat-queue__item--${queueTone}">
                      <div class="chat-queue__body">
                        <div class="chat-queue__meta">
                          <span class="chat-queue__slot">#${index + 1}</span>
                          <div class="chat-queue__state chat-queue__state--${queueTone}">
                            ${queueState}
                          </div>
                        </div>
                        <div class="chat-queue__text">${queueText}</div>
                      </div>
                      <button
                        class="btn chat-queue__remove"
                        type="button"
                        aria-label=${chatText("queue.remove")}
                        title=${chatText("queue.remove")}
                        @click=${() => props.onQueueRemove(item.id)}
                      >
                        ${icons.x}
                      </button>
                    </div>
                  `;
                })}
              </div>
            </div>
          `
        : nothing}
      ${renderFallbackIndicator(props.fallbackStatus)}
      ${renderCompactionIndicator(props.compactionStatus)}
      ${renderContextNotice(activeSession, props.sessions?.defaults?.contextTokens ?? null, {
        hidden: Boolean(props.canAbort || props.finalizing),
      })}
      ${props.showNewMessages
        ? html`
            <button class="chat-new-messages" type="button" @click=${props.onScrollToBottom}>
              ${icons.arrowDown} ${chatText("newMessages")}
            </button>
          `
        : nothing}

      <!-- Input bar -->
      <div class="alisio-chat__composer-shell">
        ${securityQueue}
        <div class="agent-chat__input alisio-chat__composer">
          ${renderSlashMenu(requestUpdate, props)} ${renderAttachmentPreview(props)}

          <input
            type="file"
            accept=${CHAT_ATTACHMENT_ACCEPT}
            multiple
            class="agent-chat__file-input"
            ${ref((el) => {
              fileInputEl = el as HTMLInputElement | null;
            })}
            @change=${(e: Event) => handleFileSelect(e, props, requestUpdate)}
          />

          ${vs.sttRecording && vs.sttInterimText
            ? html`<div class="agent-chat__stt-interim">${vs.sttInterimText}</div>`
            : nothing}

          <textarea
            class="alisio-chat__composer-field"
            ${ref((el) => el && adjustTextareaHeight(el as HTMLTextAreaElement))}
            .value=${props.draft}
            dir=${detectTextDirection(props.draft)}
            ?disabled=${!props.connected}
            @keydown=${handleKeyDown}
            @input=${handleInput}
            @paste=${(e: ClipboardEvent) => handlePaste(e, props, requestUpdate)}
            placeholder=${vs.sttRecording ? chatText("compose.listening") : placeholder}
            rows="1"
          ></textarea>

          <div
            class="agent-chat__toolbar alisio-chat__composer-toolbar ${vs.sttRecording
              ? "alisio-chat__composer-toolbar--recording"
              : ""}"
          >
            <div class="agent-chat__toolbar-left alisio-chat__composer-tools">
              <button
                class="agent-chat__input-btn agent-chat__input-btn--attach"
                @click=${() => {
                  fileInputEl?.click();
                }}
                title=${chatText("compose.attachFile")}
                aria-label=${chatText("compose.attachFile")}
                ?disabled=${!props.connected}
              >
                ${icons.plus}
              </button>

              ${vs.sttRecording
                ? renderRecordingWaveform()
                : props.composerModelSelect !== undefined
                  ? html`
                      <div class="alisio-chat__composer-model">${props.composerModelSelect}</div>
                    `
                  : nothing}
            </div>

            <div class="agent-chat__toolbar-right alisio-chat__composer-actions">
              ${vs.sttRecording
                ? html`
                    <button
                      class="chat-send-btn chat-send-btn--stop"
                      @click=${stopRecording}
                      title=${chatText("compose.stopRecording")}
                      aria-label=${chatText("compose.stopRecording")}
                    >
                      ${icons.stop}
                    </button>
                  `
                : isSttSupported()
                  ? html`
                      <button
                        class="agent-chat__input-btn"
                        @click=${toggleRecording}
                        title=${chatText("compose.voiceInput")}
                        aria-label=${chatText("compose.voiceInput")}
                        ?disabled=${!props.connected}
                      >
                        ${icons.mic}
                      </button>
                    `
                  : nothing}
              ${!vs.sttRecording && canAbort && (isBusy || props.sending)
                ? html`
                    <button
                      class="chat-send-btn chat-send-btn--stop"
                      @click=${props.onAbort}
                      title=${chatText("compose.stop")}
                      aria-label=${chatText("compose.stopGenerating")}
                    >
                      ${icons.stop}
                    </button>
                  `
                : html`
                    <button
                      class="chat-send-btn"
                      @click=${handleSendClick}
                      ?disabled=${!canSendMessage || props.sending}
                      title=${isBusy ? chatText("compose.queue") : chatText("compose.send")}
                      aria-label=${isBusy
                        ? chatText("compose.queueMessage")
                        : chatText("compose.sendMessage")}
                    >
                      ${icons.send}
                    </button>
                  `}
            </div>
          </div>
        </div>

        ${hasComposerFooter
          ? html`
              <div class="alisio-chat__composer-footer">
                <div class="alisio-chat__composer-footer-left">
                  ${tokens ? html`<span class="agent-chat__token-count">${tokens}</span>` : nothing}
                </div>
                <div class="alisio-chat__composer-footer-right">${securityAccessStrip}</div>
              </div>
            `
          : nothing}
      </div>
    </section>
  `;
}

const CHAT_HISTORY_RENDER_LIMIT = 200;

function resolveToolPhase(message: unknown): "start" | "update" | "result" | null {
  const record = message as Record<string, unknown>;
  if (
    record.toolPhase === "start" ||
    record.toolPhase === "update" ||
    record.toolPhase === "result"
  ) {
    return record.toolPhase;
  }
  const marker = resolveChatMarker(record);
  if (marker?.phase === "start" || marker?.phase === "update" || marker?.phase === "result") {
    return marker.phase;
  }
  return null;
}

function resolveChatMarker(record: Record<string, unknown>): Record<string, unknown> | null {
  const preferred = record[canonicalToolStreamMarkerKey];
  if (preferred && typeof preferred === "object") {
    return preferred as Record<string, unknown>;
  }
  return null;
}

function resolveRunActivity(
  props: Pick<ChatProps, "canAbort" | "finalizing" | "stream" | "toolMessages">,
) {
  if (!props.canAbort && !props.finalizing) {
    return null;
  }

  let activeToolCount = 0;
  let completedToolCount = 0;
  const toolMessages = Array.isArray(props.toolMessages) ? props.toolMessages : [];
  for (const message of toolMessages) {
    const phase = resolveToolPhase(message);
    if (phase === "result") {
      completedToolCount += 1;
      continue;
    }
    if (phase === "start" || phase === "update") {
      activeToolCount += 1;
    }
  }

  const streamText = typeof props.stream === "string" ? props.stream : null;
  const phase: ChatRunActivity["phase"] = props.finalizing
    ? "finalizing"
    : streamText?.trim()
      ? "writing"
      : activeToolCount > 0
        ? "tools"
        : completedToolCount > 0
          ? "finalizing"
          : "thinking";

  return {
    phase,
    activeToolCount,
    completedToolCount,
  } satisfies ChatRunActivity;
}

function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    if (item.kind !== "message") {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

    const normalized = normalizeMessage(item.message);
    const role = normalizeRoleForGrouping(normalized.role);
    const senderLabel = role.toLowerCase() === "user" ? (normalized.senderLabel ?? null) : null;
    const timestamp = normalized.timestamp || Date.now();

    if (
      !currentGroup ||
      currentGroup.role !== role ||
      (role.toLowerCase() === "user" && currentGroup.senderLabel !== senderLabel)
    ) {
      if (currentGroup) {
        result.push(currentGroup);
      }
      currentGroup = {
        kind: "group",
        key: `group:${role}:${item.key}`,
        role,
        senderLabel,
        messages: [{ message: item.message, key: item.key }],
        timestamp,
        isStreaming: false,
      };
    } else {
      currentGroup.messages.push({ message: item.message, key: item.key });
    }
  }

  if (currentGroup) {
    result.push(currentGroup);
  }
  return result;
}

function buildChatItems(props: ChatProps): Array<ChatItem | MessageGroup> {
  const items: ChatItem[] = [];
  const history = Array.isArray(props.messages) ? props.messages : [];
  const tools = Array.isArray(props.toolMessages) ? props.toolMessages : [];
  const runActivity = resolveRunActivity(props);
  const historyStart = Math.max(0, history.length - CHAT_HISTORY_RENDER_LIMIT);
  if (historyStart > 0) {
    items.push({
      kind: "message",
      key: "chat:history:notice",
      message: {
        role: "system",
        content: chatText("history.notice", {
          shown: String(CHAT_HISTORY_RENDER_LIMIT),
          hidden: String(historyStart),
        }),
        timestamp: Date.now(),
      },
    });
  }
  for (let i = historyStart; i < history.length; i++) {
    const msg = history[i];
    const normalized = normalizeMessage(msg);
    const raw = msg as Record<string, unknown>;
    const marker = resolveChatMarker(raw);
    if (marker && marker.kind === "compaction") {
      items.push({
        kind: "divider",
        key:
          typeof marker.id === "string"
            ? `divider:compaction:${marker.id}`
            : `divider:compaction:${normalized.timestamp}:${i}`,
        label: chatText("divider.compaction"),
        timestamp: normalized.timestamp ?? Date.now(),
      });
      continue;
    }

    if (!props.showToolCalls && normalized.role.toLowerCase() === "toolresult") {
      continue;
    }

    // Apply search filter if active
    if (vs.searchOpen && vs.searchQuery.trim() && !messageMatchesSearchQuery(msg, vs.searchQuery)) {
      continue;
    }

    items.push({
      kind: "message",
      key: messageKey(msg, i),
      message: msg,
    });
  }
  // Interleave stream segments and tool cards in order. Each segment
  // contains text that was streaming before the corresponding tool started.
  // This ensures correct visual ordering: text → tool → text → tool → ...
  const segments = props.streamSegments ?? [];
  const maxLen = Math.max(segments.length, tools.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < segments.length && segments[i].text.trim().length > 0) {
      items.push({
        kind: "stream" as const,
        key: `stream-seg:${props.sessionKey}:${i}`,
        text: segments[i].text,
        startedAt: segments[i].ts,
        activity: null,
      });
    }
    if (i < tools.length && props.showToolCalls) {
      items.push({
        kind: "message",
        key: messageKey(tools[i], i + history.length),
        message: tools[i],
      });
    }
  }

  if (props.stream !== null) {
    const key = `stream:${props.sessionKey}:${props.streamStartedAt ?? "live"}`;
    if (props.stream.trim().length > 0) {
      items.push({
        kind: "stream",
        key,
        text: props.stream,
        startedAt: props.streamStartedAt ?? Date.now(),
        activity: runActivity,
      });
    } else if (runActivity) {
      items.push({ kind: "run-status", key, activity: runActivity });
    }
  } else if (runActivity) {
    items.push({
      kind: "run-status",
      key: `run-status:${props.sessionKey}:${tools.length}:${runActivity.phase}`,
      activity: runActivity,
    });
  }

  return groupMessages(items);
}

function resolveTranscriptMessageMeta(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const meta = (message as { __alisio?: unknown }).__alisio;
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : null;
}

function messageKey(message: unknown, index: number): string {
  const m = message as Record<string, unknown>;
  const toolCallId = typeof m.toolCallId === "string" ? m.toolCallId : "";
  if (toolCallId) {
    return `tool:${toolCallId}`;
  }
  const idempotencyKey = typeof m.idempotencyKey === "string" ? m.idempotencyKey : "";
  if (idempotencyKey) {
    return `msg:${idempotencyKey}`;
  }
  const id = typeof m.id === "string" ? m.id : "";
  if (id) {
    return `msg:${id}`;
  }
  const messageId = typeof m.messageId === "string" ? m.messageId : "";
  if (messageId) {
    return `msg:${messageId}`;
  }
  const transcriptMeta = resolveTranscriptMessageMeta(message);
  const transcriptId = typeof transcriptMeta?.id === "string" ? transcriptMeta.id : "";
  if (transcriptId) {
    return `msg:${transcriptId}`;
  }
  const transcriptSeq =
    typeof transcriptMeta?.seq === "number" && Number.isFinite(transcriptMeta.seq)
      ? transcriptMeta.seq
      : null;
  if (transcriptSeq != null) {
    return `msg:seq:${transcriptSeq}`;
  }
  const timestamp = typeof m.timestamp === "number" ? m.timestamp : null;
  const role = typeof m.role === "string" ? m.role : "unknown";
  if (timestamp != null) {
    return `msg:${role}:${timestamp}:${index}`;
  }
  return `msg:${role}:${index}`;
}
