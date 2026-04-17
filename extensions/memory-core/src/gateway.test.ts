import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfig = vi.hoisted(() => vi.fn(() => ({ agents: { defaults: {} } })));
const getMemorySearchManager = vi.hoisted(() => vi.fn());
const queryCanonicalMemoryGraph = vi.hoisted(() => vi.fn());

vi.mock("alisio/plugin-sdk/memory-core-host-runtime-core", () => ({
  loadConfig,
}));

vi.mock("./memory/index.js", () => ({
  getMemorySearchManager,
}));

vi.mock("./memory/canonical-store.js", () => ({
  queryCanonicalMemoryGraph,
}));

import { handleMemoryGraphGatewayRequest } from "./gateway.js";

describe("memory graph gateway handler", () => {
  beforeEach(() => {
    loadConfig.mockClear();
    getMemorySearchManager.mockReset();
    queryCanonicalMemoryGraph.mockReset();
  });

  it("returns canonical graph results from the active memory runtime", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    getMemorySearchManager.mockResolvedValue({
      manager: {
        status: () => ({
          custom: {
            canonicalStore: {
              state: "ready",
              path: "/tmp/canonical.sqlite",
              profileId: "local-main",
              workspaceScope: "scope-main",
              backend: "builtin",
              projectionInterface: "markdown-repo",
              syncMode: "local-first",
              cloudSync: "unavailable",
            },
          },
        }),
        close,
      },
    });
    queryCanonicalMemoryGraph.mockReturnValue({
      query: "Project Atlas",
      profileId: "local-main",
      workspaceScope: "scope-main",
      storePath: "/tmp/canonical.sqlite",
      backend: "builtin",
      state: "ready",
      projectionInterface: "markdown-repo",
      syncMode: "local-first",
      cloudSync: "unavailable",
      lastSyncedLamport: 5,
      e2eeRequired: true,
      scope: "local",
      mode: "focus",
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
    const respond = vi.fn();

    await handleMemoryGraphGatewayRequest({
      req: {} as never,
      params: {
        agentId: "main",
        query: "Project Atlas",
        direction: "both",
        matchLimit: 4,
        relationLimit: 6,
      },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(getMemorySearchManager).toHaveBeenCalledWith({
      cfg: { agents: { defaults: {} } },
      agentId: "main",
      purpose: "status",
    });
    expect(queryCanonicalMemoryGraph).toHaveBeenCalledWith({
      status: expect.objectContaining({
        profileId: "local-main",
      }),
      query: "Project Atlas",
      direction: "both",
      matchLimit: 4,
      relationLimit: 6,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        query: "Project Atlas",
        scope: "local",
        matches: [],
      }),
      undefined,
    );
    expect(close).toHaveBeenCalled();
  });

  it("supports overview graph requests without a search query", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    getMemorySearchManager.mockResolvedValue({
      manager: {
        status: () => ({
          custom: {
            canonicalStore: {
              state: "ready",
              path: "/tmp/canonical.sqlite",
              profileId: "local-main",
              workspaceScope: "scope-main",
              backend: "builtin",
              projectionInterface: "markdown-repo",
              syncMode: "local-first",
              cloudSync: "unavailable",
            },
          },
        }),
        close,
      },
    });
    queryCanonicalMemoryGraph.mockReturnValue({
      query: "",
      profileId: "local-main",
      workspaceScope: "scope-main",
      storePath: "/tmp/canonical.sqlite",
      backend: "builtin",
      state: "ready",
      projectionInterface: "markdown-repo",
      syncMode: "local-first",
      cloudSync: "unavailable",
      lastSyncedLamport: 5,
      e2eeRequired: true,
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
    const respond = vi.fn();

    await handleMemoryGraphGatewayRequest({
      req: {} as never,
      params: {
        agentId: "main",
        scope: "overview",
        nodeLimit: 32,
        includeAttachments: true,
      },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(queryCanonicalMemoryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "global",
        nodeLimit: 32,
        includeAttachments: true,
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        scope: "global",
        mode: "overview",
      }),
      undefined,
    );
  });

  it("syncs dirty graph requests before querying the canonical store", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    let dirty = true;
    const sync = vi.fn().mockImplementation(async () => {
      dirty = false;
    });
    getMemorySearchManager.mockResolvedValue({
      manager: {
        status: () => ({
          dirty,
          custom: {
            canonicalStore: {
              state: dirty ? "pending-sync" : "ready",
              path: "/tmp/canonical.sqlite",
              profileId: "local-main",
              workspaceScope: "scope-main",
              backend: "builtin",
              projectionInterface: "markdown-repo",
              syncMode: "local-first",
              cloudSync: "unavailable",
            },
          },
        }),
        sync,
        close,
      },
    });
    queryCanonicalMemoryGraph.mockReturnValue({
      query: "atlas",
      profileId: "local-main",
      workspaceScope: "scope-main",
      storePath: "/tmp/canonical.sqlite",
      backend: "builtin",
      state: "ready",
      projectionInterface: "markdown-repo",
      syncMode: "local-first",
      cloudSync: "unavailable",
      lastSyncedLamport: 5,
      e2eeRequired: true,
      scope: "local",
      mode: "focus",
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
    const respond = vi.fn();

    await handleMemoryGraphGatewayRequest({
      req: {} as never,
      params: { agentId: "main", query: "atlas" },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(sync).toHaveBeenCalledWith({ reason: "memory.graph", force: true });
    expect(queryCanonicalMemoryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        status: expect.objectContaining({ state: "ready" }),
      }),
    );
    expect(close).toHaveBeenCalled();
  });

  it("rejects empty focus-scope requests without a focus hint", async () => {
    const respond = vi.fn();

    await handleMemoryGraphGatewayRequest({
      req: {} as never,
      params: { agentId: "main", query: "   ", scope: "local" },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(getMemorySearchManager).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "memory.graph focus scope requires pageId, entityId, or query",
      }),
    );
  });

  it("rejects invalid scope values", async () => {
    const respond = vi.fn();

    await handleMemoryGraphGatewayRequest({
      req: {} as never,
      params: { agentId: "main", scope: "sideways" },
      client: null,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });

    expect(getMemorySearchManager).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "memory.graph scope must be overview, focus, global, or local",
      }),
    );
  });
});
