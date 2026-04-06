import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const MemorySourceSchema = Type.Union([Type.Literal("memory"), Type.Literal("sessions")]);
const FtsTokenizerSchema = Type.Union([Type.Literal("unicode61"), Type.Literal("trigram")]);
const MemoryFileKindSchema = Type.Union([Type.Literal("root"), Type.Literal("note")]);

export const MemoryStatusParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MemoryStatusConfigSchema = Type.Object(
  {
    provider: NonEmptyString,
    model: Type.Optional(Type.String()),
    fallback: Type.String(),
    sources: Type.Array(MemorySourceSchema),
    extraPaths: Type.Array(Type.String()),
    sync: Type.Object(
      {
        onSessionStart: Type.Boolean(),
        onSearch: Type.Boolean(),
        watch: Type.Boolean(),
        watchDebounceMs: Type.Integer({ minimum: 0 }),
        intervalMinutes: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    store: Type.Object(
      {
        driver: Type.Literal("sqlite"),
        path: NonEmptyString,
        ftsTokenizer: FtsTokenizerSchema,
        vectorEnabled: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const MemoryBackendSchema = Type.Union([
  Type.Object(
    {
      backend: Type.Literal("builtin"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      backend: Type.Literal("qmd"),
      command: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
]);

export const MemoryStatusSourceCountSchema = Type.Object(
  {
    source: MemorySourceSchema,
    files: Type.Integer({ minimum: 0 }),
    chunks: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const MemoryStatusCacheSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    entries: Type.Optional(Type.Integer({ minimum: 0 })),
    maxEntries: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const MemoryStatusFtsSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    available: Type.Boolean(),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryStatusVectorSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    available: Type.Optional(Type.Boolean()),
    extensionPath: Type.Optional(Type.String()),
    loadError: Type.Optional(Type.String()),
    dims: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const MemoryStatusBatchSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    failures: Type.Integer({ minimum: 0 }),
    limit: Type.Integer({ minimum: 0 }),
    wait: Type.Boolean(),
    concurrency: Type.Integer({ minimum: 1 }),
    pollIntervalMs: Type.Integer({ minimum: 0 }),
    timeoutMs: Type.Integer({ minimum: 0 }),
    lastError: Type.Optional(Type.String()),
    lastProvider: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryStatusRuntimeSchema = Type.Object(
  {
    backend: Type.Union([Type.Literal("builtin"), Type.Literal("qmd")]),
    provider: NonEmptyString,
    model: Type.Optional(Type.String()),
    requestedProvider: Type.Optional(Type.String()),
    files: Type.Optional(Type.Integer({ minimum: 0 })),
    chunks: Type.Optional(Type.Integer({ minimum: 0 })),
    dirty: Type.Optional(Type.Boolean()),
    workspaceDir: Type.Optional(Type.String()),
    dbPath: Type.Optional(Type.String()),
    sourceCounts: Type.Optional(Type.Array(MemoryStatusSourceCountSchema)),
    cache: Type.Optional(MemoryStatusCacheSchema),
    fts: Type.Optional(MemoryStatusFtsSchema),
    vector: Type.Optional(MemoryStatusVectorSchema),
    batch: Type.Optional(MemoryStatusBatchSchema),
  },
  { additionalProperties: false },
);

export const MemoryEmbeddingStatusSchema = Type.Object(
  {
    ok: Type.Boolean(),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryStatusResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    enabled: Type.Boolean(),
    config: Type.Optional(MemoryStatusConfigSchema),
    backend: Type.Optional(MemoryBackendSchema),
    runtime: Type.Optional(MemoryStatusRuntimeSchema),
    embedding: MemoryEmbeddingStatusSchema,
    managerError: Type.Optional(Type.String()),
    configError: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryWorkspaceFileEntrySchema = Type.Object(
  {
    path: NonEmptyString,
    kind: MemoryFileKindSchema,
    size: Type.Integer({ minimum: 0 }),
    updatedAtMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const MemoryWorkspaceFileDocumentSchema = Type.Object(
  {
    path: NonEmptyString,
    kind: MemoryFileKindSchema,
    missing: Type.Boolean(),
    size: Type.Optional(Type.Integer({ minimum: 0 })),
    updatedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
    content: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryFilesListParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MemoryFilesListResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    workspace: NonEmptyString,
    rootFileMissing: Type.Boolean(),
    files: Type.Array(MemoryWorkspaceFileEntrySchema),
  },
  { additionalProperties: false },
);

export const MemoryFilesGetParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    path: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MemoryFilesGetResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    workspace: NonEmptyString,
    file: MemoryWorkspaceFileDocumentSchema,
  },
  { additionalProperties: false },
);

export const MemoryFilesSetParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    path: NonEmptyString,
    content: Type.String(),
  },
  { additionalProperties: false },
);

export const MemoryFilesSetResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    workspace: NonEmptyString,
    file: MemoryWorkspaceFileEntrySchema,
  },
  { additionalProperties: false },
);

export const MemoryFilesDeleteParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    path: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MemoryFilesDeleteResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    agentId: NonEmptyString,
    path: NonEmptyString,
    deleted: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const MemorySyncParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MemorySyncResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    status: MemoryStatusResultSchema,
  },
  { additionalProperties: false },
);
