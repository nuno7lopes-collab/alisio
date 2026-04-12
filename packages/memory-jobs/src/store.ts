import type { DatabaseSync } from "node:sqlite";
import { withImmediateTransaction } from "./sqlite.js";
import type {
  MemoryJobEvent,
  MemoryJobKind,
  MemoryJobRecord,
  MemoryJobStatus,
  SleepClock,
  SleepTelemetrySnapshot,
} from "./types.js";
import { createEventId, parseJsonValue, stableStringify } from "./utils.js";

type TelemetryRow = {
  metric_key: string;
  value: number;
};

type MemoryJobRow = {
  job_id: string;
  profile_id: string;
  kind: MemoryJobKind;
  status: MemoryJobStatus;
  cursor_json: string;
  updated_at_ms: number;
  last_error: string | null;
};

type EventRow = {
  event_id: string;
  job_id: string;
  profile_id: string;
  kind: MemoryJobKind;
  event_type: MemoryJobEvent["eventType"];
  entity_id: string | null;
  target_entity_id: string | null;
  payload_json: string;
  created_at_ms: number;
  dedupe_key: string | null;
};

export class SqliteMemoryJobStore {
  constructor(
    readonly db: DatabaseSync,
    private readonly clock: SleepClock,
  ) {
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_jobs (
        job_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        cursor_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        last_error TEXT
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_job_events (
        event_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        event_type TEXT NOT NULL,
        entity_id TEXT,
        target_entity_id TEXT,
        payload_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        dedupe_key TEXT
      );
    `);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_job_events_dedupe
      ON memory_job_events(dedupe_key)
      WHERE dedupe_key IS NOT NULL;
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_job_telemetry (
        metric_key TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        value INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(metric_key, profile_id)
      );
    `);
  }

  readJobRecord<TCursor>(params: {
    jobId: string;
    profileId: string;
    kind: MemoryJobKind;
    initialCursor: TCursor;
  }): { record: MemoryJobRecord; cursor: TCursor } {
    const row = this.db
      .prepare(
        `SELECT job_id, profile_id, kind, status, cursor_json, updated_at_ms, last_error
         FROM memory_jobs
         WHERE job_id = ?`,
      )
      .get(params.jobId) as MemoryJobRow | undefined;
    if (!row) {
      const record: MemoryJobRecord = {
        jobId: params.jobId,
        profileId: params.profileId,
        kind: params.kind,
        status: "idle",
        cursorJson: stableStringify(params.initialCursor),
        updatedAtMs: this.clock.now(),
      };
      return { record, cursor: params.initialCursor };
    }
    return {
      record: {
        jobId: row.job_id,
        profileId: row.profile_id,
        kind: row.kind,
        status: row.status,
        cursorJson: row.cursor_json,
        updatedAtMs: row.updated_at_ms,
        ...(row.last_error ? { lastError: row.last_error } : {}),
      },
      cursor: parseJsonValue(row.cursor_json, params.initialCursor),
    };
  }

  saveJobRecord<TCursor>(params: {
    jobId: string;
    profileId: string;
    kind: MemoryJobKind;
    status: MemoryJobStatus;
    cursor: TCursor;
    lastError?: string;
  }): MemoryJobRecord {
    const updatedAtMs = this.clock.now();
    const cursorJson = stableStringify(params.cursor);
    this.db
      .prepare(
        `INSERT INTO memory_jobs (job_id, profile_id, kind, status, cursor_json, updated_at_ms, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET
           profile_id = excluded.profile_id,
           kind = excluded.kind,
           status = excluded.status,
           cursor_json = excluded.cursor_json,
           updated_at_ms = excluded.updated_at_ms,
           last_error = excluded.last_error`,
      )
      .run(
        params.jobId,
        params.profileId,
        params.kind,
        params.status,
        cursorJson,
        updatedAtMs,
        params.lastError ?? null,
      );
    return {
      jobId: params.jobId,
      profileId: params.profileId,
      kind: params.kind,
      status: params.status,
      cursorJson,
      updatedAtMs,
      ...(params.lastError ? { lastError: params.lastError } : {}),
    };
  }

