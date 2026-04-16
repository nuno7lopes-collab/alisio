import { html, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.js";
import { isLocalManagedModelRestrictedForSession } from "../../../src/shared/local-model-session-policy.js";
import { t } from "../i18n/index.ts";
import { refreshChat } from "./app-chat.ts";
import { syncUrlWithSessionKey } from "./app-settings.ts";
import type { AppViewState } from "./app-view-state.ts";
import type { AlisioApp } from "./app.ts";
import {
  createChatModelOverride,
  formatChatModelDisplay,
  normalizeChatModelSelectionValue,
  resolvePreferredServerChatModel,
} from "./chat-model-ref.ts";
import { resolveChatModelSelectState } from "./chat-model-select-state.ts";
import { refreshVisibleToolsEffectiveForCurrentSession } from "./controllers/agents.ts";
import {
  ChatState,
  clearChatHistorySnapshot,
  hydrateChatHistoryFromCache,
  loadChatHistory,
  rememberChatHistorySnapshot,
} from "./controllers/chat.ts";
import { loadConfig } from "./controllers/config.ts";
import { loadModelCatalogPair } from "./controllers/models.ts";
import {
  deleteSessionsAndRefresh,
  loadSessions,
  syncSessionMessageSubscription,
} from "./controllers/sessions.ts";
import { icons } from "./icons.ts";
import { iconForTab, pathForTab, publicTabFor, titleForTab, type Tab } from "./navigation.ts";
import type {
  AlisioAiState,
  ConfigSnapshot,
  SessionsListResult,
  SessionsPatchResult,
} from "./types.ts";
import { resolveSessionDisplayName } from "./views/session-display.ts";
export {
  parseSessionKey,
  resolveSessionDisplayName,
  type SessionKeyInfo,
} from "./views/session-display.ts";

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
  mainSessionKey?: string;
  mainKey?: string;
};

let chatModelSwitchSeq = 0;

function nextChatModelSwitchToken(): string {
  chatModelSwitchSeq += 1;
  return `chat-model-switch-${chatModelSwitchSeq}`;
}

function readChatModelSwitchToken(state: AppViewState, sessionKey: string): string | null {
  return state.chatModelSwitchPendingBySession?.[sessionKey] ?? null;
}

function writeChatModelSwitchToken(
  state: AppViewState,
  sessionKey: string,
  token: string | null,
): void {
  const next = { ...state.chatModelSwitchPendingBySession };
  if (token) {
    next[sessionKey] = token;
  } else {
    delete next[sessionKey];
  }
  state.chatModelSwitchPendingBySession = next;
}

export function isChatModelSwitchPending(
  state: AppViewState,
  sessionKey = state.sessionKey,
): boolean {
  return Boolean(readChatModelSwitchToken(state, sessionKey));
}

