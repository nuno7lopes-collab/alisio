import { roleScopesAllow } from "../../../src/shared/operator-scope-compat.js";
import { docsUrl } from "../brand-compat.ts";
import { i18n, isSupportedLocale } from "../i18n/index.ts";
import { loadNativeShellState } from "./alisio-host.ts";
import { alisioBootstrapBlocksChatAccess, resolveBlockingSetupStep } from "./alisio-setup-state.ts";
import { refreshChat } from "./app-chat.ts";
import {
  startLogsPolling,
  stopLogsPolling,
  startDebugPolling,
  stopDebugPolling,
} from "./app-polling.ts";
import { scheduleChatScroll, scheduleLogsScroll } from "./app-scroll.ts";
import type { AlisioApp } from "./app.ts";
import { normalizeBasePath } from "./base-path.ts";
import { resolvePreferredMemoryAgentId } from "./controllers/agent-memory.ts";
import { loadAgents } from "./controllers/agents.ts";
import {
  loadAlisioBootstrap,
  loadAlisioAccount,
  loadAlisioConnectors,
  loadAlisioDoctorSummary,
  loadAlisioModels,
  loadAlisioOrganization,
  loadAlisioProviderOverview,
  loadAlisioSharing,
} from "./controllers/alisio.ts";
import { loadChannels } from "./controllers/channels.ts";
import { loadConfig } from "./controllers/config.ts";
import { loadCronJobsPage, loadCronRuns, loadCronStatus } from "./controllers/cron.ts";
import { loadDebug } from "./controllers/debug.ts";
import { loadDevices } from "./controllers/devices.ts";
import { loadSelectedExecApprovals } from "./controllers/exec-approvals.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadMemoryStatus } from "./controllers/memory-runtime.ts";
import { loadNodePairings } from "./controllers/node-pairing.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadPresence } from "./controllers/presence.ts";
import { loadGatewayAccessMode } from "./controllers/security-access.ts";
import { loadSessions } from "./controllers/sessions.ts";
import { loadSkills } from "./controllers/skills.ts";
import { loadTasksOverview } from "./controllers/tasks.ts";
import { loadUsage } from "./controllers/usage.ts";
import {
  inferBasePathFromPathname,
  normalizePath,
  normalizeSettingsSection,
  pathForTab,
  publicTabFor,
  tabFromPath,
  type SettingsSection,
  type Tab,
} from "./navigation.ts";
import { presentationSelectionsEqual } from "./presentation-preferences.ts";
import { saveSettings, type UiSettings } from "./storage.ts";
import { startThemeTransition, type ThemeTransitionContext } from "./theme-transition.ts";
import {
  buildResolvedThemeAccentVariables,
  resolveTheme,
  resolveThemeFamilyFromResolved,
  resolveThemeModeFromResolved,
  setThemeAccent as setThemeAccentMapValue,
  themeAccentMapsEqual,
  type ResolvedTheme,
  type ThemeFamily,
  type ThemeMode,
} from "./theme.ts";
import type { AgentsListResult, AttentionItem } from "./types.ts";
import { resetChatViewState } from "./views/chat.ts";

