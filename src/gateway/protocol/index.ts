import AjvPkg, { type ErrorObject } from "ajv";
import type { SessionsPatchResult } from "../session-utils.types.js";
import {
  type AgentEvent,
  AgentEventSchema,
  type AlisioAiBeginConnectParams,
  AlisioAiBeginConnectParamsSchema,
  type AlisioAiBeginConnectResult,
  AlisioAiBeginConnectResultSchema,
  type AlisioAiCompleteConnectParams,
  AlisioAiCompleteConnectParamsSchema,
  type AlisioAiDisconnectParams,
  AlisioAiDisconnectParamsSchema,
  type AlisioAiGetParams,
  AlisioAiGetParamsSchema,
  type AlisioAiRenameProfileParams,
  AlisioAiRenameProfileParamsSchema,
  type AlisioAiRefreshLimitsParams,
  AlisioAiRefreshLimitsParamsSchema,
  type AlisioAiSelectProfileParams,
  AlisioAiSelectProfileParamsSchema,
  type AlisioAiState,
  AlisioAiStateSchema,
  type AlisioAccountGetParams,
  AlisioAccountGetParamsSchema,
  type AlisioAccountPasswordResetParams,
  AlisioAccountPasswordResetParamsSchema,
  type AlisioAccountPasswordResetResult,
  AlisioAccountPasswordResetResultSchema,
  type AlisioAccountRecoveryEmailParams,
  AlisioAccountRecoveryEmailParamsSchema,
  type AlisioAccountRecoveryEmailResult,
  AlisioAccountRecoveryEmailResultSchema,
  type AlisioAccountEmailAuthBeginParams,
  AlisioAccountEmailAuthBeginParamsSchema,
  type AlisioAccountEmailAuthBeginResult,
  AlisioAccountEmailAuthBeginResultSchema,
  type AlisioAccountEmailLinkAuthCompleteParams,
  AlisioAccountEmailLinkAuthCompleteParamsSchema,
  type AlisioAccountEmailAuthVerifyParams,
  AlisioAccountEmailAuthVerifyParamsSchema,
  type AlisioAccountGoogleAuthBeginParams,
  AlisioAccountGoogleAuthBeginParamsSchema,
  type AlisioAccountGoogleAuthBeginResult,
  AlisioAccountGoogleAuthBeginResultSchema,
  type AlisioAccountCompleteProfileParams,
  AlisioAccountCompleteProfileParamsSchema,
  type AlisioAccountSignInParams,
  AlisioAccountSignInParamsSchema,
  type AlisioAccountSignOutParams,
  AlisioAccountSignOutParamsSchema,
  type AlisioAccountSignUpParams,
  AlisioAccountSignUpParamsSchema,
  type AlisioAccountResult,
  AlisioAccountResultSchema,
  type AlisioAccountUpdateParams,
  AlisioAccountUpdateParamsSchema,
  type AlisioConnectedAccount,
  AlisioConnectedAccountSchema,
  type AlisioConnectorAuthorization,
  AlisioConnectorAuthorizationSchema,
  type AlisioConnectorDefinition,
  AlisioConnectorDefinitionSchema,
  type AlisioConnectorSummary,
  AlisioConnectorSummarySchema,
  type AlisioBootstrapGetParams,
  AlisioBootstrapGetParamsSchema,
  type AlisioModelsGetParams,
  AlisioModelsGetParamsSchema,
  type AlisioModelsInstallParams,
  AlisioModelsInstallParamsSchema,
  type AlisioModelsInstallResult,
  AlisioModelsInstallResultSchema,
  type AlisioModelsUninstallParams,
  AlisioModelsUninstallParamsSchema,
  type AlisioModelsUninstallResult,
  AlisioModelsUninstallResultSchema,
  AlisioModelsServerRemoveParamsSchema,
  AlisioModelsServerRemoveResultSchema,
  AlisioModelsServerSaveParamsSchema,
  AlisioModelsServerSaveResultSchema,
  AlisioModelsServerSelectParamsSchema,
  AlisioModelsServerSelectResultSchema,
  type AlisioModelsResult,
  AlisioModelsResultSchema,
  type AlisioBootstrapResult,
  AlisioBootstrapResultSchema,
  type AlisioDoctorSummaryParams,
  AlisioDoctorSummaryParamsSchema,
  type AlisioDoctorSummaryResult,
  AlisioDoctorSummaryResultSchema,
  type AlisioRuntimeRestartParams,
  AlisioRuntimeRestartParamsSchema,
  type AlisioRuntimeRestartResult,
  AlisioRuntimeRestartResultSchema,
  type AlisioConnectorsBeginParams,
  AlisioConnectorsBeginParamsSchema,
  type AlisioConnectorsBeginResult,
  AlisioConnectorsBeginResultSchema,
  type AlisioConnectorsCatalogParams,
  AlisioConnectorsCatalogParamsSchema,
  type AlisioConnectorsCatalogResult,
  AlisioConnectorsCatalogResultSchema,
  type AlisioConnectorsCompleteParams,
  AlisioConnectorsCompleteParamsSchema,
  type AlisioConnectorsListParams,
  AlisioConnectorsListParamsSchema,
  type AlisioConnectorsListResult,
  AlisioConnectorsListResultSchema,
  type AlisioConnectorsRevokeParams,
  AlisioConnectorsRevokeParamsSchema,
  type AgentIdentityParams,
  AgentIdentityParamsSchema,
  type AgentIdentityResult,
  AgentIdentityResultSchema,
  AgentParamsSchema,
  type AlisioLocalAccountProfile,
  AlisioLocalAccountProfileSchema,
  type AlisioInstalledLocalModel,
  AlisioInstalledLocalModelSchema,
  type AlisioLocalDeviceSession,
  AlisioLocalDeviceSessionSchema,
  type AlisioLocalModelCatalogEntry,
  AlisioLocalModelCatalogEntrySchema,
  AlisioModelHardwareSchema,
  AlisioModelRecommendationSchema,
  type AlisioLocalUserPreferences,
  AlisioLocalUserPreferencesSchema,
  AlisioRemoteModelServerSchema,
  type AlisioModelsTarget,
  AlisioModelsTargetSchema,
  type AlisioOrganizationGetParams,
  AlisioOrganizationGetParamsSchema,
  type AlisioOrganizationSetParams,
  AlisioOrganizationSetParamsSchema,
  type AlisioSharingAuditEntry,
  AlisioSharingAuditEntrySchema,
  type AlisioSharingApproveParams,
  AlisioSharingApproveParamsSchema,
  type AlisioSharingApproveResult,
  AlisioSharingApproveResultSchema,
  type AlisioSharingGetParams,
  AlisioSharingGetParamsSchema,
  type AlisioSharingGrant,
  AlisioSharingGrantSchema,
  type AlisioSharingPolicySetParams,
  AlisioSharingPolicySetParamsSchema,
  type AlisioSharingPolicySetResult,
  AlisioSharingPolicySetResultSchema,
  type AlisioSharingPrincipal,
  AlisioSharingPrincipalSchema,
  type AlisioSharingRejectParams,
  AlisioSharingRejectParamsSchema,
  type AlisioSharingRejectResult,
  AlisioSharingRejectResultSchema,
  type AlisioSharingRequest,
  AlisioSharingRequestSchema,
  type AlisioSharingRequestParams,
  AlisioSharingRequestParamsSchema,
  type AlisioSharingRequestResult,
  AlisioSharingRequestResultSchema,
  type AlisioSharingRevokeParams,
  AlisioSharingRevokeParamsSchema,
  type AlisioSharingRevokeResult,
  AlisioSharingRevokeResultSchema,
  type AlisioSharingState,
  AlisioSharingStateSchema,
  type AlisioSharingTarget,
  AlisioSharingTargetSchema,
  type AlisioOrganizationState,
  AlisioOrganizationStateSchema,
  type AgentSummary,
  AgentSummarySchema,
  type AgentsFileEntry,
  AgentsFileEntrySchema,
  type AgentsCreateParams,
  AgentsCreateParamsSchema,
  type AgentsCreateResult,
  AgentsCreateResultSchema,
  type AgentsUpdateParams,
  AgentsUpdateParamsSchema,
  type AgentsUpdateResult,
  AgentsUpdateResultSchema,
  type AgentsDeleteParams,
  AgentsDeleteParamsSchema,
  type AgentsDeleteResult,
  AgentsDeleteResultSchema,
  type AgentsFilesDeleteParams,
  AgentsFilesDeleteParamsSchema,
  type AgentsFilesDeleteResult,
  AgentsFilesDeleteResultSchema,
  type AgentsFilesGetParams,
  AgentsFilesGetParamsSchema,
  type AgentsFilesGetResult,
  AgentsFilesGetResultSchema,
  type AgentsFilesListParams,
  AgentsFilesListParamsSchema,
  type AgentsFilesListResult,
  AgentsFilesListResultSchema,
  type AgentsFilesSetParams,
  AgentsFilesSetParamsSchema,
  type AgentsFilesSetResult,
  AgentsFilesSetResultSchema,
  type AgentsListParams,
  AgentsListParamsSchema,
  type AgentsListResult,
  AgentsListResultSchema,
  type AgentWaitParams,
  AgentWaitParamsSchema,
  type ChannelsLogoutParams,
  ChannelsLogoutParamsSchema,
  type ChannelsPairingApproveParams,
  ChannelsPairingApproveParamsSchema,
  type ChannelsPairingRejectParams,
  ChannelsPairingRejectParamsSchema,
  type TalkConfigParams,
  TalkConfigParamsSchema,
  type TalkConfigResult,
  TalkConfigResultSchema,
  type TalkSpeakParams,
  TalkSpeakParamsSchema,
  type TalkSpeakResult,
  TalkSpeakResultSchema,
  type ChannelsStatusParams,
  ChannelsStatusParamsSchema,
  type ChannelsStatusResult,
  ChannelsStatusResultSchema,
  type ChatAbortParams,
  ChatAbortParamsSchema,
  type ChatEvent,
  ChatEventSchema,
  ChatHistoryParamsSchema,
  type ChatInjectParams,
  ChatInjectParamsSchema,
  ChatSendParamsSchema,
  type ConfigApplyParams,
  ConfigApplyParamsSchema,
  type ConfigGetParams,
  ConfigGetParamsSchema,
  type ConfigPatchParams,
  ConfigPatchParamsSchema,
  type ConfigSchemaLookupParams,
  ConfigSchemaLookupParamsSchema,
  type ConfigSchemaLookupResult,
  ConfigSchemaLookupResultSchema,
  type ConfigSchemaParams,
  ConfigSchemaParamsSchema,
  type ConfigSchemaResponse,
  ConfigSchemaResponseSchema,
  type ConfigSetParams,
  ConfigSetParamsSchema,
  type ConnectParams,
  ConnectParamsSchema,
  type CronAddParams,
  CronAddParamsSchema,
  type CronJob,
  CronJobSchema,
  type CronListParams,
  CronListParamsSchema,
  type CronRemoveParams,
  CronRemoveParamsSchema,
  type CronRunLogEntry,
  type CronRunParams,
  CronRunParamsSchema,
  type CronRunsParams,
  CronRunsParamsSchema,
  type CronStatusParams,
  CronStatusParamsSchema,
  type CronUpdateParams,
  CronUpdateParamsSchema,
  type DevicePairApproveParams,
  DevicePairApproveParamsSchema,
  type DevicePairListParams,
  DevicePairListParamsSchema,
  type DevicePairRemoveParams,
  DevicePairRemoveParamsSchema,
  type DevicePairRejectParams,
  DevicePairRejectParamsSchema,
  type DeviceTokenRevokeParams,
  DeviceTokenRevokeParamsSchema,
  type DeviceTokenRotateParams,
  DeviceTokenRotateParamsSchema,
  type ExecApprovalsGetParams,
  ExecApprovalsGetParamsSchema,
  type ExecApprovalsNodeGetParams,
  ExecApprovalsNodeGetParamsSchema,
  type ExecApprovalsNodeSetParams,
  ExecApprovalsNodeSetParamsSchema,
  type ExecApprovalsSetParams,
  ExecApprovalsSetParamsSchema,
  type ExecApprovalsSnapshot,
  type ExecApprovalRequestParams,
  ExecApprovalRequestParamsSchema,
  type ExecApprovalResolveParams,
  ExecApprovalResolveParamsSchema,
  type PluginApprovalRequestParams,
  PluginApprovalRequestParamsSchema,
  type PluginApprovalResolveParams,
  PluginApprovalResolveParamsSchema,
  ErrorCodes,
  type ErrorShape,
  ErrorShapeSchema,
  type EventFrame,
  EventFrameSchema,
  errorShape,
  type GatewayFrame,
  GatewayFrameSchema,
  type HelloOk,
  HelloOkSchema,
  type LogsTailParams,
  LogsTailParamsSchema,
  type LogsTailResult,
  LogsTailResultSchema,
  type MemoryBackend,
  MemoryBackendSchema,
  type MemoryEmbeddingStatus,
  MemoryEmbeddingStatusSchema,
  type MemoryFilesDeleteParams,
  MemoryFilesDeleteParamsSchema,
  type MemoryFilesDeleteResult,
  MemoryFilesDeleteResultSchema,
  type MemoryFilesGetParams,
  MemoryFilesGetParamsSchema,
  type MemoryFilesGetResult,
  MemoryFilesGetResultSchema,
  type MemoryFilesListParams,
  MemoryFilesListParamsSchema,
  type MemoryFilesListResult,
  MemoryFilesListResultSchema,
  type MemoryFilesSetParams,
  MemoryFilesSetParamsSchema,
  type MemoryFilesSetResult,
  MemoryFilesSetResultSchema,
  type MemoryStatusBatch,
  MemoryStatusBatchSchema,
  type MemoryStatusCache,
  MemoryStatusCacheSchema,
  type MemoryStatusConfig,
  MemoryStatusConfigSchema,
  type MemoryStatusFts,
  MemoryStatusFtsSchema,
  type MemoryStatusParams,
  MemoryStatusParamsSchema,
  type MemoryStatusResult,
  MemoryStatusResultSchema,
  type MemoryStatusRuntime,
  MemoryStatusRuntimeSchema,
  type MemoryStatusSourceCount,
  MemoryStatusSourceCountSchema,
  type MemoryStatusVector,
  MemoryStatusVectorSchema,
  type MemorySyncParams,
  MemorySyncParamsSchema,
  type MemorySyncResult,
  MemorySyncResultSchema,
  type MemoryWorkspaceFileDocument,
  MemoryWorkspaceFileDocumentSchema,
  type MemoryWorkspaceFileEntry,
  MemoryWorkspaceFileEntrySchema,
  type ModelsListParams,
  ModelsListParamsSchema,
  type NodeCapabilityManifest,
  NodeCapabilityManifestSchema,
  type NodeDescribeParams,
  NodeDescribeParamsSchema,
  type NodeEventParams,
  NodeEventParamsSchema,
  type NodePendingDrainParams,
  NodePendingDrainParamsSchema,
  type NodePendingDrainResult,
  NodePendingDrainResultSchema,
  type NodePendingEnqueueParams,
  NodePendingEnqueueParamsSchema,
  type NodePendingEnqueueResult,
  NodePendingEnqueueResultSchema,
  type NodeInvokeParams,
  NodeInvokeParamsSchema,
  type NodeInvokeResultParams,
  NodeInvokeResultParamsSchema,
  type NodeTaskEventParams,
  NodeTaskEventParamsSchema,
  type NodeTaskResultParams,
  NodeTaskResultParamsSchema,
  type NodeTaskStartParams,
  NodeTaskStartParamsSchema,
  type NodeListParams,
  NodeListParamsSchema,
  type NodePendingAckParams,
  NodePendingAckParamsSchema,
  type NodePairApproveParams,
  NodePairApproveParamsSchema,
  type NodePairListParams,
  NodePairListParamsSchema,
  type NodePairRejectParams,
  NodePairRejectParamsSchema,
  type NodePairRequestParams,
  NodePairRequestParamsSchema,
  type NodePairVerifyParams,
  NodePairVerifyParamsSchema,
  type NodeRenameParams,
  NodeRenameParamsSchema,
  type PollParams,
  PollParamsSchema,
  PROTOCOL_VERSION,
  type PushTestParams,
  PushTestParamsSchema,
  PushTestResultSchema,
  type PresenceEntry,
  PresenceEntrySchema,
  ProtocolSchemas,
  type RequestFrame,
  RequestFrameSchema,
  type ResponseFrame,
  ResponseFrameSchema,
  SendParamsSchema,
  type SecretsResolveParams,
  type SecretsResolveResult,
  SecretsResolveParamsSchema,
  SecretsResolveResultSchema,
  type SessionsAbortParams,
  SessionsAbortParamsSchema,
  type SessionsCompactParams,
  SessionsCompactParamsSchema,
  type SessionsCreateParams,
  SessionsCreateParamsSchema,
  type SessionsDeleteParams,
  SessionsDeleteParamsSchema,
  type SessionsListParams,
  SessionsListParamsSchema,
  type SessionsMessagesSubscribeParams,
  SessionsMessagesSubscribeParamsSchema,
  type SessionsMessagesUnsubscribeParams,
  SessionsMessagesUnsubscribeParamsSchema,
  type SessionsPatchParams,
  SessionsPatchParamsSchema,
  type SessionsPreviewParams,
  SessionsPreviewParamsSchema,
  type SessionsResetParams,
  SessionsResetParamsSchema,
  type SessionsResolveParams,
  SessionsResolveParamsSchema,
  type SessionsSendParams,
  SessionsSendParamsSchema,
  type SessionsUsageParams,
  SessionsUsageParamsSchema,
  type ShutdownEvent,
  ShutdownEventSchema,
  type SkillsBinsParams,
  SkillsBinsParamsSchema,
  type SkillsBinsResult,
  type SkillsInstallParams,
  SkillsInstallParamsSchema,
  type SkillsStatusParams,
  SkillsStatusParamsSchema,
  type SkillsUpdateParams,
  SkillsUpdateParamsSchema,
  type ToolsCatalogParams,
  ToolsCatalogParamsSchema,
  type ToolsCatalogResult,
  type ToolsEffectiveParams,
  ToolsEffectiveParamsSchema,
  type ToolsEffectiveResult,
  type Snapshot,
  SnapshotSchema,
  type StateVersion,
  StateVersionSchema,
  type TalkModeParams,
  TalkModeParamsSchema,
  type TickEvent,
  TickEventSchema,
  type UpdateRunParams,
  UpdateRunParamsSchema,
  type WakeParams,
  WakeParamsSchema,
  type WebLoginStartParams,
  WebLoginStartParamsSchema,
  type WebLoginWaitParams,
  WebLoginWaitParamsSchema,
  type WizardCancelParams,
  WizardCancelParamsSchema,
  type WizardNextParams,
  WizardNextParamsSchema,
  type WizardNextResult,
  WizardNextResultSchema,
  type WizardStartParams,
  WizardStartParamsSchema,
  type WizardStartResult,
  WizardStartResultSchema,
  type WizardStatusParams,
  WizardStatusParamsSchema,
  type WizardStatusResult,
  WizardStatusResultSchema,
  type WizardStep,
  WizardStepSchema,
} from "./schema.js";
import type {
  AlisioModelHardware,
  AlisioModelRecommendation,
  AlisioModelsServerRemoveParams,
  AlisioModelsServerRemoveResult,
  AlisioModelsServerSaveParams,
  AlisioModelsServerSaveResult,
  AlisioModelsServerSelectParams,
  AlisioModelsServerSelectResult,
  AlisioRemoteModelServer,
} from "./schema/types.js";

