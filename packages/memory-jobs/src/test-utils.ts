import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AlisioConfig } from "alisio/plugin-sdk/config-runtime";
import type { CanonicalMemoryStoreStatus } from "alisio/plugin-sdk/memory-core-engine-runtime";
import {
  applyEventToDerivedState,
  computeMemoryStateHash,
  ensureMemoryStateSchema,
  type MemoryStateEventDraft,
  type MemoryStateEventEnvelopePlain,
} from "../../memory-state/src/index.js";
import type { GaiaSleepRuntime, GaiaSleepWriteFacade, GaiaWriteResult } from "./gaia.js";
import { openSqliteDatabase } from "./sqlite.js";
import { createEventId, parseJsonValue, stableStringify } from "./utils.js";

type MemoryJobTestRuntime = GaiaSleepRuntime & {
  env: NodeJS.ProcessEnv;
};

type TestStatusSeed = {
  dbPath: string;
  profileId: string;
  workspaceScope: string;
  workspaceDir: string;
  stateDir: string;
  backend: GaiaSleepRuntime["backend"];
};

function resolveProjectionRelativePath(kind: string): string | undefined {
  for (const prefix of ["md-path:", "legacy-markdown:"]) {
    if (kind.startsWith(prefix)) {
      return kind.slice(prefix.length);
    }
  }
  return undefined;
}

async function materializeProjectionFiles(seed: TestStatusSeed): Promise<void> {
  const db = openSqliteDatabase(seed.dbPath);
  try {
    ensureLedgerTables(db);
    const rows = db
      .prepare(
        `SELECT kind, markdown_body
         FROM projections
         ORDER BY kind ASC`,
      )
      .all() as Array<{
      kind: string;
      markdown_body: string;
    }>;
    const roots = [seed.workspaceDir, path.join(seed.stateDir, "workspace")];
    for (const row of rows) {
      const relativePath = resolveProjectionRelativePath(row.kind);
      if (!relativePath) {
        continue;
      }
      for (const rootDir of roots) {
        const target = path.join(rootDir, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, row.markdown_body, "utf8");
      }
    }
  } finally {
    db.close();
  }
}

