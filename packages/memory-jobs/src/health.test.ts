import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySleepScheduler } from "./scheduler.js";
import { createSchedulerTestDependencies, withMemoryJobDb } from "./test-utils.js";

describe("memory health dashboards", () => {
  it("reports stale claims, contradictions, orphan pages, broken attachments, and low-confidence items", async () => {
    await withMemoryJobDb(async ({ db, workspaceDir, nowMs, gaia, runtime, status }) => {
      const existingAttachment = path.join(workspaceDir, "attachments", "ok.png");
      await fs.mkdir(path.dirname(existingAttachment), { recursive: true });
      await fs.writeFile(existingAttachment, "ok");

      const oldUpdatedAt = nowMs - 45 * 24 * 60 * 60_000;
      await gaia.writeEvents([
        {
          actorId: "test",
          createdAtMs: oldUpdatedAt,
          eventId: "page-claim-old",
          pageId: "claim-old",
          source: "test",
          type: "PAGE_CREATED",
          payload: {
            pageId: "claim-old",
            title: "Gateway needs a warm restart",
            slug: "claim-old",
            aliases: ["claim-old"],
            tags: ["claim"],
            createdAtMs: oldUpdatedAt,
            updatedAtMs: oldUpdatedAt,
          },
        },
        {
          actorId: "test",
          createdAtMs: oldUpdatedAt,
          eventId: "projection-claim-old",
          pageId: "claim-old",
          source: "test",
          type: "PROJECTION_SET",
          payload: {
            pageId: "claim-old",
            kind: "legacy-markdown:memory/claim-old.md",
            markdownBody: "![missing](../attachments/missing.png)\nGateway restart is required.\n",
          },
        },
        {
          actorId: "test",
          createdAtMs: oldUpdatedAt,
          eventId: "claim-claim-old",
          pageId: "claim-old",
          source: "test",
          type: "CLAIM_UPSERTED",
          payload: {
            claimId: "claim-old",
            subject: "gateway",
            predicate: "requires_restart",
            object: "enabled",
            confidence: 0.9,
            status: "active",
            updatedAtMs: oldUpdatedAt,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "page-claim-opposite",
          pageId: "claim-opposite",
          source: "test",
          type: "PAGE_CREATED",
          payload: {
            pageId: "claim-opposite",
            title: "Gateway needs a warm restart",
            slug: "claim-opposite",
            aliases: ["claim-opposite"],
            tags: ["claim"],
            createdAtMs: nowMs,
            updatedAtMs: nowMs,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "projection-claim-opposite",
          pageId: "claim-opposite",
          source: "test",
          type: "PROJECTION_SET",
          payload: {
            pageId: "claim-opposite",
            kind: "legacy-markdown:memory/claim-opposite.md",
            markdownBody: `![ok](../attachments/ok.png)\nGateway restart is not required.\n`,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "claim-claim-opposite",
          pageId: "claim-opposite",
          source: "test",
          type: "CLAIM_UPSERTED",
          payload: {
            claimId: "claim-opposite",
            subject: "gateway",
            predicate: "requires_restart",
            object: "not enabled",
            confidence: 0.88,
            status: "active",
            updatedAtMs: nowMs,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "page-claim-low-confidence",
          pageId: "claim-low-confidence",
          source: "test",
          type: "PAGE_CREATED",
          payload: {
            pageId: "claim-low-confidence",
            title: "Matrix bridge flaps overnight",
            slug: "claim-low-confidence",
            aliases: ["claim-low-confidence"],
            tags: ["claim"],
            createdAtMs: nowMs,
            updatedAtMs: nowMs,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "projection-claim-low-confidence",
          pageId: "claim-low-confidence",
          source: "test",
          type: "PROJECTION_SET",
          payload: {
            pageId: "claim-low-confidence",
            kind: "legacy-markdown:memory/claim-low-confidence.md",
            markdownBody: "Bridge flap observed once.\n",
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "claim-claim-low-confidence",
          pageId: "claim-low-confidence",
          source: "test",
          type: "CLAIM_UPSERTED",
          payload: {
            claimId: "claim-low-confidence",
            subject: "matrix",
            predicate: "overnight_flaps",
            object: "possible",
            confidence: 0.2,
            status: "active",
            updatedAtMs: nowMs,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "projection-missing-page",
          pageId: "missing-page",
          source: "test",
          type: "PROJECTION_SET",
          payload: {
            pageId: "missing-page",
            kind: "legacy-markdown:memory/orphan.md",
            markdownBody: "orphan content",
          },
        },
      ]);

      const scheduler = createMemorySleepScheduler({
        runtime,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
        dependencies: createSchedulerTestDependencies({ status, gaia }),
      });

      const result = await scheduler.runOnce();
      expect(result.healthDashboard).toBeDefined();
      expect(result.healthDashboard?.staleClaims).toHaveLength(1);
      expect(result.healthDashboard?.contradictions).toHaveLength(2);
      expect(result.healthDashboard?.orphanPages).toHaveLength(1);
      expect(result.healthDashboard?.brokenAttachments).toHaveLength(1);
      expect(result.healthDashboard?.lowConfidenceItems).toHaveLength(1);

      const dashboards = db
        .prepare(
          `SELECT kind
           FROM dashboards
           ORDER BY kind ASC`,
        )
        .all() as Array<{ kind: string }>;
      expect(dashboards).toEqual([{ kind: `health:${status.workspaceScope}` }]);

      const dashboardEvents = db
        .prepare(
          `SELECT event_type
           FROM ledger_events
           WHERE source = 'sleep/health'
           ORDER BY lamport ASC`,
        )
        .all() as Array<{ event_type: string }>;
      expect(dashboardEvents.map((row) => row.event_type)).toContain("DASHBOARD_SET");
      scheduler.close();
    });
  });
});