const ajv = new (AjvPkg as unknown as new (opts?: object) => import("ajv").default)({
  allErrors: true,
  strict: false,
  removeAdditional: false,
});

export const validateConnectParams = ajv.compile<ConnectParams>(ConnectParamsSchema);
export const validateRequestFrame = ajv.compile<RequestFrame>(RequestFrameSchema);
export const validateResponseFrame = ajv.compile<ResponseFrame>(ResponseFrameSchema);
export const validateEventFrame = ajv.compile<EventFrame>(EventFrameSchema);
export const validateSendParams = ajv.compile(SendParamsSchema);
export const validatePollParams = ajv.compile<PollParams>(PollParamsSchema);
export const validateAgentParams = ajv.compile(AgentParamsSchema);
export const validateAlisioAccountGetParams = ajv.compile<AlisioAccountGetParams>(
  AlisioAccountGetParamsSchema,
);
export const validateAlisioAccountPasswordResetParams =
  ajv.compile<AlisioAccountPasswordResetParams>(AlisioAccountPasswordResetParamsSchema);
export const validateAlisioAccountRecoveryEmailParams =
  ajv.compile<AlisioAccountRecoveryEmailParams>(AlisioAccountRecoveryEmailParamsSchema);
export const validateAlisioAccountEmailAuthBeginParams =
  ajv.compile<AlisioAccountEmailAuthBeginParams>(AlisioAccountEmailAuthBeginParamsSchema);
