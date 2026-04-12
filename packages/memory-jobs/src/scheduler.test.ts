import { describe, expect, it } from "vitest";
import { createMemorySleepScheduler } from "./scheduler.js";
import { withMemoryJobDb } from "./test-utils.js";

describe("memory sleep scheduler", () => {
  it("pauses and resumes deterministically without repeating promotions", async () => {
    await withMemoryJobDb(async ({ db, nowMs, gaia, runtime, status }) => {
      await gaia.writeEvents([
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "page-candidate-a",
          pageId: "candidate-a",
          source: "test",
          type: "PAGE_CREATED",
          payload: {
            pageId: "candidate-a",
            title: "Reset Discord token weekly",
            slug: "candidate-a",
            aliases: ["candidate-a"],
            tags: ["candidate"],
            createdAtMs: nowMs,
            updatedAtMs: nowMs,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "projection-candidate-a",
          pageId: "candidate-a",
          source: "test",
          type: "PROJECTION_SET",
          payload: {
            pageId: "candidate-a",
            kind: "legacy-markdown:memory/candidate-a.md",
            markdownBody:
              "confidence: 0.92\nevidence: 5\nrecurrence: 3\n\n1. Open Discord\n2. Rotate token\n3. Restart agent\n",
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "page-candidate-b",
          pageId: "candidate-b",
          source: "test",
          type: "PAGE_CREATED",
          payload: {
            pageId: "candidate-b",
            title: "Gateway cache cleanup",
            slug: "candidate-b",
            aliases: ["candidate-b"],
            tags: ["candidate"],
            createdAtMs: nowMs,
            updatedAtMs: nowMs,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "projection-candidate-b",
          pageId: "candidate-b",
          source: "test",
          type: "PROJECTION_SET",
          payload: {
            pageId: "candidate-b",
            kind: "legacy-markdown:memory/candidate-b.md",
            markdownBody:
              "confidence: 0.85\nevidence: 4\n\nRun cleanup after large sync imports.\n",
          },
        },
      ]);

      let active = false;
      let calls = 0;
      let allowPreempt = true;
      const scheduler = createMemorySleepScheduler({
        runtime,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
        activityMonitor: {
          isSessionActive() {
            calls += 1;
            if (allowPreempt && calls > 2) {
              active = true;
            }
            return active;
          },
        },
      });

      const firstRun = await scheduler.runOnce();
      expect(firstRun.status).toBe("preempted");

      active = false;
      calls = 0;
      allowPreempt = false;
      const secondRun = await scheduler.runOnce();
      expect(["completed", "budget-exhausted"]).toContain(secondRun.status);

      const pageTags = db
        .prepare(
          `SELECT page_id, tag
           FROM page_tags
           ORDER BY page_id ASC, tag ASC`,
        )
        .all() as Array<{ page_id: string; tag: string }>;
      expect(pageTags).toEqual([
        { page_id: "candidate-a", tag: "procedure" },
        { page_id: "candidate-b", tag: "claim" },
      ]);

      const claims = db
        .prepare(
          `SELECT claim_id, status
           FROM claims
           ORDER BY claim_id ASC`,
        )
        .all() as Array<{ claim_id: string; status: string }>;
      expect(claims).toEqual([{ claim_id: "candidate-b", status: "active" }]);

      const promotionEvents = scheduler.store
        .listAuditEvents({ profileId: status.profileId, kind: "consolidate" })
        .filter(
          (event) =>
            event.eventType === "PROMOTED_TO_CLAIM" || event.eventType === "PROMOTED_TO_PROCEDURE",
        );
      expect(promotionEvents).toHaveLength(2);
      scheduler.close();
    });
  });

  it("does not run while an active session flag is set", async () => {
    await withMemoryJobDb(async ({ runtime }) => {
      const scheduler = createMemorySleepScheduler({
        runtime,
        activityMonitor: {
          isSessionActive: () => true,
        },
      });
      const result = await scheduler.runOnce();
      expect(result.status).toBe("skipped-active");
      expect(result.jobRecords).toEqual([]);
      expect(result.telemetry.counts.sleep_preemptions).toBe(1);
      scheduler.close();
    });
  });
});
