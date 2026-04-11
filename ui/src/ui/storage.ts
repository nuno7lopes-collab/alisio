const SETTINGS_KEY_PREFIX = "alisio.control.settings.v2:";
const DEFAULT_SETTINGS_KEY = "alisio.control.settings.v2";
const TOKEN_SESSION_KEY_PREFIX = "alisio.control.token.v2:";
const MAX_SCOPED_SESSION_ENTRIES = 10;

function settingsKeyForGateway(gatewayUrl: string): string {
  return `${SETTINGS_KEY_PREFIX}${normalizeGatewayTokenScope(gatewayUrl)}`;
}

type ScopedSessionSelection = {
  sessionKey: string;
  lastActiveSessionKey: string;
};

type PersistedUiSettings = Omit<UiSettings, "token" | "sessionKey" | "lastActiveSessionKey"> & {
  token?: never;
  sessionKey?: string;
  lastActiveSessionKey?: string;
  sessionsByGateway?: Record<string, ScopedSessionSelection>;
  chatPresentationModeVersion?: number;
};

import { DEFAULT_GATEWAY_PORT_TEXT } from "../../../src/shared/gateway-defaults.js";
import { isSupportedLocale, loadPersistedLocale } from "../i18n/index.ts";
import { getSafeLocalStorage, getSafeSessionStorage } from "../local-storage.ts";
import { normalizeBasePath } from "./base-path.ts";
import { inferBasePathFromPathname } from "./navigation.ts";
import { parseThemeSelection, type ThemeMode, type ThemeName } from "./theme.ts";

export type UiSettings = {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  lastActiveSessionKey: string;
  theme: ThemeName;
  themeMode: ThemeMode;
  chatFocusMode: boolean;
  chatShowThinking: boolean;
  chatShowToolCalls: boolean;
  splitRatio: number; // Sidebar split ratio (0.4 to 0.7, default 0.6)
  navCollapsed: boolean; // Collapsible sidebar state
  navWidth: number; // Sidebar width when expanded (240–400px)
  navGroupsCollapsed: Record<string, boolean>; // Which nav groups are collapsed
  locale?: string;
};

function isViteDevPage(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return Boolean(document.querySelector('script[src*="/@vite/client"]'));
}

function formatHostWithPort(hostname: string, port: string): string {
  const normalizedHost = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `${normalizedHost}:${port}`;
}

function resolveViteDevGatewayPort(): string {
  const raw =
    typeof window !== "undefined"
      ? window.__ALISIO_CONTROL_UI_DEV_GATEWAY_PORT__?.trim()
      : undefined;
  return raw && /^\d+$/.test(raw) ? raw : DEFAULT_GATEWAY_PORT_TEXT;
}

function deriveDefaultGatewayUrl(): { pageUrl: string; effectiveUrl: string } {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const configured =
    typeof window !== "undefined" &&
    typeof window.__ALISIO_CONTROL_UI_BASE_PATH__ === "string" &&
    window.__ALISIO_CONTROL_UI_BASE_PATH__.trim();
  const basePath = configured
    ? normalizeBasePath(configured)
    : inferBasePathFromPathname(location.pathname);
  const pageUrl = `${proto}://${location.host}${basePath}`;
  if (!isViteDevPage()) {
    return { pageUrl, effectiveUrl: pageUrl };
  }
  const effectiveUrl = `${proto}://${formatHostWithPort(location.hostname, resolveViteDevGatewayPort())}`;
  return { pageUrl, effectiveUrl };
}

function getSessionStorage(): Storage | null {
  return getSafeSessionStorage();
}

function normalizeGatewayTokenScope(gatewayUrl: string): string {
  const trimmed = gatewayUrl.trim();
  if (!trimmed) {
    return "default";
  }
  try {
    const base =
      typeof location !== "undefined"
        ? `${location.protocol}//${location.host}${location.pathname || "/"}`
        : undefined;
    const parsed = base ? new URL(trimmed, base) : new URL(trimmed);
    const pathname =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "") || parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return trimmed;
  }
}

