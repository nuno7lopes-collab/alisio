import { describe, expect, it, vi } from "vitest";
import { GatewayRequestError } from "../gateway.ts";
import {
  loadMemoryGraph,
  loadMemoryStatus,
  syncMemoryNow,
  type MemoryRuntimeState,
} from "./memory-runtime.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createState(): { state: MemoryRuntimeState; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn();
  const state: MemoryRuntimeState = {
    client: { request } as unknown as MemoryRuntimeState["client"],
    connected: true,
    memorySelectedAgentId: "main",
    memoryStatusLoading: false,
    memoryStatusError: null,
    memoryStatus: null,
    memorySyncing: false,
    memorySyncAvailable: false,
    memoryGraphLoading: false,
    memoryGraphError: null,
    memoryGraph: null,
  };
  return { state, request };
}

describe("memory-runtime controller", () => {
  it("ignores stale status responses after switching agents", async () => {
    const mainStatus = deferred<unknown>();
    const { state, request } = createState();

    request.mockImplementation((method: string, params: { agentId: string }) => {
      if (method === "memory.status" && params.agentId === "main") {
        return mainStatus.promise;
      }
      if (method === "memory.status" && params.agentId === "other") {
        return Promise.resolve({
          agentId: "other",
          enabled: true,
          embedding: { ok: true },
        });
      }
      throw new Error(`unexpected request: ${method} ${params.agentId}`);
    });

    const firstLoad = loadMemoryStatus(state, "main");
    state.memorySelectedAgentId = "other";
    const secondLoad = loadMemoryStatus(state, "other");

    mainStatus.resolve({
      agentId: "main",
      enabled: true,
      embedding: { ok: true },
    });

    await Promise.all([firstLoad, secondLoad]);

    expect(state.memoryStatus).toEqual({
      agentId: "other",
      enabled: true,
      embedding: { ok: true },
    });
    expect(state.memoryStatusError).toBeNull();
    expect(state.memoryStatusLoading).toBe(false);
  });

  it("ignores sync results once the user has moved to another agent", async () => {
    const sync = deferred<unknown>();
    const { state, request } = createState();

    request.mockImplementation((method: string, params: { agentId: string }) => {
      if (method === "memory.sync" && params.agentId === "main") {
        return sync.promise;
      }
      throw new Error(`unexpected request: ${method} ${params.agentId}`);
    });

    const syncRun = syncMemoryNow(state, "main");
    state.memorySelectedAgentId = "other";

    sync.resolve({
      ok: true,
      status: {
        agentId: "main",
        enabled: true,
        embedding: { ok: true },
      },
    });

    await syncRun;

    expect(state.memoryStatus).toBeNull();
    expect(state.memoryStatusError).toBeNull();
    expect(state.memorySyncing).toBe(false);
  });

  it("mostra um erro amigável quando o estado detalhado da memória não está disponível", async () => {
    const { state, request } = createState();

    request.mockImplementation((method: string, params: { agentId?: string }) => {
      if (method === "memory.status" && params.agentId === "main") {
        return Promise.reject(
          new GatewayRequestError({
            code: "INVALID_REQUEST",
            message: "unknown method: memory.status",
          }),
        );
      }
      throw new Error(`unexpected request: ${method}`);
    });

    await loadMemoryStatus(state, "main");

    expect(state.memoryStatus).toBeNull();
    expect(state.memoryStatusError).toContain("estado detalhado");
    expect(state.memorySyncAvailable).toBe(false);
  });

  it("shows a friendly error when manual sync is unavailable on this gateway", async () => {
    const { state, request } = createState();
    state.memorySyncAvailable = true;

    request.mockImplementation((method: string, params: { agentId: string }) => {
      if (method === "memory.sync" && params.agentId === "main") {
        return Promise.reject(
          new GatewayRequestError({
            code: "INVALID_REQUEST",
            message: "unknown method: memory.sync",
          }),
        );
      }
      throw new Error(`unexpected request: ${method} ${params.agentId}`);
    });

    await syncMemoryNow(state, "main");

    expect(state.memoryStatusError).toContain("sincronização manual");
    expect(state.memorySyncAvailable).toBe(false);
  });

  it("loads the canonical memory graph for the selected agent", async () => {
    const { state, request } = createState();

    request.mockImplementation((method: string, params: { agentId: string; query?: string }) => {
      if (method === "memory.graph" && params.agentId === "main") {
        return Promise.resolve({
          query: params.query,
          profileId: "local-main",
          workspaceScope: "scope-main",
          storePath: "/tmp/canonical.sqlite",
          backend: "builtin",
          state: "ready",
          projectionInterface: "markdown-vault",
          syncMode: "local-first",
          cloudSync: "unavailable",
          matches: [],
        });
      }
      throw new Error(`unexpected request: ${method} ${params.agentId}`);
    });

    await loadMemoryGraph(state, { agentId: "main", query: "Project Atlas" });

    expect(state.memoryGraph).toEqual(
      expect.objectContaining({
        query: "Project Atlas",
        profileId: "local-main",
      }),
    );
    expect(state.memoryGraphError).toBeNull();
    expect(state.memoryGraphLoading).toBe(false);
  });
});
