import type { DatabaseSync } from "node:sqlite";
import {
  applyDocUpdateToState,
  createDocStateFromMarkdown,
  createDocUpdateForMarkdown,
  readMarkdownFromDocState,
} from "./crdt.js";
import {
  captureMemoryStateCheckpoint,
  clearDerivedStateTables,
  computeMemoryStateHash,
  ensureMemoryStateSchema,
  readMemoryStateMeta,
  restoreMemoryStateCheckpoint,
  writeMemoryStateMeta,
} from "./schema.js";
import type {
  BinaryInput,
  MemoryAttachmentAddedPayload,
  MemoryCheckpointCreatedPayload,
  MemoryClaimUpsertedPayload,
  MemoryDocCrdtSnapshotPayload,
  MemoryDocCrdtUpdatePayload,
  MemoryDashboardSetPayload,
  MemoryEvidenceAddedPayload,
  MemoryLinksReplacedPayload,
  MemoryPageCreatedPayload,
  MemoryPageMetadataUpdatedPayload,
  MemoryPageTombstonedPayload,
  MemoryProjectionSetPayload,
  MemoryStateCheckpointSnapshot,
  MemoryStateEventEnvelopePlain,
  MemoryStateMetaRow,
  MemoryStateSqliteMutation,
} from "./types.js";

function normalizeBinaryInput(value: BinaryInput): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof value === "string") {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }
  return new Uint8Array();
}

function replacePageAliasesMutations(
  pageId: string,
  aliases: string[] | undefined,
): MemoryStateSqliteMutation[] {
  const mutations: MemoryStateSqliteMutation[] = [
    {
      sql: `DELETE FROM page_aliases WHERE page_id = ?`,
      params: [pageId],
    },
  ];
  for (const [ordinal, alias] of (aliases ?? []).entries()) {
    mutations.push({
      sql: `INSERT INTO page_aliases (page_id, alias_key, ordinal) VALUES (?, ?, ?)`,
      params: [pageId, alias, ordinal],
    });
  }
  return mutations;
}

function replacePageTagsMutations(
  pageId: string,
  tags: string[] | undefined,
): MemoryStateSqliteMutation[] {
  const mutations: MemoryStateSqliteMutation[] = [
    {
      sql: `DELETE FROM page_tags WHERE page_id = ?`,
      params: [pageId],
    },
  ];
  for (const [ordinal, tag] of (tags ?? []).entries()) {
    mutations.push({
      sql: `INSERT INTO page_tags (page_id, tag, ordinal) VALUES (?, ?, ?)`,
      params: [pageId, tag, ordinal],
    });
  }
  return mutations;
}

function currentProjectionKinds(db: DatabaseSync, pageId: string): string[] {
  const rows = db
    .prepare(
      `SELECT kind
       FROM projections
       WHERE page_id = ?
       ORDER BY kind ASC`,
    )
    .all(pageId) as Array<{
    kind: string;
  }>;
  return rows.map((row) => row.kind).filter(Boolean);
}

function currentProjectionMarkdown(
  db: DatabaseSync,
  pageId: string,
  fallbackMarkdown?: string,
): string {
  if (typeof fallbackMarkdown === "string") {
    return fallbackMarkdown;
  }
  return readMarkdownFromDocState(
    (
      db
        .prepare(
          `SELECT yjs_state
           FROM page_doc_state
           WHERE page_id = ?`,
        )
        .get(pageId) as
        | {
            yjs_state: Uint8Array;
          }
        | undefined
    )?.yjs_state,
  );
}

function pageRowExists(db: DatabaseSync, pageId: string): boolean {
  const row = db.prepare(`SELECT 1 AS found FROM pages WHERE page_id = ?`).get(pageId) as
    | {
        found?: number;
      }
    | undefined;
  return row?.found === 1;
}

