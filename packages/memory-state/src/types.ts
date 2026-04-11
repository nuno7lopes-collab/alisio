import type { SQLInputValue } from "node:sqlite";

export const MEMORY_STATE_SCHEMA_VERSION = 1 as const;
export const MEMORY_STATE_TEXT_FRAGMENT = "body";

export type BinaryInput = Uint8Array | ArrayBuffer | Buffer | string | null | undefined;

export type MemoryPageLink = {
  toPageId: string;
  type: string;
  ordinal?: number;
};

export type MemoryPageMetadata = {
  pageId: string;
  title: string;
  slug: string;
  aliases?: string[];
  tags?: string[];
  createdAtMs?: number;
  updatedAtMs?: number;
  tombstoned?: boolean;
};

export type MemoryPageCreatedPayload = MemoryPageMetadata;

export type MemoryPageMetadataUpdatedPayload = {
  pageId: string;
  title?: string;
  slug?: string;
  aliases?: string[];
  tags?: string[];
  updatedAtMs?: number;
};

export type MemoryPageTombstonedPayload = {
  pageId: string;
  tombstoned?: boolean;
  updatedAtMs?: number;
};

export type MemoryDocCrdtSnapshotPayload = {
  pageId: string;
  yjsState: BinaryInput;
};

export type MemoryDocCrdtUpdatePayload = {
  pageId: string;
  update: BinaryInput;
};

export type MemoryLinksReplacedPayload = {
  pageId: string;
  links: MemoryPageLink[];
};

export type MemoryProjectionSetPayload = {
  pageId: string;
  kind: string;
  markdownBody?: string;
};

export type MemoryClaimUpsertedPayload = {
  claimId: string;
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  status?: string;
  updatedAtMs?: number;
};

export type MemoryEvidenceAddedPayload = {
  evidenceId: string;
  claimId: string;
  sourceLocator: string;
  quote: string;
  hash: string;
  createdAtMs?: number;
};

export type MemoryAttachmentAddedPayload = {
  blobId: string;
  mime: string;
  bytes: BinaryInput;
  sha256: string;
  createdAtMs?: number;
};

export type MemoryDashboardSetPayload = {
  kind: string;
  json: Record<string, unknown>;
  updatedAtMs?: number;
};

export type MemoryCheckpointCreatedPayload = {
  checkpointId: string;
  stateHash: string;
  encryptedSnapshot?: string | null;
};

export type MemoryStateEventType =
  | "PAGE_CREATED"
  | "PAGE_METADATA_UPDATED"
  | "PAGE_TOMBSTONED"
  | "DOC_CRDT_SNAPSHOT"
  | "DOC_CRDT_UPDATE"
  | "LINKS_REPLACED"
  | "PROJECTION_SET"
  | "CLAIM_UPSERTED"
  | "EVIDENCE_ADDED"
  | "ATTACHMENT_ADDED"
  | "DASHBOARD_SET"
  | "CHECKPOINT_CREATED";

export type MemoryStateEventPayloadByType = {
  PAGE_CREATED: MemoryPageCreatedPayload;
  PAGE_METADATA_UPDATED: MemoryPageMetadataUpdatedPayload;
  PAGE_TOMBSTONED: MemoryPageTombstonedPayload;
  DOC_CRDT_SNAPSHOT: MemoryDocCrdtSnapshotPayload;
  DOC_CRDT_UPDATE: MemoryDocCrdtUpdatePayload;
  LINKS_REPLACED: MemoryLinksReplacedPayload;
  PROJECTION_SET: MemoryProjectionSetPayload;
  CLAIM_UPSERTED: MemoryClaimUpsertedPayload;
  EVIDENCE_ADDED: MemoryEvidenceAddedPayload;
  ATTACHMENT_ADDED: MemoryAttachmentAddedPayload;
  DASHBOARD_SET: MemoryDashboardSetPayload;
  CHECKPOINT_CREATED: MemoryCheckpointCreatedPayload;
};

export type MemoryStateEventEnvelopePlain<T extends MemoryStateEventType = MemoryStateEventType> = {
  schemaVersion: typeof MEMORY_STATE_SCHEMA_VERSION;
  eventId: string;
  lamport: number;
  actorId: string;
  createdAtMs: number;
  type: T;
  payload: MemoryStateEventPayloadByType[T];
  pageId?: string;
  source?: string;
  batchId?: string;
};

export type MemoryStateEventDraft<T extends MemoryStateEventType = MemoryStateEventType> = {
  type: T;
  payload: MemoryStateEventPayloadByType[T];
  actorId: string;
  createdAtMs?: number;
  eventId?: string;
  pageId?: string;
  source?: string;
  batchId?: string;
};

export type MemoryStateSqliteMutation = {
  sql: string;
  params?: SQLInputValue[];
};

export type MemoryStateMetaRow = {
  migrationVersion: number;
  lastAppliedLamport: number;
  lastCheckpointId?: string;
};

export type MemoryStateCheckpointSnapshot = {
  schemaVersion: typeof MEMORY_STATE_SCHEMA_VERSION;
  meta: MemoryStateMetaRow;
  tables: {
    pages: Array<Record<string, unknown>>;
    pageDocState: Array<Record<string, unknown>>;
    claims: Array<Record<string, unknown>>;
    evidence: Array<Record<string, unknown>>;
    links: Array<Record<string, unknown>>;
    attachments: Array<Record<string, unknown>>;
    projections: Array<Record<string, unknown>>;
    dashboards: Array<Record<string, unknown>>;
    pageAliases: Array<Record<string, unknown>>;
    pageTags: Array<Record<string, unknown>>;
  };
};
