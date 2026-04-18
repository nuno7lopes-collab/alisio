import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GaiaSleepWriteFacade } from "./gaia.js";
import { createMemorySleepScheduler } from "./scheduler.js";
import { createSchedulerTestDependencies, withMemoryJobDb } from "./test-utils.js";

async function seedBacklogNote(params: {
  gaia: GaiaSleepWriteFacade;
  nowMs: number;
  pageId: string;
  relativePath: string;
  markdownBody: string;
  title?: string;
}) {
  await params.gaia.writeEvents([
    {
      actorId: "test",
      createdAtMs: params.nowMs,
      eventId: `page-${params.pageId}`,
      pageId: params.pageId,
      source: "test",
      type: "PAGE_CREATED",
      payload: {
        pageId: params.pageId,
        title: params.title ?? "Session backlog",
        slug: params.pageId,
        aliases: [params.pageId],
        tags: ["backlog"],
        createdAtMs: params.nowMs,
        updatedAtMs: params.nowMs,
      },
    },
    {
      actorId: "test",
      createdAtMs: params.nowMs,
      eventId: `projection-${params.pageId}`,
      pageId: params.pageId,
      source: "test",
      type: "PROJECTION_SET",
      payload: {
        pageId: params.pageId,
        kind: `md-path:${params.relativePath}`,
        markdownBody: params.markdownBody,
      },
    },
  ]);
}

function buildBacklogMarkdown(params: {
  capturedAt: string;
  summary: string;
  action?: "new" | "reset";
  body: string;
}) {
  return [
    "---",
    `summary: ${JSON.stringify(params.summary)}`,
    "memoryRole: backlog",
    "backlogStatus: pending",
    `capturedAt: ${JSON.stringify(params.capturedAt)}`,
    `sessionAction: ${JSON.stringify(params.action ?? "new")}`,
    `sessionKey: ${JSON.stringify("agent:main:main")}`,
    `sessionId: ${JSON.stringify("session-1")}`,
    `source: ${JSON.stringify("session-memory")}`,
    "tags:",
    "  - backlog",
    "  - session-memory",
    "---",
    "# Session new - Physics Study",
    "",
    "## Context",
    "",
    `- **Captured At**: ${params.capturedAt}`,
    `- **Action**: /${params.action ?? "new"}`,
    "- **Session Key**: agent:main:main",
    "- **Session ID**: session-1",
    "- **Source**: session-memory",
    "",
    "## Conversation Summary",
    "",
    params.body,
    "",
  ].join("\n");
}