type SettingsHost = {
  settings: UiSettings;
  password?: string;
  themeFamily: ThemeFamily;
  themeMode: ThemeMode;
  themeAccents: UiSettings["themeAccents"];
  themeResolved: ResolvedTheme;
  applySessionKey: string;
  sessionKey: string;
  tab: Tab;
  setTab?: (tab: Tab) => void;
  settingsSection: SettingsSection;
  connected: boolean;
  alisioAccount?: import("./types.ts").AlisioAccountState | null;
  alisioBootstrap?: import("./types.ts").AlisioBootstrapState | null;
  setupStep?: import("./types.ts").AlisioBootstrapStep | null;
  chatHasAutoScrolled: boolean;
  logsAtBottom: boolean;
  eventLog: unknown[];
  eventLogBuffer: unknown[];
  basePath: string;
  assistantAgentId?: string | null;
  agentsList?: AgentsListResult | null;
  memorySelectedAgentId?: string | null;
  agentsSelectedId?: string | null;
  agentsPanel?: "overview" | "files" | "tools" | "skills" | "channels" | "cron";
  sessionsHideCron?: boolean;
  pendingGatewayUrl?: string | null;
  systemThemeCleanup?: (() => void) | null;
  pendingGatewayToken?: string | null;
  client?: import("./gateway.ts").GatewayBrowserClient | null;
  flushPresentationPreferences?: () => Promise<void>;
  nativeShellLoading?: boolean;
  nativeShellError?: string | null;
  nativeShellState?: import("./types.ts").NativeShellState | null;
  execApprovalsTarget?: "gateway" | "node";
  execApprovalsTargetNodeId?: string | null;
  sessionsLoading?: boolean;
  sessionsResult?: import("./types.ts").SessionsListResult | null;
  sessionsError?: string | null;
  chatModelsLoading?: boolean;
  chatModelCatalog?: import("./types.ts").ModelCatalogEntry[];
  modelManagementLoading?: boolean;
  modelManagementCatalog?: import("./types.ts").ModelCatalogEntry[];
};

type RefreshActiveTabOptions = {
  includeChatHistory?: boolean;
  preloadedShellState?: "bootstrap" | "doctor";
};

function bootstrapBlocksChatAccess(
  bootstrap: import("./types.ts").AlisioBootstrapState | null | undefined,
) {
  return alisioBootstrapBlocksChatAccess(bootstrap);
}

function normalizeSetupStep(
  value: string | null | undefined,
): import("./types.ts").AlisioBootstrapStep | null {
  switch ((value ?? "").trim()) {
    case "gateway":
    case "runtime":
    case "account":
    case "organization":
    case "connectors":
    case "permissions":
    case "ready":
      return value as import("./types.ts").AlisioBootstrapStep;
    default:
      return null;
  }
}

function resolveSetupStep(host: SettingsHost): import("./types.ts").AlisioBootstrapStep | null {
  if (!host.connected) {
    return "account";
  }
  if (bootstrapBlocksChatAccess(host.alisioBootstrap)) {
    return resolveBlockingSetupStep({
      connected: host.connected,
      bootstrap: host.alisioBootstrap,
    });
  }
  return null;
}

export function applySettings(host: SettingsHost, next: UiSettings) {
  const previous = host.settings;
  const gatewayUrlChanged = next.gatewayUrl.trim() !== previous.gatewayUrl.trim();
  const shouldClearToken = gatewayUrlChanged && next.token === previous.token;
  const normalized = {
    ...next,
    token: shouldClearToken ? "" : next.token,
    lastActiveSessionKey: next.lastActiveSessionKey?.trim() || next.sessionKey.trim() || "main",
    presentationSyncPending: next.presentationSyncPending === true,
  };
  host.settings = normalized;
  saveSettings(normalized);
  if (
    isSupportedLocale(normalized.locale) &&
    (normalized.locale !== previous.locale || i18n.getLocale() !== normalized.locale)
  ) {
    void i18n.setLocale(normalized.locale);
  }
  if (
    next.themeFamily !== host.themeFamily ||
    next.themeMode !== host.themeMode ||
    !themeAccentMapsEqual(next.themeAccents, previous.themeAccents)
  ) {
    host.themeFamily = next.themeFamily;
    host.themeMode = next.themeMode;
    host.themeAccents = next.themeAccents;
    applyResolvedTheme(host, resolveTheme(next.themeFamily, next.themeMode));
    syncSystemThemeListener(host);
  }
  applyBorderRadius();
  host.applySessionKey = host.settings.lastActiveSessionKey;
  if (typeof host.sessionsHideCron === "boolean") {
    host.sessionsHideCron = normalized.chatHideCronSessions;
  }
}

export function setLastActiveSessionKey(host: SettingsHost, next: string) {
  const trimmed = next.trim();
  if (!trimmed) {
    return;
  }
  if (host.settings.lastActiveSessionKey === trimmed) {
    return;
  }
  applySettings(host, { ...host.settings, lastActiveSessionKey: trimmed });
}

