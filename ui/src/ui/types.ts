export type UpdateAvailable = import("../../../src/infra/update-startup.js").UpdateAvailable;
export type AlisioAccountState = import("../../../src/infra/alisio-store.js").AlisioAccountState;
export type AlisioAiState = import("../../../src/infra/alisio-ai.js").AlisioAiState;
export type ProviderUsageSummary =
  import("../../../src/infra/provider-usage.types.js").UsageSummary;
export type ProviderUsageSnapshot =
  import("../../../src/infra/provider-usage.types.js").ProviderUsageSnapshot;
export type ProviderUsageWindow = import("../../../src/infra/provider-usage.types.js").UsageWindow;
export type AlisioHttpBootstrap =
  import("../../../src/gateway/control-ui-contract.js").AlisioHttpBootstrap;
export type AlisioBootstrapState =
  import("../../../src/gateway/protocol/index.js").AlisioBootstrapResult;
export type AlisioModelsState = import("../../../src/gateway/protocol/index.js").AlisioModelsResult;
export type AlisioModelsInstallResult =
  import("../../../src/gateway/protocol/index.js").AlisioModelsInstallResult;
export type AlisioModelsUninstallResult =
  import("../../../src/gateway/protocol/index.js").AlisioModelsUninstallResult;
export type AlisioDoctorSummaryState =
  import("../../../src/gateway/protocol/index.js").AlisioDoctorSummaryResult;
export type AlisioProviderOverviewItem =
  import("../../../src/gateway/protocol/index.js").AlisioProviderOverviewItem;
export type AlisioProvidersState =
  import("../../../src/gateway/protocol/index.js").AlisioProvidersResult;
export type AlisioSharingState =
  import("../../../src/gateway/protocol/index.js").AlisioSharingState;
export type AlisioSharingRequestResult =
  import("../../../src/gateway/protocol/index.js").AlisioSharingRequestResult;
export type AlisioSharingApproveResult =
  import("../../../src/gateway/protocol/index.js").AlisioSharingApproveResult;
export type AlisioSharingRejectResult =
  import("../../../src/gateway/protocol/index.js").AlisioSharingRejectResult;
export type AlisioSharingRevokeResult =
  import("../../../src/gateway/protocol/index.js").AlisioSharingRevokeResult;
export type AlisioSharingPolicySetResult =
  import("../../../src/gateway/protocol/index.js").AlisioSharingPolicySetResult;
export type MemoryStatusState = import("../../../src/gateway/protocol/index.js").MemoryStatusResult;
export type MemorySyncResult = import("../../../src/gateway/protocol/index.js").MemorySyncResult;
export type MemoryGraphState = import("../../../src/gateway/protocol/index.js").MemoryGraphResult;
export type MemoryGraphNode = import("../../../src/gateway/protocol/index.js").MemoryGraphNode;
export type MemoryGraphEdge = import("../../../src/gateway/protocol/index.js").MemoryGraphEdge;
export type MemoryGraphBranch = import("../../../src/gateway/protocol/index.js").MemoryGraphBranch;
export type AlisioBootstrapStep = import("../../../src/infra/alisio-store.js").AlisioBootstrapStep;
export type AlisioConnectedAccount =
  import("../../../src/infra/alisio-store.js").AlisioConnectedAccount;
export type AlisioConnectorAuthorization =
  import("../../../src/infra/alisio-store.js").AlisioConnectorAuthorization;
export type AlisioConnectorsBeginResult =
  import("../../../src/infra/alisio-store.js").AlisioConnectorsBeginResult;
export type AlisioConnectorDefinition =
  import("../../../src/infra/alisio-store.js").AlisioConnectorDefinition;
export type AlisioOrganizationMembershipState =
  import("../../../src/infra/alisio-store.js").AlisioOrganizationMembershipState;
export type WizardNextResult = import("../../../src/gateway/protocol/index.js").WizardNextResult;
export type WizardStartResult = import("../../../src/gateway/protocol/index.js").WizardStartResult;
export type WizardStatusResult =
  import("../../../src/gateway/protocol/index.js").WizardStatusResult;