function ensureLedgerTables(db: DatabaseSync): void {
  ensureMemoryStateSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_events (
      event_id TEXT PRIMARY KEY,
      lamport INTEGER NOT NULL,
      actor_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      page_id TEXT,
      source TEXT,
      batch_id TEXT,
      created_at_ms INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkpoints (
      checkpoint_id TEXT PRIMARY KEY,
      lamport INTEGER NOT NULL,
      state_hash TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
  `);
}

function readCount(db: DatabaseSync, sql: string): number {
  const row = db.prepare(sql).get() as { count?: number | bigint } | undefined;
  const count = row?.count ?? 0;
  return typeof count === "bigint" ? Number(count) : count;
}

function readMaxLamport(db: DatabaseSync): number {
  const row = db.prepare(`SELECT MAX(lamport) AS lamport FROM ledger_events`).get() as
    | { lamport?: number | bigint | null }
    | undefined;
  const lamport = row?.lamport ?? 0;
  return typeof lamport === "bigint" ? Number(lamport) : Number(lamport ?? 0);
}

function readCheckpointCount(db: DatabaseSync): number {
  return readCount(db, `SELECT COUNT(*) AS count FROM checkpoints`);
}

function buildStatus(db: DatabaseSync, seed: TestStatusSeed): CanonicalMemoryStoreStatus {
  return {
    state: "ready",
    path: seed.dbPath,
    profileId: seed.profileId,
    profileSource: "state-dir",
    displayName: "Nuno Lopes",
    workspaceScope: seed.workspaceScope,
    workspaceDir: seed.workspaceDir,
    backend: seed.backend,
    entities: readCount(db, `SELECT COUNT(*) AS count FROM pages WHERE tombstoned = 0`),
    relations: readCount(db, `SELECT COUNT(*) AS count FROM links`),
    projections: readCount(db, `SELECT COUNT(*) AS count FROM projections`),
    projectionInterface: "markdown-repo",
    syncMode: "local-first",
    cloudSync: "unavailable",
    projectionSources: ["workspace-memory"],
    ledgerEventsCount: readCount(db, `SELECT COUNT(*) AS count FROM ledger_events`),
    lastSyncedLamport: readMaxLamport(db),
    checkpointsCount: readCheckpointCount(db),
    e2eeRequired: true,
    syncAvailability: "inactive",
    syncModeConfigured: "off",
    replica: {
      deviceId: "test-device",
      stateDir: seed.stateDir,
    },
  } as CanonicalMemoryStoreStatus;
}

function draftToEvent(
  db: DatabaseSync,
  draft: MemoryStateEventDraft,
): MemoryStateEventEnvelopePlain {
  const lamport = readMaxLamport(db) + 1;
  return {
    schemaVersion: 1,
    eventId:
      draft.eventId ??
      createEventId(
        "memory-job-test-event",
        stableStringify([
          lamport,
          draft.type,
          draft.pageId ?? "",
          draft.source ?? "",
          draft.batchId ?? "",
          draft.payload,
        ]),
      ),
    lamport,
    actorId: draft.actorId,
    createdAtMs: draft.createdAtMs ?? Date.now(),
    type: draft.type,
    payload: draft.payload,
    ...(draft.pageId ? { pageId: draft.pageId } : {}),
    ...(draft.source ? { source: draft.source } : {}),
    ...(draft.batchId ? { batchId: draft.batchId } : {}),
  };
}

function appendLedgerEvent(db: DatabaseSync, event: MemoryStateEventEnvelopePlain): void {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO ledger_events (
       event_id,
       lamport,
       actor_id,
       event_type,
       page_id,
       source,
       batch_id,
       created_at_ms,
       payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.eventId,
      event.lamport,
      event.actorId,
      event.type,
      event.pageId ?? null,
      event.source ?? null,
      event.batchId ?? null,
      event.createdAtMs,
      JSON.stringify(event.payload),
    ) as { changes?: number };
  if ((result.changes ?? 0) === 0) {
    return;
  }
  applyEventToDerivedState({
    db,
    event,
  });
}

function createCheckpointCreatedEvent(
  db: DatabaseSync,
  checkpointId: string,
  stateHash: string,
): MemoryStateEventEnvelopePlain {
  return {
    schemaVersion: 1,
    eventId: createEventId("memory-job-test-checkpoint", checkpointId),
    lamport: readMaxLamport(db) + 1,
    actorId: "gaia-checkpoint",
    createdAtMs: Date.now(),
    type: "CHECKPOINT_CREATED",
    source: "checkpoint",
    payload: {
      checkpointId,
      stateHash,
      encryptedSnapshot: null,
    },
  };
}

function createTestGaiaFacade(seed: TestStatusSeed): GaiaSleepWriteFacade {
  const readStatus = () => {
    const db = openSqliteDatabase(seed.dbPath);
    try {
      ensureLedgerTables(db);
      return buildStatus(db, seed);
    } finally {
      db.close();
    }
  };

  const writeDrafts = async (
    drafts: readonly MemoryStateEventDraft[],
    options?: {
      materializeMarkdown?: boolean;
      forceCheckpoint?: boolean;
    },
  ): Promise<GaiaWriteResult> => {
    const db = openSqliteDatabase(seed.dbPath);
    try {
      ensureLedgerTables(db);
      const events = drafts.map((draft) => draftToEvent(db, draft));
      for (const event of events) {
        appendLedgerEvent(db, event);
      }

      if (options?.forceCheckpoint && events.length > 0) {
        const stateHash = computeMemoryStateHash(db);
        const checkpointId = createEventId(
          "memory-job-test-checkpoint-row",
          `${readMaxLamport(db)}:${stateHash}`,
        );
        db.prepare(
          `INSERT INTO checkpoints (checkpoint_id, lamport, state_hash, created_at_ms)
           VALUES (?, ?, ?, ?)`,
        ).run(checkpointId, readMaxLamport(db) + 1, stateHash, Date.now());
        appendLedgerEvent(db, createCheckpointCreatedEvent(db, checkpointId, stateHash));
      }

      return {
        status: buildStatus(db, seed),
        events,
        stateHash: computeMemoryStateHash(db),
      };
    } finally {
      db.close();
    }
  };

  return {
    status: readStatus(),

    async ensureReady() {
      const db = openSqliteDatabase(seed.dbPath);
      try {
        ensureLedgerTables(db);
        return buildStatus(db, seed);
      } finally {
        db.close();
      }
    },

    async writeEvents(events, options) {
      const result = await writeDrafts(events, options);
      if (options?.materializeMarkdown === true) {
        await materializeProjectionFiles(seed);
      }
      return result;
    },

    async recordJobCheckpoint(record) {
      const db = openSqliteDatabase(seed.dbPath);
      try {
        ensureLedgerTables(db);
        const checkpointEventId =
          record.kind === "health"
            ? createEventId(
                "sleep-job-checkpoint",
                stableStringify([
                  record.profileId,
                  record.jobId,
                  record.kind,
                  record.reason,
                  record.cursor,
                  record.pendingEventCount,
                  record.pendingPayloadBytes,
                ]),
              )
            : createEventId(
                "sleep-job-checkpoint",
                stableStringify([
                  record.profileId,
                  record.jobId,
                  record.kind,
                  record.reason,
                  record.cursor,
                  record.pendingEventCount,
                  record.pendingPayloadBytes,
                ]),
              );
        appendLedgerEvent(db, {
          schemaVersion: 1,
          eventId: checkpointEventId,
          lamport: readMaxLamport(db) + 1,
          actorId: "gaia-sleep",
          createdAtMs: Date.now(),
          type: "JOB_CHECKPOINT_UPDATED",
          source: `sleep/${record.kind}`,
          batchId: record.jobId,
          payload: {
            profileId: record.profileId,
            jobId: record.jobId,
            kind: record.kind,
            reason: record.reason,
            cursor: record.cursor as Record<string, unknown>,
            pendingEventCount: record.pendingEventCount,
            pendingPayloadBytes: record.pendingPayloadBytes,
          },
        });

        let checkpointId: string | undefined;
        if (record.requestCheckpoint === true) {
          const stateHash = computeMemoryStateHash(db);
          checkpointId = createEventId(
            "memory-job-test-checkpoint-row",
            `${readMaxLamport(db)}:${stateHash}`,
          );
          db.prepare(
            `INSERT INTO checkpoints (checkpoint_id, lamport, state_hash, created_at_ms)
             VALUES (?, ?, ?, ?)`,
          ).run(checkpointId, readMaxLamport(db) + 1, stateHash, Date.now());
          appendLedgerEvent(db, createCheckpointCreatedEvent(db, checkpointId, stateHash));
        }

        return {
          status: buildStatus(db, seed),
          checkpointEventId,
          ...(checkpointId ? { checkpointId } : {}),
          stateHash: computeMemoryStateHash(db),
        };
      } finally {
        db.close();
      }
    },

    readDashboard(kind) {
      const db = openSqliteDatabase(seed.dbPath);
      try {
        ensureLedgerTables(db);
        const row = db
          .prepare(
            `SELECT json
             FROM dashboards
             WHERE kind = ?
             LIMIT 1`,
          )
          .get(kind) as { json: string } | undefined;
        return row ? parseJsonValue(row.json, undefined) : undefined;
      } finally {
        db.close();
      }
    },
  };
}

export function createSchedulerTestDependencies(params: {
  status: CanonicalMemoryStoreStatus;
  gaia: GaiaSleepWriteFacade;
}) {
  return {
    openDatabase: openSqliteDatabase,
    createGaia: () => params.gaia,
    resolveStatus: () => params.status,
  };
}

export async function withMemoryJobDb<T>(
  run: (params: {
    db: DatabaseSync;
    dbPath: string;
    workspaceDir: string;
    stateDir: string;
    nowMs: number;
    gaia: GaiaSleepWriteFacade;
    runtime: MemoryJobTestRuntime;
    status: CanonicalMemoryStoreStatus;
  }) => Promise<T> | T,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-memory-jobs-"));
  const stateDir = path.join(root, "state");
  const workspaceDir = path.join(root, "workspace");
  const agentId = "main";
  const backend = "builtin" as const;
  const profileId = "local-main";
  const workspaceScope = "main";
  const dbPath = path.join(root, "canonical.sqlite");
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

  const env = {
    ...process.env,
    ALISIO_STATE_DIR: stateDir,
  };
  const cfg = {
    agents: {
      defaults: {
        workspace: workspaceDir,
      },
    },
  } as AlisioConfig;
  const runtime: MemoryJobTestRuntime = {
    cfg,
    agentId,
    workspaceDir,
    backend,
    env,
  };

  const db = openSqliteDatabase(dbPath);
  ensureLedgerTables(db);
  const seed: TestStatusSeed = {
    dbPath,
    profileId,
    workspaceScope,
    workspaceDir,
    stateDir,
    backend,
  };
  const gaia = createTestGaiaFacade(seed);
  const status = await gaia.ensureReady();
  const nowMs = Date.now();
  try {
    return await run({
      db,
      dbPath,
      workspaceDir,
      stateDir,
      nowMs,
      gaia,
      runtime,
      status,
    });
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}
