import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const MemorySourceSchema = Type.Union([Type.Literal("memory"), Type.Literal("sessions")]);
const FtsTokenizerSchema = Type.Union([Type.Literal("unicode61"), Type.Literal("trigram")]);
const MemoryFileKindSchema = Type.Union([Type.Literal("root"), Type.Literal("note")]);
const MemoryCanonicalStoreStateSchema = Type.Union([
  Type.Literal("pending-sync"),
  Type.Literal("ready"),
]);
const MemoryCanonicalProfileSourceSchema = Type.Union([
  Type.Literal("cloud-user"),
  Type.Literal("local-profile"),
  Type.Literal("state-dir"),
]);
const MemoryCanonicalProjectionSourceSchema = Type.Union([Type.Literal("workspace-memory")]);
const MemoryCanonicalCloudSyncSchema = Type.Union([
  Type.Literal("unavailable"),
  Type.Literal("enabled"),
  Type.Literal("error"),
]);
const MemoryCanonicalSyncAvailabilitySchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("inactive"),
  Type.Literal("blocked"),
]);
const MemoryCanonicalSyncModeConfiguredSchema = Type.Union([
  Type.Literal("cloud"),
  Type.Literal("direct"),
  Type.Literal("off"),
]);
const MemoryCanonicalSyncBlockedReasonSchema = Type.Union([
  Type.Literal("disabled"),
  Type.Literal("mode_off"),
  Type.Literal("missing_profile_key"),
  Type.Literal("missing_relay_base_url"),
  Type.Literal("missing_access_token"),
  Type.Literal("direct_disabled"),
]);

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

export const MemoryCanonicalStoreReplicaSchema = Type.Object(
  {
    deviceId: NonEmptyString,
    stateDir: Type.String(),
  },
  { additionalProperties: false },
);

export const MemoryCanonicalStoreRuntimeSchema = Type.Object(
  {
    state: MemoryCanonicalStoreStateSchema,
    path: Type.String(),
    profileId: NonEmptyString,
    profileSource: MemoryCanonicalProfileSourceSchema,
    displayName: Type.Optional(Type.String()),
    workspaceScope: NonEmptyString,
    workspaceDir: Type.String(),
    backend: Type.Union([Type.Literal("builtin"), Type.Literal("qmd")]),
    entities: Type.Integer({ minimum: 0 }),
    relations: Type.Integer({ minimum: 0 }),
    projections: Type.Integer({ minimum: 0 }),
    projectionInterface: Type.Literal("markdown-repo"),
    syncMode: Type.Literal("local-first"),
    cloudSync: MemoryCanonicalCloudSyncSchema,
    projectionSources: Type.Array(MemoryCanonicalProjectionSourceSchema),
    ledgerEventsCount: Type.Integer({ minimum: 0 }),
    lastSyncedLamport: Type.Integer({ minimum: 0 }),
    checkpointsCount: Type.Integer({ minimum: 0 }),
    e2eeRequired: Type.Literal(true),
    syncAvailability: Type.Optional(MemoryCanonicalSyncAvailabilitySchema),
    syncModeConfigured: Type.Optional(MemoryCanonicalSyncModeConfiguredSchema),
    syncBlockedReason: Type.Optional(MemoryCanonicalSyncBlockedReasonSchema),
    lastSyncSuccessAt: Type.Optional(Type.String()),
    lastAckLamport: Type.Optional(Type.Integer({ minimum: 0 })),
    pendingBacklog: Type.Optional(Type.Integer({ minimum: 0 })),
    lastSyncedAt: Type.Optional(Type.String()),
    lastError: Type.Optional(Type.String()),
    replica: Type.Optional(MemoryCanonicalStoreReplicaSchema),
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
    canonicalStore: Type.Optional(MemoryCanonicalStoreRuntimeSchema),
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
