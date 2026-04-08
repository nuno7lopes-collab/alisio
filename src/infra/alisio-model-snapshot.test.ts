import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRegistry, NodeSession } from "../gateway/node-registry.js";
import { buildAlisioServerProviderId } from "../shared/alisio-remote-model-provider.js";
import type { AlisioRemoteModelServer } from "./alisio-store.js";

const {
  inspectManagedLocalModelRuntimeMock,
  inspectLocalModelRuntimeMock,
  inspectAlisioRemoteModelServerMock,
  listAlisioRemoteModelServersMock,
  resolveCurrentAlisioPlanMock,
} = vi.hoisted(() => ({
  inspectManagedLocalModelRuntimeMock: vi.fn(),
  inspectLocalModelRuntimeMock: vi.fn(),
  inspectAlisioRemoteModelServerMock: vi.fn(),
  listAlisioRemoteModelServersMock: vi.fn<() => Promise<AlisioRemoteModelServer[]>>(async () => []),
  resolveCurrentAlisioPlanMock: vi.fn(async () => "plus"),
}));

vi.mock("./alisio-local-llama-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./alisio-local-llama-runtime.js")>();
  return {
    ...actual,
    inspectManagedLocalModelRuntime: inspectManagedLocalModelRuntimeMock,
  };
});

vi.mock("./alisio-local-model-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./alisio-local-model-runtime.js")>();
  return {
    ...actual,
    inspectLocalModelRuntime: inspectLocalModelRuntimeMock,
  };
});

vi.mock("./alisio-remote-model-provider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./alisio-remote-model-provider.js")>();
  return {
    ...actual,
    inspectAlisioRemoteModelServer: inspectAlisioRemoteModelServerMock,
  };
});

vi.mock("./alisio-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./alisio-store.js")>();
  return {
    ...actual,
    listAlisioRemoteModelServers: listAlisioRemoteModelServersMock,
    resolveCurrentAlisioPlan: resolveCurrentAlisioPlanMock,
  };
});

import {
  clearAlisioModelProviderSnapshotCache,
  loadAlisioModelProviderSnapshot,
} from "./alisio-model-snapshot.js";

function createHardware() {
  return {
    platform: "darwin",
    architecture: "arm64",
    totalMemoryGb: 24,
    cpuCores: 8,
  } as const;
}

function createRegistry(params?: {
  nodes?: NodeSession[];
  taskPayloads?: Record<string, unknown>;
}): NodeRegistry {
  const nodes = params?.nodes ?? [];
  const taskPayloads = params?.taskPayloads ?? {};
  return {
    listConnected: () => nodes,
    startTask: ({ nodeId, capabilityId }: { nodeId: string; capabilityId: string }) => {
      const key = `${nodeId}:${capabilityId}`;
      if (!(key in taskPayloads)) {
        return {
          ok: false,
          error: {
            code: "UNAVAILABLE",
            message: `unexpected task request: ${key}`,
          },
        } as const;
      }
      return {
        ok: true,
        taskId: key,
        result: Promise.resolve({
          ok: true,
          payload: taskPayloads[key],
        }),
      } as const;
    },
  } as unknown as NodeRegistry;
}

