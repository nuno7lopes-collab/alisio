import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedMemorySearchConfig } from "../../agents/memory-search.js";
import type { AlisioConfig } from "../../config/config.js";

const loadConfig = vi.hoisted(() => vi.fn(() => ({}) as AlisioConfig));
const listAgentIds = vi.hoisted(() => vi.fn(() => ["main"]));
const resolveMemorySearchConfig = vi.hoisted(() => vi.fn());
const getActiveMemorySearchManager = vi.hoisted(() => vi.fn());
const resolveActiveMemoryBackendConfig = vi.hoisted(() => vi.fn(() => ({ backend: "builtin" })));

vi.mock("../../config/config.js", () => ({
  loadConfig,
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds,
}));

vi.mock("../../agents/memory-search.js", () => ({
  resolveMemorySearchConfig,
}));

vi.mock("../../plugins/memory-runtime.js", () => ({
  getActiveMemorySearchManager,
  resolveActiveMemoryBackendConfig,
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
    experimental: {
      sessionMemory: false,
    },
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
    context: {} as never,
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
          workspaceDir: "/workspace/main",
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
          obsidianReadOnly: {
            enabled: true,
            active: true,
            vaultPath: "/vaults/research",
            indexedFiles: 24,
            skippedLargeFiles: 2,
            maxFiles: 2000,
            maxFileBytes: 1048576,
          },
          custom: {
            canonicalStore: {
              state: "ready",
              path: "/Users/nuno/.alisio/memory/profiles/local-main/canonical.sqlite",
              profileId: "local-main",
              profileSource: "local-profile",
              workspaceScope: "scope-main",
              workspaceDir: "/workspace/main",
              backend: "builtin",
              entities: 3,
              relations: 2,
              projections: 3,
              projectionInterface: "markdown-vault",
              syncMode: "local-first",
              cloudSync: "unavailable",
              projectionSources: ["workspace-memory"],
              ledgerEventsCount: 12,
              lastSyncedLamport: 12,
              checkpointsCount: 1,
              e2eeRequired: true,
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
          obsidianReadOnly: expect.objectContaining({
            active: true,
            vaultPath: "/vaults/research",
            indexedFiles: 24,
          }),
          canonicalStore: expect.objectContaining({
            profileId: "local-main",
            entities: 3,
            relations: 2,
            syncMode: "local-first",
            ledgerEventsCount: 12,
            lastSyncedLamport: 12,
            checkpointsCount: 1,
            e2eeRequired: true,
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
          workspaceDir: "/workspace/main",
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
