import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GaiaSleepWriteFacade } from "./gaia.js";
import { createMemorySleepScheduler } from "./scheduler.js";
import { createSchedulerTestDependencies, withMemoryJobDb } from "./test-utils.js";

async function seedDailyNote(params: {
  gaia: GaiaSleepWriteFacade;
  nowMs: number;
  pageId: string;
  dateStamp: string;
  markdownBody: string;
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
        title: params.dateStamp,
        slug: params.pageId,
        aliases: [params.pageId],
        tags: ["daily"],
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
        kind: `legacy-markdown:memory/${params.dateStamp}.md`,
        markdownBody: params.markdownBody,
      },
    },
  ]);
}

describe("memory long-term promotion job", () => {
  it("promotes canonical daily notes into MEMORY.md without clobbering manual content", async () => {
    await withMemoryJobDb(async ({ db, workspaceDir, nowMs, gaia, runtime, status }) => {
      await gaia.writeEvents([
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "page-memory-root",
          pageId: "memory-root",
          source: "test",
          type: "PAGE_CREATED",
          payload: {
            pageId: "memory-root",
            title: "Memory",
            slug: "memory-root",
            aliases: ["memory-root", "MEMORY.md"],
            tags: ["manual"],
            createdAtMs: nowMs,
            updatedAtMs: nowMs,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "projection-memory-root",
          pageId: "memory-root",
          source: "test",
          type: "PROJECTION_SET",
          payload: {
            pageId: "memory-root",
            kind: "legacy-markdown:MEMORY.md",
            markdownBody: "# Memory\n\n## Manual notes\n- Keep this intact.\n",
          },
        },
      ]);
      await seedDailyNote({
        gaia,
        nowMs,
        pageId: "daily-2026-04-16",
        dateStamp: "2026-04-16",
        markdownBody: [
          "## 12:34:56 UTC - recap",
          "",
          "- **Action**: /new",
          "- **Session Key**: agent:main:main",
          "- **Session ID**: session-1",
          "- **Source**: session-memory",
          "",
          "### Conversation Summary",
          "",
          "user: First memory item",
          "assistant: First summary",
          "",
        ].join("\n"),
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

      const rootProjection = db
        .prepare(
          `SELECT markdown_body
           FROM projections
           WHERE page_id = 'memory-root'
           ORDER BY kind ASC
           LIMIT 1`,
        )
        .get() as { markdown_body: string } | undefined;
      expect(rootProjection?.markdown_body).toContain("## Manual notes");
      expect(rootProjection?.markdown_body).toContain("## Auto-promoted long-term memory");
      expect(rootProjection?.markdown_body).toContain("First memory item / First summary");
      expect(rootProjection?.markdown_body).not.toContain("Session Key");

      const materializedRoot = await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf8");
      expect(materializedRoot).toContain("Keep this intact.");
      expect(materializedRoot).toContain("First memory item / First summary");

      const auditEvents = scheduler.store
        .listAuditEvents({ profileId: status.profileId, kind: "long-term" })
        .filter((event) => event.eventType === "PROMOTED_TO_LONG_TERM");
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0]?.payload).toEqual(
        expect.objectContaining({
          relativePath: "MEMORY.md",
          datesPromoted: 1,
          itemCount: 1,
        }),
      );
      scheduler.close();
    });
  });

  it("does not duplicate long-term promotions when MEMORY.md is already up to date", async () => {
    await withMemoryJobDb(async ({ workspaceDir, nowMs, gaia, runtime, status }) => {
      await seedDailyNote({
        gaia,
        nowMs,
        pageId: "daily-2026-04-15",
        dateStamp: "2026-04-15",
        markdownBody: "- Durable note from compaction\n- Another useful detail\n",
      });

      const scheduler = createMemorySleepScheduler({
        runtime,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
        dependencies: createSchedulerTestDependencies({ status, gaia }),
      });

      await scheduler.runOnce();
      await scheduler.runOnce();

      const materializedRoot = await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf8");
      expect(materializedRoot.match(/### 2026-04-15/g)?.length ?? 0).toBe(1);
      expect(materializedRoot.match(/Durable note from compaction/g)?.length ?? 0).toBe(1);

      const auditEvents = scheduler.store
        .listAuditEvents({ profileId: status.profileId, kind: "long-term" })
        .filter((event) => event.eventType === "PROMOTED_TO_LONG_TERM");
      expect(auditEvents).toHaveLength(1);
      scheduler.close();
    });
  });
});
