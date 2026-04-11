import { beforeEach, describe, expect, it } from "vitest";
import {
  getCanonicalFixture,
  getReadAgentMemoryFileMockCalls,
  resetMemoryToolMockState,
  setCanonicalStoreStatus,
  setMemoryReadFileImpl,
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
      results: Array<{ path: string; reasonCodes?: string[] }>;
    };

    expect(details.mode).toBe("layered");
    expect(details.results.length).toBeGreaterThan(0);
    expect(details.results[0]?.path).toMatch(/^memory:\/\/profiles\/local-main\//);
    expect(details.results[0]?.reasonCodes?.length ?? 0).toBeGreaterThan(0);
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

  it("uses the emergency legacy fallback only when the explicit flag is enabled", async () => {
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
    const details = result.details as {
      mode: string;
      results: Array<{ path: string; snippet: string }>;
    };

    expect(details.mode).toBe("emergency-fallback");
    expect(details.results).toEqual([
      expect.objectContaining({
        path: "MEMORY.md",
        snippet: "legacy fallback result",
      }),
    ]);
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

    expect(result.details).toEqual({
      text: "Project Atlas notes and launch checklist.",
      path: fixture.atlasLocator,
      displayPath: fixture.atlasDisplayPath,
      pageId: fixture.atlasPageId,
      projectionId: fixture.atlasProjectionId,
    });
  });

  it("keeps the legacy path read only behind the emergency flag", async () => {
    setMemoryReadFileImpl(async (params) => ({
      text: "legacy emergency text",
      path: params.relPath,
    }));
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
      text: "legacy emergency text",
      path: "memory/legacy.md",
    });
    expect(getReadAgentMemoryFileMockCalls()).toBe(1);
  });
});
