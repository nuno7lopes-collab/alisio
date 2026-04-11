import { createRequire } from "node:module";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  type CheckpointId,
  CheckpointIdSchema,
  type EventEnvelope,
  type EventEnvelopeMeta,
  EventEnvelopeMetaSchema,
  type EventPayloadEnvelope,
  type LedgerAppendPayloadInput,
  type MemoryEventType,
  type Sha256Hex,
  SHA256_HEX_REGEX,
  canonicalizeEventMetaForHash,
  computeSha256Hex,
  hashEventChain,
  normalizeLedgerPayload,
  payloadHashBytes,
} from "../../memory-schema/src/index.js";
import { ensureLedgerFilesystem, resolveLedgerSqlitePath } from "./paths.js";

const require = createRequire(import.meta.url);

const LEDGER_MIGRATION_VERSION = 1;

type HashHex = Sha256Hex;

type NormalizedAppendEventInput = {
  meta: EventEnvelopeMeta;
  payload: EventPayloadEnvelope;
};

type MetaRow = {
  profile_id: string;
  last_lamport: number | bigint | null;
  last_event_hash: string | null;
  migration_version: number | bigint | null;
};

type EventRow = {
  event_id: string;
  profile_id: string;
  device_id: string;
  lamport: number | bigint;
  event_type: MemoryEventType;
  schema_version: number | bigint;
  created_at_ms: number | bigint;
  payload_plain: Uint8Array | null;
  payload_cipher: Uint8Array | null;
  nonce: Uint8Array | null;
  aad: Uint8Array | null;
  payload_hash: string;
  prev_event_hash: string | null;
  event_hash: string;
};

type AckRow = {
  replica_id: string;
  ack_lamport: number | bigint;
};

type CheckpointRow = {
  checkpoint_id: string;
  profile_id: string;
  covered_until_lamport: number | bigint;
  state_hash: string;
  payload_cipher: Uint8Array | null;
  created_at_ms: number | bigint;
};

type MaxLamportRow = {
  lamport: number | bigint | null;
};

type Statements = {
  selectMeta: StatementSync;
  insertMeta: StatementSync;
  updateMeta: StatementSync;
  selectEventById: StatementSync;
  selectEventsSince: StatementSync;
  selectLastEvent: StatementSync;
  insertEvent: StatementSync;
  selectMaxLamportByDevice: StatementSync;
  selectAck: StatementSync;
  replaceAck: StatementSync;
  selectAckVector: StatementSync;
  selectAckFloor: StatementSync;
  selectCheckpointById: StatementSync;
  insertCheckpoint: StatementSync;
  selectLatestCheckpoint: StatementSync;
};

export type LedgerTelemetry = {
  onAppend?: (event: {
    profileId: string;
    eventId: string;
    bytes: number;
    eventType: MemoryEventType;
    status: "inserted" | "duplicate";
  }) => void;
  onCompactionPlan?: (event: {
    profileId: string;
    safeUntilLamport?: number;
    ackFloorLamport?: number;
    checkpointLamport?: number;
  }) => void;
  onCorruptionDetected?: (event: {
    profileId: string;
    code:
      | "duplicate_event_conflict"
      | "ack_conflict"
      | "meta_mismatch"
      | "payload_shape_mismatch"
      | "out_of_order_lamport";
    message: string;
    eventId?: string;
  }) => void;
};

export type LedgerAppendEventInput = {
  meta: EventEnvelopeMeta;
  payload: LedgerAppendPayloadInput;
};

export type LedgerAppendResult = {
  eventId: string;
  eventHash: string;
  status: "inserted" | "duplicate";
};

export type StoredLedgerEvent = EventEnvelope & {
  payloadHash: string;
  prevEventHash: string | null;
  eventHash: string;
};

export type ReplicaAckVector = Record<string, number>;

export type LedgerCheckpoint = {
  checkpointId: CheckpointId;
  profileId: string;
  coveredUntilLamport: number;
  stateHash: HashHex;
  payloadCipher?: Uint8Array;
  createdAtMs: number;
};

export type CompactionPlan = {
  safeDeleteUntilLamport?: number;
  ackFloorLamport?: number;
  checkpointLamport?: number;
  checkpointId?: string;
};

