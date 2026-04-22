import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedMemorySearchConfig } from "../../agents/memory-search.js";
import type { AlisioConfig } from "../../config/config.js";

const loadConfig = vi.hoisted(() => vi.fn(() => ({}) as AlisioConfig));
const listAgentIds = vi.hoisted(() => vi.fn(() => ["main"]));
const resolveMemorySearchConfig = vi.hoisted(() => vi.fn());
const getActiveMemorySearchManager = vi.hoisted(() => vi.fn());
const resolveActiveMemoryBackendConfig = vi.hoisted(() => vi.fn(() => ({ backend: "builtin" })));
const resolveStateDir = vi.hoisted(() => vi.fn(() => "/tmp/state"));
const resolveAlisioMemoryOwnerProfile = vi.hoisted(() =>
  vi.fn(() => ({
    profileId: "local-nuno",
    source: "local-profile",
  })),
);
const setupProfileRootKey = vi.hoisted(() => vi.fn());
const loadProfileRootKey = vi.hoisted(() => vi.fn());
const exportPairingCode = vi.hoisted(() => vi.fn());
const importProfileKeyFromPairingCode = vi.hoisted(() => vi.fn());
const storeProfileRootKey = vi.hoisted(() => vi.fn());
const logGatewayInfo = vi.hoisted(() => vi.fn());
const loadAlisioGatewayAccountContext = vi.hoisted(() =>
  vi.fn(async () => ({
    account: {},
    canonical: {
      scopeRoot: "account",
      accountId: "user-1",
      source: "account_id",
      authenticated: true,
      authRequired: true,
    },
    currentDevice: {
      id: "device-1",
      label: "Mac",
      platform: "macos",
      current: true,
    },
    deviceBinding: {
      binding: "account_bound",
      runtime: "local",
      current: true,
      accountId: "user-1",
      deviceId: "device-1",
      label: "Mac",
      platform: "macos",
    },
    runtimeContract: {
      scopeRoot: "account",
      backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
      localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
    },
  })),
);
const readPersonalContextSummary = vi.hoisted(() =>
  vi.fn(async () => ({
    version: 1,
    bootstrap: {
      path: "BOOTSTRAP.md",
      present: false,
      availability: "setup_only",
      state: "completed",
      oneTime: true,
    },
    identity: {
      path: "IDENTITY.md",
      present: true,
      availability: "all_sessions",
      resolved: {
        name: "Nuno",
        avatar: "N",
      },
      sources: {
        name: "identity-file",
      },
    },
    soul: {
      path: "SOUL.md",
      present: true,
      availability: "all_sessions",
    },
    preferences: {
      path: "USER.md",
      present: true,
      availability: "all_sessions",
    },
    memory: {
      main: {
        path: "MEMORY.md",
        present: true,
        availability: "private_direct_sessions",
      },
      operational: {
        root: "memory",
        backlogRoot: "memory/backlog",
        availability: "retrieval_only",
        topicCount: 1,
        dailyCount: 2,
        backlogCount: 3,
      },
    },
    sessionPolicy: {
      main: {
        kind: "main",
        role: "default_personal_session",
        key: "agent:main:main",
        inherits: ["identity", "soul", "preferences", "main_memory"],
      },
      direct: {
        kind: "direct",
        role: "private_direct_session",
        inherits: ["identity", "soul", "preferences", "main_memory"],
      },
      group: {
        kind: "group",
        role: "shared_session",
        inherits: ["identity", "soul", "preferences"],
      },
      subagent: {
        kind: "subagent",
        role: "delegated_session",
        inherits: ["identity", "soul", "preferences"],
      },
      cron: {
        kind: "cron",
        role: "automation_session",
        inherits: ["identity", "soul", "preferences"],
      },
    },
  })),
);

vi.mock("../../config/config.js", () => ({
  loadConfig,
}));

vi.mock("../../config/paths.js", () => ({
  resolveStateDir,
}));

vi.mock("../../infra/alisio-memory-profile.js", () => ({
  resolveAlisioMemoryOwnerProfile,
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds,
  resolveAgentWorkspaceDir: () => "/workspace/main",
  resolveDefaultAgentId: () => "main",
}));

vi.mock("../../agents/memory-search.js", () => ({
  resolveMemorySearchConfig,
}));

vi.mock("../../plugins/memory-runtime.js", () => ({
  getActiveMemorySearchManager,
  resolveActiveMemoryBackendConfig,
}));