export function applySettingsFromUrl(host: SettingsHost) {
  if (!window.location.search && !window.location.hash) {
    return;
  }
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);

  const gatewayUrlRaw = params.get("gatewayUrl") ?? hashParams.get("gatewayUrl");
  const nextGatewayUrl = gatewayUrlRaw?.trim() ?? "";
  const gatewayUrlChanged = Boolean(nextGatewayUrl && nextGatewayUrl !== host.settings.gatewayUrl);
  // Prefer fragment tokens over query tokens. Fragments avoid server-side request
  // logs and referrer leakage; query-param tokens remain a one-time legacy fallback
  // for compatibility with older deep links.
  const tokenRaw = hashParams.get("token") ?? params.get("token");
  const passwordRaw = params.get("password") ?? hashParams.get("password");
  const sessionRaw = params.get("session") ?? hashParams.get("session");
  const shouldResetSessionForToken = Boolean(
    tokenRaw?.trim() && !sessionRaw?.trim() && !gatewayUrlChanged,
  );
  let shouldCleanUrl = false;

  if (params.has("token")) {
    params.delete("token");
    shouldCleanUrl = true;
  }

  if (tokenRaw != null) {
    const token = tokenRaw.trim();
    if (token && gatewayUrlChanged) {
      host.pendingGatewayToken = token;
    } else if (token && token !== host.settings.token) {
      applySettings(host, { ...host.settings, token });
    }
    hashParams.delete("token");
    shouldCleanUrl = true;
  }

  if (shouldResetSessionForToken) {
    host.sessionKey = "main";
    applySettings(host, {
      ...host.settings,
      sessionKey: "main",
      lastActiveSessionKey: "main",
    });
  }

  if (passwordRaw != null) {
    // Never hydrate password from URL params; strip only.
    params.delete("password");
    hashParams.delete("password");
    shouldCleanUrl = true;
  }

  if (sessionRaw != null) {
    const session = sessionRaw.trim();
    if (session) {
      host.sessionKey = session;
      applySettings(host, {
        ...host.settings,
        sessionKey: session,
        lastActiveSessionKey: session,
      });
    }
  }

  if (gatewayUrlRaw != null) {
    if (gatewayUrlChanged) {
      host.pendingGatewayUrl = nextGatewayUrl;
      if (!tokenRaw?.trim()) {
        host.pendingGatewayToken = null;
      }
    } else {
      host.pendingGatewayUrl = null;
      host.pendingGatewayToken = null;
    }
    params.delete("gatewayUrl");
    hashParams.delete("gatewayUrl");
    shouldCleanUrl = true;
  }

  if (!shouldCleanUrl) {
    return;
  }
  url.search = params.toString();
  const nextHash = hashParams.toString();
  url.hash = nextHash ? `#${nextHash}` : "";
  window.history.replaceState({}, "", url.toString());
}

export function setTab(host: SettingsHost, next: Tab) {
  applyTabSelection(host, publicTabFor(next), { refreshPolicy: "always", syncUrl: true });
}

export function setSettingsSection(host: SettingsHost, next: SettingsSection) {
  const normalized = normalizeSettingsSection(next);
  if (host.tab !== "settings") {
    host.settingsSection = normalized;
    applyTabSelection(host, "settings", { refreshPolicy: "always", syncUrl: true });
    return;
  }
  if (host.settingsSection === normalized) {
    return;
  }
  host.settingsSection = normalized;
  syncSettingsTabPolling(host, "settings");
  syncUrlWithTab(host, "settings", false);
  void refreshSettingsSectionState(host);
}

export function setThemeFamily(
  host: SettingsHost,
  next: ThemeFamily,
  context?: ThemeTransitionContext,
) {
  const resolved = resolveTheme(next, host.themeMode);
  const applyTheme = () => {
    applySettings(host, { ...host.settings, themeFamily: next });
  };
  startThemeTransition({
    nextTheme: resolved,
    applyTheme,
    context,
    currentTheme: host.themeResolved,
  });
  syncSystemThemeListener(host);
}

export function setThemeAccent(host: SettingsHost, family: ThemeFamily, accent: string) {
  applySettings(host, {
    ...host.settings,
    themeAccents: setThemeAccentMapValue(host.settings.themeAccents, family, accent),
  });
}

