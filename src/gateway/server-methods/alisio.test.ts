import { describe, expect, it, vi } from "vitest";
import type { AlisioLocalModelRuntimeInspection } from "../../infra/alisio-local-model-runtime.js";
import {
  buildAlisioCurrentProviderId,
  buildAlisioServerProviderId,
} from "../../shared/alisio-remote-model-provider.js";

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

const { requestAlisioAccountRecoveryEmailMock } = vi.hoisted(() => ({
  requestAlisioAccountRecoveryEmailMock: vi.fn(async () => ({
    ok: true as const,
    message: "A recovery email is on its way.",
  })),
}));

const {
  approveAlisioSharingRequestMock,
  getAlisioSharingStateMock,
  listAlisioRemoteModelServersMock,
  saveAlisioRemoteModelServerMock,
  rejectAlisioSharingRequestMock,
  removeAlisioRemoteModelServerMock,
  requestAlisioSharingAccessMock,
  revokeAlisioSharingGrantMock,
  selectAlisioRemoteModelServerMock,
  setAlisioSharingPolicyMock,
} = vi.hoisted(() => ({
  approveAlisioSharingRequestMock: vi.fn(async ({ requestId }: { requestId: string }) => ({
    ok: true as const,
    requestId,
    grantId: "grant-1",
  })),
  getAlisioSharingStateMock: vi.fn(async () => ({
    viewer: {
      ownerKey: "user:user-1",
      ownerScope: "user",
      label: "Nuno Lopes",
      email: "nuno@example.com",
    },
    planSupported: true,
    policy: {
      allowExternalUse: false,
      editable: false,
    },
    devices: {
      owned: [],
      sharedWithMe: [],
      available: [],
    },
    incomingRequests: [],
    outgoingRequests: [],
    approvals: [],
    grants: [],
    audit: [],
  })),
  listAlisioRemoteModelServersMock: vi.fn(async () => []),
  rejectAlisioSharingRequestMock: vi.fn(async ({ requestId }: { requestId: string }) => ({
    ok: true as const,
    requestId,
  })),
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
  requestAlisioSharingAccessMock: vi.fn(async () => ({
    ok: true as const,
    requestId: "request-1",
  })),
  revokeAlisioSharingGrantMock: vi.fn(async ({ grantId }: { grantId: string }) => ({
    ok: true as const,
    grantId,
    targetId: "remote-1",
  })),
  selectAlisioRemoteModelServerMock: vi.fn(async ({ serverId }: { serverId: string }) => ({
    serverId,
  })),
  setAlisioSharingPolicyMock: vi.fn(
    async ({ allowExternalUse }: { allowExternalUse: boolean }) => ({
      ok: true as const,
      allowExternalUse,
    }),
  ),
}));

const {
  inspectManagedLocalModelRuntimeMock,
  installAlisioLocalModelMock,
  uninstallAlisioLocalModelMock,
} = vi.hoisted(() => ({
  inspectManagedLocalModelRuntimeMock: vi.fn(async () => ({
    backend: "llama.cpp" as const,
    runtimeKind: "llama.cpp" as const,
    runtimeLabel: "Local GGUF",
    status: "not_configured" as const,
    message: "No local llama.cpp models are installed on this computer yet.",
    models: [],
    availableModels: [],
    capabilities: {
      install: true,
      update: true,
      uninstall: true,
      consentRequired: true,
      startServer: false,
    },
    supportsInstall: true,
    supportsUpdate: true,
    supportsUninstall: true,
    consentRequired: true,
  })),
  installAlisioLocalModelMock: vi.fn(async ({ modelId }: { modelId: string }) => ({
    id: modelId,
    name: modelId,
    ownedBy: "llama.cpp",
  })),
  uninstallAlisioLocalModelMock: vi.fn(async ({ modelId }: { modelId: string }) => ({
    id: modelId,
    name: modelId,
    ownedBy: "llama.cpp",
  })),
}));

const {
  inspectLocalModelRuntimeMock,
  inspectLocalModelRuntimesMock,
  installOllamaLocalModelMock,
  uninstallOllamaLocalModelMock,
} = vi.hoisted(() => ({
  inspectLocalModelRuntimeMock: vi.fn(async () => ({
    backend: "llama.cpp" as const,
    runtimeKind: "openai-compatible" as const,
    runtimeLabel: "OpenAI-compatible",
    status: "not_configured" as const,
    message: "local model runtime not configured on this computer",
    models: [],
    availableModels: [],
    capabilities: {
      install: false,
      update: false,
      uninstall: false,
      consentRequired: false,
      startServer: false,
    },
    supportsInstall: false,
    supportsUpdate: false,
    supportsUninstall: false,
    consentRequired: false,
  })),
  inspectLocalModelRuntimesMock: vi.fn(
    async (): Promise<AlisioLocalModelRuntimeInspection[]> => [],
  ),
  installOllamaLocalModelMock: vi.fn(async ({ modelId }: { modelId: string }) => ({
    id: modelId,
    name: modelId,
    ownedBy: "ollama",
  })),
  uninstallOllamaLocalModelMock: vi.fn(async ({ modelId }: { modelId: string }) => ({
    id: modelId,
    name: modelId,
    ownedBy: "ollama",
  })),
}));

