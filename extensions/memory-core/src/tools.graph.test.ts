import { beforeEach, describe, expect, it } from "vitest";
import {
  getCanonicalFixture,
  resetMemoryToolMockState,
  setCanonicalStoreStatus,
} from "../../../test/helpers/memory-tool-manager-mock.js";
import { createMemoryGraphToolOrThrow } from "./tools.test-helpers.js";

describe("memory_graph tool", () => {
  beforeEach(() => {
    resetMemoryToolMockState();
  });

  it("queries the GAIA-derived canonical graph with stable page IDs", async () => {
    const fixture = getCanonicalFixture();
    const tool = createMemoryGraphToolOrThrow();
    const result = await tool.execute("graph", {
      query: "Project Atlas",
      direction: "both",
      matchLimit: 2,
      relationLimit: 4,
    });
    const details = result.details as {
      query: string;
      matches: Array<{
        pageId: string;
        title: string;
        reasonCodes?: string[];
        scoreBreakdown?: { lexical: number; confidence: number };
        provenance?: { sourceLocator: string };
        relations: Array<{
          direction: string;
          relatedEntity?: { pageId: string; title: string };
        }>;
      }>;
    };

    expect(details.query).toBe("Project Atlas");
    expect(details.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pageId: fixture.atlasPageId,
          title: "Project Atlas",
          reasonCodes: expect.arrayContaining(["exact_match", "linked"]),
          scoreBreakdown: expect.objectContaining({
            lexical: expect.any(Number),
            confidence: expect.any(Number),
          }),
          provenance: expect.objectContaining({
            sourceLocator: fixture.atlasLocator,
          }),
          relations: expect.arrayContaining([
            expect.objectContaining({
              direction: "outgoing",
              relatedEntity: expect.objectContaining({
                pageId: fixture.roadmapPageId,
                title: "Roadmap",
              }),
            }),
          ]),
        }),
      ]),
    );
  });

  it("filters private graph relations outside private sessions", async () => {
    const fixture = getCanonicalFixture();
    const tool = createMemoryGraphToolOrThrow();
    const result = await tool.execute("graph-private-filter", {
      query: "Project Atlas",
      direction: "both",
      matchLimit: 2,
      relationLimit: 6,
    });
    const details = result.details as {
      matches: Array<{
        pageId: string;
        relations: Array<{ relatedEntity?: { pageId: string } }>;
      }>;
    };

    const atlas = details.matches.find((match) => match.pageId === fixture.atlasPageId);
    expect(
      atlas?.relations.some((relation) => relation.relatedEntity?.pageId === fixture.privatePageId),
    ).toBe(false);
  });

  it("returns an explicit unavailable payload when the canonical store is missing", async () => {
    setCanonicalStoreStatus(null);

    const tool = createMemoryGraphToolOrThrow();
    const result = await tool.execute("graph-missing", { query: "roadmap" });

    expect(result.details).toEqual({
      query: "roadmap",
      matches: [],
      disabled: true,
      unavailable: true,
      error: "canonical memory store unavailable",
    });
  });
});