export function setThemeMode(
  host: SettingsHost,
  next: ThemeMode,
  context?: ThemeTransitionContext,
) {
  const resolved = resolveTheme(host.themeFamily, next);
  const applyMode = () => {
    applySettings(host, { ...host.settings, themeMode: next });
  };
  startThemeTransition({
    nextTheme: resolved,
    applyTheme: applyMode,
    context,
    currentTheme: host.themeResolved,
  });
  syncSystemThemeListener(host);
}

export async function refreshActiveTab(host: SettingsHost, opts?: RefreshActiveTabOptions) {
  const hasBootstrapShellState =
    opts?.preloadedShellState === "bootstrap" || opts?.preloadedShellState === "doctor";
  if (host.tab === "setup") {
    await Promise.allSettled([
      ...(opts?.preloadedShellState === "doctor"
        ? []
        : [loadAlisioDoctorSummary(host as unknown as AlisioApp)]),
      loadNativeShellState(host),
    ]);
    return;
  }
  if (host.tab === "authentications") {
    await loadAlisioConnectors(host as unknown as AlisioApp);
    // Warm the richer overview in the background, but do not block the Apps tab on it.
    void loadAlisioProviderOverview(host as unknown as AlisioApp);
    return;
  }
  if (host.tab === "channels") {
    await loadChannels(host as unknown as AlisioApp, false);
  }
  if (host.tab === "models") {
    // Legacy model fallbacks derive local targets from bootstrap/account state.
    // Load bootstrap first so older gateways do not briefly render an empty models view.
    if (!hasBootstrapShellState) {
      await loadAlisioBootstrap(host as unknown as AlisioApp);
    }
    await Promise.allSettled([
      loadAlisioModels(host as unknown as AlisioApp),
      loadSessions(host as unknown as AlisioApp, {
        activeMinutes: 0,
        limit: 0,
        includeGlobal: true,
        includeUnknown: true,
      }),
    ]);
  }
  if (host.tab === "memory") {
    await loadAgents(host as unknown as AlisioApp);
    const agentId = resolvePreferredMemoryAgentId({
      agentsList: host.agentsList ?? null,
      memorySelectedAgentId: host.memorySelectedAgentId ?? null,
      sessionKey: host.sessionKey,
      assistantAgentId: host.assistantAgentId ?? null,
    });
    if (agentId) {
      host.memorySelectedAgentId = agentId;
      await loadMemoryStatus(host as unknown as AlisioApp, agentId, { reset: true });
    }
  }
  if (host.tab === "tasks") {
    await loadTasksOverview(host as unknown as Parameters<typeof loadTasksOverview>[0]);
  }
  if (host.tab === "cron") {
    await loadCron(host);
  }
  if (host.tab === "chat") {
    await loadTasksOverview(host as unknown as Parameters<typeof loadTasksOverview>[0], {
      quiet: true,
    });
  }
  if (host.tab === "capabilities") {
    await Promise.allSettled([
      loadSkills(host as unknown as AlisioApp),
      loadChannels(host as unknown as AlisioApp, false),
      loadAlisioProviderOverview(host as unknown as AlisioApp),
    ]);
  }
  if (host.tab === "connections") {
    await Promise.allSettled([
      loadNodes(host as unknown as AlisioApp),
      loadDevices(host as unknown as AlisioApp),
      loadAlisioSharing(host as unknown as AlisioApp),
      loadNodePairings(host as unknown as AlisioApp),
    ]);
  }
  if (host.tab === "security") {
    await Promise.allSettled([
      loadNodes(host as unknown as AlisioApp),
      loadConfig(host as unknown as AlisioApp),
      loadSelectedExecApprovals(host as unknown as AlisioApp),
      loadGatewayAccessMode(host as unknown as AlisioApp),
    ]);
  }
  if (host.tab === "organization") {
    await Promise.allSettled([
      loadAlisioAccount(host as unknown as AlisioApp),
      loadAlisioOrganization(host as unknown as AlisioApp),
    ]);
  }
  if (host.tab === "chat") {
    if (!hasBootstrapShellState) {
      await loadAlisioBootstrap(host as unknown as AlisioApp);
    }
    if (bootstrapBlocksChatAccess(host.alisioBootstrap)) {
      host.setupStep = resolveBlockingSetupStep({
        connected: host.connected,
        bootstrap: host.alisioBootstrap,
      });
      host.setTab?.("setup");
      return;
    }
    await Promise.allSettled([
      refreshChat(host as unknown as Parameters<typeof refreshChat>[0], {
        includeHistory: opts?.includeChatHistory ?? true,
      }),
      loadAlisioAccount(host as unknown as AlisioApp),
      loadGatewayAccessMode(host as unknown as AlisioApp),
      loadNativeShellState(host),
    ]);
    scheduleChatScroll(
      host as unknown as Parameters<typeof scheduleChatScroll>[0],
      !host.chatHasAutoScrolled,
    );
  }
  if (host.tab === "settings") {
    await Promise.allSettled([
      loadAlisioAccount(host as unknown as AlisioApp),
      ...(opts?.preloadedShellState === "doctor"
        ? []
        : [loadAlisioDoctorSummary(host as unknown as AlisioApp)]),
    ]);
    await refreshSettingsSectionState(host);
  }
}

