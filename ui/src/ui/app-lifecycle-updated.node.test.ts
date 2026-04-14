import { describe, expect, it, vi } from "vitest";

const {
  flushPendingPresentationPreferencesMock,
  loadAssistantIdentityMock,
  syncAccountPreferencesMock,
} = vi.hoisted(() => ({
  flushPendingPresentationPreferencesMock: vi.fn(),
  loadAssistantIdentityMock: vi.fn(),
  syncAccountPreferencesMock: vi.fn(),
}));

vi.mock("./app-settings.ts", () => ({
  applySettingsFromUrl: vi.fn(),
  attachThemeListener: vi.fn(),
  detachThemeListener: vi.fn(),
  flushPendingPresentationPreferences: flushPendingPresentationPreferencesMock,
  inferBasePath: vi.fn(() => "/"),
  syncAccountPreferences: syncAccountPreferencesMock,
  syncTabWithLocation: vi.fn(),
  syncThemeWithSettings: vi.fn(),
}));

vi.mock("./controllers/assistant-identity.ts", () => ({
  loadAssistantIdentity: loadAssistantIdentityMock,
}));

vi.mock("./controllers/control-ui-bootstrap.ts", () => ({
  loadControlUiBootstrapConfig: vi.fn(),
}));

vi.mock("./app-gateway.ts", () => ({
  connectGateway: vi.fn(),
}));

vi.mock("./app-polling.ts", () => ({
  startLogsPolling: vi.fn(),
  startMemoryPolling: vi.fn(),
  startNodesPolling: vi.fn(),
  startTasksPolling: vi.fn(),
  stopLogsPolling: vi.fn(),
  stopMemoryPolling: vi.fn(),
  stopNodesPolling: vi.fn(),
  stopTasksPolling: vi.fn(),
  startDebugPolling: vi.fn(),
  stopDebugPolling: vi.fn(),
}));

vi.mock("./app-scroll.ts", () => ({
  observeTopbar: vi.fn(),
  scheduleChatScroll: vi.fn(),
  scheduleLogsScroll: vi.fn(),
}));

import { handleUpdated } from "./app-lifecycle.ts";

function createHost() {
  return {
    tab: "chat",
    chatHasAutoScrolled: false,
    chatManualRefreshInFlight: false,
    chatLoading: false,
    chatMessages: [],
    chatToolMessages: [],
    chatStream: null,
    logsAutoFollow: false,
    logsAtBottom: true,
    logsEntries: [],
  };
}

describe("handleUpdated", () => {
  it("defers preference sync until after Lit updated completes", async () => {
    syncAccountPreferencesMock.mockReset();
    flushPendingPresentationPreferencesMock.mockReset();
    loadAssistantIdentityMock.mockReset();
    const host = createHost();

    handleUpdated(host as never, new Map([["alisioBootstrap", null]]));
    expect(syncAccountPreferencesMock).not.toHaveBeenCalled();
    expect(flushPendingPresentationPreferencesMock).not.toHaveBeenCalled();

    await Promise.resolve();
    await Promise.resolve();
    expect(syncAccountPreferencesMock).toHaveBeenCalledTimes(1);
    expect(flushPendingPresentationPreferencesMock).toHaveBeenCalledTimes(1);
  });
});