function resolveGatewayHttpOrigin(rawUrl: string, pageHref: string): string | null {
  try {
    const parsed = new URL(rawUrl, pageHref);
    let protocol = parsed.protocol;
    if (protocol === "ws:") {
      protocol = "http:";
    } else if (protocol === "wss:") {
      protocol = "https:";
    }
    if (protocol !== "http:" && protocol !== "https:") {
      return null;
    }
    return `${protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function resolveAlisioOpenAiCallbackUrl(
  state: Pick<AppViewState, "gatewayBootstrapUrl" | "alisioStartupBootstrap" | "settings">,
  pageHref?: string,
): string {
  const currentPageHref =
    pageHref ?? (typeof window === "undefined" ? "http://localhost/" : window.location.href);
  const gatewayCandidates = [
    state.gatewayBootstrapUrl,
    state.alisioStartupBootstrap?.controlUrl,
    state.settings.gatewayUrl,
  ];
  for (const candidate of gatewayCandidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }
    const origin = resolveGatewayHttpOrigin(trimmed, currentPageHref);
    if (origin) {
      return new URL("/__alisio/auth/openai/callback", origin).toString();
    }
  }
  return new URL("/__alisio/auth/openai/callback", currentPageHref).toString();
}

export function resolveAlisioAccountCallbackUrl(
  state: Pick<AppViewState, "gatewayBootstrapUrl" | "alisioStartupBootstrap" | "settings">,
  pageHref?: string,
): string {
  const currentPageHref =
    pageHref ?? (typeof window === "undefined" ? "http://localhost/" : window.location.href);
  const gatewayCandidates = [
    state.gatewayBootstrapUrl,
    state.alisioStartupBootstrap?.controlUrl,
    state.settings.gatewayUrl,
  ];
  for (const candidate of gatewayCandidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) {
      continue;
    }
    const origin = resolveGatewayHttpOrigin(trimmed, currentPageHref);
    if (origin) {
      return new URL("/__alisio/auth/account/callback", origin).toString();
    }
  }
  return new URL("/__alisio/auth/account/callback", currentPageHref).toString();
}

export function resolveEffectiveAlisioAiState(
  state: Pick<AppViewState, "alisioBootstrap" | "alisioStartupBootstrap">,
): AlisioAiState | null {
  return state.alisioBootstrap?.ai ?? state.alisioStartupBootstrap?.ai ?? null;
}

function resolveNewChatAgentId(state: AppViewState): string {
  const currentAgentId = parseAgentSessionKey(state.sessionKey)?.agentId?.trim();
  if (currentAgentId) {
    return currentAgentId;
  }
  const assistantAgentId = state.assistantAgentId?.trim();
  if (assistantAgentId) {
    return assistantAgentId;
  }
  const snapshot = state.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  return snapshot?.sessionDefaults?.defaultAgentId?.trim() || "main";
}

export function renderTab(
  state: AppViewState,
  tab: Tab,
  opts?: { collapsed?: boolean; variant?: "list" | "panel" | "rail" },
) {
  const href = pathForTab(tab, state.basePath);
  const isActive = publicTabFor(state.tab) === publicTabFor(tab);
  const variant = opts?.variant ?? "panel";
  const collapsed = opts?.collapsed ?? state.settings.navCollapsed;
  const showText = variant !== "rail" && !collapsed;
  return html`
    <a
      href=${href}
      class="nav-item nav-item--${variant} ${isActive ? "nav-item--active" : ""}"
      data-tab=${publicTabFor(tab)}
      aria-current=${isActive ? "page" : "false"}
      @click=${(event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        state.setTab(tab);
      }}
      title=${titleForTab(tab)}
    >
      <span class="nav-item__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
      ${showText ? html`<span class="nav-item__text">${titleForTab(tab)}</span>` : nothing}
    </a>
  `;
}

function renderCronFilterIcon(hiddenCount: number) {
  return html`
    <span style="position: relative; display: inline-flex; align-items: center;">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      ${hiddenCount > 0
        ? html`<span
            style="
              position: absolute;
              top: -5px;
              right: -6px;
              background: var(--color-accent, #6366f1);
              color: #fff;
              border-radius: var(--radius-full);
              font-size: 9px;
              line-height: 1;
              padding: 1px 3px;
              pointer-events: none;
            "
            >${hiddenCount}</span
          >`
        : ""}
    </span>
  `;
}

export function renderChatSessionSelect(state: AppViewState) {
  return html`
    <div class="chat-controls__session-row">
      ${renderChatSessionField(state)} ${renderChatModelSelect(state)}
    </div>
  `;
}

export function renderChatSessionPicker(
  state: AppViewState,
  opts: { surface?: "desktop" | "mobile" } = {},
) {
  return opts.surface === "mobile"
    ? renderChatSessionField(state)
    : renderChatSessionDropdown(state);
}

export function renderChatComposerModelSelect(state: AppViewState) {
  return renderChatModelSelect(state, { variant: "composer" });
}

export function renderChatDesktopToolbar(
  state: AppViewState,
  opts: { searchButton?: TemplateResult | typeof nothing; surface?: "inline" | "topbar" } = {},
) {
  const surface = opts.surface ?? "inline";
  return html`
    <div
      class="alisio-chat-toolbar ${surface === "topbar" ? "alisio-chat-toolbar--topbar" : ""}"
      role="toolbar"
      aria-label=${t("alisio.shell.chatSettings")}
    >
      <div class="alisio-chat-toolbar__primary">
        ${renderChatNewConversationButton(state)} ${renderChatSessionPicker(state)}
      </div>
      <div class="alisio-chat-toolbar__secondary">
        ${renderChatControls(state)} ${opts.searchButton ?? nothing}
      </div>
    </div>
  `;
}

function renderChatNewConversationButton(state: AppViewState) {
  const disabled =
    !state.connected ||
    !state.client ||
    state.chatLoading ||
    state.chatSending ||
    Boolean(state.chatRunId) ||
    Boolean(state.chatFinalizing);
  return html`
    <button
      type="button"
      class="btn btn--sm"
      title=${t("chat.newConversationTitle")}
      ?disabled=${disabled}
      @click=${async () => {
        if (!state.client) {
          return;
        }
        const created = await state.client.request<{ key?: string }>("sessions.create", {
          agentId: resolveNewChatAgentId(state),
        });
        const nextSessionKey = created?.key?.trim();
        if (!nextSessionKey) {
          return;
        }
        switchChatSession(state, nextSessionKey);
      }}
    >
      ${icons.plus} ${t("chat.newConversation")}
    </button>
  `;
}

function resolveCurrentSessionRow(
  state: AppViewState,
  key = state.sessionKey,
): SessionsListResult["sessions"][number] | undefined {
  return state.sessionsResult?.sessions.find((row) => row.key === key);
}

function resolveCurrentSessionTitle(state: AppViewState, key = state.sessionKey): string {
  const row = resolveCurrentSessionRow(state, key);
  return resolveSessionDisplayName(key, row).trim() || t("chat.newConversation");
}

function resolveCurrentSessionRenameDraft(state: AppViewState, key = state.sessionKey): string {
  const row = resolveCurrentSessionRow(state, key);
  return row?.label?.trim() || resolveCurrentSessionTitle(state, key);
}

function canMutateSession(state: AppViewState, key = state.sessionKey): boolean {
  return Boolean(state.client && state.connected && key.trim());
}

function resolveEventTargetRoot(eventTarget: EventTarget | null): Document | ShadowRoot | null {
  if (!(eventTarget instanceof Node)) {
    return null;
  }
  const root = eventTarget.getRootNode();
  return root instanceof ShadowRoot || root instanceof Document ? root : null;
}

function focusChatSessionRenameInput(eventTarget: EventTarget | null, key: string) {
  const root = resolveEventTargetRoot(eventTarget);
  if (!root) {
    return;
  }
  requestAnimationFrame(() => {
    const input = root.querySelector<HTMLInputElement>(`[data-chat-session-rename-input="${key}"]`);
    input?.focus();
    input?.select();
  });
}

function isSessionMutationLocked(state: AppViewState, key = state.sessionKey): boolean {
  if (!canMutateSession(state, key) || state.chatSessionRenamePending || state.sessionsLoading) {
    return true;
  }
  if (key !== state.sessionKey) {
    return false;
  }
  return (
    state.chatLoading ||
    state.chatSending ||
    Boolean(state.chatRunId) ||
    Boolean(state.chatFinalizing)
  );
}

function beginChatSessionRename(state: AppViewState, key: string, eventTarget: EventTarget | null) {
  if (isSessionMutationLocked(state, key)) {
    return;
  }
  state.chatSessionRenameKey = key;
  state.chatSessionRenameDraft = resolveCurrentSessionRenameDraft(state, key);
  state.chatSessionRenamePending = false;
  focusChatSessionRenameInput(eventTarget, key);
}

function cancelChatSessionRename(state: AppViewState) {
  state.chatSessionRenameKey = null;
  state.chatSessionRenameDraft = "";
  state.chatSessionRenamePending = false;
}

function resolveSessionDefaultsSnapshot(state: AppViewState): SessionDefaultsSnapshot | null {
  const snapshot = state.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  return snapshot?.sessionDefaults ?? null;
}

function resolveSessionAgentId(state: AppViewState, key: string): string | null {
  const parsed = parseAgentSessionKey(key);
  if (parsed?.agentId?.trim()) {
    return parsed.agentId.trim();
  }
  const defaults = resolveSessionDefaultsSnapshot(state);
  const defaultAgentId = defaults?.defaultAgentId?.trim() || resolveNewChatAgentId(state);
  const raw = key.trim();
  const mainKey = defaults?.mainKey?.trim() || "main";
  if (raw === "main" || raw === mainKey) {
    return defaultAgentId;
  }
  return null;
}

function resolveAgentMainSessionKey(state: AppViewState, agentId: string): string {
  const defaults = resolveSessionDefaultsSnapshot(state);
  const normalizedAgentId = agentId.trim();
  const defaultAgentId = defaults?.defaultAgentId?.trim();
  if (
    defaults?.mainSessionKey?.trim() &&
    defaultAgentId &&
    defaultAgentId.toLowerCase() === normalizedAgentId.toLowerCase()
  ) {
    return defaults.mainSessionKey.trim();
  }
  return `agent:${normalizedAgentId}:${defaults?.mainKey?.trim() || "main"}`;
}

function isAgentMainConversation(state: AppViewState, key: string, agentId: string): boolean {
  const parsed = parseAgentSessionKey(key);
  const defaults = resolveSessionDefaultsSnapshot(state);
  const mainKey = defaults?.mainKey?.trim() || "main";
  const normalizedAgentId = agentId.trim().toLowerCase();
  if (parsed) {
    return (
      parsed.agentId.trim().toLowerCase() === normalizedAgentId &&
      (parsed.rest.trim() === "main" || parsed.rest.trim() === mainKey)
    );
  }
  const raw = key.trim();
  if (raw !== "main" && raw !== mainKey) {
    return false;
  }
  const resolvedAgentId = resolveSessionAgentId(state, key);
  return resolvedAgentId?.toLowerCase() === normalizedAgentId;
}

function resolveFallbackSessionKeyAfterDelete(state: AppViewState, deletedKey: string): string {
  const rows = state.sessionsResult?.sessions ?? [];
  const preferredAgentId =
    resolveSessionAgentId(state, deletedKey) ??
    resolveSessionAgentId(state, state.sessionKey) ??
    resolveNewChatAgentId(state);

  const sameAgentMain = rows.find(
    (row) => preferredAgentId && isAgentMainConversation(state, row.key, preferredAgentId),
  );
  if (sameAgentMain?.key) {
    return sameAgentMain.key;
  }

  const sameAgentConversation = rows.find(
    (row) =>
      preferredAgentId &&
      resolveSessionAgentId(state, row.key)?.toLowerCase() === preferredAgentId.toLowerCase(),
  );
  if (sameAgentConversation?.key) {
    return sameAgentConversation.key;
  }

  if (rows[0]?.key) {
    return rows[0].key;
  }

  return resolveAgentMainSessionKey(state, preferredAgentId);
}

async function commitChatSessionRename(
  state: AppViewState,
  eventTarget?: EventTarget | null,
): Promise<void> {
  if (state.chatSessionRenamePending) {
    return;
  }
  const targetKey = state.chatSessionRenameKey?.trim();
  if (!targetKey) {
    cancelChatSessionRename(state);
    return;
  }
  const row = resolveCurrentSessionRow(state, targetKey);
  const explicitLabel = row?.label?.trim() || "";
  const currentTitle = resolveCurrentSessionTitle(state, targetKey);
  const nextLabel = state.chatSessionRenameDraft.trim();

  if (!nextLabel && !explicitLabel) {
    cancelChatSessionRename(state);
    return;
  }
  if (
    (explicitLabel && nextLabel === explicitLabel) ||
    (!explicitLabel && nextLabel === currentTitle)
  ) {
    closeChatSessionDropdown(eventTarget ?? null);
    cancelChatSessionRename(state);
    return;
  }
  if (!state.client || !state.connected) {
    cancelChatSessionRename(state);
    return;
  }

  state.chatSessionRenamePending = true;
  state.lastError = null;
  try {
    await state.client.request<SessionsPatchResult>("sessions.patch", {
      key: targetKey,
      label: nextLabel || null,
    });
    closeChatSessionDropdown(eventTarget ?? null);
    cancelChatSessionRename(state);
    await refreshSessionOptions(state);
  } catch (err) {
    state.chatSessionRenamePending = false;
    state.lastError = `Failed to rename chat: ${String(err)}`;
    focusChatSessionRenameInput(eventTarget ?? null, targetKey);
  }
}

async function deleteChatSession(
  state: AppViewState,
  key: string,
  eventTarget?: EventTarget | null,
): Promise<void> {
  if (isSessionMutationLocked(state, key)) {
    return;
  }
  cancelChatSessionRename(state);
  const wasActive = key === state.sessionKey;
  const deleted = await deleteSessionsAndRefresh(state, [key]);
  if (!deleted.includes(key)) {
    return;
  }
  closeChatSessionDropdown(eventTarget ?? null);
  if (!wasActive) {
    clearChatHistorySnapshot(state as unknown as ChatState, key);
    return;
  }
  const nextKey = resolveFallbackSessionKeyAfterDelete(state, key);
  if (nextKey) {
    switchChatSession(state, nextKey);
  }
  clearChatHistorySnapshot(state as unknown as ChatState, key);
}

function renderChatSessionDropdown(state: AppViewState) {
  const title = resolveCurrentSessionTitle(state);
  const sessionGroups = resolveSessionOptionGroups(state, state.sessionKey, state.sessionsResult);
  const dropdownDisabled = !state.connected || sessionGroups.length === 0;
  return html`
    <details class="chat-session-dropdown ${dropdownDisabled ? "is-disabled" : ""}">
      <summary
        class="chat-session-dropdown__trigger"
        data-chat-session-dropdown-trigger="true"
        title=${title}
        aria-label=${t("chat.switchConversation")}
        @click=${(event: Event) => {
          if (dropdownDisabled) {
            event.preventDefault();
          }
        }}
      >
        <span class="chat-session-dropdown__trigger-text">${title}</span>
        <span class="chat-session-dropdown__trigger-icon" aria-hidden="true"
          >${icons.chevronDown}</span
        >
      </summary>
      <div class="chat-session-dropdown__panel">
        ${repeat(
          sessionGroups,
          (group) => group.id,
          (group) => html`
            <div class="chat-session-dropdown__group">
              <div class="chat-session-dropdown__group-label">${group.label}</div>
              ${repeat(
                group.options,
                (entry) => entry.key,
                (entry) => {
                  const editing = state.chatSessionRenameKey === entry.key;
                  const locked = isSessionMutationLocked(state, entry.key);
                  const renameTitle = t("chat.renameConversationTitle");
                  const deleteTitle = t("chat.deleteConversationTitle");
                  return html`
                    <div
                      class="chat-session-dropdown__row ${entry.key === state.sessionKey
                        ? "is-active"
                        : ""} ${editing ? "is-editing" : ""}"
                    >
                      ${editing
                        ? html`
                            <input
                              class="chat-session-dropdown__input"
                              data-chat-session-rename-input=${entry.key}
                              .value=${state.chatSessionRenameDraft}
                              ?disabled=${state.chatSessionRenamePending}
                              placeholder=${t("chat.renameConversationPlaceholder")}
                              @click=${(event: Event) => event.stopPropagation()}
                              @input=${(event: InputEvent) => {
                                state.chatSessionRenameDraft = (
                                  event.target as HTMLInputElement
                                ).value;
                              }}
                              @blur=${(event: FocusEvent) =>
                                void commitChatSessionRename(state, event.currentTarget)}
                              @keydown=${(event: KeyboardEvent) => {
                                event.stopPropagation();
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void commitChatSessionRename(state, event.currentTarget);
                                  return;
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelChatSessionRename(state);
                                }
                              }}
                            />
                          `
                        : html`
                            <button
                              type="button"
                              class="chat-session-dropdown__select"
                              data-chat-session-select-button=${entry.key}
                              title=${entry.title}
                              @click=${(event: Event) => {
                                closeChatSessionDropdown(event.currentTarget);
                                if (entry.key !== state.sessionKey) {
                                  switchChatSession(state, entry.key);
                                }
                              }}
                              @dblclick=${(event: MouseEvent) => {
                                event.preventDefault();
                                event.stopPropagation();
                                beginChatSessionRename(state, entry.key, event.currentTarget);
                              }}
                            >
                              <span class="chat-session-dropdown__label">${entry.label}</span>
                            </button>
                          `}
                      <div class="chat-session-dropdown__actions">
                        <button
                          type="button"
                          class="chat-session-dropdown__action"
                          data-chat-session-rename-button=${entry.key}
                          title=${renameTitle}
                          aria-label=${renameTitle}
                          ?disabled=${locked}
                          @click=${(event: Event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            beginChatSessionRename(state, entry.key, event.currentTarget);
                          }}
                        >
                          ${icons.edit}
                        </button>
                        <button
                          type="button"
                          class="chat-session-dropdown__action chat-session-dropdown__action--danger"
                          data-chat-session-delete-button=${entry.key}
                          title=${deleteTitle}
                          aria-label=${deleteTitle}
                          ?disabled=${locked}
                          @click=${(event: Event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void deleteChatSession(state, entry.key, event.currentTarget);
                          }}
                        >
                          ${icons.trash}
                        </button>
                      </div>
                    </div>
                  `;
                },
              )}
            </div>
          `,
        )}
      </div>
    </details>
  `;
}

export function renderChatControls(state: AppViewState) {
  const hideCron = state.sessionsHideCron ?? true;
  const hiddenCronCount = hideCron
    ? countHiddenCronSessions(state.sessionKey, state.sessionsResult)
    : 0;
  const showThinking = state.settings.chatShowThinking;
  const showToolCalls = state.settings.chatShowToolCalls;
  const focusActive = state.settings.chatFocusMode;
  const hasMenuOverrides = focusActive || !showThinking || !showToolCalls || !hideCron;
  return html`
    <details class="chat-tools-menu ${hasMenuOverrides ? "chat-tools-menu--active" : ""}">
      <summary
        class="chat-tools-menu__trigger"
        title=${t("alisio.shell.chatSettings")}
        aria-label=${t("alisio.shell.chatSettings")}
      >
        ${icons.moreHorizontal}
      </summary>
      <div class="chat-tools-menu__panel">
        ${renderChatToolsMenuItems(state, { hiddenCronCount })}
      </div>
    </details>
  `;
}

type ChatToolsMenuAction = {
  icon: TemplateResult;
  label: string;
  title: string;
  onClick: (event: Event) => void | Promise<void>;
  active?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  stateLabel?: string;
};

function renderChatToolsMenuItems(
  state: AppViewState,
  opts: { hiddenCronCount: number },
): TemplateResult {
  const hideCron = state.sessionsHideCron ?? true;
  const disableThinkingToggle = false;
  const disableFocusToggle = false;
  const showThinking = state.settings.chatShowThinking;
  const showToolCalls = state.settings.chatShowToolCalls;
  const focusActive = state.settings.chatFocusMode;
  return html`
    ${renderChatToolsMenuAction({
      icon: renderRefreshIcon(),
      label: t("chat.menuRefresh"),
      title: t("chat.refreshTitle"),
      onClick: async (event) => {
        closeChatToolsSurface(event.currentTarget);
        const app = state as unknown as AlisioApp;
        const preserveEphemeral = Boolean(app.chatRunId || app.chatFinalizing);
        app.chatManualRefreshInFlight = true;
        app.chatNewMessagesBelow = false;
        await app.updateComplete;
        if (!preserveEphemeral) {
          app.resetToolStream();
        }
        try {
          await refreshChat(state as unknown as Parameters<typeof refreshChat>[0], {
            scheduleScroll: false,
          });
          app.scrollToBottom({ smooth: true });
        } finally {
          requestAnimationFrame(() => {
            app.chatManualRefreshInFlight = false;
            app.chatNewMessagesBelow = false;
          });
        }
      },
      disabled: state.chatLoading || !state.connected,
    })}
    ${renderChatToolsMenuAction({
      icon: icons.brain,
      label: t("chat.menuThinking"),
      title: disableThinkingToggle ? t("chat.onboardingDisabled") : t("chat.thinkingToggle"),
      onClick: (event) => {
        if (disableThinkingToggle) {
          return;
        }
        closeChatToolsSurface(event.currentTarget);
        state.applySettings({
          ...state.settings,
          chatShowThinking: !state.settings.chatShowThinking,
        });
      },
      active: showThinking,
      stateLabel: showThinking ? t("chat.menuOn") : t("chat.menuOff"),
      pressed: showThinking,
      disabled: disableThinkingToggle,
    })}
    ${renderChatToolsMenuAction({
      icon: icons.wrench,
      label: t("chat.menuToolCalls"),
      title: disableThinkingToggle ? t("chat.onboardingDisabled") : t("chat.toolCallsToggle"),
      onClick: (event) => {
        if (disableThinkingToggle) {
          return;
        }
        closeChatToolsSurface(event.currentTarget);
        state.applySettings({
          ...state.settings,
          chatShowToolCalls: !state.settings.chatShowToolCalls,
        });
      },
      active: showToolCalls,
      stateLabel: showToolCalls ? t("chat.menuOn") : t("chat.menuOff"),
      pressed: showToolCalls,
      disabled: disableThinkingToggle,
    })}
    ${renderChatToolsMenuAction({
      icon: renderFocusIcon(),
      label: t("chat.menuFocus"),
      title: disableFocusToggle ? t("chat.onboardingDisabled") : t("chat.focusToggle"),
      onClick: (event) => {
        if (disableFocusToggle) {
          return;
        }
        closeChatToolsSurface(event.currentTarget);
        state.applySettings({
          ...state.settings,
          chatFocusMode: !state.settings.chatFocusMode,
        });
      },
      active: focusActive,
      stateLabel: focusActive ? t("chat.menuOn") : t("chat.menuOff"),
      pressed: focusActive,
      disabled: disableFocusToggle,
    })}
    ${renderChatToolsMenuAction({
      icon: renderCronFilterIcon(opts.hiddenCronCount),
      label: t("chat.menuCron"),
      title: hideCron
        ? opts.hiddenCronCount > 0
          ? t("chat.showCronSessionsHidden", { count: String(opts.hiddenCronCount) })
          : t("chat.showCronSessions")
        : t("chat.hideCronSessions"),
      onClick: (event) => {
        closeChatToolsSurface(event.currentTarget);
        state.applySettings({
          ...state.settings,
          chatHideCronSessions: !hideCron,
        });
      },
      active: hideCron,
      stateLabel: hideCron ? t("chat.menuHidden") : t("chat.menuVisible"),
      pressed: hideCron,
    })}
  `;
}

function renderChatToolsMenuAction(action: ChatToolsMenuAction) {
  return html`
    <button
      type="button"
      class="chat-tools-menu__item ${action.active ? "is-active" : ""}"
      title=${action.title}
      aria-label=${action.title}
      aria-pressed=${action.pressed === undefined ? nothing : action.pressed}
      ?disabled=${action.disabled}
      @click=${action.onClick}
    >
      <span class="chat-tools-menu__item-main">
        <span class="chat-tools-menu__item-icon">${action.icon}</span>
        <span class="chat-tools-menu__item-label">${action.label}</span>
      </span>
      ${action.stateLabel
        ? html`<span class="chat-tools-menu__item-state">${action.stateLabel}</span>`
        : nothing}
    </button>
  `;
}

function closeDetailsSurface(target: EventTarget | null, selector: string) {
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const details = target.closest(selector);
  if (details instanceof HTMLDetailsElement) {
    details.open = false;
  }
}

function closeChatToolsSurface(target: EventTarget | null) {
  closeDetailsSurface(target, "details.chat-tools-menu");
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const dropdown = target.closest(".chat-controls-dropdown");
  if (dropdown instanceof HTMLElement) {
    dropdown.classList.remove("open");
  }
}

function closeChatSessionDropdown(target: EventTarget | null) {
  closeDetailsSurface(target, "details.chat-session-dropdown");
}

function renderRefreshIcon() {
  return html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
    </svg>
  `;
}