function reducePageMetadataUpsert(
  db: DatabaseSync,
  payload: MemoryPageMetadataUpdatedPayload & {
    pageId: string;
    title?: string;
    slug?: string;
    aliases?: string[];
    tags?: string[];
    updatedAtMs: number;
    createdAtMs?: number;
  },
): MemoryStateSqliteMutation[] {
  const existing = db
    .prepare(
      `SELECT title, slug, created_at_ms, tombstoned
       FROM pages
       WHERE page_id = ?`,
    )
    .get(payload.pageId) as
    | {
        title: string;
        slug: string;
        created_at_ms: number;
        tombstoned: number;
      }
    | undefined;
  const title = payload.title ?? existing?.title ?? payload.pageId;
  const slug = payload.slug ?? existing?.slug ?? payload.pageId;
  const createdAtMs = existing?.created_at_ms ?? payload.createdAtMs ?? payload.updatedAtMs;
  const tombstoned = existing?.tombstoned ?? 0;
  return [
    {
      sql:
        `INSERT INTO pages (page_id, title, slug, created_at_ms, updated_at_ms, tombstoned)` +
        ` VALUES (?, ?, ?, ?, ?, ?)` +
        ` ON CONFLICT(page_id) DO UPDATE SET` +
        ` title = excluded.title,` +
        ` slug = excluded.slug,` +
        ` updated_at_ms = excluded.updated_at_ms,` +
        ` tombstoned = excluded.tombstoned`,
      params: [payload.pageId, title, slug, createdAtMs, payload.updatedAtMs, tombstoned],
    },
    ...replacePageAliasesMutations(payload.pageId, payload.aliases),
    ...replacePageTagsMutations(payload.pageId, payload.tags),
  ];
}

function reduceDocSnapshotMutations(
  db: DatabaseSync,
  payload: MemoryDocCrdtSnapshotPayload,
  updatedAtMs: number,
): MemoryStateSqliteMutation[] {
  const normalizedState = normalizeBinaryInput(payload.yjsState);
  const markdown = readMarkdownFromDocState(normalizedState);
  const projectionKinds = currentProjectionKinds(db, payload.pageId);
  const mutations: MemoryStateSqliteMutation[] = [
    {
      sql:
        `INSERT INTO page_doc_state (page_id, yjs_state, updated_at_ms)` +
        ` VALUES (?, ?, ?)` +
        ` ON CONFLICT(page_id) DO UPDATE SET` +
        ` yjs_state = excluded.yjs_state,` +
        ` updated_at_ms = excluded.updated_at_ms`,
      params: [payload.pageId, Buffer.from(normalizedState), updatedAtMs],
    },
  ];
  for (const kind of projectionKinds) {
    mutations.push({
      sql:
        `UPDATE projections` +
        ` SET markdown_body = ?, updated_at_ms = ?` +
        ` WHERE page_id = ? AND kind = ?`,
      params: [markdown, updatedAtMs, payload.pageId, kind],
    });
  }
  return mutations;
}

function reduceDocUpdateMutations(
  db: DatabaseSync,
  payload: MemoryDocCrdtUpdatePayload,
  updatedAtMs: number,
): MemoryStateSqliteMutation[] {
  const current = db
    .prepare(
      `SELECT yjs_state
       FROM page_doc_state
       WHERE page_id = ?`,
    )
    .get(payload.pageId) as
    | {
        yjs_state: Uint8Array;
      }
    | undefined;
  const next = applyDocUpdateToState({
    currentState: current?.yjs_state,
    update: payload.update,
  });
  const projectionKinds = currentProjectionKinds(db, payload.pageId);
  const mutations: MemoryStateSqliteMutation[] = [
    {
      sql:
        `INSERT INTO page_doc_state (page_id, yjs_state, updated_at_ms)` +
        ` VALUES (?, ?, ?)` +
        ` ON CONFLICT(page_id) DO UPDATE SET` +
        ` yjs_state = excluded.yjs_state,` +
        ` updated_at_ms = excluded.updated_at_ms`,
      params: [payload.pageId, Buffer.from(next.yjsState), updatedAtMs],
    },
  ];
  for (const kind of projectionKinds) {
    mutations.push({
      sql:
        `UPDATE projections` +
        ` SET markdown_body = ?, updated_at_ms = ?` +
        ` WHERE page_id = ? AND kind = ?`,
      params: [next.markdown, updatedAtMs, payload.pageId, kind],
    });
  }
  return mutations;
}

function reduceAttachmentAddedMutations(
  payload: MemoryAttachmentAddedPayload,
  createdAtMs: number,
): MemoryStateSqliteMutation[] {
  return [
    {
      sql:
        `INSERT INTO attachments (blob_id, mime, bytes, sha256, created_at_ms)` +
        ` VALUES (?, ?, ?, ?, ?)` +
        ` ON CONFLICT(blob_id) DO UPDATE SET` +
        ` mime = excluded.mime,` +
        ` bytes = excluded.bytes,` +
        ` sha256 = excluded.sha256,` +
        ` created_at_ms = excluded.created_at_ms`,
      params: [
        payload.blobId,
        payload.mime,
        Buffer.from(normalizeBinaryInput(payload.bytes)),
        payload.sha256,
        createdAtMs,
      ],
    },
  ];
}