export type WizardStep = import("../../../src/gateway/protocol/index.js").WizardStep;
export type AlisioAuthStage = "entry" | "email-link";
import type { ProductChannelSurfaceMode } from "../../../src/channels/product-surface.shared.js";
import type {
  ComputerApprovalMode,
  ComputerCapabilityDescriptor,
  ComputerCapabilityKind,
  ComputerSessionBlockingState,
  ComputerPermissionState,
  ComputerSessionState,
  ComputerSessionTarget,
} from "../../../src/computer/types.js";
import type { CronJobBase } from "../../../src/cron/types-shared.js";
import type { ConfigUiHints } from "../../../src/shared/config-ui-hints-types.js";
import type {
  ConversationCategory,
  ConversationRelationship,
  ConversationRuntimeRef,
  ConversationSurfaceRef,
} from "../../../src/shared/conversation-model.js";
import type {
  GatewayAgentRow as SharedGatewayAgentRow,
  SessionsListResultBase,
  SessionsPatchResultBase,
} from "../../../src/shared/session-types.js";
export type { ConfigUiHint, ConfigUiHints } from "../../../src/shared/config-ui-hints-types.js";
export type {
  ComputerCapabilityDescriptor,
  ComputerCapabilityKind,
  ComputerSessionBlockingState,
  ComputerSessionTarget,
} from "../../../src/computer/types.js";

export type ChannelsStatusSnapshot = {
  ts: number;
  channelSurfaceMode?: ProductChannelSurfaceMode;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channelDetailLabels?: Record<string, string>;
  channelSystemImages?: Record<string, string>;
  wizard?: ChannelsWizardSnapshot;
  channelMeta?: ChannelUiMetaEntry[];
  channelIssues?: Record<string, ChannelStatusIssue[]>;
  channels: Record<string, unknown>;
  channelAccounts: Record<string, ChannelAccountSnapshot[]>;
  channelDefaultAccountId: Record<string, string>;
};

export type ChannelsWizardSnapshot = {
  running: boolean;
  sessionId?: string | null;
  channelId?: string | null;
};

export type ChannelUiMetaEntry = {
  id: string;
  label: string;
  detailLabel: string;
  blurb?: string;
  docsPath?: string;
  docsLabel?: string;
  systemImage?: string;
};

export type ChannelStatusIssue = {
  channel: string;
  accountId: string;
  kind: "intent" | "permissions" | "config" | "auth" | "runtime";
  message: string;
  fix?: string | null;
};

export const CRON_CHANNEL_LAST = "last";

export type ChannelAccountSnapshot = {
  accountId: string;
  name?: string | null;
  enabled?: boolean | null;
  configured?: boolean | null;
  linked?: boolean | null;
  running?: boolean | null;
  connected?: boolean | null;
  reconnectAttempts?: number | null;
  lastConnectedAt?: number | null;
  lastError?: string | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastProbeAt?: number | null;
  mode?: string | null;
  dmPolicy?: string | null;
  dmOnboardingState?: "waiting_for_first_dm" | "pending_approval" | null;
  pendingPairingRequests?: number | null;
  pendingPairing?: Array<{
    requestId: string;
    label: string;
    detail?: string | null;
  }> | null;
  allowFrom?: string[] | null;
  tokenSource?: string | null;
  botTokenSource?: string | null;
  appTokenSource?: string | null;
  credentialSource?: string | null;
  audienceType?: string | null;
  audience?: string | null;
  webhookPath?: string | null;
  webhookUrl?: string | null;
  baseUrl?: string | null;
  allowUnmentionedGroups?: boolean | null;
  cliPath?: string | null;
  dbPath?: string | null;
  port?: number | null;
  self?: WhatsAppSelf | null;
  probe?: unknown;
  audit?: unknown;
  application?: unknown;
};

export type WhatsAppSelf = {
  e164?: string | null;
  jid?: string | null;
};

