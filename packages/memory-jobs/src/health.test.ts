import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySleepScheduler } from "./scheduler.js";
import { withMemoryJobDb } from "./test-utils.js";

describe("memory health dashboards", () => {
  it("reports stale claims, contradictions, orphan pages, broken attachments, and low-confidence items", async () => {
    await withMemoryJobDb(async ({ db, dbPath, workspaceDir, nowMs }) => {
      const missingAttachment = path.join(workspaceDir, "attachments", "missing.png");
      const existingAttachment = path.join(workspaceDir, "attachments", "ok.png");
      await fs.mkdir(path.dirname(existingAttachment), { recursive: true });
      await fs.writeFile(existingAttachment, "ok");

      const rows = [
        {
          id: "claim-old",
          kind: "claim",
          title: "Gateway needs a warm restart",
          updatedAt: nowMs - 45 * 24 * 60 * 60_000,
          metadata: { confidence: 0.9, truthValue: true },
        },
        {
          id: "claim-opposite",
          kind: "claim",
          title: "Gateway needs a warm restart",
          updatedAt: nowMs,
          metadata: { confidence: 0.88, truthValue: false },
        },
        {
          id: "claim-low-confidence",
          kind: "claim",
          title: "Matrix bridge flaps overnight",
          updatedAt: nowMs,
          metadata: { confidence: 0.2 },
        },
      ];
      for (const row of rows) {
        db.prepare(
          `INSERT INTO entities (
             entity_id, profile_id, workspace_scope, kind, slug, title, source_path, source_kind, content_hash, updated_at, metadata
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          row.id,
          "local-main",
          "ws-1",
          row.kind,
          row.id,
          row.title,
          `memory/${row.id}.md`,
          "workspace-memory",
          `hash-${row.id}`,
          row.updatedAt,
          JSON.stringify(row.metadata),
        );
        db.prepare(
          `INSERT INTO projections (
             projection_id, profile_id, workspace_scope, entity_id, projection_kind, relative_path, absolute_path, editable,
             source_kind, content_hash, frontmatter_json, markdown_body, updated_at, metadata
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          `projection-${row.id}`,
          "local-main",
          "ws-1",
          row.id,
          "markdown",
          `memory/${row.id}.md`,
          path.join(workspaceDir, "memory", `${row.id}.md`),
          1,
          "workspace-memory",
          `projection-hash-${row.id}`,
          JSON.stringify({ truthValue: row.metadata.truthValue }),
          row.title,
          row.updatedAt,
          JSON.stringify({
            attachments:
              row.id === "claim-old"
                ? [{ path: missingAttachment }]
                : [{ path: existingAttachment }],
          }),
        );
      }

      db.prepare(
        `INSERT INTO projections (
           projection_id, profile_id, workspace_scope, entity_id, projection_kind, relative_path, absolute_path, editable,
           source_kind, content_hash, frontmatter_json, markdown_body, updated_at, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "orphan-projection",
        "local-main",
        "ws-1",
        "missing-entity",
        "markdown",
        "memory/orphan.md",
        path.join(workspaceDir, "memory", "orphan.md"),
        1,
        "workspace-memory",
        "projection-hash-orphan",
        "{}",
        "orphan content",
        nowMs,
        "{}",
      );

      const scheduler = createMemorySleepScheduler({
        dbPath,
        profileId: "local-main",
        workspaceScope: "ws-1",
        workspaceDir,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
      });

      const result = scheduler.runOnce();
      expect(result.healthDashboard).toBeDefined();
      expect(result.healthDashboard?.staleClaims).toHaveLength(1);
      expect(result.healthDashboard?.contradictions).toHaveLength(1);
      expect(result.healthDashboard?.orphanPages).toHaveLength(1);
      expect(result.healthDashboard?.brokenAttachments).toHaveLength(1);
      expect(result.healthDashboard?.lowConfidenceItems).toHaveLength(1);
      scheduler.close();
    });
  });
});