function renderFocusIcon() {
  return html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 7V4h3"></path>
      <path d="M20 7V4h-3"></path>
      <path d="M4 17v3h3"></path>
      <path d="M20 17v3h-3"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
}

function renderChatSessionField(state: AppViewState) {
  const sessionGroups = resolveSessionOptionGroups(state, state.sessionKey, state.sessionsResult);
  return html`
    <label class="chat-select-chip chat-select-chip--session chat-controls__session">
      <span class="chat-select-chip__icon" aria-hidden="true">${icons.brain}</span>
      <select
        data-chat-session-select="true"
        aria-label=${t("alisio.shell.sessions.session")}
        .value=${state.sessionKey}
        ?disabled=${!state.connected || sessionGroups.length === 0}
        @change=${(e: Event) => {
          const next = (e.target as HTMLSelectElement).value;
          if (state.sessionKey === next) {
            return;
          }
          switchChatSession(state, next);
        }}
      >
        ${repeat(
          sessionGroups,
          (group) => group.id,
          (group) =>
            html`<optgroup label=${group.label}>
              ${repeat(
                group.options,
                (entry) => entry.key,
                (entry) =>
                  html`<option value=${entry.key} title=${entry.title}>${entry.label}</option>`,
              )}
            </optgroup>`,
        )}
      </select>
      <span class="chat-select-chip__chevron" aria-hidden="true">${icons.chevronDown}</span>
    </label>
  `;
}