vi.mock("../../infra/restart.js", () => ({
  scheduleGatewaySigusr1Restart: scheduleGatewaySigusr1RestartMock,
}));

vi.mock("../../infra/alisio-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/alisio-store.js")>();
  return {
    ...actual,
    requestAlisioAccountRecoveryEmail: requestAlisioAccountRecoveryEmailMock,
    requestAlisioSharingAccess: requestAlisioSharingAccessMock,
    approveAlisioSharingRequest: approveAlisioSharingRequestMock,
    rejectAlisioSharingRequest: rejectAlisioSharingRequestMock,
    revokeAlisioSharingGrant: revokeAlisioSharingGrantMock,
    getAlisioSharingState: getAlisioSharingStateMock,
    listAlisioRemoteModelServers: listAlisioRemoteModelServersMock,
    saveAlisioRemoteModelServer: saveAlisioRemoteModelServerMock,
    removeAlisioRemoteModelServer: removeAlisioRemoteModelServerMock,
    selectAlisioRemoteModelServer: selectAlisioRemoteModelServerMock,
    setAlisioSharingPolicy: setAlisioSharingPolicyMock,
  };
});

vi.mock("../../infra/alisio-local-llama-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/alisio-local-llama-runtime.js")>();
  return {
    ...actual,
    inspectManagedLocalModelRuntime: inspectManagedLocalModelRuntimeMock,
    installAlisioLocalModel: installAlisioLocalModelMock,
    uninstallAlisioLocalModel: uninstallAlisioLocalModelMock,
  };
});

vi.mock("../../infra/alisio-local-model-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/alisio-local-model-runtime.js")>();
  return {
    ...actual,
    inspectLocalModelRuntime: inspectLocalModelRuntimeMock,
    inspectLocalModelRuntimes: inspectLocalModelRuntimesMock,
    installOllamaLocalModel: installOllamaLocalModelMock,
    uninstallOllamaLocalModel: uninstallOllamaLocalModelMock,
  };
});

import { NodeRegistry } from "../node-registry.js";
import { alisioHandlers } from "./alisio.js";
import type { GatewayRequestContext } from "./types.js";

