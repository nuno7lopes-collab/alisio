/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.ts";
import { createStorageMock } from "../test-helpers/storage.ts";
import { resolveEffectiveAlisioAiState } from "./app-render.helpers.ts";
import {
  applyBorderRadius,
  applyResolvedTheme,
  applySettings,
  applySettingsFromUrl,
  attachThemeListener,
  setSettingsSection,
  setTabFromRoute,
  syncAccountPreferences,
  syncTabWithLocation,
  syncUrlWithTab,
  syncThemeWithSettings,
} from "./app-settings.ts";
import { DEFAULT_THEME_SELECTION, type ThemeFamily, type ThemeMode } from "./theme.ts";

type Tab = "setup" | "authentications" | "organization" | "chat" | "memory" | "models" | "settings";

type SettingsHost = {
  settings: {
    gatewayUrl: string;
    token: string;
    sessionKey: string;
    lastActiveSessionKey: string;
    themeFamily: ThemeFamily;
    themeMode: ThemeMode;
    themeAccents: import("./theme.ts").ThemeAccents;
    chatFocusMode: boolean;
    chatShowThinking: boolean;
    chatShowToolCalls: boolean;
    splitRatio: number;
    navCollapsed: boolean;
    navWidth: number;
    navGroupsCollapsed: Record<string, boolean>;
    locale?: string;
    presentationSyncPending?: boolean;
  };
  themeFamily: ThemeFamily;
  themeMode: ThemeMode;
  themeAccents: import("./theme.ts").ThemeAccents;
  themeResolved: import("./theme.ts").ResolvedTheme;
  applySessionKey: string;
  sessionKey: string;
  tab: Tab;
  settingsSection: import("./navigation.ts").SettingsSection;
  connected: boolean;
  alisioAccount?: import("./types.ts").AlisioAccountState | null;
  alisioBootstrap?: import("./types.ts").AlisioBootstrapState | null;
  setupStep?: import("./types.ts").AlisioBootstrapStep | null;
  chatHasAutoScrolled: boolean;
  logsAtBottom: boolean;
  eventLog: unknown[];
  eventLogBuffer: unknown[];
  basePath: string;
  themeMedia: MediaQueryList | null;
  themeMediaHandler: ((event: MediaQueryListEvent) => void) | null;
  systemThemeCleanup?: (() => void) | null;
  logsPollInterval: number | null;
  debugPollInterval: number | null;
  pendingGatewayUrl?: string | null;
  pendingGatewayToken?: string | null;
};

function setTestWindowUrl(urlString: string) {
  const current = new URL(urlString);
  const navigate = (nextUrl: string | URL) => {
    const next = new URL(String(nextUrl), current.toString());
    current.href = next.toString();
    current.protocol = next.protocol;
    current.host = next.host;
    current.pathname = next.pathname;
    current.search = next.search;
    current.hash = next.hash;
  };
  const history = {
    replaceState: vi.fn((_state: unknown, _title: string, nextUrl: string | URL) => {
      navigate(nextUrl);
    }),
    pushState: vi.fn((_state: unknown, _title: string, nextUrl: string | URL) => {
      navigate(nextUrl);
    }),
  };
  const locationLike = {
    get href() {
      return current.toString();
    },
    get protocol() {
      return current.protocol;
    },
    get host() {
      return current.host;
    },
    get pathname() {
      return current.pathname;
    },
    get search() {
      return current.search;
    },
    get hash() {
      return current.hash;
    },
  };
  vi.stubGlobal("window", {
    location: locationLike,
    history,
    setInterval,
    clearInterval,
  } as unknown as Window & typeof globalThis);
  vi.stubGlobal("location", locationLike as Location);
  return { history, location: locationLike };
}

const createHost = (tab: Tab): SettingsHost => ({
  settings: {
    gatewayUrl: "",
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
    themeMode: DEFAULT_THEME_SELECTION.themeMode,
    themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
    chatFocusMode: false,
    chatShowThinking: true,
    chatShowToolCalls: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navWidth: 220,
    navGroupsCollapsed: {},
    locale: "en",
    presentationSyncPending: false,
  },
  themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
  themeMode: DEFAULT_THEME_SELECTION.themeMode,
  themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
  themeResolved: "mood-dark",
  applySessionKey: "main",
  sessionKey: "main",
  tab,
  settingsSection: "general",
  connected: false,
  alisioAccount: null,
  alisioBootstrap: null,
  setupStep: null,
  chatHasAutoScrolled: false,
  logsAtBottom: false,
  eventLog: [],
  eventLogBuffer: [],
  basePath: "",
  themeMedia: null,
  themeMediaHandler: null,
  systemThemeCleanup: null,
  logsPollInterval: null,
  debugPollInterval: null,
  pendingGatewayUrl: null,
  pendingGatewayToken: null,
});

