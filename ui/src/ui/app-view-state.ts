import type { NodeListNode } from "../../../src/shared/node-list-types.js";
import type { PendingAlisioConnectorChatResume } from "./alisio-connector-oauth.ts";
import type { EventLogEntry } from "./app-events.ts";
import type { CompactionStatus, FallbackStatus } from "./app-tool-stream.ts";
import type { CronModelSuggestionsState, CronState } from "./controllers/cron.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type { RuntimeNodePairingList } from "./controllers/node-pairing.ts";
import type { SecurityAccessMode } from "./controllers/security-access.ts";
import type { SkillMessage } from "./controllers/skills.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { ModelsServerDraft } from "./models-view-types.ts";
import type { SettingsSection, Tab } from "./navigation.ts";
import type { UiSettings } from "./storage.ts";
import type { ThemeTransitionContext } from "./theme-transition.ts";
import type { ResolvedTheme, ThemeMode, ThemeName } from "./theme.ts";
import type { ProviderUsageSummary } from "./types.ts";
import type {
  AlisioAccountState,
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
  AlisioOrganizationMembershipState,
  AgentsListResult,
  AgentsFilesListResult,
  AgentIdentityResult,
  AttentionItem,
  ChannelsStatusSnapshot,
  ConfigSnapshot,
  ConfigUiHints,
  HealthSummary,
  LogEntry,
  LogLevel,
  ChatModelOverride,
  ModelCatalogEntry,
  NativeShellState,
  PresenceEntry,
  SessionsUsageResult,
  CostUsageSummary,
  SessionUsageTimeSeries,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
  ToolsCatalogResult,
} from "./types.ts";
import type { ChatAttachment, ChatQueueItem } from "./ui-types.ts";
import type { SessionLogEntry } from "./views/usage.ts";

