import type { DatabaseSync } from "node:sqlite";
import {
  applyEventToDerivedState,
  captureMemoryStateCheckpoint,
  computeMemoryStateHash,
  ensureMemoryStateSchema,
  readMemoryStateMeta,
  type MemoryStateCheckpointSnapshot,
  type MemoryStateEventDraft,
  type MemoryStateEventEnvelopePlain,
} from "../../memory-state/src/index.js";
import { withImmediateTransaction } from "./sqlite.js";
import { createEventId, hashText, stableStringify } from "./utils.js";

type LedgerStateEventType = MemoryStateEventEnvelopePlain["type"];
type GaiaLedgerEventType = LedgerStateEventType | "JOB_CHECKPOINT_UPDATED";

type GaiaCheckpointReason = "threshold" | "preempted" | "cycle-complete";

type JobCheckpointRecord = {
  jobId: string;
  profileId: string;
  kind: string;
  reason: GaiaCheckpointReason;
  cursor: unknown;
  pendingEventCount: number;
  pendingPayloadBytes: number;
  requestCheckpoint?: boolean;
};

type GaiaLedgerRow = {
  event_id: string;
  lamport: number | bigint;
  actor_id: string;
  event_type: GaiaLedgerEventType;
  page_id: string | null;
  source: string | null;
  batch_id: string | null;
  created_at_ms: number | bigint;
  payload_json: string;
};

export type GaiaWriteResult = {
  events: MemoryStateEventEnvelopePlain[];
  stateHash: string;
};

export type GaiaCheckpointResult = {
  checkpointEventId: string;
  checkpointId?: string;
  stateHash: string;
};

export type GaiaSleepWriteFacade = {
  ensureReady(): void;
  writeEvents(events: readonly MemoryStateEventDraft[]): GaiaWriteResult;
  recordJobCheckpoint(record: JobCheckpointRecord): GaiaCheckpointResult;
  readDashboard<T>(kind: string): T | undefined;
};

const LEDGER_EVENT_SCHEMA_VERSION = 1 as const;

function normalizeNumber(value: number | bigint | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return typeof value === "number" ? value : 0;
}

