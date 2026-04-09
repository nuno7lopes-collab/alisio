import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRegistry, NodeSession } from "../gateway/node-registry.js";

const {
  inspectManagedLocalModelRuntimeMock,
  inspectLocalModelRuntimesMock,
  getAlisioSharingTargetAccessIndexMock,
} = vi.hoisted(() => ({
  inspectManagedLocalModelRuntimeMock: vi.fn(),
  inspectLocalModelRuntimesMock: vi.fn(),
  getAlisioSharingTargetAccessIndexMock: vi.fn(
    async (input?: { targets?: Array<{ targetId: string; ownerLabel?: string }> }) =>
      Object.fromEntries(
        (input?.targets ?? []).map((target) => [
          target.targetId,
          {
            targetId: target.targetId,
            label: target.targetId,
            sourceKind: target.targetId === "current" ? "current" : "node",
            connected: true,
            current: target.targetId === "current",
            ownerKey: "user:user-1",
            ownerScope: "user",
            ownerLabel: "Owner",
            registeredAt: "2026-04-08T10:00:00.000Z",
            updatedAt: "2026-04-08T10:00:00.000Z",
            deviceAccess: "owner",
            modelAccess: "owner",
          },
        ]),
      ),
  ),
}));

vi.mock("./alisio-local-llama-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./alisio-local-llama-runtime.js")>();
  return {
    ...actual,
    inspectManagedLocalModelRuntime: inspectManagedLocalModelRuntimeMock,
  };
});

vi.mock("./alisio-local-model-runtime.js", () => {
  return {
    inspectLocalModelRuntimes: inspectLocalModelRuntimesMock,
    listManagedLocalAvailableModels: vi.fn(() => []),
    listLmStudioAvailableModels: vi.fn(() => []),
    listOllamaAvailableModels: vi.fn(() => []),
  };
});

