import { html, nothing } from "lit";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import {
  alisioPlanTranslationKey,
  normalizeAlisioPlan,
} from "../../../src/shared/alisio-billing.js";
import { isAlisioConnectorRuntimeReady } from "../../../src/shared/alisio-connector-runtime.js";
import { i18n, t } from "../i18n/index.ts";
import { getSafeLocalStorage } from "../local-storage.ts";
import {
  buildPendingAlisioConnectorChatResume,
  clearPendingAlisioConnectorChatResume,
  readPendingAlisioConnectorChatResume,
  rememberAlisioConnectorOAuthReturnTo,
  rememberPendingAlisioConnectorChatResume,
} from "./alisio-connector-oauth.ts";
import {
  hasAlisioHostBridge,
  loadNativeShellState,
  openExternal,
  openNativeSettings,
  rebuildAppFromCheckout,
  requestNativePermission,
  revealLogs,
  setLaunchAtLogin,
  setVoiceWake,
} from "./alisio-host.ts";
import { alisioBootstrapBlocksChatAccess } from "./alisio-setup-state.ts";
import {
  resolveEffectiveAlisioAiState,
  renderChatComposerModelSelect,
  renderChatDesktopToolbar,
  renderChatMobileToggle,
  resolveAlisioOpenAiCallbackUrl,
  isChatModelSwitchPending,
  renderTab,
  switchChatSession,
} from "./app-render.helpers.ts";
import type { AppViewState } from "./app-view-state.ts";
import { buildChatModelOptions } from "./chat-model-select-state.ts";
import { loadAgents } from "./controllers/agents.ts";
import {
  beginAlisioAccountEmailAuth,
  beginAlisioAiConnect,
  beginAlisioConnector,
  changeAlisioAccountEmail,
  disconnectAlisioAiProfile,
  installAlisioModel,
  loadAlisioConnectors,
  loadAlisioProviderOverview,
  loadAlisioSharing,
  renameAlisioAiProfile,
  refreshAlisioAi,
  refreshAlisioAiProfile,
  requestAlisioRecoveryEmail,
  requestAlisioSharedDeviceAccess,
  rebuildAlisioApp,
  restartAlisioRuntime,
  revokeAlisioConnector,
  revokeAlisioSharedDeviceGrant,
  saveAlisioAccount,
  selectAlisioAiProfile,
  saveAlisioSharingPolicy,
  signOutAlisioAccount,
  signInAlisioAccountWithPassword,
  signUpAlisioAccountWithPassword,
  saveAlisioOrganization,
  uninstallAlisioModel,
  updateAlisioAccountPassword,
  verifyAlisioAccountEmailAuth,
  approveAlisioSharedDeviceRequest,
  rejectAlisioSharedDeviceRequest,
} from "./controllers/alisio.ts";
import {
  approveChannelPairingRequest,
  cancelChannelSetup,
  continueChannelSetup,
  loadChannels,
  logoutChannelAccount,
  rejectChannelPairingRequest,
  startChannelSetup,
  startWebChannelLogin,
  waitWebChannelLogin,
} from "./controllers/channels.ts";
import type { ChatRuntimeSetupHint } from "./controllers/chat.ts";
import { resolveComputersViewState } from "./controllers/computers.ts";
import {
  ensureAgentConfigEntry,
  loadConfig,
  removeConfigFormValue,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
} from "./controllers/config.ts";
import { runCronJob, toggleCronJob } from "./controllers/cron.ts";
import {
  approveDevicePairing,
  cleanupComputerPairings,
  loadDevices,
  removeComputerPairings,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
} from "./controllers/devices.ts";
import {
  changeExecApprovalsTarget,
  loadSelectedExecApprovals,
  removeExecApprovalsFormValue,
  resolveSelectedExecApprovalsTarget,
  saveExecApprovals,
  updateExecApprovalsFormValue,
} from "./controllers/exec-approvals.ts";
import { loadMemoryStatus, resolvePreferredMemoryAgentId } from "./controllers/memory-runtime.ts";
import {
  approveNodePairing,
  loadNodePairings,
  rejectNodePairing,
} from "./controllers/node-pairing.ts";
import { loadNodes } from "./controllers/nodes.ts";
import {
  runRemoteComputerCommand,
  updateRemoteComputerDraft,
} from "./controllers/remote-computers.ts";
import {
  applyGatewayAccessMode,
  loadGatewayAccessMode,
  resolveSecurityAccessDiagnostics,
} from "./controllers/security-access.ts";
import {
  allowBundledSkill,
  dismissSkillConsentRequest,
  executeMarketplaceSkillAction,
  enableSkillConfigPath,
  installMarketplaceSkillAction,
  installSkill,
  loadSkills,
  removeMarketplaceSkillAction,
  resolveSkillConsentRequest,
  saveSkillApiKey,
  saveSkillEnv,
  updateSkillEdit,
  updateSkillEnvEdit,
  updateSkillEnabled,
} from "./controllers/skills.ts";
import {
  cancelTask,
  launchTaskProposal,
  loadTasksOverview,
  resolveTaskProposal,
  saveTaskProposal,
  scheduleTasksOverviewRefresh,
  selectTask,
} from "./controllers/tasks.ts";
import { icons } from "./icons.ts";
import "./components/dashboard-header.ts";
import { TAB_GROUPS, pathForTab, publicTabFor } from "./navigation.ts";
import {
  closeReservedExternalPopup,
  openExternalTarget,
  reserveExternalPopup,
} from "./open-external-url.ts";
import { resolveDefaultPresentationSelection } from "./presentation-preferences.ts";
import { agentLogoUrl } from "./views/agents-utils.ts";
import { renderAuthentications } from "./views/authentications.ts";
import { renderCapabilities } from "./views/capabilities.ts";
import { renderChannels } from "./views/channels.ts";
import { renderChat } from "./views/chat.ts";
import { renderCommandPalette } from "./views/command-palette.ts";
import { renderConnections } from "./views/connections.ts";
import { renderCron } from "./views/cron.ts";
import { renderExecApprovalPrompt } from "./views/exec-approval.ts";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.ts";
import { renderMemoryHub } from "./views/memory.ts";
import { renderModelsHub } from "./views/models.ts";
import { renderOrganization } from "./views/organization.ts";
import { renderSecurity } from "./views/security.ts";
import { renderSessionDeleteConfirmation } from "./views/session-delete-confirmation.ts";
import { renderSettingsHub } from "./views/settings.ts";
import { renderSetup } from "./views/setup.ts";
import { renderTasks } from "./views/tasks.ts";

