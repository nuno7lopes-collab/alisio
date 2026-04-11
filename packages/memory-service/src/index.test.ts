import { describe, expect, it, vi } from "vitest";
import { createMemoryService, type GaiaMemoryFacade, type MemoryContextItem } from "./index.js";

function createTraceRecorder() {
  const recordRetrievalTrace = vi.fn<GaiaMemoryFacade["recordRetrievalTrace"]>();
  return {
    gaia: { recordRetrievalTrace },
    recordRetrievalTrace,
  };
}

function createBaseService(overrides?: {
  alwaysVisible?: MemoryContextItem[];
  workingSet?: MemoryContextItem[];
  structured?: MemoryContextItem[];
  textSearch?: MemoryContextItem[];
}) {
  const trace = createTraceRecorder();
  const service = createMemoryService({
    gaia: trace.gaia,
    layers: {
      alwaysVisible: async () =>
        overrides?.alwaysVisible ?? [
          {
            id: "policy-block",
            layer: "L0",
            kind: "policy",
            title: "Policy",
            text: "Private memory stays isolated by default.",
            reasonCodes: ["always_visible_policy"],
            scoreBreakdown: {
              recency: 1,
              confidence: 1,
              lexical: 0,
              vector: 0,
              userFeedback: 0,
            },
            provenance: {
              sourceLocator: "memory-service://policy",
              evidenceIds: ["policy-block"],
            },
            tokenCount: 6,
          },
        ],
      workingSet: async () => overrides?.workingSet ?? [],
      structured: async () =>
        overrides?.structured ?? [
          {
            id: "claim-1",
            layer: "L2",
            kind: "claim",
            title: "Atlas claim",
            text: "Atlas owns the retrieval ledger contract.",
            reasonCodes: ["high_confidence_claim", "linked"],
            scoreBreakdown: {
              recency: 0.3,
              confidence: 0.95,
              lexical: 0.7,
              vector: 0.4,
              userFeedback: 0.1,
            },
            provenance: {
              sourceLocator: "projection:claim-1",
              evidenceIds: ["claim-1", "proof-1"],
            },
            locator: { pageId: "page-claim-1", projectionId: "projection-claim-1" },
            tokenCount: 8,
          },
        ],
      textSearch: async () =>
        overrides?.textSearch ?? [
          {
            id: "page-1",
            layer: "L3",
            kind: "page",
            title: "Project Atlas",
            text: "Atlas memory page with exact retrieval notes.",
            reasonCodes: ["exact_match"],
            scoreBreakdown: {
              recency: 0.5,
              confidence: 0.7,
              lexical: 0.98,
              vector: 0.88,
              userFeedback: 0.2,
            },
            provenance: {
              sourceLocator: "memory/project-atlas.md",
              evidenceIds: ["projection-page-1"],
            },
            locator: { pageId: "page-1", projectionId: "projection-page-1" },
            tokenCount: 7,
          },
        ],
    },
  });
  return { service, trace };
}

