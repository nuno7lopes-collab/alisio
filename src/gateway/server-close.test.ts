import { describe, expect, it, vi } from "vitest";
import { createGatewayCloseHandler } from "./server-close.js";

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins: () => [],
}));

vi.mock("../hooks/gmail-watcher.js", () => ({
  stopGmailWatcher: vi.fn(async () => undefined),
}));

describe("createGatewayCloseHandler", () => {
  it("unsubscribes lifecycle listeners during shutdown", async () => {
    const lifecycleUnsub = vi.fn();
    const close = createGatewayCloseHandler({
      bonjourStop: null,
      tailscaleCleanup: null,
      canvasHost: null,
      canvasHostServer: null,
      stopChannel: vi.fn(async () => undefined),
      pluginServices: null,
      cron: { stop: vi.fn() },
      heartbeatRunner: { stop: vi.fn() } as never,
      updateCheckStop: null,
      nodePresenceTimers: new Map(),
      broadcast: vi.fn(),
      tickInterval: setInterval(() => undefined, 60_000),
      healthInterval: setInterval(() => undefined, 60_000),
      dedupeCleanup: setInterval(() => undefined, 60_000),
      mediaCleanup: null,
      agentUnsub: null,
      heartbeatUnsub: null,
      transcriptUnsub: null,
      lifecycleUnsub,
      chatRunState: { clear: vi.fn() },
      clients: new Set(),
      configReloader: { stop: vi.fn(async () => undefined) },
      wss: { clients: new Set(), close: (cb: () => void) => cb() } as never,
      httpServer: {
        close: (cb: (err?: Error | null) => void) => cb(null),
        closeIdleConnections: vi.fn(),
      } as never,
    });

    await close({ reason: "test shutdown" });

    expect(lifecycleUnsub).toHaveBeenCalledTimes(1);
  });

  it("forces lingering websocket clients to terminate during shutdown", async () => {
    vi.useFakeTimers();
    try {
      let resolveWssClose: (() => void) | null = null;
      const socket = {
        readyState: 1,
        close: vi.fn(),
        terminate: vi.fn(() => {
          socket.readyState = 3;
          resolveWssClose?.();
        }),
      };
      const close = createGatewayCloseHandler({
        bonjourStop: null,
        tailscaleCleanup: null,
        canvasHost: null,
        canvasHostServer: null,
        stopChannel: vi.fn(async () => undefined),
        pluginServices: null,
        cron: { stop: vi.fn() },
        heartbeatRunner: { stop: vi.fn() } as never,
        updateCheckStop: null,
        nodePresenceTimers: new Map(),
        broadcast: vi.fn(),
        tickInterval: setInterval(() => undefined, 60_000),
        healthInterval: setInterval(() => undefined, 60_000),
        dedupeCleanup: setInterval(() => undefined, 60_000),
        mediaCleanup: null,
        agentUnsub: null,
        heartbeatUnsub: null,
        transcriptUnsub: null,
        lifecycleUnsub: null,
        chatRunState: { clear: vi.fn() },
        clients: new Set([{ socket } as never]),
        configReloader: { stop: vi.fn(async () => undefined) },
        wss: {
          clients: new Set([socket]),
          close: (cb: () => void) => {
            resolveWssClose = cb;
          },
        } as never,
        httpServer: {
          close: (cb: (err?: Error | null) => void) => cb(null),
          closeIdleConnections: vi.fn(),
        } as never,
      });

      const shutdownPromise = close({ reason: "test shutdown" });
      await vi.advanceTimersByTimeAsync(1_000);
      await shutdownPromise;

      expect(socket.close).toHaveBeenCalledWith(1012, "service restart");
      expect(socket.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forces lingering http connections closed during shutdown", async () => {
    vi.useFakeTimers();
    try {
      let resolveHttpClose: ((err?: Error | null) => void) | null = null;
      const closeAllConnections = vi.fn(() => {
        resolveHttpClose?.(null);
      });
      const close = createGatewayCloseHandler({
        bonjourStop: null,
        tailscaleCleanup: null,
        canvasHost: null,
        canvasHostServer: null,
        stopChannel: vi.fn(async () => undefined),
        pluginServices: null,
        cron: { stop: vi.fn() },
        heartbeatRunner: { stop: vi.fn() } as never,
        updateCheckStop: null,
        nodePresenceTimers: new Map(),
        broadcast: vi.fn(),
        tickInterval: setInterval(() => undefined, 60_000),
        healthInterval: setInterval(() => undefined, 60_000),
        dedupeCleanup: setInterval(() => undefined, 60_000),
        mediaCleanup: null,
        agentUnsub: null,
        heartbeatUnsub: null,
        transcriptUnsub: null,
        lifecycleUnsub: null,
        chatRunState: { clear: vi.fn() },
        clients: new Set(),
        configReloader: { stop: vi.fn(async () => undefined) },
        wss: { clients: new Set(), close: (cb: () => void) => cb() } as never,
        httpServer: {
          close: (cb: (err?: Error | null) => void) => {
            resolveHttpClose = cb;
          },
          closeIdleConnections: vi.fn(),
          closeAllConnections,
        } as never,
      });

      const shutdownPromise = close({ reason: "test shutdown" });
      await vi.advanceTimersByTimeAsync(1_000);
      await shutdownPromise;

      expect(closeAllConnections).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
