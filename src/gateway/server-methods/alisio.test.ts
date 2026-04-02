import { describe, expect, it, vi } from "vitest";

const { scheduleGatewaySigusr1RestartMock } = vi.hoisted(() => ({
  scheduleGatewaySigusr1RestartMock: vi.fn(() => ({
    ok: true,
    pid: 1234,
    signal: "SIGUSR1" as const,
    delayMs: 0,
    reason: "alisio.runtime.restart",
    mode: "emit" as const,
    coalesced: false,
    cooldownMsApplied: 0,
  })),
}));

vi.mock("../../infra/restart.js", () => ({
  scheduleGatewaySigusr1Restart: scheduleGatewaySigusr1RestartMock,
}));

import { alisioHandlers } from "./alisio.js";
import type { GatewayRequestContext } from "./types.js";

function makeContext(): GatewayRequestContext {
  return {
    getHealthCache: () => ({ ok: true }) as never,
    refreshHealthSnapshot: async () => ({ ok: true }) as never,
    loadGatewayModelCatalog: vi.fn(async () => []),
    findRunningWizard: () => null,
  } as unknown as GatewayRequestContext;
}

function makeRespond() {
  const calls: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

describe("alisio gateway methods", () => {
  it("serves the unified bootstrap summary", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.bootstrap.get"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.bootstrap.get", params: {}, id: 1 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      connectionRequired: false,
      wizardRequired: false,
      wizardRunning: false,
      providerReady: false,
      accountReady: false,
      startupState: "signed_out",
      nextStep: "account",
    });
  });

  it("serves the unified doctor summary", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.doctor.summary"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.doctor.summary", params: {}, id: 2 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: false,
      bootstrap: {
        nextStep: "account",
      },
    });
    const payload = calls[0]?.payload as { issues?: Array<{ code: string }> };
    expect(payload.issues?.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["runtime_not_ready", "account_not_ready"]),
    );
  });

  it("rejects invalid account usernames with a product-facing validation error", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.account.update"]({
      params: {
        username: "nu!",
        displayName: "Nuno Lopes",
        email: "nuno@example.com",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.account.update", params: {}, id: 4 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(false);
  });

  it("schedules a restart from the unified product runtime action", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.runtime.restart"]({
      params: {},
      client: {
        connect: {
          role: "operator",
          scopes: ["operator.admin"],
          device: { id: "device-1" },
        },
        clientIp: "127.0.0.1",
      } as never,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.runtime.restart", params: {}, id: 3 } as never,
    });

    expect(scheduleGatewaySigusr1RestartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        delayMs: 0,
        reason: "alisio.runtime.restart",
      }),
    );
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      signal: "SIGUSR1",
      delayMs: 0,
      reason: "alisio.runtime.restart",
    });
  });
});