export type AppViewState = {
  settings: UiSettings;
  password: string;
  tab: Tab;
  settingsSection: SettingsSection;
  basePath: string;
  connected: boolean;
  theme: ThemeName;
  themeMode: ThemeMode;
  themeResolved: ResolvedTheme;
  hello: GatewayHelloOk | null;
  lastError: string | null;
  lastErrorCode: string | null;
  eventLog: EventLogEntry[];
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  nativeShellLoading: boolean;
  nativeShellError: string | null;
  nativeShellState: NativeShellState | null;
  alisioStartupLoading: boolean;
  alisioStartupError: string | null;
  alisioStartupBootstrap: import("./types.ts").AlisioHttpBootstrap | null;
  alisioBootstrapLoading: boolean;
  alisioBootstrapError: string | null;
  alisioBootstrap: import("./types.ts").AlisioBootstrapState | null;
  alisioDoctorLoading: boolean;
  alisioDoctorError: string | null;
  alisioDoctor: import("./types.ts").AlisioDoctorSummaryState | null;
  alisioModelsLoading: boolean;
  alisioModelsError: string | null;
  alisioModels: import("./types.ts").AlisioModelsState | null;
  alisioAccountLoading: boolean;
  alisioAccountError: string | null;
  alisioAccountNotice: string | null;
  alisioAccount: AlisioAccountState | null;
  alisioAuthMode: "sign-up" | "sign-in";
  alisioAuthEmail: string;
  alisioAuthPassword: string;
  alisioAuthPasswordVisible: boolean;
  alisioAiLoading: boolean;
  alisioAiError: string | null;
  providerUsageLoading: boolean;
  providerUsageError: string | null;
  providerUsageSummary: ProviderUsageSummary | null;
  alisioOrganizationLoading: boolean;
  alisioOrganizationError: string | null;
  alisioOrganization: AlisioOrganizationMembershipState | null;
  alisioConnectorsLoading: boolean;
  alisioConnectorsError: string | null;
  alisioConnectorCatalog: AlisioConnectorDefinition[];
  alisioConnectorAuthorizations: AlisioConnectorAuthorization[];
  alisioConnectorSetupGuide: import("./types.ts").AlisioConnectorsBeginResult | null;
  pendingConnectorChatResume: PendingAlisioConnectorChatResume | null;
  alisioConnectorsSearch: string;
  alisioConnectorsCategoryFilter: string;
  alisioOrganizationDraftMode: "create" | "join";
  alisioOrganizationName: string;
  alisioOrganizationInviteEmail: string;
  setupWizardLoading: boolean;
  setupWizardSubmitting: boolean;
  setupWizardSessionId: string | null;
  setupWizardStep: import("./types.ts").WizardStep | null;
  setupWizardStatus: string | null;
  setupWizardError: string | null;
  setupWizardDraftText: string;
  setupWizardDraftConfirm: boolean;
  setupWizardDraftSelectIndex: number;
  setupWizardDraftMultiIndexes: number[];
  setupStep: import("./types.ts").AlisioBootstrapStep | null;
  sessionKey: string;
  chatLoading: boolean;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStreamSegments: Array<{ text: string; ts: number }>;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatRunId: string | null;
  compactionStatus: CompactionStatus | null;
  fallbackStatus: FallbackStatus | null;
  chatAvatarUrl: string | null;
  chatThinkingLevel: string | null;
  chatModelOverrides: Record<string, ChatModelOverride | null>;
  chatModelsLoading: boolean;
  chatModelCatalog: ModelCatalogEntry[];
  modelsExpandedProfileId?: string | null;
  modelsSelectedProviderId?: "openai" | "server" | "local" | null;
  modelsServerDraft?: ModelsServerDraft | null;
  chatQueue: ChatQueueItem[];
  chatManualRefreshInFlight: boolean;
  nodesLoading: boolean;
  nodes: NodeListNode[];
  nodesError: string | null;
  chatNewMessagesBelow: boolean;
  navDrawerOpen: boolean;
  sidebarOpen: boolean;
  sidebarContent: string | null;
  sidebarError: string | null;
  splitRatio: number;
  scrollToBottom: (opts?: { smooth?: boolean }) => void;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
  nodePairingsLoading: boolean;
  nodePairingsError: string | null;
  nodePairingsList: RuntimeNodePairingList | null;
  execApprovalsLoading: boolean;
  execApprovalsSaving: boolean;
  execApprovalsDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: ExecApprovalsFile | null;
  execApprovalsSelectedAgent: string | null;
  execApprovalsTarget: "gateway" | "node";
  execApprovalsTargetNodeId: string | null;
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalBusy: boolean;
  execApprovalError: string | null;
  gatewayAccessModeLoading: boolean;
  gatewayAccessModeBusy: boolean;
  gatewayAccessMode: SecurityAccessMode | null;
  gatewayBootstrapUrl: string | null;
  gatewayBootstrapToken: string | null;
  pendingGatewayUrl: string | null;
  configLoading: boolean;
  configRaw: string;
  configRawOriginal: string;
  configValid: boolean | null;
  configIssues: unknown[];
  configSaving: boolean;
  configApplying: boolean;
  updateRunning: boolean;
  applySessionKey: string;
  configSnapshot: ConfigSnapshot | null;
  configSchema: unknown;
  configSchemaVersion: string | null;
  configSchemaLoading: boolean;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  configFormOriginal: Record<string, unknown> | null;
  configFormMode: "form" | "raw";
  configSearchQuery: string;
  configActiveSection: string | null;
  configActiveSubsection: string | null;
  communicationsFormMode: "form" | "raw";
  communicationsSearchQuery: string;
  communicationsActiveSection: string | null;
  communicationsActiveSubsection: string | null;
  appearanceFormMode: "form" | "raw";
  appearanceSearchQuery: string;
  appearanceActiveSection: string | null;
  appearanceActiveSubsection: string | null;
  automationFormMode: "form" | "raw";
  automationSearchQuery: string;
  automationActiveSection: string | null;
  automationActiveSubsection: string | null;
  infrastructureFormMode: "form" | "raw";
  infrastructureSearchQuery: string;
  infrastructureActiveSection: string | null;
  infrastructureActiveSubsection: string | null;
  aiAgentsFormMode: "form" | "raw";
  aiAgentsSearchQuery: string;
  aiAgentsActiveSection: string | null;
  aiAgentsActiveSubsection: string | null;
  channelsLoading: boolean;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsError: string | null;
  channelsLastSuccess: number | null;
  channelsBusyKey: string | null;
  channelsActionMessage: string | null;
  channelsLoginQrDataUrl: string | null;
  channelsLoginAccountId: string | null;
  channelsSetupLoading?: boolean;
  channelsSetupSubmitting?: boolean;
  channelsSetupSessionId?: string | null;
  channelsSetupStep?: import("./types.ts").WizardStep | null;
  channelsSetupStatus?: string | null;
  channelsSetupError?: string | null;
  channelsSetupDraftText?: string;
  channelsSetupDraftConfirm?: boolean;
  channelsSetupDraftSelectIndex?: number;
  channelsSetupDraftMultiIndexes?: number[];
  channelsSetupChannelId?: string | null;
  configFormDirty: boolean;
  presenceLoading: boolean;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: string | null;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  agentsSelectedId: string | null;
  memorySelectedAgentId: string | null;
  memoryAgentId: string | null;
  memoryLoading: boolean;
  memoryError: string | null;
  memoryList: AgentsFilesListResult | null;
  memoryContents: Record<string, string>;
  memoryDrafts: Record<string, string>;
  memoryActive: string | null;
  memorySaving: boolean;
  memoryDeleting: boolean;
  memorySearchQuery: string;
  memoryComposerOpen: boolean;
  memoryComposerDate: string;
  memoryComposerTitle: string;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
  toolsEffectiveLoading: boolean;
  toolsEffectiveLoadingKey: string | null;
  toolsEffectiveResultKey: string | null;
  toolsEffectiveError: string | null;
  toolsEffectiveResult: import("./types.js").ToolsEffectiveResult | null;
  agentsPanel: "overview" | "files" | "tools" | "skills" | "channels" | "cron";
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileActive: string | null;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsError: string | null;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsAgentId: string | null;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
  sessionsHideCron: boolean;
  sessionsSearchQuery: string;
  sessionsSortColumn: "key" | "kind" | "updated" | "tokens";
  sessionsSortDir: "asc" | "desc";
  sessionsPage: number;
  sessionsPageSize: number;
  sessionsSelectedKeys: Set<string>;
  usageLoading: boolean;
  usageResult: SessionsUsageResult | null;
  usageCostSummary: CostUsageSummary | null;
  usageError: string | null;
  usageStartDate: string;
  usageEndDate: string;
  usageSelectedSessions: string[];
  usageSelectedDays: string[];
  usageSelectedHours: number[];
  usageChartMode: "tokens" | "cost";
  usageDailyChartMode: "total" | "by-type";
  usageTimeSeriesMode: "cumulative" | "per-turn";
  usageTimeSeriesBreakdownMode: "total" | "by-type";
  usageTimeSeries: SessionUsageTimeSeries | null;
  usageTimeSeriesLoading: boolean;
  usageTimeSeriesCursorStart: number | null;
  usageTimeSeriesCursorEnd: number | null;
  usageSessionLogs: SessionLogEntry[] | null;
  usageSessionLogsLoading: boolean;
  usageSessionLogsExpanded: boolean;
  usageQuery: string;
  usageQueryDraft: string;
  usageQueryDebounceTimer: number | null;
  usageSessionSort: "tokens" | "cost" | "recent" | "messages" | "errors";
  usageSessionSortDir: "asc" | "desc";
  usageRecentSessions: string[];
  usageTimeZone: "local" | "utc";
  usageContextExpanded: boolean;
  usageHeaderPinned: boolean;
  usageSessionsTab: "all" | "recent";
  usageVisibleColumns: string[];
  usageLogFilterRoles: import("./views/usage.js").SessionLogRole[];
  usageLogFilterTools: string[];
  usageLogFilterHasTools: boolean;
  usageLogFilterQuery: string;
} & Pick<
  CronState,
  | "cronLoading"
  | "cronJobsLoadingMore"
  | "cronJobs"
  | "cronJobsTotal"
  | "cronJobsHasMore"
  | "cronJobsNextOffset"
  | "cronJobsLimit"
  | "cronJobsQuery"
  | "cronJobsEnabledFilter"
  | "cronJobsScheduleKindFilter"
  | "cronJobsLastStatusFilter"
  | "cronJobsSortBy"
  | "cronJobsSortDir"
  | "cronStatus"
  | "cronError"
  | "cronForm"
  | "cronFieldErrors"
  | "cronEditingJobId"
  | "cronRunsJobId"
  | "cronRunsLoadingMore"
  | "cronRuns"
  | "cronRunsTotal"
  | "cronRunsHasMore"
  | "cronRunsNextOffset"
  | "cronRunsLimit"
  | "cronRunsScope"
  | "cronRunsStatuses"
  | "cronRunsDeliveryStatuses"
  | "cronRunsStatusFilter"
  | "cronRunsQuery"
  | "cronRunsSortDir"
  | "cronBusy"