const UPDATE_BANNER_DISMISS_KEY = "alisio:workspace:update-banner-dismissed:v1";

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
    const raw = storage.getItem(UPDATE_BANNER_DISMISS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DismissedUpdateBanner>;
    if (!parsed || typeof parsed.latestVersion !== "string") {
      return null;
    }
    return {
      latestVersion: parsed.latestVersion,
      channel: typeof parsed.channel === "string" ? parsed.channel : null,
      dismissedAtMs: typeof parsed.dismissedAtMs === "number" ? parsed.dismissedAtMs : Date.now(),
    };
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

function confirmLocalModelAction(message: string) {
  return typeof window === "undefined" ? true : window.confirm(message);
}

function scheduleConnectorAuthorizationRefresh(state: AppViewState, connectorId: string) {
  let attempts = 0;
  const maxAttempts = 45;

  const tick = () => {
    window.setTimeout(
      async () => {
        attempts += 1;
        await loadAlisioConnectors(state, { force: true }).catch(() => {});
        void loadAlisioProviderOverview(state, { force: true });
        const authorization =
          state.alisioProviders?.connectors.authorizations.find(
            (entry) => entry.connectorId === connectorId,
          ) ??
          state.alisioConnectorAuthorizations.find((entry) => entry.connectorId === connectorId);
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

function scheduleOpenAiRefresh(state: AppViewState) {
  let attempts = 0;
  const maxAttempts = 45;

  const tick = () => {
    window.setTimeout(
      async () => {
        attempts += 1;
        await refreshAlisioAi(state);
        const aiStatus = resolveEffectiveAlisioAiState(state)?.status ?? null;
        if (
          aiStatus === "connected" ||
          aiStatus === "limits_unavailable" ||
          attempts >= maxAttempts
        ) {
          return;
        }
        tick();
      },
      attempts === 0 ? 1000 : 2000,
    );
  };

  tick();
}

function beginOpenAiConnectFlow(state: AppViewState, callbackUrl: string) {
  const hasNativeHostBridge = hasAlisioHostBridge();
  const popup = hasNativeHostBridge ? null : reserveExternalPopup();
  void beginAlisioAiConnect(state, callbackUrl)
    .then((result) => {
      const targetUrl = result?.setupUrl;
      if (!targetUrl) {
        closeReservedExternalPopup(popup);
        return;
      }
      scheduleOpenAiRefresh(state);
      void openExternalTarget(targetUrl, {
        popup,
        openViaHost: hasNativeHostBridge ? (url) => openExternal(url) : null,
        preferNewTab: hasNativeHostBridge,
      });
    })
    .catch(() => {
      closeReservedExternalPopup(popup);
    });
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

function formatHeartbeatCadence(ms: number | null): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) {
    return t("alisio.shell.heartbeat.unavailable");
  }
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) {
    return `${Math.max(1, Math.round(ms / 1000))}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${totalMinutes}m`;
}

function formatHeartbeatCountdown(nextDueAtMs: number | null, nowMs: number): string {
  if (!nextDueAtMs || !Number.isFinite(nextDueAtMs)) {
    return t("alisio.shell.heartbeat.waiting");
  }
  const remainingMs = nextDueAtMs - nowMs;
  if (remainingMs <= 1500) {
    return t("alisio.shell.heartbeat.firingNow");
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${Math.max(1, seconds)}s`;
}

function shouldReserveConnectorPopup(state: AppViewState, connectorId: string) {
  if (connectorId === "stripe") {
    return false;
  }
  const authorization = state.alisioConnectorAuthorizations.find(
    (entry) => entry.connectorId === connectorId,
  );
  if (authorization?.state === "needs_reconnect") {
    return authorization.health !== "config_missing";
  }
  if (authorization?.health === "config_missing") {
    return false;
  }
  const definition = state.alisioConnectorCatalog.find((entry) => entry.id === connectorId);
  return definition?.availability === "ready" && isAlisioConnectorRuntimeReady(connectorId);
}

function connectorSetupErrorMessage(
  result: { statusReason?: string | null } | null | undefined,
): string {
  switch (result?.statusReason) {
    case "review_required":
      return t("alisio.authentications.errors.reviewPending");
    case "missing_client_config":
    case "missing_token_encryption":
    case "unavailable":
      return t("alisio.authentications.errors.unavailable");
    default:
      return t("alisio.authentications.errors.startFailed");
  }
}

function beginConnectorFlow(
  state: AppViewState,
  connectorId: string,
  opts?: {
    resumeChatIntent?: boolean;
    resumeMessage?: string;
  },
) {
  state.alisioConnectorsError = null;
  state.alisioConnectorSetupGuide = null;
  rememberAlisioConnectorOAuthReturnTo(window.location.href);
  const existingPendingResume = readPendingAlisioConnectorChatResume();
  if (opts?.resumeChatIntent) {
    const pendingResume = buildPendingAlisioConnectorChatResume({
      connectorId,
      sessionKey: state.sessionKey,
      messages: state.chatMessages,
      messageOverride: opts.resumeMessage,
    });
    if (pendingResume) {
      state.pendingConnectorChatResume = rememberPendingAlisioConnectorChatResume(pendingResume);
    } else {
      state.pendingConnectorChatResume = null;
      clearPendingAlisioConnectorChatResume();
    }
  } else if (existingPendingResume?.connectorId !== connectorId) {
    state.pendingConnectorChatResume = null;
    clearPendingAlisioConnectorChatResume();
  } else {
    state.pendingConnectorChatResume = existingPendingResume;
  }
  const hasNativeHostBridge = hasAlisioHostBridge();
  const popup =
    hasNativeHostBridge || !shouldReserveConnectorPopup(state, connectorId)
      ? null
      : reserveExternalPopup();
  void beginAlisioConnector(state, connectorId)
    .then((result) => {
      if (!result) {
        closeReservedExternalPopup(popup);
        state.alisioConnectorsError = t("alisio.authentications.errors.startFailed");
        return;
      }
      if (result.mode !== "oauth") {
        closeReservedExternalPopup(popup);
        state.setTab("authentications" as import("./navigation.ts").Tab);
        state.alisioConnectorDialogId = connectorId;
        state.alisioConnectorDialogMode = "install";
        state.alisioConnectorSetupGuide = result;
        if (result.statusReason !== "ready_for_setup") {
          state.alisioConnectorsError = result.setupHint ?? connectorSetupErrorMessage(result);
        }
        return;
      }
      const targetUrl = result.setupUrl;
      if (!targetUrl) {
        closeReservedExternalPopup(popup);
        state.alisioConnectorsError = t("alisio.authentications.errors.missingUrl");
        return;
      }
      state.alisioConnectorDialogId = null;
      state.alisioConnectorDialogMode = null;
      state.alisioConnectorSetupGuide = null;
      scheduleConnectorAuthorizationRefresh(state, connectorId);
      void openExternalTarget(targetUrl, {
        popup,
        openViaHost: hasNativeHostBridge ? (url) => openExternal(url) : null,
        preferNewTab: hasNativeHostBridge,
      }).then((navigationResult) => {
        if (navigationResult === "invalid") {
          state.alisioConnectorsError = t("alisio.authentications.errors.invalidUrl");
        }
      });
    })
    .catch((error) => {
      closeReservedExternalPopup(popup);
      state.alisioConnectorsError =
        error instanceof Error ? error.message : t("alisio.authentications.errors.startFailed");
    });
}

function resolveConnectorChatPrompt(state: AppViewState, connectorId: string): string {
  const definition =
    state.alisioProviders?.connectors.catalog.find((entry) => entry.id === connectorId) ??
    state.alisioConnectorCatalog.find((entry) => entry.id === connectorId);
  const title = definition?.title ?? connectorId;
  switch (connectorId) {
    case "gmail-read":
      return t("alisio.chat.welcome.featuredApps.gmailReadPrompt");
    case "gmail-send":
      return t("alisio.chat.welcome.featuredApps.gmailSendPrompt");
    case "google-calendar":
      return t("alisio.chat.welcome.featuredApps.googleCalendarPrompt");
    case "youtube":
      return t("alisio.authentications.chatPrompts.youtube");
    case "github":
      return t("alisio.authentications.chatPrompts.github");
    default:
      return t("alisio.authentications.chatPrompts.default", { app: title });
  }
}

function tryConnectorInChat(state: AppViewState, connectorId: string) {
  const prompt = resolveConnectorChatPrompt(state, connectorId);
  const authorization =
    state.alisioProviders?.connectors.authorizations.find(
      (entry) => entry.connectorId === connectorId,
    ) ?? state.alisioConnectorAuthorizations.find((entry) => entry.connectorId === connectorId);
  state.alisioConnectorDialogId = null;
  state.alisioConnectorDialogMode = null;
  state.setTab("chat");
  if (authorization?.state === "connected") {
    void state.handleSendChat(prompt);
    return;
  }
  beginConnectorFlow(state, connectorId, {
    resumeChatIntent: true,
    resumeMessage: prompt,
  });
}

export function renderApp(state: AppViewState) {
  const updatableState = state as AppViewState & { requestUpdate?: () => void };
  const requestHostUpdate =
    typeof updatableState.requestUpdate === "function"
      ? () => updatableState.requestUpdate?.()
      : undefined;
  const markPresentationSyncPending = () => {
    if (state.settings.presentationSyncPending === true) {
      return;
    }
    state.applySettings({
      ...state.settings,
      presentationSyncPending: true,
    });
  };
  const flushPresentationPreferences = () => {
    void state.flushPresentationPreferences?.();
  };
  const resetPresentationPreferences = () => {
    const defaults = resolveDefaultPresentationSelection();
    void i18n.setLocale(defaults.locale);
    state.applySettings({
      ...state.settings,
      locale: defaults.locale,
      themeFamily: defaults.themeFamily,
      themeMode: defaults.themeMode,
      themeAccents: defaults.themeAccents,
      presentationSyncPending: true,
    });
    flushPresentationPreferences();
  };

  const setupBlockedByBootstrap = alisioBootstrapBlocksChatAccess(state.alisioBootstrap);
  const shouldShowSetup = state.tab === "setup" || setupBlockedByBootstrap;
  const renderSearchButton = (className = "topbar-search") => html`
    <button
      class=${className}
      @click=${() => {
        state.paletteOpen = !state.paletteOpen;
      }}
      title=${t("alisio.shell.searchTitle")}
      aria-label=${t("alisio.shell.openCommandPalette")}
    >
      <span class="topbar-search__label">${t("common.search")}</span>
      <kbd class="topbar-search__kbd">⌘K</kbd>
    </button>
  `;
  const renderSetupView = () =>
    renderSetup({
      connected: state.connected,
      lastError: state.lastError,
      startupLoading: state.alisioStartupLoading,
      startupError: state.alisioStartupError,
      startupBootstrap: state.alisioStartupBootstrap,
      bootstrap: state.alisioBootstrap,
      requestedStep: state.setupStep,
      accountLoading: state.alisioAccountLoading,
      accountError: state.alisioAccountError,
      accountNotice: state.alisioAccountNotice,
      account: state.alisioAccount,
      authEmail: state.alisioAuthEmail,
      authPendingEmail: state.alisioAuthPendingEmail,
      authCode: state.alisioAuthCode,
      authStage: state.alisioAuthStage,
      passwordResetRequired: state.alisioPasswordResetRequired,
      termsAccepted: state.alisioTermsAccepted,
      marketingOptIn: state.alisioMarketingOptIn,
      birthdate: state.alisioBirthdate,
      onAuthEmailChange: (value) => {
        state.alisioAccountError = null;
        state.alisioAccountNotice = null;
        state.alisioAuthEmail = value;
      },
      onAuthCodeChange: (value) => {
        state.alisioAccountError = null;
        state.alisioAccountNotice = null;
        state.alisioAuthCode = value;
      },
      onAuthStageChange: (value) => {
        state.alisioAccountError = null;
        state.alisioAccountNotice = null;
        state.alisioAuthStage = value;
        if (value === "entry") {
          state.alisioAuthCode = "";
          state.alisioAuthPendingEmail = state.alisioAuthEmail;
        }
      },
      onTermsAcceptedChange: (value) => {
        state.alisioTermsAccepted = value;
        if (state.alisioAccount) {
          state.alisioAccount = {
            ...state.alisioAccount,
            profile: {
              ...state.alisioAccount.profile,
              termsAcceptedAt: value ? new Date().toISOString() : undefined,
            },
          };
        }
      },
      onMarketingOptInChange: (value) => {
        state.alisioMarketingOptIn = value;
        if (state.alisioAccount) {
          state.alisioAccount = {
            ...state.alisioAccount,
            profile: {
              ...state.alisioAccount.profile,
              marketingOptIn: value,
            },
          };
        }
      },
      onBirthdateChange: (value) => {
        state.alisioBirthdate = value;
        if (state.alisioAccount) {
          state.alisioAccount = {
            ...state.alisioAccount,
            profile: {
              ...state.alisioAccount.profile,
              birthdate: value || undefined,
            },
          };
        }
      },
      onConnect: () => state.connect(),
      onOpenWorkspace: () => state.setTab("chat" as import("./navigation.ts").Tab),
      onOpenSettingsAi: () => {
        state.setTab("models" as import("./navigation.ts").Tab);
      },
      onAccountFieldChange: (field, value) => {
        state.alisioAccountError = null;
        state.alisioAccountNotice = null;
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
      onBeginEmailAuth: () => {
        void beginAlisioAccountEmailAuth(state);
      },
      onVerifyEmailAuth: () => {
        void verifyAlisioAccountEmailAuth(state);
      },
      onSignInWithPassword: (email, password) => {
        void signInAlisioAccountWithPassword(state, { email, password });
      },
      onSignUpWithPassword: (email, password) => {
        void signUpAlisioAccountWithPassword(state, { email, password });
      },
      onRequestRecoveryEmail: () => {
        void requestAlisioRecoveryEmail(state);
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
          agentName: profile.agentName,
          avatarLabel: profile.avatarLabel,
          avatarUrl: profile.avatarUrl,
          termsAcceptedAt: state.alisioTermsAccepted
            ? (profile.termsAcceptedAt ?? new Date().toISOString())
            : "",
          marketingOptIn: state.alisioMarketingOptIn,
          birthdate: state.alisioBirthdate,
        });
      },
      onUpdatePassword: (password) => {
        void updateAlisioAccountPassword(state, { password });
      },
    });

  const chatDisabledReason = state.connected ? null : t("chat.disconnected");
  const activeTab = publicTabFor(state.tab);
  const isChat = activeTab === "chat";
  const chatSecurityDiagnostics = isChat
    ? (state.securityAccessDiagnostics ??
      resolveSecurityAccessDiagnostics({
        configForm: state.configForm ?? state.configSnapshot?.config ?? null,
        execApprovalsForm: state.execApprovalsForm ?? state.execApprovalsSnapshot?.file ?? null,
      }))
    : null;
  const managementModelCatalog =
    activeTab === "models"
      ? state.modelManagementCatalog.length > 0
        ? state.modelManagementCatalog
        : state.chatModelCatalog
      : [];
  const modelsPageModelOptions =
    activeTab === "models" ? buildChatModelOptions(managementModelCatalog) : [];
  const tabsWithLocalTransportError = new Set(["chat", "channels", "organization", "capabilities"]);
  const showGlobalErrorCallout = Boolean(
    state.lastError && !tabsWithLocalTransportError.has(activeTab),
  );
  const chatFocus = isChat && state.settings.chatFocusMode;
  const navDrawerOpen = Boolean(state.navDrawerOpen && !chatFocus);
  const navCollapsed = Boolean(state.settings.navCollapsed && !navDrawerOpen);
  const showThinking = state.settings.chatShowThinking;
  const showToolCalls = state.settings.chatShowToolCalls;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  const profile = state.alisioAccount?.profile ?? null;
  const profileName = profile?.displayName ?? "Alisio";
  const profileEmail = profile?.email ?? "alisio@local";
  const profileAvatarLabel = profile?.avatarLabel ?? "A";
  const profilePlan = profile?.plan
    ? t(alisioPlanTranslationKey(normalizeAlisioPlan(profile.plan)))
    : t("alisio.settings.sections.account");
  const appLogoUrl = agentLogoUrl(state.basePath ?? "");
  const connectionLabel = state.connected ? t("common.online") : t("common.offline");
  const heartbeatIntervalMs =
    typeof state.healthResult?.heartbeatSeconds === "number" &&
    state.healthResult.heartbeatSeconds > 0
      ? state.healthResult.heartbeatSeconds * 1000
      : null;
  const nextHeartbeatDueAtMs =
    typeof state.healthResult?.nextHeartbeatDueAtMs === "number"
      ? state.healthResult.nextHeartbeatDueAtMs
      : null;
  const heartbeatCountdownLabel = state.connected
    ? formatHeartbeatCountdown(nextHeartbeatDueAtMs, Date.now())
    : t("alisio.shell.heartbeat.unavailable");
  const heartbeatCadenceLabel = state.connected
    ? formatHeartbeatCadence(heartbeatIntervalMs)
    : t("alisio.shell.heartbeat.unavailable");
  const heartbeatStatusLabel = state.connected
    ? t("alisio.shell.heartbeat.subtitle")
    : t("alisio.shell.heartbeat.reconnecting");
  const heartbeatTitle = t("alisio.shell.heartbeat.title");
  const heartbeatAriaLabel = `${heartbeatTitle}. ${connectionLabel}. ${t("alisio.shell.heartbeat.next")}: ${heartbeatCountdownLabel}.`;
  const execApprovalsTarget = resolveSelectedExecApprovalsTarget(state);
  const resolveApprovalDecision = async (
    entry: import("./controllers/exec-approval.ts").ExecApprovalRequest,
    decision: "allow-once" | "allow-always" | "deny",
  ) => {
    if (!state.client || state.execApprovalBusy) {
      return;
    }
    state.execApprovalBusy = true;
    state.execApprovalError = null;
    try {
      await state.client.request(
        entry.kind === "plugin" ? "plugin.approval.resolve" : "exec.approval.resolve",
        {
          id: entry.id,
          decision,
        },
      );
      state.execApprovalQueue = state.execApprovalQueue.filter((item) => item.id !== entry.id);
      await loadGatewayAccessMode(state);
    } catch {
      state.execApprovalError = t("alisio.security.queue.resolveFailed");
    } finally {
      state.execApprovalBusy = false;
    }
  };
  const openSettingsSection = (section: import("./navigation.ts").SettingsSection) => {
    state.setSettingsSection(section);
  };
  const chatRuntimeSetupHint =
    (state as AppViewState & { chatRuntimeSetupHint?: ChatRuntimeSetupHint | null })
      .chatRuntimeSetupHint ?? null;
  const resolvedMemoryAgentId =
    activeTab === "memory"
      ? resolvePreferredMemoryAgentId({
          agentsList: state.agentsList,
          memorySelectedAgentId: state.memorySelectedAgentId,
          sessionKey: state.sessionKey,
          assistantAgentId: state.assistantAgentId,
        })
      : null;
  const refreshMemory = () => {
    void (async () => {
      await loadAgents(state, { force: true });
      const agentId = resolvePreferredMemoryAgentId({
        agentsList: state.agentsList,
        memorySelectedAgentId: state.memorySelectedAgentId,
        sessionKey: state.sessionKey,
        assistantAgentId: state.assistantAgentId,
      });
      if (!agentId) {
        return;
      }
      state.memorySelectedAgentId = agentId;
      await loadMemoryStatus(state, agentId, { reset: true, force: true });
    })();
  };
  if (shouldShowSetup) {
    return html`
      <section class="setup-frame">
        <header class="setup-frame__header">
          <a
            class="setup-frame__brand"
            href=${pathForTab("setup", state.basePath)}
            @click=${(event: MouseEvent) => {
              event.preventDefault();
              state.setTab("setup" as import("./navigation.ts").Tab);
            }}
          >
            <span class="setup-frame__brand-mark" aria-hidden="true"
              ><img src=${appLogoUrl} alt=""
            /></span>
            <span class="setup-frame__brand-copy">
              <span class="setup-frame__brand-eyebrow">Alisio</span>
              <span class="setup-frame__brand-title">${t("tabs.setup")}</span>
            </span>
          </a>
          <div class="setup-frame__meta">
            <span class="setup-frame__meta-pill">${connectionLabel}</span>
          </div>
        </header>
        <main class="setup-frame__body">${renderSetupView()}</main>
      </section>
    `;
  }
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
      <header class="topbar ${isChat ? "topbar--chat" : ""}">
        <div class="topnav-shell ${isChat ? "topnav-shell--chat" : ""}">
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
            ${isChat
              ? renderChatDesktopToolbar(state, {
                  searchButton: renderSearchButton("topbar-search topbar-search--chat"),
                  surface: "topbar",
                })
              : html`<dashboard-header .tab=${activeTab}></dashboard-header>`}
          </div>
          <div class="topnav-shell__actions ${isChat ? "topnav-shell__actions--chat" : ""}">
            ${renderSearchButton(
              isChat ? "topbar-search topbar-search--chat topbar-search--mobile" : "topbar-search",
            )}
            <div class="topbar-status">${isChat ? renderChatMobileToggle(state) : nothing}</div>
          </div>
        </div>
      </header>
      <div class="shell-nav">
        <aside class="sidebar ${navCollapsed ? "sidebar--collapsed" : ""}">
          <div class="sidebar-shell">
            <div class="sidebar-shell__header">
              <div
                class="sidebar-brand sidebar-brand--heartbeat ${state.connected
                  ? "is-online"
                  : "is-offline"}"
                tabindex="0"
                role="group"
                aria-label=${heartbeatAriaLabel}
              >
                <span class="sidebar-brand__avatar-stack" aria-hidden="true">
                  <span class="sidebar-brand__avatar-pulse"></span>
                  <span class="sidebar-brand__avatar">
                    <span class="sidebar-brand__avatar-face"></span>
                  </span>
                  <span
                    class="sidebar-brand__status-dot ${state.connected ? "is-online" : ""}"
                  ></span>
                </span>
                ${navCollapsed
                  ? nothing
                  : html`
                      <span class="sidebar-brand__copy">
                        <span class="sidebar-brand__eyebrow">${heartbeatStatusLabel}</span>
                        <span class="sidebar-brand__title">${heartbeatTitle}</span>
                      </span>
                    `}
                <div class="sidebar-brand__popover">
                  <div class="sidebar-brand__popover-header">
                    <div class="sidebar-brand__popover-copy">
                      <span class="sidebar-brand__popover-eyebrow">${heartbeatStatusLabel}</span>
                      <span class="sidebar-brand__popover-title">${heartbeatTitle}</span>
                    </div>
                    <span class="sidebar-brand__popover-pill ${state.connected ? "is-online" : ""}">
                      ${connectionLabel}
                    </span>
                  </div>
                  <div class="sidebar-brand__popover-meter" aria-hidden="true">
                    <span class="sidebar-brand__popover-meter-track"></span>
                    <span class="sidebar-brand__popover-meter-dot"></span>
                  </div>
                  <div class="sidebar-brand__popover-grid">
                    <div class="sidebar-brand__popover-stat">
                      <span class="sidebar-brand__popover-label"
                        >${t("alisio.shell.heartbeat.next")}</span
                      >
                      <strong class="sidebar-brand__popover-value"
                        >${heartbeatCountdownLabel}</strong
                      >
                    </div>
                    <div class="sidebar-brand__popover-stat">
                      <span class="sidebar-brand__popover-label"
                        >${t("alisio.shell.heartbeat.cadence")}</span
                      >
                      <strong class="sidebar-brand__popover-value">${heartbeatCadenceLabel}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="sidebar-shell__body">
              <nav
                class="sidebar-nav sidebar-nav--product"
                aria-label=${t("nav.primaryNavigation")}
              >
                ${TAB_GROUPS.map((group) => {
                  const groupLabel = group.label === "product" ? t("nav.product") : group.label;
                  return html`
                    <section class="nav-section">
                      ${navCollapsed
                        ? nothing
                        : html`
                            <div class="nav-section__label">
                              <span class="nav-section__label-text">${groupLabel}</span>
                            </div>
                          `}
                      <div class="nav-section__items">
                        ${group.tabs.map((tab) =>
                          renderTab(state, tab, {
                            collapsed: navCollapsed,
                            variant: navCollapsed ? "rail" : "panel",
                          }),
                        )}
                      </div>
                    </section>
                  `;
                })}
              </nav>
            </div>
            <div class="sidebar-shell__footer">
              ${navCollapsed
                ? html`
                    <div class="sidebar-footer-compact">
                      <button
                        type="button"
                        class="sidebar-footer-compact__account"
                        title=${profileName}
                        aria-label=${profileName}
                        @click=${() => openSettingsSection("account")}
                      >
                        <span class="sidebar-footer-compact__avatar">${profileAvatarLabel}</span>
                      </button>
                    </div>
                  `
                : html`
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
                    </div>
                  `}
            </div>
          </div>
          <button
            type="button"
            class="sidebar-edge-toggle ${navCollapsed ? "is-collapsed" : ""}"
            @click=${() =>
              state.applySettings({
                ...state.settings,
                navCollapsed: !state.settings.navCollapsed,
              })}
            title="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
            aria-label="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
            aria-pressed=${String(navCollapsed)}
          >
            <span class="sidebar-edge-toggle__icon" aria-hidden="true">${icons.chevronRight}</span>
          </button>
        </aside>
      </div>
      <main class="content ${isChat ? "content--chat" : ""}">
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
        ${showGlobalErrorCallout
          ? html`<div class="callout danger">${state.lastError}</div>`
          : nothing}
        ${activeTab === "authentications"
          ? renderAuthentications({
              loading: state.alisioConnectorsLoading,
              error: state.alisioConnectorsError,
              account: state.alisioAccount,
              overview: state.alisioProviders,
              connectorCatalog: state.alisioConnectorCatalog,
              connectorAuthorizations: state.alisioConnectorAuthorizations,
              connectorSetupGuide: state.alisioConnectorSetupGuide,
              search: state.alisioConnectorsSearch,
              dialogConnectorId: state.alisioConnectorDialogId,
              dialogMode: state.alisioConnectorDialogMode,
              onSearchChange: (value) => {
                state.alisioConnectorsSearch = value;
              },
              onOpenConnectorDetails: (connectorId) => {
                state.alisioConnectorSetupGuide = null;
                state.alisioConnectorDialogId = connectorId;
                state.alisioConnectorDialogMode = "details";
              },
              onOpenConnectorInstall: (connectorId) => {
                state.alisioConnectorSetupGuide = null;
                state.alisioConnectorDialogId = connectorId;
                state.alisioConnectorDialogMode = "install";
              },
              onCloseConnectorDialog: () => {
                state.alisioConnectorSetupGuide = null;
                state.alisioConnectorDialogId = null;
                state.alisioConnectorDialogMode = null;
              },
              onBeginConnector: (connectorId) => {
                beginConnectorFlow(state, connectorId);
              },
              onRevokeConnector: (connectorId) => {
                state.alisioConnectorSetupGuide = null;
                state.alisioConnectorDialogId = null;
                state.alisioConnectorDialogMode = null;
                void revokeAlisioConnector(state, connectorId);
              },
              onTryConnectorInChat: (connectorId) => {
                tryConnectorInChat(state, connectorId);
              },
            })
          : nothing}
        ${activeTab === "channels"
          ? renderChannels({
              connected: state.connected,
              connectionError: state.lastError,
              loading: state.channelsLoading,
              error: state.channelsError,
              snapshot: state.channelsSnapshot,
              lastSuccess: state.channelsLastSuccess,
              busyKey: state.channelsBusyKey,
              actionMessage: state.channelsActionMessage,
              loginQrDataUrl: state.channelsLoginQrDataUrl,
              loginAccountId: state.channelsLoginAccountId,
              setupLoading: state.channelsSetupLoading ?? false,
              setupSubmitting: state.channelsSetupSubmitting ?? false,
              setupSessionId: state.channelsSetupSessionId ?? null,
              setupStep: state.channelsSetupStep ?? null,
              setupStatus: state.channelsSetupStatus ?? null,
              setupError: state.channelsSetupError ?? null,
              setupDraftText: state.channelsSetupDraftText ?? "",
              setupDraftConfirm: state.channelsSetupDraftConfirm ?? false,
              setupDraftSelectIndex: state.channelsSetupDraftSelectIndex ?? 0,
              setupDraftMultiIndexes: state.channelsSetupDraftMultiIndexes ?? [],
              setupChannelId: state.channelsSetupChannelId ?? null,
              onRefresh: () => {
                void loadChannels(state, true);
              },
              onStartChannelSetup: (channelId) => {
                void startChannelSetup(state, channelId);
              },
              onContinueSetup: (answer) => {
                void continueChannelSetup(state, answer);
              },
              onCancelSetup: () => {
                void cancelChannelSetup(state);
              },
              onSetupDraftTextChange: (value) => {
                state.channelsSetupDraftText = value;
              },
              onSetupDraftConfirmChange: (value) => {
                state.channelsSetupDraftConfirm = value;
              },
              onSetupDraftSelectIndexChange: (value) => {
                state.channelsSetupDraftSelectIndex = value;
              },
              onSetupDraftMultiIndexesChange: (value) => {
                state.channelsSetupDraftMultiIndexes = value;
              },
              onStartWhatsAppLink: (force, accountId) => {
                void startWebChannelLogin(state, { force, accountId });
              },
              onWaitWhatsAppLink: (accountId) => {
                void waitWebChannelLogin(state, { accountId });
              },
              onLogoutChannel: (channelId, accountId) => {
                void logoutChannelAccount(state, { channelId, accountId });
              },
              onApproveChannelPairing: (channelId, accountId, requestId) => {
                void approveChannelPairingRequest(state, { channelId, accountId, requestId });
              },
              onRejectChannelPairing: (channelId, accountId, requestId) => {
                void rejectChannelPairingRequest(state, { channelId, accountId, requestId });
              },
              onOpenSupportUrl: (targetUrl) => {
                const hasNativeHostBridge = hasAlisioHostBridge();
                void openExternalTarget(targetUrl, {
                  openViaHost: hasNativeHostBridge ? (url) => openExternal(url) : null,
                  preferNewTab: true,
                });
              },
            })
          : nothing}
        ${activeTab === "capabilities"
          ? renderCapabilities({
              connected: state.connected,
              connectionError: state.lastError,
              loading: state.skillsLoading,
              report: state.skillsReport,
              error: state.skillsError,
              filter: state.skillsFilter,
              statusFilter: state.skillsStatusFilter,
              edits: state.skillEdits,
              busyKey: state.skillsBusyKey,
              messages: state.skillMessages,
              actionOutputs: state.skillActionOutputs,
              consentRequest: state.skillConsentRequest,
              detailKey: state.skillsDetailKey,
              channelsSnapshot: state.channelsSnapshot,
              connectorCatalog:
                state.alisioProviders?.connectors.catalog ?? state.alisioConnectorCatalog,
              connectorAuthorizations:
                state.alisioProviders?.connectors.authorizations ??
                state.alisioConnectorAuthorizations,
              onFilterChange: (value) => {
                state.skillsFilter = value;
              },
              onStatusFilterChange: (value) => {
                state.skillsStatusFilter = value;
              },
              onRefresh: () => {
                void Promise.allSettled([
                  loadChannels(state, false),
                  loadAlisioProviderOverview(state),
                  loadSkills(state),
                ]);
              },
              onToggle: (skillKey, enabled) => {
                void updateSkillEnabled(state, skillKey, enabled);
              },
              onEdit: (skillKey, value) => {
                updateSkillEdit(state, skillKey, value);
              },
              onEnvEdit: (skillKey, envName, value) => {
                updateSkillEnvEdit(state, skillKey, envName, value);
              },
              onSaveKey: (skillKey) => {
                void saveSkillApiKey(state, skillKey);
              },
              onSaveEnv: (skillKey, envName) => {
                void saveSkillEnv(state, skillKey, envName);
              },
              onInstall: (skillKey, name, installId) => {
                void installSkill(state, skillKey, name, installId);
              },
              onMarketplaceInstall: (skillKey) => {
                void installMarketplaceSkillAction(state, skillKey);
              },
              onMarketplaceRemove: (skillKey) => {
                void removeMarketplaceSkillAction(state, skillKey);
              },
              onMarketplaceExecute: (skillKey) => {
                void executeMarketplaceSkillAction(state, skillKey);
              },
              onConsentResolve: (decision) => {
                void resolveSkillConsentRequest(state, decision);
              },
              onConsentDismiss: () => {
                dismissSkillConsentRequest(state);
              },
              onEnableConfig: (skillKey, configPath) => {
                void enableSkillConfigPath(state, skillKey, configPath);
              },
              onAllowBundled: (skillKey) => {
                void allowBundledSkill(state, skillKey);
              },
              onDetailOpen: (skillKey) => {
                state.skillsDetailKey = skillKey;
              },
              onDetailClose: () => {
                if (state.skillConsentRequest?.skillKey === state.skillsDetailKey) {
                  dismissSkillConsentRequest(state);
                }
                state.skillsDetailKey = null;
              },
              onOpenChannels: () => {
                state.setTab("channels" as import("./navigation.ts").Tab);
              },
              onOpenAuthentications: () => {
                state.setTab("authentications" as import("./navigation.ts").Tab);
              },
              onOpenSettings: () => {
                state.setSettingsSection("account");
              },
            })
          : nothing}
        ${activeTab === "connections"
          ? renderConnections({
              assistantName: state.assistantName,
              assistantAgentId: state.assistantAgentId,
              computers: resolveComputersViewState(state),
              configForm: state.configForm,
              configLoading: state.configLoading,
              configSaving: state.configSaving,
              configDirty: state.configFormDirty,
              configFormMode: state.configFormMode,
              execApprovalsLoading: state.execApprovalsLoading,
              execApprovalsSaving: state.execApprovalsSaving,
              execApprovalsDirty: state.execApprovalsDirty,
              execApprovalsSnapshot: state.execApprovalsSnapshot,
              execApprovalsForm: state.execApprovalsForm,
              execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
              execApprovalsTarget: state.execApprovalsTarget,
              execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
              onRefresh: () => {
                const refreshes = [
                  loadNodes(state),
                  loadDevices(state),
                  loadAlisioSharing(state),
                  loadNodePairings(state),
                ];
                if (state.configForm || state.configLoading || state.configFormDirty) {
                  refreshes.push(loadConfig(state));
                }
                void Promise.allSettled(refreshes);
              },
              onNodePairingsRefresh: () => {
                void Promise.allSettled([loadNodes(state), loadNodePairings(state)]);
              },
              onDeviceApprove: (requestId) => {
                void approveDevicePairing(state, requestId);
              },
              onDeviceReject: (requestId) => {
                void rejectDevicePairing(state, requestId);
              },
              onDeviceRemoveComputer: (label, deviceIds) => {
                void removeComputerPairings(state, { label, deviceIds });
              },
              onDeviceCleanupComputer: (label, staleDeviceIds) => {
                void cleanupComputerPairings(state, { label, staleDeviceIds });
              },
              onSharingRequest: (targetId, scopes) => {
                void requestAlisioSharedDeviceAccess(state, targetId, scopes);
              },
              onSharingApprove: (requestId, scopes) => {
                void approveAlisioSharedDeviceRequest(state, requestId, scopes);
              },
              onSharingReject: (requestId) => {
                void rejectAlisioSharedDeviceRequest(state, requestId);
              },
              onSharingRevoke: (grantId) => {
                void revokeAlisioSharedDeviceGrant(state, grantId);
              },
              onSharingSetPolicy: (allowExternalUse) => {
                void saveAlisioSharingPolicy(state, allowExternalUse);
              },
              onSharingSetResourcePolicy: (resource, mode) => {
                void saveAlisioSharingPolicy(state, {
                  resourcePolicies: {
                    [resource]: mode,
                  },
                });
              },
              onRemoteComputerCommandChange: (computerId, value) => {
                updateRemoteComputerDraft(state, { computerId, command: value });
              },
              onRemoteComputerCwdChange: (computerId, value) => {
                updateRemoteComputerDraft(state, { computerId, cwd: value });
              },
              onRemoteComputerRun: (computerId, nodeId) => {
                void runRemoteComputerCommand(state, { computerId, nodeId });
              },
              onNodeApprove: (requestId) => {
                void Promise.allSettled([approveNodePairing(state, requestId), loadNodes(state)]);
              },
              onNodeReject: (requestId) => {
                void Promise.allSettled([rejectNodePairing(state, requestId), loadNodes(state)]);
              },
              onDeviceRotate: (deviceId, role, scopes, label) => {
                void rotateDeviceToken(state, { deviceId, role, scopes, label });
              },
              onDeviceRevoke: (deviceId, role, label) => {
                void revokeDeviceToken(state, { deviceId, role, label });
              },
              onLoadConfig: () => {
                void loadConfig(state);
              },
              onLoadExecApprovals: () => {
                void loadSelectedExecApprovals(state);
              },
              onBindDefault: (nodeId) => {
                if (nodeId) {
                  updateConfigFormValue(state, ["tools", "exec", "node"], nodeId);
                  return;
                }
                removeConfigFormValue(state, ["tools", "exec", "node"]);
              },
              onBindAgent: (agentIndex, nodeId) => {
                const source =
                  (state.configForm as { agents?: { list?: unknown[] } } | null)?.agents?.list ??
                  (state.configSnapshot?.config as { agents?: { list?: unknown[] } } | null)?.agents
                    ?.list;
                const entry =
                  Array.isArray(source) &&
                  source[agentIndex] &&
                  typeof source[agentIndex] === "object"
                    ? (source[agentIndex] as { id?: string })
                    : null;
                const targetIndex =
                  typeof entry?.id === "string" && entry.id.trim()
                    ? agentIndex
                    : ensureAgentConfigEntry(state, "main");
                if (targetIndex < 0) {
                  return;
                }
                if (nodeId) {
                  updateConfigFormValue(
                    state,
                    ["agents", "list", targetIndex, "tools", "exec", "node"],
                    nodeId,
                  );
                  return;
                }
                removeConfigFormValue(state, [
                  "agents",
                  "list",
                  targetIndex,
                  "tools",
                  "exec",
                  "node",
                ]);
              },
              onSaveBindings: () => {
                void saveConfig(state);
              },
              onExecApprovalsTargetChange: (kind, nodeId) => {
                void changeExecApprovalsTarget(state, { kind, nodeId });
              },
              onExecApprovalsSelectAgent: (agentId) => {
                state.execApprovalsSelectedAgent = agentId;
              },
              onExecApprovalsPatch: (path, value) => {
                updateExecApprovalsFormValue(state, path, value);
              },
              onExecApprovalsRemove: (path) => {
                removeExecApprovalsFormValue(state, path);
              },
              onSaveExecApprovals: () => {
                void saveExecApprovals(state, execApprovalsTarget);
              },
            })
          : nothing}
        ${activeTab === "security"
          ? renderSecurity({
              assistantName: state.assistantName,
              assistantAgentId: state.assistantAgentId,
              loading: state.nodesLoading || state.configLoading,
              nodes: state.nodes,
              configSnapshot: state.configSnapshot,
              configForm: state.configForm,
              configLoading: state.configLoading,
              configSaving: state.configSaving,
              configDirty: state.configFormDirty,
              configFormMode: state.configFormMode,
              execApprovalsLoading: state.execApprovalsLoading,
              execApprovalsSaving: state.execApprovalsSaving,
              execApprovalsDirty: state.execApprovalsDirty,
              execApprovalsSnapshot: state.execApprovalsSnapshot,
              execApprovalsForm: state.execApprovalsForm,
              execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
              execApprovalsTarget: state.execApprovalsTarget,
              execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
              execApprovalQueue: state.execApprovalQueue,
              execApprovalAuditTrail: state.execApprovalAuditTrail,
              execApprovalBusy: state.execApprovalBusy,
              execApprovalError: state.execApprovalError,
              gatewayAccessModeLoading: state.gatewayAccessModeLoading,
              gatewayAccessModeBusy: state.gatewayAccessModeBusy,
              gatewayAccessMode: state.gatewayAccessMode,
              securityDiagnostics: state.securityAccessDiagnostics,
              onRefresh: () => {
                void Promise.allSettled([
                  loadNodes(state),
                  loadConfig(state),
                  loadSelectedExecApprovals(state),
                  loadGatewayAccessMode(state),
                ]);
              },
              onLoadExecApprovals: () => {
                void loadSelectedExecApprovals(state);
              },
              onExecApprovalsTargetChange: (kind, nodeId) => {
                void changeExecApprovalsTarget(state, { kind, nodeId });
              },
              onExecApprovalsSelectAgent: (agentId) => {
                state.execApprovalsSelectedAgent = agentId;
              },
              onExecApprovalsPatch: (path, value) => {
                updateExecApprovalsFormValue(state, path, value);
              },
              onExecApprovalsRemove: (path) => {
                removeExecApprovalsFormValue(state, path);
              },
              onSaveExecApprovals: () => {
                void saveExecApprovals(state, execApprovalsTarget);
              },
              onResolveApproval: (entry, decision) => {
                void resolveApprovalDecision(entry, decision);
              },
              onApplyAccessMode: (mode) => {
                void applyGatewayAccessMode(state, mode);
              },
            })
          : nothing}
        ${activeTab === "tasks"
          ? renderTasks({
              loading: state.tasksLoading,
              busy: state.tasksBusy,
              error: state.tasksError,
              overview: state.tasksOverview,
              detailLoading: state.tasksDetailLoading,
              detail: state.tasksDetail,
              selectedId: state.tasksSelectedId,
              query: state.tasksQuery,
              runtimeFilter: state.tasksRuntimeFilter,
              statusFilter: state.tasksStatusFilter,
              onRefresh: () => {
                void loadTasksOverview(state);
              },
              onQueryChange: (value) => {
                state.tasksQuery = value;
                scheduleTasksOverviewRefresh(state, { quiet: true });
              },
              onRuntimeFilterChange: (value) => {
                state.tasksRuntimeFilter = value;
                scheduleTasksOverviewRefresh(state, { quiet: true });
              },
              onStatusFilterChange: (value) => {
                state.tasksStatusFilter = value;
                scheduleTasksOverviewRefresh(state, { quiet: true });
              },
              onSelectTask: (taskId) => {
                void selectTask(state, taskId);
              },
              onCancelTask: (taskId) => {
                void cancelTask(state, taskId);
              },
              onResolveProposal: (proposal, decision) => {
                void resolveTaskProposal(state, proposal, decision);
              },
              onLaunchProposal: (proposal) => {
                void (async () => {
                  const launched = await launchTaskProposal(state, proposal);
                  if (!launched) {
                    return;
                  }
                  switchChatSession(state, launched.sessionKey);
                  state.setTab?.("chat");
                })();
              },
              onOpenRequesterSession: (sessionKey) => {
                switchChatSession(state, sessionKey);
                state.setTab?.("chat");
              },
              onOpenChildSession: (sessionKey) => {
                switchChatSession(state, sessionKey);
                state.setTab?.("chat");
              },
              resolveSessionBrowserPanePreview: (sessionKey) =>
                state.resolveSessionBrowserPanePreview?.(sessionKey) ?? null,
            })
          : nothing}
        ${activeTab === "cron"
          ? renderCron({
              loading: state.cronLoading,
              status: state.cronStatus,
              jobs: state.cronJobs,
              error: state.cronError,
              calendarMode: state.cronCalendarMode,
              calendarCursorMs: state.cronCalendarCursorMs,
              calendarSelectedDayMs: state.cronCalendarSelectedDayMs,
              onCalendarChange: (patch) => {
                if (patch.mode) {
                  state.cronCalendarMode = patch.mode;
                }
                if (typeof patch.cursorMs === "number") {
                  state.cronCalendarCursorMs = patch.cursorMs;
                }
                if ("selectedDayMs" in patch) {
                  state.cronCalendarSelectedDayMs = patch.selectedDayMs ?? null;
                }
              },
              onRefresh: () => {
                void state.loadCron();
              },
              onToggle: (job, enabled) => {
                void toggleCronJob(state, job, enabled);
              },
              onRun: (job, mode) => {
                void runCronJob(state, job, mode);
              },
            })
          : nothing}
        ${activeTab === "organization"
          ? renderOrganization({
              connected: state.connected,
              connectionError: state.lastError,
              accountReady: Boolean(
                (state.alisioAccount?.session.state === "signed_in" &&
                  state.alisioAccount.session.profileCompleted) ||
                state.alisioBootstrap?.accountReady,
              ),
              plan:
                state.alisioAccount?.profile.plan ?? state.alisioBootstrap?.account?.profile.plan,
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
        ${activeTab === "chat"
          ? html`
              <section class="alisio-chat-shell">
                ${renderChat({
                  startupLoading: state.alisioStartupLoading,
                  bootstrapLoading: state.alisioBootstrapLoading,
                  sessionKey: state.sessionKey,
                  showThinking,
                  showToolCalls,
                  loading: state.chatLoading,
                  sending: state.chatSending,
                  finalizing: state.chatFinalizing,
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
                  canSend: state.connected && !isChatModelSwitchPending(state),
                  accessMode: state.gatewayAccessMode,
                  accessModeLoading: state.gatewayAccessModeLoading,
                  accessModeBusy: state.gatewayAccessModeBusy,
                  disabledReason: chatDisabledReason,
                  error: state.lastError,
                  runtimeSetupHint: chatRuntimeSetupHint,
                  sessions: state.sessionsResult,
                  focusMode: chatFocus,
                  onToggleFocusMode: () => {
                    state.applySettings({
                      ...state.settings,
                      chatFocusMode: !state.settings.chatFocusMode,
                    });
                  },
                  onApplyAccessMode: (mode) => {
                    void applyGatewayAccessMode(state, mode);
                  },
                  onChatScroll: (event) => state.handleChatScroll(event),
                  getDraft: () => state.chatMessage,
                  onDraftChange: (next) => (state.chatMessage = next),
                  onOpenRuntimeSetup: () => {
                    state.setTab("models" as import("./navigation.ts").Tab);
                  },
                  onBeginConnector: (connectorId) => {
                    beginConnectorFlow(state, connectorId, { resumeChatIntent: true });
                  },
                  onOpenAuthentications: () => {
                    state.setTab("authentications" as import("./navigation.ts").Tab);
                  },
                  onRequestUpdate: requestHostUpdate,
                  securityDiagnostics: chatSecurityDiagnostics,
                  approvalQueue: state.execApprovalQueue,
                  approvalAuditTrail: state.execApprovalAuditTrail,
                  approvalBusy: state.execApprovalBusy,
                  nativeShellLoading: state.nativeShellLoading,
                  nativeShellError: state.nativeShellError,
                  nativeShellState: state.nativeShellState,
                  taskProposals: state.tasksOverview?.proposals ?? [],
                  taskProposalBusy: state.tasksBusy,
                  attachments: state.chatAttachments,
                  onAttachmentsChange: (next) => (state.chatAttachments = next),
                  composerModelSelect: renderChatComposerModelSelect(state),
                  onSend: () => state.handleSendChat(),
                  canAbort: Boolean(state.chatRunId),
                  onAbort: () => void state.handleAbortChat(),
                  onResolveApproval: (entry, decision) => {
                    void resolveApprovalDecision(entry, decision);
                  },
                  onSaveTaskProposal: (proposal) => {
                    void saveTaskProposal(state, proposal);
                  },
                  onResolveTaskProposal: (proposal, decision) => {
                    void resolveTaskProposal(state, proposal, decision);
                  },
                  onLaunchTaskProposal: (proposal, persisted) => {
                    void (async () => {
                      const launched = await launchTaskProposal(state, persisted ?? proposal);
                      if (!launched) {
                        return;
                      }
                      switchChatSession(state, launched.sessionKey);
                      state.setTab("chat" as import("./navigation.ts").Tab);
                    })();
                  },
                  onOpenTasks: () => {
                    state.setTab("tasks" as import("./navigation.ts").Tab);
                  },
                  onOpenTaskSession: (sessionKey) => {
                    switchChatSession(state, sessionKey);
                    state.setTab("chat" as import("./navigation.ts").Tab);
                  },
                  onOpenNativeSettings:
                    state.nativeShellState || state.nativeShellLoading || state.nativeShellError
                      ? () => {
                          void openNativeSettings("mac");
                        }
                      : undefined,
                  onQueueRemove: (id) => state.removeQueuedMessage(id),
                  showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
                  onScrollToBottom: () => state.scrollToBottom(),
                  sidebarOpen: state.sidebarOpen,
                  browserPaneBrowserState: state.browserPaneBrowserState,
                  sidebarContent: state.sidebarContent,
                  sidebarError: state.sidebarError,
                  browserPaneSurfaceKind: state.browserPaneSurfaceKind,
                  computerSessionLoading: hasAlisioHostBridge()
                    ? state.computerSessionLoading
                    : false,
                  computerSessionError: hasAlisioHostBridge() ? state.computerSessionError : null,
                  computerSession: hasAlisioHostBridge() ? state.computerSession : null,
                  selectedComputerReplayStepId: state.selectedComputerReplayStepId,
                  computerStepDetailsOpen: state.computerStepDetailsOpen,
                  splitRatio: state.splitRatio,
                  onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
                  onCloseSidebar: () => state.handleCloseSidebar(),
                  onSelectBrowserPaneSurface: (surface) =>
                    state.handleSelectBrowserPaneSurface(surface),
                  onSelectComputerReplayStep: hasAlisioHostBridge()
                    ? (stepId) => state.handleSelectComputerReplayStep(stepId)
                    : undefined,
                  onToggleComputerStepDetails: hasAlisioHostBridge()
                    ? (open) => state.handleToggleComputerStepDetails(open)
                    : undefined,
                  onComputerSessionCommand: hasAlisioHostBridge()
                    ? (command) => state.handleComputerSessionCommand(command)
                    : undefined,
                  onComputerSessionApproval: hasAlisioHostBridge()
                    ? (decision) => state.handleComputerSessionApproval(decision)
                    : undefined,
                  onRequestComputerPermission: hasAlisioHostBridge()
                    ? (permission) => state.handleRequestComputerPermission(permission)
                    : undefined,
                  onOpenComputerSession: hasAlisioHostBridge()
                    ? (sessionKey) => {
                        switchChatSession(state, sessionKey);
                        state.setTab("chat" as import("./navigation.ts").Tab);
                      }
                    : undefined,
                  onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
                  assistantName: state.assistantName,
                  assistantAvatar: state.assistantAvatar,
                  assistantAgentId: state.assistantAgentId,
                  basePath: state.basePath ?? "",
                  viewerDisplayName: profile?.displayName ?? null,
                  connectorCatalog: state.alisioConnectorCatalog,
                  connectorAuthorizations: state.alisioConnectorAuthorizations,
                })}
              </section>
            `
          : nothing}
        ${activeTab === "memory"
          ? renderMemoryHub({
              client: state.client,
              connected: state.connected,
              aiState: resolveEffectiveAlisioAiState(state),
              agentsLoading: state.agentsLoading,
              agentsError: state.agentsError,
              agentsList: state.agentsList,
              selectedAgentId: resolvedMemoryAgentId,
              memoryStatusLoading: state.memoryStatusLoading,
              memoryStatusError: state.memoryStatusError,
              memoryStatus: state.memoryStatus,
              memoryGraphLoading: state.memoryGraphLoading,
              memoryGraphError: state.memoryGraphError,
              memoryGraph: state.memoryGraph,
              searchQuery: state.memorySearchQuery,
              onSelectAgent: (agentId) => {
                state.memorySelectedAgentId = agentId;
                state.memoryGraph = null;
                state.memoryGraphError = null;
                state.memoryGraphLoading = false;
                void loadMemoryStatus(state, agentId, { reset: true });
              },
              onRefresh: refreshMemory,
              onSearchChange: (value) => {
                state.memorySearchQuery = value;
              },
            })
          : nothing}
        ${activeTab === "models"
          ? renderModelsHub({
              bootstrap: state.alisioBootstrap,
              models: state.alisioModels,
              modelsLoading: state.alisioModelsLoading,
              modelsError: state.alisioModelsError,
              modelOperations: state.alisioModelOperations,
              aiLoading: state.alisioAiLoading,
              aiError: state.alisioAiError,
              expandedProfileId: state.modelsExpandedProfileId,
              selectedProviderId: state.modelsSelectedProviderId,
              profileSort: state.modelsAiProfileSort,
              profileRecentIds: state.modelsAiProfileRecentIds,
              onToggleProfile: (profileId) => {
                state.modelsExpandedProfileId =
                  state.modelsExpandedProfileId === profileId ? null : profileId;
              },
              onProfileSortChange: (sort) => {
                state.modelsAiProfileSort = sort;
              },
              onSelectProvider: (providerId) => {
                state.modelsSelectedProviderId = providerId;
              },
              onConnectAi: () => {
                const callbackUrl = resolveAlisioOpenAiCallbackUrl(state);
                beginOpenAiConnectFlow(state, callbackUrl);
              },
              onRefreshAllAiProfiles: () => {
                void refreshAlisioAi(state);
              },
              onSelectAiProfile: (profileId) => {
                state.modelsAiProfileRecentIds = [
                  profileId,
                  ...(state.modelsAiProfileRecentIds ?? []).filter((entry) => entry !== profileId),
                ];
                state.modelsExpandedProfileId = profileId;
                void selectAlisioAiProfile(state, profileId);
              },
              onDisconnectAiProfile: (profileId) => {
                void disconnectAlisioAiProfile(state, profileId);
              },
              onRefreshAiProfile: (profileId) => {
                void refreshAlisioAiProfile(state, profileId);
              },
              onRenameAiProfile: (profileId, label) => {
                void renameAlisioAiProfile(state, profileId, label);
              },
              modelOptions: modelsPageModelOptions,
              onInstallModel: (targetId, modelId) => {
                const target = state.alisioModels?.targets.find(
                  (entry) => entry.targetId === targetId,
                );
                const targetLabel = target
                  ? [target.runtimeLabel, target.label].filter(Boolean).join(" · ")
                  : targetId;
                if (
                  !confirmLocalModelAction(
                    t("alisio.settings.models.confirmInstall", {
                      model: modelId,
                      target: targetLabel,
                    }),
                  )
                ) {
                  return;
                }
                void installAlisioModel(state, { targetId, modelId });
              },
              onUpdateModel: (targetId, modelId) => {
                const target = state.alisioModels?.targets.find(
                  (entry) => entry.targetId === targetId,
                );
                const targetLabel = target
                  ? [target.runtimeLabel, target.label].filter(Boolean).join(" · ")
                  : targetId;
                if (
                  !confirmLocalModelAction(
                    t("alisio.settings.models.confirmUpdate", {
                      model: modelId,
                      target: targetLabel,
                    }),
                  )
                ) {
                  return;
                }
                void installAlisioModel(state, { targetId, modelId });
              },
              onUninstallModel: (targetId, modelId) => {
                const target = state.alisioModels?.targets.find(
                  (entry) => entry.targetId === targetId,
                );
                const targetLabel = target
                  ? [target.runtimeLabel, target.label].filter(Boolean).join(" · ")
                  : targetId;
                if (
                  !confirmLocalModelAction(
                    t("alisio.settings.models.confirmUninstall", {
                      model: modelId,
                      target: targetLabel,
                    }),
                  )
                ) {
                  return;
                }
                void uninstallAlisioModel(state, { targetId, modelId });
              },
            })
          : nothing}
        ${activeTab === "settings"
          ? renderSettingsHub({
              section: state.settingsSection,
              onSectionChange: (section) => {
                state.setSettingsSection(section);
              },
              accountLoading: state.alisioAccountLoading,
              accountError: state.alisioAccountError,
              accountNotice: state.alisioAccountNotice,
              account: state.alisioAccount,
              doctorLoading: state.alisioDoctorLoading,
              doctorError: state.alisioDoctorError,
              doctor: state.alisioDoctor,
              locale: state.settings.locale,
              themeFamily: state.themeFamily,
              themeMode: state.themeMode,
              themeAccents: state.themeAccents,
              onLocaleChange: (locale) => {
                void i18n.setLocale(locale);
                state.applySettings({
                  ...state.settings,
                  locale,
                  presentationSyncPending: true,
                });
                flushPresentationPreferences();
              },
              onThemeFamilyChange: (themeFamily, context) => {
                state.setThemeFamily(themeFamily, context);
                markPresentationSyncPending();
                flushPresentationPreferences();
              },
              onThemeAccentChange: (themeFamily, accent) => {
                state.setThemeAccent(themeFamily, accent);
                markPresentationSyncPending();
                flushPresentationPreferences();
              },
              onThemeModeChange: (themeMode) => {
                state.setThemeMode(themeMode);
                markPresentationSyncPending();
                flushPresentationPreferences();
              },
              onResetPresentation: resetPresentationPreferences,
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
                void openNativeSettings("mac");
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
              onRequestRecoveryEmail: () => {
                void requestAlisioRecoveryEmail(state);
              },
              onChangeEmail: (email) => {
                void changeAlisioAccountEmail(state, { email });
              },
              onUpdatePassword: (password) => {
                void updateAlisioAccountPassword(state, { password });
              },
              onReconnectRuntime: () => {
                void restartAlisioRuntime(state).catch(() => {
                  state.connect();
                });
              },
              nativeRebuildAvailable:
                Boolean(state.nativeShellState?.developerCheckoutAvailable) ||
                Boolean(window.__ALISIO_CONTROL_UI_DEV_GATEWAY_PORT__?.trim()),
              nativeRebuildInFlight: state.nativeRebuildInFlight,
              nativeRebuildStatus: state.nativeRebuildStatus,
              nativeRebuildError: state.nativeRebuildError,
              onRebuildNativeApp: () => {
                state.nativeRebuildInFlight = true;
                state.nativeRebuildStatus = null;
                state.nativeRebuildError = null;
                const rebuildPromise =
                  state.client && state.connected
                    ? rebuildAlisioApp(state).then((result) => {
                        if (!result) {
                          throw new Error(t("alisio.settings.doctor.rebuildUnavailable"));
                        }
                        state.nativeRebuildStatus = result.message;
                      })
                    : state.nativeShellState?.developerCheckoutAvailable
                      ? rebuildAppFromCheckout().then(() => {
                          state.nativeRebuildStatus = t("alisio.settings.doctor.rebuildStarted");
                        })
                      : Promise.reject(new Error(t("alisio.settings.doctor.rebuildUnavailable")));
                void rebuildPromise
                  .catch((error) => {
                    state.nativeRebuildError =
                      error instanceof Error ? error.message : String(error);
                  })
                  .finally(() => {
                    state.nativeRebuildInFlight = false;
                  });
              },
            })
          : nothing}
      </main>
      ${renderExecApprovalPrompt(state)} ${renderGatewayUrlConfirmation(state)}
      ${renderSessionDeleteConfirmation(state)} ${nothing}
    </div>
  `;
}
