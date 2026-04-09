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
              projectionInterface: "markdown-vault",
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
    expect(respond).toHaveBeenCalledWith(true, { query: "Project Atlas", matches: [] }, undefined);
    expect(close).toHaveBeenCalled();
  });

  it("rejects empty queries", async () => {
    const respond = vi.fn();

    await handleMemoryGraphGatewayRequest({
      req: {} as never,
      params: { agentId: "main", query: "   " },
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
        message: "memory.graph requires query",
      }),
    );
  });
});