export function inferBasePath() {
  if (typeof window === "undefined") {
    return "";
  }
  const configured = window.__ALISIO_CONTROL_UI_BASE_PATH__;
  if (typeof configured === "string" && configured.trim()) {
    return normalizeBasePath(configured);
  }
  return inferBasePathFromPathname(window.location.pathname);
}

export function syncThemeWithSettings(host: SettingsHost) {
  host.themeFamily = host.settings.themeFamily;
  host.themeMode = host.settings.themeMode ?? "system";
  host.themeAccents = host.settings.themeAccents;
  applyResolvedTheme(host, resolveTheme(host.themeFamily, host.themeMode));
  applyBorderRadius();
  syncSystemThemeListener(host);
}

function resolveSignedInPreferences(host: SettingsHost) {
  const account = host.alisioAccount ?? host.alisioBootstrap?.account ?? null;
  if (!account || account.session.state !== "signed_in") {
    return null;
  }
  return account.preferences;
}

function resolveLocalPresentationSelection(host: SettingsHost) {
  return {
    locale: host.settings.locale,
    themeFamily: host.settings.themeFamily,
    themeMode: host.settings.themeMode,
    themeAccents: host.settings.themeAccents,
  };
}

function clearPendingPresentationSync(host: SettingsHost) {
  if (host.settings.presentationSyncPending !== true) {
    return;
  }
  applySettings(host, {
    ...host.settings,
    presentationSyncPending: false,
  });
}

export async function syncAccountPreferences(host: SettingsHost) {
  const preferences = resolveSignedInPreferences(host);
  if (!preferences) {
    return;
  }

  const nextLocale = isSupportedLocale(preferences.language)
    ? preferences.language
    : host.settings.locale;
  const nextThemeFamily = preferences.themeFamily;
  const nextThemeMode = preferences.themeMode;
  const nextThemeAccents = preferences.themeAccents;
  const localPresentation = resolveLocalPresentationSelection(host);
  const remotePresentation = {
    locale: nextLocale,
    themeFamily: nextThemeFamily,
    themeMode: nextThemeMode,
    themeAccents: nextThemeAccents,
  };

  if (host.settings.presentationSyncPending === true) {
    if (presentationSelectionsEqual(localPresentation, remotePresentation)) {
      clearPendingPresentationSync(host);
    }
    return;
  }

  if (
    nextLocale === host.settings.locale &&
    nextThemeFamily === host.settings.themeFamily &&
    nextThemeMode === host.settings.themeMode &&
    themeAccentMapsEqual(nextThemeAccents, host.settings.themeAccents)
  ) {
    return;
  }

  applySettings(host, {
    ...host.settings,
    locale: nextLocale,
    themeFamily: nextThemeFamily,
    themeMode: nextThemeMode,
    themeAccents: nextThemeAccents,
  });
}