export const validateAlisioAccountEmailAuthBeginResult =
  ajv.compile<AlisioAccountEmailAuthBeginResult>(AlisioAccountEmailAuthBeginResultSchema);
export const validateAlisioAccountEmailLinkAuthCompleteParams =
  ajv.compile<AlisioAccountEmailLinkAuthCompleteParams>(
    AlisioAccountEmailLinkAuthCompleteParamsSchema,
  );
export const validateAlisioAccountEmailAuthVerifyParams =
  ajv.compile<AlisioAccountEmailAuthVerifyParams>(AlisioAccountEmailAuthVerifyParamsSchema);
export const validateAlisioAccountGoogleAuthBeginParams =
  ajv.compile<AlisioAccountGoogleAuthBeginParams>(AlisioAccountGoogleAuthBeginParamsSchema);
export const validateAlisioAccountGoogleAuthBeginResult =
  ajv.compile<AlisioAccountGoogleAuthBeginResult>(AlisioAccountGoogleAuthBeginResultSchema);
export const validateAlisioAccountSignUpParams = ajv.compile<AlisioAccountSignUpParams>(
  AlisioAccountSignUpParamsSchema,
);
export const validateAlisioAccountSignInParams = ajv.compile<AlisioAccountSignInParams>(
  AlisioAccountSignInParamsSchema,
);
export const validateAlisioAccountSignOutParams = ajv.compile<AlisioAccountSignOutParams>(
  AlisioAccountSignOutParamsSchema,
);
export const validateAlisioAccountResult =
  ajv.compile<AlisioAccountResult>(AlisioAccountResultSchema);
