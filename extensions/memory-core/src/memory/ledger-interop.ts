import { createHash } from "node:crypto";
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { requireNodeSqlite } from "alisio/plugin-sdk/memory-core-host-engine-storage";
import type {
  MemoryStateEventDraft,
  MemoryStateEventEnvelopePlain,
  MemoryStateEventType,
} from "alisio/plugin-sdk/memory-core-state";
import { type MemoryLedger, openLedger } from "../../../../packages/memory-ledger/src/index.js";
import { resolveLedgerSqlitePath } from "../../../../packages/memory-ledger/src/paths.js";
import {
  createCanonicalStableId,
  isCanonicalStableId,
  type MemoryEventType,
} from "../../../../packages/memory-schema/src/index.js";

const MEMORY_STATE_EVENT_TYPES = [
  "PAGE_CREATED",
  "PAGE_METADATA_UPDATED",
  "PAGE_TOMBSTONED",
  "DOC_CRDT_SNAPSHOT",
  "DOC_CRDT_UPDATE",
  "LINKS_REPLACED",
  "PROJECTION_SET",
  "CLAIM_UPSERTED",
  "EVIDENCE_ADDED",
  "ATTACHMENT_ADDED",
  "DASHBOARD_SET",
  "JOB_CHECKPOINT_UPDATED",
  "CHECKPOINT_CREATED",
] as const satisfies readonly MemoryStateEventType[];

const MEMORY_STATE_EVENT_TYPE_SET = new Set<string>(MEMORY_STATE_EVENT_TYPES);
const MAX_ULID_TIMESTAMP = 0xffff_ffff_ffff;

type LedgerEventRow = {
  event_id: string;
  lamport: number | bigint;
  event_type: string;
  created_at_ms: number | bigint;
  payload_plain: Uint8Array | null;
};

type AttachmentAddedPayloadValue = MemoryStateEventEnvelopePlain<"ATTACHMENT_ADDED">["payload"];

export type MemoryAttachmentLedgerOrigin = {
  eventId: string;
  lamport: number;
  actorId: string;
  createdAt: string;
  pageId?: string;
};

function normalizeNumber(value: number | bigint | null | undefined): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return typeof value === "number" ? value : 0;
}

function isMemoryStateEventType(value: string): value is MemoryStateEventType {
  return MEMORY_STATE_EVENT_TYPE_SET.has(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).toSorted()) {
      sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function eventBinaryPayloadKey(eventType: string): "yjsState" | "update" | "bytes" | null {
  switch (eventType) {
    case "DOC_CRDT_SNAPSHOT":
      return "yjsState";
    case "DOC_CRDT_UPDATE":
      return "update";
    case "ATTACHMENT_ADDED":
      return "bytes";
    default:
      return null;
  }
}

function toBase64(value: unknown): string | null {
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("base64");
  }
  return typeof value === "string" ? value : null;
}

export function serializeMemoryStateLedgerEvent(event: MemoryStateEventEnvelopePlain): Uint8Array {
  const payload = { ...event.payload } as Record<string, unknown>;
  const binaryKey = eventBinaryPayloadKey(event.type);
  if (binaryKey) {
    const encoded = toBase64(payload[binaryKey]);
    if (encoded) {
      payload[binaryKey] = encoded;
    }
  }
  return Buffer.from(JSON.stringify({ ...event, payload }), "utf8");
}

export function deserializeMemoryStateLedgerEvent(
  bytes: Uint8Array,
  meta?: {
    lamport?: number;
    eventType?: string;
    createdAtMs?: number;
  },
): MemoryStateEventEnvelopePlain | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const type =
    typeof record.type === "string" && isMemoryStateEventType(record.type)
      ? record.type
      : typeof meta?.eventType === "string" && isMemoryStateEventType(meta.eventType)
        ? meta.eventType
        : null;
  if (!type) {
    return null;
  }
  const payload =
    record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
      ? ({ ...(record.payload as Record<string, unknown>) } as Record<string, unknown>)
      : null;
  if (!payload) {
    return null;
  }
  const binaryKey = eventBinaryPayloadKey(type);
  if (binaryKey && typeof payload[binaryKey] === "string") {
    payload[binaryKey] = Buffer.from(payload[binaryKey] as string, "base64");
  }
  const eventId = typeof record.eventId === "string" ? record.eventId : "";
  const actorId = typeof record.actorId === "string" ? record.actorId : "";
  if (!eventId || !actorId) {
    return null;
  }
  return {
    schemaVersion: 1,
    eventId,
    lamport: meta?.lamport ?? normalizeNumber(record.lamport as number | bigint),
    actorId,
    createdAtMs: meta?.createdAtMs ?? normalizeNumber(record.createdAtMs as number | bigint),
    type,
    payload: payload as never,
    ...(typeof record.pageId === "string" && record.pageId ? { pageId: record.pageId } : {}),
    ...(typeof record.source === "string" && record.source ? { source: record.source } : {}),
    ...(typeof record.batchId === "string" && record.batchId ? { batchId: record.batchId } : {}),
  };
}