export async function flushPendingPresentationPreferences(host: SettingsHost) {
  const preferences = resolveSignedInPreferences(host);
  if (!preferences || host.settings.presentationSyncPending !== true) {
    return;
  }
  if (
    presentationSelectionsEqual(resolveLocalPresentationSelection(host), {
      locale: preferences.language,
      themeFamily: preferences.themeFamily,
      themeMode: preferences.themeMode,
      themeAccents: preferences.themeAccents,
    })
  ) {
    clearPendingPresentationSync(host);
    return;
  }
  await host.flushPresentationPreferences?.();
}

export function attachThemeListener(host: SettingsHost) {
  syncSystemThemeListener(host);
}

export function detachThemeListener(host: SettingsHost) {
  host.systemThemeCleanup?.();
  host.systemThemeCleanup = null;
}

const FIXED_ROUND_RADII = { sm: 9, md: 15, lg: 21, xl: 30, full: 9999, default: 15 };

export function applyBorderRadius(_value?: number) {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.style.setProperty("--radius-sm", `${FIXED_ROUND_RADII.sm}px`);
  root.style.setProperty("--radius-md", `${FIXED_ROUND_RADII.md}px`);
  root.style.setProperty("--radius-lg", `${FIXED_ROUND_RADII.lg}px`);
  root.style.setProperty("--radius-xl", `${FIXED_ROUND_RADII.xl}px`);
  root.style.setProperty("--radius-full", `${FIXED_ROUND_RADII.full}px`);
  root.style.setProperty("--radius", `${FIXED_ROUND_RADII.default}px`);
}

export function applyResolvedTheme(host: SettingsHost, resolved: ResolvedTheme) {
  host.themeResolved = resolved;
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const themeMode = resolveThemeModeFromResolved(resolved);
  const themeFamily = resolveThemeFamilyFromResolved(resolved);
  root.dataset.theme = resolved;
  root.dataset.themeFamily = themeFamily;
  root.dataset.themeMode = themeMode;
  root.style.colorScheme = themeMode;
  const accentVariables = buildResolvedThemeAccentVariables({
    resolvedTheme: resolved,
    themeAccents: host.settings.themeAccents,
  });
  for (const [key, value] of Object.entries(accentVariables)) {
    root.style.setProperty(key, value);
  }
}

function syncSystemThemeListener(host: SettingsHost) {
  // Clean up existing listener if mode is not "system"
  if (host.themeMode !== "system") {
    host.systemThemeCleanup?.();
    host.systemThemeCleanup = null;
    return;
  }

  // Skip if listener already attached for this host
  if (host.systemThemeCleanup) {
    return;
  }

  if (typeof globalThis.matchMedia !== "function") {
    return;
  }

  const mql = globalThis.matchMedia("(prefers-color-scheme: light)");
  const onChange = (event: Pick<MediaQueryList, "matches">) => {
    if (host.themeMode !== "system") {
      return;
    }
    applyResolvedTheme(host, resolveTheme(host.themeFamily, event.matches ? "light" : "dark"));
  };
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    host.systemThemeCleanup = () => mql.removeEventListener("change", onChange);
    return;
  }
  if (typeof mql.addListener === "function") {
    mql.addListener(onChange);
    host.systemThemeCleanup = () => mql.removeListener(onChange);
  }
}

export function syncTabWithLocation(host: SettingsHost, replace: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  const resolved = publicTabFor(tabFromPath(window.location.pathname, host.basePath) ?? "chat");
  if (resolved === "settings") {
    resolveSettingsSectionFromLocation(host, window.location.pathname, window.location.search);
  }
  if (resolved === "setup") {
    resolveSetupStepFromLocation(host, window.location.search);
  }
  setTabFromRoute(host, resolved);
  syncUrlWithTab(host, resolved, replace);
}