export type WhatsAppDisconnect = {
  at: number;
  status?: number | null;
  error?: string | null;
  loggedOut?: boolean | null;
};

export type WhatsAppStatus = {
  configured: boolean;
  linked: boolean;
  authAgeMs?: number | null;
  self?: WhatsAppSelf | null;
  running: boolean;
  connected: boolean;
  lastConnectedAt?: number | null;
  lastDisconnect?: WhatsAppDisconnect | null;
  reconnectAttempts: number;
  lastMessageAt?: number | null;
  lastEventAt?: number | null;
  lastError?: string | null;
};

export type TelegramBot = {
  id?: number | null;
  username?: string | null;
};

export type TelegramWebhook = {
  url?: string | null;
  hasCustomCert?: boolean | null;
};

export type TelegramProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
  bot?: TelegramBot | null;
  webhook?: TelegramWebhook | null;
};

export type TelegramStatus = {
  configured: boolean;
  tokenSource?: string | null;
  running: boolean;
  mode?: string | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  probe?: TelegramProbe | null;
  lastProbeAt?: number | null;
};

export type DiscordBot = {
  id?: string | null;
  username?: string | null;
};

export type DiscordProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
  bot?: DiscordBot | null;
};

export type DiscordStatus = {
  configured: boolean;
  tokenSource?: string | null;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  probe?: DiscordProbe | null;
  lastProbeAt?: number | null;
};

export type GoogleChatProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
};

export type GoogleChatStatus = {
  configured: boolean;
  credentialSource?: string | null;
  audienceType?: string | null;
  audience?: string | null;
  webhookPath?: string | null;
  webhookUrl?: string | null;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  probe?: GoogleChatProbe | null;
  lastProbeAt?: number | null;
};

export type SlackBot = {
  id?: string | null;
  name?: string | null;
};

export type SlackTeam = {
  id?: string | null;
  name?: string | null;
};

export type SlackProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
  bot?: SlackBot | null;
  team?: SlackTeam | null;
};

export type SlackStatus = {
  configured: boolean;
  botTokenSource?: string | null;
  appTokenSource?: string | null;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  probe?: SlackProbe | null;
  lastProbeAt?: number | null;
};

export type SignalProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
  version?: string | null;
};

export type SignalStatus = {
  configured: boolean;
  baseUrl: string;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  probe?: SignalProbe | null;
  lastProbeAt?: number | null;
};

export type IMessageProbe = {
  ok: boolean;
  error?: string | null;
};

export type IMessageStatus = {
  configured: boolean;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  cliPath?: string | null;
  dbPath?: string | null;
  probe?: IMessageProbe | null;
  lastProbeAt?: number | null;
};

export type NostrProfile = {
  name?: string | null;
  displayName?: string | null;
  about?: string | null;
  picture?: string | null;
  banner?: string | null;
  website?: string | null;
  nip05?: string | null;
  lud16?: string | null;
};

export type NostrStatus = {
  configured: boolean;
  publicKey?: string | null;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  profile?: NostrProfile | null;
};

export type MSTeamsProbe = {
  ok: boolean;
  error?: string | null;
  appId?: string | null;
};

export type MSTeamsStatus = {
  configured: boolean;
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  port?: number | null;
  probe?: MSTeamsProbe | null;
  lastProbeAt?: number | null;
};

export type ConfigSnapshotIssue = {
  path: string;
  message: string;
};

export type ConfigSnapshot = {
  path?: string | null;
  exists?: boolean | null;
  raw?: string | null;
  hash?: string | null;
  parsed?: unknown;
  valid?: boolean | null;
  config?: Record<string, unknown> | null;
  issues?: ConfigSnapshotIssue[] | null;
};

export type ConfigSchemaResponse = {
  schema: unknown;
  uiHints: ConfigUiHints;
  version: string;
  generatedAt: string;
};