function createBootstrapAccount(): NonNullable<
  import("./types.ts").AlisioBootstrapState["account"]
> {
  return {
    profile: {
      username: "nuno",
      displayName: "Nuno",
      email: "nuno@example.com",
      avatarLabel: "N",
      joinedAt: "2026-04-01T00:00:00.000Z",
      plan: "free",
    },
    preferences: {
      language: "pt-PT" as const,
      themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
      themeMode: "dark" as const,
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
    },
    session: {
      state: "signed_in" as const,
      profileCompleted: true,
    },
    devices: [],
    cloud: {
      backend: "supabase",
      available: true,
      missingEnvVars: [],
    },
  };
}

function createBootstrapState(
  overrides: Partial<import("./types.ts").AlisioBootstrapState> = {},
): import("./types.ts").AlisioBootstrapState {
  return {
    connectionRequired: false,
    wizardRequired: false,
    wizardRunning: false,
    providerReady: true,
    accountReady: true,
    startupState: "ready",
    organizationState: { mode: "none" },
    connectorSummary: {
      total: 0,
      ready: 0,
      connected: 0,
      needsReconnect: 0,
      inReview: 0,
      unavailable: 0,
      available: 0,
    },
    nextStep: "ready",
    account: createBootstrapAccount(),
    ai: {
      provider: "openai",
      status: "connected",
    },
    organization: { mode: "none" },
    connectors: {
      catalog: [],
      authorizations: [],
      summary: {
        total: 0,
        ready: 0,
        connected: 0,
        needsReconnect: 0,
        inReview: 0,
        unavailable: 0,
        available: 0,
      },
    },
    wizard: { running: false, sessionId: null },
    models: { total: 0, defaultProvider: "openai", providers: [] },
    ...overrides,
  };
}

describe("resolveEffectiveAlisioAiState", () => {
  it("uses the startup bootstrap while the full bootstrap is still unavailable", () => {
    expect(
      resolveEffectiveAlisioAiState({
        alisioBootstrap: null,
        alisioStartupBootstrap: {
          basePath: "/",
          controlUrl: "wss://gateway.example/alisio/",
          startupState: "needs_ai",
          account: null,
          accountCloud: {
            backend: "supabase",
            available: true,
            missingEnvVars: [],
          },
          ai: {
            provider: "openai",
            status: "connected",
            email: "startup@example.com",
          },
        },
      }),
    ).toEqual({
      provider: "openai",
      status: "connected",
      email: "startup@example.com",
    });
  });

  it("prefers the full bootstrap snapshot when both are present", () => {
    expect(
      resolveEffectiveAlisioAiState({
        alisioBootstrap: createBootstrapState({
          ai: {
            provider: "openai",
            status: "limits_unavailable",
            email: "full@example.com",
          },
        }),
        alisioStartupBootstrap: {
          basePath: "/",
          controlUrl: "wss://gateway.example/alisio/",
          startupState: "needs_ai",
          account: null,
          accountCloud: {
            backend: "supabase",
            available: true,
            missingEnvVars: [],
          },
          ai: {
            provider: "openai",
            status: "connected",
            email: "startup@example.com",
          },
        },
      })?.email,
    ).toBe("full@example.com");
  });
});