function makeContext(params?: {
  loadGatewayModelCatalog?: GatewayRequestContext["loadGatewayModelCatalog"];
}): GatewayRequestContext {
  return {
    getHealthCache: () => ({ ok: true }) as never,
    refreshHealthSnapshot: async () => ({ ok: true }) as never,
    loadGatewayModelCatalog: params?.loadGatewayModelCatalog ?? vi.fn(async () => []),
    findRunningWizard: () => null,
    broadcast: vi.fn(),
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
      wizardRequired: true,
      wizardRunning: false,
      providerReady: false,
      accountReady: true,
      startupState: "needs_ai",
      nextStep: "runtime",
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
        nextStep: "runtime",
      },
    });
    const payload = calls[0]?.payload as { issues?: Array<{ code: string }> };
    expect(payload.issues?.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["runtime_not_ready"]),
    );
  });

  it("treats a local dynamic provider as runtime-ready without OpenAI auth", async () => {
    const context = makeContext({
      loadGatewayModelCatalog: vi.fn(async () => [
        {
          provider: buildAlisioCurrentProviderId(),
          id: "qwen3-4b-q4-k-m",
          name: "Qwen3 4B",
        },
      ]),
    });
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.bootstrap.get"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.bootstrap.get", params: {}, id: 3 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      providerReady: true,
      models: {
        total: 1,
        providers: [buildAlisioCurrentProviderId()],
      },
    });
  });

  it("skips the OpenAI-only runtime error when a server provider is ready", async () => {
    const context = makeContext({
      loadGatewayModelCatalog: vi.fn(async () => [
        {
          provider: buildAlisioServerProviderId("server-1"),
          id: "llama3.2",
          name: "Llama 3.2",
        },
      ]),
    });
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.doctor.summary"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.doctor.summary", params: {}, id: 4 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      checks?: { runtime?: boolean };
      issues?: Array<{ code: string }>;
      bootstrap?: { providerReady?: boolean };
    };
    expect(payload.bootstrap?.providerReady).toBe(true);
    expect(payload.checks?.runtime).toBe(true);
    expect(payload.issues?.map((issue) => issue.code)).not.toContain("runtime_not_ready");
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
      targetId: expect.stringMatching(/^local:.*::llama\.cpp$/),
      modelId: "qwen3-4b-q4-k-m",
    });
  });

  it("installs an Ollama model on this computer when the local runtime is Ollama", async () => {
    const ollamaInspection: AlisioLocalModelRuntimeInspection = {
      backend: "llama.cpp",
      runtimeKind: "ollama",
      runtimeLabel: "Ollama",
      status: "ready",
      models: [],
      availableModels: [{ id: "qwen3:8b", name: "Qwen3 8B", runtimeKind: "ollama" }],
      capabilities: {
        install: true,
        update: true,
        uninstall: true,
        consentRequired: true,
        startServer: false,
      },
      supportsInstall: true,
      supportsUpdate: true,
      supportsUninstall: true,
      consentRequired: true,
    };
    inspectLocalModelRuntimesMock.mockResolvedValueOnce([ollamaInspection]);

    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.models.install"]({
      params: {
        targetId: "current",
        modelId: "qwen3:8b",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.models.install", params: {}, id: 71 } as never,
    });

    expect(installOllamaLocalModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "qwen3:8b",
      }),
    );
    expect(installAlisioLocalModelMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "qwen3:8b",
      }),
    );
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      targetId: expect.stringMatching(/^local:.*::ollama$/),
    });
  });

  it("uninstalls a published local model on this computer", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.models.uninstall"]({
      params: {
        targetId: "current",
        modelId: "qwen3-4b-q4-k-m",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.models.uninstall", params: {}, id: 8 } as never,
    });

    expect(uninstallAlisioLocalModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "qwen3-4b-q4-k-m",
      }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      backend: "llama.cpp",
      targetId: expect.stringMatching(/^local:.*::llama\.cpp$/),
      modelId: "qwen3-4b-q4-k-m",
    });
  });

  it("uninstalls an Ollama model on this computer when the local runtime is Ollama", async () => {
    const ollamaInspection: AlisioLocalModelRuntimeInspection = {
      backend: "llama.cpp",
      runtimeKind: "ollama",
      runtimeLabel: "Ollama",
      status: "ready",
      models: [{ id: "qwen3:8b", name: "qwen3:8b", ownedBy: "ollama" }],
      availableModels: [],
      capabilities: {
        install: true,
        update: true,
        uninstall: true,
        consentRequired: true,
        startServer: false,
      },
      supportsInstall: true,
      supportsUpdate: true,
      supportsUninstall: true,
      consentRequired: true,
    };
    inspectLocalModelRuntimesMock.mockResolvedValueOnce([ollamaInspection]);

    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.models.uninstall"]({
      params: {
        targetId: "current",
        modelId: "qwen3:8b",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.models.uninstall", params: {}, id: 81 } as never,
    });

    expect(uninstallOllamaLocalModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "qwen3:8b",
      }),
    );
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      targetId: expect.stringMatching(/^local:.*::ollama$/),
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

  it("surfaces organization plan gating as a validation error", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.organization.set"]({
      params: {
        mode: "owner",
        organizationName: "OpenClaw",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.organization.set", params: {}, id: 9 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(false);
    expect(calls[0]?.error).toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("available on Plus"),
    });
  });

  it("serves the sharing state", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.sharing.get"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.sharing.get", params: {}, id: 10 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      viewer: {
        ownerKey: "user:user-1",
      },
      devices: {
        owned: [],
      },
    });
  });

  it("requests shared device access", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.sharing.request"]({
      params: { targetId: "remote-1" },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.sharing.request", params: {}, id: 11 } as never,
    });

    expect(requestAlisioSharingAccessMock).toHaveBeenCalledWith({
      targetId: "remote-1",
      scopes: undefined,
    });
    expect(calls[0]?.ok).toBe(true);
  });

  it("approves a shared device request", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.sharing.approve"]({
      params: { requestId: "request-1" },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.sharing.approve", params: {}, id: 12 } as never,
    });

    expect(approveAlisioSharingRequestMock).toHaveBeenCalledWith({ requestId: "request-1" });
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      grantId: "grant-1",
    });
  });

  it("revokes a shared device grant", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.sharing.revoke"]({
      params: { grantId: "grant-1" },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.sharing.revoke", params: {}, id: 13 } as never,
    });

    expect(revokeAlisioSharingGrantMock).toHaveBeenCalledWith({ grantId: "grant-1" });
    expect(calls[0]?.ok).toBe(true);
  });

  it("allows connector setup to continue from local account mode", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.connectors.begin"]({
      params: {
        connectorId: "google-calendar",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.connectors.begin", params: {}, id: 10 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      connectorId: "google-calendar",
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

  it("starts account recovery with a product-facing success result", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.account.requestRecoveryEmail"]({
      params: {
        email: "nuno@example.com",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.account.requestRecoveryEmail", params: {}, id: 5 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      message: expect.stringContaining("recovery email"),
    });
  });

  it("keeps the legacy password-reset alias working for older clients", async () => {
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
      req: { method: "alisio.account.requestPasswordReset", params: {}, id: 6 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
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
