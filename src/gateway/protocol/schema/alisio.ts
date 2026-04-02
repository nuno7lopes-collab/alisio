import { Type } from "@sinclair/typebox";
import {
  ALISIO_USERNAME_ALLOWED_PATTERN_SOURCE,
  ALISIO_USERNAME_MAX_LENGTH,
  ALISIO_USERNAME_MIN_LENGTH,
} from "../../../shared/alisio-account.js";
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

const AccountBackendSchema = Type.Union([Type.Literal("supabase"), Type.Literal("local-dev")]);

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
    avatarLabel: NonEmptyString,
    avatarUrl: Type.Optional(Type.String()),
    joinedAt: NonEmptyString,
    plan: NonEmptyString,
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

export const AlisioAiStateSchema = Type.Object(
  {
    provider: Type.Literal("openai"),
    status: AiStatusSchema,
    email: Type.Optional(Type.String()),
    accountId: Type.Optional(Type.String()),
    planLabel: Type.Optional(Type.String()),
    connectedAt: Type.Optional(Type.String()),
    limits: Type.Optional(AlisioAiLimitsSchema),
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
    avatarLabel: Type.Optional(Type.String()),
    avatarUrl: Type.Optional(Type.String()),
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
    avatarLabel: Type.Optional(Type.String()),
    avatarUrl: Type.Optional(Type.String()),
    language: Type.Optional(PreferredLanguageSchema),
    theme: Type.Optional(PreferredThemeSchema),
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
export const AlisioAccountSignOutParamsSchema = Type.Object({}, { additionalProperties: false });
export const AlisioAccountPasswordResetResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    message: NonEmptyString,
  },
  { additionalProperties: false },
);

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
export const AlisioAiDisconnectParamsSchema = Type.Object({}, { additionalProperties: false });
export const AlisioAiRefreshLimitsParamsSchema = Type.Object({}, { additionalProperties: false });

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
    redirectUri: Type.Optional(Type.String()),
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