export type BootstrapGenesisFromLegacySnapshotTemplate = {
  status: "pending-gaia-legacy-import";
  requiredFields: Array<"profileId" | "deviceId" | "snapshotBytes" | "stateHash">;
  suggestedGenesisEvent: {
    eventType: "DOC_CRDT_SNAPSHOT";
    lamport: number;
    schemaVersion: number;
  };
  suggestedCheckpoint: {
    eventType: "CHECKPOINT_CREATED";
    coveredUntilLamport: number;
  };
};

export type OpenLedgerOptions = {
  dbPath?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  telemetry?: LedgerTelemetry;
  busyTimeoutMs?: number;
};

export type MemoryLedger = {
  readonly profileId: string;
  readonly path: string;
  close(): void;
  appendEvent(meta: EventEnvelopeMeta, payload: LedgerAppendPayloadInput): LedgerAppendResult;
  appendBatch(events: readonly LedgerAppendEventInput[]): LedgerAppendResult[];
  listEventsSince(lamportExclusive: number, limit: number): StoredLedgerEvent[];
  getEventById(eventId: string): StoredLedgerEvent | null;
  recordAck(replicaId: string, ackLamport: number, ackEventId: string): void;
  getAckVector(): ReplicaAckVector;
  createCheckpoint(
    checkpointId: CheckpointId,
    coveredUntilLamport: number,
    stateHash: HashHex,
    payloadCipher?: Uint8Array,
  ): LedgerCheckpoint;
  getLatestCheckpoint(): LedgerCheckpoint | null;
  planCompaction(): CompactionPlan;
};

export function bootstrapGenesisFromLegacySnapshot(): BootstrapGenesisFromLegacySnapshotTemplate {
  return {
    status: "pending-gaia-legacy-import",
    requiredFields: ["profileId", "deviceId", "snapshotBytes", "stateHash"],
    suggestedGenesisEvent: {
      eventType: "DOC_CRDT_SNAPSHOT",
      lamport: 1,
      schemaVersion: 1,
    },
    suggestedCheckpoint: {
      eventType: "CHECKPOINT_CREATED",
      coveredUntilLamport: 1,
    },
  };
}

export function openLedger(profileId: string, options: OpenLedgerOptions = {}): MemoryLedger {
  const normalizedProfileId = normalizeNonEmpty(profileId, "profileId");
  const pathname = resolveLedgerSqlitePath({
    profileId: normalizedProfileId,
    env: options.env,
    stateDir: options.stateDir,
    dbPath: options.dbPath,
  });
  ensureLedgerFilesystem(pathname);
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(pathname);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec(`PRAGMA busy_timeout = ${Math.max(1, options.busyTimeoutMs ?? 5000)};`);
    migrateLedgerDatabase(db, pathname, normalizedProfileId, options.telemetry);
    ensureLedgerFilesystem(pathname);
    const statements = createStatements(db);
    return new SqliteMemoryLedger(normalizedProfileId, pathname, db, statements, options.telemetry);
  } catch (error) {
    db.close();
    throw error;
  }
}

class SqliteMemoryLedger implements MemoryLedger {
  readonly profileId: string;
  readonly path: string;

  constructor(
    profileId: string,
    pathname: string,
    private readonly db: DatabaseSync,
    private readonly statements: Statements,
    private readonly telemetry?: LedgerTelemetry,
  ) {
    this.profileId = profileId;
    this.path = pathname;
  }

  close(): void {
    this.db.close();
  }

  appendEvent(meta: EventEnvelopeMeta, payload: LedgerAppendPayloadInput): LedgerAppendResult {
    return this.appendBatch([{ meta, payload }])[0];
  }

