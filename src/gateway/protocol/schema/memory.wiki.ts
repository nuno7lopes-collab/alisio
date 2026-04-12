import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const MemoryWikiReasonTagSchema = Type.Object(
  {
    code: NonEmptyString,
    label: NonEmptyString,
    detail: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryWikiSyncSurfaceSchema = Type.Object(
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

export const MemoryWikiTaxonomySchema = Type.Object(
  {
    summary: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(NonEmptyString)),
    categories: Type.Optional(Type.Array(NonEmptyString)),
    collections: Type.Optional(Type.Array(NonEmptyString)),
    featured: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const MemoryWikiRelatedFileSchema = Type.Intersect([
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

export const MemoryWikiListParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    query: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryWikiListPageSchema = Type.Intersect([
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
      reasonTags: Type.Optional(Type.Array(MemoryWikiReasonTagSchema)),
      traceId: Type.Optional(Type.String()),
      trace: Type.Optional(Type.Unknown()),
      traceSummary: Type.Optional(Type.Array(Type.String())),
    },
    { additionalProperties: false },
  ),
  MemoryWikiTaxonomySchema,
]);

export const MemoryWikiListResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    pages: Type.Array(MemoryWikiListPageSchema),
    sync: Type.Optional(MemoryWikiSyncSurfaceSchema),
    exportFormats: Type.Optional(Type.Array(NonEmptyString)),
  },
  { additionalProperties: false },
);

export const MemoryWikiBacklinkSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    title: NonEmptyString,
    path: Type.Optional(Type.String()),
    excerpt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryWikiEvidenceItemSchema = Type.Object(
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

export const MemoryWikiClaimItemSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    claim: NonEmptyString,
    confidence: Type.Optional(Type.Union([Type.Number(), Type.String()])),
    evidence: Type.Optional(Type.Array(MemoryWikiEvidenceItemSchema)),
  },
  { additionalProperties: false },
);

export const MemoryWikiPageRevisionSchema = Type.Object(
  {
    eventId: Type.Optional(Type.String()),
    lamport: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.String()])),
    updatedAt: Type.Optional(Type.String()),
    author: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryWikiPageContextSchema = Type.Object(
  {
    summary: Type.Optional(Type.String()),
    reasonTags: Type.Optional(Type.Array(MemoryWikiReasonTagSchema)),
    traceId: Type.Optional(Type.String()),
    trace: Type.Optional(Type.Unknown()),
    traceSummary: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const MemoryWikiPageSchema = Type.Intersect([
  Type.Object(
    {
      id: NonEmptyString,
      title: NonEmptyString,
      slug: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      content: Type.String(),
      backlinks: Type.Optional(Type.Array(MemoryWikiBacklinkSchema)),
      claims: Type.Optional(Type.Array(MemoryWikiClaimItemSchema)),
      evidence: Type.Optional(Type.Array(MemoryWikiEvidenceItemSchema)),
      relatedFiles: Type.Optional(Type.Array(MemoryWikiRelatedFileSchema)),
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
      reasonTags: Type.Optional(Type.Array(MemoryWikiReasonTagSchema)),
      traceId: Type.Optional(Type.String()),
      trace: Type.Optional(Type.Unknown()),
      traceSummary: Type.Optional(Type.Array(Type.String())),
      contextPreview: Type.Optional(MemoryWikiPageContextSchema),
      revision: Type.Optional(MemoryWikiPageRevisionSchema),
    },
    { additionalProperties: false },
  ),
  MemoryWikiTaxonomySchema,
]);

export const MemoryWikiGetParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    pageId: NonEmptyString,
    query: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryWikiGetResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    page: MemoryWikiPageSchema,
    sync: Type.Optional(MemoryWikiSyncSurfaceSchema),
  },
  { additionalProperties: false },
);

export const MemoryWikiUpdateParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    pageId: Type.Optional(Type.String()),
    title: NonEmptyString,
    content: Type.String(),
  },
  { additionalProperties: false },
);

export const MemoryWikiUpdateResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    agentId: NonEmptyString,
    page: Type.Optional(MemoryWikiPageSchema),
    revision: Type.Optional(MemoryWikiPageRevisionSchema),
    sync: Type.Optional(MemoryWikiSyncSurfaceSchema),
  },
  { additionalProperties: false },
);

export const MemoryWikiHistoryEntrySchema = Type.Object(
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

export const MemoryWikiHistoryParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    pageId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MemoryWikiHistoryResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    pageId: NonEmptyString,
    history: Type.Array(MemoryWikiHistoryEntrySchema),
  },
  { additionalProperties: false },
);
