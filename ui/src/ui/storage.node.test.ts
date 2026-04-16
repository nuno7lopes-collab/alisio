import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../test-helpers/storage.ts";
import { DEFAULT_THEME_SELECTION } from "./theme.ts";

function createStoredSettings(
  overrides: Partial<import("./storage.ts").UiSettings>,
): import("./storage.ts").UiSettings {
  return {
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
    chatHideCronSessions: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navWidth: 220,
    navGroupsCollapsed: {},
    ...overrides,
  };
}

function setTestLocation(params: { protocol: string; host: string; pathname: string }) {
  vi.stubGlobal("location", {
    protocol: params.protocol,
    host: params.host,
    hostname: params.host.replace(/:\d+$/, ""),
    pathname: params.pathname,
  } as Location);
}

function setControlUiBasePath(value: string | undefined) {
  if (typeof window === "undefined") {
    vi.stubGlobal(
      "window",
      value == null
        ? ({} as Window & typeof globalThis)
        : ({ __ALISIO_CONTROL_UI_BASE_PATH__: value } as Window & typeof globalThis),
    );
    return;
  }
  if (value == null) {
    delete window.__ALISIO_CONTROL_UI_BASE_PATH__;
    return;
  }
  Object.defineProperty(window, "__ALISIO_CONTROL_UI_BASE_PATH__", {
    value,
    writable: true,
    configurable: true,
  });
}

function setControlUiDevGatewayPort(value: string | undefined) {
  if (typeof window === "undefined") {
    vi.stubGlobal(
      "window",
      value == null
        ? ({} as Window & typeof globalThis)
        : ({ __ALISIO_CONTROL_UI_DEV_GATEWAY_PORT__: value } as Window & typeof globalThis),
    );
    return;
  }
  if (value == null) {
    delete window.__ALISIO_CONTROL_UI_DEV_GATEWAY_PORT__;
    return;
  }
  Object.defineProperty(window, "__ALISIO_CONTROL_UI_DEV_GATEWAY_PORT__", {
    value,
    writable: true,
    configurable: true,
  });
}

