import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../ui/src/test-helpers/storage.ts";

function setTestLocation(params: { protocol: string; host: string; pathname: string }) {
  vi.stubGlobal("location", {
    protocol: params.protocol,
    host: params.host,
    hostname: params.host.replace(/:\d+$/, ""),
    pathname: params.pathname,
  } as Location);
}

function expectedGatewayUrl(basePath: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${basePath}`;
}

describe("ui settings locale hydration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("sessionStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("hydrates locale from i18n storage when control-ui settings are missing it", async () => {
    setTestLocation({
      protocol: "https:",
      host: "gateway.example:8443",
      pathname: "/",
    });

    const gwUrl = expectedGatewayUrl("");
    localStorage.setItem("alisio.i18n.locale", "pt-PT");
    localStorage.setItem(
      `alisio.control.settings.v2:${gwUrl}`,
      JSON.stringify({
        gatewayUrl: gwUrl,
        theme: "claw",
        themeMode: "system",
        chatFocusMode: false,
        chatShowThinking: true,
        chatShowToolCalls: true,
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

    const { loadSettings } = await import("../ui/src/ui/storage.ts");

    expect(loadSettings()).toMatchObject({
      gatewayUrl: gwUrl,
      locale: "pt-PT",
    });
    expect(
      JSON.parse(localStorage.getItem(`alisio.control.settings.v2:${gwUrl}`) ?? "{}"),
    ).toMatchObject({
      locale: "pt-PT",
    });
  });
});