  appendAuditEvent(event: Omit<MemoryJobEvent, "eventId" | "createdAtMs">): boolean {
    const eventId = createEventId(
      "memory-job-event",
      [
        event.jobId,
        event.eventType,
        event.entityId ?? "",
        event.targetEntityId ?? "",
        event.dedupeKey ?? "",
        stableStringify(event.payload),
      ].join(":"),
    );
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO memory_job_events (
           event_id,
           job_id,
           profile_id,
           kind,
           event_type,
           entity_id,
           target_entity_id,
           payload_json,
           created_at_ms,
           dedupe_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        event.jobId,
        event.profileId,
        event.kind,
        event.eventType,
        event.entityId ?? null,
        event.targetEntityId ?? null,
        stableStringify(event.payload),
        this.clock.now(),
        event.dedupeKey ?? null,
      );
    return (result.changes ?? 0) > 0;
  }

  incrementTelemetry(profileId: string, metricKey: string, delta = 1): void {
    this.db
      .prepare(
        `INSERT INTO memory_job_telemetry (metric_key, profile_id, value, updated_at_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(metric_key, profile_id) DO UPDATE SET
           value = memory_job_telemetry.value + excluded.value,
           updated_at_ms = excluded.updated_at_ms`,
      )
      .run(metricKey, profileId, delta, this.clock.now());
  }

  readTelemetry(profileId: string): SleepTelemetrySnapshot {
    const rows = this.db
      .prepare(
        `SELECT metric_key, value
         FROM memory_job_telemetry
         WHERE profile_id = ?
         ORDER BY metric_key ASC`,
      )
      .all(profileId) as TelemetryRow[];
    return {
      counts: Object.fromEntries(rows.map((row) => [row.metric_key, row.value])),
    };
  }

  listJobRecords(profileId: string): MemoryJobRecord[] {
    const rows = this.db
      .prepare(
        `SELECT job_id, profile_id, kind, status, cursor_json, updated_at_ms, last_error
         FROM memory_jobs
         WHERE profile_id = ?
         ORDER BY kind ASC, job_id ASC`,
      )
      .all(profileId) as MemoryJobRow[];
    return rows.map((row) => ({
      jobId: row.job_id,
      profileId: row.profile_id,
      kind: row.kind,
      status: row.status,
      cursorJson: row.cursor_json,
      updatedAtMs: row.updated_at_ms,
      ...(row.last_error ? { lastError: row.last_error } : {}),
    }));
  }

  listAuditEvents(params: { profileId: string; kind?: MemoryJobKind }): MemoryJobEvent[] {
    const rows = (
      params.kind
        ? this.db
            .prepare(
              `SELECT
               event_id,
               job_id,
               profile_id,
               kind,
               event_type,
               entity_id,
               target_entity_id,
               payload_json,
               created_at_ms,
               dedupe_key
             FROM memory_job_events
             WHERE profile_id = ? AND kind = ?
             ORDER BY created_at_ms ASC, event_id ASC`,
            )
            .all(params.profileId, params.kind)
        : this.db
            .prepare(
              `SELECT
               event_id,
               job_id,
               profile_id,
               kind,
               event_type,
               entity_id,
               target_entity_id,
               payload_json,
               created_at_ms,
               dedupe_key
             FROM memory_job_events
             WHERE profile_id = ?
             ORDER BY created_at_ms ASC, event_id ASC`,
            )
            .all(params.profileId)
    ) as EventRow[];

    return rows.map((row) => ({
      eventId: row.event_id,
      jobId: row.job_id,
      profileId: row.profile_id,
      kind: row.kind,
      eventType: row.event_type,
      ...(row.entity_id ? { entityId: row.entity_id } : {}),
      ...(row.target_entity_id ? { targetEntityId: row.target_entity_id } : {}),
      payload: parseJsonValue<Record<string, unknown>>(row.payload_json, {}),
      createdAtMs: row.created_at_ms,
      ...(row.dedupe_key ? { dedupeKey: row.dedupe_key } : {}),
    }));
  }

  transaction<T>(work: () => T): T {
    return withImmediateTransaction(this.db, work);
  }
}
