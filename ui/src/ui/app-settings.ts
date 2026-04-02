import { roleScopesAllow } from "../../../src/shared/operator-scope-compat.js";
import { refreshChat } from "./app-chat.ts";
import {
  startLogsPolling,
  stopLogsPolling,
  startDebugPolling,
  stopDebugPolling,
} from "./app-polling.ts";
import { scheduleChatScroll, scheduleLogsScroll } from "./app-scroll.ts";
import type { OpenClawApp } from "./app.ts";
import { normalizeBasePath } from "./base-path.ts";
import {
  loadAlisioBootstrap,
  loadAlisioAccount,
  loadAlisioConnectors,
  loadAlisioDoctorSummary,
  loadAlisioOrganization,
} from "./controllers/alisio.ts";
import { loadChannels } from "./controllers/channels.ts";
import { loadCronJobs, loadCronRuns, loadCronStatus } from "./controllers/cron.ts";
import { loadDebug } from "./controllers/debug.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadPresence } from "./controllers/presence.ts";
import { loadSessions } from "./controllers/sessions.ts";
import { loadSkills } from "./controllers/skills.ts";
import { loadUsage } from "./controllers/usage.ts";
import { loadNativeShellState } from "./lume-host.ts";
import {
  inferBasePathFromPathname,
  normalizePath,
  normalizeSettingsSection,
  pathForTab,
  publicTabFor,
  settingsSectionFromPath,
  tabFromPath,
  type SettingsSection,
  type Tab,
} from "./navigation.ts";
import { saveSettings, type UiSettings } from "./storage.ts";
import { startThemeTransition, type ThemeTransitionContext } from "./theme-transition.ts";
import { resolveTheme, type ResolvedTheme, type ThemeMode, type ThemeName } from "./theme.ts";
import type { AgentsListResult, AttentionItem } from "./types.ts";
import { resetChatViewState } from "./views/chat.ts";

type SettingsHost = {
  settings: UiSettings;
  password?: string;
  theme: ThemeName;
  themeMode: ThemeMode;
  themeResolved: ResolvedTheme;
  applySessionKey: string;
  sessionKey: string;
  tab: Tab;
  setTab?: (tab: Tab) => void;
  settingsSection: SettingsSection;
  connected: boolean;
  alisioBootstrap?: import("./types.ts").AlisioBootstrapState | null;
  setupStep?: import("./types.ts").AlisioBootstrapStep | null;
  chatHasAutoScrolled: boolean;
  logsAtBottom: boolean;
  eventLog: unknown[];
  eventLogBuffer: unknown[];
  basePath: string;
  agentsList?: AgentsListResult | null;
  agentsSelectedId?: string | null;
  agentsPanel?: "overview" | "files" | "tools" | "skills" | "channels" | "cron";
  pendingGatewayUrl?: string | null;
  systemThemeCleanup?: (() => void) | null;
  pendingGatewayToken?: string | null;
  nativeShellLoading?: boolean;
  nativeShellError?: string | null;
  nativeShellState?: import("./types.ts").NativeShellState | null;
};