vi.mock("./alisio-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./alisio-store.js")>();
  return {
    ...actual,
    getAlisioSharingTargetAccessIndex: getAlisioSharingTargetAccessIndexMock,
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
      runtimeKind: "llama.cpp",
      runtimeLabel: "Local GGUF",
      status: "not_configured",
      message: "No local llama.cpp models are installed on this computer yet.",
      models: [],
      availableModels: [],
      hardware: createHardware(),
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
    });
    inspectLocalModelRuntimesMock.mockResolvedValue([]);
  });

  it("prefers the current OpenAI-compatible runtime when local llama.cpp is not configured yet", async () => {
    inspectLocalModelRuntimesMock.mockResolvedValueOnce([
      {
        backend: "llama.cpp",
        runtimeKind: "openai-compatible",
        runtimeLabel: "OpenAI-compatible",
        status: "ready",
        models: [{ id: "gpt-oss-20b", name: "gpt-oss-20b" }],
        availableModels: [
          { id: "gpt-oss-20b", name: "gpt-oss-20b", runtimeKind: "openai-compatible" },
        ],
        hardware: createHardware(),
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
      },
    ]);

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
      installedModels: [{ id: "gpt-oss-20b", name: "gpt-oss-20b" }],
    });
    expect(snapshot.targets[0]?.chatProviderId).toBeUndefined();
    expect(snapshot.dynamicCatalogEntries).toEqual([]);
  });

  it("publishes the current llama.cpp runtime as a local dynamic provider", async () => {
    inspectManagedLocalModelRuntimeMock.mockResolvedValueOnce({
      backend: "llama.cpp",
      runtimeKind: "llama.cpp",
      runtimeLabel: "Local GGUF",
      status: "ready",
      models: [{ id: "qwen3-8b-q4-k-m", name: "Qwen3 8B", ownedBy: "llama.cpp", running: true }],
      availableModels: [],
      hardware: createHardware(),
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
    });

    const snapshot = await loadAlisioModelProviderSnapshot({
      nodeRegistry: createRegistry(),
      force: true,
    });

    expect(snapshot.targets[0]).toMatchObject({
      current: true,
      runtimeKind: "llama.cpp",
      runtimeStatus: "ready",
      chatProviderId: "alisio-local-current-llama",
      installedModels: [
        { id: "qwen3-8b-q4-k-m", name: "Qwen3 8B", ownedBy: "llama.cpp", running: true },
      ],
    });
    expect(snapshot.dynamicCatalogEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "alisio-local-current-llama",
          id: "qwen3-8b-q4-k-m",
        }),
      ]),
    );
  });

  it("keeps the Ollama runtime visible without publishing a dynamic provider", async () => {
    inspectManagedLocalModelRuntimeMock.mockResolvedValueOnce({
      backend: "llama.cpp",
      runtimeKind: "llama.cpp",
      runtimeLabel: "Local GGUF",
      status: "not_configured",
      message: "No local llama.cpp models are installed on this computer yet.",
      models: [],
      availableModels: [],
      hardware: createHardware(),
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
    });
    inspectLocalModelRuntimesMock.mockResolvedValueOnce([
      {
        backend: "llama.cpp",
        runtimeKind: "ollama",
        runtimeLabel: "Ollama",
        status: "ready",
        models: [
          { id: "qwen3:8b", name: "qwen3:8b", ownedBy: "ollama", running: true },
          { id: "qwen3:4b", name: "qwen3:4b", ownedBy: "ollama" },
        ],
        availableModels: [
          { id: "qwen3:4b", name: "Qwen3 4B", runtimeKind: "ollama" },
          { id: "qwen3:8b", name: "Qwen3 8B", runtimeKind: "ollama" },
        ],
        hardware: createHardware(),
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
      },
    ]);

    const snapshot = await loadAlisioModelProviderSnapshot({
      nodeRegistry: createRegistry(),
      env: {
        ALISIO_NODE_MODEL_BASE_URL: "http://127.0.0.1:11434",
      } as NodeJS.ProcessEnv,
      force: true,
    });

    expect(snapshot.targets[0]).toMatchObject({
      current: true,
      runtimeKind: "ollama",
      runtimeStatus: "ready",
      installedModels: [
        { id: "qwen3:8b", name: "qwen3:8b", ownedBy: "ollama", running: true },
        { id: "qwen3:4b", name: "qwen3:4b", ownedBy: "ollama" },
      ],
    });
    expect(snapshot.targets[0]?.chatProviderId).toBeUndefined();
    expect(snapshot.dynamicCatalogEntries).toEqual([]);
  });

  it("keeps linked runtimes separated and does not publish non-llama node providers", async () => {
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

    const target = snapshot.targets.find(
      (entry) => entry.deviceId === "remote-1" && entry.runtimeKind === "openai-compatible",
    );
    expect(target).toMatchObject({
      current: false,
      runtimeKind: "openai-compatible",
      runtimeStatus: "ready",
      supportsInstall: false,
      installedModels: [{ id: "gpt-oss-20b", name: "gpt-oss-20b" }],
    });
    expect(target?.chatProviderId).toBeUndefined();
    expect(target?.recommendations).toEqual([]);
    expect(
      snapshot.targets.find(
        (entry) => entry.deviceId === "remote-1" && entry.runtimeKind === "llama.cpp",
      ),
    ).toMatchObject({
      runtimeStatus: "not_configured",
      supportsInstall: true,
    });
    expect(snapshot.dynamicCatalogEntries).toEqual([]);
  });

  it("publishes a ready llama.cpp node as a remote dynamic provider", async () => {
    const node = {
      nodeId: "remote-llama",
      displayName: "Remote Llama",
      platform: "linux",
      capabilities: [
        { id: "model.catalog.llamacpp.v1" },
        { id: "model.chat.llamacpp.v1" },
        { id: "model.manage.llamacpp.v1" },
      ],
    } as NodeSession;

    const snapshot = await loadAlisioModelProviderSnapshot({
      nodeRegistry: createRegistry({
        nodes: [node],
        taskPayloads: {
          "remote-llama:model.catalog.llamacpp.v1": {
            runtimeKind: "llama.cpp",
            runtimeLabel: "Local GGUF",
            status: "ready",
            models: [{ id: "qwen3-4b-q4-k-m", name: "Qwen3 4B", ownedBy: "llama.cpp" }],
            availableModels: [],
            hardware: createHardware(),
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
          },
        },
      }),
      force: true,
    });

    expect(
      snapshot.targets.find(
        (entry) => entry.deviceId === "remote-llama" && entry.runtimeKind === "llama.cpp",
      ),
    ).toMatchObject({
      targetId: "remote-llama::llama.cpp",
      runtimeStatus: "ready",
      chatProviderId: "alisio-target-remote-llama-llama",
      installedModels: [{ id: "qwen3-4b-q4-k-m", name: "Qwen3 4B", ownedBy: "llama.cpp" }],
    });
    expect(snapshot.dynamicCatalogEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "alisio-target-remote-llama-llama",
          id: "qwen3-4b-q4-k-m",
        }),
      ]),
    );
  });

  it("keeps Ollama and LM Studio as linked runtimes without dynamic publication", async () => {
    const node = {
      nodeId: "remote-2",
      displayName: "Remote Studio",
      platform: "darwin",
      capabilities: [
        { id: "model.catalog.ollama.v1" },
        { id: "model.chat.ollama.v1" },
        { id: "model.manage.ollama.v1" },
        { id: "model.catalog.lmstudio.v1" },
        { id: "model.chat.lmstudio.v1" },
      ],
    } as NodeSession;

    const snapshot = await loadAlisioModelProviderSnapshot({
      nodeRegistry: createRegistry({
        nodes: [node],
        taskPayloads: {
          "remote-2:model.catalog.ollama.v1": {
            runtimeKind: "ollama",
            runtimeLabel: "Ollama",
            status: "ready",
            models: [{ id: "qwen3:8b", name: "qwen3:8b", ownedBy: "ollama" }],
            availableModels: [{ id: "qwen3:8b", name: "Qwen3 8B", runtimeKind: "ollama" }],
            hardware: createHardware(),
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
          },
          "remote-2:model.catalog.lmstudio.v1": {
            runtimeKind: "lmstudio",
            runtimeLabel: "LM Studio",
            status: "ready",
            models: [{ id: "gpt-oss-20b", name: "gpt-oss-20b", ownedBy: "lmstudio" }],
            availableModels: [{ id: "gpt-oss-20b", name: "gpt-oss-20b", runtimeKind: "lmstudio" }],
            hardware: createHardware(),
            capabilities: {
              install: false,
              update: false,
              uninstall: false,
              consentRequired: false,
              startServer: true,
            },
            supportsInstall: false,
            supportsUpdate: false,
            supportsUninstall: false,
            consentRequired: false,
          },
        },
      }),
      force: true,
    });

    expect(
      snapshot.targets.find(
        (entry) => entry.deviceId === "remote-2" && entry.runtimeKind === "ollama",
      ),
    ).toMatchObject({
      targetId: "remote-2::ollama",
      runtimeLabel: "Ollama",
      supportsInstall: true,
      installedModels: [{ id: "qwen3:8b", name: "qwen3:8b", ownedBy: "ollama" }],
    });
    expect(
      snapshot.targets.find(
        (entry) => entry.deviceId === "remote-2" && entry.runtimeKind === "ollama",
      )?.chatProviderId,
    ).toBeUndefined();
    expect(
      snapshot.targets.find(
        (entry) => entry.deviceId === "remote-2" && entry.runtimeKind === "lmstudio",
      ),
    ).toMatchObject({
      targetId: "remote-2::lmstudio",
      runtimeLabel: "LM Studio",
      supportsInstall: false,
      capabilities: expect.objectContaining({ startServer: true }),
      installedModels: [{ id: "gpt-oss-20b", name: "gpt-oss-20b", ownedBy: "lmstudio" }],
    });
    expect(
      snapshot.targets.find(
        (entry) => entry.deviceId === "remote-2" && entry.runtimeKind === "lmstudio",
      )?.chatProviderId,
    ).toBeUndefined();
    expect(snapshot.dynamicCatalogEntries).toEqual([]);
  });
});
