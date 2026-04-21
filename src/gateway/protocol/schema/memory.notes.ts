import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const MemoryNoteReasonTagSchema = Type.Object(
  {
    code: NonEmptyString,
    label: NonEmptyString,
    detail: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryNoteSyncSurfaceSchema = Type.Object(
  {
    lastSyncedLamport: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
    e2eeRequired: Type.Optional(Type.Boolean()),
    state: Type.Optional(Type.String()),
    mode: Type.Optional(Type.String()),
    blockedReason: Type.Optional(Type.String()),
    lastSuccessAt: Type.Optional(Type.String()),
    lastAckLamport: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
    pendingBacklog: Type.Optional(Type.Integer({ minimum: 0 })),
    detail: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryNoteRoleSchema = Type.Union([
  Type.Literal("main"),
  Type.Literal("topic"),
  Type.Literal("daily"),
  Type.Literal("backlog"),
]);

export const MemoryNoteTaxonomySchema = Type.Object(
  {
    summary: Type.Optional(Type.String()),
    memoryRole: Type.Optional(MemoryNoteRoleSchema),
    tags: Type.Optional(Type.Array(NonEmptyString)),
    categories: Type.Optional(Type.Array(NonEmptyString)),
    collections: Type.Optional(Type.Array(NonEmptyString)),
    featured: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const MemoryNoteAttachmentSchema = Type.Intersect([
  Type.Object(
    {
      name: NonEmptyString,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      id: Type.Optional(Type.String()),
      mediaType: Type.Optional(Type.String()),
      updatedAt: Type.Optional(Type.String()),
      provenanceSummary: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
]);

export const MemoryNoteBacklinkSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    title: NonEmptyString,
    path: Type.Optional(Type.String()),
    excerpt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryNoteEvidenceItemSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    title: Type.Optional(Type.String()),
    excerpt: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
    provenance: Type.Optional(
      Type.Array(
        Type.Object(
          {
            label: NonEmptyString,
            value: NonEmptyString,
          },
          { additionalProperties: false },
        ),
      ),
    ),
  },
  { additionalProperties: false },
);

export const MemoryNoteClaimItemSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    claim: NonEmptyString,
    confidence: Type.Optional(Type.Union([Type.Number(), Type.String()])),
    evidence: Type.Optional(Type.Array(MemoryNoteEvidenceItemSchema)),
  },
  { additionalProperties: false },
);

export const MemoryNoteRevisionSchema = Type.Object(
  {
    eventId: Type.Optional(Type.String()),
    lamport: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
    updatedAt: Type.Optional(Type.String()),
    author: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryNoteContextSchema = Type.Object(
  {
    summary: Type.Optional(Type.String()),
    reasonTags: Type.Optional(Type.Array(MemoryNoteReasonTagSchema)),
    traceId: Type.Optional(Type.String()),
    trace: Type.Optional(Type.Unknown()),
    traceSummary: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const MemoryNoteHistoryEntrySchema = Type.Object(
  {
    eventId: NonEmptyString,
    lamport: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
    at: Type.Optional(Type.String()),
    author: Type.Optional(Type.String()),
    operation: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    diffSummary: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryNotesListParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    query: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryNoteListEntrySchema = Type.Intersect([
  Type.Object(
    {
      id: NonEmptyString,
      title: NonEmptyString,
      slug: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      excerpt: Type.Optional(Type.String()),
      updatedAt: Type.Optional(Type.String()),
      backlinks: Type.Optional(Type.Integer({ minimum: 0 })),
      claims: Type.Optional(Type.Integer({ minimum: 0 })),
      evidence: Type.Optional(Type.Integer({ minimum: 0 })),
      reasonTags: Type.Optional(Type.Array(MemoryNoteReasonTagSchema)),
      traceId: Type.Optional(Type.String()),
      trace: Type.Optional(Type.Unknown()),
      traceSummary: Type.Optional(Type.Array(Type.String())),
    },
    { additionalProperties: false },
  ),
  MemoryNoteTaxonomySchema,
]);

export const MemoryNotesListResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    notes: Type.Array(MemoryNoteListEntrySchema),
    sync: Type.Optional(MemoryNoteSyncSurfaceSchema),
    exportFormats: Type.Optional(Type.Array(NonEmptyString)),
  },
  { additionalProperties: false },
);

export const MemoryNoteSchema = Type.Intersect([
  Type.Object(
    {
      id: NonEmptyString,
      title: NonEmptyString,
      slug: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      content: Type.String(),
      backlinks: Type.Optional(Type.Array(MemoryNoteBacklinkSchema)),
      claims: Type.Optional(Type.Array(MemoryNoteClaimItemSchema)),
      evidence: Type.Optional(Type.Array(MemoryNoteEvidenceItemSchema)),
      attachments: Type.Optional(Type.Array(MemoryNoteAttachmentSchema)),
      provenance: Type.Optional(
        Type.Array(
          Type.Object(
            {
              label: NonEmptyString,
              value: NonEmptyString,
            },
            { additionalProperties: false },
          ),
        ),
      ),
      reasonTags: Type.Optional(Type.Array(MemoryNoteReasonTagSchema)),
      traceId: Type.Optional(Type.String()),
      trace: Type.Optional(Type.Unknown()),
      traceSummary: Type.Optional(Type.Array(Type.String())),
      contextPreview: Type.Optional(MemoryNoteContextSchema),
      revision: Type.Optional(MemoryNoteRevisionSchema),
    },
    { additionalProperties: false },
  ),
  MemoryNoteTaxonomySchema,
]);

export const MemoryNotesGetParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    noteId: NonEmptyString,
    query: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryNotesGetResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    note: MemoryNoteSchema,
    sync: Type.Optional(MemoryNoteSyncSurfaceSchema),
  },
  { additionalProperties: false },
);

export const MemoryNotesUpdateParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    noteId: Type.Optional(Type.String()),
    relativePath: Type.Optional(Type.String()),
    memoryRole: Type.Optional(MemoryNoteRoleSchema),
    title: NonEmptyString,
    content: Type.String(),
  },
  { additionalProperties: false },
);

export const MemoryNotesUpdateResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    agentId: NonEmptyString,
    note: Type.Optional(MemoryNoteSchema),
    revision: Type.Optional(MemoryNoteRevisionSchema),
    sync: Type.Optional(MemoryNoteSyncSurfaceSchema),
  },
  { additionalProperties: false },
);

export const MemoryNotesHistoryParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    noteId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MemoryNotesHistoryResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    noteId: NonEmptyString,
    history: Type.Array(MemoryNoteHistoryEntrySchema),
  },
  { additionalProperties: false },
);