describe("setTabFromRoute", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await i18n.setLocale("en");
  });

  it("starts and stops log polling based on the tab", () => {
    const host = createHost("chat");
    host.settingsSection = "logs";

    setTabFromRoute(host, "settings");
    expect(host.logsPollInterval).not.toBeNull();
    expect(host.debugPollInterval).toBeNull();

    setTabFromRoute(host, "chat");
    expect(host.logsPollInterval).toBeNull();
  });

  it("starts and stops debug polling based on the tab", () => {
    const host = createHost("chat");
    host.settingsSection = "debug";

    setTabFromRoute(host, "settings");
    expect(host.debugPollInterval).not.toBeNull();
    expect(host.logsPollInterval).toBeNull();

    setTabFromRoute(host, "chat");
    expect(host.debugPollInterval).toBeNull();
  });

  it("switches settings subsections in place and keeps the tab stable", () => {
    setTestWindowUrl("https://control.example/settings");
    const host = createHost("settings");

    setSettingsSection(host, "account");

    expect(host.tab).toBe("settings");
    expect(host.settingsSection).toBe("account");
    expect(window.location.search).toBe("?section=account");
  });

  it("re-resolves the active palette when only themeMode changes", () => {
    const host = createHost("chat");
    host.settings.themeFamily = "noir";
    host.settings.themeMode = "dark";
    host.themeFamily = "noir";
    host.themeMode = "dark";
    host.themeResolved = "noir-dark";

    applySettings(host, {
      ...host.settings,
      themeMode: "light",
    });

    expect(host.themeFamily).toBe("noir");
    expect(host.themeMode).toBe("light");
    expect(host.themeResolved).toBe("noir-light");
  });

  it("re-syncs the system theme listener when applySettings changes themeMode", () => {
    const host = createHost("chat");
    const cleanup = vi.fn();
    host.themeMode = "system";
    host.settings.themeMode = "system";
    host.systemThemeCleanup = cleanup;

    applySettings(host, {
      ...host.settings,
      themeMode: "light",
    });

    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.systemThemeCleanup).toBeNull();
  });

  it("syncs both theme family and mode from persisted settings", () => {
    const host = createHost("chat");
    host.settings.themeFamily = "matte";
    host.settings.themeMode = "light";

    syncThemeWithSettings(host);

    expect(host.themeFamily).toBe("matte");
    expect(host.themeMode).toBe("light");
    expect(host.themeResolved).toBe("matte-light");
  });

  it("applies named system themes on OS preference changes", () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    const matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: (_name: string, handler: (event: MediaQueryListEvent) => void) => {
        listeners.push(handler);
      },
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("matchMedia", matchMedia);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });

    const host = createHost("chat");
    host.themeFamily = "noir";
    host.themeMode = "system";

    attachThemeListener(host);
    listeners[0]?.({ matches: true } as MediaQueryListEvent);
    expect(host.themeResolved).toBe("noir-light");

    listeners[0]?.({ matches: false } as MediaQueryListEvent);
    expect(host.themeResolved).toBe("noir-dark");
  });

  it("normalizes light family themes to the shared light CSS token", () => {
    const cssVars = new Map<string, string>();
    const root = {
      dataset: {} as DOMStringMap,
      style: {
        colorScheme: "",
        setProperty: (name: string, value: string) => {
          cssVars.set(name, value);
        },
      } as CSSStyleDeclaration & { colorScheme: string },
    };
    vi.stubGlobal("document", { documentElement: root } as Document);

    const host = createHost("chat");
    applyResolvedTheme(host, "matte-light");

    expect(host.themeResolved).toBe("matte-light");
    expect(root.dataset.theme).toBe("matte-light");
    expect(root.style.colorScheme).toBe("light");
    expect(cssVars.get("--accent")).toBeTruthy();
  });

  it("fixes the border radius tokens to the round preset", () => {
    applyBorderRadius(0);
    expect(document.documentElement.style.getPropertyValue("--radius-sm")).toBe("9px");
    expect(document.documentElement.style.getPropertyValue("--radius-md")).toBe("15px");

    applyBorderRadius(100);
    expect(document.documentElement.style.getPropertyValue("--radius-sm")).toBe("9px");
    expect(document.documentElement.style.getPropertyValue("--radius-md")).toBe("15px");
    expect(document.documentElement.style.getPropertyValue("--radius-full")).toBe("9999px");
  });

  it("syncs signed-in account preferences into local appearance settings", async () => {
    const host = createHost("chat");
    host.settings.themeMode = "dark";
    host.themeMode = "dark";
    host.settings.locale = "en";
    host.alisioAccount = {
      ...createBootstrapAccount(),
      preferences: {
        language: "pt-PT",
        themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
        themeMode: "light",
        themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
      },
    };

    await syncAccountPreferences(host);

    expect(host.settings.themeMode).toBe("light");
    expect(host.themeMode).toBe("light");
    expect(host.themeResolved).toBe("mood-light");
    expect(host.settings.locale).toBe("pt-PT");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.lang).toBe("pt-PT");
  });

  it("ignores signed-out account preferences for local appearance state", async () => {
    const host = createHost("chat");
    host.settings.themeMode = "dark";
    host.themeMode = "dark";
    host.settings.locale = "en";
    host.alisioAccount = {
      ...createBootstrapAccount(),
      preferences: {
        language: "pt-PT",
        themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
        themeMode: "light",
        themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
      },
      session: {
        state: "signed_out",
        profileCompleted: false,
      },
    };

    await syncAccountPreferences(host);

    expect(host.settings.themeMode).toBe("dark");
    expect(host.settings.locale).toBe("en");
  });

  it("does not let stale account preferences overwrite a pending local presentation change", async () => {
    const host = createHost("chat");
    host.settings.locale = "pt-PT";
    host.settings.themeFamily = "noir";
    host.settings.themeMode = "light";
    host.settings.presentationSyncPending = true;
    host.themeFamily = "noir";
    host.themeMode = "light";
    host.alisioAccount = {
      ...createBootstrapAccount(),
      preferences: {
        language: "en",
        themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
        themeMode: "dark",
        themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
      },
    };

    await syncAccountPreferences(host);

    expect(host.settings.locale).toBe("pt-PT");
    expect(host.settings.themeFamily).toBe("noir");
    expect(host.settings.themeMode).toBe("light");
    expect(host.settings.presentationSyncPending).toBe(true);
  });

  it("clears the pending presentation flag once the account confirms the same values", async () => {
    const host = createHost("chat");
    host.settings.locale = "pt-PT";
    host.settings.themeFamily = "noir";
    host.settings.themeMode = "light";
    host.settings.presentationSyncPending = true;
    host.alisioAccount = {
      ...createBootstrapAccount(),
      preferences: {
        language: "pt-PT",
        themeFamily: "noir",
        themeMode: "light",
        themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
      },
    };

    await syncAccountPreferences(host);

    expect(host.settings.presentationSyncPending).toBe(false);
    expect(host.settings.locale).toBe("pt-PT");
    expect(host.settings.themeFamily).toBe("noir");
  });
});

