import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRegistry, NodeSession } from "../gateway/node-registry.js";

type SharingTargetAccessMock = {
  targetId: string;
  label: string;
  sourceKind: string;
  connected: boolean;
  current: boolean;
  ownerKey: string;
  ownerScope: string;
  ownerLabel: string;
  registeredAt: string;
  updatedAt: string;
  deviceAccess: string;
  modelAccess: string;
  grantId?: string;
};

const {
  inspectManagedLocalModelRuntimeMock,
  getAlisioSharingTargetAccessIndexMock,
} = vi.hoisted(() => ({
  inspectManagedLocalModelRuntimeMock: vi.fn(),
  getAlisioSharingTargetAccessIndexMock: vi.fn(
    async (
      input?: { targets?: Array<{ targetId: string }> },
    ): Promise<Record<string, SharingTargetAccessMock>> =>
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
      },
      supportsInstall: true,
      supportsUpdate: true,
      supportsUninstall: true,
      consentRequired: true,
    });
  });

  it("keeps the current llama.cpp target visible when no local model is installed yet", async () => {
    const snapshot = await loadAlisioModelProviderSnapshot({
      nodeRegistry: createRegistry(),
      force: true,
    });

    expect(snapshot.targets).toHaveLength(1);
    expect(snapshot.targets[0]).toMatchObject({
      current: true,
      runtimeKind: "llama.cpp",
      runtimeStatus: "not_configured",
      connected: true,
    });
    expect(snapshot.dynamicCatalogEntries).toEqual([]);
  });

  it("publishes the current llama.cpp runtime as a local dynamic provider when models are installed", async () => {
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

  it("downgrades shared targets to read-only management even when llama.cpp is available", async () => {
    getAlisioSharingTargetAccessIndexMock.mockResolvedValueOnce({
      current: {
        targetId: "current",
        label: "current",
        sourceKind: "current",
        connected: true,
        current: true,
        ownerKey: "user:user-2",
        ownerScope: "user",
        ownerLabel: "Shared owner",
        registeredAt: "2026-04-08T10:00:00.000Z",
        updatedAt: "2026-04-08T10:00:00.000Z",
        deviceAccess: "shared",
        modelAccess: "shared",
        grantId: "grant-1",
      },
    });

    const snapshot = await loadAlisioModelProviderSnapshot({
      nodeRegistry: createRegistry(),
      force: true,
    });

    expect(snapshot.targets[0]).toMatchObject({
      access: "shared",
      supportsInstall: false,
      supportsUpdate: false,
      supportsUninstall: false,
      grantId: "grant-1",
    });
    expect(snapshot.targets[0]?.capabilities).toMatchObject({
      install: false,
      update: false,
      uninstall: false,
      consentRequired: true,
    });
  });

  it("keeps the current local provider available when sharing access lookup fails", async () => {
    inspectManagedLocalModelRuntimeMock.mockResolvedValueOnce({
      backend: "llama.cpp",
      runtimeKind: "llama.cpp",
      runtimeLabel: "Local GGUF",
      status: "ready",
      models: [{ id: "qwen3-4b-q4-k-m", name: "Qwen3 4B", ownedBy: "llama.cpp", running: true }],
      availableModels: [],
      hardware: createHardware(),
      capabilities: {
        install: true,
        update: true,
        uninstall: true,
        consentRequired: true,
      },
      supportsInstall: true,
      supportsUpdate: true,
      supportsUninstall: true,
      consentRequired: true,
    });
    getAlisioSharingTargetAccessIndexMock.mockRejectedValueOnce(
      new Error("Could not find the 'computer_id' column of 'alisio_sharing_targets' in the schema cache"),
    );

    const snapshot = await loadAlisioModelProviderSnapshot({
      nodeRegistry: createRegistry(),
      force: true,
    });

    expect(snapshot.targets[0]).toMatchObject({
      current: true,
      runtimeStatus: "ready",
      access: "owner",
      chatProviderId: "alisio-local-current-llama",
      installedModels: [
        { id: "qwen3-4b-q4-k-m", name: "Qwen3 4B", ownedBy: "llama.cpp", running: true },
      ],
    });
    expect(snapshot.dynamicCatalogEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "alisio-local-current-llama",
          id: "qwen3-4b-q4-k-m",
        }),
      ]),
    );
  });

  it("fails closed for remote targets when sharing access lookup fails", async () => {
    inspectManagedLocalModelRuntimeMock.mockResolvedValueOnce({
      backend: "llama.cpp",
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
      },
      supportsInstall: true,
      supportsUpdate: true,
      supportsUninstall: true,
      consentRequired: true,
    });
    getAlisioSharingTargetAccessIndexMock.mockRejectedValueOnce(
      new Error("Could not find the 'computer_id' column of 'alisio_sharing_targets' in the schema cache"),
    );

    const remoteNode = {
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
        nodes: [remoteNode],
        taskPayloads: {
          "remote-llama:model.catalog.llamacpp.v1": {
            runtimeKind: "llama.cpp",
            runtimeLabel: "Local GGUF",
            status: "ready",
            models: [{ id: "qwen3-8b-q4-k-m", name: "Qwen3 8B", ownedBy: "llama.cpp" }],
            availableModels: [],
            hardware: createHardware(),
            capabilities: {
              install: true,
              update: true,
              uninstall: true,
              consentRequired: true,
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

    expect(snapshot.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          current: true,
          chatProviderId: "alisio-local-current-llama",
        }),
      ]),
    );
    expect(snapshot.targets.some((target) => target.deviceId === "remote-llama")).toBe(false);
    expect(
      snapshot.dynamicCatalogEntries.some((entry) => entry.provider === "alisio-target-remote-llama-llama"),
    ).toBe(false);
  });
});
