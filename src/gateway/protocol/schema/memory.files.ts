import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const MemoryFilesPreviewKindSchema = Type.Union([
  Type.Literal("markdown"),
  Type.Literal("text"),
  Type.Literal("json"),
  Type.Literal("image"),
  Type.Literal("audio"),
  Type.Literal("pdf"),
  Type.Literal("binary"),
]);

const NullableStringSchema = Type.Union([Type.String(), Type.Null()]);

const MemoryFilesReasonTagSchema = Type.Object(
  {
    code: NonEmptyString,
    label: NonEmptyString,
    detail: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const MemoryFilesTraceSchema = Type.Object(
  {
    kind: Type.Literal("files"),
    query: NonEmptyString,
    candidateCount: Type.Integer({ minimum: 0 }),
    hitCount: Type.Integer({ minimum: 0 }),
    hits: Type.Array(
      Type.Object(
        {
          id: NonEmptyString,
          name: NonEmptyString,
          mediaType: NonEmptyString,
          reasons: Type.Array(NonEmptyString),
        },
        { additionalProperties: false },
      ),
    ),
    reasons: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

const MemoryFilesSyncSurfaceSchema = Type.Object(
  {
    lastSyncedLamport: Type.Optional(Type.Integer({ minimum: 0 })),
    e2eeRequired: Type.Optional(Type.Literal(true)),
    state: Type.Optional(Type.String()),
    detail: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const MemoryFilesLinkSchema = Type.Object(
  {
    pageId: NonEmptyString,
    entityId: NonEmptyString,
    title: NonEmptyString,
    path: NonEmptyString,
    relation: Type.Union([Type.Literal("attached"), Type.Literal("mentioned")]),
  },
  { additionalProperties: false },
);

const MemoryFilesOriginSchema = Type.Object(
  {
    eventId: NonEmptyString,
    lamport: Type.Integer({ minimum: 0 }),
    actorId: NonEmptyString,
    createdAt: Type.Optional(Type.String()),
    pageId: Type.Optional(NonEmptyString),
    entityId: Type.Optional(NonEmptyString),
    pageTitle: Type.Optional(Type.String()),
    pagePath: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const MemoryFilesPreviewSchema = Type.Object(
  {
    kind: MemoryFilesPreviewKindSchema,
    mediaType: NonEmptyString,
    lineCount: Type.Optional(Type.Integer({ minimum: 0 })),
    text: Type.Optional(Type.String()),
    bytesBase64: Type.Optional(Type.String()),
    truncated: Type.Optional(Type.Boolean()),
    fallbackLabel: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const MemoryFilesDownloadSchema = Type.Object(
  {
    fileName: NonEmptyString,
    mediaType: NonEmptyString,
    bytesBase64: Type.String(),
  },
  { additionalProperties: false },
);

const MemoryFilesProvenanceRowSchema = Type.Object(
  {
    label: NonEmptyString,
    value: Type.String(),
  },
  { additionalProperties: false },
);

const MemoryFilesEntryBaseSchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    mediaType: NonEmptyString,
    previewKind: MemoryFilesPreviewKindSchema,
    size: Type.Integer({ minimum: 0 }),
    sha256: NonEmptyString,
    updatedAt: NullableStringSchema,
    summary: Type.String(),
    provenanceSummary: Type.String(),
    relatedPagesCount: Type.Integer({ minimum: 0 }),
    primaryPage: Type.Optional(MemoryFilesLinkSchema),
    origin: Type.Optional(MemoryFilesOriginSchema),
    provenance: Type.Array(MemoryFilesProvenanceRowSchema),
    reasonTags: Type.Optional(Type.Array(MemoryFilesReasonTagSchema)),
    trace: Type.Optional(MemoryFilesTraceSchema),
    traceSummary: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const MemoryFilesListParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    query: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryFilesListResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    sync: Type.Optional(MemoryFilesSyncSurfaceSchema),
    files: Type.Array(MemoryFilesEntryBaseSchema),
  },
  { additionalProperties: false },
);

export const MemoryFilesGetParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    fileId: NonEmptyString,
    query: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryFilesGetResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    sync: Type.Optional(MemoryFilesSyncSurfaceSchema),
    file: Type.Object(
      {
        id: NonEmptyString,
        name: NonEmptyString,
        mediaType: NonEmptyString,
        previewKind: MemoryFilesPreviewKindSchema,
        size: Type.Integer({ minimum: 0 }),
        sha256: NonEmptyString,
        updatedAt: NullableStringSchema,
        summary: Type.String(),
        provenanceSummary: Type.String(),
        relatedPagesCount: Type.Integer({ minimum: 0 }),
        primaryPage: Type.Optional(MemoryFilesLinkSchema),
        origin: Type.Optional(MemoryFilesOriginSchema),
        provenance: Type.Array(MemoryFilesProvenanceRowSchema),
        reasonTags: Type.Optional(Type.Array(MemoryFilesReasonTagSchema)),
        trace: Type.Optional(MemoryFilesTraceSchema),
        traceSummary: Type.Optional(Type.Array(Type.String())),
        preview: MemoryFilesPreviewSchema,
        download: MemoryFilesDownloadSchema,
        relatedPages: Type.Array(MemoryFilesLinkSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