export type PresenceEntry = {
  instanceId?: string | null;
  host?: string | null;
  ip?: string | null;
  version?: string | null;
  platform?: string | null;
  deviceFamily?: string | null;
  modelIdentifier?: string | null;
  roles?: string[] | null;
  scopes?: string[] | null;
  mode?: string | null;
  lastInputSeconds?: number | null;
  reason?: string | null;
  text?: string | null;
  ts?: number | null;
};

export type GatewaySessionsDefaults = {
  modelProvider: string | null;
  model: string | null;
  contextTokens: number | null;
};

export type ChatModelOverride = import("./chat-model-ref.ts").ChatModelOverride;

export type GatewayAgentRow = SharedGatewayAgentRow;

export type AgentsListResult = {
  defaultId: string;
  mainKey: string;
  scope: string;
  agents: GatewayAgentRow[];
};

export type NativeShellPermission =
  | "notifications"
  | "appleScript"
  | "accessibility"
  | "screenRecording"
  | "microphone"
  | "speechRecognition"
  | "camera"
  | "location";

export type NativeShellVoiceWakeState = {
  supported: boolean;
  enabled: boolean;
  talkEnabled: boolean;
  triggers: string[];
};

export type NativeShellState = {
  platform: "macos" | "windows";
  launchAtLogin: boolean;
  permissions: Record<NativeShellPermission, boolean>;
  voiceWake: NativeShellVoiceWakeState;
  logsPath: string | null;
  developerCheckoutAvailable?: boolean;
};

export type AgentIdentityResult = {
  agentId: string;
  name: string;
  avatar: string;
  avatarUrl?: string;
  emoji?: string;
  theme?: string;
};

export type AgentFileEntry = {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
};

export type AgentsFilesListResult = {
  agentId: string;
  workspace: string;
  files: AgentFileEntry[];
};

export type AgentsFilesGetResult = {
  agentId: string;
  workspace: string;
  file: AgentFileEntry;
};

export type AgentsFilesSetResult = {
  ok: true;
  agentId: string;
  workspace: string;
  file: AgentFileEntry;
};

export type AgentsFilesDeleteResult = {
  ok: true;
  agentId: string;
  workspace: string;
  name: string;
  deleted: boolean;
};

export type SessionRunStatus = "running" | "done" | "failed" | "killed" | "timeout";

export type GatewaySessionRow = {
  key: string;
  conversationId?: string;
  conversationKey?: string;
  transcriptId?: string;
  spawnedBy?: string;
  kind: "direct" | "group" | "global" | "unknown";
  category?: ConversationCategory;
  surfaceRef?: ConversationSurfaceRef;
  runtimeRef?: ConversationRuntimeRef;
  relationship?: ConversationRelationship;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  surface?: string;
  subject?: string;
  room?: string;
  space?: string;
  updatedAt: number | null;
  sessionId?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean;
  status?: SessionRunStatus;
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  childSessions?: string[];
  modelOverride?: string;
  providerOverride?: string;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
};

export type {
  ComputerActionType,
  ComputerApprovalMode,
  ComputerApprovalRequest,
  ComputerBackendKind,
  ComputerCapabilityReasonCode,
  ComputerCoordinateSpace,
  ComputerFrame,
  ComputerObservationContext,
  ComputerPolicyDecision,
  ComputerPolicyReasonCode,
  ComputerPermissionState,
  ComputerReplayAction,
  ComputerReplayFrame,
  ComputerSessionBufferState,
  ComputerSessionExport,
  ComputerSessionExportFrame,
  ComputerSessionLogEvent,
  ComputerSafetyEvent,
  ComputerSafetyEventType,
  ComputerSafetyLevel,
  ComputerReplayStep,
  ComputerSessionSafety,
  ComputerSessionState,
  ComputerSessionStep,
  ComputerSessionStatus,
  ComputerStepPhase,
  ComputerStepStatus,
  ComputerStructuredAction,
  ComputerTimelineEventCode,
  ComputerTimelineEntry,
} from "../../../src/computer/types.js";

export type ComputerSessionUpdateResult = {
  sessionKey: string;
  session: ComputerSessionState | null;
};