  appendBatch(events: readonly LedgerAppendEventInput[]): LedgerAppendResult[] {
    if (events.length === 0) {
      return [];
    }

    const deviceLamportCache = new Map<string, number>();
    const pendingByEventId = new Map<
      string,
      { input: NormalizedAppendEventInput; result: LedgerAppendResult }
    >();
    const results: LedgerAppendResult[] = [];

    return withWriteTransaction(this.db, this.path, () => {
      const metaRow = getMetaRow(this.statements, this.profileId);
      let lastLamport = metaRow.lastLamport;
      let lastEventHash = metaRow.lastEventHash;
      let insertedAny = false;

      for (const event of events) {
        const normalized = normalizeAppendInput(event);
        const eventId = normalized.meta.eventId;

        if (normalized.meta.profileId !== this.profileId) {
          throw new Error(
            `Event ${eventId} targets profile ${normalized.meta.profileId}, but this ledger is bound to ${this.profileId}.`,
          );
        }

        const existingInBatch = pendingByEventId.get(eventId);
        if (existingInBatch) {
          if (!appendInputsEqual(existingInBatch.input, normalized)) {
            this.reportCorruption({
              code: "duplicate_event_conflict",
              message: `Conflicting duplicate event ${eventId} appeared in the same batch.`,
              eventId,
            });
            throw new Error(`Conflicting duplicate event ${eventId} in appendBatch.`);
          }
          results.push({
            eventId,
            eventHash: existingInBatch.result.eventHash,
            status: "duplicate",
          });
          this.telemetry?.onAppend?.({
            profileId: this.profileId,
            eventId,
            bytes: payloadLength(normalized.payload),
            eventType: normalized.meta.eventType,
            status: "duplicate",
          });
          continue;
        }

        const existingRow = this.statements.selectEventById.get(this.profileId, eventId) as
          | EventRow
          | undefined;
        if (existingRow) {
          const existingEvent = rowToStoredLedgerEvent(existingRow);
          if (!storedEventMatchesInput(existingEvent, normalized)) {
            this.reportCorruption({
              code: "duplicate_event_conflict",
              message: `Event ${eventId} already exists with different contents.`,
              eventId,
            });
            throw new Error(`Event ${eventId} already exists with different contents.`);
          }
          const duplicateResult = {
            eventId,
            eventHash: existingEvent.eventHash,
            status: "duplicate" as const,
          };
          pendingByEventId.set(eventId, { input: normalized, result: duplicateResult });
          results.push(duplicateResult);
          this.telemetry?.onAppend?.({
            profileId: this.profileId,
            eventId,
            bytes: payloadLength(normalized.payload),
            eventType: normalized.meta.eventType,
            status: "duplicate",
          });
          continue;
        }

        if (normalized.meta.lamport <= lastLamport) {
          this.reportCorruption({
            code: "out_of_order_lamport",
            message: `Lamport ${normalized.meta.lamport} is not strictly greater than the current profile watermark ${lastLamport}.`,
            eventId,
          });
          throw new Error(
            `Out-of-order lamport for ${eventId}: ${normalized.meta.lamport} <= ${lastLamport}.`,
          );
        }

        const deviceLamport =
          deviceLamportCache.get(normalized.meta.deviceId) ??
          getMaxLamportForDevice(this.statements, this.profileId, normalized.meta.deviceId);
        if (normalized.meta.lamport <= deviceLamport) {
          this.reportCorruption({
            code: "out_of_order_lamport",
            message: `Lamport ${normalized.meta.lamport} is not strictly greater than the device watermark ${deviceLamport}.`,
            eventId,
          });
          throw new Error(
            `Out-of-order device lamport for ${eventId}: ${normalized.meta.lamport} <= ${deviceLamport}.`,
          );
        }

        const payloadHash = computeSha256Hex(payloadHashBytes(normalized.payload));
        const eventHash = hashEventChain({
          prevEventHash: lastEventHash,
          payloadHash,
          meta: normalized.meta,
        });

        this.statements.insertEvent.run({
          event_id: normalized.meta.eventId,
          profile_id: normalized.meta.profileId,
          device_id: normalized.meta.deviceId,
          lamport: normalized.meta.lamport,
          event_type: normalized.meta.eventType,
          schema_version: normalized.meta.schemaVersion,
          created_at_ms: normalized.meta.createdAtMs,
          payload_plain:
            normalized.payload.kind === "plain" ? toSqliteBlob(normalized.payload.bytes) : null,
          payload_cipher:
            normalized.payload.kind === "encrypted"
              ? toSqliteBlob(normalized.payload.ciphertext)
              : null,
          nonce:
            normalized.payload.kind === "encrypted" ? toSqliteBlob(normalized.payload.nonce) : null,
          aad:
            normalized.payload.kind === "encrypted" && normalized.payload.aad
              ? toSqliteBlob(normalized.payload.aad)
              : null,
          payload_hash: payloadHash,
          prev_event_hash: lastEventHash,
          event_hash: eventHash,
        });

        deviceLamportCache.set(normalized.meta.deviceId, normalized.meta.lamport);
        lastLamport = normalized.meta.lamport;
        lastEventHash = eventHash;
        insertedAny = true;

        const insertedResult = {
          eventId,
          eventHash,
          status: "inserted" as const,
        };
        pendingByEventId.set(eventId, { input: normalized, result: insertedResult });
        results.push(insertedResult);
        this.telemetry?.onAppend?.({
          profileId: this.profileId,
          eventId,
          bytes: payloadLength(normalized.payload),
          eventType: normalized.meta.eventType,
          status: "inserted",
        });
      }

      if (insertedAny) {
        this.statements.updateMeta.run({
          profile_id: this.profileId,
          last_lamport: lastLamport,
          last_event_hash: lastEventHash ?? "",
          migration_version: LEDGER_MIGRATION_VERSION,
        });
      }

      return results;
    });
  }

