import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { GaiaSleepWriteFacade } from "./gaia.js";
import { createMemorySleepScheduler } from "./scheduler.js";
import { createSchedulerTestDependencies, withMemoryJobDb } from "./test-utils.js";

async function seedPromotionCandidates(params: {
  gaia: GaiaSleepWriteFacade;
  nowMs: number;
}): Promise<void> {
  await params.gaia.writeEvents([
    {
      actorId: "test",
      createdAtMs: params.nowMs,
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
        createdAtMs: params.nowMs,
        updatedAtMs: params.nowMs,
      },
    },
    {
      actorId: "test",
      createdAtMs: params.nowMs,
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
      createdAtMs: params.nowMs,
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
        createdAtMs: params.nowMs,
        updatedAtMs: params.nowMs,
      },
    },
    {
      actorId: "test",
      createdAtMs: params.nowMs,
      eventId: "projection-candidate-b",
      pageId: "candidate-b",
      source: "test",
      type: "PROJECTION_SET",
      payload: {
        pageId: "candidate-b",
        kind: "legacy-markdown:memory/candidate-b.md",
        markdownBody: "confidence: 0.85\nevidence: 4\n\nRun cleanup after large sync imports.\n",
      },
    },
  ]);
}

function readLedgerEventTypes(db: DatabaseSync, source?: string): string[] {
  const rows = (
    source
      ? db
          .prepare(
            `SELECT event_type
             FROM ledger_events
             WHERE source = ?
             ORDER BY lamport ASC`,
          )
          .all(source)
      : db
          .prepare(
            `SELECT event_type
             FROM ledger_events
             ORDER BY lamport ASC`,
          )
          .all()
  ) as Array<{ event_type: string }>;
  return rows.map((row) => row.event_type);
}

describe("memory sleep scheduler", () => {
  it("pauses and resumes from ledger checkpoints without repeating promotions", async () => {
    await withMemoryJobDb(async ({ db, nowMs, gaia, runtime, status }) => {
      await seedPromotionCandidates({ gaia, nowMs });

      let active = false;
      let calls = 0;
      let allowPreempt = true;
      const scheduler = createMemorySleepScheduler({
        runtime,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
        dependencies: createSchedulerTestDependencies({ status, gaia }),
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
      expect(readLedgerEventTypes(db, "sleep/consolidate")).toContain("JOB_CHECKPOINT_UPDATED");

      db.prepare(`DELETE FROM memory_jobs`).run();

      active = false;
      calls = 0;
      allowPreempt = false;
      const secondRun = await scheduler.runOnce();
      expect(secondRun.status).toBe("completed");

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
      expect(readLedgerEventTypes(db, "sleep/consolidate")).toContain("PAGE_METADATA_UPDATED");
      expect(readLedgerEventTypes(db, "sleep/consolidate")).toContain("CLAIM_UPSERTED");

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

  it("resumes from ledger checkpoints after budget exhaustion when the local mirror is cleared", async () => {
    await withMemoryJobDb(async ({ db, nowMs, gaia, runtime, status }) => {
      await seedPromotionCandidates({ gaia, nowMs });

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
      expect(readLedgerEventTypes(db, "sleep/consolidate")).toContain("JOB_CHECKPOINT_UPDATED");

      db.prepare(`DELETE FROM memory_jobs`).run();
      scheduler.close();

      const resumed = createMemorySleepScheduler({
        runtime,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
        dependencies: createSchedulerTestDependencies({ status, gaia }),
        clock: {
          now: () => nowMs + 10_000,
        },
      });

      const secondRun = await resumed.runOnce();
      expect(secondRun.status).toBe("completed");

      const promotionEvents = resumed.store
        .listAuditEvents({ profileId: status.profileId, kind: "consolidate" })
        .filter(
          (event) =>
            event.eventType === "PROMOTED_TO_CLAIM" || event.eventType === "PROMOTED_TO_PROCEDURE",
        );
      expect(promotionEvents).toHaveLength(2);
      resumed.close();
    });
  });

  it("does not interfere with an active session", async () => {
    await withMemoryJobDb(async ({ db, runtime, gaia, status }) => {
      const scheduler = createMemorySleepScheduler({
        runtime,
        dependencies: createSchedulerTestDependencies({ status, gaia }),
        activityMonitor: {
          isSessionActive: () => true,
        },
      });
      const result = await scheduler.runOnce();
      expect(result.status).toBe("skipped-active");
      expect(result.jobRecords).toEqual([]);
      expect(result.telemetry.counts.sleep_preemptions).toBe(1);
      expect(readLedgerEventTypes(db)).toEqual([]);
      const jobRows = db
        .prepare(
          `SELECT job_id
           FROM memory_jobs
           ORDER BY job_id ASC`,
        )
        .all() as Array<{ job_id: string }>;
      expect(jobRows).toEqual([]);
      scheduler.close();
    });
  });
});