/**
 * Mobile-only compact dropdown for chat controls.
 * Rendered in the topbar so it doesn't consume content-header space.
 * Hidden on desktop via CSS.
 */
export function renderChatMobileToggle(state: AppViewState) {
  const hiddenCronCount = countHiddenCronSessions(state.sessionKey, state.sessionsResult);
  return html`
    <div class="chat-mobile-controls-wrapper">
      <button
        class="btn btn--sm btn--icon chat-controls-mobile-toggle"
        @click=${(e: Event) => {
          e.stopPropagation();
          const btn = e.currentTarget as HTMLElement;
          const dropdown = btn.nextElementSibling as HTMLElement;
          if (dropdown) {
            const isOpen = dropdown.classList.toggle("open");
            if (isOpen) {
              const close = () => {
                dropdown.classList.remove("open");
                document.removeEventListener("click", close);
              };
              setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
            }
          }
        }}
        title=${t("alisio.shell.chatSettings")}
        aria-label=${t("alisio.shell.chatSettings")}
      >
        ${icons.moreHorizontal}
      </button>
      <div
        class="chat-controls-dropdown"
        @click=${(e: Event) => {
          e.stopPropagation();
        }}
      >
        <div class="chat-tools-menu__panel chat-tools-menu__panel--mobile">
          <div class="chat-tools-menu__session">
            ${renderChatNewConversationButton(state)}
            ${renderChatSessionPicker(state, { surface: "mobile" })}
          </div>
          ${renderChatToolsMenuItems(state, { hiddenCronCount })}
        </div>
      </div>
    </div>
  `;
}

