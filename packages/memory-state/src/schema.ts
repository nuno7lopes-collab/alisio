import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { decodeBinaryBase64, encodeBinaryBase64 } from "./crdt.js";
import {
  MEMORY_STATE_SCHEMA_VERSION,
  type MemoryStateCheckpointSnapshot,
  type MemoryStateMetaRow,
} from "./types.js";

type OrderedTableSnapshot = MemoryStateCheckpointSnapshot["tables"];

type MetaRowRecord = {
  migration_version: number | bigint;
  last_applied_lamport: number | bigint;
  last_checkpoint_id: string | null;
};

function normalizeNumber(value: number | bigint | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return typeof value === "number" ? value : 0;
}

function normalizeTableRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Uint8Array) {
        normalized[key] = encodeBinaryBase64(value);
        continue;
      }
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
        normalized[key] = encodeBinaryBase64(value);
        continue;
      }
      normalized[key] = typeof value === "bigint" ? Number(value) : value;
    }
    return normalized;
  });
}

function orderedTableSnapshot(db: DatabaseSync): OrderedTableSnapshot {
  return {
    pages: normalizeTableRows(
      db
        .prepare(
          `SELECT page_id, title, slug, created_at_ms, updated_at_ms, tombstoned
           FROM pages
           ORDER BY page_id ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    ),
    pageDocState: normalizeTableRows(
      db
        .prepare(
          `SELECT page_id, yjs_state, updated_at_ms
           FROM page_doc_state
           ORDER BY page_id ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    ),
    claims: normalizeTableRows(
      db
        .prepare(
          `SELECT claim_id, subject, predicate, object, confidence, status, updated_at_ms
           FROM claims
           ORDER BY claim_id ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    ),
    evidence: normalizeTableRows(
      db
        .prepare(
          `SELECT evidence_id, claim_id, source_locator, quote, hash, created_at_ms
           FROM evidence
           ORDER BY evidence_id ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    ),
    links: normalizeTableRows(
      db
        .prepare(
          `SELECT from_page_id, to_page_id, type, ordinal
           FROM links
           ORDER BY from_page_id ASC, ordinal ASC, to_page_id ASC, type ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    ),
    attachments: normalizeTableRows(
      db
        .prepare(
          `SELECT blob_id, mime, bytes, sha256, created_at_ms
           FROM attachments
           ORDER BY blob_id ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    ),
    projections: normalizeTableRows(
      db
        .prepare(
          `SELECT page_id, kind, markdown_body, updated_at_ms
           FROM projections
           ORDER BY page_id ASC, kind ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    ),
    dashboards: normalizeTableRows(
      db
        .prepare(
          `SELECT kind, json, updated_at_ms
           FROM dashboards
           ORDER BY kind ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    ),
    pageAliases: normalizeTableRows(
      db
        .prepare(
          `SELECT page_id, alias_key, ordinal
           FROM page_aliases
           ORDER BY page_id ASC, ordinal ASC, alias_key ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    ),
    pageTags: normalizeTableRows(
      db
        .prepare(
          `SELECT page_id, tag, ordinal
           FROM page_tags
           ORDER BY page_id ASC, ordinal ASC, tag ASC`,
        )
        .all() as Array<Record<string, unknown>>,
    ),
  };
}

function asSqlValue(value: unknown): SQLInputValue {
  return value as SQLInputValue;
}

function snapshotBase64(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function ensureMemoryStateSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      page_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      tombstoned INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_doc_state (
      page_id TEXT PRIMARY KEY,
      yjs_state BLOB NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      claim_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at_ms INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence (
      evidence_id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      source_locator TEXT NOT NULL,
      quote TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      from_page_id TEXT NOT NULL,
      to_page_id TEXT NOT NULL,
      type TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      PRIMARY KEY (from_page_id, to_page_id, type, ordinal)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      blob_id TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      bytes BLOB NOT NULL,
      sha256 TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS projections (
      page_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      markdown_body TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (page_id, kind)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboards (
      kind TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      migration_version INTEGER NOT NULL,
      last_applied_lamport INTEGER NOT NULL,
      last_checkpoint_id TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_aliases (
      page_id TEXT NOT NULL,
      alias_key TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      PRIMARY KEY (page_id, alias_key)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_tags (
      page_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      PRIMARY KEY (page_id, tag)
    );
  `);
  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM meta`).get() as
    | {
        count: number;
      }
    | undefined;
  if ((countRow?.count ?? 0) === 0) {
    db.prepare(
      `INSERT INTO meta (migration_version, last_applied_lamport, last_checkpoint_id)
       VALUES (?, ?, ?)`,
    ).run(0, 0, null);
  }
}

export function readMemoryStateMeta(db: DatabaseSync): MemoryStateMetaRow {
  const row = db.prepare(`SELECT * FROM meta LIMIT 1`).get() as MetaRowRecord | undefined;
  return {
    migrationVersion: normalizeNumber(row?.migration_version),
    lastAppliedLamport: normalizeNumber(row?.last_applied_lamport),
    ...(row?.last_checkpoint_id ? { lastCheckpointId: row.last_checkpoint_id } : {}),
  };
}

export function writeMemoryStateMeta(db: DatabaseSync, meta: MemoryStateMetaRow): void {
  db.exec(`DELETE FROM meta`);
  db.prepare(
    `INSERT INTO meta (migration_version, last_applied_lamport, last_checkpoint_id)
     VALUES (?, ?, ?)`,
  ).run(meta.migrationVersion, meta.lastAppliedLamport, meta.lastCheckpointId ?? null);
}

export function clearDerivedStateTables(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM page_doc_state;
    DELETE FROM page_aliases;
    DELETE FROM page_tags;
    DELETE FROM links;
    DELETE FROM evidence;
    DELETE FROM claims;
    DELETE FROM attachments;
    DELETE FROM projections;
    DELETE FROM dashboards;
    DELETE FROM pages;
  `);
}

export function captureMemoryStateCheckpoint(db: DatabaseSync): MemoryStateCheckpointSnapshot {
  return {
    schemaVersion: MEMORY_STATE_SCHEMA_VERSION,
    meta: readMemoryStateMeta(db),
    tables: orderedTableSnapshot(db),
  };
}

export function restoreMemoryStateCheckpoint(
  db: DatabaseSync,
  snapshot: MemoryStateCheckpointSnapshot,
): void {
  clearDerivedStateTables(db);
  const insertPage = db.prepare(
    `INSERT INTO pages (page_id, title, slug, created_at_ms, updated_at_ms, tombstoned)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertPageDoc = db.prepare(
    `INSERT INTO page_doc_state (page_id, yjs_state, updated_at_ms)
     VALUES (?, ?, ?)`,
  );
  const insertClaim = db.prepare(
    `INSERT INTO claims (claim_id, subject, predicate, object, confidence, status, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEvidence = db.prepare(
    `INSERT INTO evidence (evidence_id, claim_id, source_locator, quote, hash, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertLink = db.prepare(
    `INSERT INTO links (from_page_id, to_page_id, type, ordinal)
     VALUES (?, ?, ?, ?)`,
  );
  const insertAttachment = db.prepare(
    `INSERT INTO attachments (blob_id, mime, bytes, sha256, created_at_ms)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertProjection = db.prepare(
    `INSERT INTO projections (page_id, kind, markdown_body, updated_at_ms)
     VALUES (?, ?, ?, ?)`,
  );
  const insertDashboard = db.prepare(
    `INSERT INTO dashboards (kind, json, updated_at_ms)
     VALUES (?, ?, ?)`,
  );
  const insertAlias = db.prepare(
    `INSERT INTO page_aliases (page_id, alias_key, ordinal)
     VALUES (?, ?, ?)`,
  );
  const insertTag = db.prepare(
    `INSERT INTO page_tags (page_id, tag, ordinal)
     VALUES (?, ?, ?)`,
  );
  for (const row of snapshot.tables.pages) {
    insertPage.run(
      asSqlValue(row.page_id),
      asSqlValue(row.title),
      asSqlValue(row.slug),
      asSqlValue(row.created_at_ms),
      asSqlValue(row.updated_at_ms),
      asSqlValue(row.tombstoned),
    );
  }
  for (const row of snapshot.tables.pageDocState) {
    insertPageDoc.run(
      asSqlValue(row.page_id),
      decodeBinaryBase64(snapshotBase64(row.yjs_state)),
      asSqlValue(row.updated_at_ms),
    );
  }
  for (const row of snapshot.tables.claims) {
    insertClaim.run(
      asSqlValue(row.claim_id),
      asSqlValue(row.subject),
      asSqlValue(row.predicate),
      asSqlValue(row.object),
      asSqlValue(row.confidence),
      asSqlValue(row.status),
      asSqlValue(row.updated_at_ms),
    );
  }
  for (const row of snapshot.tables.evidence) {
    insertEvidence.run(
      asSqlValue(row.evidence_id),
      asSqlValue(row.claim_id),
      asSqlValue(row.source_locator),
      asSqlValue(row.quote),
      asSqlValue(row.hash),
      asSqlValue(row.created_at_ms),
    );
  }
  for (const row of snapshot.tables.links) {
    insertLink.run(
      asSqlValue(row.from_page_id),
      asSqlValue(row.to_page_id),
      asSqlValue(row.type),
      asSqlValue(row.ordinal),
    );
  }
  for (const row of snapshot.tables.attachments) {
    insertAttachment.run(
      asSqlValue(row.blob_id),
      asSqlValue(row.mime),
      decodeBinaryBase64(snapshotBase64(row.bytes)),
      asSqlValue(row.sha256),
      asSqlValue(row.created_at_ms),
    );
  }
  for (const row of snapshot.tables.projections) {
    insertProjection.run(
      asSqlValue(row.page_id),
      asSqlValue(row.kind),
      asSqlValue(row.markdown_body),
      asSqlValue(row.updated_at_ms),
    );
  }
  for (const row of snapshot.tables.dashboards) {
    insertDashboard.run(asSqlValue(row.kind), asSqlValue(row.json), asSqlValue(row.updated_at_ms));
  }
  for (const row of snapshot.tables.pageAliases) {
    insertAlias.run(asSqlValue(row.page_id), asSqlValue(row.alias_key), asSqlValue(row.ordinal));
  }
  for (const row of snapshot.tables.pageTags) {
    insertTag.run(asSqlValue(row.page_id), asSqlValue(row.tag), asSqlValue(row.ordinal));
  }
  writeMemoryStateMeta(db, snapshot.meta);
}

export function computeMemoryStateHash(db: DatabaseSync): string {
  const snapshot = captureMemoryStateCheckpoint(db);
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
