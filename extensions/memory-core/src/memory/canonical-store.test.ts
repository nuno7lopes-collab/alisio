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
  createMemoryCrypto,
  deriveProfileRootKey,
  exportPairingCode,
  setupProfileRootKey,
} from "../../../../packages/memory-crypto/src/index.js";
import { openLedger } from "../../../../packages/memory-ledger/src/index.js";
import {
  memoryPullApplySync,
  memoryWriteEvent,
  queryCanonicalMemoryGraph,
  syncCanonicalMemoryStore,
} from "./canonical-store.js";
import { listMemoryStateEventsSince } from "./ledger-interop.js";

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

function withLedger<T>(
  profileId: string,
  stateDir: string,
  run: (ledger: ReturnType<typeof openLedger>) => T,
): T {
  const ledger = openLedger(profileId, { stateDir });
  try {
    return run(ledger);
  } finally {
    ledger.close();
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canonical memory store", () => {
  it("imports workspace markdown into ledger-derived state and materialized projections", async () => {
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
        const alphaProjection = db
          .prepare(
            `SELECT markdown_body
             FROM projections
             WHERE kind = ?`,
          )
          .get("md-path:memory/alpha.md") as { markdown_body: string } | undefined;

        const ledgerCount = withLedger(
          status.profileId,
          test.stateDir,
          (ledger) => ledger.getStats().eventCount,
        );

        expect(ledgerCount).toBe(status.ledgerEventsCount);
        expect(alphaProjection?.markdown_body).toContain("Alpha line.");
      } finally {
        db.close();
      }

      const materializedRoot = await fs.readFile(path.join(test.workspaceDir, "MEMORY.md"), "utf8");
      const materializedAlpha = await fs.readFile(
        path.join(test.workspaceDir, "memory", "alpha.md"),
        "utf8",
      );
      expect(materializedRoot).toContain("[[memory/alpha]]");
      expect(materializedAlpha).toContain("Alpha line.");
      await expect(
        fs.readFile(path.join(test.stateDir, "workspace", "MEMORY.md"), "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        fs.readFile(path.join(test.stateDir, "workspace", "memory", "alpha.md"), "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });

      const graph = queryCanonicalMemoryGraph({
        status,
        query: "Alpha Project",
        direction: "both",
        relationLimit: 4,
      });
      const focusId = graph.focus?.pageId ?? graph.matches[0]?.entityId;
      expect(graph.lastSyncedLamport).toBe(status.lastSyncedLamport);
      expect(graph.e2eeRequired).toBe(true);
      expect(graph.scope).toBe("local");
      expect(graph.mode).toBe("focus");
      expect(graph.focus).toEqual(
        expect.objectContaining({
          pageId: focusId,
          entityId: focusId,
        }),
      );
      expect(graph.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pageId: focusId,
            sourcePath: "memory/alpha.md",
            tags: ["project"],
          }),
        ]),
      );
      expect(graph.edges).toEqual([
        expect.objectContaining({
          relationType: "references",
          toPageId: focusId,
        }),
      ]);
      expect(graph.matches).toEqual([
        expect.objectContaining({
          entityId: focusId,
          sourcePath: "memory/alpha.md",
          sourceKind: "workspace-memory",
          tags: ["project"],
        }),
      ]);
    } finally {
      await fs.rm(test.root, { recursive: true, force: true });
    }
  });

  it("revives tombstoned projected pages even when imported_files is empty", async () => {
    const test = await createTestWorkspace("alisio-canonical-memory-revive-projected-");
    vi.stubEnv("ALISIO_STATE_DIR", test.stateDir);

    try {
      await fs.writeFile(
        path.join(test.workspaceDir, "MEMORY.md"),
        "# Team Memory\n\nSee [[memory/alpha]].\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(test.workspaceDir, "memory", "alpha.md"),
        "# Alpha\n\nRevive me.\n",
        "utf8",
      );

      const initial = await syncCanonicalMemoryStore({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
      });

      const db = openDb(initial.path);
      try {
        db.exec(`DELETE FROM imported_files;`);
        db.exec(`UPDATE pages SET tombstoned = 1;`);
      } finally {
        db.close();
      }

      const revived = await syncCanonicalMemoryStore({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
      });
      const revivedDb = openDb(revived.path);
      try {
        const rows = revivedDb
          .prepare(
            `SELECT title, tombstoned
             FROM pages
             ORDER BY title ASC`,
          )
          .all() as Array<{ title: string; tombstoned: number }>;
        expect(rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ title: "Alpha", tombstoned: 0 }),
            expect.objectContaining({ title: "Team Memory", tombstoned: 0 }),
          ]),
        );
      } finally {
        revivedDb.close();
      }
    } finally {
      await fs.rm(test.root, { recursive: true, force: true });
    }
  });

  it("keeps projected workspace pages active across repeated syncs when markdown is unchanged", async () => {
    const test = await createTestWorkspace("alisio-canonical-memory-repeat-sync-");
    vi.stubEnv("ALISIO_STATE_DIR", test.stateDir);

    try {
      await fs.writeFile(
        path.join(test.workspaceDir, "MEMORY.md"),
        "# Team Memory\n\nSee [[memory/alpha]].\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(test.workspaceDir, "memory", "alpha.md"),
        "# Alpha\n\nStill here.\n",
        "utf8",
      );

      const initial = await syncCanonicalMemoryStore({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
      });

      const repeated = await syncCanonicalMemoryStore({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
      });

      const db = openDb(repeated.path);
      try {
        const pages = db
          .prepare(
            `SELECT title, tombstoned
             FROM pages
             ORDER BY title ASC`,
          )
          .all() as Array<{ title: string; tombstoned: number }>;
        const importedCount =
          (
            db.prepare(`SELECT COUNT(*) AS count FROM imported_files`).get() as
              | { count?: number }
              | undefined
          )?.count ?? 0;

        expect(initial.entities).toBe(2);
        expect(repeated.entities).toBe(2);
        expect(importedCount).toBe(2);
        expect(pages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ title: "Alpha", tombstoned: 0 }),
            expect.objectContaining({ title: "Team Memory", tombstoned: 0 }),
          ]),
        );
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(test.root, { recursive: true, force: true });
    }
  });

  it("uses configured sync settings even when removed sync env vars are present", async () => {
    const test = await createTestWorkspace("alisio-canonical-memory-sync-config-");
    vi.stubEnv("ALISIO_STATE_DIR", test.stateDir);

    try {
      await setupProfileRootKey({
        profileId: "local-nuno",
        passphrase: "config preferred passphrase",
        stateDir: test.stateDir,
        env: {
          ...process.env,
          ALISIO_STATE_DIR: test.stateDir,
        },
      });

      const status = await syncCanonicalMemoryStore({
        cfg: {
          ...test.cfg,
          memory: {
            sync: {
              mode: "cloud",
              relayBaseUrl: "https://config-relay.example",
            },
          },
        } as AlisioConfig,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: {
          ...process.env,
          ALISIO_STATE_DIR: test.stateDir,
        },
      });

      expect(status.e2eeRequired).toBe(true);
      expect(status.syncModeConfigured).toBe("cloud");
      expect(["missing_access_token", "missing_profile_key"]).toContain(status.syncBlockedReason);
      expect(status.lastError).toMatch(/memory sync blocked:/);
    } finally {
      await fs.rm(test.root, { recursive: true, force: true });
    }
  });

  it("builds a global graph with stable deduplicated canonical edge ids", async () => {
    const test = await createTestWorkspace("alisio-canonical-memory-graph-global-");
    vi.stubEnv("ALISIO_STATE_DIR", test.stateDir);

    try {
      await fs.writeFile(
        path.join(test.workspaceDir, "MEMORY.md"),
        "# Team Memory\n\nSee [[memory/alpha]] and [[memory/beta]].\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(test.workspaceDir, "memory", "alpha.md"),
        "# Alpha\n\nDepends on [[memory/beta]].\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(test.workspaceDir, "memory", "beta.md"),
        "# Beta\n\nShips with [[memory/gamma]].\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(test.workspaceDir, "memory", "gamma.md"),
        "# Gamma\n\nReference leaf.\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(test.workspaceDir, "memory", "delta.md"),
        "# Delta\n\nStandalone note.\n",
        "utf8",
      );

      const status = await syncCanonicalMemoryStore({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
      });

      const graph = queryCanonicalMemoryGraph({
        status,
        scope: "global",
        direction: "both",
        depth: 2,
        nodeLimit: 16,
        edgeLimit: 16,
        relationLimit: 8,
      });

      expect(graph.scope).toBe("global");
      expect(graph.mode).toBe("overview");
      expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(graph.edges.length);
      expect(graph.edges).toEqual(
        expect.arrayContaining(
          graph.edges.map((edge) =>
            expect.objectContaining({
              id: `${edge.fromPageId}:${edge.relationType}:${edge.ordinal}:${edge.toPageId}`,
            }),
          ),
        ),
      );

      const nodeIdByTitle = new Map(graph.nodes.map((node) => [node.title, node.id]));
      const alphaId = nodeIdByTitle.get("Alpha");
      const betaId = nodeIdByTitle.get("Beta");
      const gammaId = nodeIdByTitle.get("Gamma");
      const deltaId = nodeIdByTitle.get("Delta");

      expect(alphaId).toBeTruthy();
      expect(betaId).toBeTruthy();
      expect(gammaId).toBeTruthy();
      expect(deltaId).toBeTruthy();
      expect(graph.nodes).toHaveLength(5);

      const alphaBetaEdges = graph.edges.filter(
        (edge) => edge.fromId === alphaId && edge.toId === betaId,
      );
      const betaGammaEdges = graph.edges.filter(
        (edge) => edge.fromId === betaId && edge.toId === gammaId,
      );

      expect(alphaBetaEdges).toHaveLength(1);
      expect(betaGammaEdges).toHaveLength(1);
      expect(graph.focus).toBeUndefined();
      expect(graph.branches).toEqual([]);
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
              kind: "md-path:memory/alpha.md",
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
          .get(pageId, "md-path:memory/alpha.md") as { markdown_body: string } | undefined;
        const eventTypes = withLedger(updated.status.profileId, test.stateDir, (ledger) =>
          listMemoryStateEventsSince({
            ledger,
            lamportExclusive: 0,
          }).map((event) => event.type),
        );

        expect(projection?.markdown_body).toContain("Two.");
        expect(eventTypes).toEqual([
          "PAGE_CREATED",
          "DOC_CRDT_SNAPSHOT",
          "PROJECTION_SET",
          "DOC_CRDT_UPDATE",
        ]);
      } finally {
        db.close();
      }

      const materializedAlpha = await fs.readFile(
        path.join(test.workspaceDir, "memory", "alpha.md"),
        "utf8",
      );
      expect(materializedAlpha).toContain("Two.");
      await expect(
        fs.readFile(path.join(test.stateDir, "workspace", "memory", "alpha.md"), "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fs.rm(test.root, { recursive: true, force: true });
    }
  });

  it("materializes visible workspace projections only in the active workspace", async () => {
    const test = await createTestWorkspace("alisio-canonical-memory-workspace-only-");
    vi.stubEnv("ALISIO_STATE_DIR", test.stateDir);

    try {
      const pageId = "page-workspace-only";
      const writeResult = await memoryWriteEvent({
        cfg: {
          ...test.cfg,
          memory: {
            markdownProjection: {
              enabled: true,
            },
          },
        } as AlisioConfig,
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
              yjsState: createDocStateFromMarkdown("# Alpha\n\nWorkspace only.\n"),
            },
          },
          {
            actorId: "gaia-device-a",
            pageId,
            type: "PROJECTION_SET",
            payload: {
              pageId,
              kind: "md-path:memory/alpha.md",
            },
          },
        ],
      });

      const materializedAlpha = await fs.readFile(
        path.join(test.workspaceDir, "memory", "alpha.md"),
        "utf8",
      );

      expect(writeResult.status.ledgerEventsCount).toBe(3);
      expect(materializedAlpha).toContain("Workspace only.");
      await expect(
        fs.readFile(path.join(test.stateDir, "workspace", "memory", "alpha.md"), "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fs.rm(test.root, { recursive: true, force: true });
    }
  });

  it("removes materialized markdown files once the page is tombstoned", async () => {
    const test = await createTestWorkspace("alisio-canonical-memory-tombstone-materialize-");
    vi.stubEnv("ALISIO_STATE_DIR", test.stateDir);

    try {
      const pageId = "page-tombstoned-projection";
      await memoryWriteEvent({
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
              title: "Ephemeral",
              slug: "ephemeral",
              aliases: ["ephemeral"],
              tags: ["backlog"],
              createdAtMs: 1,
              updatedAtMs: 1,
            },
          },
          {
            actorId: "gaia-device-a",
            pageId,
            type: "PROJECTION_SET",
            payload: {
              pageId,
              kind: "md-path:memory/ephemeral.md",
              markdownBody: "# Ephemeral\n\nThis should disappear.\n",
            },
          },
        ],
      });

      await fs.readFile(path.join(test.workspaceDir, "memory", "ephemeral.md"), "utf8");
      await expect(
        fs.readFile(path.join(test.stateDir, "workspace", "memory", "ephemeral.md"), "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });

      await memoryWriteEvent({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
        events: [
          {
            actorId: "gaia-device-a",
            pageId,
            type: "PAGE_TOMBSTONED",
            payload: {
              pageId,
              tombstoned: true,
              updatedAtMs: 2,
            },
          },
        ],
      });

      await expect(
        fs.readFile(path.join(test.workspaceDir, "memory", "ephemeral.md"), "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        fs.readFile(path.join(test.stateDir, "workspace", "memory", "ephemeral.md"), "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await fs.rm(test.root, { recursive: true, force: true });
    }
  });

  it("pulls decrypted sync events, appends them to the ledger, and updates sync status", async () => {
    const source = await createTestWorkspace("alisio-canonical-memory-sync-source-");
    const target = await createTestWorkspace("alisio-canonical-memory-sync-target-");

    try {
      const passphrase = "canonical sync pairing test";
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
              kind: "md-path:memory/synced-page.md",
              markdownBody: "# Synced Page\n\nCiphertext arrived.\n",
            },
          },
        ],
      });

      const sharedRootKey = await deriveProfileRootKey({
        profileId: sourceResult.status.profileId,
        passphrase,
      });
      const pairingCode = await exportPairingCode({
        profileId: sourceResult.status.profileId,
        profileRootKey: sharedRootKey,
        passphrase,
        sourceDeviceId: "gaia-device-a",
      });
      const crypto = createMemoryCrypto({ profileRootKey: sharedRootKey });
      const sourceLedger = openLedger(sourceResult.status.profileId, {
        stateDir: source.stateDir,
      });
      const encryptedEvents = await Promise.all(
        sourceLedger.listEventsSince(0, 10).map(async (event) => {
          if (event.payload.kind !== "plain") {
            throw new Error("expected plain local ledger payload for sync test");
          }
          const cipher = await crypto.encryptEventPayload(
            {
              profileId: sourceResult.status.profileId,
              deviceId: event.meta.deviceId,
              lamport: event.meta.lamport,
              eventType: event.meta.eventType,
              schemaVersion: event.meta.schemaVersion,
              eventId: event.meta.eventId,
            },
            event.payload.bytes,
          );
          return {
            eventId: event.meta.eventId,
            deviceId: event.meta.deviceId,
            lamport: event.meta.lamport,
            eventType: event.meta.eventType,
            schemaVersion: event.meta.schemaVersion,
            createdAtMs: event.meta.createdAtMs,
            ciphertext: cipher.ciphertext,
            nonce: cipher.nonce,
          };
        }),
      );
      sourceLedger.close();

      vi.stubEnv("ALISIO_STATE_DIR", target.stateDir);
      const syncResult = await memoryPullApplySync({
        cfg: target.cfg,
        agentId: "main",
        workspaceDir: target.workspaceDir,
        backend: "builtin",
        env: {
          ...process.env,
          ALISIO_STATE_DIR: target.stateDir,
          ALISIO_MEMORY_SYNC_PAIRING_CODE: pairingCode,
          ALISIO_MEMORY_SYNC_PAIRING_PASSPHRASE: passphrase,
        },
        encryptedEvents,
      });

      expect(syncResult.appliedCount).toBe(2);
      expect(syncResult.status.cloudSync).toBe("enabled");
      expect(syncResult.status.ledgerEventsCount).toBe(2);
      expect(syncResult.status.lastSyncedLamport).toBe(2);
      expect(syncResult.status.checkpointsCount).toBe(0);
      expect(syncResult.status.e2eeRequired).toBe(true);

      const materialized = await fs.readFile(
        path.join(target.workspaceDir, "memory", "synced-page.md"),
        "utf8",
      );
      expect(materialized).toContain("Ciphertext arrived.");
      await expect(
        fs.readFile(path.join(target.stateDir, "workspace", "memory", "synced-page.md"), "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(source.root, { recursive: true, force: true });
      await fs.rm(target.root, { recursive: true, force: true });
    }
  });

  it("restores the latest checkpoint without regressing lamport metadata", async () => {
    const test = await createTestWorkspace("alisio-canonical-memory-checkpoint-");
    vi.stubEnv("ALISIO_STATE_DIR", test.stateDir);

    try {
      const pageId = "page-checkpoint";
      const writeResult = await memoryWriteEvent({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
        encryptCheckpointSnapshot: async () => "cipher-checkpoint",
        events: [
          {
            actorId: "gaia-device-a",
            pageId,
            type: "PAGE_CREATED",
            payload: {
              pageId,
              title: "Checkpoint",
              slug: "checkpoint",
              aliases: ["checkpoint"],
              tags: ["state"],
              createdAtMs: 1,
              updatedAtMs: 1,
            },
          },
          ...Array.from({ length: 49 }, (_, index) => ({
            actorId: "gaia-device-a",
            pageId,
            type: "PROJECTION_SET" as const,
            payload: {
              pageId,
              kind: "md-path:memory/checkpoint.md",
              markdownBody: `# Checkpoint\n\n${index}\n`,
            },
          })),
        ],
      });

      expect(writeResult.status.ledgerEventsCount).toBe(51);
      expect(writeResult.status.lastSyncedLamport).toBe(51);
      expect(writeResult.status.checkpointsCount).toBe(1);

      const reopened = await syncCanonicalMemoryStore({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
      });

      expect(reopened.ledgerEventsCount).toBe(51);
      expect(reopened.lastSyncedLamport).toBe(51);
      expect(reopened.checkpointsCount).toBe(1);

      const db = openDb(reopened.path);
      try {
        const meta = db
          .prepare(
            `SELECT last_applied_lamport, last_checkpoint_id
             FROM meta`,
          )
          .get() as
          | {
              last_applied_lamport: number;
              last_checkpoint_id: string | null;
            }
          | undefined;
        const checkpoint = withLedger(reopened.profileId, test.stateDir, (ledger) =>
          ledger.getLatestCheckpoint(),
        );

        expect(meta?.last_applied_lamport).toBe(51);
        expect(meta?.last_checkpoint_id).toBe(checkpoint?.checkpointId);
        expect(
          checkpoint?.payloadCipher ? Buffer.from(checkpoint.payloadCipher).toString("utf8") : null,
        ).toBe("cipher-checkpoint");
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(test.root, { recursive: true, force: true });
    }
  });

  it("can force a checkpoint for job progress events before the normal interval", async () => {
    const test = await createTestWorkspace("alisio-canonical-memory-job-checkpoint-");
    vi.stubEnv("ALISIO_STATE_DIR", test.stateDir);

    try {
      const writeResult = await memoryWriteEvent({
        cfg: test.cfg,
        agentId: "main",
        workspaceDir: test.workspaceDir,
        backend: "builtin",
        env: process.env,
        forceCheckpoint: true,
        events: [
          {
            actorId: "gaia-sleep",
            type: "JOB_CHECKPOINT_UPDATED",
            source: "sleep/health",
            batchId: "health:main",
            payload: {
              jobId: "health:main",
              profileId: "local-main",
              kind: "health",
              reason: "threshold",
              cursor: {
                phase: "lowConfidenceItems",
              },
              pendingEventCount: 8,
              pendingPayloadBytes: 4096,
            },
          },
        ],
      });

      expect(writeResult.status.ledgerEventsCount).toBe(2);
      expect(writeResult.status.lastSyncedLamport).toBe(2);
      expect(writeResult.status.checkpointsCount).toBe(1);

      const db = openDb(writeResult.status.path);
      try {
        const eventTypes = withLedger(writeResult.status.profileId, test.stateDir, (ledger) =>
          listMemoryStateEventsSince({
            ledger,
            lamportExclusive: 0,
          }).map((event) => ({ event_type: event.type })),
        );
        const checkpoint = withLedger(writeResult.status.profileId, test.stateDir, (ledger) =>
          ledger.getLatestCheckpoint(),
        );

        expect(eventTypes).toEqual([
          { event_type: "JOB_CHECKPOINT_UPDATED" },
          { event_type: "CHECKPOINT_CREATED" },
        ]);
        expect(checkpoint?.checkpointId).toBeTruthy();
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(test.root, { recursive: true, force: true });
    }
  });
});
