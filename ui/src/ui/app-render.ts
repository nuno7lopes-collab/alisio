import { html, nothing } from "lit";
import {
  buildAgentMainSessionKey,
  parseAgentSessionKey,
} from "../../../src/routing/session-key.js";
import { i18n, t } from "../i18n/index.ts";
import { getSafeLocalStorage } from "../local-storage.ts";
import { refreshChatAvatar } from "./app-chat.ts";
import {
  renderChatMobileToggle,
  renderTab,
  renderTopbarThemeModeToggle,
  switchChatSession,
} from "./app-render.helpers.ts";
import type { AppViewState } from "./app-view-state.ts";
import {
  beginAlisioConnector,
  cancelAlisioSetupWizard,
  continueAlisioSetupWizard,
  loadAlisioConnectors,
  restartAlisioRuntime,
  revokeAlisioConnector,
  saveAlisioAccount,
  signInAlisioAccount,
  signOutAlisioAccount,
  signUpAlisioAccount,
  saveAlisioOrganization,
  startAlisioSetupWizard,
} from "./controllers/alisio.ts";
import type { ChatRuntimeSetupHint } from "./controllers/chat.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import { runUpdate } from "./controllers/config.ts";
import "./components/dashboard-header.ts";
import { icons } from "./icons.ts";
import {
  loadNativeShellState,
  openExternal,
  openNativeSettings,
  requestNativePermission,
  revealLogs,
  setLaunchAtLogin,
  setVoiceWake,
} from "./lume-host.ts";
import { TAB_GROUPS, publicTabFor, subtitleForTab, titleForTab } from "./navigation.ts";
import { agentLogoUrl } from "./views/agents-utils.ts";
import { renderAuthentications } from "./views/authentications.ts";
import { renderChat } from "./views/chat.ts";
import { renderCommandPalette } from "./views/command-palette.ts";
import { renderExecApprovalPrompt } from "./views/exec-approval.ts";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.ts";
import { renderOrganization } from "./views/organization.ts";
import { renderSettingsHub } from "./views/settings.ts";
import { renderSetup } from "./views/setup.ts";

const UPDATE_BANNER_DISMISS_KEY = "alisio:workspace:update-banner-dismissed:v1";
const LEGACY_UPDATE_BANNER_DISMISS_KEYS = ["openclaw:control-ui:update-banner-dismissed:v1"];

type DismissedUpdateBanner = {
  latestVersion: string;
  channel: string | null;
  dismissedAtMs: number;
};