function createCanonicalLedgerEventId(event: MemoryStateEventEnvelopePlain): string {
  if (isCanonicalStableId(event.eventId)) {
    return event.eventId;
  }
  const seed = stableStringify({
    eventId: event.eventId,
    type: event.type,
    pageId: event.pageId,
    source: event.source,
    batchId: event.batchId,
    payload: event.payload,
  });
  const digest = createHash("sha256").update(seed).digest();
  return createCanonicalStableId({
    nowMs: Math.max(0, Math.min(Math.trunc(event.createdAtMs), MAX_ULID_TIMESTAMP)),
    random: new Uint8Array(digest.subarray(0, 10)),
  });
}

function toLedgerMetaEventType(eventType: MemoryStateEventType): MemoryEventType {
  switch (eventType) {
    case "PAGE_METADATA_UPDATED":
      return "PAGE_CREATED";
    case "LINKS_REPLACED":
      return "LINK_ADDED";
    case "PROJECTION_SET":
      return "DOC_CRDT_SNAPSHOT";
    case "DASHBOARD_SET":
      return "JOB_CHECKPOINT_UPDATED";
    default:
      return eventType;
  }
}

export function assignMemoryStateLedgerEvents(params: {
  ledger: MemoryLedger;
  drafts: readonly MemoryStateEventDraft[];
}): MemoryStateEventEnvelopePlain[] {
  let lamport = params.ledger.getStats().lastLamport;
  return params.drafts.map((draft, index) => {
    lamport += 1;
    const createdAtMs = draft.createdAtMs ?? Date.now();
    const event: MemoryStateEventEnvelopePlain = {
      schemaVersion: 1,
      eventId:
        draft.eventId ??
        hashText(
          stableStringify({
            lamport,
            index,
            type: draft.type,
            pageId: draft.pageId,
            source: draft.source,
            batchId: draft.batchId,
            payload: draft.payload,
          }),
        ),
      lamport,
      actorId: draft.actorId,
      createdAtMs,
      type: draft.type,
      payload: draft.payload as never,
      ...(draft.pageId ? { pageId: draft.pageId } : {}),
      ...(draft.source ? { source: draft.source } : {}),
      ...(draft.batchId ? { batchId: draft.batchId } : {}),
    };
    return {
      ...event,
      eventId: createCanonicalLedgerEventId(event),
    };
  });
}

export function appendMemoryStateEvents(params: {
  ledger: MemoryLedger;
  profileId: string;
  events: readonly MemoryStateEventEnvelopePlain[];
}): MemoryStateEventEnvelopePlain[] {
  if (params.events.length === 0) {
    return [];
  }
  const results = params.ledger.appendBatch(
    params.events.map((event) => ({
      meta: {
        eventId: createCanonicalLedgerEventId(event),
        profileId: params.profileId,
        deviceId: event.actorId,
        lamport: event.lamport,
        eventType: toLedgerMetaEventType(event.type),
        createdAtMs: event.createdAtMs,
        schemaVersion: event.schemaVersion,
      },
      payload: serializeMemoryStateLedgerEvent(event),
    })),
  );
  return params.events.filter((_, index) => results[index]?.status === "inserted");
}