  listEventsSince(lamportExclusive: number, limit: number): StoredLedgerEvent[] {
    const normalizedLamport = normalizeNonNegativeInteger(lamportExclusive, "lamportExclusive");
    const normalizedLimit = normalizeNonNegativeInteger(limit, "limit");
    if (normalizedLimit === 0) {
      return [];
    }
    const rows = this.statements.selectEventsSince.all(
      this.profileId,
      normalizedLamport,
      normalizedLimit,
    ) as EventRow[];
    return rows.map((row) => rowToStoredLedgerEvent(row));
  }

  getEventById(eventId: string): StoredLedgerEvent | null {
    const row = this.statements.selectEventById.get(
      this.profileId,
      normalizeNonEmpty(eventId, "eventId"),
    ) as EventRow | undefined;
    return row ? rowToStoredLedgerEvent(row) : null;
  }

  recordAck(replicaId: string, ackLamport: number, ackEventId: string): void {
    const normalizedReplicaId = normalizeNonEmpty(replicaId, "replicaId");
    const normalizedAckLamport = normalizePositiveInteger(ackLamport, "ackLamport");
    const normalizedAckEventId = normalizeNonEmpty(ackEventId, "ackEventId");
    const ackedEvent = this.getEventById(normalizedAckEventId);
    if (!ackedEvent) {
      throw new Error(`Cannot record ack for missing event ${normalizedAckEventId}.`);
    }
    if (ackedEvent.meta.lamport !== normalizedAckLamport) {
      this.reportCorruption({
        code: "ack_conflict",
        message: `Ack ${normalizedAckEventId} references lamport ${normalizedAckLamport}, but the event stores ${ackedEvent.meta.lamport}.`,
        eventId: normalizedAckEventId,
      });
      throw new Error(
        `Ack lamport mismatch for ${normalizedAckEventId}: expected ${ackedEvent.meta.lamport}.`,
      );
    }

    withWriteTransaction(this.db, this.path, () => {
      const existing = this.statements.selectAck.get(this.profileId, normalizedReplicaId) as
        | {
            ack_lamport: number | bigint;
            ack_event_id: string;
          }
        | undefined;

      if (existing) {
        const existingLamport = toNumber(existing.ack_lamport);
        if (normalizedAckLamport < existingLamport) {
          return;
        }
        if (
          normalizedAckLamport === existingLamport &&
          existing.ack_event_id !== normalizedAckEventId
        ) {
          this.reportCorruption({
            code: "ack_conflict",
            message: `Replica ${normalizedReplicaId} attempted to reuse lamport ${normalizedAckLamport} for ${normalizedAckEventId}.`,
            eventId: normalizedAckEventId,
          });
          throw new Error(
            `Replica ${normalizedReplicaId} already acknowledged lamport ${normalizedAckLamport} with a different event.`,
          );
        }
      }

      this.statements.replaceAck.run({
        profile_id: this.profileId,
        replica_id: normalizedReplicaId,
        ack_lamport: normalizedAckLamport,
        ack_event_id: normalizedAckEventId,
        updated_at_ms: Date.now(),
      });
    });
  }

  getAckVector(): ReplicaAckVector {
    const rows = this.statements.selectAckVector.all(this.profileId) as AckRow[];
    return Object.fromEntries(rows.map((row) => [row.replica_id, toNumber(row.ack_lamport)]));
  }

