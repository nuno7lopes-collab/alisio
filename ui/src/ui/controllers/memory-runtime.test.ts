import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { GatewayRequestError } from "../gateway.ts";
import {
  loadMemoryGraph,
  loadMemoryStatus,
  requestMemoryExport,
  requestMemoryFile,
  requestMemoryNotesList,
  requestMemoryWikiList,
  requestMemoryWikiPage,
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
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("shows a friendly error when detailed memory status is unavailable", async () => {
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
    expect(state.memoryStatusError).toContain("detailed memory status");
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

    expect(state.memoryStatusError).toContain("manual memory sync");
    expect(state.memorySyncAvailable).toBe(false);
  });

  it("reuses a fresh memory status snapshot unless a forced reload is requested", async () => {
    vi.useFakeTimers();
    const { state, request } = createState();
    request.mockResolvedValue({
      agentId: "main",
      enabled: true,
      embedding: { ok: true },
    });

    await loadMemoryStatus(state, "main");
    await loadMemoryStatus(state, "main");
    await loadMemoryStatus(state, "main", { force: true });

    expect(request).toHaveBeenCalledTimes(2);
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
          projectionInterface: "markdown-repo",
          syncMode: "local-first",
          cloudSync: "unavailable",
          scope: "global",
          mode: "overview",
          nodes: [],
          edges: [],
          branches: [],
          availableRelationTypes: [],
          availableTags: [],
          stats: {
            totalNodes: 0,
            totalEdges: 0,
            visibleNodes: 0,
            visibleEdges: 0,
          },
          truncated: {
            nodes: false,
            edges: false,
          },
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

  it("passes includeAttachments when loading the canonical memory graph", async () => {
    const { state, request } = createState();

    request.mockImplementation((method: string, params: Record<string, unknown>) => {
      if (method === "memory.graph" && params.agentId === "main") {
        return Promise.resolve({
          query: "",
          profileId: "local-main",
          workspaceScope: "scope-main",
          storePath: "/tmp/canonical.sqlite",
          backend: "builtin",
          state: "ready",
          projectionInterface: "markdown-repo",
          syncMode: "local-first",
          cloudSync: "unavailable",
          scope: "global",
          mode: "overview",
          nodes: [],
          edges: [],
          branches: [],
          availableRelationTypes: [],
          availableTags: [],
          stats: {
            totalNodes: 0,
            totalEdges: 0,
            visibleNodes: 0,
            visibleEdges: 0,
          },
          truncated: {
            nodes: false,
            edges: false,
          },
          matches: [],
        });
      }
      throw new Error(`unexpected request: ${method}`);
    });

    await loadMemoryGraph(state, {
      agentId: "main",
      scope: "global",
      includeAttachments: true,
    });

    expect(request).toHaveBeenCalledWith(
      "memory.graph",
      expect.objectContaining({
        agentId: "main",
        includeAttachments: true,
      }),
    );
  });

  it("dedupes concurrent memory notes list requests for the same agent and query", async () => {
    const { request } = createState();
    const pending = deferred<unknown>();

    request.mockImplementation((method: string) => {
      if (method === "memory.notes.list") {
        return pending.promise;
      }
      throw new Error(`unexpected request: ${method}`);
    });

    const client = { request } as unknown as NonNullable<MemoryRuntimeState["client"]>;
    const first = requestMemoryNotesList(client, { agentId: "main", query: "atlas" });
    const second = requestMemoryNotesList(client, { agentId: "main", query: "atlas" });

    pending.resolve({
      agentId: "main",
      notes: [{ id: "atlas", title: "Project Atlas", path: "memory/project-atlas.md" }],
    });

    const [left, right] = await Promise.all([first, second]);

    expect(left).toEqual(right);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("falls back from memory.notes.list to memory.wiki.list during transition", async () => {
    const { request } = createState();

    request.mockImplementation((method: string) => {
      if (method === "memory.notes.list") {
        return Promise.reject(
          new GatewayRequestError({
            code: "INVALID_REQUEST",
            message: "unknown method: memory.notes.list",
          }),
        );
      }
      if (method === "memory.wiki.list") {
        return Promise.resolve({
          agentId: "main",
          pages: [{ id: "atlas", title: "Project Atlas", path: "memory/project-atlas.md" }],
        });
      }
      throw new Error(`unexpected request: ${method}`);
    });

    const result = await requestMemoryNotesList(
      { request } as unknown as Parameters<typeof requestMemoryNotesList>[0],
      { agentId: "main" },
    );

    expect(result.notes.map((note) => note.title)).toEqual(["Project Atlas"]);
    expect(request).toHaveBeenCalledWith("memory.notes.list", { agentId: "main" });
    expect(request).toHaveBeenCalledWith("memory.wiki.list", { agentId: "main" });
  });

  it("retries transient sqlite lock errors before failing a memory request", async () => {
    const { request } = createState();

    request
      .mockRejectedValueOnce(new Error("database is locked: code=ERR_SQLITE_ERROR"))
      .mockResolvedValueOnce({
        agentId: "main",
        notes: [{ id: "atlas", title: "Project Atlas", path: "memory/project-atlas.md" }],
      });

    const result = await requestMemoryNotesList(
      { request } as unknown as Parameters<typeof requestMemoryNotesList>[0],
      { agentId: "main" },
    );

    expect(result.notes.map((note) => note.id)).toEqual(["atlas"]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("surfaces a friendly native-wiki message when memory.wiki.list is unavailable", async () => {
    const { request } = createState();

    request.mockImplementation((method: string) => {
      if (method === "memory.wiki.list") {
        return Promise.reject(
          new GatewayRequestError({
            code: "INVALID_REQUEST",
            message: "unknown method: memory.wiki.list",
          }),
        );
      }
      throw new Error(`unexpected request: ${method}`);
    });

    await expect(
      requestMemoryWikiList({ request } as unknown as Parameters<typeof requestMemoryWikiList>[0], {
        agentId: "main",
      }),
    ).rejects.toThrow("native memory wiki");
  });

  it("requests memory export with the selected format", async () => {
    const { request } = createState();

    request.mockImplementation((method: string, params: { agentId: string; format: string }) => {
      if (method === "memory.export") {
        return Promise.resolve({
          format: params.format,
          fileName: "memory.json",
          content: '{"ok":true}',
        });
      }
      throw new Error(`unexpected request: ${method}`);
    });

    const result = await requestMemoryExport(
      { request } as unknown as Parameters<typeof requestMemoryExport>[0],
      { agentId: "main", format: "json" },
    );

    expect(result).toEqual(
      expect.objectContaining({
        format: "json",
        fileName: "memory.json",
      }),
    );
    expect(request).toHaveBeenCalledWith("memory.export", {
      agentId: "main",
      format: "json",
    });
  });

  it("passes the active query when requesting a wiki page", async () => {
    const { request } = createState();

    request.mockResolvedValue({
      agentId: "main",
      page: {
        id: "atlas",
        title: "Project Atlas",
        content: "# Project Atlas",
      },
    });

    await requestMemoryWikiPage(
      { request } as unknown as Parameters<typeof requestMemoryWikiPage>[0],
      { agentId: "main", pageId: "atlas", query: "atlas" },
    );

    expect(request).toHaveBeenCalledWith("memory.wiki.get", {
      agentId: "main",
      pageId: "atlas",
      query: "atlas",
    });
  });

  it("passes the active query when requesting a file detail", async () => {
    const { request } = createState();

    request.mockResolvedValue({
      agentId: "main",
      file: {
        id: "brief",
        name: "product-brief.pdf",
      },
    });

    await requestMemoryFile({ request } as unknown as Parameters<typeof requestMemoryFile>[0], {
      agentId: "main",
      fileId: "brief",
      query: "pdf",
    });

    expect(request).toHaveBeenCalledWith("memory.files.get", {
      agentId: "main",
      fileId: "brief",
      query: "pdf",
    });
  });
});