export function switchChatSession(state: AppViewState, nextSessionKey: string) {
  const previousSessionKey = state.sessionKey;
  if (previousSessionKey === nextSessionKey) {
    return;
  }
  rememberChatHistorySnapshot(state as unknown as ChatState, {
    sessionKey: previousSessionKey,
  });
  state.sessionKey = nextSessionKey;
  state.chatSessionRenameKey = null;
  state.chatSessionRenameDraft = "";
  state.chatSessionRenamePending = false;
  state.chatMessage = "";
  state.chatAttachments = [];
  state.chatStream = null;
  // P1: Clear queued chat items from the previous session
  (state as unknown as { chatQueue: unknown[] }).chatQueue = [];
  (state as unknown as AlisioApp).chatStreamStartedAt = null;
  state.chatRunId = null;
  state.chatFinalizing = false;
  (state as unknown as AlisioApp).resetToolStream();
  (state as unknown as AlisioApp).resetChatScroll();
  const hydratedFromCache = hydrateChatHistoryFromCache(
    state as unknown as ChatState,
    nextSessionKey,
  );
  if (!hydratedFromCache) {
    state.chatMessages = [];
    state.chatThinkingLevel = null;
  } else {
    state.chatLoading = false;
  }
  state.applySettings({
    ...state.settings,
    sessionKey: nextSessionKey,
    lastActiveSessionKey: nextSessionKey,
  });
  if (shouldRefreshAssistantIdentityAfterSwitch(state, previousSessionKey, nextSessionKey)) {
    void state.loadAssistantIdentity();
  }
  syncUrlWithSessionKey(
    state as unknown as Parameters<typeof syncUrlWithSessionKey>[0],
    nextSessionKey,
    true,
  );
  void syncSessionMessageSubscription(
    state as unknown as Parameters<typeof syncSessionMessageSubscription>[0],
  );
  void loadChatHistory(state as unknown as ChatState, {
    silent: hydratedFromCache,
  });
  if (shouldRefreshSessionOptionsAfterSwitch(state, nextSessionKey)) {
    void refreshSessionOptions(state);
  }
}