export const validateAlisioAccountPasswordResetResult =
  ajv.compile<AlisioAccountPasswordResetResult>(AlisioAccountPasswordResetResultSchema);
export const validateAlisioAccountRecoveryEmailResult =
  ajv.compile<AlisioAccountRecoveryEmailResult>(AlisioAccountRecoveryEmailResultSchema);
export const validateAlisioAccountCompleteProfileParams =
  ajv.compile<AlisioAccountCompleteProfileParams>(AlisioAccountCompleteProfileParamsSchema);
export const validateAlisioAccountUpdateParams = ajv.compile<AlisioAccountUpdateParams>(
  AlisioAccountUpdateParamsSchema,
);
export const validateAlisioAiGetParams = ajv.compile<AlisioAiGetParams>(AlisioAiGetParamsSchema);
export const validateAlisioAiState = ajv.compile<AlisioAiState>(AlisioAiStateSchema);
export const validateAlisioAiBeginConnectParams = ajv.compile<AlisioAiBeginConnectParams>(
  AlisioAiBeginConnectParamsSchema,
);
export const validateAlisioAiBeginConnectResult = ajv.compile<AlisioAiBeginConnectResult>(
  AlisioAiBeginConnectResultSchema,
);
export const validateAlisioAiCompleteConnectParams = ajv.compile<AlisioAiCompleteConnectParams>(
  AlisioAiCompleteConnectParamsSchema,
);
export const validateAlisioAiDisconnectParams = ajv.compile<AlisioAiDisconnectParams>(
  AlisioAiDisconnectParamsSchema,
);
export const validateAlisioAiRefreshLimitsParams = ajv.compile<AlisioAiRefreshLimitsParams>(
  AlisioAiRefreshLimitsParamsSchema,
);
export const validateAlisioAiRenameProfileParams = ajv.compile<AlisioAiRenameProfileParams>(
  AlisioAiRenameProfileParamsSchema,
);
export const validateAlisioAiSelectProfileParams = ajv.compile<AlisioAiSelectProfileParams>(
  AlisioAiSelectProfileParamsSchema,
);
export const validateAlisioBootstrapGetParams = ajv.compile<AlisioBootstrapGetParams>(
  AlisioBootstrapGetParamsSchema,
);
export const validateAlisioModelsGetParams = ajv.compile<AlisioModelsGetParams>(
  AlisioModelsGetParamsSchema,
);
export const validateAlisioModelsInstallParams = ajv.compile<AlisioModelsInstallParams>(
  AlisioModelsInstallParamsSchema,
);
export const validateAlisioModelsInstallResult = ajv.compile<AlisioModelsInstallResult>(
  AlisioModelsInstallResultSchema,
);
export const validateAlisioModelsUninstallParams = ajv.compile<AlisioModelsUninstallParams>(
  AlisioModelsUninstallParamsSchema,
);
export const validateAlisioModelsUninstallResult = ajv.compile<AlisioModelsUninstallResult>(
  AlisioModelsUninstallResultSchema,
);
export const validateAlisioModelsServerSaveParams = ajv.compile<AlisioModelsServerSaveParams>(
  AlisioModelsServerSaveParamsSchema,
);
export const validateAlisioModelsServerSaveResult = ajv.compile<AlisioModelsServerSaveResult>(
  AlisioModelsServerSaveResultSchema,
);
export const validateAlisioModelsServerRemoveParams = ajv.compile<AlisioModelsServerRemoveParams>(
  AlisioModelsServerRemoveParamsSchema,
);
export const validateAlisioModelsServerRemoveResult = ajv.compile<AlisioModelsServerRemoveResult>(
  AlisioModelsServerRemoveResultSchema,
);
export const validateAlisioModelsServerSelectParams = ajv.compile<AlisioModelsServerSelectParams>(
  AlisioModelsServerSelectParamsSchema,
);
export const validateAlisioModelsServerSelectResult = ajv.compile<AlisioModelsServerSelectResult>(
  AlisioModelsServerSelectResultSchema,
);
export const validateAlisioModelsResult = ajv.compile<AlisioModelsResult>(AlisioModelsResultSchema);
export const validateAlisioBootstrapResult = ajv.compile<AlisioBootstrapResult>(
  AlisioBootstrapResultSchema,
);
export const validateAlisioDoctorSummaryParams = ajv.compile<AlisioDoctorSummaryParams>(
  AlisioDoctorSummaryParamsSchema,
);
export const validateAlisioDoctorSummaryResult = ajv.compile<AlisioDoctorSummaryResult>(
  AlisioDoctorSummaryResultSchema,
);
export const validateAlisioRuntimeRestartParams = ajv.compile<AlisioRuntimeRestartParams>(
  AlisioRuntimeRestartParamsSchema,
);
export const validateAlisioRuntimeRestartResult = ajv.compile<AlisioRuntimeRestartResult>(
  AlisioRuntimeRestartResultSchema,
);
export const validateAlisioOrganizationGetParams = ajv.compile<AlisioOrganizationGetParams>(
  AlisioOrganizationGetParamsSchema,
);
export const validateAlisioOrganizationSetParams = ajv.compile<AlisioOrganizationSetParams>(
  AlisioOrganizationSetParamsSchema,
);
export const validateAlisioSharingState = ajv.compile<AlisioSharingState>(AlisioSharingStateSchema);
export const validateAlisioSharingGetParams = ajv.compile<AlisioSharingGetParams>(
  AlisioSharingGetParamsSchema,
);
export const validateAlisioSharingRequestParams = ajv.compile<AlisioSharingRequestParams>(
  AlisioSharingRequestParamsSchema,
);
export const validateAlisioSharingRequestResult = ajv.compile<AlisioSharingRequestResult>(
  AlisioSharingRequestResultSchema,
);
export const validateAlisioSharingApproveParams = ajv.compile<AlisioSharingApproveParams>(
  AlisioSharingApproveParamsSchema,
);
export const validateAlisioSharingApproveResult = ajv.compile<AlisioSharingApproveResult>(
  AlisioSharingApproveResultSchema,
);
export const validateAlisioSharingRejectParams = ajv.compile<AlisioSharingRejectParams>(
  AlisioSharingRejectParamsSchema,
);
export const validateAlisioSharingRejectResult = ajv.compile<AlisioSharingRejectResult>(
  AlisioSharingRejectResultSchema,
);
export const validateAlisioSharingRevokeParams = ajv.compile<AlisioSharingRevokeParams>(
  AlisioSharingRevokeParamsSchema,
);
export const validateAlisioSharingRevokeResult = ajv.compile<AlisioSharingRevokeResult>(
  AlisioSharingRevokeResultSchema,
);
export const validateAlisioSharingPolicySetParams = ajv.compile<AlisioSharingPolicySetParams>(
  AlisioSharingPolicySetParamsSchema,
);
export const validateAlisioSharingPolicySetResult = ajv.compile<AlisioSharingPolicySetResult>(
  AlisioSharingPolicySetResultSchema,
);
export const validateAlisioConnectorsCatalogParams = ajv.compile<AlisioConnectorsCatalogParams>(
  AlisioConnectorsCatalogParamsSchema,
);
export const validateAlisioConnectorsListParams = ajv.compile<AlisioConnectorsListParams>(
  AlisioConnectorsListParamsSchema,
);
export const validateAlisioConnectorsBeginParams = ajv.compile<AlisioConnectorsBeginParams>(
  AlisioConnectorsBeginParamsSchema,
);
export const validateAlisioConnectorsBeginResult = ajv.compile<AlisioConnectorsBeginResult>(
  AlisioConnectorsBeginResultSchema,
);
export const validateAlisioConnectorsCompleteParams = ajv.compile<AlisioConnectorsCompleteParams>(
  AlisioConnectorsCompleteParamsSchema,
);
export const validateAlisioConnectorsRevokeParams = ajv.compile<AlisioConnectorsRevokeParams>(
  AlisioConnectorsRevokeParamsSchema,
);
export const validateAgentIdentityParams =
  ajv.compile<AgentIdentityParams>(AgentIdentityParamsSchema);
