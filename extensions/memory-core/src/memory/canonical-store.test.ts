import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AlisioConfig } from "alisio/plugin-sdk/memory-core-host-engine-foundation";
import { requireNodeSqlite } from "alisio/plugin-sdk/memory-core-host-engine-storage";
import {
  createDocStateFromMarkdown,
  createDocUpdateForMarkdown,
} from "alisio/plugin-sdk/memory-core-state";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  memoryPullApplySync,
  memoryWriteEvent,
  queryCanonicalMemoryGraph,
  syncCanonicalMemoryStore,
} from "./canonical-store.js";

type TestWorkspace = {
  root: string;
  stateDir: string;
  workspaceDir: string;
  cfg: AlisioConfig;
};

async function createTestWorkspace(prefix: string): Promise<TestWorkspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const stateDir = path.join(root, "state");
  const workspaceDir = path.join(root, "workspace");
  await fs.mkdir(path.join(stateDir, "alisio"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "alisio", "state.json"),
    JSON.stringify(
      {
        account: {
          profile: {
            username: "nuno",
            displayName: "Nuno Lopes",
            email: "nuno@example.com",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return {
    root,
    stateDir,
    workspaceDir,
    cfg: {
      agents: {
        defaults: {
          workspace: workspaceDir,
        },
      },
    } as AlisioConfig,
  };
}

function openDb(dbPath: string) {
  const { DatabaseSync } = requireNodeSqlite();
  return new DatabaseSync(dbPath);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canonical memory store", () => {
  it("migrates legacy markdown into ledger-derived state and materialized projections", async () => {
    const test = await createTestWorkspace("alisio-canonical-memory-migrate-");
    vi.stubEnv("ALISIO_STATE_DIR", test.stateDir);

    try {
      await fs.writeFile(
        path.join(test.workspaceDir, "MEMORY.md"),
        "# Team Memory\n\nSee [[memory/alpha]].\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(test.workspaceDir, "memory", "alpha.md"),
        "---\naliases:\n  - Alpha Project\ntags:\n  - project\n---\n# Alpha\n\nAlpha line.\n",
        "utf8",
      );

      const status = await syncCanonicalMemoryStore({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
      });

      expect(status.state).toBe("ready");
      expect(status.entities).toBe(2);
      expect(status.relations).toBe(1);
      expect(status.projections).toBe(2);
      expect(status.ledgerEventsCount).toBeGreaterThanOrEqual(6);
      expect(status.lastSyncedLamport).toBeGreaterThan(0);
      expect(status.e2eeRequired).toBe(true);

      const db = openDb(status.path);
      try {
        const ledgerCount = db.prepare(`SELECT COUNT(*) AS count FROM ledger_events`).get() as
          | { count: number }
          | undefined;
        const alphaProjection = db
          .prepare(
            `SELECT markdown_body
             FROM projections
             WHERE kind = ?`,
          )
          .get("legacy-markdown:memory/alpha.md") as { markdown_body: string } | undefined;

        expect(ledgerCount?.count).toBe(status.ledgerEventsCount);
        expect(alphaProjection?.markdown_body).toContain("Alpha line.");
      } finally {
        db.close();
      }

      const materializedRoot = await fs.readFile(
        path.join(test.stateDir, "workspace", "MEMORY.md"),
        "utf8",
      );
      const materializedAlpha = await fs.readFile(
        path.join(test.stateDir, "workspace", "memory", "alpha.md"),
        "utf8",
      );
      expect(materializedRoot).toContain("[[memory/alpha]]");
      expect(materializedAlpha).toContain("Alpha line.");

      const graph = queryCanonicalMemoryGraph({
        status,
        query: "Alpha Project",
        direction: "both",
        relationLimit: 4,
      });
      expect(graph.lastSyncedLamport).toBe(status.lastSyncedLamport);
      expect(graph.e2eeRequired).toBe(true);
      expect(graph.matches).toEqual([
        expect.objectContaining({
          sourcePath: "memory/alpha.md",
          sourceKind: "workspace-memory",
          tags: ["project"],
        }),
      ]);
    } finally {
      await fs.rm(test.root, { recursive: true, force: true });
    }
  });

  it("appends auditable document events and refreshes projections from derived state", async () => {
    const test = await createTestWorkspace("alisio-canonical-memory-write-");
    vi.stubEnv("ALISIO_STATE_DIR", test.stateDir);

    try {
      const pageId = "page-alpha";
      const initialState = createDocStateFromMarkdown("# Alpha\n\nOne.\n");
      const created = await memoryWriteEvent({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
        events: [
          {
            actorId: "gaia-device-a",
            pageId,
            type: "PAGE_CREATED",
            payload: {
              pageId,
              title: "Alpha",
              slug: "alpha",
              aliases: ["alpha"],
              tags: ["project"],
              createdAtMs: 1,
              updatedAtMs: 1,
            },
          },
          {
            actorId: "gaia-device-a",
            pageId,
            type: "DOC_CRDT_SNAPSHOT",
            payload: {
              pageId,
              yjsState: initialState,
            },
          },
          {
            actorId: "gaia-device-a",
            pageId,
            type: "PROJECTION_SET",
            payload: {
              pageId,
              kind: "legacy-markdown:memory/alpha.md",
            },
          },
        ],
      });

      const updated = await memoryWriteEvent({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
        events: [
          {
            actorId: "gaia-device-a",
            pageId,
            type: "DOC_CRDT_UPDATE",
            payload: {
              pageId,
              update: createDocUpdateForMarkdown({
                currentState: initialState,
                markdown: "# Alpha\n\nTwo.\n",
              }),
            },
          },
        ],
      });

      expect(created.events).toHaveLength(3);
      expect(updated.events).toHaveLength(1);
      expect(updated.events[0]?.type).toBe("DOC_CRDT_UPDATE");
      expect(updated.status.ledgerEventsCount).toBe(4);
      expect(updated.status.lastSyncedLamport).toBe(4);

      const db = openDb(updated.status.path);
      try {
        const projection = db
          .prepare(
            `SELECT markdown_body
             FROM projections
             WHERE page_id = ? AND kind = ?`,
          )
          .get(pageId, "legacy-markdown:memory/alpha.md") as { markdown_body: string } | undefined;
        const eventTypes = db
          .prepare(
            `SELECT event_type
             FROM ledger_events
             ORDER BY lamport ASC`,
          )
          .all() as Array<{ event_type: string }>;

        expect(projection?.markdown_body).toContain("Two.");
        expect(eventTypes.map((row) => row.event_type)).toEqual([
          "PAGE_CREATED",
          "DOC_CRDT_SNAPSHOT",
          "PROJECTION_SET",
          "DOC_CRDT_UPDATE",
        ]);
      } finally {
        db.close();
      }

      const materializedAlpha = await fs.readFile(
        path.join(test.stateDir, "workspace", "memory", "alpha.md"),
        "utf8",
      );
      expect(materializedAlpha).toContain("Two.");
    } finally {
      await fs.rm(test.root, { recursive: true, force: true });
    }
  });

  it("pulls decrypted sync events, appends them to the ledger, and updates sync status", async () => {
    const source = await createTestWorkspace("alisio-canonical-memory-sync-source-");
    const target = await createTestWorkspace("alisio-canonical-memory-sync-target-");

    try {
      vi.stubEnv("ALISIO_STATE_DIR", source.stateDir);
      const sourceResult = await memoryWriteEvent({
        cfg: source.cfg,
        agentId: "main",
        workspaceDir: source.workspaceDir,
        backend: "builtin",
        env: { ...process.env, ALISIO_STATE_DIR: source.stateDir },
        events: [
          {
            actorId: "gaia-device-a",
            pageId: "page-sync",
            type: "PAGE_CREATED",
            payload: {
              pageId: "page-sync",
              title: "Synced Page",
              slug: "synced-page",
              aliases: ["synced-page"],
              tags: ["shared"],
            },
          },
          {
            actorId: "gaia-device-a",
            pageId: "page-sync",
            type: "PROJECTION_SET",
            payload: {
              pageId: "page-sync",
              kind: "legacy-markdown:memory/synced-page.md",
              markdownBody: "# Synced Page\n\nCiphertext arrived.\n",
            },
          },
        ],
      });

      const encryptedEvents = sourceResult.events.map((event) => ({
        ciphertext: Buffer.from(JSON.stringify(event), "utf8").toString("base64"),
      }));

      vi.stubEnv("ALISIO_STATE_DIR", target.stateDir);
      const syncResult = await memoryPullApplySync({
        cfg: target.cfg,
        agentId: "main",
        workspaceDir: target.workspaceDir,
        backend: "builtin",
        env: { ...process.env, ALISIO_STATE_DIR: target.stateDir },
        encryptedEvents,
        decryptEvent: async (event) =>
          JSON.parse(Buffer.from(event.ciphertext, "base64").toString("utf8")),
      });

      expect(syncResult.appliedCount).toBe(2);
      expect(syncResult.status.cloudSync).toBe("enabled");
      expect(syncResult.status.ledgerEventsCount).toBe(2);
      expect(syncResult.status.lastSyncedLamport).toBe(2);
      expect(syncResult.status.checkpointsCount).toBe(0);
      expect(syncResult.status.e2eeRequired).toBe(true);

      const materialized = await fs.readFile(
        path.join(target.stateDir, "workspace", "memory", "synced-page.md"),
        "utf8",
      );
      expect(materialized).toContain("Ciphertext arrived.");
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(source.root, { recursive: true, force: true });
      await fs.rm(target.root, { recursive: true, force: true });
    }
  });
});