describe("applySettingsFromUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("sessionStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    setTestWindowUrl("https://control.example/ui/home");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await i18n.setLocale("en");
  });

  it("hydrates query token params and strips them from the URL", () => {
    setTestWindowUrl("https://control.example/ui/home?token=abc123");
    const host = createHost("chat");
    host.settings.gatewayUrl = "wss://control.example/\u006fpen\u0063law";

    applySettingsFromUrl(host);

    expect(host.settings.token).toBe("abc123");
    expect(window.location.search).toBe("");
  });

  it("drops legacy ai settings queries back to the published general section", () => {
    setTestWindowUrl("https://control.example/settings?section=ai");
    const host = createHost("settings");

    syncTabWithLocation(host, true);

    expect(host.tab).toBe("settings");
    expect(host.settingsSection).toBe("general");
    expect(window.location.search).toBe("");
  });

  it("preserves the billing subsection query when present", () => {
    setTestWindowUrl("https://control.example/settings?section=billing");
    const host = createHost("settings");

    syncTabWithLocation(host, true);

    expect(host.tab).toBe("settings");
    expect(host.settingsSection).toBe("billing");
    expect(window.location.search).toBe("?section=billing");
  });

  it("persists the focused setup step in the URL", () => {
    const { history } = setTestWindowUrl("https://control.example/setup");
    const host = createHost("setup");
    host.connected = true;
    host.alisioBootstrap = {
      connectionRequired: false,
      wizardRequired: true,
      wizardRunning: false,
      providerReady: false,
      accountReady: false,
      startupState: "needs_profile",
      organizationState: { mode: "none" },
      connectorSummary: {
        total: 0,
        ready: 0,
        connected: 0,
        needsReconnect: 0,
        inReview: 0,
        unavailable: 0,
        available: 0,
      },
      nextStep: "account",
      account: {
        profile: {
          username: "nuno",
          displayName: "Nuno",
          email: "nuno@alisio.local",
          avatarLabel: "N",
          joinedAt: "2026-04-01T00:00:00.000Z",
          plan: "free",
        },
        preferences: {
          language: "pt-PT",
          themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
          themeMode: "dark",
          themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
        },
        session: {
          state: "signed_in",
          profileCompleted: true,
        },
        devices: [],
        cloud: {
          backend: "supabase",
          available: true,
          missingEnvVars: [],
        },
      },
      ai: {
        provider: "openai",
        status: "disconnected",
      },
      organization: { mode: "none" },
      connectors: {
        catalog: [],
        authorizations: [],
        summary: {
          total: 0,
          ready: 0,
          connected: 0,
          needsReconnect: 0,
          inReview: 0,
          unavailable: 0,
          available: 0,
        },
      },
      wizard: { running: false, sessionId: null },
      models: { total: 0, defaultProvider: "anthropic", providers: [] },
    };

    syncUrlWithTab(host, "setup", true);

    expect(history.replaceState).toHaveBeenCalledOnce();
    expect(String(window.location.href)).toContain("/setup?step=account");
  });

  it("keeps query token params pending when a gatewayUrl confirmation is required", () => {
    setTestWindowUrl(
      "https://control.example/ui/home?gatewayUrl=wss://other-gateway.example/\u006fpen\u0063law&token=abc123",
    );
    const host = createHost("chat");
    host.settings.gatewayUrl = "wss://control.example/\u006fpen\u0063law";

    applySettingsFromUrl(host);

    expect(host.settings.token).toBe("");
    expect(host.pendingGatewayUrl).toBe("wss://other-gateway.example/\u006fpen\u0063law");
    expect(host.pendingGatewayToken).toBe("abc123");
    expect(window.location.search).toBe("");
  });

  it("drops a stale runtime setup step once bootstrap is ready", () => {
    setTestWindowUrl("https://control.example/setup?step=runtime");
    const host = createHost("setup");
    host.connected = true;
    host.setupStep = "runtime";
    host.alisioBootstrap = {
      connectionRequired: false,
      wizardRequired: false,
      wizardRunning: false,
      providerReady: true,
      accountReady: true,
      startupState: "ready",
      organizationState: { mode: "none" },
      connectorSummary: {
        total: 0,
        ready: 0,
        connected: 0,
        needsReconnect: 0,
        inReview: 0,
        unavailable: 0,
        available: 0,
      },
      nextStep: "ready",
      account: createBootstrapAccount(),
      ai: { provider: "openai", status: "connected" },
      connectors: {
        catalog: [],
        authorizations: [],
        summary: {
          total: 0,
          ready: 0,
          connected: 0,
          needsReconnect: 0,
          inReview: 0,
          unavailable: 0,
          available: 0,
        },
      },
      wizard: { running: false, sessionId: null },
      models: { total: 0, defaultProvider: "openai", providers: [] },
      organization: { mode: "none" },
    };

    syncUrlWithTab(host, "setup", true);

    expect(String(window.location.href)).toBe("https://control.example/setup");
  });

  it("prefers fragment tokens over legacy query tokens when both are present", () => {
    setTestWindowUrl("https://control.example/ui/home?token=query-token#token=hash-token");
    const host = createHost("chat");
    host.settings.gatewayUrl = "wss://control.example/\u006fpen\u0063law";

    applySettingsFromUrl(host);

    expect(host.settings.token).toBe("hash-token");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("resets stale persisted session selection to main when a token is supplied without a session", () => {
    setTestWindowUrl("https://control.example/chat#token=test-token");
    const host = createHost("chat");
    host.settings = {
      ...host.settings,
      gatewayUrl: "ws://localhost:40705",
      token: "",
      sessionKey: "agent:test_old:main",
      lastActiveSessionKey: "agent:test_old:main",
    };
    host.sessionKey = "agent:test_old:main";

    applySettingsFromUrl(host);

    expect(host.sessionKey).toBe("main");
    expect(host.settings.sessionKey).toBe("main");
    expect(host.settings.lastActiveSessionKey).toBe("main");
  });

  it("preserves an explicit session from the URL when token and session are both supplied", () => {
    setTestWindowUrl(
      "https://control.example/chat?session=agent%3Atest_new%3Amain#token=test-token",
    );
    const host = createHost("chat");
    host.settings = {
      ...host.settings,
      gatewayUrl: "ws://localhost:40705",
      token: "",
      sessionKey: "agent:test_old:main",
      lastActiveSessionKey: "agent:test_old:main",
    };
    host.sessionKey = "agent:test_old:main";

    applySettingsFromUrl(host);

    expect(host.sessionKey).toBe("agent:test_new:main");
    expect(host.settings.sessionKey).toBe("agent:test_new:main");
    expect(host.settings.lastActiveSessionKey).toBe("agent:test_new:main");
  });

  it("does not reset the current gateway session when a different gateway is pending confirmation", () => {
    setTestWindowUrl(
      "https://control.example/chat?gatewayUrl=ws%3A%2F%2Fgateway-b.example%3A18789#token=test-token",
    );
    const host = createHost("chat");
    host.settings = {
      ...host.settings,
      gatewayUrl: "ws://gateway-a.example:40705",
      token: "",
      sessionKey: "agent:test_old:main",
      lastActiveSessionKey: "agent:test_old:main",
    };
    host.sessionKey = "agent:test_old:main";

    applySettingsFromUrl(host);

    expect(host.sessionKey).toBe("agent:test_old:main");
    expect(host.settings.sessionKey).toBe("agent:test_old:main");
    expect(host.settings.lastActiveSessionKey).toBe("agent:test_old:main");
    expect(host.pendingGatewayUrl).toBe("ws://gateway-b.example:18789");
    expect(host.pendingGatewayToken).toBe("test-token");
  });
});