function tokenSessionKeyForGateway(gatewayUrl: string): string {
  return `${TOKEN_SESSION_KEY_PREFIX}${normalizeGatewayTokenScope(gatewayUrl)}`;
}

function resolveScopedSessionSelection(
  gatewayUrl: string,
  parsed: PersistedUiSettings,
  defaults: UiSettings,
): ScopedSessionSelection {
  const scope = normalizeGatewayTokenScope(gatewayUrl);
  const scoped = parsed.sessionsByGateway?.[scope];
  if (
    scoped &&
    typeof scoped.sessionKey === "string" &&
    scoped.sessionKey.trim() &&
    typeof scoped.lastActiveSessionKey === "string" &&
    scoped.lastActiveSessionKey.trim()
  ) {
    return {
      sessionKey: scoped.sessionKey.trim(),
      lastActiveSessionKey: scoped.lastActiveSessionKey.trim(),
    };
  }

  return {
    sessionKey: defaults.sessionKey,
    lastActiveSessionKey: defaults.lastActiveSessionKey,
  };
}

function loadSessionToken(gatewayUrl: string): string {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return "";
    }
    const scopedKey = tokenSessionKeyForGateway(gatewayUrl);
    const token = storage.getItem(scopedKey) ?? "";
    return token.trim();
  } catch {
    return "";
  }
}

function persistSessionToken(gatewayUrl: string, token: string) {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }
    const key = tokenSessionKeyForGateway(gatewayUrl);
    const normalized = token.trim();
    if (normalized) {
      storage.setItem(key, normalized);
      return;
    }
    storage.removeItem(key);
  } catch {
    // best-effort
  }
}

export function loadSettings(): UiSettings {
  const { pageUrl: pageDerivedUrl, effectiveUrl: defaultUrl } = deriveDefaultGatewayUrl();
  const storage = getSafeLocalStorage();

  const defaults: UiSettings = {
    gatewayUrl: defaultUrl,
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    theme: "claw",
    themeMode: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    chatShowToolCalls: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navWidth: 220,
    navGroupsCollapsed: {},
  };

  try {
    const scopedKey = settingsKeyForGateway(defaults.gatewayUrl);
    const raw = storage?.getItem(scopedKey) ?? storage?.getItem(DEFAULT_SETTINGS_KEY);
    if (!raw) {
      return {
        ...defaults,
        token: loadSessionToken(defaultUrl),
      };
    }
    const parsed = JSON.parse(raw) as PersistedUiSettings;
    const parsedGatewayUrl =
      typeof parsed.gatewayUrl === "string" && parsed.gatewayUrl.trim()
        ? parsed.gatewayUrl.trim()
        : defaults.gatewayUrl;
    const gatewayUrl = parsedGatewayUrl === pageDerivedUrl ? defaultUrl : parsedGatewayUrl;
    const scopedSessionSelection = resolveScopedSessionSelection(gatewayUrl, parsed, defaults);
    const { theme, mode } = parseThemeSelection(
      (parsed as { theme?: unknown }).theme,
      (parsed as { themeMode?: unknown }).themeMode,
    );
    const locale = isSupportedLocale(parsed.locale)
      ? parsed.locale
      : (loadPersistedLocale() ?? undefined);
    const chatPresentationModeVersion =
      typeof parsed.chatPresentationModeVersion === "number"
        ? parsed.chatPresentationModeVersion
        : 0;
    const shouldMigrateChatPresentation = chatPresentationModeVersion < 2;
    const shouldMigrateLocale = !isSupportedLocale(parsed.locale) && locale !== undefined;
    const settings = {
      gatewayUrl,
      // Gateway auth is intentionally in-memory only; scrub any legacy persisted token on load.
      token: loadSessionToken(gatewayUrl),
      sessionKey: scopedSessionSelection.sessionKey,
      lastActiveSessionKey: scopedSessionSelection.lastActiveSessionKey,
      theme,
      themeMode: mode,
      chatFocusMode:
        typeof parsed.chatFocusMode === "boolean" ? parsed.chatFocusMode : defaults.chatFocusMode,
      chatShowThinking:
        typeof parsed.chatShowThinking === "boolean"
          ? parsed.chatShowThinking
          : defaults.chatShowThinking,
      chatShowToolCalls: shouldMigrateChatPresentation
        ? true
        : typeof parsed.chatShowToolCalls === "boolean"
          ? parsed.chatShowToolCalls
          : defaults.chatShowToolCalls,
      splitRatio:
        typeof parsed.splitRatio === "number" &&
        parsed.splitRatio >= 0.4 &&
        parsed.splitRatio <= 0.7
          ? parsed.splitRatio
          : defaults.splitRatio,
      navCollapsed:
        typeof parsed.navCollapsed === "boolean" ? parsed.navCollapsed : defaults.navCollapsed,
      navWidth:
        typeof parsed.navWidth === "number" && parsed.navWidth >= 200 && parsed.navWidth <= 400
          ? parsed.navWidth
          : defaults.navWidth,
      navGroupsCollapsed:
        typeof parsed.navGroupsCollapsed === "object" && parsed.navGroupsCollapsed !== null
          ? parsed.navGroupsCollapsed
          : defaults.navGroupsCollapsed,
      locale,
    };
    if ("token" in parsed || shouldMigrateChatPresentation || shouldMigrateLocale) {
      persistSettings(settings);
    }
    return settings;
  } catch {
    return defaults;
  }
}

