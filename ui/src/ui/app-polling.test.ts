import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadNodesMock } = vi.hoisted(() => ({
  loadNodesMock: vi.fn(),
}));

vi.mock("./controllers/nodes.ts", () => ({
  loadNodes: loadNodesMock,
}));

import { startNodesPolling, stopNodesPolling } from "./app-polling.ts";

type PollingHost = {
  nodesPollInterval: number | null;
  logsPollInterval: number | null;
  debugPollInterval: number | null;
  tab: string;
  settingsSection?: string;
};

function createHost(tab: string): PollingHost {
  return {
    nodesPollInterval: null,
    logsPollInterval: null,
    debugPollInterval: null,
    tab,
  };
}

function setVisibilityState(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

describe("startNodesPolling", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
    });
    vi.useFakeTimers();
    loadNodesMock.mockReset();
    setVisibilityState("visible");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it("ignora tabs que não precisam de polling de nós", () => {
    const host = createHost("chat");

    startNodesPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadNodesMock).not.toHaveBeenCalled();
    stopNodesPolling(host);
  });

  it("faz polling quando a vista activa depende de nós", () => {
    const host = createHost("connections");

    startNodesPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadNodesMock).toHaveBeenCalledTimes(1);
    expect(loadNodesMock).toHaveBeenCalledWith(host, { quiet: true });
    stopNodesPolling(host);
  });

  it("suspende polling quando o documento está em background", () => {
    const host = createHost("security");
    setVisibilityState("hidden");

    startNodesPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadNodesMock).not.toHaveBeenCalled();
    stopNodesPolling(host);
  });
});