describe("@alisio/memory-service", () => {
  it("keeps the selected payload within the token budget", async () => {
    const { service } = createBaseService({
      alwaysVisible: [],
      structured: [],
      textSearch: [
        {
          id: "a",
          layer: "L3",
          kind: "page",
          title: "A",
          text: "one",
          reasonCodes: ["exact_match"],
          scoreBreakdown: {
            recency: 0.1,
            confidence: 0.1,
            lexical: 1,
            vector: 0.8,
            userFeedback: 0,
          },
          provenance: { sourceLocator: "memory/a.md", evidenceIds: ["a"] },
          tokenCount: 5,
        },
        {
          id: "b",
          layer: "L3",
          kind: "page",
          title: "B",
          text: "two",
          reasonCodes: ["exact_match"],
          scoreBreakdown: {
            recency: 0.1,
            confidence: 0.1,
            lexical: 0.9,
            vector: 0.7,
            userFeedback: 0,
          },
          provenance: { sourceLocator: "memory/b.md", evidenceIds: ["b"] },
          tokenCount: 5,
        },
        {
          id: "c",
          layer: "L3",
          kind: "page",
          title: "C",
          text: "three",
          reasonCodes: ["exact_match"],
          scoreBreakdown: {
            recency: 0.1,
            confidence: 0.1,
            lexical: 0.8,
            vector: 0.6,
            userFeedback: 0,
          },
          provenance: { sourceLocator: "memory/c.md", evidenceIds: ["c"] },
          tokenCount: 5,
        },
      ],
    });

    const result = await service.retrieveContext({
      profileId: "local-main",
      agentId: "main",
      sessionKey: "agent:main:discord:dm:u123",
      queryText: "atlas",
      budgets: { maxTokens: 10, maxItems: 3 },
      modes: {
        includeWorkingSet: true,
        includeClaims: true,
        includePages: true,
        includeFiles: true,
      },
    });

    expect(result.budgetUsed.tokens).toBeLessThanOrEqual(10);
    expect(result.items).toHaveLength(2);
  });

  it("ensures every selected result carries explainability reasons", async () => {
    const { service } = createBaseService();
    const result = await service.retrieveContext({
      profileId: "local-main",
      agentId: "main",
      sessionKey: "agent:main:discord:dm:u123",
      queryText: "atlas",
      budgets: { maxTokens: 40, maxItems: 6 },
      modes: {
        includeWorkingSet: true,
        includeClaims: true,
        includePages: true,
        includeFiles: true,
      },
    });

    expect(result.items.every((item) => item.reasonCodes.length > 0)).toBe(true);
  });

  it("blocks private working-set items outside private sessions by default", async () => {
    const { service } = createBaseService({
      alwaysVisible: [],
      workingSet: [
        {
          id: "session-private-1",
          layer: "L1",
          kind: "event",
          title: "Private session event",
          text: "Direct user memory should not leak into group chats.",
          visibility: "private",
          reasonCodes: ["recent"],
          scoreBreakdown: {
            recency: 1,
            confidence: 0.4,
            lexical: 0.6,
            vector: 0.2,
            userFeedback: 0,
          },
          provenance: {
            sourceLocator: "session:dm-1",
            evidenceIds: ["session-private-1"],
          },
          tokenCount: 8,
        },
      ],
      structured: [],
      textSearch: [],
    });

    const result = await service.retrieveContext({
      profileId: "local-main",
      agentId: "main",
      sessionKey: "agent:main:discord:group:c123",
      queryText: "private",
      budgets: { maxTokens: 20, maxItems: 4 },
      modes: {
        includeWorkingSet: true,
        includeClaims: true,
        includePages: true,
        includeFiles: true,
      },
    });

    expect(result.items).toEqual([]);
    expect(result.trace.isolation.deniedCount).toBe(1);
  });

  it("records RETRIEVAL_TRACE_RECORDED for every retrieval when tracing is enabled", async () => {
    const { service, trace } = createBaseService();
    const result = await service.retrieveContext({
      profileId: "local-main",
      agentId: "main",
      sessionKey: "agent:main:discord:dm:u123",
      queryText: "atlas",
      budgets: { maxTokens: 40, maxItems: 6 },
      modes: {
        includeWorkingSet: true,
        includeClaims: true,
        includePages: true,
        includeFiles: true,
      },
    });

    expect(trace.recordRetrievalTrace).toHaveBeenCalledTimes(1);
    expect(trace.recordRetrievalTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        trace: expect.objectContaining({
          eventName: "RETRIEVAL_TRACE_RECORDED",
          selectedCount: result.items.length,
        }),
        metrics: expect.objectContaining({
          retrieval_latency_ms: expect.any(Number),
          retrieval_selected_count: result.items.length,
          retrieval_budget_tokens: result.budgetUsed.tokens,
        }),
      }),
    );
  });
});
