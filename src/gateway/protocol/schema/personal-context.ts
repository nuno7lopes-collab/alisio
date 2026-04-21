import { Type } from "@sinclair/typebox";
import {
  ALISIO_ACCOUNT_SCOPE_ROOT,
  ALISIO_BACKEND_SHARED_RESOURCES,
  ALISIO_LOCAL_RUNTIME_RESOURCES,
} from "../../../shared/alisio-account-scope.js";
import { NonEmptyString } from "./primitives.js";

export const PersonalContextAvailabilitySchema = Type.Union([
  Type.Literal("setup_only"),
  Type.Literal("all_sessions"),
  Type.Literal("private_direct_sessions"),
  Type.Literal("retrieval_only"),
]);

export const PersonalContextInheritanceSchema = Type.Union([
  Type.Literal("identity"),
  Type.Literal("soul"),
  Type.Literal("preferences"),
  Type.Literal("main_memory"),
]);

export const PersonalContextSessionKindSchema = Type.Union([
  Type.Literal("main"),
  Type.Literal("direct"),
  Type.Literal("group"),
  Type.Literal("subagent"),
  Type.Literal("cron"),
]);

export const PersonalContextSessionRoleSchema = Type.Union([
  Type.Literal("default_personal_session"),
  Type.Literal("private_direct_session"),
  Type.Literal("shared_session"),
  Type.Literal("delegated_session"),
  Type.Literal("automation_session"),
]);

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
