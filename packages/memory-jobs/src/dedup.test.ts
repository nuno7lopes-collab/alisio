import { describe, expect, it } from "vitest";
import { createMemorySleepScheduler } from "./scheduler.js";
import { withMemoryJobDb } from "./test-utils.js";

describe("memory dedup job", () => {
  it("proposes merges until explicit confirmation enables auto-merge", async () => {
    await withMemoryJobDb(async ({ db, nowMs, gaia, runtime, status }) => {
      await gaia.writeEvents([
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "page-claim-a",
          pageId: "claim-a",
          source: "test",
          type: "PAGE_CREATED",
          payload: {
            pageId: "claim-a",
            title: "Gateway warm restart runbook",
            slug: "same-claim",
            aliases: ["same-claim"],
            tags: ["claim"],
            createdAtMs: nowMs,
            updatedAtMs: nowMs,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "projection-claim-a",
          pageId: "claim-a",
          source: "test",
          type: "PROJECTION_SET",
          payload: {
            pageId: "claim-a",
            kind: "legacy-markdown:memory/claim-a.md",
            markdownBody: "1. Restart gateway\n2. Wait for status green\n",
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "claim-claim-a",
          pageId: "claim-a",
          source: "test",
          type: "CLAIM_UPSERTED",
          payload: {
            claimId: "claim-a",
            subject: "gateway",
            predicate: "restart_runbook",
            object: "warm restart",
            confidence: 0.9,
            status: "active",
            updatedAtMs: nowMs,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "page-claim-b",
          pageId: "claim-b",
          source: "test",
          type: "PAGE_CREATED",
          payload: {
            pageId: "claim-b",
            title: "Gateway warm restart runbook",
            slug: "same-claim-copy",
            aliases: ["same-claim-copy"],
            tags: ["claim"],
            createdAtMs: nowMs,
            updatedAtMs: nowMs,
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "projection-claim-b",
          pageId: "claim-b",
          source: "test",
          type: "PROJECTION_SET",
          payload: {
            pageId: "claim-b",
            kind: "legacy-markdown:memory/claim-b.md",
            markdownBody:
              "1. Restart gateway\n2. Wait for status green\n3. Confirm workers are back\n",
          },
        },
        {
          actorId: "test",
          createdAtMs: nowMs,
          eventId: "claim-claim-b",
          pageId: "claim-b",
          source: "test",
          type: "CLAIM_UPSERTED",
          payload: {
            claimId: "claim-b",
            subject: "gateway",
            predicate: "restart_runbook",
            object: "warm restart",
            confidence: 0.92,
            status: "active",
            updatedAtMs: nowMs,
          },
        },
      ]);

      const proposeOnly = createMemorySleepScheduler({
        runtime,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
      });
      await proposeOnly.runOnce();
      const proposed = proposeOnly.store
        .listAuditEvents({ profileId: status.profileId, kind: "dedup" })
        .filter((event) => event.eventType === "MERGE_PROPOSED");
      expect(proposed.length).toBeGreaterThan(0);
      proposeOnly.close();

      const mergeConfirmed = createMemorySleepScheduler({
        runtime,
        autoMergeConfirmed: true,
        featureFlags: {
          enabled: true,
          maxWallTimeMs: 5_000,
        },
      });
      await mergeConfirmed.runOnce();

      const pages = db
        .prepare(
          `SELECT page_id, tombstoned
           FROM pages
           ORDER BY page_id ASC`,
        )
        .all() as Array<{ page_id: string; tombstoned: number }>;
      expect(pages.filter((page) => page.tombstoned === 0)).toHaveLength(1);
      expect(pages.filter((page) => page.tombstoned === 1)).toHaveLength(1);

      const claims = db
        .prepare(
          `SELECT claim_id, status
           FROM claims
           ORDER BY claim_id ASC`,
        )
        .all() as Array<{ claim_id: string; status: string }>;
      expect(claims.filter((claim) => claim.status === "active")).toHaveLength(1);
      expect(claims.filter((claim) => claim.status === "merged")).toHaveLength(1);

      const mergedEvents = mergeConfirmed.store
        .listAuditEvents({ profileId: status.profileId, kind: "dedup" })
        .filter((event) => event.eventType === "ENTITY_MERGED");
      expect(mergedEvents).toHaveLength(1);
      mergeConfirmed.close();
    });
  });
});