async function refreshSessionOptions(state: AppViewState) {
  await loadSessions(state as unknown as Parameters<typeof loadSessions>[0], {
    activeMinutes: 0,
    limit: 0,
    includeGlobal: true,
    includeUnknown: true,
  });
}

function shouldRefreshAssistantIdentityAfterSwitch(
  state: AppViewState,
  previousSessionKey: string,
  nextSessionKey: string,
): boolean {
  const nextAgentId = resolveSessionAgentId(state, nextSessionKey)?.trim().toLowerCase();
  if (!nextAgentId) {
    return true;
  }
  const currentIdentityAgentId = state.assistantAgentId?.trim().toLowerCase();
  if (currentIdentityAgentId === nextAgentId) {
    return false;
  }
  const previousAgentId = resolveSessionAgentId(state, previousSessionKey)?.trim().toLowerCase();
  return previousAgentId !== nextAgentId || currentIdentityAgentId !== nextAgentId;
}

function shouldRefreshSessionOptionsAfterSwitch(
  state: AppViewState,
  nextSessionKey: string,
): boolean {
  const sessions = state.sessionsResult?.sessions;
  if (!sessions || sessions.length === 0) {
    return true;
  }
  return !sessions.some((row) => row.key === nextSessionKey);
}

function renderChatModelSelect(
  state: AppViewState,
  opts: { variant?: "toolbar" | "composer" } = {},
) {
  const { currentOverride, defaultDisplay, defaultLabel, defaultModel, options } =
    resolveChatModelSelectState(state);
  const variant = opts.variant ?? "toolbar";
  const compactLabels = variant === "composer";
  const selectDefaultLabel =
    compactLabels && defaultDisplay.trim().length > 0
      ? compactComposerModelLabel(defaultDisplay, defaultModel)
      : defaultLabel;
  const selectOptions = compactLabels ? buildCompactComposerModelOptions(options) : options;
  const switchingModel = isChatModelSwitchPending(state);
  const busy =
    state.chatLoading ||
    state.chatSending ||
    Boolean(state.chatRunId) ||
    Boolean(state.chatFinalizing) ||
    state.chatStream !== null ||
    switchingModel;
  const disabled =
    !state.connected || busy || (state.chatModelsLoading && options.length === 0) || !state.client;
  return html`
    <label
      class="chat-select-chip chat-select-chip--model chat-controls__model chat-controls__model--${variant}"
      title=${defaultLabel}
    >
      <select
        data-chat-model-select="true"
        aria-label=${t("chat.modelSelect")}
        ?disabled=${disabled}
        @change=${async (e: Event) => {
          const next = (e.target as HTMLSelectElement).value.trim();
          await switchChatModel(state, next);
        }}
      >
        <option value="" ?selected=${currentOverride === ""}>${selectDefaultLabel}</option>
        ${repeat(
          selectOptions,
          (entry) => entry.value,
          (entry) =>
            html`<option value=${entry.value} ?selected=${entry.value === currentOverride}>
              ${entry.label}
            </option>`,
        )}
      </select>
      <span class="chat-select-chip__chevron" aria-hidden="true">${icons.chevronDown}</span>
    </label>
  `;
}

function buildCompactComposerModelOptions(
  options: readonly { value: string; label: string }[],
): Array<{ value: string; label: string }> {
  const compacted = options.map((option) => ({
    value: option.value,
    label: compactComposerModelLabel(option.label, option.value),
    originalLabel: option.label,
  }));

  const counts = new Map<string, number>();
  for (const option of compacted) {
    counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
  }

  return compacted.map((option) => ({
    value: option.value,
    label: (counts.get(option.label) ?? 0) > 1 ? option.originalLabel : option.label,
  }));
}

function compactComposerModelLabel(label: string, value: string): string {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    return value.trim();
  }
  if (trimmedLabel.startsWith("Default (")) {
    return "Default";
  }
  const separator = trimmedLabel.indexOf(" · ");
  if (separator > 0) {
    return formatChatModelDisplay(trimmedLabel.slice(0, separator).trim());
  }
  const qualifiedSeparator = value.indexOf("/");
  if (qualifiedSeparator > 0) {
    return formatChatModelDisplay(value.slice(qualifiedSeparator + 1).trim());
  }
  return trimmedLabel;
}