function expectedGatewayUrl(basePath: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${basePath}`;
}

describe("loadSettings default gateway URL derivation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("sessionStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    localStorage.clear();
    sessionStorage.clear();
    setControlUiBasePath(undefined);
    setControlUiDevGatewayPort(undefined);
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setControlUiBasePath(undefined);
    setControlUiDevGatewayPort(undefined);
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("uses configured base path and normalizes trailing slash", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/ignored/path",
    });
    setControlUiBasePath(" /alisio/ ");

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().gatewayUrl).toBe(expectedGatewayUrl("/alisio"));
  });

  it("infers base path from nested pathname when configured base path is not set", async () => {
    setTestLocation({
      protocol: "http:",
      host: "gateway.example:40705",
      pathname: "/apps/alisio/chat",
    });

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().gatewayUrl).toBe(expectedGatewayUrl("/apps/alisio"));
  });

  it("uses the injected dev gateway port on Vite pages", async () => {
    setTestLocation({
      protocol: "http:",
      host: "gateway.example:5173",
      pathname: "/",
    });
    setControlUiDevGatewayPort("19001");
    document.body.innerHTML = '<script src="/@vite/client"></script>';

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().gatewayUrl).toBe("ws://gateway.example:19001");
  });

  it("derives the default locale from the effective i18n locale on first load", async () => {
    vi.stubGlobal("navigator", { language: "pt-PT" } as Navigator);
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const { loadSettings } = await import("./storage.ts");

    expect(loadSettings()).toMatchObject({
      gatewayUrl: expectedGatewayUrl(""),
      locale: "pt-PT",
    });
  });

  it("reconciles stale stored settings locale with the persisted i18n locale", async () => {
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });
    localStorage.setItem("alisio.i18n.locale", "pt-PT");
    localStorage.setItem("alisio.control.settings.v2", JSON.stringify({ locale: "en" }));

    const { loadSettings } = await import("./storage.ts");

    expect(loadSettings()).toMatchObject({
      gatewayUrl: expectedGatewayUrl(""),
      locale: "pt-PT",
    });
  });

  it("skips node sessionStorage accessors that warn without a storage file", async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });
    setControlUiBasePath(undefined);
    const warningSpy = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);

    const { loadSettings } = await import("./storage.ts");

    expect(loadSettings()).toMatchObject({
      gatewayUrl: expectedGatewayUrl(""),
      token: "",
    });
    expect(warningSpy).not.toHaveBeenCalledWith(
      "`--localstorage-file` was provided without a valid path",
      expect.anything(),
      expect.anything(),
    );
  });

  it("loads the current-tab token from sessionStorage", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const gwUrl = expectedGatewayUrl("");
    const { loadSettings, saveSettings } = await import("./storage.ts");
    saveSettings(
      createStoredSettings({
        gatewayUrl: gwUrl,
        token: "session-token",
      }),
    );

    expect(loadSettings()).toMatchObject({
      gatewayUrl: gwUrl,
      token: "session-token",
    });
  });

  it("prefers the current-tab session selection from sessionStorage over shared gateway defaults", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const gwUrl = expectedGatewayUrl("");
    localStorage.setItem(
      `alisio.control.settings.v2:${gwUrl}`,
      JSON.stringify({
        gatewayUrl: gwUrl,
        sessionsByGateway: {
          [gwUrl]: {
            sessionKey: "agent:shared:main",
            lastActiveSessionKey: "agent:shared:main",
          },
        },
      }),
    );
    sessionStorage.setItem(
      "alisio.control.surface-session.v1:wss://gateway.example:8443",
      JSON.stringify({
        sessionKey: "agent:tab:main",
        lastActiveSessionKey: "agent:tab:main",
      }),
    );

    const { loadSettings } = await import("./storage.ts");

    expect(loadSettings()).toMatchObject({
      gatewayUrl: gwUrl,
      sessionKey: "agent:tab:main",
      lastActiveSessionKey: "agent:tab:main",
    });
  });

  it("keeps different selected conversations per tab even when the shared gateway defaults are the same", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const tabA = createStorageMock();
    const tabB = createStorageMock();
    const gwUrl = expectedGatewayUrl("");
    const { loadSettings, saveSettings } = await import("./storage.ts");

    vi.stubGlobal("sessionStorage", tabA);
    saveSettings(
      createStoredSettings({
        gatewayUrl: gwUrl,
        sessionKey: "agent:main:conversation-a",
        lastActiveSessionKey: "agent:main:conversation-a",
      }),
    );

    vi.stubGlobal("sessionStorage", tabB);
    saveSettings(
      createStoredSettings({
        gatewayUrl: gwUrl,
        sessionKey: "agent:main:conversation-b",
        lastActiveSessionKey: "agent:main:conversation-b",
      }),
    );

    vi.stubGlobal("sessionStorage", tabA);
    expect(loadSettings()).toMatchObject({
      gatewayUrl: gwUrl,
      sessionKey: "agent:main:conversation-a",
      lastActiveSessionKey: "agent:main:conversation-a",
    });

    vi.stubGlobal("sessionStorage", tabB);
    expect(loadSettings()).toMatchObject({
      gatewayUrl: gwUrl,
      sessionKey: "agent:main:conversation-b",
      lastActiveSessionKey: "agent:main:conversation-b",
    });
  });

  it("does not reuse a session token for a different gatewayUrl", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const gwUrl = expectedGatewayUrl("");
    const otherUrl = "wss://other-gateway.example:8443";
    const { loadSettings, saveSettings } = await import("./storage.ts");
    saveSettings(
      createStoredSettings({
        gatewayUrl: gwUrl,
        token: "gateway-a-token",
      }),
    );

    saveSettings(
      createStoredSettings({
        gatewayUrl: otherUrl,
        token: "",
      }),
    );

    expect(loadSettings()).toMatchObject({
      gatewayUrl: gwUrl,
      token: "gateway-a-token",
    });
  });

  it("does not persist gateway tokens when saving settings", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const gwUrl = expectedGatewayUrl("");
    const { loadSettings, saveSettings } = await import("./storage.ts");
    saveSettings(
      createStoredSettings({
        gatewayUrl: gwUrl,
        token: "memory-only-token",
      }),
    );
    expect(loadSettings()).toMatchObject({
      gatewayUrl: gwUrl,
      token: "memory-only-token",
    });

    const scopedKey = `alisio.control.settings.v2:${gwUrl}`;
    expect(JSON.parse(localStorage.getItem(scopedKey) ?? "{}")).toEqual({
      gatewayUrl: gwUrl,
      themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
      themeMode: DEFAULT_THEME_SELECTION.themeMode,
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
      locale: "en",
      presentationSyncPending: false,
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: true,
      chatHideCronSessions: true,
      chatPresentationModeVersion: 2,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 220,
      navGroupsCollapsed: {},
      sessionsByGateway: {
        [gwUrl]: {
          sessionKey: "main",
          lastActiveSessionKey: "main",
        },
      },
    });
    expect(sessionStorage.length).toBe(1);
  });

  it("clears the current-tab token when saving an empty token", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const gwUrl = expectedGatewayUrl("");
    const { loadSettings, saveSettings } = await import("./storage.ts");
    saveSettings(
      createStoredSettings({
        gatewayUrl: gwUrl,
        token: "stale-token",
      }),
    );
    saveSettings(
      createStoredSettings({
        gatewayUrl: gwUrl,
        token: "",
      }),
    );

    expect(loadSettings().token).toBe("");
    expect(sessionStorage.length).toBe(0);
  });

  it("persists themeMode and navWidth alongside the selected theme", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const gwUrl = expectedGatewayUrl("");
    const { saveSettings } = await import("./storage.ts");
    saveSettings(
      createStoredSettings({
        gatewayUrl: gwUrl,
        token: "",
        themeFamily: "matte",
        themeMode: "light",
        navWidth: 320,
      }),
    );

    const scopedKey = `alisio.control.settings.v2:${gwUrl}`;
    expect(JSON.parse(localStorage.getItem(scopedKey) ?? "{}")).toMatchObject({
      themeFamily: "matte",
      themeMode: "light",
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
      presentationSyncPending: false,
      navWidth: 320,
    });
  });

  it("scopes persisted session selection per gateway", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway-a.example:8443",
      pathname: "/",
    });

    const gwUrl = expectedGatewayUrl("");
    const { loadSettings, saveSettings } = await import("./storage.ts");

    saveSettings(
      createStoredSettings({
        gatewayUrl: gwUrl,
        token: "",
        sessionKey: "agent:test_old:main",
        lastActiveSessionKey: "agent:test_old:main",
      }),
    );

    expect(loadSettings()).toMatchObject({
      gatewayUrl: gwUrl,
      sessionKey: "agent:test_old:main",
      lastActiveSessionKey: "agent:test_old:main",
    });
  });

  it("caps persisted session scopes to the most recent gateways", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const { saveSettings } = await import("./storage.ts");
    const gwUrl = expectedGatewayUrl("");
    const scopedKey = `alisio.control.settings.v2:wss://gateway.example:8443`;

    // Pre-seed sessionsByGateway with 11 stale gateway entries so the next
    // saveSettings call pushes the total to 12 and triggers the cap (10).
    const staleEntries: Record<string, { sessionKey: string; lastActiveSessionKey: string }> = {};
    for (let i = 0; i < 11; i += 1) {
      staleEntries[`wss://stale-${i}.example:8443`] = {
        sessionKey: `agent:stale_${i}:main`,
        lastActiveSessionKey: `agent:stale_${i}:main`,
      };
    }
    localStorage.setItem(scopedKey, JSON.stringify({ sessionsByGateway: staleEntries }));

    saveSettings(
      createStoredSettings({
        gatewayUrl: gwUrl,
        token: "",
        sessionKey: "agent:current:main",
        lastActiveSessionKey: "agent:current:main",
      }),
    );

    const persisted = JSON.parse(localStorage.getItem(scopedKey) ?? "{}");

    expect(persisted.sessionsByGateway).toBeDefined();
    const scopes = Object.keys(persisted.sessionsByGateway);
    expect(scopes).toHaveLength(10);
    // oldest stale entries should be evicted
    expect(scopes).not.toContain("wss://stale-0.example:8443");
    expect(scopes).not.toContain("wss://stale-1.example:8443");
    // newest stale entries and the current gateway should be retained
    expect(scopes).toContain("wss://stale-10.example:8443");
    expect(scopes).toContain("wss://gateway.example:8443");
    expect(persisted.sessionsByGateway["wss://gateway.example:8443"]).toEqual({
      sessionKey: "agent:current:main",
      lastActiveSessionKey: "agent:current:main",
    });
  });

  it("migra themes legacy persistidos para família e acentos canónicos", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const gwUrl = expectedGatewayUrl("");
    localStorage.setItem(
      `alisio.control.settings.v2:${gwUrl}`,
      JSON.stringify({
        gatewayUrl: gwUrl,
        theme: "knot",
        themeMode: "light",
        chatFocusMode: false,
        chatShowThinking: true,
        chatShowToolCalls: true,
        chatHideCronSessions: true,
        splitRatio: 0.6,
        navCollapsed: false,
        navWidth: 220,
        navGroupsCollapsed: {},
        sessionsByGateway: {
          [gwUrl]: {
            sessionKey: "main",
            lastActiveSessionKey: "main",
          },
        },
      }),
    );

    const { loadSettings } = await import("./storage.ts");

    expect(loadSettings()).toMatchObject({
      gatewayUrl: gwUrl,
      themeFamily: "noir",
      themeMode: "light",
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
    });
  });

  it("marca preferências locais personalizadas para re-sincronização quando a flag ainda não existe", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const gwUrl = expectedGatewayUrl("");
    localStorage.setItem(
      `alisio.control.settings.v2:${gwUrl}`,
      JSON.stringify({
        gatewayUrl: gwUrl,
        locale: "pt-PT",
        themeFamily: "noir",
        themeMode: "light",
        themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
        chatFocusMode: false,
        chatShowThinking: true,
        chatShowToolCalls: true,
        chatHideCronSessions: true,
        chatPresentationModeVersion: 2,
        splitRatio: 0.6,
        navCollapsed: false,
        navWidth: 220,
        navGroupsCollapsed: {},
        sessionsByGateway: {
          [gwUrl]: {
            sessionKey: "main",
            lastActiveSessionKey: "main",
          },
        },
      }),
    );

    const { loadSettings } = await import("./storage.ts");

    expect(loadSettings()).toMatchObject({
      locale: "pt-PT",
      themeFamily: "noir",
      themeMode: "light",
      presentationSyncPending: true,
    });
  });
});