vi.mock("../../memory/personal-context.js", () => ({
  readPersonalContextSummary,
}));

vi.mock("../alisio-account-context.js", async () => {
  const actual = await vi.importActual<typeof import("../alisio-account-context.js")>(
    "../alisio-account-context.js",
  );
  return {
    ...actual,
    loadAlisioGatewayAccountContext,
  };
});

vi.mock("../../../packages/memory-crypto/src/index.js", () => ({
  exportPairingCode,
  importProfileKeyFromPairingCode,
  loadProfileRootKey,
  setupProfileRootKey,
  storeProfileRootKey,
}));

import { memoryHandlers } from "./memory.js";

function createResolvedMemoryConfig(
  overrides: Partial<ResolvedMemorySearchConfig> = {},
): ResolvedMemorySearchConfig {
  return {
    enabled: true,
    sources: ["memory"],
    extraPaths: [],
    multimodal: { enabled: false, modalities: [], maxFileBytes: 0 },
    provider: "openai",
    fallback: "none",
    model: "text-embedding-3-small",
    local: {},
    store: {
      driver: "sqlite",
      path: "/tmp/memory.sqlite",
      fts: {
        tokenizer: "unicode61",
      },
      vector: {
        enabled: true,
      },
    },
    chunking: {
      tokens: 400,
      overlap: 80,
    },
    sync: {
      onSessionStart: true,
      onSearch: true,
      watch: true,
      watchDebounceMs: 1500,
      intervalMinutes: 0,
      sessions: {
        deltaBytes: 100_000,
        deltaMessages: 50,
        postCompactionForce: true,
      },
    },
    query: {
      maxResults: 6,
      minScore: 0.35,
      hybrid: {
        enabled: true,
        vectorWeight: 0.7,
        textWeight: 0.3,
        candidateMultiplier: 4,
        mmr: {
          enabled: false,
          lambda: 0.7,
        },
        temporalDecay: {
          enabled: false,
          halfLifeDays: 30,
        },
      },
    },
    cache: {
      enabled: true,
    },
    ...overrides,
  };
}

async function invokeMemoryMethod(
  method: keyof typeof memoryHandlers,
  params: Record<string, unknown>,
  respond = vi.fn(),
) {
  await memoryHandlers[method]({
    req: {} as never,
    params: params as never,
    respond: respond as never,
    context: {
      logGateway: {
        info: logGatewayInfo,
      },
    } as never,
    client: null,
    isWebchatConnect: () => false,
  });
  return respond;
}