describe("memory backlog promotion job", () => {
  it("promotes backlog notes into topic and daily notes, removes backlog projections, and feeds long-term memory", async () => {
    await withMemoryJobDb(async ({ db, workspaceDir, nowMs, gaia, runtime, status }) => {
      await seedBacklogNote({
        gaia,
        nowMs,
        pageId: "backlog-physics",
        relativePath: "memory/backlog/2026-04-18/physics-study.md",
        markdownBody: buildBacklogMarkdown({
          capturedAt: "2026-04-18T17:20:00.000Z",
          summary: "Estou a estudar fisica e preciso de acompanhar lacunas em mecanica.",
          body: [
            "user: Quero estudar física de forma estruturada.",
            "assistant: Vamos acompanhar o progresso por tópicos.",
          ].join("\n"),
        }),
      });

      const scheduler = createMemorySleepScheduler({
        runtime,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
        dependencies: createSchedulerTestDependencies({ status, gaia }),
      });

      const result = await scheduler.runOnce();
      expect(result.status).toBe("completed");

      const topicNote = await fs.readFile(path.join(workspaceDir, "memory", "physics-study.md"), "utf8");
      expect(topicNote).toContain("## Promoted backlog");
      expect(topicNote).toContain("### 2026-04-18 17:20 UTC");
      expect(topicNote).toContain("Summary: Estou a estudar fisica e preciso de acompanhar lacunas em mecanica.");
      expect(topicNote).toContain("Quero estudar física de forma estruturada.");

      const dailyNote = await fs.readFile(path.join(workspaceDir, "memory", "2026-04-18.md"), "utf8");
      expect(dailyNote).toContain("## 17:20 UTC");
      expect(dailyNote).toContain("Physics Study: Estou a estudar fisica e preciso de acompanhar lacunas em mecanica.");

      const rootNote = await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf8");
      expect(rootNote).toContain("## Auto-promoted long-term memory");
      expect(rootNote).toContain("Physics Study: Estou a estudar fisica e preciso de acompanhar lacunas em mecanica.");

      await expect(
        fs.readFile(path.join(workspaceDir, "memory", "backlog", "2026-04-18", "physics-study.md"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const backlogPage = db
        .prepare(
          `SELECT tombstoned
           FROM pages
           WHERE page_id = 'backlog-physics'`,
        )
        .get() as { tombstoned: number } | undefined;
      expect(backlogPage?.tombstoned).toBe(1);

      const auditEvents = scheduler.store.listAuditEvents({
        profileId: status.profileId,
        kind: "backlog-promote",
      });
      expect(auditEvents.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(["PROMOTED_TO_TOPIC", "PROMOTED_TO_DAILY", "PROJECTION_DELETED"]),
      );
      scheduler.close();
    });
  });

  it("promotes backlog notes even when the backlog path omits the date folder", async () => {
    await withMemoryJobDb(async ({ workspaceDir, nowMs, gaia, runtime, status }) => {
      await seedBacklogNote({
        gaia,
        nowMs,
        pageId: "backlog-undated",
        relativePath: "memory/backlog/physics-study.md",
        markdownBody: buildBacklogMarkdown({
          capturedAt: "2026-04-18T09:10:00.000Z",
          summary: "Quero consolidar o estudo de física por tópicos.",
          body: [
            "user: Quero estruturar o estudo de física.",
            "assistant: Vamos transformar isto numa nota temática.",
          ].join("\n"),
        }),
      });

      const scheduler = createMemorySleepScheduler({
        runtime,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
        dependencies: createSchedulerTestDependencies({ status, gaia }),
      });

      const result = await scheduler.runOnce();
      expect(result.status).toBe("completed");

      const topicNote = await fs.readFile(path.join(workspaceDir, "memory", "physics-study.md"), "utf8");
      expect(topicNote).toContain("Quero consolidar o estudo de física por tópicos.");

      const dailyNote = await fs.readFile(path.join(workspaceDir, "memory", "2026-04-18.md"), "utf8");
      expect(dailyNote).toContain("## 09:10 UTC");

      await expect(
        fs.readFile(path.join(workspaceDir, "memory", "backlog", "physics-study.md"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });

      scheduler.close();
    });
  });

  it("resumes backlog promotion cleanly without duplicating promoted entries", async () => {
    await withMemoryJobDb(async ({ workspaceDir, nowMs, gaia, runtime, status }) => {
      await seedBacklogNote({
        gaia,
        nowMs,
        pageId: "backlog-football",
        relativePath: "memory/backlog/2026-04-18/football.md",
        markdownBody: buildBacklogMarkdown({
          capturedAt: "2026-04-18T18:05:00.000Z",
          summary: "Adoro futebol e jogo todas as sextas-feiras.",
          body: [
            "user: Adoro futebol.",
            "assistant: Vou registar isso como rotina e preferencia.",
          ].join("\n"),
        }),
      });

      let tick = 0;
      const scheduler = createMemorySleepScheduler({
        runtime,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 20,
        },
        sliceMs: 10,
        dependencies: createSchedulerTestDependencies({ status, gaia }),
        clock: {
          now() {
            tick += 5;
            return nowMs + tick;
          },
        },
      });

      const firstRun = await scheduler.runOnce();
      expect(firstRun.status).toBe("budget-exhausted");
      scheduler.close();

      const resumed = createMemorySleepScheduler({
        runtime,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
        dependencies: createSchedulerTestDependencies({ status, gaia }),
      });

      const secondRun = await resumed.runOnce();
      expect(secondRun.status).toBe("completed");

      const topicNote = await fs.readFile(path.join(workspaceDir, "memory", "football.md"), "utf8");
      expect(topicNote.match(/Summary: Adoro futebol e jogo todas as sextas-feiras\./g)?.length ?? 0).toBe(1);

      const auditEvents = resumed.store
        .listAuditEvents({ profileId: status.profileId, kind: "backlog-promote" })
        .filter((event) => event.eventType === "PROMOTED_TO_TOPIC");
      expect(auditEvents).toHaveLength(1);
      resumed.close();
    });
  });
});
