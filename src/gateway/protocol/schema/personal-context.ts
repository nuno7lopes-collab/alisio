import { Type } from "@sinclair/typebox";
import {
  ALISIO_ACCOUNT_SCOPE_ROOT,
  ALISIO_BACKEND_SHARED_RESOURCES,
  ALISIO_LOCAL_RUNTIME_RESOURCES,
} from "../../../shared/alisio-account-scope.js";
import {
  CANONICAL_MEMORY_FILE_AVAILABILITIES,
  CANONICAL_MEMORY_FILE_GROUPS,
  CANONICAL_MEMORY_FILE_KINDS,
  CANONICAL_MEMORY_NOTE_ROLES,
  CANONICAL_PERSONAL_CONTEXT_INHERITANCE_VALUES,
  CANONICAL_PERSONAL_CONTEXT_SESSION_ROLE_VALUES,
  CANONICAL_MEMORY_SESSION_KINDS,
} from "../../../shared/memory-file-paths.js";
import { NonEmptyString } from "./primitives.js";

export const PersonalContextAvailabilitySchema = Type.Union(
  CANONICAL_MEMORY_FILE_AVAILABILITIES.map((entry) => Type.Literal(entry)),
);

export const PersonalContextInheritanceSchema = Type.Union(
  CANONICAL_PERSONAL_CONTEXT_INHERITANCE_VALUES.map((entry) => Type.Literal(entry)),
);

export const PersonalContextSessionKindSchema = Type.Union(
  CANONICAL_MEMORY_SESSION_KINDS.map((entry) => Type.Literal(entry)),
);

export const PersonalContextSessionRoleSchema = Type.Union(
  CANONICAL_PERSONAL_CONTEXT_SESSION_ROLE_VALUES.map((entry) => Type.Literal(entry)),
);

export const PersonalContextFileKindSchema = Type.Union(
  CANONICAL_MEMORY_FILE_KINDS.map((entry) => Type.Literal(entry)),
);

export const PersonalContextFileGroupSchema = Type.Union(
  CANONICAL_MEMORY_FILE_GROUPS.map((entry) => Type.Literal(entry)),
);

export const PersonalContextMemoryRoleSchema = Type.Union(
  CANONICAL_MEMORY_NOTE_ROLES.map((entry) => Type.Literal(entry)),
);

const AccountScopeRootSchema = Type.Literal(ALISIO_ACCOUNT_SCOPE_ROOT);

export const PersonalContextCanonicalAccountIdSourceSchema = Type.Literal("account_id");

export const PersonalContextWorkspaceModeSchema = Type.Literal("account_scoped");

export const PersonalContextAccountScopeSchema = Type.Object(
  {
    scopeRoot: AccountScopeRootSchema,
    accountId: NonEmptyString,
    source: PersonalContextCanonicalAccountIdSourceSchema,
    authenticated: Type.Literal(true),
    authRequired: Type.Literal(true),
    workspaceMode: PersonalContextWorkspaceModeSchema,
    workspaceRoot: NonEmptyString,
  },
  { additionalProperties: false },
);

export const PersonalContextRuntimeResidencyContractSchema = Type.Object(
  {
    scopeRoot: AccountScopeRootSchema,
    backendShared: Type.Array(
      Type.Union(ALISIO_BACKEND_SHARED_RESOURCES.map((entry) => Type.Literal(entry))),
    ),
    localRuntime: Type.Array(
      Type.Union(ALISIO_LOCAL_RUNTIME_RESOURCES.map((entry) => Type.Literal(entry))),
    ),
  },
  { additionalProperties: false },
);