export const validateAgentWaitParams = ajv.compile<AgentWaitParams>(AgentWaitParamsSchema);
export const validateWakeParams = ajv.compile<WakeParams>(WakeParamsSchema);
export const validateAgentsListParams = ajv.compile<AgentsListParams>(AgentsListParamsSchema);
export const validateAgentsCreateParams = ajv.compile<AgentsCreateParams>(AgentsCreateParamsSchema);
export const validateAgentsUpdateParams = ajv.compile<AgentsUpdateParams>(AgentsUpdateParamsSchema);
export const validateAgentsDeleteParams = ajv.compile<AgentsDeleteParams>(AgentsDeleteParamsSchema);
export const validateAgentsFilesListParams = ajv.compile<AgentsFilesListParams>(
  AgentsFilesListParamsSchema,
);
export const validateAgentsFilesGetParams = ajv.compile<AgentsFilesGetParams>(
  AgentsFilesGetParamsSchema,
);
export const validateAgentsFilesSetParams = ajv.compile<AgentsFilesSetParams>(
  AgentsFilesSetParamsSchema,
);
export const validateAgentsFilesDeleteParams = ajv.compile<AgentsFilesDeleteParams>(
  AgentsFilesDeleteParamsSchema,
);
export const validateNodePairRequestParams = ajv.compile<NodePairRequestParams>(
  NodePairRequestParamsSchema,
);
export const validateNodePairListParams = ajv.compile<NodePairListParams>(NodePairListParamsSchema);
export const validateNodePairApproveParams = ajv.compile<NodePairApproveParams>(
  NodePairApproveParamsSchema,
);
export const validateNodePairRejectParams = ajv.compile<NodePairRejectParams>(
  NodePairRejectParamsSchema,
);
export const validateNodePairVerifyParams = ajv.compile<NodePairVerifyParams>(
  NodePairVerifyParamsSchema,
);
export const validateNodeRenameParams = ajv.compile<NodeRenameParams>(NodeRenameParamsSchema);
export const validateNodeListParams = ajv.compile<NodeListParams>(NodeListParamsSchema);
export const validateNodePendingAckParams = ajv.compile<NodePendingAckParams>(
  NodePendingAckParamsSchema,
);
export const validateNodeDescribeParams = ajv.compile<NodeDescribeParams>(NodeDescribeParamsSchema);
export const validateNodeInvokeParams = ajv.compile<NodeInvokeParams>(NodeInvokeParamsSchema);
export const validateNodeInvokeResultParams = ajv.compile<NodeInvokeResultParams>(
  NodeInvokeResultParamsSchema,
);
export const validateNodeTaskStartParams =
  ajv.compile<NodeTaskStartParams>(NodeTaskStartParamsSchema);
export const validateNodeTaskEventParams =
  ajv.compile<NodeTaskEventParams>(NodeTaskEventParamsSchema);
export const validateNodeTaskResultParams = ajv.compile<NodeTaskResultParams>(
  NodeTaskResultParamsSchema,
);
export const validateNodeEventParams = ajv.compile<NodeEventParams>(NodeEventParamsSchema);
export const validateNodePendingDrainParams = ajv.compile<NodePendingDrainParams>(
  NodePendingDrainParamsSchema,
);
export const validateNodePendingEnqueueParams = ajv.compile<NodePendingEnqueueParams>(
  NodePendingEnqueueParamsSchema,
);
export const validatePushTestParams = ajv.compile<PushTestParams>(PushTestParamsSchema);
export const validateSecretsResolveParams = ajv.compile<SecretsResolveParams>(
  SecretsResolveParamsSchema,
);
export const validateSecretsResolveResult = ajv.compile<SecretsResolveResult>(
  SecretsResolveResultSchema,
);
export const validateSessionsListParams = ajv.compile<SessionsListParams>(SessionsListParamsSchema);
export const validateSessionsPreviewParams = ajv.compile<SessionsPreviewParams>(
  SessionsPreviewParamsSchema,
);
export const validateSessionsResolveParams = ajv.compile<SessionsResolveParams>(
  SessionsResolveParamsSchema,
);
export const validateSessionsCreateParams = ajv.compile<SessionsCreateParams>(
  SessionsCreateParamsSchema,
);
export const validateSessionsSendParams = ajv.compile<SessionsSendParams>(SessionsSendParamsSchema);
export const validateSessionsMessagesSubscribeParams = ajv.compile<SessionsMessagesSubscribeParams>(
  SessionsMessagesSubscribeParamsSchema,
);
export const validateSessionsMessagesUnsubscribeParams =
  ajv.compile<SessionsMessagesUnsubscribeParams>(SessionsMessagesUnsubscribeParamsSchema);
export const validateSessionsAbortParams =
  ajv.compile<SessionsAbortParams>(SessionsAbortParamsSchema);
export const validateSessionsPatchParams =
  ajv.compile<SessionsPatchParams>(SessionsPatchParamsSchema);
export const validateSessionsResetParams =
  ajv.compile<SessionsResetParams>(SessionsResetParamsSchema);
export const validateSessionsDeleteParams = ajv.compile<SessionsDeleteParams>(
  SessionsDeleteParamsSchema,
);
export const validateSessionsCompactParams = ajv.compile<SessionsCompactParams>(
  SessionsCompactParamsSchema,
);
export const validateSessionsUsageParams =
  ajv.compile<SessionsUsageParams>(SessionsUsageParamsSchema);
export const validateConfigGetParams = ajv.compile<ConfigGetParams>(ConfigGetParamsSchema);
export const validateConfigSetParams = ajv.compile<ConfigSetParams>(ConfigSetParamsSchema);
export const validateConfigApplyParams = ajv.compile<ConfigApplyParams>(ConfigApplyParamsSchema);
export const validateConfigPatchParams = ajv.compile<ConfigPatchParams>(ConfigPatchParamsSchema);
export const validateConfigSchemaParams = ajv.compile<ConfigSchemaParams>(ConfigSchemaParamsSchema);
export const validateConfigSchemaLookupParams = ajv.compile<ConfigSchemaLookupParams>(
  ConfigSchemaLookupParamsSchema,
);
export const validateConfigSchemaLookupResult = ajv.compile<ConfigSchemaLookupResult>(
  ConfigSchemaLookupResultSchema,
);
export const validateWizardStartParams = ajv.compile<WizardStartParams>(WizardStartParamsSchema);
export const validateWizardNextParams = ajv.compile<WizardNextParams>(WizardNextParamsSchema);
export const validateWizardCancelParams = ajv.compile<WizardCancelParams>(WizardCancelParamsSchema);
export const validateWizardStatusParams = ajv.compile<WizardStatusParams>(WizardStatusParamsSchema);
export const validateTalkModeParams = ajv.compile<TalkModeParams>(TalkModeParamsSchema);
export const validateTalkConfigParams = ajv.compile<TalkConfigParams>(TalkConfigParamsSchema);
export const validateTalkConfigResult = ajv.compile<TalkConfigResult>(TalkConfigResultSchema);
export const validateTalkSpeakParams = ajv.compile<TalkSpeakParams>(TalkSpeakParamsSchema);
export const validateTalkSpeakResult = ajv.compile<TalkSpeakResult>(TalkSpeakResultSchema);
export const validateChannelsStatusParams = ajv.compile<ChannelsStatusParams>(
  ChannelsStatusParamsSchema,
);
export const validateChannelsStatusResult = ajv.compile<ChannelsStatusResult>(
  ChannelsStatusResultSchema,
);
export const validateChannelsLogoutParams = ajv.compile<ChannelsLogoutParams>(
  ChannelsLogoutParamsSchema,
);
export const validateChannelsPairingApproveParams = ajv.compile<ChannelsPairingApproveParams>(
  ChannelsPairingApproveParamsSchema,
);
export const validateChannelsPairingRejectParams = ajv.compile<ChannelsPairingRejectParams>(
  ChannelsPairingRejectParamsSchema,
);
export const validateModelsListParams = ajv.compile<ModelsListParams>(ModelsListParamsSchema);
export const validateSkillsStatusParams = ajv.compile<SkillsStatusParams>(SkillsStatusParamsSchema);
export const validateToolsCatalogParams = ajv.compile<ToolsCatalogParams>(ToolsCatalogParamsSchema);
export const validateToolsEffectiveParams = ajv.compile<ToolsEffectiveParams>(
  ToolsEffectiveParamsSchema,
);
export const validateSkillsBinsParams = ajv.compile<SkillsBinsParams>(SkillsBinsParamsSchema);
export const validateSkillsInstallParams =
  ajv.compile<SkillsInstallParams>(SkillsInstallParamsSchema);