  createCheckpoint(
    checkpointId: CheckpointId,
    coveredUntilLamport: number,
    stateHash: HashHex,
    payloadCipher?: Uint8Array,
  ): LedgerCheckpoint {
    const normalizedCheckpointId = CheckpointIdSchema.parse(checkpointId);
    const normalizedCoveredUntil = normalizePositiveInteger(
      coveredUntilLamport,
      "coveredUntilLamport",
    );
    const normalizedStateHash = normalizeSha256Hex(stateHash, "stateHash");
    const normalizedPayloadCipher = payloadCipher ? copyBytes(payloadCipher) : undefined;

    const existing = this.statements.selectCheckpointById.get(normalizedCheckpointId) as
      | CheckpointRow
      | undefined;
    if (existing) {
      const checkpoint = rowToCheckpoint(existing);
      if (
        checkpoint.profileId !== this.profileId ||
        checkpoint.coveredUntilLamport !== normalizedCoveredUntil ||
        checkpoint.stateHash !== normalizedStateHash ||
        !bytesEqual(checkpoint.payloadCipher, normalizedPayloadCipher)
      ) {
        throw new Error(
          `Checkpoint ${normalizedCheckpointId} already exists with different contents.`,
        );
      }
      return checkpoint;
    }

    const createdAtMs = Date.now();
    withWriteTransaction(this.db, this.path, () => {
      this.statements.insertCheckpoint.run({
        checkpoint_id: normalizedCheckpointId,
        profile_id: this.profileId,
        covered_until_lamport: normalizedCoveredUntil,
        state_hash: normalizedStateHash,
        payload_cipher: normalizedPayloadCipher ? toSqliteBlob(normalizedPayloadCipher) : null,
        created_at_ms: createdAtMs,
      });
    });

    return {
      checkpointId: normalizedCheckpointId,
      profileId: this.profileId,
      coveredUntilLamport: normalizedCoveredUntil,
      stateHash: normalizedStateHash,
      ...(normalizedPayloadCipher ? { payloadCipher: normalizedPayloadCipher } : {}),
      createdAtMs,
    };
  }

  getLatestCheckpoint(): LedgerCheckpoint | null {
    const row = this.statements.selectLatestCheckpoint.get(this.profileId) as
      | CheckpointRow
      | undefined;
    return row ? rowToCheckpoint(row) : null;
  }

  planCompaction(): CompactionPlan {
    const ackFloorRow = this.statements.selectAckFloor.get(this.profileId) as
      | { ack_floor: number | bigint | null }
      | undefined;
    const ackFloorLamport =
      ackFloorRow?.ack_floor == null ? undefined : toNumber(ackFloorRow.ack_floor);
    const latestCheckpoint = this.getLatestCheckpoint();
    const checkpointLamport = latestCheckpoint?.coveredUntilLamport;
    const safeDeleteUntilLamport =
      ackFloorLamport != null && checkpointLamport != null
        ? Math.min(ackFloorLamport, checkpointLamport)
        : undefined;

    const plan: CompactionPlan = {
      ...(safeDeleteUntilLamport != null ? { safeDeleteUntilLamport } : {}),
      ...(ackFloorLamport != null ? { ackFloorLamport } : {}),
      ...(checkpointLamport != null ? { checkpointLamport } : {}),
      ...(latestCheckpoint ? { checkpointId: latestCheckpoint.checkpointId } : {}),
    };
    this.telemetry?.onCompactionPlan?.({
      profileId: this.profileId,
      safeUntilLamport: safeDeleteUntilLamport,
      ackFloorLamport,
      checkpointLamport,
    });
    return plan;
  }

  private reportCorruption(
    event: Omit<Parameters<NonNullable<LedgerTelemetry["onCorruptionDetected"]>>[0], "profileId">,
  ): void {
    this.telemetry?.onCorruptionDetected?.({
      profileId: this.profileId,
      ...event,
    });
  }
}