describe("loadAlisioModelProviderSnapshot", () => {
  beforeEach(() => {
    clearAlisioModelProviderSnapshotCache();
    vi.clearAllMocks();
    inspectManagedLocalModelRuntimeMock.mockResolvedValue({
      backend: "llama.cpp",
      status: "not_configured",
      message: "No local llama.cpp models are installed on this computer yet.",
      models: [],
      hardware: createHardware(),
    });
    inspectLocalModelRuntimeMock.mockResolvedValue({
      backend: "llama.cpp",
      status: "not_configured",
      message: "local model runtime not configured on this computer",
      models: [],
      hardware: createHardware(),
    });
    listAlisioRemoteModelServersMock.mockResolvedValue([]);
    resolveCurrentAlisioPlanMock.mockResolvedValue("plus");
    inspectAlisioRemoteModelServerMock.mockResolvedValue({
      status: "error",
      providerBaseUrl: "https://models.example.com/v1",
      models: [],
    });
  });

  it("prefers the current OpenAI-compatible runtime when local llama.cpp is not configured yet", async () => {
    inspectLocalModelRuntimeMock.mockResolvedValueOnce({
      backend: "llama.cpp",
      status: "ready",
      models: [{ id: "gpt-oss-20b", name: "gpt-oss-20b" }],
      hardware: createHardware(),
    });

    const snapshot = await loadAlisioModelProviderSnapshot({
      nodeRegistry: createRegistry(),
      env: {
        ALISIO_NODE_MODEL_BASE_URL: "http://127.0.0.1:1234/v1",
      } as NodeJS.ProcessEnv,
      force: true,
    });

    expect(snapshot.targets[0]).toMatchObject({
      current: true,
      runtimeKind: "openai-compatible",
      runtimeStatus: "ready",
      chatProviderId: "alisio-local-current",
      installedModels: [{ id: "gpt-oss-20b", name: "gpt-oss-20b" }],
    });
    expect(snapshot.dynamicCatalogEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "alisio-local-current",
          id: "gpt-oss-20b",
        }),
      ]),
    );
  });

  it("prefers the linked OpenAI-compatible runtime when the advertised llama.cpp catalog is empty", async () => {
    const node = {
      nodeId: "remote-1",
      displayName: "Studio Mac",
      platform: "darwin",
      capabilities: [
        { id: "model.catalog.llamacpp.v1" },
        { id: "model.chat.llamacpp.v1" },
        { id: "model.manage.llamacpp.v1" },
        { id: "model.catalog.openai.v1" },
        { id: "model.chat.openai.v1" },
      ],
    } as NodeSession;

    const snapshot = await loadAlisioModelProviderSnapshot({
      nodeRegistry: createRegistry({
        nodes: [node],
        taskPayloads: {
          "remote-1:model.catalog.llamacpp.v1": {
            status: "not_configured",
            message: "No local llama.cpp models are installed on this computer yet.",
            models: [],
            hardware: createHardware(),
          },
          "remote-1:model.catalog.openai.v1": {
            status: "ready",
            models: [{ id: "gpt-oss-20b", name: "gpt-oss-20b" }],
            hardware: createHardware(),
          },
        },
      }),
      force: true,
    });

    const target = snapshot.targets.find((entry) => entry.targetId === "remote-1");
    expect(target).toMatchObject({
      current: false,
      runtimeKind: "openai-compatible",
      runtimeStatus: "ready",
      supportsInstall: true,
      chatProviderId: "alisio-target-remote-1-openai",
      installedModels: [{ id: "gpt-oss-20b", name: "gpt-oss-20b" }],
    });
    expect(target?.recommendations.length).toBeGreaterThan(0);
    expect(snapshot.dynamicCatalogEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "alisio-target-remote-1-openai",
          id: "gpt-oss-20b",
        }),
      ]),
    );
  });

  it("publishes only the active remote server as a dynamic chat provider", async () => {
    listAlisioRemoteModelServersMock.mockResolvedValueOnce([
      {
        serverId: "server-1",
        label: "Studio",
        kind: "openai-compatible",
        baseUrl: "https://models-1.example.com/v1",
        active: true,
        createdAt: "2026-04-06T10:00:00.000Z",
        updatedAt: "2026-04-06T10:00:00.000Z",
      },
      {
        serverId: "server-2",
        label: "Backup",
        kind: "openai-compatible",
        baseUrl: "https://models-2.example.com/v1",
        active: false,
        createdAt: "2026-04-06T10:00:00.000Z",
        updatedAt: "2026-04-06T10:00:00.000Z",
      },
    ]);
    inspectAlisioRemoteModelServerMock.mockImplementation(async (server: { baseUrl: string }) => ({
      status: "ready",
      providerBaseUrl: server.baseUrl,
      models: [{ id: "gpt-oss-20b", name: "gpt-oss-20b" }],
    }));

    const snapshot = await loadAlisioModelProviderSnapshot({
      nodeRegistry: createRegistry(),
      force: true,
    });

    expect(snapshot.servers.find((server) => server.serverId === "server-1")).toMatchObject({
      active: true,
      chatProviderId: buildAlisioServerProviderId("server-1"),
      status: "ready",
    });
    expect(snapshot.servers.find((server) => server.serverId === "server-2")).toMatchObject({
      active: false,
      status: "ready",
    });
    expect(snapshot.servers.find((server) => server.serverId === "server-2")?.chatProviderId).toBe(
      undefined,
    );
    expect(snapshot.dynamicCatalogEntries.map((entry) => entry.provider)).toContain(
      buildAlisioServerProviderId("server-1"),
    );
    expect(snapshot.dynamicCatalogEntries.map((entry) => entry.provider)).not.toContain(
      buildAlisioServerProviderId("server-2"),
    );
  });

  it("keeps saved remote servers visible but disabled on Free", async () => {
    resolveCurrentAlisioPlanMock.mockResolvedValueOnce("free");
    listAlisioRemoteModelServersMock.mockResolvedValueOnce([
      {
        serverId: "server-1",
        label: "Studio",
        kind: "openai-compatible",
        baseUrl: "http://192.168.1.50:1234",
        active: true,
        createdAt: "2026-04-06T10:00:00.000Z",
        updatedAt: "2026-04-06T10:00:00.000Z",
      },
    ]);

    const snapshot = await loadAlisioModelProviderSnapshot({
      nodeRegistry: createRegistry(),
      force: true,
    });

    expect(snapshot.servers).toEqual([
      expect.objectContaining({
        serverId: "server-1",
        status: "not_configured",
        message: expect.stringContaining("Plus"),
        models: [],
      }),
    ]);
    expect(snapshot.dynamicCatalogEntries.map((entry) => entry.provider)).not.toContain(
      buildAlisioServerProviderId("server-1"),
    );
  });
});