describe("memoryHandlers", () => {
  beforeEach(() => {
    loadConfig.mockClear();
    listAgentIds.mockReset().mockReturnValue(["main"]);
    resolveMemorySearchConfig.mockReset().mockReturnValue(createResolvedMemoryConfig());
    getActiveMemorySearchManager.mockReset();
    resolveActiveMemoryBackendConfig.mockReset().mockReturnValue({ backend: "builtin" });
    resolveStateDir.mockReset().mockReturnValue("/tmp/state");
    resolveAlisioMemoryOwnerProfile.mockReset().mockReturnValue({
      profileId: "local-nuno",
      source: "local-profile",
    });
    setupProfileRootKey.mockReset();
    loadProfileRootKey.mockReset();
    exportPairingCode.mockReset();
    importProfileKeyFromPairingCode.mockReset();
    storeProfileRootKey.mockReset();
    logGatewayInfo.mockReset();
    loadAlisioGatewayAccountContext.mockReset();
    loadAlisioGatewayAccountContext.mockResolvedValue({
      account: {},
      canonical: {
        scopeRoot: "account",
        accountId: "user-1",
        source: "account_id",
        authenticated: true,
        authRequired: true,
      },
      currentDevice: {
        id: "device-1",
        label: "Mac",
        platform: "macos",
        current: true,
      },
      deviceBinding: {
        binding: "account_bound",
        runtime: "local",
        current: true,
        accountId: "user-1",
        deviceId: "device-1",
        label: "Mac",
        platform: "macos",
      },
      runtimeContract: {
        scopeRoot: "account",
        backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
        localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
      },
    });
    readPersonalContextSummary.mockReset();
    readPersonalContextSummary.mockResolvedValue({
      version: 1,
      bootstrap: {
        path: "BOOTSTRAP.md",
        present: false,
        availability: "setup_only",
        state: "completed",
        oneTime: true,
      },
      identity: {
        path: "IDENTITY.md",
        present: true,
        availability: "all_sessions",
        resolved: {
          name: "Nuno",
          avatar: "N",
        },
        sources: {
          name: "identity-file",
        },
      },
      soul: {
        path: "SOUL.md",
        present: true,
        availability: "all_sessions",
      },
      preferences: {
        path: "USER.md",
        present: true,
        availability: "all_sessions",
      },
      memory: {
        main: {
          path: "MEMORY.md",
          present: true,
          availability: "private_direct_sessions",
        },
        operational: {
          root: "memory",
          backlogRoot: "memory/backlog",
          availability: "retrieval_only",
          topicCount: 1,
          dailyCount: 2,
          backlogCount: 3,
        },
      },
      sessionPolicy: {
        main: {
          kind: "main",
          role: "default_personal_session",
          key: "agent:main:main",
          inherits: ["identity", "soul", "preferences", "main_memory"],
        },
        direct: {
          kind: "direct",
          role: "private_direct_session",
          inherits: ["identity", "soul", "preferences", "main_memory"],
        },
        group: {
          kind: "group",
          role: "shared_session",
          inherits: ["identity", "soul", "preferences"],
        },
        subagent: {
          kind: "subagent",
          role: "delegated_session",
          inherits: ["identity", "soul", "preferences"],
        },
        cron: {
          kind: "cron",
          role: "automation_session",
          inherits: ["identity", "soul", "preferences"],
        },
      },
    });
  });

  it("returns detailed status for the requested agent", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const probeEmbeddingAvailability = vi.fn().mockResolvedValue({ ok: true });
    const probeVectorAvailability = vi.fn().mockResolvedValue(true);

    getActiveMemorySearchManager.mockResolvedValue({
      manager: {
        status: () => ({
          backend: "builtin",
          provider: "openai",
          model: "text-embedding-3-small",
          requestedProvider: "openai",
          files: 3,
          chunks: 11,
          dirty: false,
          workspaceDir: "/workspace/main/accounts/user-1",
          dbPath: "/tmp/memory.sqlite",
          sourceCounts: [
            { source: "memory", files: 2, chunks: 8 },
            { source: "sessions", files: 1, chunks: 3 },
          ],
          cache: {
            enabled: true,
            entries: 4,
            maxEntries: 64,
          },
          fts: {
            enabled: true,
            available: true,
          },
          vector: {
            enabled: true,
          },
          batch: {
            enabled: false,
            failures: 0,
            limit: 0,
            wait: false,
            concurrency: 1,
            pollIntervalMs: 0,
            timeoutMs: 0,
          },
          custom: {
            canonicalStore: {
              state: "ready",
              path: "/Users/nuno/.alisio/memory/profiles/local-main/canonical.sqlite",
              profileId: "local-main",
              profileSource: "local-profile",
              workspaceScope: "scope-main",
              workspaceDir: "/workspace/main/accounts/user-1",
              backend: "builtin",
              entities: 3,
              relations: 2,
              projections: 3,
              projectionInterface: "markdown-repo",
              syncMode: "local-first",
              cloudSync: "unavailable",
              projectionSources: ["workspace-memory"],
              ledgerEventsCount: 12,
              lastSyncedLamport: 12,
              checkpointsCount: 1,
              e2eeRequired: true,
              syncAvailability: "active",
              syncModeConfigured: "cloud",
              lastSyncSuccessAt: "2026-04-08T10:01:00.000Z",
              lastAckLamport: 12,
              pendingBacklog: 0,
              lastSyncedAt: "2026-04-08T10:00:00.000Z",
              replica: {
                deviceId: "device-main",
                stateDir: "/Users/nuno/.alisio",
              },
            },
          },
        }),
        probeEmbeddingAvailability,
        probeVectorAvailability,
        close,
      },
    });

    const respond = await invokeMemoryMethod("memory.status", { agentId: "main" });

    expect(getActiveMemorySearchManager).toHaveBeenCalledWith({
      cfg: expect.any(Object),
      agentId: "main",
      purpose: "status",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        agentId: "main",
        enabled: true,
        personalContext: expect.objectContaining({
          bootstrap: expect.objectContaining({
            state: "completed",
          }),
          memory: expect.objectContaining({
            operational: expect.objectContaining({
              backlogCount: 3,
            }),
          }),
        }),
        backend: { backend: "builtin" },
        config: expect.objectContaining({
          provider: "openai",
          model: "text-embedding-3-small",
          fallback: "none",
        }),
        runtime: expect.objectContaining({
          provider: "openai",
          files: 3,
          chunks: 11,
          canonicalStore: expect.objectContaining({
            profileId: "local-main",
            entities: 3,
            relations: 2,
            syncMode: "local-first",
            ledgerEventsCount: 12,
            lastSyncedLamport: 12,
            checkpointsCount: 1,
            e2eeRequired: true,
            syncAvailability: "active",
            syncModeConfigured: "cloud",
            lastAckLamport: 12,
            pendingBacklog: 0,
          }),
          vector: expect.objectContaining({
            enabled: true,
            available: true,
          }),
        }),
        embedding: { ok: true },
      }),
      undefined,
    );
    expect(probeVectorAvailability).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("returns a disabled payload without querying the runtime", async () => {
    resolveMemorySearchConfig.mockReturnValue(null);

    const respond = await invokeMemoryMethod("memory.status", { agentId: "main" });

    expect(getActiveMemorySearchManager).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        agentId: "main",
        enabled: false,
        embedding: {
          ok: false,
          error: "memory disabled",
        },
      }),
      undefined,
    );
  });

  it("rejects signed-out callers before reading memory state", async () => {
    loadAlisioGatewayAccountContext.mockResolvedValueOnce({
      account: {},
      canonical: {
        scopeRoot: "account",
        accountId: "user-1",
        source: "missing",
        authenticated: false,
        authRequired: true,
      },
      currentDevice: {
        id: "device-1",
        label: "Mac",
        platform: "macos",
        current: true,
      },
      deviceBinding: {
        binding: "auth_required",
        runtime: "local",
        current: true,
        accountId: "user-1",
        deviceId: "device-1",
        label: "Mac",
        platform: "macos",
      },
      runtimeContract: {
        scopeRoot: "account",
        backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
        localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
      },
    });

    const respond = await invokeMemoryMethod("memory.status", { agentId: "main" });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "Alisio account sign-in required before using the app.",
      }),
    );
    expect(readPersonalContextSummary).not.toHaveBeenCalled();
  });

  it("runs a forced sync and returns refreshed status", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const sync = vi.fn().mockResolvedValue(undefined);

    getActiveMemorySearchManager.mockResolvedValue({
      manager: {
        sync,
        status: () => ({
          backend: "builtin",
          provider: "openai",
          files: 5,
          chunks: 22,
          dirty: false,
          workspaceDir: "/workspace/main/accounts/user-1",
          dbPath: "/tmp/memory.sqlite",
          vector: {
            enabled: true,
            available: true,
          },
          batch: {
            enabled: false,
            failures: 0,
            limit: 0,
            wait: false,
            concurrency: 1,
            pollIntervalMs: 0,
            timeoutMs: 0,
          },
        }),
        probeEmbeddingAvailability: vi.fn().mockResolvedValue({ ok: true }),
        probeVectorAvailability: vi.fn().mockResolvedValue(true),
        close,
      },
    });

    const respond = await invokeMemoryMethod("memory.sync", { agentId: "main" });

    expect(sync).toHaveBeenCalledWith({
      reason: "gateway",
      force: true,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        status: expect.objectContaining({
          agentId: "main",
          enabled: true,
          runtime: expect.objectContaining({
            files: 5,
            chunks: 22,
          }),
        }),
      }),
      undefined,
    );
    expect(close).toHaveBeenCalled();
  });

  it("sets up a local E2EE profile key and logs the outcome", async () => {
    setupProfileRootKey.mockResolvedValue({
      profileId: "local-nuno",
      profileRootKey: new Uint8Array([1, 2, 3]),
      action: "created",
      storedIn: "file",
      path: "/tmp/state/memory/e2ee/local-nuno/profile-root-key.json",
    });

    const respond = await invokeMemoryMethod("memory.e2ee.setup", {
      agentId: "main",
      passphrase: "setup passphrase",
    });

    expect(setupProfileRootKey).toHaveBeenCalledWith({
      profileId: "local-nuno",
      passphrase: "setup passphrase",
      stateDir: "/tmp/state",
      env: process.env,
    });
    expect(logGatewayInfo).toHaveBeenCalledWith(
      "memory e2ee event",
      expect.objectContaining({
        event: "key_created",
        agentId: "main",
        profileId: "local-nuno",
        storedIn: "file",
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        ok: true,
        profileId: "local-nuno",
        action: "created",
        storedIn: "file",
        path: "/tmp/state/memory/e2ee/local-nuno/profile-root-key.json",
      },
      undefined,
    );
  });

  it("exports a pairing code only after a local key exists", async () => {
    loadProfileRootKey.mockResolvedValue(new Uint8Array([7, 8, 9]));
    exportPairingCode.mockResolvedValue("PAIRING-CODE-123");

    const respond = await invokeMemoryMethod("memory.e2ee.exportPairingCode", {
      agentId: "main",
      passphrase: "pairing passphrase",
      sourceDeviceId: "device-main",
    });

    expect(loadProfileRootKey).toHaveBeenCalledWith({
      profileId: "local-nuno",
      stateDir: "/tmp/state",
      env: process.env,
    });
    expect(exportPairingCode).toHaveBeenCalledWith({
      profileId: "local-nuno",
      passphrase: "pairing passphrase",
      profileRootKey: new Uint8Array([7, 8, 9]),
      sourceDeviceId: "device-main",
      createdAt: expect.any(String),
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        profileId: "local-nuno",
        pairingCode: "PAIRING-CODE-123",
        sourceDeviceId: "device-main",
      }),
      undefined,
    );
    expect(logGatewayInfo).toHaveBeenCalledWith(
      "memory e2ee event",
      expect.objectContaining({
        event: "pairing_exported",
        agentId: "main",
        profileId: "local-nuno",
        sourceDeviceId: "device-main",
      }),
    );
  });

  it("imports a matching pairing code into local storage", async () => {
    importProfileKeyFromPairingCode.mockResolvedValue({
      profileId: "local-nuno",
      profileRootKey: new Uint8Array([4, 5, 6]),
      cached: "passphrase-only",
      createdAt: "2026-04-13T12:00:00.000Z",
      sourceDeviceId: "device-a",
    });
    storeProfileRootKey.mockResolvedValue({
      path: "/tmp/state/memory/e2ee/local-nuno/profile-root-key.json",
      status: "file",
      deviceKeyStoredIn: "file",
    });

    const respond = await invokeMemoryMethod("memory.e2ee.importPairingCode", {
      agentId: "main",
      pairingCode: "PAIRING-CODE-123",
      passphrase: "pairing passphrase",
    });

    expect(importProfileKeyFromPairingCode).toHaveBeenCalledWith({
      pairingCode: "PAIRING-CODE-123",
      passphrase: "pairing passphrase",
      cache: false,
      stateDir: "/tmp/state",
      env: process.env,
    });
    expect(storeProfileRootKey).toHaveBeenCalledWith({
      profileId: "local-nuno",
      profileRootKey: new Uint8Array([4, 5, 6]),
      stateDir: "/tmp/state",
      env: process.env,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        ok: true,
        profileId: "local-nuno",
        cached: "file",
        createdAt: "2026-04-13T12:00:00.000Z",
        sourceDeviceId: "device-a",
      },
      undefined,
    );
    expect(logGatewayInfo).toHaveBeenCalledWith(
      "memory e2ee event",
      expect.objectContaining({
        event: "pairing_imported",
        agentId: "main",
        profileId: "local-nuno",
        cached: "file",
        sourceDeviceId: "device-a",
      }),
    );
  });

  it("rejects pairing imports that target a different profile", async () => {
    importProfileKeyFromPairingCode.mockResolvedValue({
      profileId: "local-other",
      profileRootKey: new Uint8Array([4, 5, 6]),
      cached: "passphrase-only",
      createdAt: "2026-04-13T12:00:00.000Z",
    });

    const respond = await invokeMemoryMethod("memory.e2ee.importPairingCode", {
      agentId: "main",
      pairingCode: "PAIRING-CODE-123",
      passphrase: "pairing passphrase",
    });

    expect(storeProfileRootKey).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "memory pairing code targets local-other, expected local-nuno",
      }),
    );
  });

  it("rejects manual sync when the backend has no sync implementation", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    getActiveMemorySearchManager.mockResolvedValue({
      manager: {
        status: () => ({
          backend: "builtin",
          provider: "openai",
        }),
        probeEmbeddingAvailability: vi.fn().mockResolvedValue({ ok: true }),
        probeVectorAvailability: vi.fn().mockResolvedValue(true),
        close,
      },
    });

    const respond = await invokeMemoryMethod("memory.sync", { agentId: "main" });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "memory backend does not support manual sync",
      }),
    );
    expect(close).toHaveBeenCalled();
  });
});