export type ComputerSessionPatch = {
  command?: "start" | "pause" | "resume" | "stop";
  mode?: ComputerApprovalMode;
  permissions?: Partial<ComputerPermissionState>;
};

export type SessionsListResult = SessionsListResultBase<GatewaySessionsDefaults, GatewaySessionRow>;

export type SessionsPatchResult = SessionsPatchResultBase<{
  sessionId: string;
  updatedAt?: number;
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
}> & {
  resolved?: {
    modelProvider?: string;
    model?: string;
  };
};

export type {
  CostUsageDailyEntry,
  CostUsageSummary,
  SessionsUsageEntry,
  SessionsUsageResult,
  SessionsUsageTotals,
  SessionUsageTimePoint,
  SessionUsageTimeSeries,
} from "./usage-types.ts";

export type CronRunStatus = "ok" | "error" | "skipped";
export type CronDeliveryStatus = "delivered" | "not-delivered" | "unknown" | "not-requested";
export type CronJobsEnabledFilter = "all" | "enabled" | "disabled";
export type CronJobsSortBy = "nextRunAtMs" | "updatedAtMs" | "name";
export type CronRunScope = "job" | "all";
export type CronRunsStatusValue = CronRunStatus;
export type CronRunsStatusFilter = "all" | CronRunStatus;
export type CronSortDir = "asc" | "desc";

export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string; staggerMs?: number };

export type CronSessionTarget = "main" | "isolated" | "current" | `session:${string}`;
export type CronWakeMode = "next-heartbeat" | "now";

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "agentTurn";
      message: string;
      model?: string;
      fallbacks?: string[];
      thinking?: string;
      timeoutSeconds?: number;
      allowUnsafeExternalContent?: boolean;
      lightContext?: boolean;
      deliver?: boolean;
      channel?: string;
      to?: string;
      bestEffortDeliver?: boolean;
    };

export type CronDelivery = {
  mode: "none" | "announce" | "webhook";
  channel?: string;
  to?: string;
  accountId?: string;
  bestEffort?: boolean;
  failureDestination?: CronFailureDestination;
};

export type CronFailureDestination = {
  channel?: string;
  to?: string;
  mode?: "announce" | "webhook";
  accountId?: string;
};

export type CronFailureAlert = {
  after?: number;
  channel?: string;
  to?: string;
  cooldownMs?: number;
  mode?: "announce" | "webhook";
  accountId?: string;
};

export type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: CronRunStatus;
  lastStatus?: CronRunStatus;
  lastError?: string;
  lastErrorReason?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  lastDelivered?: boolean;
  lastDeliveryStatus?: CronDeliveryStatus;
  lastDeliveryError?: string;
  lastFailureAlertAtMs?: number;
};

export type CronJob = CronJobBase<
  CronSchedule,
  CronSessionTarget,
  CronWakeMode,
  CronPayload,
  CronDelivery,
  CronFailureAlert | false
> & {
  state?: CronJobState;
};

export type CronStatus = {
  enabled: boolean;
  jobs: number;
  nextWakeAtMs?: number | null;
};

export type CronRunLogEntry = {
  ts: number;
  jobId: string;
  action?: "finished";
  status?: CronRunStatus;
  durationMs?: number;
  error?: string;
  summary?: string;
  delivered?: boolean;
  deliveryStatus?: CronDeliveryStatus;
  deliveryError?: string;
  sessionId?: string;
  sessionKey?: string;
  runAtMs?: number;
  nextRunAtMs?: number;
  model?: string;
  provider?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
  jobName?: string;
};

export type CronJobsListResult = {
  jobs: CronJob[];
  total?: number;
  limit?: number;
  offset?: number;
  nextOffset?: number | null;
  hasMore?: boolean;
};

export type CronRunsResult = {
  entries: CronRunLogEntry[];
  total?: number;
  limit?: number;
  offset?: number;
  nextOffset?: number | null;
  hasMore?: boolean;
};