function bootstrapBlocksChatAccess(
  bootstrap: import("./types.ts").AlisioBootstrapState | null | undefined,
) {
  if (!bootstrap) {
    return false;
  }
  return bootstrap.connectionRequired || bootstrap.startupState !== "ready";
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
  const requestedStep = normalizeSetupStep(host.setupStep);
  if (requestedStep) {
    return requestedStep;
  }
  if (!host.connected) {
    return "gateway";
  }
  if (host.alisioBootstrap?.startupState === "signed_out") {
    return "account";
  }
  if (host.alisioBootstrap?.startupState === "needs_profile") {
    return "account";
  }
  if (host.alisioBootstrap?.startupState === "needs_ai") {
    return "runtime";
  }
  const bootstrapStep = normalizeSetupStep(host.alisioBootstrap?.nextStep);
  if (bootstrapStep && bootstrapStep !== "ready") {
    return bootstrapStep;
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
  };
  host.settings = normalized;
  saveSettings(normalized);
  if (next.theme !== host.theme || next.themeMode !== host.themeMode) {
    host.theme = next.theme;
    host.themeMode = next.themeMode;
    applyResolvedTheme(host, resolveTheme(next.theme, next.themeMode));
  }
  applyBorderRadius(next.borderRadius);
  host.applySessionKey = host.settings.lastActiveSessionKey;
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

export function setTheme(host: SettingsHost, next: ThemeName, context?: ThemeTransitionContext) {
  const resolved = resolveTheme(next, host.themeMode);
  const applyTheme = () => {
    applySettings(host, { ...host.settings, theme: next });
  };
  startThemeTransition({
    nextTheme: resolved,
    applyTheme,
    context,
    currentTheme: host.themeResolved,
  });
  syncSystemThemeListener(host);
}

export function setThemeMode(
  host: SettingsHost,
  next: ThemeMode,
  context?: ThemeTransitionContext,
) {
  const resolved = resolveTheme(host.theme, next);
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

export async function refreshActiveTab(host: SettingsHost) {
  if (host.tab === "setup") {
    await Promise.allSettled([
      loadAlisioBootstrap(host as unknown as OpenClawApp),
      loadAlisioDoctorSummary(host as unknown as OpenClawApp),
      loadNativeShellState(host),
    ]);
    return;
  }
  if (host.tab === "authentications") {
    await Promise.allSettled([
      loadAlisioAccount(host as unknown as OpenClawApp),
      loadAlisioConnectors(host as unknown as OpenClawApp),
    ]);
  }
  if (host.tab === "organization") {
    await Promise.allSettled([
      loadAlisioAccount(host as unknown as OpenClawApp),
      loadAlisioOrganization(host as unknown as OpenClawApp),
    ]);
  }
  if (host.tab === "chat") {
    await loadAlisioBootstrap(host as unknown as OpenClawApp);
    if (bootstrapBlocksChatAccess(host.alisioBootstrap)) {
      host.setupStep = !host.connected ? "gateway" : (host.alisioBootstrap?.nextStep ?? "runtime");
      host.setTab?.("setup");
      return;
    }
    await Promise.allSettled([
      refreshChat(host as unknown as Parameters<typeof refreshChat>[0]),
      loadAlisioAccount(host as unknown as OpenClawApp),
    ]);
    scheduleChatScroll(
      host as unknown as Parameters<typeof scheduleChatScroll>[0],
      !host.chatHasAutoScrolled,
    );
  }
  if (host.tab === "settings") {
    await Promise.allSettled([
      loadAlisioAccount(host as unknown as OpenClawApp),
      loadAlisioDoctorSummary(host as unknown as OpenClawApp),
    ]);
    if (host.settingsSection === "debug") {
      await loadDebug(host as unknown as OpenClawApp);
      host.eventLog = host.eventLogBuffer;
    }
    if (host.settingsSection === "logs") {
      host.logsAtBottom = true;
      await loadLogs(host as unknown as OpenClawApp, { reset: true });
      scheduleLogsScroll(host as unknown as Parameters<typeof scheduleLogsScroll>[0], true);
    }
    if (host.settingsSection === "mac") {
      await loadNativeShellState(host);
    }
  }
}

export function inferBasePath() {
  if (typeof window === "undefined") {
    return "";
  }
  const configured = window.__OPENCLAW_CONTROL_UI_BASE_PATH__;
  if (typeof configured === "string" && configured.trim()) {
    return normalizeBasePath(configured);
  }
  return inferBasePathFromPathname(window.location.pathname);
}

export function syncThemeWithSettings(host: SettingsHost) {
  host.theme = host.settings.theme ?? "claw";
  host.themeMode = host.settings.themeMode ?? "system";
  applyResolvedTheme(host, resolveTheme(host.theme, host.themeMode));
  applyBorderRadius(host.settings.borderRadius ?? 50);
  syncSystemThemeListener(host);
}

export function attachThemeListener(host: SettingsHost) {
  syncSystemThemeListener(host);
}

export function detachThemeListener(host: SettingsHost) {
  host.systemThemeCleanup?.();
  host.systemThemeCleanup = null;
}

const BASE_RADII = { sm: 6, md: 10, lg: 14, xl: 20, full: 9999, default: 10 };

export function applyBorderRadius(value: number) {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const scale = value / 50;
  root.style.setProperty("--radius-sm", `${Math.round(BASE_RADII.sm * scale)}px`);
  root.style.setProperty("--radius-md", `${Math.round(BASE_RADII.md * scale)}px`);
  root.style.setProperty("--radius-lg", `${Math.round(BASE_RADII.lg * scale)}px`);
  root.style.setProperty("--radius-xl", `${Math.round(BASE_RADII.xl * scale)}px`);
  root.style.setProperty("--radius-full", `${Math.round(BASE_RADII.full * scale)}px`);
  root.style.setProperty("--radius", `${Math.round(BASE_RADII.default * scale)}px`);
}

export function applyResolvedTheme(host: SettingsHost, resolved: ResolvedTheme) {
  host.themeResolved = resolved;
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const themeMode = resolved.endsWith("light") ? "light" : "dark";
  root.dataset.theme = resolved;
  root.dataset.themeMode = themeMode;
  root.style.colorScheme = themeMode;
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
  const onChange = () => {
    if (host.themeMode !== "system") {
      return;
    }
    applyResolvedTheme(host, resolveTheme(host.theme, "system"));
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
  if (next === "settings" && host.settingsSection === "logs") {
    startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
  } else {
    stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  }
  if (next === "settings" && host.settingsSection === "debug") {
    startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
  } else {
    stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  }

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
    if (host.settingsSection === "account") {
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
    return;
  }
  const legacySection = settingsSectionFromPath(pathname, host.basePath);
  if (legacySection) {
    host.settingsSection = legacySection;
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
  const app = host as unknown as OpenClawApp;
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

function buildAttentionItems(host: OpenClawApp) {
  const items: AttentionItem[] = [];

  if (host.lastError) {
    items.push({
      severity: "error",
      icon: "x",
      title: "Gateway Error",
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
      href: "https://docs.openclaw.ai/web/dashboard",
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
  const app = host as unknown as OpenClawApp;
  const activeCronJobId = app.cronRunsScope === "job" ? app.cronRunsJobId : null;
  await Promise.all([
    loadChannels(app, false),
    loadCronStatus(app),
    loadCronJobs(app),
    loadCronRuns(app, activeCronJobId),
  ]);
}
