import { Type } from "@sinclair/typebox";
import {
  ALISIO_AGENT_NAME_MAX_LENGTH,
  ALISIO_USERNAME_ALLOWED_PATTERN_SOURCE,
  ALISIO_USERNAME_MAX_LENGTH,
  ALISIO_USERNAME_MIN_LENGTH,
} from "../../../shared/alisio-account.js";
import { ALISIO_PLAN_VALUES } from "../../../shared/alisio-billing.js";
import { ALISIO_LOCAL_MODEL_BACKEND } from "../../../shared/alisio-local-models.js";
import { NonEmptyString } from "./primitives.js";

const ConnectorCategorySchema = Type.Union([
  Type.Literal("social"),
  Type.Literal("google"),
  Type.Literal("productivity"),
  Type.Literal("development"),
]);

const ConnectorAvailabilitySchema = Type.Union([
  Type.Literal("ready"),
  Type.Literal("in_review"),
  Type.Literal("unavailable"),
]);

const ConnectorBeginModeSchema = Type.Union([Type.Literal("oauth"), Type.Literal("setup")]);

const ConnectorBeginReasonSchema = Type.Union([
  Type.Literal("ready_for_oauth"),
  Type.Literal("missing_client_config"),
  Type.Literal("missing_token_encryption"),
  Type.Literal("review_required"),
  Type.Literal("unavailable"),
]);

const OAuthProviderSchema = Type.Union([
  Type.Literal("google"),
  Type.Literal("github"),
  Type.Literal("notion"),
  Type.Literal("vercel"),
]);

const AuthorizationStateSchema = Type.Union([
  Type.Literal("not_connected"),
  Type.Literal("connected"),
  Type.Literal("needs_reconnect"),
]);

const AuthorizationHealthSchema = Type.Union([
  Type.Literal("healthy"),
  Type.Literal("needs_reconnect"),
  Type.Literal("config_missing"),
  Type.Literal("in_review"),
  Type.Literal("unavailable"),
]);

const PreferredLanguageSchema = Type.Union([
  Type.Literal("en"),
  Type.Literal("pt-PT"),
  Type.Literal("es"),
]);

const PreferredThemeSchema = Type.Union([
  Type.Literal("system"),
  Type.Literal("light"),
  Type.Literal("dark"),
]);

const AccountSessionStateSchema = Type.Union([
  Type.Literal("signed_out"),
  Type.Literal("signed_in"),
]);
const AccountAuthMethodSchema = Type.Union([Type.Literal("email"), Type.Literal("google")]);

const AccountBackendSchema = Type.Literal("supabase");
const AccountPlanSchema = Type.Union(ALISIO_PLAN_VALUES.map((entry) => Type.Literal(entry)));

const StartupStateSchema = Type.Union([
  Type.Literal("signed_out"),
  Type.Literal("needs_profile"),
  Type.Literal("needs_ai"),
  Type.Literal("ready"),
]);

const AiStatusSchema = Type.Union([
  Type.Literal("disconnected"),
  Type.Literal("connecting"),
  Type.Literal("connected"),
  Type.Literal("limits_unavailable"),
  Type.Literal("expired"),
]);

const AiOwnerScopeSchema = Type.Union([Type.Literal("user"), Type.Literal("organization")]);

const AiIdentitySourceSchema = Type.Union([
  Type.Literal("account_user_id"),
  Type.Literal("user_id"),
  Type.Literal("account_id_email"),
  Type.Literal("email"),
  Type.Literal("account_id"),
  Type.Literal("default"),
]);

const AiTelemetrySourceSchema = Type.Union([Type.Literal("official"), Type.Literal("heuristic")]);

const BootstrapStepSchema = Type.Union([
  Type.Literal("gateway"),
  Type.Literal("runtime"),
  Type.Literal("account"),
  Type.Literal("organization"),
  Type.Literal("connectors"),
  Type.Literal("permissions"),
  Type.Literal("ready"),
]);

const DoctorIssueSeveritySchema = Type.Union([
  Type.Literal("info"),
  Type.Literal("warning"),
  Type.Literal("error"),
]);

