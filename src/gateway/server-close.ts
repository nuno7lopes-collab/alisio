import type { Server as HttpServer } from "node:http";
import { WebSocket, type WebSocketServer } from "ws";
import type { CanvasHostHandler, CanvasHostServer } from "../canvas-host/server.js";
import { type ChannelId, listChannelPlugins } from "../channels/plugins/index.js";
import { stopGmailWatcher } from "../hooks/gmail-watcher.js";
import type { HeartbeatRunner } from "../infra/heartbeat-runner.js";
import type { PluginServicesHandle } from "../plugins/services.js";
import type { GatewayWsClient } from "./server/ws-types.js";

const WS_SHUTDOWN_GRACE_MS = 1_000;
const HTTP_SHUTDOWN_GRACE_MS = 1_000;

type CloseableHttpServer = HttpServer & {
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
};

async function closeWithForceFallback(params: {
  close: () => Promise<void>;
  forceAfterMs: number;
  onForce: () => void;
}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    timer = setTimeout(() => {
      try {
        params.onForce();
      } catch {
        /* ignore */
      }
    }, params.forceAfterMs);
    await params.close();
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function closeTrackedWebSocket(socket: WebSocket): void {
  try {
    socket.close(1012, "service restart");
  } catch {
    /* ignore */
  }
}

function terminateTrackedWebSocket(socket: WebSocket): void {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }
  try {
    socket.terminate();
  } catch {
    /* ignore */
  }
}

export function createGatewayCloseHandler(params: {
  bonjourStop: (() => Promise<void>) | null;
  tailscaleCleanup: (() => Promise<void>) | null;
  canvasHost: CanvasHostHandler | null;
  canvasHostServer: CanvasHostServer | null;
  releasePluginRouteRegistry?: (() => void) | null;
  stopChannel: (name: ChannelId, accountId?: string) => Promise<void>;
  pluginServices: PluginServicesHandle | null;
  cron: { stop: () => void };
  heartbeatRunner: HeartbeatRunner;
  updateCheckStop?: (() => void) | null;
  nodePresenceTimers: Map<string, ReturnType<typeof setInterval>>;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  tickInterval: ReturnType<typeof setInterval>;
  healthInterval: ReturnType<typeof setInterval>;
  dedupeCleanup: ReturnType<typeof setInterval>;
  mediaCleanup: ReturnType<typeof setInterval> | null;
  agentUnsub: (() => void) | null;
  heartbeatUnsub: (() => void) | null;
  transcriptUnsub: (() => void) | null;
  lifecycleUnsub: (() => void) | null;
  chatRunState: { clear: () => void };
  clients: Set<GatewayWsClient>;
  configReloader: { stop: () => Promise<void> };
  wss: WebSocketServer;
  httpServer: HttpServer;
  httpServers?: HttpServer[];
}) {
  return async (opts?: { reason?: string; restartExpectedMs?: number | null }) => {
    try {
      const reasonRaw = typeof opts?.reason === "string" ? opts.reason.trim() : "";
      const reason = reasonRaw || "gateway stopping";
      const restartExpectedMs =
        typeof opts?.restartExpectedMs === "number" && Number.isFinite(opts.restartExpectedMs)
          ? Math.max(0, Math.floor(opts.restartExpectedMs))
          : null;
      if (params.bonjourStop) {
        try {
          await params.bonjourStop();
        } catch {
          /* ignore */
        }
      }
      if (params.tailscaleCleanup) {
        await params.tailscaleCleanup();
      }
      if (params.canvasHost) {
        try {
          await params.canvasHost.close();
        } catch {
          /* ignore */
        }
      }
      if (params.canvasHostServer) {
        try {
          await params.canvasHostServer.close();
        } catch {
          /* ignore */
        }
      }
      for (const plugin of listChannelPlugins()) {
        await params.stopChannel(plugin.id);
      }
      if (params.pluginServices) {
        await params.pluginServices.stop().catch(() => {});
      }
      await stopGmailWatcher();
      params.cron.stop();
      params.heartbeatRunner.stop();
      try {
        params.updateCheckStop?.();
      } catch {
        /* ignore */
      }
      for (const timer of params.nodePresenceTimers.values()) {
        clearInterval(timer);
      }
      params.nodePresenceTimers.clear();
      params.broadcast("shutdown", {
        reason,
        restartExpectedMs,
      });
      clearInterval(params.tickInterval);
      clearInterval(params.healthInterval);
      clearInterval(params.dedupeCleanup);
      if (params.mediaCleanup) {
        clearInterval(params.mediaCleanup);
      }
      if (params.agentUnsub) {
        try {
          params.agentUnsub();
        } catch {
          /* ignore */
        }
      }
      if (params.heartbeatUnsub) {
        try {
          params.heartbeatUnsub();
        } catch {
          /* ignore */
        }
      }
      if (params.transcriptUnsub) {
        try {
          params.transcriptUnsub();
        } catch {
          /* ignore */
        }
      }
      if (params.lifecycleUnsub) {
        try {
          params.lifecycleUnsub();
        } catch {
          /* ignore */
        }
      }
      params.chatRunState.clear();
      const trackedSockets = new Set<WebSocket>();
      for (const c of params.clients) {
        trackedSockets.add(c.socket);
      }
      for (const socket of params.wss.clients) {
        trackedSockets.add(socket);
      }
      for (const socket of trackedSockets) {
        closeTrackedWebSocket(socket);
      }
      params.clients.clear();
      await params.configReloader.stop().catch(() => {});
      await closeWithForceFallback({
        forceAfterMs: WS_SHUTDOWN_GRACE_MS,
        onForce: () => {
          for (const socket of trackedSockets) {
            terminateTrackedWebSocket(socket);
          }
        },
        close: async () => await new Promise<void>((resolve) => params.wss.close(() => resolve())),
      });
      const servers =
        params.httpServers && params.httpServers.length > 0
          ? params.httpServers
          : [params.httpServer];
      for (const server of servers) {
        const httpServer = server as CloseableHttpServer;
        if (typeof httpServer.closeIdleConnections === "function") {
          httpServer.closeIdleConnections();
        }
        await closeWithForceFallback({
          forceAfterMs: HTTP_SHUTDOWN_GRACE_MS,
          onForce: () => {
            httpServer.closeAllConnections?.();
          },
          close: async () =>
            await new Promise<void>((resolve, reject) =>
              httpServer.close((err) => (err ? reject(err) : resolve())),
            ),
        });
      }
    } finally {
      try {
        params.releasePluginRouteRegistry?.();
      } catch {
        /* ignore */
      }
    }
  };
}