export function onPopState(host: SettingsHost) {
  if (typeof window === "undefined") {
    return;
  }
  const resolvedRaw = tabFromPath(window.location.pathname, host.basePath);
  const resolved = resolvedRaw ? publicTabFor(resolvedRaw) : null;
  if (!resolved) {
    return;
  }

  const url = new URL(window.location.href);
  const session = url.searchParams.get("session")?.trim();
  if (session) {
    host.sessionKey = session;
    applySettings(host, {
      ...host.settings,
      sessionKey: session,
      lastActiveSessionKey: session,
    });
  }
  if (resolved === "settings") {
    resolveSettingsSectionFromLocation(host, window.location.pathname, window.location.search);
  }
  if (resolved === "setup") {
    resolveSetupStepFromLocation(host, window.location.search);
  }

  setTabFromRoute(host, resolved);
}

export function setTabFromRoute(host: SettingsHost, next: Tab) {
  applyTabSelection(host, publicTabFor(next), { refreshPolicy: "connected" });
}

async function refreshSettingsSectionState(host: SettingsHost) {
  if (host.settingsSection === "debug") {
    await loadDebug(host as unknown as AlisioApp);
    host.eventLog = host.eventLogBuffer;
    return;
  }
  if (host.settingsSection === "logs") {
    host.logsAtBottom = true;
    await loadLogs(host as unknown as AlisioApp, { reset: true });
    scheduleLogsScroll(host as unknown as Parameters<typeof scheduleLogsScroll>[0], true);
    return;
  }
  if (host.settingsSection === "mac") {
    await loadNativeShellState(host);
  }
}

function syncSettingsTabPolling(host: SettingsHost, tab: Tab) {
  if (tab === "settings" && host.settingsSection === "logs") {
    startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
  } else {
    stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  }
  if (tab === "settings" && host.settingsSection === "debug") {
    startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
  } else {
    stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  }
}

function applyTabSelection(
  host: SettingsHost,
  next: Tab,
  options: { refreshPolicy: "always" | "connected"; syncUrl?: boolean },
) {
  next = publicTabFor(next);
  const prev = host.tab;
  if (host.tab !== next) {
    host.tab = next;
  }

  // Cleanup chat module state when navigating away from chat
  if (prev === "chat" && next !== "chat") {
    resetChatViewState();
  }
  if (next !== "setup") {
    host.setupStep = null;
  }

  if (next === "chat") {
    host.chatHasAutoScrolled = false;
  }
  syncSettingsTabPolling(host, next);

  if (options.refreshPolicy === "always" || host.connected) {
    void refreshActiveTab(host);
  }

  if (options.syncUrl) {
    syncUrlWithTab(host, next, false);
  }
}

