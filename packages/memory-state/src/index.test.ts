import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyEventToDerivedState,
  applyDocUpdateToState,
  captureMemoryStateCheckpoint,
  createDocStateFromMarkdown,
  createDocUpdateForMarkdown,
  ensureMemoryStateSchema,
  restoreMemoryStateCheckpoint,
  rebuildDerivedStateFromEvents,
} from "./index.js";
import type { MemoryStateEventEnvelopePlain } from "./index.js";

function createTestDb() {
  const db = new DatabaseSync(":memory:");
  ensureMemoryStateSchema(db);
  return db;
}

function makeEvents(): MemoryStateEventEnvelopePlain[] {
  return [
    {
      schemaVersion: 1,
      eventId: "event-1",
      lamport: 1,
      actorId: "gaia",
      createdAtMs: 1,
      type: "PAGE_CREATED",
      payload: {
        pageId: "page-1",
        title: "Alpha",
        slug: "alpha",
        aliases: ["alpha"],
        tags: ["project"],
      },
    },
    {
      schemaVersion: 1,
      eventId: "event-2",
      lamport: 2,
      actorId: "gaia",
      createdAtMs: 2,
      type: "DOC_CRDT_SNAPSHOT",
      payload: {
        pageId: "page-1",
        yjsState: createDocStateFromMarkdown("# Alpha\n\nHello world.\n"),
      },
    },
    {
      schemaVersion: 1,
      eventId: "event-3",
      lamport: 3,
      actorId: "gaia",
      createdAtMs: 3,
      type: "PROJECTION_SET",
      payload: {
        pageId: "page-1",
        kind: "legacy-markdown:memory/alpha.md",
      },
    },
    {
      schemaVersion: 1,
      eventId: "event-4",
      lamport: 4,
      actorId: "gaia",
      createdAtMs: 4,
      type: "JOB_CHECKPOINT_UPDATED",
      payload: {
        jobId: "health:ws-1",
        profileId: "local-nuno",
        kind: "health",
        reason: "threshold",
        cursor: { phase: "lowConfidenceItems" },
        pendingEventCount: 8,
        pendingPayloadBytes: 1024,
      },
    },
  ];
}

describe("memory-state", () => {
  afterEach(() => {
    // Nothing global to clean up.
  });

  it("rebuilds deterministically from the same ledger", () => {
    const events = makeEvents();
    const firstDb = createTestDb();
    const secondDb = createTestDb();
    try {
      const first = rebuildDerivedStateFromEvents({ db: firstDb, events, migrationVersion: 1 });
      const second = rebuildDerivedStateFromEvents({ db: secondDb, events, migrationVersion: 1 });
      expect(first.lastAppliedLamport).toBe(4);
      expect(first.stateHash).toBe(second.stateHash);
    } finally {
      firstDb.close();
      secondDb.close();
    }
  });

  it("restores checkpoint snapshots losslessly", () => {
    const db = createTestDb();
    const restored = createTestDb();
    try {
      rebuildDerivedStateFromEvents({ db, events: makeEvents(), migrationVersion: 1 });
      const snapshot = captureMemoryStateCheckpoint(db);
      restoreMemoryStateCheckpoint(restored, snapshot);
      expect(captureMemoryStateCheckpoint(restored)).toEqual(snapshot);
    } finally {
      db.close();
      restored.close();
    }
  });

  it("converges CRDT updates applied out of order", () => {
    const baseState = createDocStateFromMarkdown("# Page\n\nbase\n");
    const leftUpdate = createDocUpdateForMarkdown({
      currentState: baseState,
      markdown: "# Page\n\nbase\nleft\n",
    });
    const rightUpdate = createDocUpdateForMarkdown({
      currentState: baseState,
      markdown: "# Page\n\nbase\nright\n",
    });
    const first = applyDocUpdateToState({
      currentState: applyDocUpdateToState({ currentState: baseState, update: leftUpdate }).yjsState,
      update: rightUpdate,
    });
    const second = applyDocUpdateToState({
      currentState: applyDocUpdateToState({ currentState: baseState, update: rightUpdate })
        .yjsState,
      update: leftUpdate,
    });
    expect(first.markdown).toBe(second.markdown);
  });

  it("revives a tombstoned page when metadata is re-imported", () => {
    const db = createTestDb();
    try {
      applyEventToDerivedState({
        db,
        migrationVersion: 1,
        event: {
          schemaVersion: 1,
          eventId: "event-page-created",
          lamport: 1,
          actorId: "gaia",
          createdAtMs: 1,
          type: "PAGE_CREATED",
          payload: {
            pageId: "page-1",
            title: "Alpha",
            slug: "alpha",
            aliases: ["alpha"],
            tags: ["project"],
          },
        },
      });
      applyEventToDerivedState({
        db,
        migrationVersion: 1,
        event: {
          schemaVersion: 1,
          eventId: "event-page-tombstoned",
          lamport: 2,
          actorId: "gaia",
          createdAtMs: 2,
          type: "PAGE_TOMBSTONED",
          payload: {
            pageId: "page-1",
            tombstoned: true,
            updatedAtMs: 2,
          },
        },
      });
      applyEventToDerivedState({
        db,
        migrationVersion: 1,
        event: {
          schemaVersion: 1,
          eventId: "event-page-metadata-updated",
          lamport: 3,
          actorId: "gaia",
          createdAtMs: 3,
          type: "PAGE_METADATA_UPDATED",
          payload: {
            pageId: "page-1",
            title: "Alpha",
            slug: "alpha",
            aliases: ["alpha"],
            tags: ["project", "revived"],
            updatedAtMs: 3,
          },
        },
      });

      const page = db
        .prepare(
          `SELECT tombstoned, updated_at_ms
           FROM pages
           WHERE page_id = ?`,
        )
        .get("page-1") as
        | {
            tombstoned: number;
            updated_at_ms: number;
          }
        | undefined;
      expect(page?.tombstoned).toBe(0);
      expect(page?.updated_at_ms).toBe(3);
    } finally {
      db.close();
    }
  });
});