export type TaskRuntime = import("../../../src/gateway/protocol/index.js").TaskRuntime;
export type TaskStatus = import("../../../src/gateway/protocol/index.js").TaskStatus;
export type TaskDeliveryStatus =
  import("../../../src/gateway/protocol/index.js").TaskDeliveryStatus;
export type TaskNotifyPolicy = import("../../../src/gateway/protocol/index.js").TaskNotifyPolicy;
export type TaskProposalKind = import("../../../src/gateway/protocol/index.js").TaskProposalKind;
export type TaskProposalDecision =
  import("../../../src/gateway/protocol/index.js").TaskProposalDecision;
export type TaskProposalCreatedBy =
  import("../../../src/gateway/protocol/index.js").TaskProposalCreatedBy;
export type CanonicalTaskSummary =
  import("../../../src/gateway/protocol/index.js").CanonicalTaskSummary;
export type Task = import("../../../src/gateway/protocol/index.js").Task;
export type TaskExecution = import("../../../src/gateway/protocol/index.js").TaskExecution;
export type TaskExecutionStep = import("../../../src/gateway/protocol/index.js").TaskExecutionStep;
export type TaskAssignment = import("../../../src/gateway/protocol/index.js").TaskAssignment;
export type TaskApproval = import("../../../src/gateway/protocol/index.js").TaskApproval;
export type TaskEvent = import("../../../src/gateway/protocol/index.js").TaskEvent;
export type TaskDependency = import("../../../src/gateway/protocol/index.js").TaskDependency;
export type TaskRegistrySummary =
  import("../../../src/gateway/protocol/index.js").TaskRegistrySummary;
export type TaskProposalSummary =
  import("../../../src/gateway/protocol/index.js").TaskProposalSummary;
export type TaskRecord = import("../../../src/gateway/protocol/index.js").TaskRecord;
export type TaskProposalRecord =
  import("../../../src/gateway/protocol/index.js").TaskProposalRecord;
export type TaskAuditFinding = import("../../../src/gateway/protocol/index.js").TaskAuditFinding;
export type TaskAuditSummary = import("../../../src/gateway/protocol/index.js").TaskAuditSummary;
export type TaskMaintenanceSummary =
  import("../../../src/gateway/protocol/index.js").TaskMaintenanceSummary;
export type TasksOverviewResult =
  import("../../../src/gateway/protocol/index.js").TasksOverviewResult;
export type TasksDetailResult = import("../../../src/gateway/protocol/index.js").TasksDetailResult;

export type TaskProposalDraft = {
  clientKey: string;
  requesterSessionKey: string;
  sourceMessageId?: string;
  kind: TaskProposalKind;
  title: string;
  summary?: string;
  rationale?: string;
  acceptance: string[];
  launchPrompt?: string;
  agentId?: string;
  createdBy?: TaskProposalCreatedBy;
};

export type SkillsStatusConfigCheck = {
  path: string;
  satisfied: boolean;
};

export type SkillInstallOption = {
  id: string;
  kind: "apt" | "brew" | "node" | "go" | "uv" | "download";
  label: string;
  bins: string[];
};