async function switchChatModel(state: AppViewState, nextModel: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const trimmedNextModel = nextModel.trim();
  const slash = trimmedNextModel.indexOf("/");
  const nextProvider = slash > 0 ? trimmedNextModel.slice(0, slash) : "";
  if (
    isLocalManagedModelRestrictedForSession({
      providerId: nextProvider,
      sessionKey: state.sessionKey,
    })
  ) {
    state.lastError = "Local models are only available for subagent sessions.";
    return;
  }
  const { currentOverride, defaultModel } = resolveChatModelSelectState(state);
  const nextOverrideValue = normalizeChatModelSelectionValue(nextModel, defaultModel);
  if (currentOverride === nextOverrideValue) {
    return;
  }
  const targetSessionKey = state.sessionKey;
  const prevOverride = state.chatModelOverrides[targetSessionKey];
  const requestToken = nextChatModelSwitchToken();
  state.lastError = null;
  // Write the override cache immediately so the picker stays in sync during the RPC round-trip.
  state.chatModelOverrides = {
    ...state.chatModelOverrides,
    [targetSessionKey]: createChatModelOverride(nextOverrideValue),
  };
  writeChatModelSwitchToken(state, targetSessionKey, requestToken);
  try {
    const patched = await state.client.request<SessionsPatchResult>("sessions.patch", {
      key: targetSessionKey,
      model: nextOverrideValue || null,
    });
    if (readChatModelSwitchToken(state, targetSessionKey) !== requestToken) {
      return;
    }
    const resolvedValue = resolvePreferredServerChatModel(
      patched?.resolved?.model ?? nextOverrideValue,
      patched?.resolved?.modelProvider,
      state.chatModelCatalog ?? [],
    ).value;
    state.chatModelOverrides = {
      ...state.chatModelOverrides,
      [targetSessionKey]: createChatModelOverride(
        normalizeChatModelSelectionValue(resolvedValue, defaultModel),
      ),
    };
    if (state.sessionKey === targetSessionKey) {
      void refreshVisibleToolsEffectiveForCurrentSession(state);
    }
    await refreshSessionOptions(state);
  } catch (err) {
    if (readChatModelSwitchToken(state, targetSessionKey) !== requestToken) {
      return;
    }
    // Roll back so the picker reflects the actual server model.
    state.chatModelOverrides = { ...state.chatModelOverrides, [targetSessionKey]: prevOverride };
    state.lastError = `Failed to set model: ${String(err)}`;
  } finally {
    if (readChatModelSwitchToken(state, targetSessionKey) === requestToken) {
      writeChatModelSwitchToken(state, targetSessionKey, null);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveConfiguredDefaultModelAllowlist(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!isRecord(config)) {
    return null;
  }
  const agents = config.agents;
  if (!isRecord(agents)) {
    return null;
  }
  const defaults = agents.defaults;
  if (!isRecord(defaults)) {
    return null;
  }
  const models = defaults.models;
  if (!isRecord(models) || Object.keys(models).length === 0) {
    return null;
  }
  return models;
}

function buildDefaultChatModelPatch(
  model: string,
  config: Record<string, unknown> | null | undefined,
) {
  const allowlist = resolveConfiguredDefaultModelAllowlist(config);
  return {
    agents: {
      defaults: {
        model: {
          primary: model,
        },
        ...(allowlist
          ? {
              models: {
                ...allowlist,
                [model]: allowlist[model] ?? {},
              },
            }
          : {}),
      },
    },
  };
}

async function refreshModelPickerCatalogs(state: AppViewState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.chatModelsLoading = true;
  state.modelManagementLoading = true;
  try {
    const pair = await loadModelCatalogPair(state.client);
    if (!pair) {
      return;
    }
    state.chatModelCatalog = pair.chatCatalog;
    state.modelManagementCatalog = pair.managementCatalog;
  } catch {
    // Keep the existing picker state when the catalog refresh is unavailable.
  } finally {
    state.chatModelsLoading = false;
    state.modelManagementLoading = false;
  }
}

export async function setDefaultChatModel(state: AppViewState, nextModel: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const trimmedModel = nextModel.trim();
  if (!trimmedModel) {
    return;
  }
  if (state.configFormDirty) {
    state.lastError = "Save or reload the config draft before changing the default model.";
    return;
  }
  if (resolveChatModelSelectState(state).defaultModel === trimmedModel) {
    return;
  }

  state.lastError = null;
  try {
    const snapshot = await state.client.request<ConfigSnapshot>("config.get", {});
    if (!snapshot.hash) {
      state.lastError = "Config hash missing; reload and retry.";
      return;
    }
    await state.client.request("config.patch", {
      raw: JSON.stringify(buildDefaultChatModelPatch(trimmedModel, snapshot.config ?? null)),
      baseHash: snapshot.hash,
    });
    await Promise.all([
      loadConfig(state),
      refreshSessionOptions(state),
      refreshModelPickerCatalogs(state),
    ]);
  } catch (err) {
    state.lastError = `Failed to set default model: ${String(err)}`;
  }
}

export function isCronSessionKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("cron:")) {
    return true;
  }
  if (!normalized.startsWith("agent:")) {
    return false;
  }
  const parts = normalized.split(":").filter(Boolean);
  if (parts.length < 3) {
    return false;
  }
  const rest = parts.slice(2).join(":");
  return rest.startsWith("cron:");
}

type SessionOptionEntry = {
  key: string;
  label: string;
  scopeLabel: string;
  title: string;
};

type SessionOptionGroup = {
  id: string;
  label: string;
  options: SessionOptionEntry[];
};

let cachedSessionOptionGroups: {
  agentsListRef: AppViewState["agentsList"] | null;
  groups: SessionOptionGroup[];
  hideCron: boolean;
  sessionKey: string;
  sessionsRef: SessionsListResult | null;
} | null = null;

