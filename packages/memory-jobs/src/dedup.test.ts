import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySleepScheduler } from "./scheduler.js";
import { withMemoryJobDb } from "./test-utils.js";

describe("memory dedup job", () => {
  it("proposes merges until explicit confirmation enables auto-merge", async () => {
    await withMemoryJobDb(async ({ db, dbPath, workspaceDir, nowMs }) => {
      for (const id of ["claim-a", "claim-b"]) {
        db.prepare(
          `INSERT INTO entities (
             entity_id, profile_id, workspace_scope, kind, slug, title, source_path, source_kind, content_hash, updated_at, metadata
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          "local-main",
          "ws-1",
          "claim",
          "same-claim",
          "Gateway warm restart runbook",
          `memory/${id}.md`,
          "workspace-memory",
          id === "claim-a" ? "hash-same" : "hash-same",
          nowMs,
          JSON.stringify({ confidence: 0.9 }),
        );
        db.prepare(
          `INSERT INTO projections (
             projection_id, profile_id, workspace_scope, entity_id, projection_kind, relative_path, absolute_path, editable,
             source_kind, content_hash, frontmatter_json, markdown_body, updated_at, metadata
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          `projection-${id}`,
          "local-main",
          "ws-1",
          id,
          "markdown",
          `memory/${id}.md`,
          path.join(workspaceDir, "memory", `${id}.md`),
          1,
          "workspace-memory",
          "projection-hash-same",
          "{}",
          "1. Restart gateway\n2. Wait for status green\n",
          nowMs,
          "{}",
        );
      }

      const proposeOnly = createMemorySleepScheduler({
        dbPath,
        profileId: "local-main",
        workspaceScope: "ws-1",
        workspaceDir,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
      });
      proposeOnly.runOnce();
      const proposed = proposeOnly.store
        .listAuditEvents({ profileId: "local-main", kind: "dedup" })
        .filter((event) => event.eventType === "MERGE_PROPOSED");
      expect(proposed.length).toBeGreaterThan(0);
      proposeOnly.close();

      const mergeConfirmed = createMemorySleepScheduler({
        dbPath,
        profileId: "local-main",
        workspaceScope: "ws-1",
        workspaceDir,
        autoMergeConfirmed: true,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
      });
      mergeConfirmed.runOnce();

      const remaining = db
        .prepare(`SELECT entity_id FROM entities ORDER BY entity_id ASC`)
        .all() as Array<{ entity_id: string }>;
      expect(remaining).toHaveLength(1);
      const mergedEvents = mergeConfirmed.store
        .listAuditEvents({ profileId: "local-main", kind: "dedup" })
        .filter((event) => event.eventType === "ENTITY_MERGED");
      expect(mergedEvents).toHaveLength(1);
      mergeConfirmed.close();
    });
  });
});