export const validateSkillsUpdateParams = ajv.compile<SkillsUpdateParams>(SkillsUpdateParamsSchema);
export const validateCronListParams = ajv.compile<CronListParams>(CronListParamsSchema);
export const validateCronStatusParams = ajv.compile<CronStatusParams>(CronStatusParamsSchema);
export const validateCronAddParams = ajv.compile<CronAddParams>(CronAddParamsSchema);
export const validateCronUpdateParams = ajv.compile<CronUpdateParams>(CronUpdateParamsSchema);
export const validateCronRemoveParams = ajv.compile<CronRemoveParams>(CronRemoveParamsSchema);
export const validateCronRunParams = ajv.compile<CronRunParams>(CronRunParamsSchema);
export const validateCronRunsParams = ajv.compile<CronRunsParams>(CronRunsParamsSchema);
export const validateDevicePairListParams = ajv.compile<DevicePairListParams>(
  DevicePairListParamsSchema,
);
export const validateDevicePairApproveParams = ajv.compile<DevicePairApproveParams>(
  DevicePairApproveParamsSchema,
);
export const validateDevicePairRejectParams = ajv.compile<DevicePairRejectParams>(
  DevicePairRejectParamsSchema,
);
export const validateDevicePairRemoveParams = ajv.compile<DevicePairRemoveParams>(
  DevicePairRemoveParamsSchema,
);
export const validateDeviceTokenRotateParams = ajv.compile<DeviceTokenRotateParams>(
  DeviceTokenRotateParamsSchema,
);
export const validateDeviceTokenRevokeParams = ajv.compile<DeviceTokenRevokeParams>(
  DeviceTokenRevokeParamsSchema,
);
export const validateExecApprovalsGetParams = ajv.compile<ExecApprovalsGetParams>(
  ExecApprovalsGetParamsSchema,
);
export const validateExecApprovalsSetParams = ajv.compile<ExecApprovalsSetParams>(
  ExecApprovalsSetParamsSchema,
);
export const validateExecApprovalRequestParams = ajv.compile<ExecApprovalRequestParams>(
  ExecApprovalRequestParamsSchema,
);
export const validateExecApprovalResolveParams = ajv.compile<ExecApprovalResolveParams>(
  ExecApprovalResolveParamsSchema,
);
export const validatePluginApprovalRequestParams = ajv.compile<PluginApprovalRequestParams>(
  PluginApprovalRequestParamsSchema,
);
export const validatePluginApprovalResolveParams = ajv.compile<PluginApprovalResolveParams>(
  PluginApprovalResolveParamsSchema,
);
export const validateExecApprovalsNodeGetParams = ajv.compile<ExecApprovalsNodeGetParams>(
  ExecApprovalsNodeGetParamsSchema,
);
export const validateExecApprovalsNodeSetParams = ajv.compile<ExecApprovalsNodeSetParams>(
  ExecApprovalsNodeSetParamsSchema,
);
export const validateLogsTailParams = ajv.compile<LogsTailParams>(LogsTailParamsSchema);
export const validateMemoryStatusParams = ajv.compile<MemoryStatusParams>(MemoryStatusParamsSchema);
export const validateMemorySyncParams = ajv.compile<MemorySyncParams>(MemorySyncParamsSchema);
export const validateChatHistoryParams = ajv.compile(ChatHistoryParamsSchema);
export const validateChatSendParams = ajv.compile(ChatSendParamsSchema);
export const validateChatAbortParams = ajv.compile<ChatAbortParams>(ChatAbortParamsSchema);
export const validateChatInjectParams = ajv.compile<ChatInjectParams>(ChatInjectParamsSchema);
export const validateChatEvent = ajv.compile(ChatEventSchema);
export const validateUpdateRunParams = ajv.compile<UpdateRunParams>(UpdateRunParamsSchema);
export const validateWebLoginStartParams =
  ajv.compile<WebLoginStartParams>(WebLoginStartParamsSchema);
export const validateWebLoginWaitParams = ajv.compile<WebLoginWaitParams>(WebLoginWaitParamsSchema);

export function formatValidationErrors(errors: ErrorObject[] | null | undefined) {
  if (!errors?.length) {
    return "unknown validation error";
  }

  const parts: string[] = [];

  for (const err of errors) {
    const keyword = typeof err?.keyword === "string" ? err.keyword : "";
    const instancePath = typeof err?.instancePath === "string" ? err.instancePath : "";

    if (keyword === "additionalProperties") {
      const params = err?.params as { additionalProperty?: unknown } | undefined;
      const additionalProperty = params?.additionalProperty;
      if (typeof additionalProperty === "string" && additionalProperty.trim()) {
        const where = instancePath ? `at ${instancePath}` : "at root";
        parts.push(`${where}: unexpected property '${additionalProperty}'`);
        continue;
      }
    }

    const message =
      typeof err?.message === "string" && err.message.trim() ? err.message : "validation error";
    const where = instancePath ? `at ${instancePath}: ` : "";
    parts.push(`${where}${message}`);
  }

  // De-dupe while preserving order.
  const unique = Array.from(new Set(parts.filter((part) => part.trim())));
  if (!unique.length) {
    const fallback = ajv.errorsText(errors, { separator: "; " });
    return fallback || "unknown validation error";
  }
  return unique.join("; ");
}

