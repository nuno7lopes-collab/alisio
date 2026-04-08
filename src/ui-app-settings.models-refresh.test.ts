import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../ui/src/ui/gateway.ts";

const loadAlisioBootstrapMock = vi.hoisted(() => vi.fn(async () => undefined));
const loadAlisioModelsMock = vi.hoisted(() => vi.fn(async () => undefined));
const loadSessionsMock = vi.hoisted(() => vi.fn(async () => undefined));
const loadChatModelsMock = vi.hoisted(() =>
  vi.fn(async () => [{ id: "gpt-5.4", name: "GPT-5.4", provider: "openai-codex" }]),
);

vi.mock("../ui/src/ui/controllers/alisio.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/src/ui/controllers/alisio.ts")>();
  return {
    ...actual,
    loadAlisioBootstrap: loadAlisioBootstrapMock,
    loadAlisioModels: loadAlisioModelsMock,
  };
});

vi.mock("../ui/src/ui/controllers/sessions.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/src/ui/controllers/sessions.ts")>();
  return { ...actual, loadSessions: loadSessionsMock };
});

vi.mock("../ui/src/ui/controllers/models.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui/src/ui/controllers/models.ts")>();
  return { ...actual, loadModels: loadChatModelsMock };
});

import { refreshActiveTab } from "../ui/src/ui/app-settings.ts";

function createHost(): Parameters<typeof refreshActiveTab>[0] {
  return {
    tab: "models",
    connected: true,
    client: { request: vi.fn() } as unknown as GatewayBrowserClient,
    chatModelsLoading: false,
    chatModelCatalog: [],
    sessionsLoading: false,
    sessionsResult: null,
    sessionsError: null,
    settings: {
      gatewayUrl: "",
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
    },
    theme: "claw",
    themeMode: "system",
    themeResolved: "dark",
    applySessionKey: "main",
    sessionKey: "main",
    settingsSection: "general",
    chatHasAutoScrolled: false,
    logsAtBottom: false,
    eventLog: [],
    eventLogBuffer: [],
    basePath: "",
  };
}

describe("refreshActiveTab (models)", () => {
  beforeEach(() => {
    loadAlisioBootstrapMock.mockClear();
    loadAlisioModelsMock.mockClear();
    loadSessionsMock.mockClear();
    loadChatModelsMock.mockClear();
  });

  it("loads the models tab support state in one refresh", async () => {
    const host = createHost();
    await refreshActiveTab(host);

    expect(loadAlisioBootstrapMock).toHaveBeenCalledTimes(1);
    expect(loadAlisioModelsMock).toHaveBeenCalledTimes(1);
    expect(loadSessionsMock).toHaveBeenCalledTimes(1);
    expect(loadSessionsMock).toHaveBeenCalledWith(host, {
      activeMinutes: 0,
      limit: 0,
      includeGlobal: true,
      includeUnknown: true,
    });
    expect(loadChatModelsMock).toHaveBeenCalledTimes(1);
    expect(loadChatModelsMock).toHaveBeenCalledWith(host.client);
    expect(host.chatModelCatalog).toEqual([
      { id: "gpt-5.4", name: "GPT-5.4", provider: "openai-codex" },
    ]);
    expect(host.chatModelsLoading).toBe(false);
  });
});