export function syncUrlWithTab(host: SettingsHost, tab: Tab, replace: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  const targetPath = normalizePath(pathForTab(tab, host.basePath));
  const currentPath = normalizePath(window.location.pathname);
  const url = new URL(window.location.href);

  if (tab === "chat" && host.sessionKey) {
    url.searchParams.set("session", host.sessionKey);
  } else {
    url.searchParams.delete("session");
  }
  if (tab === "settings") {
    if (host.settingsSection === "general") {
      url.searchParams.delete("section");
    } else {
      url.searchParams.set("section", host.settingsSection);
    }
  } else {
    url.searchParams.delete("section");
  }
  if (tab === "setup") {
    const step = resolveSetupStep(host);
    if (step) {
      url.searchParams.set("step", step);
    } else {
      url.searchParams.delete("step");
    }
  } else {
    url.searchParams.delete("step");
  }

  if (currentPath !== targetPath) {
    url.pathname = targetPath;
  }

  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

function resolveSettingsSectionFromLocation(host: SettingsHost, pathname: string, search: string) {
  const url = new URL(`http://localhost${pathname}${search || ""}`);
  const querySection = url.searchParams.get("section");
  if (querySection) {
    host.settingsSection = normalizeSettingsSection(querySection);
  }
}

function resolveSetupStepFromLocation(host: SettingsHost, search: string) {
  const url = new URL(`http://localhost/${search.startsWith("?") ? search : `?${search}`}`);
  host.setupStep = normalizeSetupStep(url.searchParams.get("step"));
}

export function syncUrlWithSessionKey(host: SettingsHost, sessionKey: string, replace: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("session", sessionKey);
  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

export async function loadOverview(host: SettingsHost) {
  const app = host as unknown as AlisioApp;
  await Promise.allSettled([
    loadChannels(app, false),
    loadPresence(app),
    loadSessions(app),
    loadCronStatus(app),
    loadCronJobs(app),
    loadDebug(app),
    loadSkills(app),
    loadUsage(app),
  ]);
  buildAttentionItems(app);
}

export function hasOperatorReadAccess(
  auth: { role?: string; scopes?: readonly string[] } | null,
): boolean {
  if (!auth?.scopes) {
    return false;
  }
  return roleScopesAllow({
    role: auth.role ?? "operator",
    requestedScopes: ["operator.read"],
    allowedScopes: auth.scopes,
  });
}

export function hasMissingSkillDependencies(
  missing: Record<string, unknown> | null | undefined,
): boolean {
  if (!missing) {
    return false;
  }
  return Object.values(missing).some((value) => Array.isArray(value) && value.length > 0);
}

function buildAttentionItems(host: AlisioApp) {
  const items: AttentionItem[] = [];

  if (host.lastError) {
    items.push({
      severity: "error",
      icon: "x",
      title: "Alisio Error",
      description: host.lastError,
    });
  }

  const hello = host.hello;
  const auth = (hello as { auth?: { role?: string; scopes?: string[] } } | null)?.auth ?? null;
  if (auth?.scopes && !hasOperatorReadAccess(auth)) {
    items.push({
      severity: "warning",
      icon: "key",
      title: "Missing operator.read scope",
      description:
        "This connection does not have the operator.read scope. Some features may be unavailable.",
      href: docsUrl("/web/dashboard"),
      external: true,
    });
  }

  const skills = host.skillsReport?.skills ?? [];
  const missingDeps = skills.filter((s) => !s.disabled && hasMissingSkillDependencies(s.missing));
  if (missingDeps.length > 0) {
    const names = missingDeps.slice(0, 3).map((s) => s.name);
    const more = missingDeps.length > 3 ? ` +${missingDeps.length - 3} more` : "";
    items.push({
      severity: "warning",
      icon: "zap",
      title: "Skills with missing dependencies",
      description: `${names.join(", ")}${more}`,
    });
  }

  const blocked = skills.filter((s) => s.blockedByAllowlist);
  if (blocked.length > 0) {
    items.push({
      severity: "warning",
      icon: "shield",
      title: `${blocked.length} skill${blocked.length > 1 ? "s" : ""} blocked`,
      description: blocked.map((s) => s.name).join(", "),
    });
  }

  const cronJobs = host.cronJobs ?? [];
  const failedCron = cronJobs.filter((j) => j.state?.lastStatus === "error");
  if (failedCron.length > 0) {
    items.push({
      severity: "error",
      icon: "clock",
      title: `${failedCron.length} cron job${failedCron.length > 1 ? "s" : ""} failed`,
      description: failedCron.map((j) => j.name).join(", "),
    });
  }

  const now = Date.now();
  const overdue = cronJobs.filter(
    (j) => j.enabled && j.state?.nextRunAtMs != null && now - j.state.nextRunAtMs > 300_000,
  );
  if (overdue.length > 0) {
    items.push({
      severity: "warning",
      icon: "clock",
      title: `${overdue.length} overdue job${overdue.length > 1 ? "s" : ""}`,
      description: overdue.map((j) => j.name).join(", "),
    });
  }

  host.attentionItems = items;
}

export async function loadCron(host: SettingsHost) {
  const app = host as unknown as AlisioApp;
  const activeCronJobId = app.cronRunsScope === "job" ? app.cronRunsJobId : null;
  app.cronJobsQuery = "";
  app.cronJobsEnabledFilter = "all";
  app.cronJobsScheduleKindFilter = "all";
  app.cronJobsLastStatusFilter = "all";
  app.cronJobsSortBy = "nextRunAtMs";
  app.cronJobsSortDir = "asc";
  await Promise.all([
    loadChannels(app, false),
    loadCronStatus(app),
    (async () => {
      await loadCronJobsPage(app, { append: false });
      while (app.cronJobsHasMore && !app.cronError) {
        await loadCronJobsPage(app, { append: true });
      }
    })(),
    loadCronRuns(app, activeCronJobId),
  ]);
}
