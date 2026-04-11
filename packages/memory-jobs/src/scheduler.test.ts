import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySleepScheduler } from "./scheduler.js";
import { withMemoryJobDb } from "./test-utils.js";

describe("memory sleep scheduler", () => {
  it("pauses and resumes deterministically without repeating promotions", async () => {
    await withMemoryJobDb(async ({ db, dbPath, workspaceDir, nowMs }) => {
      db.prepare(
        `INSERT INTO entities (
           entity_id, profile_id, workspace_scope, kind, slug, title, source_path, source_kind, content_hash, updated_at, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "candidate-a",
        "local-main",
        "ws-1",
        "candidate",
        "candidate-a",
        "Reset Discord token weekly",
        "memory/candidate-a.md",
        "workspace-memory",
        "hash-a",
        nowMs,
        JSON.stringify({ confidence: 0.92, evidenceCount: 5, recurrenceCount: 3 }),
      );
      db.prepare(
        `INSERT INTO entities (
           entity_id, profile_id, workspace_scope, kind, slug, title, source_path, source_kind, content_hash, updated_at, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "candidate-b",
        "local-main",
        "ws-1",
        "candidate",
        "candidate-b",
        "Gateway cache cleanup",
        "memory/candidate-b.md",
        "workspace-memory",
        "hash-b",
        nowMs,
        JSON.stringify({ confidence: 0.85, evidenceCount: 4 }),
      );
      db.prepare(
        `INSERT INTO projections (
           projection_id, profile_id, workspace_scope, entity_id, projection_kind, relative_path, absolute_path, editable,
           source_kind, content_hash, frontmatter_json, markdown_body, updated_at, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "projection-a",
        "local-main",
        "ws-1",
        "candidate-a",
        "markdown",
        "memory/candidate-a.md",
        path.join(workspaceDir, "memory", "candidate-a.md"),
        1,
        "workspace-memory",
        "projection-hash-a",
        "{}",
        "1. Open Discord\n2. Rotate token\n3. Restart agent\n",
        nowMs,
        "{}",
      );
      db.prepare(
        `INSERT INTO projections (
           projection_id, profile_id, workspace_scope, entity_id, projection_kind, relative_path, absolute_path, editable,
           source_kind, content_hash, frontmatter_json, markdown_body, updated_at, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "projection-b",
        "local-main",
        "ws-1",
        "candidate-b",
        "markdown",
        "memory/candidate-b.md",
        path.join(workspaceDir, "memory", "candidate-b.md"),
        1,
        "workspace-memory",
        "projection-hash-b",
        "{}",
        "Run cleanup after large sync imports.",
        nowMs,
        "{}",
      );

      let active = false;
      let calls = 0;
      let allowPreempt = true;
      const scheduler = createMemorySleepScheduler({
        dbPath,
        profileId: "local-main",
        workspaceScope: "ws-1",
        workspaceDir,
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

      const firstRun = scheduler.runOnce();
      expect(firstRun.status).toBe("preempted");

      active = false;
      calls = 0;
      allowPreempt = false;
      const secondRun = scheduler.runOnce();
      expect(["completed", "budget-exhausted"]).toContain(secondRun.status);

      const promotionRows = db
        .prepare(`SELECT entity_id, kind FROM entities ORDER BY entity_id ASC`)
        .all() as Array<{ entity_id: string; kind: string }>;
      expect(promotionRows).toEqual([
        { entity_id: "candidate-a", kind: "procedure" },
        { entity_id: "candidate-b", kind: "claim" },
      ]);

      const promotionEvents = scheduler.store
        .listAuditEvents({ profileId: "local-main", kind: "consolidate" })
        .filter(
          (event) =>
            event.eventType === "PROMOTED_TO_CLAIM" || event.eventType === "PROMOTED_TO_PROCEDURE",
        );
      expect(promotionEvents).toHaveLength(2);
      scheduler.close();
    });
  });

  it("does not run while an active session flag is set", async () => {
    await withMemoryJobDb(async ({ dbPath, workspaceDir }) => {
      const scheduler = createMemorySleepScheduler({
        dbPath,
        profileId: "local-main",
        workspaceScope: "ws-1",
        workspaceDir,
        activityMonitor: {
          isSessionActive: () => true,
        },
      });
      const result = scheduler.runOnce();
      expect(result.status).toBe("skipped-active");
      expect(result.jobRecords).toEqual([]);
      expect(result.telemetry.counts.sleep_preemptions).toBe(1);
      scheduler.close();
    });
  });
});