export function reduceEventToMutations(params: {
  db: DatabaseSync;
  event: MemoryStateEventEnvelopePlain;
}): MemoryStateSqliteMutation[] {
  const { db, event } = params;
  switch (event.type) {
    case "PAGE_CREATED": {
      const payload = event.payload as MemoryPageCreatedPayload;
      return reducePageMetadataUpsert(db, {
        ...payload,
        updatedAtMs: payload.updatedAtMs ?? event.createdAtMs,
        createdAtMs: payload.createdAtMs ?? event.createdAtMs,
      });
    }
    case "PAGE_METADATA_UPDATED": {
      const payload = event.payload as MemoryPageMetadataUpdatedPayload;
      return reducePageMetadataUpsert(db, {
        ...payload,
        updatedAtMs: payload.updatedAtMs ?? event.createdAtMs,
      });
    }
    case "PAGE_TOMBSTONED": {
      const payload = event.payload as MemoryPageTombstonedPayload;
      if (!pageRowExists(db, payload.pageId)) {
        return [];
      }
      return [
        {
          sql: `UPDATE pages SET tombstoned = ?, updated_at_ms = ? WHERE page_id = ?`,
          params: [
            payload.tombstoned === false ? 0 : 1,
            payload.updatedAtMs ?? event.createdAtMs,
            payload.pageId,
          ],
        },
      ];
    }
    case "DOC_CRDT_SNAPSHOT": {
      const payload = event.payload as MemoryDocCrdtSnapshotPayload;
      const snapshotState =
        payload.yjsState instanceof Uint8Array
          ? payload.yjsState
          : normalizeBinaryInput(payload.yjsState);
      return reduceDocSnapshotMutations(
        db,
        {
          pageId: payload.pageId,
          yjsState: snapshotState,
        },
        event.createdAtMs,
      );
    }
    case "DOC_CRDT_UPDATE":
      return reduceDocUpdateMutations(
        db,
        event.payload as MemoryDocCrdtUpdatePayload,
        event.createdAtMs,
      );
    case "LINKS_REPLACED": {
      const payload = event.payload as MemoryLinksReplacedPayload;
      const mutations: MemoryStateSqliteMutation[] = [
        {
          sql: `DELETE FROM links WHERE from_page_id = ?`,
          params: [payload.pageId],
        },
      ];
      for (const [index, link] of payload.links.entries()) {
        mutations.push({
          sql: `INSERT INTO links (from_page_id, to_page_id, type, ordinal) VALUES (?, ?, ?, ?)`,
          params: [
            payload.pageId,
            link.toPageId,
            link.type,
            typeof link.ordinal === "number" ? link.ordinal : index,
          ],
        });
      }
      return mutations;
    }
    case "PROJECTION_SET": {
      const payload = event.payload as MemoryProjectionSetPayload;
      const markdown = currentProjectionMarkdown(db, payload.pageId, payload.markdownBody);
      return [
        {
          sql:
            `INSERT INTO projections (page_id, kind, markdown_body, updated_at_ms)` +
            ` VALUES (?, ?, ?, ?)` +
            ` ON CONFLICT(page_id, kind) DO UPDATE SET` +
            ` markdown_body = excluded.markdown_body,` +
            ` updated_at_ms = excluded.updated_at_ms`,
          params: [payload.pageId, payload.kind, markdown, event.createdAtMs],
        },
      ];
    }
    case "CLAIM_UPSERTED": {
      const payload = event.payload as MemoryClaimUpsertedPayload;
      return [
        {
          sql:
            `INSERT INTO claims (claim_id, subject, predicate, object, confidence, status, updated_at_ms)` +
            ` VALUES (?, ?, ?, ?, ?, ?, ?)` +
            ` ON CONFLICT(claim_id) DO UPDATE SET` +
            ` subject = excluded.subject,` +
            ` predicate = excluded.predicate,` +
            ` object = excluded.object,` +
            ` confidence = excluded.confidence,` +
            ` status = excluded.status,` +
            ` updated_at_ms = excluded.updated_at_ms`,
          params: [
            payload.claimId,
            payload.subject,
            payload.predicate,
            payload.object,
            payload.confidence ?? 1,
            payload.status ?? "active",
            payload.updatedAtMs ?? event.createdAtMs,
          ],
        },
      ];
    }
    case "EVIDENCE_ADDED": {
      const payload = event.payload as MemoryEvidenceAddedPayload;
      return [
        {
          sql:
            `INSERT INTO evidence (evidence_id, claim_id, source_locator, quote, hash, created_at_ms)` +
            ` VALUES (?, ?, ?, ?, ?, ?)` +
            ` ON CONFLICT(evidence_id) DO UPDATE SET` +
            ` claim_id = excluded.claim_id,` +
            ` source_locator = excluded.source_locator,` +
            ` quote = excluded.quote,` +
            ` hash = excluded.hash,` +
            ` created_at_ms = excluded.created_at_ms`,
          params: [
            payload.evidenceId,
            payload.claimId,
            payload.sourceLocator,
            payload.quote,
            payload.hash,
            payload.createdAtMs ?? event.createdAtMs,
          ],
        },
      ];
    }
    case "ATTACHMENT_ADDED":
      return reduceAttachmentAddedMutations(
        event.payload as MemoryAttachmentAddedPayload,
        (event.payload as MemoryAttachmentAddedPayload).createdAtMs ?? event.createdAtMs,
      );
    case "DASHBOARD_SET": {
      const payload = event.payload as MemoryDashboardSetPayload;
      return [
        {
          sql:
            `INSERT INTO dashboards (kind, json, updated_at_ms)` +
            ` VALUES (?, ?, ?)` +
            ` ON CONFLICT(kind) DO UPDATE SET` +
            ` json = excluded.json,` +
            ` updated_at_ms = excluded.updated_at_ms`,
          params: [
            payload.kind,
            JSON.stringify(payload.json),
            payload.updatedAtMs ?? event.createdAtMs,
          ],
        },
      ];
    }
    case "JOB_CHECKPOINT_UPDATED":
    case "CHECKPOINT_CREATED":
      return [];
    default:
      return [];
  }
}