> &
  Pick<CronModelSuggestionsState, "cronModelSuggestions"> & {
    skillsLoading: boolean;
    skillsReport: SkillStatusReport | null;
    skillsError: string | null;
    skillsFilter: string;
    skillsStatusFilter: "all" | "ready" | "needs-setup" | "disabled";
    skillEdits: Record<string, string>;
    skillMessages: Record<string, SkillMessage>;
    skillsBusyKey: string | null;
    skillsDetailKey: string | null;
    healthLoading: boolean;
    healthResult: HealthSummary | null;
    healthError: string | null;
    debugLoading: boolean;
    debugStatus: StatusSummary | null;
    debugHealth: HealthSummary | null;
    debugModels: ModelCatalogEntry[];
    debugHeartbeat: unknown;
    debugCallMethod: string;
    debugCallParams: string;
    debugCallResult: string | null;
    debugCallError: string | null;
    logsLoading: boolean;
    logsError: string | null;
    logsFile: string | null;
    logsEntries: LogEntry[];
    logsFilterText: string;
    logsLevelFilters: Record<LogLevel, boolean>;
    logsAutoFollow: boolean;
    logsTruncated: boolean;
    logsCursor: number | null;
    logsLastFetchAt: number | null;
    logsLimit: number;
    logsMaxBytes: number;
    logsAtBottom: boolean;
    updateAvailable: import("./types.js").UpdateAvailable | null;
    attentionItems: AttentionItem[];
    paletteOpen: boolean;
    paletteQuery: string;
    paletteActiveIndex: number;
    streamMode: boolean;
    client: GatewayBrowserClient | null;
    refreshSessionsAfterChat: Set<string>;
    connect: () => void;
    setTab: (tab: Tab) => void;
    setTheme: (theme: ThemeName, context?: ThemeTransitionContext) => void;
    setThemeMode: (mode: ThemeMode, context?: ThemeTransitionContext) => void;
    setBorderRadius: (value: number) => void;
    applySettings: (next: UiSettings) => void;
    loadOverview: () => Promise<void>;
    loadAssistantIdentity: () => Promise<void>;
    loadCron: () => Promise<void>;
    handleExecApprovalDecision: (decision: "allow-once" | "allow-always" | "deny") => Promise<void>;
    handleGatewayUrlConfirm: () => void;
    handleGatewayUrlCancel: () => void;
    handleConfigLoad: () => Promise<void>;
    handleConfigSave: () => Promise<void>;
    handleConfigApply: () => Promise<void>;
    handleConfigFormUpdate: (path: string, value: unknown) => void;
    handleConfigFormModeChange: (mode: "form" | "raw") => void;
    handleConfigRawChange: (raw: string) => void;
    handleInstallSkill: (key: string) => Promise<void>;
    handleUpdateSkill: (key: string) => Promise<void>;
    handleToggleSkillEnabled: (key: string, enabled: boolean) => Promise<void>;
    handleUpdateSkillEdit: (key: string, value: string) => void;
    handleSaveSkillApiKey: (key: string, apiKey: string) => Promise<void>;
    handleCronToggle: (jobId: string, enabled: boolean) => Promise<void>;
    handleCronRun: (jobId: string) => Promise<void>;
    handleCronRemove: (jobId: string) => Promise<void>;
    handleCronAdd: () => Promise<void>;
    handleCronRunsLoad: (jobId: string) => Promise<void>;
    handleCronFormUpdate: (path: string, value: unknown) => void;
    handleSessionsLoad: () => Promise<void>;
    handleSessionsPatch: (key: string, patch: unknown) => Promise<void>;
    handleLoadNodes: () => Promise<void>;
    handleLoadPresence: () => Promise<void>;
    handleLoadSkills: () => Promise<void>;
    handleLoadDebug: () => Promise<void>;
    handleLoadLogs: () => Promise<void>;
    handleDebugCall: () => Promise<void>;
    handleRunUpdate: () => Promise<void>;
    setPassword: (next: string) => void;
    setChatMessage: (next: string) => void;
    handleSendChat: (messageOverride?: string, opts?: { restoreDraft?: boolean }) => Promise<void>;
    handleAbortChat: () => Promise<void>;
    removeQueuedMessage: (id: string) => void;
    handleChatScroll: (event: Event) => void;
    resetToolStream: () => void;
    resetChatScroll: () => void;
    exportLogs: (lines: string[], label: string) => void;
    handleLogsScroll: (event: Event) => void;
    handleOpenSidebar: (content: string) => void;
    handleCloseSidebar: () => void;
    handleSplitRatioChange: (ratio: number) => void;
  };