export function saveSettings(next: UiSettings) {
  persistSettings(next);
}

function persistSettings(next: UiSettings) {
  persistSessionToken(next.gatewayUrl, next.token);
  const storage = getSafeLocalStorage();
  const scope = normalizeGatewayTokenScope(next.gatewayUrl);
  const scopedKey = settingsKeyForGateway(next.gatewayUrl);
  let existingSessionsByGateway: Record<string, ScopedSessionSelection> = {};
  try {
    const raw = storage?.getItem(scopedKey) ?? storage?.getItem(DEFAULT_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedUiSettings;
      if (parsed.sessionsByGateway && typeof parsed.sessionsByGateway === "object") {
        existingSessionsByGateway = parsed.sessionsByGateway;
      }
    }
  } catch {
    // best-effort
  }
  const sessionsByGateway = Object.fromEntries(
    [
      ...Object.entries(existingSessionsByGateway).filter(([key]) => key !== scope),
      [
        scope,
        {
          sessionKey: next.sessionKey,
          lastActiveSessionKey: next.lastActiveSessionKey,
        },
      ],
    ].slice(-MAX_SCOPED_SESSION_ENTRIES),
  );
  const persisted: PersistedUiSettings = {
    gatewayUrl: next.gatewayUrl,
    theme: next.theme,
    themeMode: next.themeMode,
    chatFocusMode: next.chatFocusMode,
    chatShowThinking: next.chatShowThinking,
    chatShowToolCalls: next.chatShowToolCalls,
    chatPresentationModeVersion: 2,
    splitRatio: next.splitRatio,
    navCollapsed: next.navCollapsed,
    navWidth: next.navWidth,
    navGroupsCollapsed: next.navGroupsCollapsed,
    sessionsByGateway,
    ...(next.locale ? { locale: next.locale } : {}),
  };
  const serialized = JSON.stringify(persisted);
  try {
    storage?.setItem(scopedKey, serialized);
    storage?.setItem(DEFAULT_SETTINGS_KEY, serialized);
  } catch {
    // best-effort — quota exceeded or security restrictions should not
    // prevent in-memory settings and visual updates from being applied
  }
}