const LocalModelReleaseStageSchema = Type.Union([
  Type.Literal("hidden"),
  Type.Literal("published"),
]);

const LocalModelRuntimeStatusSchema = Type.Union([
  Type.Literal("ready"),
  Type.Literal("not_configured"),
  Type.Literal("error"),
]);

const RemoteModelServerKindSchema = Type.Union([
  Type.Literal("openai-compatible"),
  Type.Literal("ollama"),
]);
const SharingOwnerScopeSchema = Type.Union([Type.Literal("user"), Type.Literal("organization")]);
const SharingScopeSchema = Type.Union([Type.Literal("device.use"), Type.Literal("model.use")]);
const SharingRequestStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
  Type.Literal("revoked"),
]);
const SharingTargetSourceKindSchema = Type.Union([Type.Literal("current"), Type.Literal("node")]);
const SharingTargetAccessSchema = Type.Union([
  Type.Literal("owner"),
  Type.Literal("shared"),
  Type.Literal("requestable"),
  Type.Literal("blocked"),
]);
const SharingAuditActionSchema = Type.Union([
  Type.Literal("policy.updated"),
  Type.Literal("request.created"),
  Type.Literal("request.approved"),
  Type.Literal("request.rejected"),
  Type.Literal("grant.revoked"),
]);
const LocalModelTargetRuntimeKindSchema = Type.Union([
  Type.Literal(ALISIO_LOCAL_MODEL_BACKEND),
  Type.Literal("ollama"),
  Type.Literal("openai-compatible"),
]);

const ModelRecommendationGradeSchema = Type.Union([
  Type.Literal("recommended"),
  Type.Literal("works"),
  Type.Literal("slow"),
  Type.Literal("unsupported"),
]);

export const AlisioConnectorSummarySchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    ready: Type.Integer({ minimum: 0 }),
    connected: Type.Integer({ minimum: 0 }),
    needsReconnect: Type.Integer({ minimum: 0 }),
    inReview: Type.Integer({ minimum: 0 }),
    unavailable: Type.Integer({ minimum: 0 }),
    available: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const AlisioConnectedAccountSchema = Type.Object(
  {
    label: NonEmptyString,
    email: Type.Optional(Type.String()),
    handle: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AlisioConnectorDefinitionSchema = Type.Object(
  {
    id: NonEmptyString,
    title: NonEmptyString,
    providerLabel: NonEmptyString,
    category: ConnectorCategorySchema,
    connectLabel: NonEmptyString,
    summary: NonEmptyString,
    detail: Type.Optional(Type.String()),
    availability: ConnectorAvailabilitySchema,
    setupUrl: Type.Optional(Type.String()),
    scopes: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

export const AlisioConnectorAuthorizationSchema = Type.Object(
  {
    connectorId: NonEmptyString,
    state: AuthorizationStateSchema,
    health: AuthorizationHealthSchema,
    connectedAt: Type.Optional(Type.String()),
    scopes: Type.Array(NonEmptyString),
    connectedAccount: Type.Optional(AlisioConnectedAccountSchema),
  },
  { additionalProperties: false },
);

export const AlisioLocalAccountProfileSchema = Type.Object(
  {
    userId: Type.Optional(Type.String()),
    username: Type.String({
      minLength: ALISIO_USERNAME_MIN_LENGTH,
      maxLength: ALISIO_USERNAME_MAX_LENGTH,
      pattern: ALISIO_USERNAME_ALLOWED_PATTERN_SOURCE,
    }),
    displayName: NonEmptyString,
    email: NonEmptyString,
    agentName: Type.Optional(Type.String({ maxLength: ALISIO_AGENT_NAME_MAX_LENGTH })),
    avatarLabel: NonEmptyString,
    avatarUrl: Type.Optional(Type.String()),
    termsAcceptedAt: Type.Optional(Type.String()),
    marketingOptIn: Type.Optional(Type.Boolean()),
    birthdate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    joinedAt: NonEmptyString,
    plan: AccountPlanSchema,
    backend: Type.Optional(AccountBackendSchema),
  },
  { additionalProperties: false },
);

export const AlisioLocalUserPreferencesSchema = Type.Object(
  {
    language: PreferredLanguageSchema,
    theme: PreferredThemeSchema,
  },
  { additionalProperties: false },
);

export const AlisioAccountSessionSchema = Type.Object(
  {
    state: AccountSessionStateSchema,
    profileCompleted: Type.Boolean(),
    authMethod: Type.Optional(AccountAuthMethodSchema),
    signedInAt: Type.Optional(Type.String()),
    signedOutAt: Type.Optional(Type.String()),
    backend: Type.Optional(AccountBackendSchema),
  },
  { additionalProperties: false },
);

export const AlisioAiUsageWindowSchema = Type.Object(
  {
    label: NonEmptyString,
    usedPercent: Type.Number({ minimum: 0 }),
    resetAt: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

export const AlisioAiLimitsSchema = Type.Object(
  {
    windows: Type.Array(AlisioAiUsageWindowSchema),
    lastRefreshedAt: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AlisioAiTelemetryWindowSchema = Type.Object(
  {
    label: NonEmptyString,
    durationMinutes: Type.Integer({ minimum: 1 }),
    usedPercent: Type.Number({ minimum: 0, maximum: 100 }),
    remainingPercent: Type.Number({ minimum: 0, maximum: 100 }),
    resetAt: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

export const AlisioAiLocalTelemetrySchema = Type.Object(
  {
    source: AiTelemetrySourceSchema,
    planType: Type.Optional(Type.String()),
    primaryWindow: Type.Optional(AlisioAiTelemetryWindowSchema),
    secondaryWindow: Type.Optional(AlisioAiTelemetryWindowSchema),
    credits: Type.Optional(Type.Number()),
    observedAt: NonEmptyString,
    staleAt: NonEmptyString,
    lastError: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AlisioAiCanonicalIdentitySchema = Type.Object(
  {
    accountUserId: Type.Optional(Type.String()),
    userId: Type.Optional(Type.String()),
    accountId: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    canonicalIdentityKey: NonEmptyString,
    source: AiIdentitySourceSchema,
  },
  { additionalProperties: false },
);

export const AlisioAiRuntimeBindingSchema = Type.Object(
  {
    workerId: NonEmptyString,
    workerCredentialId: NonEmptyString,
    authProfileId: NonEmptyString,
    boundAt: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AlisioAiWorkerCredentialStateSchema = Type.Object(
  {
    workerCredentialId: NonEmptyString,
    workerId: NonEmptyString,
    authProfileId: NonEmptyString,
    runtimeState: AiStatusSchema,
    email: Type.Optional(Type.String()),
    accountId: Type.Optional(Type.String()),
    accountUserId: Type.Optional(Type.String()),
    userId: Type.Optional(Type.String()),
    connectedAt: Type.Optional(Type.String()),
    localTelemetry: Type.Optional(AlisioAiLocalTelemetrySchema),
    runtimeBound: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const AlisioAiProfileSchema = Type.Object(
  {
    profileId: NonEmptyString,
    label: NonEmptyString,
    provider: Type.Literal("openai"),
    scope: AiOwnerScopeSchema,
    ownerKey: NonEmptyString,
    canonicalIdentityKey: NonEmptyString,
    identity: AlisioAiCanonicalIdentitySchema,
    status: AiStatusSchema,
    email: Type.Optional(Type.String()),
    accountId: Type.Optional(Type.String()),
    accountUserId: Type.Optional(Type.String()),
    userId: Type.Optional(Type.String()),
    planLabel: Type.Optional(Type.String()),
    connectedAt: Type.Optional(Type.String()),
    limits: Type.Optional(AlisioAiLimitsSchema),
    aggregatedTelemetry: Type.Optional(AlisioAiLocalTelemetrySchema),
    workerCredentials: Type.Optional(Type.Array(AlisioAiWorkerCredentialStateSchema)),
  },
  { additionalProperties: false },
);

export const AlisioAiStateSchema = Type.Object(
  {
    provider: Type.Literal("openai"),
    status: AiStatusSchema,
    activeProfileId: Type.Optional(Type.String()),
    activeWorkerCredentialId: Type.Optional(Type.String()),
    activeAuthProfileId: Type.Optional(Type.String()),
    binding: Type.Optional(AlisioAiRuntimeBindingSchema),
    runtimeBindings: Type.Optional(Type.Array(AlisioAiRuntimeBindingSchema)),
    email: Type.Optional(Type.String()),
    accountId: Type.Optional(Type.String()),
    accountUserId: Type.Optional(Type.String()),
    userId: Type.Optional(Type.String()),
    planLabel: Type.Optional(Type.String()),
    connectedAt: Type.Optional(Type.String()),
    limits: Type.Optional(AlisioAiLimitsSchema),
    profiles: Type.Optional(Type.Array(AlisioAiProfileSchema)),
  },
  { additionalProperties: false },
);

export const AlisioLocalDeviceSessionSchema = Type.Object(
  {
    id: NonEmptyString,
    label: NonEmptyString,
    platform: NonEmptyString,
    current: Type.Boolean(),
    status: Type.Literal("active"),
    lastSeenAt: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AlisioAccountGetParamsSchema = Type.Object({}, { additionalProperties: false });

export const AlisioAccountResultSchema = Type.Object(
  {
    profile: AlisioLocalAccountProfileSchema,
    preferences: AlisioLocalUserPreferencesSchema,
    session: AlisioAccountSessionSchema,
    devices: Type.Array(AlisioLocalDeviceSessionSchema),
  },
  { additionalProperties: false },
);

export const AlisioAccountUpdateParamsSchema = Type.Object(
  {
    username: Type.Optional(
      Type.String({
        minLength: ALISIO_USERNAME_MIN_LENGTH,
        maxLength: ALISIO_USERNAME_MAX_LENGTH,
        pattern: ALISIO_USERNAME_ALLOWED_PATTERN_SOURCE,
      }),
    ),
    displayName: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    agentName: Type.Optional(Type.String({ maxLength: ALISIO_AGENT_NAME_MAX_LENGTH })),
    avatarLabel: Type.Optional(Type.String()),
    avatarUrl: Type.Optional(Type.String()),
    termsAcceptedAt: Type.Optional(Type.String()),
    marketingOptIn: Type.Optional(Type.Boolean()),
    birthdate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    language: Type.Optional(PreferredLanguageSchema),
    theme: Type.Optional(PreferredThemeSchema),
  },
  { additionalProperties: false },
);

export const AlisioAccountCompleteProfileParamsSchema = Type.Object(
  {
    username: Type.String({
      minLength: ALISIO_USERNAME_MIN_LENGTH,
      maxLength: ALISIO_USERNAME_MAX_LENGTH,
      pattern: ALISIO_USERNAME_ALLOWED_PATTERN_SOURCE,
    }),
    displayName: NonEmptyString,
    email: NonEmptyString,
    agentName: Type.Optional(Type.String({ maxLength: ALISIO_AGENT_NAME_MAX_LENGTH })),
    avatarLabel: Type.Optional(Type.String()),
    avatarUrl: Type.Optional(Type.String()),
    termsAcceptedAt: Type.Optional(Type.String()),
    marketingOptIn: Type.Optional(Type.Boolean()),
    birthdate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    language: Type.Optional(PreferredLanguageSchema),
    theme: Type.Optional(PreferredThemeSchema),
  },
  { additionalProperties: false },
);

export const AlisioAccountEmailAuthBeginParamsSchema = Type.Object(
  {
    email: NonEmptyString,
    callbackUrl: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const AlisioAccountEmailAuthBeginResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    email: NonEmptyString,
    message: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioAccountEmailAuthVerifyParamsSchema = Type.Object(
  {
    email: NonEmptyString,
    code: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioAccountEmailLinkAuthCompleteParamsSchema = Type.Object(
  {
    accessToken: NonEmptyString,
    refreshToken: Type.Optional(Type.String()),
    expiresIn: Type.Optional(Type.Integer({ minimum: 1 })),
    tokenType: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const AlisioAccountGoogleAuthBeginParamsSchema = Type.Object(
  {
    callbackUrl: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioAccountGoogleAuthBeginResultSchema = Type.Object(
  {
    setupUrl: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AlisioAccountSignUpParamsSchema = Type.Object(
  {
    email: NonEmptyString,
    password: Type.String({ minLength: 8 }),
  },
  { additionalProperties: false },
);
export const AlisioAccountSignInParamsSchema = Type.Object(
  {
    email: NonEmptyString,
    password: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export const AlisioAccountPasswordResetParamsSchema = Type.Object(
  {
    email: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioAccountRecoveryEmailParamsSchema = AlisioAccountPasswordResetParamsSchema;
export const AlisioAccountSignOutParamsSchema = Type.Object({}, { additionalProperties: false });
export const AlisioAccountPasswordResetResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    message: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioAccountRecoveryEmailResultSchema = AlisioAccountPasswordResetResultSchema;

export const AlisioAiGetParamsSchema = Type.Object({}, { additionalProperties: false });
export const AlisioAiBeginConnectParamsSchema = Type.Object(
  {
    callbackUrl: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioAiBeginConnectResultSchema = Type.Object(
  {
    setupUrl: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioAiCompleteConnectParamsSchema = Type.Object(
  {
    stateToken: Type.Optional(Type.String()),
    code: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    errorDescription: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const AlisioAiDisconnectParamsSchema = Type.Object(
  {
    profileId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const AlisioAiRefreshLimitsParamsSchema = Type.Object(
  {
    profileId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const AlisioAiSelectProfileParamsSchema = Type.Object(
  {
    profileId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioAiRenameProfileParamsSchema = Type.Object(
  {
    profileId: NonEmptyString,
    label: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AlisioOrganizationStateSchema = Type.Union([
  Type.Object(
    {
      mode: Type.Literal("none"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("owner"),
      organizationName: NonEmptyString,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("member"),
      organizationName: NonEmptyString,
      inviteEmail: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
]);

export const AlisioOrganizationGetParamsSchema = Type.Object({}, { additionalProperties: false });

export const AlisioOrganizationSetParamsSchema = AlisioOrganizationStateSchema;

export const AlisioSharingPrincipalSchema = Type.Object(
  {
    ownerKey: NonEmptyString,
    ownerScope: SharingOwnerScopeSchema,
    label: NonEmptyString,
    email: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AlisioSharingTargetSchema = Type.Object(
  {
    targetId: NonEmptyString,
    label: NonEmptyString,
    platform: Type.Optional(Type.String()),
    sourceKind: SharingTargetSourceKindSchema,
    connected: Type.Boolean(),
    current: Type.Boolean(),
    ownerKey: NonEmptyString,
    ownerScope: SharingOwnerScopeSchema,
    ownerLabel: NonEmptyString,
    ownerEmail: Type.Optional(Type.String()),
    registeredAt: NonEmptyString,
    updatedAt: NonEmptyString,
    deviceAccess: SharingTargetAccessSchema,
    modelAccess: SharingTargetAccessSchema,
    requestId: Type.Optional(Type.String()),
    requestStatus: Type.Optional(SharingRequestStatusSchema),
    grantId: Type.Optional(Type.String()),
    grantScopes: Type.Optional(Type.Array(SharingScopeSchema)),
  },
  { additionalProperties: false },
);

export const AlisioSharingRequestSchema = Type.Object(
  {
    requestId: NonEmptyString,
    targetId: NonEmptyString,
    targetLabel: NonEmptyString,
    targetPlatform: Type.Optional(Type.String()),
    targetSourceKind: SharingTargetSourceKindSchema,
    requester: AlisioSharingPrincipalSchema,
    owner: AlisioSharingPrincipalSchema,
    scopes: Type.Array(SharingScopeSchema),
    status: SharingRequestStatusSchema,
    createdAt: NonEmptyString,
    resolvedAt: Type.Optional(Type.String()),
    grantId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AlisioSharingGrantSchema = Type.Object(
  {
    grantId: NonEmptyString,
    requestId: NonEmptyString,
    targetId: NonEmptyString,
    targetLabel: NonEmptyString,
    targetPlatform: Type.Optional(Type.String()),
    targetSourceKind: SharingTargetSourceKindSchema,
    owner: AlisioSharingPrincipalSchema,
    grantee: AlisioSharingPrincipalSchema,
    scopes: Type.Array(SharingScopeSchema),
    approvedAt: NonEmptyString,
    revokedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AlisioSharingAuditEntrySchema = Type.Object(
  {
    entryId: NonEmptyString,
    action: SharingAuditActionSchema,
    actor: AlisioSharingPrincipalSchema,
    targetId: Type.Optional(Type.String()),
    targetLabel: Type.Optional(Type.String()),
    requestId: Type.Optional(Type.String()),
    grantId: Type.Optional(Type.String()),
    summary: NonEmptyString,
    createdAt: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AlisioSharingStateSchema = Type.Object(
  {
    viewer: AlisioSharingPrincipalSchema,
    planSupported: Type.Boolean(),
    policy: Type.Object(
      {
        ownerKey: Type.Optional(Type.String()),
        ownerLabel: Type.Optional(Type.String()),
        allowExternalUse: Type.Boolean(),
        editable: Type.Boolean(),
        upgradeMessage: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    devices: Type.Object(
      {
        owned: Type.Array(AlisioSharingTargetSchema),
        sharedWithMe: Type.Array(AlisioSharingTargetSchema),
        available: Type.Array(AlisioSharingTargetSchema),
      },
      { additionalProperties: false },
    ),
    incomingRequests: Type.Array(AlisioSharingRequestSchema),
    outgoingRequests: Type.Array(AlisioSharingRequestSchema),
    grants: Type.Array(AlisioSharingGrantSchema),
    audit: Type.Array(AlisioSharingAuditEntrySchema),
  },
  { additionalProperties: false },
);

export const AlisioSharingGetParamsSchema = Type.Object({}, { additionalProperties: false });
export const AlisioSharingRequestParamsSchema = Type.Object(
  {
    targetId: NonEmptyString,
    scopes: Type.Optional(Type.Array(SharingScopeSchema)),
  },
  { additionalProperties: false },
);
export const AlisioSharingRequestResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    requestId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioSharingApproveParamsSchema = Type.Object(
  {
    requestId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioSharingApproveResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    requestId: NonEmptyString,
    grantId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioSharingRejectParamsSchema = Type.Object(
  {
    requestId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioSharingRejectResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    requestId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioSharingRevokeParamsSchema = Type.Object(
  {
    grantId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioSharingRevokeResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    grantId: NonEmptyString,
    targetId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioSharingPolicySetParamsSchema = Type.Object(
  {
    allowExternalUse: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const AlisioSharingPolicySetResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    allowExternalUse: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AlisioBootstrapGetParamsSchema = Type.Object({}, { additionalProperties: false });
export const AlisioBootstrapWizardSchema = Type.Object(
  {
    running: Type.Boolean(),
    sessionId: Type.Union([NonEmptyString, Type.Null()]),
  },
  { additionalProperties: false },
);
export const AlisioBootstrapModelsSchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    defaultProvider: NonEmptyString,
    providers: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);
export const AlisioLocalModelCatalogEntrySchema = Type.Object(
  {
    id: NonEmptyString,
    slug: NonEmptyString,
    family: NonEmptyString,
    name: NonEmptyString,
    parametersBillions: Type.Number({ minimum: 0 }),
    quantization: NonEmptyString,
    backend: Type.Literal(ALISIO_LOCAL_MODEL_BACKEND),
    summary: NonEmptyString,
    diskGb: Type.Number({ minimum: 0 }),
    memoryGb: Type.Number({ minimum: 0 }),
    vramGb: Type.Optional(Type.Number({ minimum: 0 })),
    releaseStage: LocalModelReleaseStageSchema,
  },
  { additionalProperties: false },
);
export const AlisioInstalledLocalModelSchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    ownedBy: Type.Optional(Type.String()),
    running: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const AlisioModelHardwareSchema = Type.Object(
  {
    platform: NonEmptyString,
    architecture: NonEmptyString,
    totalMemoryGb: Type.Number({ minimum: 0 }),
    cpuCores: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export const AlisioModelRecommendationSchema = Type.Object(
  {
    modelId: NonEmptyString,
    grade: ModelRecommendationGradeSchema,
    label: NonEmptyString,
    reason: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioAvailableLocalModelSchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    runtimeKind: LocalModelTargetRuntimeKindSchema,
    summary: Type.Optional(Type.String()),
    ownedBy: Type.Optional(Type.String()),
    parametersBillions: Type.Optional(Type.Number({ minimum: 0 })),
    quantization: Type.Optional(Type.String()),
    diskGb: Type.Optional(Type.Number({ minimum: 0 })),
    memoryGb: Type.Optional(Type.Number({ minimum: 0 })),
    recommendation: Type.Optional(AlisioModelRecommendationSchema),
  },
  { additionalProperties: false },
);
export const AlisioModelsTargetSchema = Type.Object(
  {
    targetId: NonEmptyString,
    label: NonEmptyString,
    platform: Type.Optional(Type.String()),
    chatProviderId: Type.Optional(NonEmptyString),
    current: Type.Boolean(),
    connected: Type.Boolean(),
    backend: Type.Literal(ALISIO_LOCAL_MODEL_BACKEND),
    runtimeKind: LocalModelTargetRuntimeKindSchema,
    runtimeStatus: LocalModelRuntimeStatusSchema,
    runtimeMessage: Type.Optional(Type.String()),
    supportsInstall: Type.Boolean(),
    access: Type.Optional(Type.Union([Type.Literal("owner"), Type.Literal("shared")])),
    ownerLabel: Type.Optional(Type.String()),
    ownerScope: Type.Optional(SharingOwnerScopeSchema),
    grantId: Type.Optional(Type.String()),
    installedModels: Type.Array(AlisioInstalledLocalModelSchema),
    availableModels: Type.Optional(Type.Array(AlisioAvailableLocalModelSchema)),
    hardware: Type.Optional(AlisioModelHardwareSchema),
    recommendations: Type.Array(AlisioModelRecommendationSchema),
    bestModelId: Type.Optional(Type.String()),
    bestModelName: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const AlisioModelsGetParamsSchema = Type.Object({}, { additionalProperties: false });
export const AlisioModelsInstallParamsSchema = Type.Object(
  {
    targetId: NonEmptyString,
    modelId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioModelsInstallResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    backend: Type.Literal(ALISIO_LOCAL_MODEL_BACKEND),
    targetId: NonEmptyString,
    modelId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioModelsUninstallParamsSchema = Type.Object(
  {
    targetId: NonEmptyString,
    modelId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioModelsUninstallResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    backend: Type.Literal(ALISIO_LOCAL_MODEL_BACKEND),
    targetId: NonEmptyString,
    modelId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioRemoteModelServerSchema = Type.Object(
  {
    serverId: NonEmptyString,
    label: NonEmptyString,
    chatProviderId: Type.Optional(NonEmptyString),
    kind: RemoteModelServerKindSchema,
    baseUrl: NonEmptyString,
    active: Type.Boolean(),
    hasApiKey: Type.Boolean(),
    status: LocalModelRuntimeStatusSchema,
    message: Type.Optional(Type.String()),
    models: Type.Array(AlisioInstalledLocalModelSchema),
  },
  { additionalProperties: false },
);
export const AlisioModelsServerSaveParamsSchema = Type.Object(
  {
    serverId: Type.Optional(Type.String()),
    label: NonEmptyString,
    kind: RemoteModelServerKindSchema,
    baseUrl: NonEmptyString,
    apiKey: Type.Optional(Type.String()),
    clearApiKey: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const AlisioModelsServerSaveResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    serverId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioModelsServerRemoveParamsSchema = Type.Object(
  {
    serverId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioModelsServerRemoveResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    serverId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioModelsServerSelectParamsSchema = Type.Object(
  {
    serverId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioModelsServerSelectResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    serverId: NonEmptyString,
  },
  { additionalProperties: false },
);
export const AlisioModelsResultSchema = Type.Object(
  {
    backend: Type.Literal(ALISIO_LOCAL_MODEL_BACKEND),
    catalog: Type.Array(AlisioLocalModelCatalogEntrySchema),
    targets: Type.Array(AlisioModelsTargetSchema),
    servers: Type.Array(AlisioRemoteModelServerSchema),
  },
  { additionalProperties: false },
);
export const AlisioBootstrapResultSchema = Type.Object(
  {
    connectionRequired: Type.Boolean(),
    wizardRequired: Type.Boolean(),
    wizardRunning: Type.Boolean(),
    providerReady: Type.Boolean(),
    accountReady: Type.Boolean(),
    startupState: StartupStateSchema,
    organizationState: AlisioOrganizationStateSchema,
    connectorSummary: AlisioConnectorSummarySchema,
    nextStep: BootstrapStepSchema,
    account: AlisioAccountResultSchema,
    ai: AlisioAiStateSchema,
    organization: AlisioOrganizationStateSchema,
    connectors: Type.Object(
      {
        catalog: Type.Array(AlisioConnectorDefinitionSchema),
        authorizations: Type.Array(AlisioConnectorAuthorizationSchema),
        summary: AlisioConnectorSummarySchema,
      },
      { additionalProperties: false },
    ),
    wizard: AlisioBootstrapWizardSchema,
    models: AlisioBootstrapModelsSchema,
  },
  { additionalProperties: false },
);

export const AlisioDoctorSummaryParamsSchema = Type.Object({}, { additionalProperties: false });
export const AlisioDoctorSummaryResultSchema = Type.Object(
  {
    bootstrap: AlisioBootstrapResultSchema,
    ok: Type.Boolean(),
    issues: Type.Array(
      Type.Object(
        {
          code: NonEmptyString,
          severity: DoctorIssueSeveritySchema,
          title: NonEmptyString,
          message: NonEmptyString,
          step: Type.Optional(BootstrapStepSchema),
        },
        { additionalProperties: false },
      ),
    ),
    checks: Type.Object(
      {
        gateway: Type.Boolean(),
        runtime: Type.Boolean(),
        account: Type.Boolean(),
        organization: Type.Boolean(),
        connectors: Type.Boolean(),
        permissions: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const AlisioRuntimeRestartParamsSchema = Type.Object({}, { additionalProperties: false });
export const AlisioRuntimeRestartResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    pid: Type.Integer({ minimum: 1 }),
    signal: Type.Literal("SIGUSR1"),
    delayMs: Type.Integer({ minimum: 0 }),
    reason: Type.Optional(Type.String()),
    mode: Type.Union([Type.Literal("emit"), Type.Literal("signal")]),
    coalesced: Type.Boolean(),
    cooldownMsApplied: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const AlisioConnectorsCatalogParamsSchema = Type.Object({}, { additionalProperties: false });
export const AlisioConnectorsCatalogResultSchema = Type.Object(
  {
    connectors: Type.Array(AlisioConnectorDefinitionSchema),
  },
  { additionalProperties: false },
);

export const AlisioConnectorsListParamsSchema = Type.Object({}, { additionalProperties: false });
export const AlisioConnectorsListResultSchema = Type.Object(
  {
    authorizations: Type.Array(AlisioConnectorAuthorizationSchema),
  },
  { additionalProperties: false },
);

export const AlisioConnectorsBeginParamsSchema = Type.Object(
  {
    connectorId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AlisioConnectorsBeginResultSchema = Type.Object(
  {
    connectorId: NonEmptyString,
    availability: ConnectorAvailabilitySchema,
    mode: ConnectorBeginModeSchema,
    statusReason: ConnectorBeginReasonSchema,
    setupUrl: Type.Optional(Type.String()),
    provider: Type.Optional(OAuthProviderSchema),
    providerLabel: Type.Optional(NonEmptyString),
    redirectUri: Type.Optional(Type.String()),
    callbackPath: Type.Optional(Type.String()),
    requiredEnvVars: Type.Optional(Type.Array(NonEmptyString)),
    setupHint: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AlisioConnectorsCompleteParamsSchema = Type.Object(
  {
    connectorId: NonEmptyString,
    account: Type.Optional(AlisioConnectedAccountSchema),
  },
  { additionalProperties: false },
);

export const AlisioConnectorsRevokeParamsSchema = Type.Object(
  {
    connectorId: NonEmptyString,
  },
  { additionalProperties: false },
);
