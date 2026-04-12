import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const MemoryGraphScopeSchema = Type.Union([Type.Literal("global"), Type.Literal("local")]);
const MemoryGraphDirectionSchema = Type.Union([
  Type.Literal("incoming"),
  Type.Literal("outgoing"),
  Type.Literal("both"),
]);
const MemoryGraphProjectionSourceSchema = Type.Union([Type.Literal("workspace-memory")]);
const MemoryGraphStoreStateSchema = Type.Union([
  Type.Literal("pending-sync"),
  Type.Literal("ready"),
]);
const MemoryGraphCloudSyncSchema = Type.Union([
  Type.Literal("unavailable"),
  Type.Literal("enabled"),
  Type.Literal("error"),
]);

export const MemoryGraphProjectionSchema = Type.Object(
  {
    projectionId: NonEmptyString,
    path: NonEmptyString,
    sourceKind: MemoryGraphProjectionSourceSchema,
    editable: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const MemoryGraphRelatedEntitySchema = Type.Object(
  {
    entityId: NonEmptyString,
    title: NonEmptyString,
    slug: NonEmptyString,
    sourcePath: NonEmptyString,
    sourceKind: MemoryGraphProjectionSourceSchema,
  },
  { additionalProperties: false },
);

export const MemoryGraphMatchRelationSchema = Type.Object(
  {
    direction: Type.Union([Type.Literal("incoming"), Type.Literal("outgoing")]),
    relationType: NonEmptyString,
    ordinal: Type.Integer({ minimum: 0 }),
    metadata: Type.Record(Type.String(), Type.Unknown()),
    relatedEntity: Type.Optional(MemoryGraphRelatedEntitySchema),
  },
  { additionalProperties: false },
);

export const MemoryGraphMatchSchema = Type.Object(
  {
    entityId: NonEmptyString,
    title: NonEmptyString,
    slug: NonEmptyString,
    sourcePath: NonEmptyString,
    sourceKind: MemoryGraphProjectionSourceSchema,
    aliases: Type.Array(Type.String()),
    tags: Type.Array(Type.String()),
    score: Type.Number({ minimum: 0 }),
    projections: Type.Array(MemoryGraphProjectionSchema),
    relations: Type.Array(MemoryGraphMatchRelationSchema),
  },
  { additionalProperties: false },
);

export const MemoryGraphFocusSchema = Type.Object(
  {
    nodeId: NonEmptyString,
    pageId: NonEmptyString,
    entityId: NonEmptyString,
    title: NonEmptyString,
    sourcePath: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MemoryGraphNodeSchema = Type.Object(
  {
    id: NonEmptyString,
    pageId: NonEmptyString,
    entityId: NonEmptyString,
    title: NonEmptyString,
    slug: NonEmptyString,
    sourcePath: NonEmptyString,
    sourceKind: MemoryGraphProjectionSourceSchema,
    aliases: Type.Array(Type.String()),
    tags: Type.Array(Type.String()),
    incoming: Type.Integer({ minimum: 0 }),
    outgoing: Type.Integer({ minimum: 0 }),
    degree: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const MemoryGraphEdgeReasonSchema = Type.Object(
  {
    kind: Type.Literal("canonical-link"),
    sourcePageId: NonEmptyString,
    targetPageId: NonEmptyString,
    sourceTitle: NonEmptyString,
    targetTitle: NonEmptyString,
    sourcePath: NonEmptyString,
    targetPath: NonEmptyString,
    relationType: NonEmptyString,
    ordinal: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const MemoryGraphEdgeSchema = Type.Object(
  {
    id: NonEmptyString,
    fromId: NonEmptyString,
    toId: NonEmptyString,
    fromPageId: NonEmptyString,
    toPageId: NonEmptyString,
    relationType: NonEmptyString,
    ordinal: Type.Integer({ minimum: 0 }),
    reason: MemoryGraphEdgeReasonSchema,
  },
  { additionalProperties: false },
);

export const MemoryGraphBranchSchema = Type.Object(
  {
    id: NonEmptyString,
    direction: Type.Union([Type.Literal("incoming"), Type.Literal("outgoing")]),
    relationType: NonEmptyString,
    nodeIds: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

export const MemoryGraphStatsSchema = Type.Object(
  {
    totalNodes: Type.Integer({ minimum: 0 }),
    totalEdges: Type.Integer({ minimum: 0 }),
    visibleNodes: Type.Integer({ minimum: 0 }),
    visibleEdges: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const MemoryGraphTruncatedSchema = Type.Object(
  {
    nodes: Type.Boolean(),
    edges: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const MemoryGraphParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    query: Type.Optional(Type.String()),
    pageId: Type.Optional(NonEmptyString),
    entityId: Type.Optional(NonEmptyString),
    scope: Type.Optional(MemoryGraphScopeSchema),
    direction: Type.Optional(MemoryGraphDirectionSchema),
    depth: Type.Optional(Type.Integer({ minimum: 1 })),
    matchLimit: Type.Optional(Type.Integer({ minimum: 1 })),
    relationLimit: Type.Optional(Type.Integer({ minimum: 1 })),
    nodeLimit: Type.Optional(Type.Integer({ minimum: 1 })),
    edgeLimit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const MemoryGraphResultSchema = Type.Object(
  {
    query: Type.String(),
    profileId: NonEmptyString,
    workspaceScope: NonEmptyString,
    storePath: NonEmptyString,
    backend: Type.Union([Type.Literal("builtin"), Type.Literal("qmd")]),
    state: MemoryGraphStoreStateSchema,
    projectionInterface: Type.Literal("markdown-repo"),
    syncMode: Type.Literal("local-first"),
    cloudSync: MemoryGraphCloudSyncSchema,
    lastSyncedLamport: Type.Integer({ minimum: 0 }),
    e2eeRequired: Type.Literal(true),
    lastSyncedAt: Type.Optional(Type.String()),
    lastError: Type.Optional(Type.String()),
    scope: MemoryGraphScopeSchema,
    focus: Type.Optional(MemoryGraphFocusSchema),
    nodes: Type.Array(MemoryGraphNodeSchema),
    edges: Type.Array(MemoryGraphEdgeSchema),
    branches: Type.Array(MemoryGraphBranchSchema),
    availableRelationTypes: Type.Array(Type.String()),
    availableTags: Type.Array(Type.String()),
    stats: MemoryGraphStatsSchema,
    truncated: MemoryGraphTruncatedSchema,
    matches: Type.Array(MemoryGraphMatchSchema),
  },
  { additionalProperties: false },
);