export function resolveSessionOptionGroups(
  state: AppViewState,
  sessionKey: string,
  sessions: SessionsListResult | null,
): SessionOptionGroup[] {
  const hideCron = state.sessionsHideCron ?? true;
  if (
    cachedSessionOptionGroups &&
    cachedSessionOptionGroups.sessionsRef === sessions &&
    cachedSessionOptionGroups.sessionKey === sessionKey &&
    cachedSessionOptionGroups.hideCron === hideCron &&
    cachedSessionOptionGroups.agentsListRef === (state.agentsList ?? null)
  ) {
    return cachedSessionOptionGroups.groups;
  }

  const rows = sessions?.sessions ?? [];
  const byKey = new Map<string, SessionsListResult["sessions"][number]>();
  for (const row of rows) {
    byKey.set(row.key, row);
  }

  const seenKeys = new Set<string>();
  const groups = new Map<string, SessionOptionGroup>();
  const ensureGroup = (groupId: string, label: string): SessionOptionGroup => {
    const existing = groups.get(groupId);
    if (existing) {
      return existing;
    }
    const created: SessionOptionGroup = {
      id: groupId,
      label,
      options: [],
    };
    groups.set(groupId, created);
    return created;
  };

  const addOption = (key: string) => {
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    const row = byKey.get(key);
    const parsed = parseAgentSessionKey(key);
    const agentId = parsed?.agentId?.trim() || resolveSessionAgentId(state, key);
    const rest =
      parsed?.rest?.trim() ||
      (agentId && isAgentMainConversation(state, key, agentId) ? "main" : undefined);
    const group = agentId
      ? ensureGroup(`agent:${agentId.toLowerCase()}`, resolveAgentGroupLabel(state, agentId))
      : ensureGroup("other", t("alisio.shell.sessions.other"));
    const scopeLabel = rest || key;
    const label = resolveSessionScopedOptionLabel(key, row, rest);
    group.options.push({
      key,
      label,
      scopeLabel,
      title: row ? resolveSessionDisplayName(key, row) : label,
    });
  };

  for (const row of rows) {
    if (row.key !== sessionKey && (row.kind === "global" || row.kind === "unknown")) {
      continue;
    }
    if (hideCron && row.key !== sessionKey && isCronSessionKey(row.key)) {
      continue;
    }
    addOption(row.key);
  }
  addOption(sessionKey);

  for (const group of groups.values()) {
    const counts = new Map<string, number>();
    for (const option of group.options) {
      counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
    }
    for (const option of group.options) {
      if ((counts.get(option.label) ?? 0) > 1 && option.scopeLabel !== option.label) {
        option.label = `${option.label} · ${option.scopeLabel}`;
      }
    }
  }

  const allOptions = Array.from(groups.values()).flatMap((group) =>
    group.options.map((option) => ({ groupLabel: group.label, option })),
  );
  const labels = new Map(allOptions.map(({ option }) => [option, option.label]));
  const countAssignedLabels = () => {
    const counts = new Map<string, number>();
    for (const { option } of allOptions) {
      const label = labels.get(option) ?? option.label;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return counts;
  };
  const labelIncludesScopeLabel = (label: string, scopeLabel: string) => {
    const trimmedScope = scopeLabel.trim();
    if (!trimmedScope) {
      return false;
    }
    return (
      label === trimmedScope ||
      label.endsWith(` · ${trimmedScope}`) ||
      label.endsWith(` / ${trimmedScope}`)
    );
  };

  const globalCounts = countAssignedLabels();
  for (const { groupLabel, option } of allOptions) {
    const currentLabel = labels.get(option) ?? option.label;
    if ((globalCounts.get(currentLabel) ?? 0) <= 1) {
      continue;
    }
    const scopedPrefix = `${groupLabel} / `;
    if (currentLabel.startsWith(scopedPrefix)) {
      continue;
    }
    // Keep the agent visible once the native select collapses to a single chosen label.
    labels.set(option, `${groupLabel} / ${currentLabel}`);
  }

  const scopedCounts = countAssignedLabels();
  for (const { option } of allOptions) {
    const currentLabel = labels.get(option) ?? option.label;
    if ((scopedCounts.get(currentLabel) ?? 0) <= 1) {
      continue;
    }
    if (labelIncludesScopeLabel(currentLabel, option.scopeLabel)) {
      continue;
    }
    labels.set(option, `${currentLabel} · ${option.scopeLabel}`);
  }

  const finalCounts = countAssignedLabels();
  for (const { option } of allOptions) {
    const currentLabel = labels.get(option) ?? option.label;
    if ((finalCounts.get(currentLabel) ?? 0) <= 1) {
      continue;
    }
    // Fall back to the full key only when every friendlier disambiguator still collides.
    labels.set(option, `${currentLabel} · ${option.key}`);
  }

  for (const { option } of allOptions) {
    option.label = labels.get(option) ?? option.label;
  }

  const resolvedGroups = Array.from(groups.values());
  cachedSessionOptionGroups = {
    agentsListRef: state.agentsList ?? null,
    groups: resolvedGroups,
    hideCron,
    sessionKey,
    sessionsRef: sessions,
  };
  return resolvedGroups;
}

/** Count sessions with a cron: key that would be hidden when hideCron=true. */
function countHiddenCronSessions(sessionKey: string, sessions: SessionsListResult | null): number {
  if (!sessions?.sessions) {
    return 0;
  }
  // Don't count the currently active session even if it's a cron.
  return sessions.sessions.filter((s) => isCronSessionKey(s.key) && s.key !== sessionKey).length;
}

function resolveAgentGroupLabel(state: AppViewState, agentIdRaw: string): string {
  const normalized = agentIdRaw.trim().toLowerCase();
  const agent = (state.agentsList?.agents ?? []).find(
    (entry) => entry.id.trim().toLowerCase() === normalized,
  );
  const name = agent?.identity?.name?.trim() || agent?.name?.trim() || "";
  return name && name !== agentIdRaw ? `${name} (${agentIdRaw})` : agentIdRaw;
}

function resolveSessionScopedOptionLabel(
  key: string,
  row?: SessionsListResult["sessions"][number],
  rest?: string,
) {
  const base = rest?.trim() || key;
  if (!row) {
    return base;
  }

  const label = row.label?.trim() || "";
  const displayName = row.displayName?.trim() || "";
  const derivedTitle = row.derivedTitle?.trim() || "";
  if (
    (label && label !== key) ||
    (displayName && displayName !== key) ||
    (derivedTitle && derivedTitle !== key) ||
    (rest?.trim() ?? "").startsWith("dashboard:")
  ) {
    return resolveSessionDisplayName(key, row);
  }

  return base;
}
