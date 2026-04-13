import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openLedger } from "../../../packages/memory-ledger/src/index.js";
import {
  getCanonicalFixture,
  getReadAgentMemoryFileMockCalls,
  resetMemoryToolMockState,
  setCanonicalStoreStatus,
  setMemorySearchImpl,
} from "../../../test/helpers/memory-tool-manager-mock.js";
import {
  asAlisioConfig,
  createDefaultMemoryToolConfig,
  createMemoryGetToolOrThrow,
  createMemorySearchToolOrThrow,
  expectUnavailableMemorySearchDetails,
} from "./tools.test-helpers.js";

beforeEach(() => {
  resetMemoryToolMockState();
});

describe("memory_search native retrieval", () => {
  it("uses the native layered retrieval path instead of the legacy search manager", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("legacy search manager should stay unused in native mode");
    });

    const tool = createMemorySearchToolOrThrow();
    const result = await tool.execute("native_search", { query: "Project Atlas" });
    const details = result.details as {
      mode: string;
      results: Array<{
        path: string;
        reasonCodes?: string[];
        scoreBreakdown?: { lexical: number };
        provenance?: { sourceLocator: string };
      }>;
    };

    expect(details.mode).toBe("layered");
    expect(details.results.length).toBeGreaterThan(0);
    expect(details.results[0]?.path).toMatch(/^memory:\/\/profiles\/local-main\//);
    expect(details.results[0]?.reasonCodes?.length ?? 0).toBeGreaterThan(0);
    expect(details.results[0]?.scoreBreakdown?.lexical).toEqual(expect.any(Number));
    expect(details.results[0]?.provenance).toEqual(
      expect.objectContaining({
        sourceLocator: expect.stringMatching(/^memory:\/\/profiles\/local-main\//),
      }),
    );
  });

  it("does not use the emergency fallback unless the flag is enabled", async () => {
    setCanonicalStoreStatus(null);
    setMemorySearchImpl(async () => [
      {
        path: "MEMORY.md",
        startLine: 5,
        endLine: 7,
        score: 0.9,
        snippet: "legacy fallback result",
        source: "memory" as const,
      },
    ]);

    const tool = createMemorySearchToolOrThrow();
    const result = await tool.execute("missing_native_store", { query: "hello" });

    expectUnavailableMemorySearchDetails(result.details, {
      error: "native canonical memory store unavailable",
      warning: "Memory retrieval is unavailable because the native canonical store is unavailable.",
      action: "Repair or resync the canonical memory store, then retry memory_search.",
    });
  });

  it("hard-disables the legacy search fallback even when the explicit flag is enabled", async () => {
    setCanonicalStoreStatus(null);
    setMemorySearchImpl(async () => {
      throw new Error("legacy fallback search should never run");
    });

    const tool = createMemorySearchToolOrThrow({
      config: asAlisioConfig({
        memory: {
          citations: "off",
          retrieval: {
            tracing: { enabled: false },
            emergencyLegacyFallback: { enabled: true },
          },
        },
        agents: { list: [{ id: "main", default: true }] },
      }),
    });
    const result = await tool.execute("emergency_search", { query: "hello" });
    expectUnavailableMemorySearchDetails(result.details, {
      error: "native canonical memory store unavailable",
      warning: "Memory retrieval is unavailable because the native canonical store is unavailable.",
      action: "Repair or resync the canonical memory store, then retry memory_search.",
    });
  });

  it("records RETRIEVAL_TRACE_RECORDED in the canonical ledger when tracing is enabled", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "alisio-memory-trace-"));
    vi.stubEnv("ALISIO_STATE_DIR", tempDir);

    try {
      const fixture = getCanonicalFixture();
      const tool = createMemorySearchToolOrThrow({
        config: asAlisioConfig({
          memory: {
            citations: "off",
            retrieval: {
              tracing: { enabled: true },
            },
          },
          agents: { list: [{ id: "main", default: true }] },
        }),
        agentSessionKey: "agent:main:discord:dm:u123",
      });
      const result = await tool.execute("trace_search", { query: "Project Atlas" });
      expect((result.details as { mode: string }).mode).toBe("layered");

      const ledger = openLedger(fixture.profileId, { stateDir: tempDir });
      try {
        const traceEvent = ledger
          .listEventsSince(0, 10)
          .find((event) => event.meta.eventType === "RETRIEVAL_TRACE_RECORDED");
        expect(traceEvent).toBeDefined();
        expect(traceEvent?.payload.kind).toBe("plain");
        if (!traceEvent || traceEvent.payload.kind !== "plain") {
          throw new Error("expected a plain retrieval trace payload");
        }

        const payload = JSON.parse(new TextDecoder().decode(traceEvent.payload.bytes)) as {
          eventName?: string;
          sessionKey?: string;
          trace?: { eventName?: string; profileId?: string; sessionKey?: string };
          metrics?: { retrieval_trace_events_total?: number; retrieval_selected_count?: number };
        };

        expect(payload).toEqual(
          expect.objectContaining({
            eventName: "RETRIEVAL_TRACE_RECORDED",
            sessionKey: "agent:main:discord:dm:u123",
            trace: expect.objectContaining({
              eventName: "RETRIEVAL_TRACE_RECORDED",
              profileId: fixture.profileId,
              sessionKey: "agent:main:discord:dm:u123",
            }),
            metrics: expect.objectContaining({
              retrieval_trace_events_total: 1,
              retrieval_selected_count: expect.any(Number),
            }),
          }),
        );
      } finally {
        ledger.close();
      }
    } finally {
      vi.unstubAllEnvs();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("memory_get stable locators", () => {
  it("rejects path-only reads by default", async () => {
    const fixture = getCanonicalFixture();
    const tool = createMemoryGetToolOrThrow();
    const result = await tool.execute("path_disabled", {
      path: fixture.atlasDisplayPath,
    } as Record<string, unknown>);

    expect(result.details).toEqual({
      text: "",
      path: "",
      disabled: true,
      error: "projectionId or pageId is required",
    });
    expect(getReadAgentMemoryFileMockCalls()).toBe(0);
  });

  it("reads native memory by stable projectionId", async () => {
    const fixture = getCanonicalFixture();
    const tool = createMemoryGetToolOrThrow(createDefaultMemoryToolConfig());
    const result = await tool.execute("stable_get", {
      projectionId: fixture.atlasProjectionId,
      from: 2,
      lines: 1,
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        text: "Project Atlas notes and launch checklist.",
        path: fixture.atlasLocator,
        displayPath: fixture.atlasDisplayPath,
        pageId: fixture.atlasPageId,
        projectionId: fixture.atlasProjectionId,
        locator: {
          pageId: fixture.atlasPageId,
          projectionId: fixture.atlasProjectionId,
        },
        reasonCodes: ["stable_locator"],
        provenance: {
          sourceLocator: fixture.atlasLocator,
          evidenceIds: [fixture.atlasPageId, fixture.atlasProjectionId],
        },
        scoreBreakdown: expect.objectContaining({
          confidence: 1,
          lexical: 1,
          vector: 0,
          userFeedback: 0,
        }),
      }),
    );
  });

  it("hard-disables path-only reads even when the legacy flag is enabled", async () => {
    const tool = createMemoryGetToolOrThrow(
      asAlisioConfig({
        memory: {
          citations: "off",
          retrieval: {
            tracing: { enabled: false },
            emergencyLegacyFallback: { enabled: true },
          },
        },
        agents: { list: [{ id: "main", default: true }] },
      }),
    );

    const result = await tool.execute("emergency_get", {
      path: "memory/legacy.md",
    } as Record<string, unknown>);

    expect(result.details).toEqual({
      text: "",
      path: "",
      disabled: true,
      error: "projectionId or pageId is required",
    });
    expect(getReadAgentMemoryFileMockCalls()).toBe(0);
  });
});