export {
  ConnectParamsSchema,
  HelloOkSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
  GatewayFrameSchema,
  PresenceEntrySchema,
  SnapshotSchema,
  ErrorShapeSchema,
  StateVersionSchema,
  AgentEventSchema,
  ChatEventSchema,
  SendParamsSchema,
  PollParamsSchema,
  AgentParamsSchema,
  AlisioAiStateSchema,
  AlisioConnectedAccountSchema,
  AlisioConnectorDefinitionSchema,
  AlisioConnectorAuthorizationSchema,
  AlisioConnectorSummarySchema,
  AlisioLocalAccountProfileSchema,
  AlisioLocalModelCatalogEntrySchema,
  AlisioInstalledLocalModelSchema,
  AlisioModelHardwareSchema,
  AlisioModelRecommendationSchema,
  AlisioRemoteModelServerSchema,
  AlisioModelsTargetSchema,
  AlisioLocalUserPreferencesSchema,
  AlisioLocalDeviceSessionSchema,
  AlisioOrganizationStateSchema,
  AlisioSharingPrincipalSchema,
  AlisioSharingTargetSchema,
  AlisioSharingRequestSchema,
  AlisioSharingGrantSchema,
  AlisioSharingAuditEntrySchema,
  AlisioSharingStateSchema,
  AlisioBootstrapGetParamsSchema,
  AlisioModelsGetParamsSchema,
  AlisioModelsInstallParamsSchema,
  AlisioModelsInstallResultSchema,
  AlisioModelsUninstallParamsSchema,
  AlisioModelsUninstallResultSchema,
  AlisioModelsServerSaveParamsSchema,
  AlisioModelsServerSaveResultSchema,
  AlisioModelsServerRemoveParamsSchema,
  AlisioModelsServerRemoveResultSchema,
  AlisioModelsServerSelectParamsSchema,
  AlisioModelsServerSelectResultSchema,
  AlisioModelsResultSchema,
  AlisioBootstrapResultSchema,
  AlisioDoctorSummaryParamsSchema,
  AlisioDoctorSummaryResultSchema,
  AlisioAccountGetParamsSchema,
  AlisioAccountPasswordResetParamsSchema,
  AlisioAccountPasswordResetResultSchema,
  AlisioAccountEmailAuthBeginParamsSchema,
  AlisioAccountEmailAuthBeginResultSchema,
  AlisioAccountEmailLinkAuthCompleteParamsSchema,
  AlisioAccountEmailAuthVerifyParamsSchema,
  AlisioAccountGoogleAuthBeginParamsSchema,
  AlisioAccountGoogleAuthBeginResultSchema,
  AlisioAccountCompleteProfileParamsSchema,
  AlisioAccountResultSchema,
  AlisioAccountUpdateParamsSchema,
  AlisioAiGetParamsSchema,
  AlisioAiBeginConnectParamsSchema,
  AlisioAiBeginConnectResultSchema,
  AlisioAiCompleteConnectParamsSchema,
  AlisioAiDisconnectParamsSchema,
  AlisioAiRenameProfileParamsSchema,
  AlisioAiRefreshLimitsParamsSchema,
  AlisioAiSelectProfileParamsSchema,
  AlisioOrganizationGetParamsSchema,
  AlisioOrganizationSetParamsSchema,
  AlisioSharingGetParamsSchema,
  AlisioSharingRequestParamsSchema,
  AlisioSharingRequestResultSchema,
  AlisioSharingApproveParamsSchema,
  AlisioSharingApproveResultSchema,
  AlisioSharingRejectParamsSchema,
  AlisioSharingRejectResultSchema,
  AlisioSharingRevokeParamsSchema,
  AlisioSharingRevokeResultSchema,
  AlisioSharingPolicySetParamsSchema,
  AlisioSharingPolicySetResultSchema,
  AlisioConnectorsCatalogParamsSchema,
  AlisioConnectorsCatalogResultSchema,
  AlisioConnectorsListParamsSchema,
  AlisioConnectorsListResultSchema,
  AlisioConnectorsBeginParamsSchema,
  AlisioConnectorsBeginResultSchema,
  AlisioConnectorsCompleteParamsSchema,
  AlisioConnectorsRevokeParamsSchema,
  AgentIdentityParamsSchema,
  AgentIdentityResultSchema,
  WakeParamsSchema,
  PushTestParamsSchema,
  PushTestResultSchema,
  NodePairRequestParamsSchema,
  NodePairListParamsSchema,
  NodePairApproveParamsSchema,
  NodePairRejectParamsSchema,
  NodePairVerifyParamsSchema,
  NodeCapabilityManifestSchema,
  NodeListParamsSchema,
  NodePendingAckParamsSchema,
  NodeInvokeParamsSchema,
  NodeTaskStartParamsSchema,
  NodeTaskEventParamsSchema,
  NodeTaskResultParamsSchema,
  NodePendingDrainParamsSchema,
  NodePendingDrainResultSchema,
  NodePendingEnqueueParamsSchema,
  NodePendingEnqueueResultSchema,
  SessionsListParamsSchema,
  SessionsPreviewParamsSchema,
  SessionsResolveParamsSchema,
  SessionsCreateParamsSchema,
  SessionsSendParamsSchema,
  SessionsAbortParamsSchema,
  SessionsPatchParamsSchema,
  SessionsResetParamsSchema,
  SessionsDeleteParamsSchema,
  SessionsCompactParamsSchema,
  SessionsUsageParamsSchema,
  ConfigGetParamsSchema,
  ConfigSetParamsSchema,
  ConfigApplyParamsSchema,
  ConfigPatchParamsSchema,
  ConfigSchemaParamsSchema,
  ConfigSchemaLookupParamsSchema,
  ConfigSchemaResponseSchema,
  ConfigSchemaLookupResultSchema,
  WizardStartParamsSchema,
  WizardNextParamsSchema,
  WizardCancelParamsSchema,
  WizardStatusParamsSchema,
  WizardStepSchema,
  WizardNextResultSchema,
  WizardStartResultSchema,
  WizardStatusResultSchema,
  TalkConfigParamsSchema,
  TalkConfigResultSchema,
  TalkSpeakParamsSchema,
  TalkSpeakResultSchema,
  ChannelsStatusParamsSchema,
  ChannelsStatusResultSchema,
  ChannelsLogoutParamsSchema,
  ChannelsPairingApproveParamsSchema,
  ChannelsPairingRejectParamsSchema,
  WebLoginStartParamsSchema,
  WebLoginWaitParamsSchema,
  AgentSummarySchema,
  AgentsFileEntrySchema,
  AgentsCreateParamsSchema,
  AgentsCreateResultSchema,
  AgentsUpdateParamsSchema,
  AgentsUpdateResultSchema,
  AgentsDeleteParamsSchema,
  AgentsDeleteResultSchema,
  AgentsFilesListParamsSchema,
  AgentsFilesListResultSchema,
  AgentsFilesGetParamsSchema,
  AgentsFilesGetResultSchema,
  AgentsFilesSetParamsSchema,
  AgentsFilesSetResultSchema,
  AgentsFilesDeleteParamsSchema,
  AgentsFilesDeleteResultSchema,
  AgentsListParamsSchema,
  AgentsListResultSchema,
  ModelsListParamsSchema,
  SkillsStatusParamsSchema,
  ToolsCatalogParamsSchema,
  ToolsEffectiveParamsSchema,
  SkillsInstallParamsSchema,
  SkillsUpdateParamsSchema,
  CronJobSchema,
  CronListParamsSchema,
  CronStatusParamsSchema,
  CronAddParamsSchema,
  CronUpdateParamsSchema,
  CronRemoveParamsSchema,
  CronRunParamsSchema,
  CronRunsParamsSchema,
  LogsTailParamsSchema,
  LogsTailResultSchema,
  MemoryBackendSchema,
  MemoryEmbeddingStatusSchema,
  MemoryStatusSourceCountSchema,
  MemoryStatusCacheSchema,
  MemoryStatusFtsSchema,
  MemoryStatusVectorSchema,
  MemoryStatusBatchSchema,
  MemoryStatusConfigSchema,
  MemoryStatusRuntimeSchema,
  MemoryStatusParamsSchema,
  MemoryStatusResultSchema,
  MemoryWorkspaceFileEntrySchema,
  MemoryWorkspaceFileDocumentSchema,
  MemoryFilesListParamsSchema,
  MemoryFilesListResultSchema,
  MemoryFilesGetParamsSchema,
  MemoryFilesGetResultSchema,
  MemoryFilesSetParamsSchema,
  MemoryFilesSetResultSchema,
  MemoryFilesDeleteParamsSchema,
  MemoryFilesDeleteResultSchema,
  MemorySyncParamsSchema,
  MemorySyncResultSchema,
  ChatHistoryParamsSchema,
  ChatSendParamsSchema,
  ChatInjectParamsSchema,
  UpdateRunParamsSchema,
  TickEventSchema,
  ShutdownEventSchema,
  ProtocolSchemas,
  PROTOCOL_VERSION,
  ErrorCodes,
  errorShape,
};

