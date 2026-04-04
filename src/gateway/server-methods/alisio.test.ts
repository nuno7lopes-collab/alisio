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

const { requestAlisioAccountPasswordResetMock } = vi.hoisted(() => ({
  requestAlisioAccountPasswordResetMock: vi.fn(async () => ({
    ok: true as const,
    message: "We've sent a password reset email.",
  })),
}));

const {
  listAlisioRemoteModelServersMock,
  saveAlisioRemoteModelServerMock,
  removeAlisioRemoteModelServerMock,
  selectAlisioRemoteModelServerMock,
} = vi.hoisted(() => ({
  listAlisioRemoteModelServersMock: vi.fn(async () => []),
  saveAlisioRemoteModelServerMock: vi.fn(
    async ({
      serverId,
      label,
      kind,
      baseUrl,
    }: {
      serverId?: string;
      label: string;
      kind: string;
      baseUrl: string;
    }) => ({
      serverId: serverId ?? "server-1",
      label,
      kind,
      baseUrl,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  ),
  removeAlisioRemoteModelServerMock: vi.fn(async ({ serverId }: { serverId: string }) => ({
    serverId,
  })),
  selectAlisioRemoteModelServerMock: vi.fn(async ({ serverId }: { serverId: string }) => ({
    serverId,
  })),
}));

const { inspectManagedLocalModelRuntimeMock, installAlisioLocalModelMock } = vi.hoisted(() => ({
  inspectManagedLocalModelRuntimeMock: vi.fn(async () => ({
    backend: "llama.cpp" as const,
    status: "not_configured" as const,
    message: "No local llama.cpp models are installed on this computer yet.",
    models: [],
  })),
  installAlisioLocalModelMock: vi.fn(async ({ modelId }: { modelId: string }) => ({
    id: modelId,
    name: modelId,
    ownedBy: "llama.cpp",
  })),
}));

vi.mock("../../infra/restart.js", () => ({
  scheduleGatewaySigusr1Restart: scheduleGatewaySigusr1RestartMock,
}));

vi.mock("../../infra/alisio-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/alisio-store.js")>();
  return {
    ...actual,
    requestAlisioAccountPasswordReset: requestAlisioAccountPasswordResetMock,
    listAlisioRemoteModelServers: listAlisioRemoteModelServersMock,
    saveAlisioRemoteModelServer: saveAlisioRemoteModelServerMock,
    removeAlisioRemoteModelServer: removeAlisioRemoteModelServerMock,
    selectAlisioRemoteModelServer: selectAlisioRemoteModelServerMock,
  };
});

vi.mock("../../infra/alisio-local-llama-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/alisio-local-llama-runtime.js")>();
  return {
    ...actual,
    inspectManagedLocalModelRuntime: inspectManagedLocalModelRuntimeMock,
    installAlisioLocalModel: installAlisioLocalModelMock,
  };
});

import { NodeRegistry } from "../node-registry.js";
import { alisioHandlers } from "./alisio.js";
import type { GatewayRequestContext } from "./types.js";

function makeContext(): GatewayRequestContext {
  return {
    getHealthCache: () => ({ ok: true }) as never,
    refreshHealthSnapshot: async () => ({ ok: true }) as never,
    loadGatewayModelCatalog: vi.fn(async () => []),
    findRunningWizard: () => null,
    nodeRegistry: new NodeRegistry(),
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

  it("serves local model targets for this computer", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.models.get"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.models.get", params: {}, id: 6 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      backend: "llama.cpp",
      targets: [
        expect.objectContaining({
          current: true,
          connected: true,
          backend: "llama.cpp",
          recommendations: expect.any(Array),
        }),
      ],
      servers: [],
    });
  });

  it("installs a published local model on this computer", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.models.install"]({
      params: {
        targetId: "current",
        modelId: "qwen3-4b-q4-k-m",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.models.install", params: {}, id: 7 } as never,
    });

    expect(installAlisioLocalModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "qwen3-4b-q4-k-m",
      }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      backend: "llama.cpp",
      targetId: "current",
      modelId: "qwen3-4b-q4-k-m",
    });
  });

  it("saves a remote model server", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.models.server.save"]({
      params: {
        label: "GPU Box",
        kind: "openai-compatible",
        baseUrl: "https://models.example.com/v1",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.models.server.save", params: {}, id: 8 } as never,
    });

    expect(saveAlisioRemoteModelServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "GPU Box",
        kind: "openai-compatible",
      }),
      process.env,
    );
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      serverId: "server-1",
    });
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

  it("starts password recovery with a product-facing success result", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.account.requestPasswordReset"]({
      params: {
        email: "nuno@example.com",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.account.requestPasswordReset", params: {}, id: 5 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      message: expect.stringContaining("password reset email"),
    });
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