export const PersonalContextDeviceBindingSchema = Type.Object(
  {
    binding: Type.Literal("account_bound"),
    runtime: Type.Literal("local"),
    current: Type.Literal(true),
    accountId: NonEmptyString,
    deviceId: Type.Optional(Type.String()),
    label: Type.Optional(Type.String()),
    platform: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const PersonalContextFileSummarySchema = Type.Object(
  {
    path: NonEmptyString,
    present: Type.Boolean(),
    availability: PersonalContextAvailabilitySchema,
  },
  { additionalProperties: false },
);

export const PersonalContextIdentitySourceSchema = Type.Union([
  Type.Literal("identity-file"),
  Type.Literal("config-identity"),
  Type.Literal("agent-config"),
  Type.Literal("account-profile"),
]);

export const PersonalContextIdentitySourcesSchema = Type.Object(
  {
    name: Type.Optional(PersonalContextIdentitySourceSchema),
    avatar: Type.Optional(PersonalContextIdentitySourceSchema),
    emoji: Type.Optional(PersonalContextIdentitySourceSchema),
    theme: Type.Optional(PersonalContextIdentitySourceSchema),
  },
  { additionalProperties: false },
);

export const PersonalContextSessionPolicySchema = Type.Object(
  {
    kind: PersonalContextSessionKindSchema,
    role: PersonalContextSessionRoleSchema,
    inherits: Type.Array(PersonalContextInheritanceSchema),
    key: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const PersonalContextDocumentSchema = Type.Object(
  {
    kind: PersonalContextFileKindSchema,
    group: PersonalContextFileGroupSchema,
    path: NonEmptyString,
    present: Type.Boolean(),
    availability: PersonalContextAvailabilitySchema,
    accountScoped: Type.Literal(true),
    injected: Type.Boolean(),
    indexed: Type.Boolean(),
    writable: Type.Boolean(),
    deletable: Type.Boolean(),
    sessionKinds: Type.Array(PersonalContextSessionKindSchema),
    memoryRole: Type.Optional(PersonalContextMemoryRoleSchema),
    size: Type.Optional(Type.Integer({ minimum: 0 })),
    updatedAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const PersonalContextDocumentCountsSchema = Type.Object(
  {
    expectedCount: Type.Integer({ minimum: 0 }),
    presentCount: Type.Integer({ minimum: 0 }),
    agentFileCount: Type.Integer({ minimum: 0 }),
    identityFileCount: Type.Integer({ minimum: 0 }),
    setupFileCount: Type.Integer({ minimum: 0 }),
    memoryFileCount: Type.Integer({ minimum: 0 }),
    mainMemoryCount: Type.Integer({ minimum: 0 }),
    topicNoteCount: Type.Integer({ minimum: 0 }),
    dailyNoteCount: Type.Integer({ minimum: 0 }),
    backlogNoteCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const PersonalContextDirectReadContractSchema = Type.Object(
  {
    method: Type.Literal("agents.files.get"),
    locator: Type.Literal("workspace_relative_path"),
    pathParam: Type.Literal("name"),
    readableKinds: Type.Array(PersonalContextFileKindSchema),
  },
  { additionalProperties: false },
);

export const PersonalContextIndexedReadContractSchema = Type.Object(
  {
    runtime: Type.Literal("memory_index"),
    tool: Type.Literal("memory_get"),
    readableKinds: Type.Array(PersonalContextFileKindSchema),
  },
  { additionalProperties: false },
);

export const PersonalContextSearchContractSchema = Type.Object(
  {
    runtime: Type.Literal("memory_index"),
    tool: Type.Literal("memory_search"),
    readableKinds: Type.Array(PersonalContextFileKindSchema),
  },
  { additionalProperties: false },
);

export const PersonalContextAccessContractSchema = Type.Object(
  {
    accountScopeRequired: Type.Literal(true),
    directRead: PersonalContextDirectReadContractSchema,
    indexedRead: PersonalContextIndexedReadContractSchema,
    search: PersonalContextSearchContractSchema,
  },
  { additionalProperties: false },
);

export const PersonalContextSummarySchema = Type.Object(
  {
    version: Type.Literal(1),
    accountScope: PersonalContextAccountScopeSchema,
    runtimeContract: PersonalContextRuntimeResidencyContractSchema,
    deviceBinding: PersonalContextDeviceBindingSchema,
    bootstrap: Type.Object(
      {
        path: NonEmptyString,
        present: Type.Boolean(),
        availability: PersonalContextAvailabilitySchema,
        state: Type.Union([Type.Literal("pending"), Type.Literal("completed")]),
        oneTime: Type.Literal(true),
        seededAt: Type.Optional(Type.String()),
        completedAt: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    identity: Type.Object(
      {
        path: NonEmptyString,
        present: Type.Boolean(),
        availability: PersonalContextAvailabilitySchema,
        resolved: Type.Object(
          {
            name: NonEmptyString,
            avatar: NonEmptyString,
            avatarUrl: Type.Optional(NonEmptyString),
            emoji: Type.Optional(NonEmptyString),
            theme: Type.Optional(NonEmptyString),
          },
          { additionalProperties: false },
        ),
        sources: PersonalContextIdentitySourcesSchema,
      },
      { additionalProperties: false },
    ),
    soul: PersonalContextFileSummarySchema,
    preferences: PersonalContextFileSummarySchema,
    memory: Type.Object(
      {
        main: PersonalContextFileSummarySchema,
        operational: Type.Object(
          {
            root: Type.Literal("memory"),
            backlogRoot: Type.Literal("memory/backlog"),
            availability: Type.Literal("retrieval_only"),
            topicCount: Type.Integer({ minimum: 0 }),
            dailyCount: Type.Integer({ minimum: 0 }),
            backlogCount: Type.Integer({ minimum: 0 }),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    documents: Type.Array(PersonalContextDocumentSchema),
    documentCounts: PersonalContextDocumentCountsSchema,
    access: PersonalContextAccessContractSchema,
    sessionPolicy: Type.Object(
      {
        main: PersonalContextSessionPolicySchema,
        direct: PersonalContextSessionPolicySchema,
        group: PersonalContextSessionPolicySchema,
        subagent: PersonalContextSessionPolicySchema,
        cron: PersonalContextSessionPolicySchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
