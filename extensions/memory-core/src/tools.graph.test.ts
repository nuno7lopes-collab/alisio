import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetMemoryToolMockState,
  setCanonicalStoreStatus,
} from "../../../test/helpers/memory-tool-manager-mock.js";

const queryCanonicalMemoryGraph = vi.hoisted(() => vi.fn());

vi.mock("./memory/canonical-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./memory/canonical-store.js")>();
  return {
    ...actual,
    queryCanonicalMemoryGraph,
  };
});

import { createMemoryGraphToolOrThrow } from "./tools.test-helpers.js";

describe("memory_graph tool", () => {
  beforeEach(() => {
    queryCanonicalMemoryGraph.mockReset();
    resetMemoryToolMockState();
  });

  it("queries the structured canonical store for graph relationships", async () => {
    queryCanonicalMemoryGraph.mockReturnValue({
      query: "Project Atlas",
      profileId: "local-main",
      workspaceScope: "scope-main",
      storePath: "/workspace/.alisio/memory/profiles/local-main/canonical.sqlite",
      backend: "builtin",
      state: "ready",
      projectionInterface: "markdown-vault",
      syncMode: "local-first",
      cloudSync: "not_implemented",
      matches: [
        {
          entityId: "note-1",
          title: "Project Atlas",
          slug: "project-atlas",
          sourcePath: "memory/project-atlas.md",
          sourceKind: "workspace-memory",
          aliases: ["project-atlas"],
          tags: ["project"],
          score: 1,
          projections: [
            {
              projectionId: "projection-1",
              path: "memory/project-atlas.md",
              sourceKind: "workspace-memory",
              editable: true,
            },
          ],
          relations: [
            {
              direction: "outgoing",
              relationType: "references",
              ordinal: 0,
              metadata: { syntax: "wiki" },
              relatedEntity: {
                entityId: "note-2",
                title: "Roadmap",
                slug: "roadmap",
                sourcePath: "memory/roadmap.md",
                sourceKind: "workspace-memory",
              },
            },
          ],
        },
      ],
    });

    const tool = createMemoryGraphToolOrThrow();
    const result = await tool.execute("graph", {
      query: "Project Atlas",
      direction: "both",
      matchLimit: 2,
      relationLimit: 4,
    });

    expect(queryCanonicalMemoryGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "Project Atlas",
        direction: "both",
        matchLimit: 2,
        relationLimit: 4,
        status: expect.objectContaining({
          profileId: "local-main",
          workspaceScope: "scope-main",
        }),
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        query: "Project Atlas",
        matches: [
          expect.objectContaining({
            title: "Project Atlas",
            relations: [expect.objectContaining({ direction: "outgoing" })],
          }),
        ],
      }),
    );
  });

  it("returns an explicit unavailable payload when the canonical store is missing", async () => {
    setCanonicalStoreStatus(null);

    const tool = createMemoryGraphToolOrThrow();
    const result = await tool.execute("graph-missing", { query: "roadmap" });

    expect(queryCanonicalMemoryGraph).not.toHaveBeenCalled();
    expect(result.details).toEqual({
      query: "roadmap",
      matches: [],
      disabled: true,
      unavailable: true,
      error: "canonical memory store unavailable",
    });
  });
});
