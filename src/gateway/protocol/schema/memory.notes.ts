import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";
import {
  MemoryWikiBacklinkSchema,
  MemoryWikiClaimItemSchema,
  MemoryWikiEvidenceItemSchema,
  MemoryWikiHistoryEntrySchema,
  MemoryWikiPageContextSchema,
  MemoryWikiPageRevisionSchema,
  MemoryWikiReasonTagSchema,
  MemoryWikiRelatedFileSchema,
  MemoryWikiRoleSchema,
  MemoryWikiSyncSurfaceSchema,
  MemoryWikiTaxonomySchema,
} from "./memory.wiki.js";

export const MemoryNoteAttachmentSchema = MemoryWikiRelatedFileSchema;
export const MemoryNoteReasonTagSchema = MemoryWikiReasonTagSchema;
export const MemoryNoteSyncSurfaceSchema = MemoryWikiSyncSurfaceSchema;
export const MemoryNoteTaxonomySchema = MemoryWikiTaxonomySchema;
export const MemoryNoteBacklinkSchema = MemoryWikiBacklinkSchema;
export const MemoryNoteEvidenceItemSchema = MemoryWikiEvidenceItemSchema;
export const MemoryNoteClaimItemSchema = MemoryWikiClaimItemSchema;
export const MemoryNoteRevisionSchema = MemoryWikiPageRevisionSchema;
export const MemoryNoteContextSchema = MemoryWikiPageContextSchema;
export const MemoryNoteHistoryEntrySchema = MemoryWikiHistoryEntrySchema;

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
    memoryRole: Type.Optional(MemoryWikiRoleSchema),
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