function ensureGaiaLedgerSchema(db: DatabaseSync): void {
  ensureMemoryStateSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger_events (
      event_id TEXT PRIMARY KEY,
      lamport INTEGER NOT NULL UNIQUE,
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
      snapshot_json TEXT,
      encrypted_snapshot TEXT,
      created_at_ms INTEGER NOT NULL
    );
  `);
}

function readLastLedgerLamport(db: DatabaseSync): number {
  const row = db.prepare(`SELECT MAX(lamport) AS lamport FROM ledger_events`).get() as
    | {
        lamport?: number | bigint | null;
      }
    | undefined;
  return normalizeNumber(row?.lamport);
}

function insertLedgerRow(
  db: DatabaseSync,
  row: {
    eventId: string;
    lamport: number;
    actorId: string;
    eventType: GaiaLedgerEventType;
    pageId?: string;
    source?: string;
    batchId?: string;
    createdAtMs: number;
    payloadJson: string;
  },
): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO ledger_events (
         event_id, lamport, actor_id, event_type, page_id, source, batch_id, created_at_ms, payload_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.eventId,
      row.lamport,
      row.actorId,
      row.eventType,
      row.pageId ?? null,
      row.source ?? null,
      row.batchId ?? null,
      row.createdAtMs,
      row.payloadJson,
    ) as { changes?: number };
  return (result.changes ?? 0) > 0;
}

function assignEvents(params: {
  db: DatabaseSync;
  actorId: string;
  events: readonly MemoryStateEventDraft[];
}): MemoryStateEventEnvelopePlain[] {
  let lamport = Math.max(
    readLastLedgerLamport(params.db),
    readMemoryStateMeta(params.db).lastAppliedLamport,
  );
  return params.events.map((event) => {
    lamport += 1;
    return {
      schemaVersion: LEDGER_EVENT_SCHEMA_VERSION,
      eventId:
        event.eventId ??
        createEventId(
          "sleep-ledger",
          stableStringify([
            event.type,
            event.pageId ?? "",
            event.batchId ?? "",
            event.source ?? "",
            event.payload,
          ]),
        ),
      lamport,
      actorId: event.actorId || params.actorId,
      createdAtMs: event.createdAtMs ?? Date.now(),
      type: event.type,
      payload: event.payload,
      ...(event.pageId ? { pageId: event.pageId } : {}),
      ...(event.source ? { source: event.source } : {}),
      ...(event.batchId ? { batchId: event.batchId } : {}),
    };
  });
}

function createCheckpoint(params: { db: DatabaseSync; actorId: string; source: string }): {
  checkpointId: string;
  stateHash: string;
  checkpointEvent: MemoryStateEventEnvelopePlain;
} {
  const meta = readMemoryStateMeta(params.db);
  const coveredLamport = meta.lastAppliedLamport;
  const snapshot = captureMemoryStateCheckpoint(params.db);
  const stateHash = computeMemoryStateHash(params.db);
  const checkpointId = hashText(
    stableStringify([
      "sleep-checkpoint",
      coveredLamport,
      stateHash,
      snapshot.meta.lastCheckpointId ?? "",
    ]),
  ).slice(0, 24);
  params.db
    .prepare(
      `INSERT OR REPLACE INTO checkpoints (
         checkpoint_id, lamport, state_hash, snapshot_json, encrypted_snapshot, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(checkpointId, coveredLamport, stateHash, JSON.stringify(snapshot), null, Date.now());
  const checkpointEvent = assignEvents({
    db: params.db,
    actorId: params.actorId,
    events: [
      {
        actorId: params.actorId,
        source: params.source,
        type: "CHECKPOINT_CREATED",
        payload: {
          checkpointId,
          stateHash,
          encryptedSnapshot: null,
        },
      },
    ],
  })[0];
  return {
    checkpointId,
    stateHash,
    checkpointEvent,
  };
}

function readDashboard<T>(db: DatabaseSync, kind: string): T | undefined {
  const row = db
    .prepare(
      `SELECT json
       FROM dashboards
       WHERE kind = ?
       LIMIT 1`,
    )
    .get(kind) as
    | {
        json: string;
      }
    | undefined;
  if (!row?.json) {
    return undefined;
  }
  try {
    return JSON.parse(row.json) as T;
  } catch {
    return undefined;
  }
}

export function createGaiaSleepWriteFacade(params: {
  db: DatabaseSync;
  actorId?: string;
}): GaiaSleepWriteFacade {
  const actorId = params.actorId?.trim() || "gaia-sleep";

  return {
    ensureReady() {
      ensureGaiaLedgerSchema(params.db);
    },

    writeEvents(events) {
      ensureGaiaLedgerSchema(params.db);
      return withImmediateTransaction(params.db, () => {
        const assigned = assignEvents({
          db: params.db,
          actorId,
          events,
        });
        const inserted: MemoryStateEventEnvelopePlain[] = [];
        for (const event of assigned) {
          const insertedRow = insertLedgerRow(params.db, {
            eventId: event.eventId,
            lamport: event.lamport,
            actorId: event.actorId,
            eventType: event.type,
            pageId: event.pageId,
            source: event.source,
            batchId: event.batchId,
            createdAtMs: event.createdAtMs,
            payloadJson: JSON.stringify(event.payload),
          });
          if (!insertedRow) {
            continue;
          }
          applyEventToDerivedState({
            db: params.db,
            event,
            migrationVersion: LEDGER_EVENT_SCHEMA_VERSION,
          });
          inserted.push(event);
        }
        return {
          events: inserted,
          stateHash: computeMemoryStateHash(params.db),
        };
      });
    },

    recordJobCheckpoint(record) {
      ensureGaiaLedgerSchema(params.db);
      return withImmediateTransaction(params.db, () => {
        let lamport = Math.max(
          readLastLedgerLamport(params.db),
          readMemoryStateMeta(params.db).lastAppliedLamport,
        );
        lamport += 1;
        const checkpointEventId = createEventId(
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
        insertLedgerRow(params.db, {
          eventId: checkpointEventId,
          lamport,
          actorId,
          eventType: "JOB_CHECKPOINT_UPDATED",
          source: `sleep/${record.kind}`,
          batchId: record.jobId,
          createdAtMs: Date.now(),
          payloadJson: JSON.stringify({
            profileId: record.profileId,
            jobId: record.jobId,
            kind: record.kind,
            reason: record.reason,
            cursor: record.cursor,
            pendingEventCount: record.pendingEventCount,
            pendingPayloadBytes: record.pendingPayloadBytes,
          }),
        });

        let checkpointId: string | undefined;
        let stateHash = computeMemoryStateHash(params.db);
        if (record.requestCheckpoint) {
          const checkpoint = createCheckpoint({
            db: params.db,
            actorId,
            source: `sleep/${record.kind}`,
          });
          checkpointId = checkpoint.checkpointId;
          stateHash = checkpoint.stateHash;
          if (
            insertLedgerRow(params.db, {
              eventId: checkpoint.checkpointEvent.eventId,
              lamport: checkpoint.checkpointEvent.lamport,
              actorId: checkpoint.checkpointEvent.actorId,
              eventType: checkpoint.checkpointEvent.type,
              pageId: checkpoint.checkpointEvent.pageId,
              source: checkpoint.checkpointEvent.source,
              batchId: checkpoint.checkpointEvent.batchId,
              createdAtMs: checkpoint.checkpointEvent.createdAtMs,
              payloadJson: JSON.stringify(checkpoint.checkpointEvent.payload),
            })
          ) {
            applyEventToDerivedState({
              db: params.db,
              event: checkpoint.checkpointEvent,
              migrationVersion: LEDGER_EVENT_SCHEMA_VERSION,
            });
          }
        }

        return {
          checkpointEventId,
          ...(checkpointId ? { checkpointId } : {}),
          stateHash,
        };
      });
    },

    readDashboard(kind) {
      ensureGaiaLedgerSchema(params.db);
      return readDashboard(params.db, kind);
    },
  };
}

export function readGaiaLedgerEvents(params: {
  db: DatabaseSync;
  eventType?: GaiaLedgerEventType;
}): Array<{
  eventId: string;
  lamport: number;
  actorId: string;
  eventType: GaiaLedgerEventType;
  payload: Record<string, unknown>;
}> {
  ensureGaiaLedgerSchema(params.db);
  const rows = (
    params.eventType
      ? params.db
          .prepare(
            `SELECT event_id, lamport, actor_id, event_type, payload_json
             FROM ledger_events
             WHERE event_type = ?
             ORDER BY lamport ASC, event_id ASC`,
          )
          .all(params.eventType)
      : params.db
          .prepare(
            `SELECT event_id, lamport, actor_id, event_type, payload_json
             FROM ledger_events
             ORDER BY lamport ASC, event_id ASC`,
          )
          .all()
  ) as GaiaLedgerRow[];
  return rows.map((row) => ({
    eventId: row.event_id,
    lamport: normalizeNumber(row.lamport),
    actorId: row.actor_id,
    eventType: row.event_type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  }));
}

export type { JobCheckpointRecord, MemoryStateCheckpointSnapshot };
