import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSessionTranscriptsDirForAgent } from "alisio/plugin-sdk/memory-core-host-runtime-core";
import { openLedger } from "../../../packages/memory-ledger/src/index.js";
import { ensureMemoryStateSchema } from "../../../packages/memory-state/src/schema.js";
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

function createRoleAwareCanonicalStoreFixture() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "alisio-memory-role-aware-"));
  const dbPath = path.join(tempDir, "canonical.sqlite");
  const db = new DatabaseSync(dbPath);
  const now = Date.parse("2026-04-18T12:00:00.000Z");

  ensureMemoryStateSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_events (
      event_id TEXT PRIMARY KEY,
      lamport INTEGER NOT NULL UNIQUE,
      actor_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      page_id TEXT,
      source TEXT,
      batch_id TEXT,
      created_at_ms INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS imported_files (
      source_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      page_id TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);

  const insertPage = db.prepare(
    `INSERT INTO pages (page_id, title, slug, created_at_ms, updated_at_ms, tombstoned)
     VALUES (?, ?, ?, ?, ?, 0)`,
  );
  const insertProjection = db.prepare(
    `INSERT INTO projections (page_id, kind, markdown_body, updated_at_ms)
     VALUES (?, ?, ?, ?)`,
  );
  const insertTag = db.prepare(
    `INSERT INTO page_tags (page_id, tag, ordinal)
     VALUES (?, ?, ?)`,
  );

  insertPage.run("memory-root", "Memory", "memory-root", now - 10_000, now - 1_000);
  insertProjection.run(
    "memory-root",
    "md-path:MEMORY.md",
    "# Memory\n\nPhysics goals, study priorities, and how to work together.\n",
    now - 1_000,
  );
  insertTag.run("memory-root", "pinned", 0);

  insertPage.run("topic-physics", "Physics Study", "physics-study", now - 20_000, now - 2_000);
  insertProjection.run(
    "topic-physics",
    "md-path:memory/physics-study.md",
    "# Physics Study\n\nCurrent mechanics roadmap and open gaps.\n",
    now - 2_000,
  );
  insertTag.run("topic-physics", "topic", 0);

  insertPage.run("daily-2026-04-17", "2026-04-17", "2026-04-17", now - 80_000, now - 3_000);
  insertProjection.run(
    "daily-2026-04-17",
    "md-path:memory/2026-04-17.md",
    "# 2026-04-17\n\nDiscussed what to review next and what stayed pending.\n",
    now - 3_000,
  );
  insertTag.run("daily-2026-04-17", "daily", 0);

  insertPage.run("backlog-study-next", "Study Next", "study-next", now - 70_000, now - 2_500);
  insertProjection.run(
    "backlog-study-next",
    "md-path:memory/backlog/2026-04-17/study-next.md",
    "# Study Next\n\nPending: revisit mechanics exercises and unresolved questions.\n",
    now - 2_500,
  );
  insertTag.run("backlog-study-next", "backlog", 0);

  db.close();

  const status = {
    state: "ready",
    path: dbPath,
    profileId: "local-main",
    profileSource: "local-profile",
    workspaceScope: "scope-main",
    workspaceDir: tempDir,
    backend: "builtin",
    entities: 4,
    relations: 0,
    projections: 4,
    projectionInterface: "markdown-repo",
    syncMode: "local-first",
    cloudSync: "unavailable",
    projectionSources: ["workspace-memory"],
  } satisfies NonNullable<Parameters<typeof setCanonicalStoreStatus>[0]>;

  return {
    tempDir,
    status,
  };
}

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

  it("prioritizes main and topic memory over daily and backlog notes for stable recall", async () => {
    const fixture = createRoleAwareCanonicalStoreFixture();
    setCanonicalStoreStatus(fixture.status);

    try {
      const tool = createMemorySearchToolOrThrow();
      const result = await tool.execute("stable_roles", { query: "physics" });
      const details = result.details as {
        results: Array<{
          displayPath?: string;
        }>;
      };
      const displayPaths = details.results.map((entry) => entry.displayPath);

      expect(displayPaths[0]).toBe("MEMORY.md");
      expect(displayPaths).toContain("memory/physics-study.md");
      expect(displayPaths).not.toContain("memory/2026-04-17.md");
      expect(displayPaths).not.toContain("memory/backlog/2026-04-17/study-next.md");
    } finally {
      rmSync(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("adds daily, backlog, and transcript recall for temporal follow-up queries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T12:00:00.000Z"));
    const fixture = createRoleAwareCanonicalStoreFixture();
    setCanonicalStoreStatus(fixture.status);
    vi.stubEnv("ALISIO_STATE_DIR", fixture.tempDir);

    const sessionsDir = resolveSessionTranscriptsDirForAgent("main");
    mkdirSync(sessionsDir, { recursive: true });
    const transcriptPath = path.join(sessionsDir, "2026-04-17-followup.jsonl");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: "Ontem falámos sobre o que ficou por fazer em física.",
          },
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: "Ficou pendente rever mecânica e dúvidas abertas.",
          },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const tool = createMemorySearchToolOrThrow({
        agentSessionKey: "agent:main:main",
      });
      const result = await tool.execute("temporal_roles", {
        query: "o que ficou por fazer ontem na conversa?",
      });
      const details = result.details as {
        results: Array<{
          source: string;
          displayPath?: string;
        }>;
      };
      const displayPaths = details.results.map((entry) => entry.displayPath);

      expect(displayPaths).toContain("memory/2026-04-17.md");
      expect(displayPaths).toContain("memory/backlog/2026-04-17/study-next.md");
      expect(
        details.results.some(
          (entry) =>
            entry.source === "sessions" &&
            entry.displayPath === "sessions/2026-04-17-followup.jsonl",
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      rmSync(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("keeps private session transcripts out of shared-chat recall", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T12:00:00.000Z"));
    const fixture = createRoleAwareCanonicalStoreFixture();
    setCanonicalStoreStatus(fixture.status);
    vi.stubEnv("ALISIO_STATE_DIR", fixture.tempDir);

    const sessionsDir = resolveSessionTranscriptsDirForAgent("main");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      path.join(sessionsDir, "2026-04-17-followup.jsonl"),
      [
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: "Ontem falámos sobre o que ficou por fazer em física.",
          },
        }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: "Ficou pendente rever mecânica e dúvidas abertas.",
          },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const tool = createMemorySearchToolOrThrow({
        agentSessionKey: "agent:main:discord:group:c123",
      });
      const result = await tool.execute("temporal_group_roles", {
        query: "o que ficou por fazer ontem na conversa?",
      });
      const details = result.details as {
        results: Array<{
          source: string;
          displayPath?: string;
        }>;
      };

      expect(details.results.some((entry) => entry.source === "sessions")).toBe(false);
      expect(details.results.map((entry) => entry.displayPath)).toContain("memory/2026-04-17.md");
      expect(details.results.map((entry) => entry.displayPath)).toContain(
        "memory/backlog/2026-04-17/study-next.md",
      );
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      rmSync(fixture.tempDir, { recursive: true, force: true });
    }
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