export function listMemoryStateEventsSince(params: {
  ledger: MemoryLedger;
  lamportExclusive: number;
  batchSize?: number;
}): MemoryStateEventEnvelopePlain[] {
  const batchSize = Math.max(1, params.batchSize ?? 256);
  const events: MemoryStateEventEnvelopePlain[] = [];
  let cursor = Math.max(0, Math.trunc(params.lamportExclusive));
  while (true) {
    const batch = params.ledger.listEventsSince(cursor, batchSize);
    if (batch.length === 0) {
      break;
    }
    for (const stored of batch) {
      cursor = Math.max(cursor, stored.meta.lamport);
      if (stored.payload.kind !== "plain") {
        continue;
      }
      const event = deserializeMemoryStateLedgerEvent(stored.payload.bytes, {
        lamport: stored.meta.lamport,
        createdAtMs: stored.meta.createdAtMs,
      });
      if (event) {
        events.push(event);
      }
    }
    if (batch.length < batchSize) {
      break;
    }
  }
  return events;
}

function openLedgerReadDb(params: { profileId: string; stateDir: string }): DatabaseSync | null {
  const pathname = resolveLedgerSqlitePath({
    profileId: params.profileId,
    stateDir: params.stateDir,
  });
  if (!fs.existsSync(pathname)) {
    return null;
  }
  const { DatabaseSync } = requireNodeSqlite();
  return new DatabaseSync(pathname);
}

function scanLedgerMemoryEvents(params: {
  profileId: string;
  stateDir: string;
  limit?: number;
  accept?: (event: MemoryStateEventEnvelopePlain) => boolean;
}): MemoryStateEventEnvelopePlain[] {
  const db = openLedgerReadDb(params);
  if (!db) {
    return [];
  }
  try {
    const accepted: MemoryStateEventEnvelopePlain[] = [];
    const target = params.limit == null ? Number.POSITIVE_INFINITY : Math.max(0, params.limit);
    if (target === 0) {
      return accepted;
    }
    const batchSize = Number.isFinite(target) ? Math.max(64, Math.min(512, target * 4)) : 256;
    let offset = 0;
    const statement = db.prepare(
      `SELECT event_id, lamport, event_type, created_at_ms, payload_plain
       FROM memory_events
       WHERE profile_id = ?
       ORDER BY lamport DESC, event_id DESC
       LIMIT ? OFFSET ?`,
    );
    while (accepted.length < target) {
      const rows = statement.all(params.profileId, batchSize, offset) as LedgerEventRow[];
      if (rows.length === 0) {
        break;
      }
      offset += rows.length;
      for (const row of rows) {
        if (!row.payload_plain) {
          continue;
        }
        const event = deserializeMemoryStateLedgerEvent(row.payload_plain, {
          lamport: normalizeNumber(row.lamport),
          createdAtMs: normalizeNumber(row.created_at_ms),
        });
        if (!event) {
          continue;
        }
        if (params.accept && !params.accept(event)) {
          continue;
        }
        accepted.push(event);
        if (accepted.length >= target) {
          break;
        }
      }
      if (rows.length < batchSize) {
        break;
      }
    }
    return accepted;
  } finally {
    db.close();
  }
}

export function readRecentMemoryLedgerEvents(params: {
  profileId: string;
  stateDir: string;
  limit: number;
  pageId?: string;
  excludeTypes?: ReadonlySet<string>;
}): MemoryStateEventEnvelopePlain[] {
  return scanLedgerMemoryEvents({
    profileId: params.profileId,
    stateDir: params.stateDir,
    limit: params.limit,
    accept(event) {
      if (params.pageId && event.pageId !== params.pageId) {
        return false;
      }
      if (params.excludeTypes?.has(event.type)) {
        return false;
      }
      return true;
    },
  });
}

export function readAttachmentOriginsFromLedger(params: {
  profileId: string;
  stateDir: string;
  blobId: string;
  sha256: string;
}): MemoryAttachmentLedgerOrigin[] {
  const matches = scanLedgerMemoryEvents({
    profileId: params.profileId,
    stateDir: params.stateDir,
    accept(event) {
      if (event.type !== "ATTACHMENT_ADDED") {
        return false;
      }
      const payload = event.payload as AttachmentAddedPayloadValue;
      return payload.blobId === params.blobId || payload.sha256 === params.sha256;
    },
  });
  return matches.map((event) => ({
    eventId: event.eventId,
    lamport: event.lamport,
    actorId: event.actorId,
    createdAt: new Date(event.createdAtMs).toISOString(),
    ...(event.pageId ? { pageId: event.pageId } : {}),
  }));
}

export function openProfileMemoryLedger(profileId: string, stateDir: string): MemoryLedger {
  return openLedger(profileId, { stateDir });
}