function requireNodeSqlite(): typeof import("node:sqlite") {
  try {
    return require("node:sqlite") as typeof import("node:sqlite");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SQLite support is unavailable in this Node runtime (missing node:sqlite). ${message}`,
      { cause: error },
    );
  }
}

function createStatements(db: DatabaseSync): Statements {
  return {
    selectMeta: db.prepare(`
      SELECT profile_id, last_lamport, last_event_hash, migration_version
      FROM meta
      WHERE profile_id = ?
    `),
    insertMeta: db.prepare(`
      INSERT OR IGNORE INTO meta (profile_id, last_lamport, last_event_hash, migration_version)
      VALUES (?, ?, ?, ?)
    `),
    updateMeta: db.prepare(`
      UPDATE meta
      SET last_lamport = @last_lamport,
          last_event_hash = @last_event_hash,
          migration_version = @migration_version
      WHERE profile_id = @profile_id
    `),
    selectEventById: db.prepare(`
      SELECT
        event_id,
        profile_id,
        device_id,
        lamport,
        event_type,
        schema_version,
        created_at_ms,
        payload_plain,
        payload_cipher,
        nonce,
        aad,
        payload_hash,
        prev_event_hash,
        event_hash
      FROM memory_events
      WHERE profile_id = ? AND event_id = ?
    `),
    selectEventsSince: db.prepare(`
      SELECT
        event_id,
        profile_id,
        device_id,
        lamport,
        event_type,
        schema_version,
        created_at_ms,
        payload_plain,
        payload_cipher,
        nonce,
        aad,
        payload_hash,
        prev_event_hash,
        event_hash
      FROM memory_events
      WHERE profile_id = ? AND lamport > ?
      ORDER BY lamport ASC, event_id ASC
      LIMIT ?
    `),
    selectLastEvent: db.prepare(`
      SELECT
        event_id,
        profile_id,
        device_id,
        lamport,
        event_type,
        schema_version,
        created_at_ms,
        payload_plain,
        payload_cipher,
        nonce,
        aad,
        payload_hash,
        prev_event_hash,
        event_hash
      FROM memory_events
      WHERE profile_id = ?
      ORDER BY lamport DESC, event_id DESC
      LIMIT 1
    `),
    insertEvent: db.prepare(`
      INSERT INTO memory_events (
        event_id,
        profile_id,
        device_id,
        lamport,
        event_type,
        schema_version,
        created_at_ms,
        payload_plain,
        payload_cipher,
        nonce,
        aad,
        payload_hash,
        prev_event_hash,
        event_hash
      ) VALUES (
        @event_id,
        @profile_id,
        @device_id,
        @lamport,
        @event_type,
        @schema_version,
        @created_at_ms,
        @payload_plain,
        @payload_cipher,
        @nonce,
        @aad,
        @payload_hash,
        @prev_event_hash,
        @event_hash
      )
    `),
    selectMaxLamportByDevice: db.prepare(`
      SELECT MAX(lamport) AS lamport
      FROM memory_events
      WHERE profile_id = ? AND device_id = ?
    `),
    selectAck: db.prepare(`
      SELECT ack_lamport, ack_event_id
      FROM replica_acks
      WHERE profile_id = ? AND replica_id = ?
    `),
    replaceAck: db.prepare(`
      INSERT INTO replica_acks (
        profile_id,
        replica_id,
        ack_lamport,
        ack_event_id,
        updated_at_ms
      ) VALUES (
        @profile_id,
        @replica_id,
        @ack_lamport,
        @ack_event_id,
        @updated_at_ms
      )
      ON CONFLICT(profile_id, replica_id)
      DO UPDATE SET
        ack_lamport = excluded.ack_lamport,
        ack_event_id = excluded.ack_event_id,
        updated_at_ms = excluded.updated_at_ms
    `),
    selectAckVector: db.prepare(`
      SELECT replica_id, ack_lamport
      FROM replica_acks
      WHERE profile_id = ?
      ORDER BY replica_id ASC
    `),
    selectAckFloor: db.prepare(`
      SELECT MIN(ack_lamport) AS ack_floor
      FROM replica_acks
      WHERE profile_id = ?
    `),
    selectCheckpointById: db.prepare(`
      SELECT
        checkpoint_id,
        profile_id,
        covered_until_lamport,
        state_hash,
        payload_cipher,
        created_at_ms
      FROM checkpoints
      WHERE checkpoint_id = ?
    `),
    insertCheckpoint: db.prepare(`
      INSERT INTO checkpoints (
        checkpoint_id,
        profile_id,
        covered_until_lamport,
        state_hash,
        payload_cipher,
        created_at_ms
      ) VALUES (
        @checkpoint_id,
        @profile_id,
        @covered_until_lamport,
        @state_hash,
        @payload_cipher,
        @created_at_ms
      )
    `),
    selectLatestCheckpoint: db.prepare(`
      SELECT
        checkpoint_id,
        profile_id,
        covered_until_lamport,
        state_hash,
        payload_cipher,
        created_at_ms
      FROM checkpoints
      WHERE profile_id = ?
      ORDER BY covered_until_lamport DESC, created_at_ms DESC, checkpoint_id DESC
      LIMIT 1
    `),
  };
}

function migrateLedgerDatabase(
  db: DatabaseSync,
  pathname: string,
  profileId: string,
  telemetry?: LedgerTelemetry,
): void {
  withWriteTransaction(db, pathname, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_events (
        event_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        lamport INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        payload_plain BLOB NULL,
        payload_cipher BLOB NULL,
        nonce BLOB NULL,
        aad BLOB NULL,
        payload_hash TEXT NOT NULL,
        prev_event_hash TEXT NULL,
        event_hash TEXT NOT NULL
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS replica_acks (
        profile_id TEXT NOT NULL,
        replica_id TEXT NOT NULL,
        ack_lamport INTEGER NOT NULL,
        ack_event_id TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(profile_id, replica_id)
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        covered_until_lamport INTEGER NOT NULL,
        state_hash TEXT NOT NULL,
        payload_cipher BLOB NULL,
        created_at_ms INTEGER NOT NULL
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        profile_id TEXT PRIMARY KEY,
        last_lamport INTEGER NOT NULL,
        last_event_hash TEXT NOT NULL,
        migration_version INTEGER NOT NULL
      );
    `);

    ensureColumn(db, "memory_events", "payload_plain", "BLOB NULL");
    ensureColumn(db, "memory_events", "payload_cipher", "BLOB NULL");
    ensureColumn(db, "memory_events", "nonce", "BLOB NULL");
    ensureColumn(db, "memory_events", "aad", "BLOB NULL");
    ensureColumn(db, "memory_events", "payload_hash", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "memory_events", "prev_event_hash", "TEXT NULL");
    ensureColumn(db, "memory_events", "event_hash", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "replica_acks", "ack_event_id", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "replica_acks", "updated_at_ms", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "checkpoints", "payload_cipher", "BLOB NULL");
    ensureColumn(db, "meta", "last_lamport", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "meta", "last_event_hash", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(
      db,
      "meta",
      "migration_version",
      `INTEGER NOT NULL DEFAULT ${LEDGER_MIGRATION_VERSION}`,
    );

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_profile_lamport
      ON memory_events(profile_id, lamport);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_profile_device_lamport
      ON memory_events(profile_id, device_id, lamport);
    `);

    const statements = createStatements(db);
    statements.insertMeta.run(profileId, 0, "", LEDGER_MIGRATION_VERSION);
    const metaRow = getMetaRow(statements, profileId);
    const lastEvent = statements.selectLastEvent.get(profileId) as EventRow | undefined;
    if (!lastEvent) {
      statements.updateMeta.run({
        profile_id: profileId,
        last_lamport: 0,
        last_event_hash: "",
        migration_version: LEDGER_MIGRATION_VERSION,
      });
      return;
    }

    const lastLamport = toNumber(lastEvent.lamport);
    const lastEventHash = lastEvent.event_hash;
    if (
      metaRow.lastLamport > lastLamport ||
      (metaRow.lastEventHash && metaRow.lastEventHash !== lastEventHash)
    ) {
      telemetry?.onCorruptionDetected?.({
        profileId,
        code: "meta_mismatch",
        message:
          "Ledger meta row does not match the last persisted event. Manual repair is required before continuing.",
        eventId: lastEvent.event_id,
      });
      throw new Error("Ledger meta row does not match the last persisted event.");
    }
    statements.updateMeta.run({
      profile_id: profileId,
      last_lamport: lastLamport,
      last_event_hash: lastEventHash,
      migration_version: LEDGER_MIGRATION_VERSION,
    });
  });
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function getMetaRow(
  statements: Statements,
  profileId: string,
): {
  lastLamport: number;
  lastEventHash: string | null;
  migrationVersion: number;
} {
  const row = statements.selectMeta.get(profileId) as MetaRow | undefined;
  if (!row) {
    throw new Error(`Missing meta row for profile ${profileId}.`);
  }
  return {
    lastLamport: toNumber(row.last_lamport ?? 0),
    lastEventHash: normalizeNullableString(row.last_event_hash),
    migrationVersion: toNumber(row.migration_version ?? LEDGER_MIGRATION_VERSION),
  };
}

function getMaxLamportForDevice(
  statements: Statements,
  profileId: string,
  deviceId: string,
): number {
  const row = statements.selectMaxLamportByDevice.get(profileId, deviceId) as
    | MaxLamportRow
    | undefined;
  return row?.lamport == null ? 0 : toNumber(row.lamport);
}

function rowToStoredLedgerEvent(row: EventRow): StoredLedgerEvent {
  const payload = row.payload_plain
    ? {
        kind: "plain" as const,
        bytes: copyBytes(row.payload_plain),
      }
    : {
        kind: "encrypted" as const,
        ciphertext: copyBytes(assertBytes(row.payload_cipher, "payload_cipher")),
        nonce: copyBytes(assertBytes(row.nonce, "nonce")),
        ...(row.aad ? { aad: copyBytes(row.aad) } : {}),
      };

  return {
    meta: {
      eventId: row.event_id,
      profileId: row.profile_id,
      deviceId: row.device_id,
      lamport: toNumber(row.lamport),
      eventType: row.event_type,
      schemaVersion: toNumber(row.schema_version),
      createdAtMs: toNumber(row.created_at_ms),
    },
    payload,
    payloadHash: row.payload_hash,
    prevEventHash: normalizeNullableString(row.prev_event_hash),
    eventHash: row.event_hash,
  };
}

function rowToCheckpoint(row: CheckpointRow): LedgerCheckpoint {
  return {
    checkpointId: CheckpointIdSchema.parse(row.checkpoint_id),
    profileId: row.profile_id,
    coveredUntilLamport: toNumber(row.covered_until_lamport),
    stateHash: row.state_hash,
    ...(row.payload_cipher ? { payloadCipher: copyBytes(row.payload_cipher) } : {}),
    createdAtMs: toNumber(row.created_at_ms),
  };
}

function normalizeAppendInput(input: LedgerAppendEventInput): NormalizedAppendEventInput {
  const meta = EventEnvelopeMetaSchema.parse(input.meta);
  const payload = normalizeLedgerPayload(input.payload);
  return { meta, payload };
}

function storedEventMatchesInput(
  event: StoredLedgerEvent,
  input: NormalizedAppendEventInput,
): boolean {
  const normalizedPayloadHash = computeSha256Hex(payloadHashBytes(input.payload));
  return (
    canonicalizeEventMetaForHash(event.meta) === canonicalizeEventMetaForHash(input.meta) &&
    payloadsEqual(event.payload, input.payload) &&
    event.payloadHash === normalizedPayloadHash
  );
}

function appendInputsEqual(
  left: NormalizedAppendEventInput,
  right: NormalizedAppendEventInput,
): boolean {
  return (
    canonicalizeEventMetaForHash(left.meta) === canonicalizeEventMetaForHash(right.meta) &&
    payloadsEqual(left.payload, right.payload)
  );
}

function payloadsEqual(left: EventPayloadEnvelope, right: EventPayloadEnvelope): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "plain") {
    return right.kind === "plain" && bytesEqual(left.bytes, right.bytes);
  }
  if (right.kind !== "encrypted") {
    return false;
  }
  return (
    bytesEqual(left.ciphertext, right.ciphertext) &&
    bytesEqual(left.nonce, right.nonce) &&
    bytesEqual(left.aad, right.aad)
  );
}

function bytesEqual(left?: Uint8Array | null, right?: Uint8Array | null): boolean {
  if (left == null || right == null) {
    return left == null && right == null;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function payloadLength(payload: EventPayloadEnvelope): number {
  if (payload.kind === "plain") {
    return payload.bytes.byteLength;
  }
  return payload.ciphertext.byteLength + payload.nonce.byteLength + (payload.aad?.byteLength ?? 0);
}

function toSqliteBlob(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes);
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function assertBytes(bytes: Uint8Array | null, fieldName: string): Uint8Array {
  if (!bytes) {
    throw new Error(`Missing ${fieldName} bytes.`);
  }
  return bytes;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must not be empty.`);
  }
  return trimmed;
}

function normalizePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return value;
}

function normalizeNonNegativeInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
  return value;
}

function normalizeSha256Hex(value: string, fieldName: string): HashHex {
  const trimmed = value.trim().toLowerCase();
  if (!SHA256_HEX_REGEX.test(trimmed)) {
    throw new Error(`${fieldName} must be a lowercase sha256 hex digest.`);
  }
  return trimmed;
}

function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function withWriteTransaction<T>(db: DatabaseSync, path: string, write: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = write();
    db.exec("COMMIT");
    ensureLedgerFilesystem(path);
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