export type {
  GatewayFrame,
  ConnectParams,
  HelloOk,
  RequestFrame,
  ResponseFrame,
  EventFrame,
  PresenceEntry,
  Snapshot,
  ErrorShape,
  StateVersion,
  AgentEvent,
  AlisioConnectedAccount,
  AlisioConnectorDefinition,
  AlisioConnectorAuthorization,
  AlisioConnectorSummary,
  AlisioLocalAccountProfile,
  AlisioLocalModelCatalogEntry,
  AlisioInstalledLocalModel,
  AlisioModelHardware,
  AlisioModelRecommendation,
  AlisioRemoteModelServer,
  AlisioModelsTarget,
  AlisioLocalUserPreferences,
  AlisioAiState,
  AlisioLocalDeviceSession,
  AlisioOrganizationState,
  AlisioSharingPrincipal,
  AlisioSharingTarget,
  AlisioSharingRequest,
  AlisioSharingGrant,
  AlisioSharingAuditEntry,
  AlisioSharingState,
  AlisioBootstrapGetParams,
  AlisioModelsGetParams,
  AlisioModelsInstallParams,
  AlisioModelsInstallResult,
  AlisioModelsUninstallParams,
  AlisioModelsUninstallResult,
  AlisioModelsServerSaveParams,
  AlisioModelsServerSaveResult,
  AlisioModelsServerRemoveParams,
  AlisioModelsServerRemoveResult,
  AlisioModelsServerSelectParams,
  AlisioModelsServerSelectResult,
  AlisioModelsResult,
  AlisioBootstrapResult,
  AlisioDoctorSummaryParams,
  AlisioDoctorSummaryResult,
  AlisioAccountGetParams,
  AlisioAccountPasswordResetParams,
  AlisioAccountPasswordResetResult,
  AlisioAccountEmailAuthBeginParams,
  AlisioAccountEmailAuthBeginResult,
  AlisioAccountEmailLinkAuthCompleteParams,
  AlisioAccountEmailAuthVerifyParams,
  AlisioAccountGoogleAuthBeginParams,
  AlisioAccountGoogleAuthBeginResult,
  AlisioAccountCompleteProfileParams,
  AlisioAccountResult,
  AlisioAccountUpdateParams,
  AlisioAiGetParams,
  AlisioAiBeginConnectParams,
  AlisioAiBeginConnectResult,
  AlisioAiCompleteConnectParams,
  AlisioAiDisconnectParams,
  AlisioAiRenameProfileParams,
  AlisioAiRefreshLimitsParams,
  AlisioAiSelectProfileParams,
  AlisioOrganizationGetParams,
  AlisioOrganizationSetParams,
  AlisioSharingGetParams,
  AlisioSharingRequestParams,
  AlisioSharingRequestResult,
  AlisioSharingApproveParams,
  AlisioSharingApproveResult,
  AlisioSharingRejectParams,
  AlisioSharingRejectResult,
  AlisioSharingRevokeParams,
  AlisioSharingRevokeResult,
  AlisioSharingPolicySetParams,
  AlisioSharingPolicySetResult,
  AlisioConnectorsCatalogParams,
  AlisioConnectorsCatalogResult,
  AlisioConnectorsListParams,
  AlisioConnectorsListResult,
  AlisioConnectorsBeginParams,
  AlisioConnectorsBeginResult,
  AlisioConnectorsCompleteParams,
  AlisioConnectorsRevokeParams,
  AgentIdentityParams,
  AgentIdentityResult,
  AgentWaitParams,
  ChatEvent,
  TickEvent,
  ShutdownEvent,
  WakeParams,
  NodePairRequestParams,
  NodePairListParams,
  NodePairApproveParams,
  DevicePairListParams,
  DevicePairApproveParams,
  DevicePairRejectParams,
  ConfigGetParams,
  ConfigSetParams,
  ConfigApplyParams,
  ConfigPatchParams,
  ConfigSchemaParams,
  ConfigSchemaResponse,
  WizardStartParams,
  WizardNextParams,
  WizardCancelParams,
  WizardStatusParams,
  WizardStep,
  WizardNextResult,
  WizardStartResult,
  WizardStatusResult,
  TalkConfigParams,
  TalkConfigResult,
  TalkSpeakParams,
  TalkSpeakResult,
  TalkModeParams,
  ChannelsStatusParams,
  ChannelsStatusResult,
  ChannelsLogoutParams,
  WebLoginStartParams,
  WebLoginWaitParams,
  AgentSummary,
  AgentsFileEntry,
  AgentsCreateParams,
  AgentsCreateResult,
  AgentsUpdateParams,
  AgentsUpdateResult,
  AgentsDeleteParams,
  AgentsDeleteResult,
  AgentsFilesListParams,
  AgentsFilesListResult,
  AgentsFilesGetParams,
  AgentsFilesGetResult,
  AgentsFilesSetParams,
  AgentsFilesSetResult,
  AgentsFilesDeleteParams,
  AgentsFilesDeleteResult,
  AgentsListParams,
  AgentsListResult,
  SkillsStatusParams,
  ToolsCatalogParams,
  ToolsCatalogResult,
  ToolsEffectiveParams,
  ToolsEffectiveResult,
  SkillsBinsParams,
  SkillsBinsResult,
  SkillsInstallParams,
  SkillsUpdateParams,
  NodeCapabilityManifest,
  NodePairRejectParams,
  NodePairVerifyParams,
  NodeListParams,
  NodeInvokeParams,
  NodeInvokeResultParams,
  NodeTaskStartParams,
  NodeTaskEventParams,
  NodeTaskResultParams,
  NodeEventParams,
  NodePendingDrainParams,
  NodePendingDrainResult,
  NodePendingEnqueueParams,
  NodePendingEnqueueResult,
  SessionsListParams,
  SessionsPreviewParams,
  SessionsResolveParams,
  SessionsPatchParams,
  SessionsPatchResult,
  SessionsResetParams,
  SessionsDeleteParams,
  SessionsCompactParams,
  SessionsUsageParams,
  CronJob,
  CronListParams,
  CronStatusParams,
  CronAddParams,
  CronUpdateParams,
  CronRemoveParams,
  CronRunParams,
  CronRunsParams,
  CronRunLogEntry,
  ExecApprovalsGetParams,
  ExecApprovalsSetParams,
  ExecApprovalsSnapshot,
  LogsTailParams,
  LogsTailResult,
  MemoryBackend,
  MemoryEmbeddingStatus,
  MemoryStatusSourceCount,
  MemoryStatusCache,
  MemoryStatusFts,
  MemoryStatusVector,
  MemoryStatusBatch,
  MemoryStatusConfig,
  MemoryStatusRuntime,
  MemoryStatusParams,
  MemoryStatusResult,
  MemoryWorkspaceFileEntry,
  MemoryWorkspaceFileDocument,
  MemoryFilesListParams,
  MemoryFilesListResult,
  MemoryFilesGetParams,
  MemoryFilesGetResult,
  MemoryFilesSetParams,
  MemoryFilesSetResult,
  MemoryFilesDeleteParams,
  MemoryFilesDeleteResult,
  MemorySyncParams,
  MemorySyncResult,
  PollParams,
  UpdateRunParams,
  ChatInjectParams,
};