export function applyEventToDerivedState(params: {
  db: DatabaseSync;
  event: MemoryStateEventEnvelopePlain;
  migrationVersion?: number;
}): MemoryStateSqliteMutation[] {
  const mutations = reduceEventToMutations(params);
  const meta = readMemoryStateMeta(params.db);
  for (const mutation of mutations) {
    params.db.prepare(mutation.sql).run(...(mutation.params ?? []));
  }
  const lastCheckpointId =
    params.event.type === "CHECKPOINT_CREATED"
      ? (params.event.payload as MemoryCheckpointCreatedPayload).checkpointId
      : meta.lastCheckpointId;
  writeMemoryStateMeta(params.db, {
    migrationVersion: params.migrationVersion ?? meta.migrationVersion,
    lastAppliedLamport: Math.max(meta.lastAppliedLamport, params.event.lamport),
    lastCheckpointId,
  });
  return mutations;
}

export function sortMemoryStateEvents<T extends MemoryStateEventEnvelopePlain>(
  events: readonly T[],
): T[] {
  return events.toSorted((left, right) => {
    if (left.lamport !== right.lamport) {
      return left.lamport - right.lamport;
    }
    if (left.createdAtMs !== right.createdAtMs) {
      return left.createdAtMs - right.createdAtMs;
    }
    return left.eventId.localeCompare(right.eventId);
  });
}

export function rebuildDerivedStateFromEvents(params: {
  db: DatabaseSync;
  events: readonly MemoryStateEventEnvelopePlain[];
  migrationVersion?: number;
}): { lastAppliedLamport: number; stateHash: string } {
  ensureMemoryStateSchema(params.db);
  clearDerivedStateTables(params.db);
  const meta = readMemoryStateMeta(params.db);
  writeMemoryStateMeta(params.db, {
    migrationVersion: params.migrationVersion ?? meta.migrationVersion,
    lastAppliedLamport: 0,
    lastCheckpointId: meta.lastCheckpointId,
  });
  let lastAppliedLamport = 0;
  for (const event of sortMemoryStateEvents(params.events)) {
    applyEventToDerivedState({
      db: params.db,
      event,
      migrationVersion: params.migrationVersion ?? meta.migrationVersion,
    });
    lastAppliedLamport = event.lamport;
  }
  return {
    lastAppliedLamport,
    stateHash: computeMemoryStateHash(params.db),
  };
}

export {
  applyDocUpdateToState,
  captureMemoryStateCheckpoint,
  computeMemoryStateHash,
  createDocStateFromMarkdown,
  createDocUpdateForMarkdown,
  ensureMemoryStateSchema,
  readMarkdownFromDocState,
  readMemoryStateMeta,
  restoreMemoryStateCheckpoint,
  writeMemoryStateMeta,
};
export type {
  BinaryInput,
  MemoryPageCreatedPayload,
  MemoryPageLink,
  MemoryPageMetadata,
  MemoryPageMetadataUpdatedPayload,
  MemoryProjectionSetPayload,
  MemoryStateCheckpointSnapshot,
  MemoryStateEventDraft,
  MemoryStateEventEnvelopePlain,
  MemoryStateEventPayloadByType,
  MemoryStateEventType,
  MemoryStateMetaRow,
  MemoryStateSqliteMutation,
} from "./types.js";
