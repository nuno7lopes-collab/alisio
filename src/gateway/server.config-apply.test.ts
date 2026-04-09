import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  connectOk,
  getFreePort,
  installGatewayTestHooks,
  onceMessage,
  rpcReq,
  startGatewayServer,
  trackConnectChallengeNonce,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startGatewayServer>>;
let port = 0;

beforeAll(async () => {
  port = await getFreePort();
  server = await startGatewayServer(port, { controlUiEnabled: true });
});

afterAll(async () => {
  await server.close();
});

const openClient = async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  trackConnectChallengeNonce(ws);
  await new Promise<void>((resolve) => ws.once("open", resolve));
  await connectOk(ws);
  return ws;
};

const sendConfigApply = async (ws: WebSocket, id: string, raw: unknown, baseHash?: string) => {
  ws.send(
    JSON.stringify({
      type: "req",
      id,
      method: "config.apply",
      params: { raw, ...(baseHash ? { baseHash } : {}) },
    }),
  );
  return onceMessage<{
    type?: string;
    id?: string;
    ok?: boolean;
    error?: { message?: string };
    payload?: Record<string, unknown> | null;
  }>(ws, (o) => {
    const msg = o as { type?: string; id?: string };
    return msg.type === "res" && msg.id === id;
  });
};

describe("gateway config.apply", () => {
  it("rejects invalid raw config", async () => {
    const ws = await openClient();
    try {
      const id = "req-1";
      const res = await sendConfigApply(ws, id, "{");
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toMatch(/invalid|SyntaxError/i);
    } finally {
      ws.close();
    }
  });

  it("requires raw to be a string", async () => {
    const ws = await openClient();
    try {
      const id = "req-2";
      const res = await sendConfigApply(ws, id, { gateway: { mode: "local" } });
      expect(res.ok).toBe(false);
      expect(res.error?.message ?? "").toContain("raw");
    } finally {
      ws.close();
    }
  });

  it("does not schedule restart for dynamic tools.exec config changes", async () => {
    const ws = await openClient();
    try {
      const current = await rpcReq<{
        hash?: string;
        config?: {
          tools?: {
            exec?: {
              ask?: string;
            };
          };
        };
      }>(ws, "config.get", {});
      expect(current.ok).toBe(true);
      expect(typeof current.payload?.hash).toBe("string");

      const previousAsk = current.payload?.config?.tools?.exec?.ask ?? "on-miss";
      const nextAsk = previousAsk === "off" ? "on-miss" : "off";
      const nextConfig = {
        ...current.payload?.config,
        tools: {
          ...current.payload?.config?.tools,
          exec: {
            ...current.payload?.config?.tools?.exec,
            ask: nextAsk,
          },
        },
      };

      const res = await sendConfigApply(
        ws,
        "req-dynamic-apply",
        JSON.stringify(nextConfig),
        current.payload?.hash,
      );

      expect(res.ok).toBe(true);
      expect((res.payload as { restart?: unknown } | undefined)?.restart).toBeNull();
      expect((res.payload as { sentinel?: unknown } | undefined)?.sentinel).toBeNull();
    } finally {
      ws.close();
    }
  });
});