export type SkillStatusEntry = {
  kind?: "local-skill" | "mcp-server";
  name: string;
  description: string;
  source: string;
  filePath: string;
  baseDir: string;
  skillKey: string;
  bundled?: boolean;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
  requirements: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  missing: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  configChecks: SkillsStatusConfigCheck[];
  install: SkillInstallOption[];
  manifestVersion?: string;
  manifestSource?: "manifest" | "legacy-metadata" | "inferred";
  manifestValid?: boolean;
  marketplaceReady?: boolean;
  manifestIssues?: Array<{ level: "error" | "warn"; path?: string; message: string }>;
  permissions?: {
    consent: "implicit" | "explicit";
    sandbox: {
      mode: "isolated" | "inherit";
      filesystem: "read-only" | "workspace-write";
      network: "off" | "inherit";
    };
    exec?: { bins?: string[] };
    env?: { read?: string[] };
    files?: { read?: string[]; write?: string[] };
    network?: { outbound?: boolean; hosts?: string[] };
    mcp?: {
      consume?: boolean;
      exposeTools?: boolean;
      exposePrompts?: boolean;
      exposeResources?: boolean;
    };
  };
  outputs?: {
    primary: "instructions" | "tool" | "prompt" | "resource";
    formats: string[];
  };
  compat?: {
    os?: string[];
    runtimes?: string[];
    requires?: {
      bins?: string[];
      anyBins?: string[];
      env?: string[];
      config?: string[];
    };
    mcp?: {
      transports?: string[];
      capabilities?: Array<"tools" | "prompts" | "resources">;
    };
  };
  subscription?: {
    required: boolean;
    plan?: string;
    featureFlag?: string;
  };
  access?: {
    allowed: boolean;
    required: boolean;
    currentPlan: string;
    plan?: string;
    featureFlag?: string;
    enabledFeatureFlags: string[];
    issues: Array<{ code: string; message: string }>;
  };
  installed?: boolean;
  installable?: boolean;
  removable?: boolean;
  executable?: boolean;
  mcpServer?: {
    serverName: string;
    transport: "stdio" | "sse" | "streamable-http";
    launchSummary: string;
  };
  recentAudit?: Array<{
    id: string;
    ts: string;
    workspaceDir: string;
    skillName: string;
    action: "install" | "remove" | "execute";
    outcome: "requested" | "granted" | "denied" | "completed" | "failed";
    decision?: "allow-once" | "allow-always" | "deny";
    actor?: string;
    summary: string;
  }>;
  consentGrants?: Array<{
    workspaceDir: string;
    skillName: string;
    action: "install" | "remove" | "execute";
    decision: "allow-always";
    fingerprint: string;
    createdAt: string;
    updatedAt: string;
    actor?: string;
  }>;
};

export type SkillStatusReport = {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillStatusEntry[];
  marketplaceCatalog?: SkillStatusEntry[];
};

export type StatusSummary = Record<string, unknown>;

export type HealthSnapshot = Record<string, unknown>;

/** Strongly-typed health response from the gateway (richer than HealthSnapshot). */
export type HealthSummary = {
  ok: boolean;
  ts: number;
  durationMs: number;
  heartbeatSeconds: number;
  nextHeartbeatDueAtMs?: number | null;
  defaultAgentId: string;
  agents: Array<{ id: string; name?: string }>;
  sessions: {
    path: string;
    count: number;
    recent: Array<{
      key: string;
      updatedAt: number | null;
      age: number | null;
    }>;
  };
};

/** A model entry returned by the gateway model-catalog endpoint. */
export type ModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  providerLabel?: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image" | "document">;
};

export type ToolCatalogProfile =
  import("../../../src/gateway/protocol/schema/types.js").ToolCatalogProfile;
export type ToolCatalogEntry =
  import("../../../src/gateway/protocol/schema/types.js").ToolCatalogEntry;
export type ToolCatalogGroup =
  import("../../../src/gateway/protocol/schema/types.js").ToolCatalogGroup;
export type ToolsCatalogResult =
  import("../../../src/gateway/protocol/schema/types.js").ToolsCatalogResult;
export type ToolsEffectiveEntry =
  import("../../../src/gateway/protocol/schema/types.js").ToolsEffectiveEntry;
export type ToolsEffectiveGroup =
  import("../../../src/gateway/protocol/schema/types.js").ToolsEffectiveGroup;
export type ToolsEffectiveResult =
  import("../../../src/gateway/protocol/schema/types.js").ToolsEffectiveResult;

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogEntry = {
  raw: string;
  time?: string | null;
  level?: LogLevel | null;
  subsystem?: string | null;
  message?: string | null;
  meta?: Record<string, unknown> | null;
};

// ── Attention ───────────────────────────────────────

export type AttentionSeverity = "error" | "warning" | "info";

export type AttentionItem = {
  severity: AttentionSeverity;
  icon: string;
  title: string;
  description: string;
  href?: string;
  external?: boolean;
};