function loadDismissedUpdateBanner(): DismissedUpdateBanner | null {
  const storage = getSafeLocalStorage();
  if (!storage) {
    return null;
  }
  try {
    for (const key of [UPDATE_BANNER_DISMISS_KEY, ...LEGACY_UPDATE_BANNER_DISMISS_KEYS]) {
      const raw = storage.getItem(key);
      if (!raw) {
        continue;
      }
      const parsed = JSON.parse(raw) as Partial<DismissedUpdateBanner>;
      if (!parsed || typeof parsed.latestVersion !== "string") {
        continue;
      }
      return {
        latestVersion: parsed.latestVersion,
        channel: typeof parsed.channel === "string" ? parsed.channel : null,
        dismissedAtMs: typeof parsed.dismissedAtMs === "number" ? parsed.dismissedAtMs : Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function isUpdateBannerDismissed(updateAvailable: unknown): boolean {
  const dismissed = loadDismissedUpdateBanner();
  if (!dismissed) {
    return false;
  }
  const info = updateAvailable as { latestVersion?: unknown; channel?: unknown };
  const latestVersion = info && typeof info.latestVersion === "string" ? info.latestVersion : null;
  const channel = info && typeof info.channel === "string" ? info.channel : null;
  return Boolean(
    latestVersion && dismissed.latestVersion === latestVersion && dismissed.channel === channel,
  );
}

function dismissUpdateBanner(updateAvailable: unknown) {
  const info = updateAvailable as { latestVersion?: unknown; channel?: unknown };
  const latestVersion = info && typeof info.latestVersion === "string" ? info.latestVersion : null;
  if (!latestVersion) {
    return;
  }
  const channel = info && typeof info.channel === "string" ? info.channel : null;
  const payload: DismissedUpdateBanner = {
    latestVersion,
    channel,
    dismissedAtMs: Date.now(),
  };
  try {
    getSafeLocalStorage()?.setItem(UPDATE_BANNER_DISMISS_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function scheduleConnectorAuthorizationRefresh(state: AppViewState, connectorId: string) {
  let attempts = 0;
  const maxAttempts = 45;

  const tick = () => {
    window.setTimeout(
      async () => {
        attempts += 1;
        await loadAlisioConnectors(state);
        const authorization = state.alisioConnectorAuthorizations.find(
          (entry) => entry.connectorId === connectorId,
        );
        if (authorization?.state === "connected" || attempts >= maxAttempts) {
          return;
        }
        tick();
      },
      attempts === 0 ? 1000 : 2000,
    );
  };

  tick();
}

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;
function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return undefined;
  }
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) {
    return candidate;
  }
  return identity?.avatarUrl;
}

function sidebarGroupLabel(label: (typeof TAB_GROUPS)[number]["label"]) {
  switch (label) {
    case "workspace":
      return "Workspace";
    default:
      return null;
  }
}

export function renderApp(state: AppViewState) {
  const updatableState = state as AppViewState & { requestUpdate?: () => void };
  const requestHostUpdate =
    typeof updatableState.requestUpdate === "function"
      ? () => updatableState.requestUpdate?.()
      : undefined;

  const setupBlockedByBootstrap = Boolean(
    state.connected &&
    state.alisioBootstrap &&
    (state.alisioBootstrap.connectionRequired || state.alisioBootstrap.startupState !== "ready"),
  );
  const shouldShowSetup =
    !state.connected || state.tab === "setup" || (setupBlockedByBootstrap && state.tab === "chat");
  const setupView = renderSetup({
    connected: state.connected,
    lastError: state.lastError,
    gatewayUrl: state.settings.gatewayUrl,
    gatewayToken: state.settings.token,
    gatewayPassword: state.password,
    showGatewayToken: state.loginShowGatewayToken,
    showGatewayPassword: state.loginShowGatewayPassword,
    startupLoading: state.alisioStartupLoading,
    startupError: state.alisioStartupError,
    startupBootstrap: state.alisioStartupBootstrap,
    bootstrapLoading: state.alisioBootstrapLoading,
    bootstrapError: state.alisioBootstrapError,
    bootstrap: state.alisioBootstrap,
    doctorLoading: state.alisioDoctorLoading,
    doctorError: state.alisioDoctorError,
    doctor: state.alisioDoctor,
    wizardLoading: state.setupWizardLoading,
    wizardSubmitting: state.setupWizardSubmitting,
    wizardSessionId: state.setupWizardSessionId,
    wizardStep: state.setupWizardStep,
    wizardStatus: state.setupWizardStatus,
    wizardError: state.setupWizardError,
    wizardDraftText: state.setupWizardDraftText,
    wizardDraftConfirm: state.setupWizardDraftConfirm,
    wizardDraftSelectIndex: state.setupWizardDraftSelectIndex,
    wizardDraftMultiIndexes: state.setupWizardDraftMultiIndexes,
    requestedStep: state.setupStep,
    accountLoading: state.alisioAccountLoading,
    accountError: state.alisioAccountError,
    account: state.alisioAccount,
    organizationLoading: state.alisioOrganizationLoading,
    organizationError: state.alisioOrganizationError,
    organization: state.alisioOrganization,
    organizationDraftMode: state.alisioOrganizationDraftMode,
    organizationName: state.alisioOrganizationName,
    organizationInviteEmail: state.alisioOrganizationInviteEmail,
    connectorsLoading: state.alisioConnectorsLoading,
    connectorsError: state.alisioConnectorsError,
    connectorCatalog: state.alisioConnectorCatalog,
    connectorAuthorizations: state.alisioConnectorAuthorizations,
    nativeShellLoading: state.nativeShellLoading,
    nativeShellError: state.nativeShellError,
    nativeShellState: state.nativeShellState,
    onGatewayUrlChange: (value) => {
      state.applySettings({ ...state.settings, gatewayUrl: value });
    },
    onGatewayTokenChange: (value) => {
      state.applySettings({ ...state.settings, token: value });
    },
    onGatewayPasswordChange: (value) => {
      state.password = value;
    },
    onToggleGatewayToken: () => {
      state.loginShowGatewayToken = !state.loginShowGatewayToken;
    },
    onToggleGatewayPassword: () => {
      state.loginShowGatewayPassword = !state.loginShowGatewayPassword;
    },
    onConnect: () => state.connect(),
    onOpenWorkspace: () => state.setTab("chat" as import("./navigation.ts").Tab),
    onOpenAuthentications: () => state.setTab("authentications" as import("./navigation.ts").Tab),
    onOpenSettingsMac: () => {
      state.settingsSection = "mac";
      state.setTab("settings" as import("./navigation.ts").Tab);
      void openNativeSettings();
    },
    onSetLaunchAtLogin: (enabled) => {
      void setLaunchAtLogin(enabled).then(() => loadNativeShellState(state));
    },
    onRequestPermission: (permission) => {
      void requestNativePermission(permission).then(() => loadNativeShellState(state));
    },
    onDraftModeChange: (mode) => {
      state.alisioOrganizationDraftMode = mode;
    },
    onOrganizationNameChange: (value) => {
      state.alisioOrganizationName = value;
    },
    onInviteEmailChange: (value) => {
      state.alisioOrganizationInviteEmail = value;
    },
    onCreateOrganization: () => {
      void saveAlisioOrganization(state, {
        mode: "owner",
        organizationName: state.alisioOrganizationName.trim(),
      });
    },
    onJoinOrganization: () => {
      void saveAlisioOrganization(state, {
        mode: "member",
        organizationName: state.alisioOrganizationName.trim(),
        inviteEmail: state.alisioOrganizationInviteEmail.trim() || undefined,
      });
    },
    onResetOrganization: () => {
      void saveAlisioOrganization(state, { mode: "none" });
    },
    onBeginConnector: (connectorId) => {
      void beginAlisioConnector(state, connectorId).then((result) => {
        const targetUrl = result?.setupUrl;
        if (!targetUrl) {
          return;
        }
        if (result.mode === "oauth") {
          scheduleConnectorAuthorizationRefresh(state, connectorId);
        }
        if (typeof window.alisioHost?.request === "function") {
          void openExternal(targetUrl);
          return;
        }
        window.open(targetUrl, "_blank", "noopener,noreferrer");
      });
    },
    onRevokeConnector: (connectorId) => {
      void revokeAlisioConnector(state, connectorId);
    },
    onStartWizard: (mode) => {
      void startAlisioSetupWizard(state, mode);
    },
    onContinueWizard: (answer) => {
      void continueAlisioSetupWizard(state, answer);
    },
    onCancelWizard: () => {
      void cancelAlisioSetupWizard(state);
    },
    onWizardDraftTextChange: (value) => {
      state.setupWizardDraftText = value;
    },
    onWizardDraftConfirmChange: (value) => {
      state.setupWizardDraftConfirm = value;
    },
    onWizardDraftSelectIndexChange: (value) => {
      state.setupWizardDraftSelectIndex = value;
    },
    onWizardDraftMultiIndexesChange: (value) => {
      state.setupWizardDraftMultiIndexes = value;
    },
    onAccountFieldChange: (field, value) => {
      if (!state.alisioAccount) {
        return;
      }
      state.alisioAccount = {
        ...state.alisioAccount,
        profile: {
          ...state.alisioAccount.profile,
          [field]: value,
        },
      };
    },
    onSignUpAccount: () => {
      void signUpAlisioAccount(state);
    },
    onSignInAccount: () => {
      void signInAlisioAccount(state);
    },
    onSaveAccount: () => {
      const profile = state.alisioAccount?.profile;
      if (!profile) {
        return;
      }
      void saveAlisioAccount(state, {
        username: profile.username,
        displayName: profile.displayName,
        email: profile.email,
        avatarLabel: profile.avatarLabel,
      });
    },
  });

  const chatDisabledReason = state.connected ? null : t("chat.disconnected");
  const activeTab = publicTabFor(state.tab);
  const isChat = activeTab === "chat";
  const chatFocus = isChat && state.settings.chatFocusMode;
  const navDrawerOpen = Boolean(state.navDrawerOpen && !chatFocus);
  const navCollapsed = Boolean(state.settings.navCollapsed && !navDrawerOpen);
  const showThinking = state.settings.chatShowThinking;
  const showToolCalls = state.settings.chatShowToolCalls;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  const profile = state.alisioAccount?.profile ?? null;
  const profileName = profile?.displayName ?? "Nuno";
  const profileEmail = profile?.email ?? "nuno@alisio.local";
  const profileAvatarLabel = profile?.avatarLabel ?? "N";
  const profilePlan = profile?.plan ?? t("alisio.settings.billing.freePlan");
  const appLogoUrl = agentLogoUrl(state.basePath ?? "");
  const connectionLabel = state.connected ? t("common.online") : t("common.offline");
  const sidebarContextBadge = shouldShowSetup ? titleForTab("setup") : titleForTab(activeTab);
  const sidebarContextEyebrow = shouldShowSetup
    ? "Required now"
    : state.connected
      ? "Local workspace"
      : "Connect gateway";
  const openSettingsSection = (section: import("./navigation.ts").SettingsSection) => {
    state.settingsSection = section;
    state.setTab("settings" as import("./navigation.ts").Tab);
  };
  const chatRuntimeSetupHint =
    (state as AppViewState & { chatRuntimeSetupHint?: ChatRuntimeSetupHint | null })
      .chatRuntimeSetupHint ?? null;
  const resolvedAgentId =
    state.agentsSelectedId ??
    state.agentsList?.defaultId ??
    state.agentsList?.agents?.[0]?.id ??
    null;
  return html`
    ${renderCommandPalette({
      open: state.paletteOpen,
      query: state.paletteQuery,
      activeIndex: state.paletteActiveIndex,
      onToggle: () => {
        state.paletteOpen = !state.paletteOpen;
      },
      onQueryChange: (q) => {
        state.paletteQuery = q;
      },
      onActiveIndexChange: (i) => {
        state.paletteActiveIndex = i;
      },
      onNavigate: (tab) => {
        state.setTab(tab as import("./navigation.ts").Tab);
      },
      onSlashCommand: (cmd) => {
        state.setTab("chat" as import("./navigation.ts").Tab);
        state.chatMessage = cmd.endsWith(" ") ? cmd : `${cmd} `;
      },
    })}
    <div
      class="shell ${isChat ? "shell--chat" : ""} ${chatFocus
        ? "shell--chat-focus"
        : ""} ${navCollapsed ? "shell--nav-collapsed" : ""} ${navDrawerOpen
        ? "shell--nav-drawer-open"
        : ""}"
    >
      <button
        type="button"
        class="shell-nav-backdrop"
        aria-label="${t("nav.collapse")}"
        @click=${() => {
          state.navDrawerOpen = false;
        }}
      ></button>
      <header class="topbar">
        <div class="topnav-shell">
          <button
            type="button"
            class="topbar-nav-toggle"
            @click=${() => {
              state.navDrawerOpen = !navDrawerOpen;
            }}
            title="${navDrawerOpen ? t("nav.collapse") : t("nav.expand")}"
            aria-label="${navDrawerOpen ? t("nav.collapse") : t("nav.expand")}"
            aria-expanded=${navDrawerOpen}
          >
            <span class="nav-collapse-toggle__icon" aria-hidden="true">${icons.menu}</span>
          </button>
          <div class="topnav-shell__content">
            <dashboard-header .tab=${activeTab}></dashboard-header>
          </div>
          <div class="topnav-shell__actions">
            <button
              class="topbar-search"
              @click=${() => {
                state.paletteOpen = !state.paletteOpen;
              }}
              title=${t("alisio.shell.searchTitle")}
              aria-label=${t("alisio.shell.openCommandPalette")}
            >
              <span class="topbar-search__label">${t("common.search")}</span>
              <kbd class="topbar-search__kbd">⌘K</kbd>
            </button>
            <div class="topbar-status">${isChat ? renderChatMobileToggle(state) : nothing}</div>
          </div>
        </div>
      </header>
      <div class="shell-nav">
        <aside class="sidebar ${navCollapsed ? "sidebar--collapsed" : ""}">
          <div class="sidebar-shell">
            <div class="sidebar-rail">
              <div class="sidebar-rail__top">
                <button
                  type="button"
                  class="sidebar-rail__brand"
                  title="Open chat"
                  aria-label="Open chat"
                  @click=${() => {
                    state.setTab("chat" as import("./navigation.ts").Tab);
                  }}
                >
                  <img src=${appLogoUrl} alt="Alisio" />
                </button>
                <button
                  type="button"
                  class="nav-collapse-toggle sidebar-rail__toggle"
                  @click=${() =>
                    state.applySettings({
                      ...state.settings,
                      navCollapsed: !state.settings.navCollapsed,
                    })}
                  title="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
                  aria-label="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
                >
                  <span class="nav-collapse-toggle__icon" aria-hidden="true"
                    >${navCollapsed ? icons.panelLeftOpen : icons.panelLeftClose}</span
                  >
                </button>
              </div>
              <div class="sidebar-rail__body">
                <nav class="sidebar-rail__nav" aria-label="Primary navigation">
                  ${TAB_GROUPS.map(
                    (group) => html`
                      <div class="sidebar-rail__group">
                        ${group.tabs.map((tab) =>
                          renderTab(state, tab, {
                            collapsed: true,
                            variant: "rail",
                          }),
                        )}
                      </div>
                    `,
                  )}
                </nav>
              </div>
              <div class="sidebar-rail__footer">
                <button
                  type="button"
                  class="sidebar-rail__account"
                  title=${profileName}
                  aria-label=${profileName}
                  @click=${() => openSettingsSection("account")}
                >
                  <span class="sidebar-rail__avatar">${profileAvatarLabel}</span>
                  <span
                    class="sidebar-rail__presence ${state.connected ? "is-online" : ""}"
                    aria-hidden="true"
                  ></span>
                </button>
                <button
                  type="button"
                  class="sidebar-rail__upgrade"
                  title=${t("alisio.settings.billing.upgrade")}
                  aria-label=${t("alisio.settings.billing.upgrade")}
                  @click=${() => openSettingsSection("billing")}
                >
                  ${icons.spark}
                </button>
              </div>
            </div>
            ${navCollapsed
              ? nothing
              : html`
                  <div class="sidebar-panel">
                    <div class="sidebar-shell__header">
                      <div class="sidebar-brand">
                        <span class="sidebar-brand__logo" aria-hidden="true"
                          ><img src=${appLogoUrl} alt=""
                        /></span>
                        <span class="sidebar-brand__copy">
                          <span class="sidebar-brand__eyebrow">Control center</span>
                          <span class="sidebar-brand__title">Alisio</span>
                        </span>
                      </div>
                      <span class="sidebar-panel__badge">${connectionLabel}</span>
                    </div>
                    <div class="sidebar-shell__body">
                      <div class="sidebar-context">
                        <div class="sidebar-context__main">
                          <span class="sidebar-context__icon" aria-hidden="true"
                            ><img src=${appLogoUrl} alt=""
                          /></span>
                          <span class="sidebar-context__copy">
                            <span class="sidebar-context__eyebrow">${sidebarContextEyebrow}</span>
                            <span class="sidebar-context__title">Alisio</span>
                          </span>
                        </div>
                        <span class="sidebar-context__badge">${sidebarContextBadge}</span>
                      </div>
                      <nav class="sidebar-nav sidebar-nav--product">
                        ${TAB_GROUPS.map((group) => {
                          const groupLabel = sidebarGroupLabel(group.label);
                          return html`
                            <section class="nav-section">
                              ${groupLabel
                                ? html`
                                    <div class="nav-section__label">
                                      <span class="nav-section__label-text">${groupLabel}</span>
                                    </div>
                                  `
                                : nothing}
                              <div class="nav-section__items">
                                ${group.tabs.map((tab) =>
                                  renderTab(state, tab, {
                                    collapsed: false,
                                    variant: "panel",
                                  }),
                                )}
                              </div>
                            </section>
                          `;
                        })}
                      </nav>
                    </div>
                    <div class="sidebar-shell__footer">
                      <div class="alisio-sidebar-account">
                        <button
                          type="button"
                          class="alisio-sidebar-account__card"
                          title=${profileEmail}
                          @click=${() => openSettingsSection("account")}
                        >
                          <span class="alisio-sidebar-account__avatar">${profileAvatarLabel}</span>
                          <span class="alisio-sidebar-account__copy">
                            <span class="alisio-sidebar-account__name">${profileName}</span>
                            <span class="alisio-sidebar-account__meta">${profilePlan}</span>
                          </span>
                        </button>
                        <div class="alisio-sidebar-account__footer">
                          <div class="alisio-sidebar-account__status">
                            <span
                              class="alisio-sidebar-account__dot ${state.connected
                                ? "is-online"
                                : ""}"
                              aria-label=${connectionLabel}
                            ></span>
                            <span>${connectionLabel}</span>
                          </div>
                          <button
                            type="button"
                            class="btn alisio-sidebar-account__upgrade"
                            @click=${() => openSettingsSection("billing")}
                          >
                            ${t("alisio.settings.billing.upgrade")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                `}
          </div>
        </aside>
      </div>
      <main
        class="content ${shouldShowSetup ? "content--setup" : ""} ${isChat && !shouldShowSetup
          ? "content--chat"
          : ""}"
      >
        ${state.updateAvailable &&
        state.updateAvailable.latestVersion !== state.updateAvailable.currentVersion &&
        !isUpdateBannerDismissed(state.updateAvailable)
          ? html`<div class="update-banner callout danger" role="alert">
              <strong>${t("alisio.shell.updateAvailable")}</strong>
              ${t("alisio.shell.runningVersion", {
                latest: `v${state.updateAvailable.latestVersion}`,
                current: `v${state.updateAvailable.currentVersion}`,
              })}
              <button
                class="btn btn--sm update-banner__btn"
                ?disabled=${state.updateRunning || !state.connected}
                @click=${() => runUpdate(state)}
              >
                ${state.updateRunning ? t("alisio.shell.updating") : t("alisio.shell.updateNow")}
              </button>
              <button
                class="update-banner__close"
                type="button"
                title=${t("alisio.shell.dismissUpdate")}
                aria-label=${t("alisio.shell.dismissUpdate")}
                @click=${() => {
                  dismissUpdateBanner(state.updateAvailable);
                  state.updateAvailable = null;
                }}
              >
                ${icons.x}
              </button>
            </div>`
          : nothing}
        ${shouldShowSetup
          ? nothing
          : html`
              <section class="content-header">
                <div>
                  <div class="page-title">${titleForTab(activeTab)}</div>
                  <div class="page-sub">${subtitleForTab(activeTab)}</div>
                </div>
                <div class="page-meta">
                  ${state.lastError
                    ? html`<div class="pill danger">${state.lastError}</div>`
                    : nothing}
                  ${activeTab === "settings" ? renderTopbarThemeModeToggle(state) : nothing}
                </div>
              </section>
            `}
        ${shouldShowSetup ? setupView : nothing}
        ${!shouldShowSetup && activeTab === "authentications"
          ? renderAuthentications({
              loading: state.alisioConnectorsLoading,
              error: state.alisioConnectorsError,
              account: state.alisioAccount,
              connectorCatalog: state.alisioConnectorCatalog,
              connectorAuthorizations: state.alisioConnectorAuthorizations,
              search: state.alisioConnectorsSearch,
              categoryFilter: state.alisioConnectorsCategoryFilter,
              onSearchChange: (value) => {
                state.alisioConnectorsSearch = value;
              },
              onCategoryChange: (value) => {
                state.alisioConnectorsCategoryFilter = value;
              },
              onBeginConnector: (connectorId) => {
                void beginAlisioConnector(state, connectorId).then((result) => {
                  const targetUrl = result?.setupUrl;
                  if (!targetUrl) {
                    return;
                  }
                  if (result.mode === "oauth") {
                    scheduleConnectorAuthorizationRefresh(state, connectorId);
                  }
                  if (typeof window.alisioHost?.request === "function") {
                    void openExternal(targetUrl);
                    return;
                  }
                  window.open(targetUrl, "_blank", "noopener,noreferrer");
                });
              },
              onRevokeConnector: (connectorId) => {
                void revokeAlisioConnector(state, connectorId);
              },
            })
          : nothing}
        ${!shouldShowSetup && activeTab === "organization"
          ? renderOrganization({
              loading: state.alisioOrganizationLoading,
              error: state.alisioOrganizationError,
              organization: state.alisioOrganization,
              draftMode: state.alisioOrganizationDraftMode,
              organizationName: state.alisioOrganizationName,
              inviteEmail: state.alisioOrganizationInviteEmail,
              onDraftModeChange: (mode) => {
                state.alisioOrganizationDraftMode = mode;
              },
              onOrganizationNameChange: (value) => {
                state.alisioOrganizationName = value;
              },
              onInviteEmailChange: (value) => {
                state.alisioOrganizationInviteEmail = value;
              },
              onCreateOrganization: () => {
                void saveAlisioOrganization(state, {
                  mode: "owner",
                  organizationName: state.alisioOrganizationName.trim(),
                });
              },
              onJoinOrganization: () => {
                void saveAlisioOrganization(state, {
                  mode: "member",
                  organizationName: state.alisioOrganizationName.trim(),
                  inviteEmail: state.alisioOrganizationInviteEmail.trim() || undefined,
                });
              },
              onResetOrganization: () => {
                void saveAlisioOrganization(state, { mode: "none" });
              },
            })
          : nothing}
        ${!shouldShowSetup && activeTab === "chat"
          ? renderChat({
              sessionKey: state.sessionKey,
              onSessionKeyChange: (next) => {
                state.sessionKey = next;
                state.chatMessage = "";
                state.chatAttachments = [];
                state.chatStream = null;
                state.chatStreamStartedAt = null;
                state.chatRunId = null;
                state.chatQueue = [];
                state.resetToolStream();
                state.resetChatScroll();
                state.applySettings({
                  ...state.settings,
                  sessionKey: next,
                  lastActiveSessionKey: next,
                });
                void state.loadAssistantIdentity();
                void loadChatHistory(state);
                void refreshChatAvatar(state);
              },
              thinkingLevel: state.chatThinkingLevel,
              showThinking,
              showToolCalls,
              loading: state.chatLoading,
              sending: state.chatSending,
              compactionStatus: state.compactionStatus,
              fallbackStatus: state.fallbackStatus,
              assistantAvatarUrl: chatAvatarUrl,
              messages: state.chatMessages,
              toolMessages: state.chatToolMessages,
              streamSegments: state.chatStreamSegments,
              stream: state.chatStream,
              streamStartedAt: state.chatStreamStartedAt,
              draft: state.chatMessage,
              queue: state.chatQueue,
              connected: state.connected,
              canSend: state.connected,
              disabledReason: chatDisabledReason,
              error: state.lastError,
              runtimeSetupHint: chatRuntimeSetupHint,
              sessions: state.sessionsResult,
              focusMode: chatFocus,
              onRefresh: () => {
                state.resetToolStream();
                return Promise.all([loadChatHistory(state), refreshChatAvatar(state)]);
              },
              onToggleFocusMode: () => {
                state.applySettings({
                  ...state.settings,
                  chatFocusMode: !state.settings.chatFocusMode,
                });
              },
              onChatScroll: (event) => state.handleChatScroll(event),
              getDraft: () => state.chatMessage,
              onDraftChange: (next) => (state.chatMessage = next),
              onOpenRuntimeSetup: () => {
                state.setupStep = state.alisioBootstrap?.nextStep ?? "runtime";
                state.setTab("setup" as import("./navigation.ts").Tab);
              },
              onRequestUpdate: requestHostUpdate,
              attachments: state.chatAttachments,
              onAttachmentsChange: (next) => (state.chatAttachments = next),
              onSend: () => state.handleSendChat(),
              canAbort: Boolean(state.chatRunId),
              onAbort: () => void state.handleAbortChat(),
              onQueueRemove: (id) => state.removeQueuedMessage(id),
              onNewSession: () => state.handleSendChat("/new", { restoreDraft: true }),
              onClearHistory: async () => {
                if (!state.client || !state.connected) {
                  return;
                }
                try {
                  await state.client.request("sessions.reset", { key: state.sessionKey });
                  state.chatMessages = [];
                  state.chatStream = null;
                  state.chatRunId = null;
                  await loadChatHistory(state);
                } catch (err) {
                  state.lastError = String(err);
                }
              },
              agentsList: state.agentsList,
              currentAgentId: resolvedAgentId ?? "main",
              onAgentChange: (agentId: string) => {
                state.sessionKey = buildAgentMainSessionKey({ agentId });
                state.chatMessages = [];
                state.chatStream = null;
                state.chatRunId = null;
                state.applySettings({
                  ...state.settings,
                  sessionKey: state.sessionKey,
                  lastActiveSessionKey: state.sessionKey,
                });
                void loadChatHistory(state);
                void state.loadAssistantIdentity();
              },
              onNavigateToAgent: () => {
                state.settingsSection = "account";
                state.setTab("settings" as import("./navigation.ts").Tab);
              },
              onSessionSelect: (key: string) => {
                switchChatSession(state, key);
              },
              showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
              onScrollToBottom: () => state.scrollToBottom(),
              // Sidebar props for tool output viewing
              sidebarOpen: state.sidebarOpen,
              sidebarContent: state.sidebarContent,
              sidebarError: state.sidebarError,
              splitRatio: state.splitRatio,
              onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
              onCloseSidebar: () => state.handleCloseSidebar(),
              onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
              assistantName: state.assistantName,
              assistantAvatar: state.assistantAvatar,
              basePath: state.basePath ?? "",
            })
          : nothing}
        ${!shouldShowSetup && activeTab === "settings"
          ? renderSettingsHub({
              section: state.settingsSection,
              onSectionChange: (section) => {
                state.settingsSection = section;
                state.setTab("settings" as import("./navigation.ts").Tab);
              },
              accountLoading: state.alisioAccountLoading,
              accountError: state.alisioAccountError,
              account: state.alisioAccount,
              doctorLoading: state.alisioDoctorLoading,
              doctorError: state.alisioDoctorError,
              doctor: state.alisioDoctor,
              locale: state.settings.locale,
              themeMode: state.themeMode,
              onLocaleChange: (locale) => {
                void i18n.setLocale(locale);
                state.applySettings({ ...state.settings, locale });
                void saveAlisioAccount(state, { language: locale });
              },
              onThemeModeChange: (themeMode) => {
                state.setThemeMode(themeMode);
                void saveAlisioAccount(state, { theme: themeMode });
              },
              onSaveAccountField: (patch) => {
                void saveAlisioAccount(state, patch);
              },
              nativeShellLoading: state.nativeShellLoading,
              nativeShellError: state.nativeShellError,
              nativeShellState: state.nativeShellState,
              onRefreshNative: () => {
                void loadNativeShellState(state);
              },
              onSetLaunchAtLogin: (enabled) => {
                void setLaunchAtLogin(enabled).then(() => loadNativeShellState(state));
              },
              onRequestPermission: (permission) => {
                void requestNativePermission(permission).then(() => loadNativeShellState(state));
              },
              onSetVoiceWake: (params) => {
                void setVoiceWake(params).then(() => loadNativeShellState(state));
              },
              onOpenNativeSettings: () => {
                void openNativeSettings();
              },
              onRevealLogs: () => {
                void revealLogs();
              },
              onOpenSetup: () => {
                state.setTab("setup" as import("./navigation.ts").Tab);
              },
              onSignOutAccount: () => {
                void signOutAlisioAccount(state);
              },
              onReconnectRuntime: () => {
                void restartAlisioRuntime(state).catch(() => {
                  state.connect();
                });
              },
            })
          : nothing}
      </main>
      ${renderExecApprovalPrompt(state)} ${renderGatewayUrlConfirmation(state)} ${nothing}
    </div>
  `;
}
