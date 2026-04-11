import { LitElement } from "lit";
import { state } from "lit/decorators.js";
import { resolveAgentIdFromSessionKey } from "../../../src/routing/session-key.js";
import type { NodeListNode } from "../../../src/shared/node-list-types.js";
import { i18n, I18nController, isSupportedLocale } from "../i18n/index.ts";
import {
  clearAlisioAccountEmailLinkAuthFromUrl,
  emitAlisioAccountAuthSignal,
  refreshAfterAlisioAccountAuth,
  readAlisioAccountEmailLinkAuthResultFromUrl,
  subscribeAlisioAccountAuthSignals,
  type AlisioAccountEmailLinkAuthResult,
} from "./alisio-account-auth.ts";
import {
  clearPendingAlisioConnectorChatResume,
  readPendingAlisioConnectorChatResume,
  refreshAfterAlisioConnectorOAuth,
  subscribeAlisioConnectorOAuthSignals,
  type PendingAlisioConnectorChatResume,
  type AlisioConnectorOAuthSignal,
} from "./alisio-connector-oauth.ts";
import {
  refreshAfterAlisioOpenAiOAuth,
  subscribeAlisioOpenAiOAuthSignals,
} from "./alisio-oauth.ts";
import {
  handleAbortChat as handleAbortChatInternal,
  handleSendChat as handleSendChatInternal,
  removeQueuedMessage as removeQueuedMessageInternal,
} from "./app-chat.ts";
import { DEFAULT_CRON_FORM, DEFAULT_LOG_LEVEL_FILTERS } from "./app-defaults.ts";
import type { EventLogEntry } from "./app-events.ts";
import { connectGateway as connectGatewayInternal } from "./app-gateway.ts";
import {
  handleConnected,
  handleDisconnected,
  handleFirstUpdated,
  handleUpdated,
} from "./app-lifecycle.ts";
import { renderApp } from "./app-render.ts";
import {
  exportLogs as exportLogsInternal,
  handleChatScroll as handleChatScrollInternal,
  handleLogsScroll as handleLogsScrollInternal,
  resetChatScroll as resetChatScrollInternal,
  scheduleChatScroll as scheduleChatScrollInternal,
} from "./app-scroll.ts";
import {
  applySettings as applySettingsInternal,
  loadCron as loadCronInternal,
  loadOverview as loadOverviewInternal,
  setTab as setTabInternal,
  setTheme as setThemeInternal,
  setThemeMode as setThemeModeInternal,
  onPopState as onPopStateInternal,
} from "./app-settings.ts";
import {
  resetToolStream as resetToolStreamInternal,
  type ToolStreamEntry,
  type CompactionStatus,
  type FallbackStatus,
} from "./app-tool-stream.ts";
import type { AppViewState } from "./app-view-state.ts";
import { normalizeAssistantIdentity } from "./assistant-identity.ts";
import { exportChatMarkdown } from "./chat/export.ts";
import {
  loadToolsEffective as loadToolsEffectiveInternal,
  refreshVisibleToolsEffectiveForCurrentSession as refreshVisibleToolsEffectiveForCurrentSessionInternal,
} from "./controllers/agents.ts";
import { completeAlisioAccountEmailLinkAuth } from "./controllers/alisio.ts";
import { loadAssistantIdentity as loadAssistantIdentityInternal } from "./controllers/assistant-identity.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import type { ExecApprovalAuditEntry, ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type { RuntimeNodePairingList } from "./controllers/node-pairing.ts";
import type {
  SecurityAccessDiagnostics,
  SecurityAccessMode,
} from "./controllers/security-access.ts";
import type { SkillMessage } from "./controllers/skills.ts";
import "./alisio-host.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import { todayMemoryDate } from "./memory-files.ts";
import type { ModelProviderId } from "./models-view-types.ts";
import type { ModelsOperationMap } from "./models-view-types.ts";
import type { SettingsSection, Tab } from "./navigation.ts";
import { loadSettings, type UiSettings } from "./storage.ts";
import type { ResolvedTheme, ThemeMode, ThemeName } from "./theme.ts";
import type {
  AgentsListResult,
  AgentsFilesListResult,
  AgentIdentityResult,
  ConfigSnapshot,
  ConfigUiHints,
  ChatModelOverride,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  HealthSummary,
  LogEntry,
  LogLevel,
  ModelCatalogEntry,
  NativeShellState,
  PresenceEntry,
  ChannelsStatusSnapshot,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
  ToolsCatalogResult,
  ToolsEffectiveResult,
} from "./types.ts";
import { type ChatAttachment, type ChatQueueItem, type CronFormState } from "./ui-types.ts";
import { generateUUID } from "./uuid.ts";

declare global {
  interface Window {
    __ALISIO_CONTROL_UI_BASE_PATH__?: string;
    __ALISIO_CONTROL_UI_DEV_GATEWAY_PORT__?: string;
  }
}

const bootAssistantIdentity = normalizeAssistantIdentity({});
const NATIVE_WORKSPACE_READY_EVENT = "alisio-ui-ready";

export class AlisioApp extends LitElement {
  private i18nController = new I18nController(this);
  clientInstanceId = generateUUID();
  connectGeneration = 0;
  @state() settings: UiSettings = loadSettings();
  constructor() {
    super();
    if (isSupportedLocale(this.settings.locale)) {
      void i18n.setLocale(this.settings.locale);
    }
  }
  @state() password = "";
  @state() tab: Tab = "chat";
  @state() settingsSection: SettingsSection = "general";
  @state() connected = false;
  @state() theme: ThemeName = this.settings.theme ?? "claw";
  @state() themeMode: ThemeMode = this.settings.themeMode ?? "system";
  @state() themeResolved: ResolvedTheme = "dark";
  @state() hello: GatewayHelloOk | null = null;
  @state() lastError: string | null = null;
  @state() lastErrorCode: string | null = null;
  @state() eventLog: EventLogEntry[] = [];
  private eventLogBuffer: EventLogEntry[] = [];
  private toolStreamSyncTimer: number | null = null;
  private sidebarCloseTimer: number | null = null;

  @state() assistantName = bootAssistantIdentity.name;
  @state() assistantAvatar = bootAssistantIdentity.avatar;
  @state() assistantAgentId = bootAssistantIdentity.agentId ?? null;
  @state() serverVersion: string | null = null;
  @state() nativeShellLoading = false;
  @state() nativeShellError: string | null = null;
  @state() nativeShellState: NativeShellState | null = null;
  @state() nativeRebuildInFlight = false;
  @state() nativeRebuildStatus: string | null = null;
  @state() nativeRebuildError: string | null = null;
  @state() alisioStartupLoading = false;
  @state() alisioStartupError: string | null = null;
  @state() alisioStartupBootstrap: import("./types.ts").AlisioHttpBootstrap | null = null;
  @state() alisioBootstrapLoading = false;
  @state() alisioBootstrapError: string | null = null;
  @state() alisioBootstrap: import("./types.ts").AlisioBootstrapState | null = null;
  @state() alisioDoctorLoading = false;
  @state() alisioDoctorError: string | null = null;
  @state() alisioDoctor: import("./types.ts").AlisioDoctorSummaryState | null = null;
  @state() alisioModelsLoading = false;
  @state() alisioModelsError: string | null = null;
  @state() alisioModels: import("./types.ts").AlisioModelsState | null = null;
  @state() alisioAccountLoading = false;
  @state() alisioAccountError: string | null = null;
  @state() alisioAccountNotice: string | null = null;
  @state() alisioAccount: import("./types.ts").AlisioAccountState | null = null;
  @state() alisioAuthEmail = "";
  @state() alisioAuthPendingEmail = "";
  @state() alisioAuthCode = "";
  @state() alisioAuthStage: "entry" | "email-code" = "entry";
  @state() alisioPasswordResetRequired = false;
  @state() alisioTermsAccepted = false;
  @state() alisioMarketingOptIn = false;
  @state() alisioBirthdate = "";
  @state() alisioAiLoading = false;
  @state() alisioAiError: string | null = null;
  @state() providerUsageLoading = false;
  @state() providerUsageError: string | null = null;
  @state() providerUsageSummary: import("./types.ts").ProviderUsageSummary | null = null;
  @state() alisioOrganizationLoading = false;
  @state() alisioOrganizationError: string | null = null;
  @state() alisioOrganization: import("./types.ts").AlisioOrganizationMembershipState | null = null;
  @state() alisioSharingLoading = false;
  @state() alisioSharingError: string | null = null;
  @state() alisioSharing: import("./types.ts").AlisioSharingState | null = null;
  @state() alisioProvidersLoading = false;
  @state() alisioProvidersError: string | null = null;
  @state() alisioProviders: import("./types.ts").AlisioProvidersState | null = null;
  @state() alisioConnectorsLoading = false;
  @state() alisioConnectorsError: string | null = null;
  @state() alisioConnectorCatalog: import("./types.ts").AlisioConnectorDefinition[] = [];
  @state() alisioConnectorAuthorizations: import("./types.ts").AlisioConnectorAuthorization[] = [];
  @state() alisioConnectorSetupGuide: import("./types.ts").AlisioConnectorsBeginResult | null =
    null;
  pendingConnectorChatResume: PendingAlisioConnectorChatResume | null = null;
  @state() alisioConnectorsSearch = "";
  @state() alisioConnectorsCategoryFilter = "all";
  @state() alisioOrganizationDraftMode: "create" | "join" = "create";
  @state() alisioOrganizationName = "";
  @state() alisioOrganizationInviteEmail = "";
  @state() setupWizardLoading = false;
  @state() setupWizardSubmitting = false;
  @state() setupWizardSessionId: string | null = null;
  @state() setupWizardStep: import("./types.ts").WizardStep | null = null;
  @state() setupWizardStatus: string | null = null;
  @state() setupWizardError: string | null = null;
  @state() setupWizardDraftText = "";
  @state() setupWizardDraftConfirm = false;
  @state() setupWizardDraftSelectIndex = 0;
  @state() setupWizardDraftMultiIndexes: number[] = [];
  @state() setupStep: import("./types.ts").AlisioBootstrapStep | null = null;

  @state() sessionKey = this.settings.sessionKey;
  @state() chatLoading = false;
  @state() chatSending = false;
  @state() chatMessage = "";
  @state() chatMessages: unknown[] = [];
  @state() chatToolMessages: unknown[] = [];
  @state() chatStreamSegments: Array<{ text: string; ts: number }> = [];
  @state() chatStream: string | null = null;
  @state() chatStreamStartedAt: number | null = null;
  @state() chatRunId: string | null = null;
  @state() chatFinalizing = false;
  @state() compactionStatus: CompactionStatus | null = null;
  @state() fallbackStatus: FallbackStatus | null = null;
  @state() chatAvatarUrl: string | null = null;
  @state() chatThinkingLevel: string | null = null;
  @state() chatModelOverrides: Record<string, ChatModelOverride | null> = {};
  @state() chatModelsLoading = false;
  @state() chatModelCatalog: ModelCatalogEntry[] = [];
  @state() modelManagementLoading = false;
  @state() modelManagementCatalog: ModelCatalogEntry[] = [];
  @state() chatQueue: ChatQueueItem[] = [];
  @state() chatAttachments: ChatAttachment[] = [];
  @state() chatManualRefreshInFlight = false;
  @state() navDrawerOpen = false;
  @state() modelsExpandedProfileId: string | null | undefined = undefined;
  @state() modelsSelectedProviderId: ModelProviderId | null | undefined = undefined;
  @state() alisioModelOperations: ModelsOperationMap = {};

  onSlashAction?: (action: string) => void;

  // Sidebar state for tool output viewing
  @state() sidebarOpen = false;
  @state() sidebarContent: string | null = null;
  @state() sidebarError: string | null = null;
  @state() splitRatio = this.settings.splitRatio;

  @state() nodesLoading = false;
  @state() nodes: NodeListNode[] = [];
  @state() nodesError: string | null = null;
  @state() devicesLoading = false;
  @state() devicesError: string | null = null;
  @state() devicesList: DevicePairingList | null = null;
  @state() nodePairingsLoading = false;
  @state() nodePairingsError: string | null = null;
  @state() nodePairingsList: RuntimeNodePairingList | null = null;
  @state() execApprovalsLoading = false;
  @state() execApprovalsSaving = false;
  @state() execApprovalsDirty = false;
  @state() execApprovalsSnapshot: ExecApprovalsSnapshot | null = null;
  @state() execApprovalsForm: ExecApprovalsFile | null = null;
  @state() execApprovalsSelectedAgent: string | null = null;
  @state() execApprovalsTarget: "gateway" | "node" = "gateway";
  @state() execApprovalsTargetNodeId: string | null = null;
  @state() execApprovalQueue: ExecApprovalRequest[] = [];
  @state() execApprovalAuditTrail: ExecApprovalAuditEntry[] = [];
  @state() execApprovalBusy = false;
  @state() execApprovalError: string | null = null;
  @state() gatewayAccessModeLoading = false;
  @state() gatewayAccessModeBusy = false;
  @state() gatewayAccessMode: SecurityAccessMode | null = null;
  @state() securityAccessDiagnostics: SecurityAccessDiagnostics | null = null;
  @state() gatewayBootstrapUrl: string | null = null;
  @state() gatewayBootstrapToken: string | null = null;
  @state() pendingGatewayUrl: string | null = null;
  pendingGatewayToken: string | null = null;

  @state() configLoading = false;
  @state() configRaw = "{\n}\n";
  @state() configRawOriginal = "";
  @state() configValid: boolean | null = null;
  @state() configIssues: unknown[] = [];
  @state() configSaving = false;
  @state() configApplying = false;
  @state() updateRunning = false;
  @state() applySessionKey = this.settings.lastActiveSessionKey;
  @state() configSnapshot: ConfigSnapshot | null = null;
  @state() configSchema: unknown = null;
  @state() configSchemaVersion: string | null = null;
  @state() configSchemaLoading = false;
  @state() configUiHints: ConfigUiHints = {};
  @state() configForm: Record<string, unknown> | null = null;
  @state() configFormOriginal: Record<string, unknown> | null = null;
  @state() configFormDirty = false;
  @state() configFormMode: "form" | "raw" = "form";
  @state() configSearchQuery = "";
  @state() configActiveSection: string | null = null;
  @state() configActiveSubsection: string | null = null;
  @state() communicationsFormMode: "form" | "raw" = "form";
  @state() communicationsSearchQuery = "";
  @state() communicationsActiveSection: string | null = null;
  @state() communicationsActiveSubsection: string | null = null;
  @state() appearanceFormMode: "form" | "raw" = "form";
  @state() appearanceSearchQuery = "";
  @state() appearanceActiveSection: string | null = null;
  @state() appearanceActiveSubsection: string | null = null;
  @state() automationFormMode: "form" | "raw" = "form";
  @state() automationSearchQuery = "";
  @state() automationActiveSection: string | null = null;
  @state() automationActiveSubsection: string | null = null;
  @state() infrastructureFormMode: "form" | "raw" = "form";
  @state() infrastructureSearchQuery = "";
  @state() infrastructureActiveSection: string | null = null;
  @state() infrastructureActiveSubsection: string | null = null;
  @state() aiAgentsFormMode: "form" | "raw" = "form";
  @state() aiAgentsSearchQuery = "";
  @state() aiAgentsActiveSection: string | null = null;
  @state() aiAgentsActiveSubsection: string | null = null;

  @state() channelsLoading = false;
  @state() channelsSnapshot: ChannelsStatusSnapshot | null = null;
  @state() channelsError: string | null = null;
  @state() channelsLastSuccess: number | null = null;
  @state() channelsBusyKey: string | null = null;
  @state() channelsActionMessage: string | null = null;
  @state() channelsLoginQrDataUrl: string | null = null;
  @state() channelsLoginAccountId: string | null = null;
  @state() channelsSetupLoading = false;
  @state() channelsSetupSubmitting = false;
  @state() channelsSetupSessionId: string | null = null;
  @state() channelsSetupStep: import("./types.ts").WizardStep | null = null;
  @state() channelsSetupStatus: string | null = null;
  @state() channelsSetupError: string | null = null;
  @state() channelsSetupDraftText = "";
  @state() channelsSetupDraftConfirm = false;
  @state() channelsSetupDraftSelectIndex = 0;
  @state() channelsSetupDraftMultiIndexes: number[] = [];
  @state() channelsSetupChannelId: string | null = null;

  @state() presenceLoading = false;
  @state() presenceEntries: PresenceEntry[] = [];
  @state() presenceError: string | null = null;
  @state() presenceStatus: string | null = null;

  @state() agentsLoading = false;
  @state() agentsList: AgentsListResult | null = null;
  @state() agentsError: string | null = null;
  @state() agentsSelectedId: string | null = null;
  @state() memorySelectedAgentId: string | null = null;
  @state() memoryAgentId: string | null = null;
  @state() memoryLoading = false;
  @state() memoryError: string | null = null;
  @state() memoryList: AgentsFilesListResult | null = null;
  @state() memoryContents: Record<string, string> = {};
  @state() memoryDrafts: Record<string, string> = {};
  @state() memoryActive: string | null = null;
  @state() memorySaving = false;
  @state() memoryDeleting = false;
  @state() memoryStatusLoading = false;
  @state() memoryStatusError: string | null = null;
  @state() memoryStatus: import("./types.ts").MemoryStatusState | null = null;
  @state() memorySyncing = false;
  @state() memorySyncAvailable = false;
  @state() memoryGraphLoading = false;
  @state() memoryGraphError: string | null = null;
  @state() memoryGraph: import("./types.ts").MemoryGraphState | null = null;
  @state() memorySearchQuery = "";
  @state() memoryComposerOpen = false;
  @state() memoryComposerDate = todayMemoryDate();
  @state() memoryComposerTitle = "";
  @state() toolsCatalogLoading = false;
  @state() toolsCatalogError: string | null = null;
  @state() toolsCatalogResult: ToolsCatalogResult | null = null;
  @state() toolsEffectiveLoading = false;
  @state() toolsEffectiveLoadingKey: string | null = null;
  @state() toolsEffectiveResultKey: string | null = null;
  @state() toolsEffectiveError: string | null = null;
  @state() toolsEffectiveResult: ToolsEffectiveResult | null = null;
  @state() agentsPanel: "overview" | "files" | "tools" | "skills" | "channels" | "cron" = "files";
  @state() agentFilesLoading = false;
  @state() agentFilesError: string | null = null;
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() agentFileContents: Record<string, string> = {};
  @state() agentFileDrafts: Record<string, string> = {};
  @state() agentFileActive: string | null = null;
  @state() agentFileSaving = false;
  @state() agentIdentityLoading = false;
  @state() agentIdentityError: string | null = null;
  @state() agentIdentityById: Record<string, AgentIdentityResult> = {};
  @state() agentSkillsLoading = false;
  @state() agentSkillsError: string | null = null;
  @state() agentSkillsReport: SkillStatusReport | null = null;
  @state() agentSkillsAgentId: string | null = null;

  @state() sessionsLoading = false;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() sessionsError: string | null = null;
  @state() sessionsFilterActive = "";
  @state() sessionsFilterLimit = "120";
  @state() sessionsIncludeGlobal = true;
  @state() sessionsIncludeUnknown = false;
  @state() sessionsHideCron = true;
  @state() sessionsSearchQuery = "";
  @state() sessionsSortColumn: "key" | "kind" | "updated" | "tokens" = "updated";
  @state() sessionsSortDir: "asc" | "desc" = "desc";
  @state() sessionsPage = 0;
  @state() sessionsPageSize = 25;
  @state() sessionsSelectedKeys: Set<string> = new Set();

  @state() usageLoading = false;
  @state() usageResult: import("./types.js").SessionsUsageResult | null = null;
  @state() usageCostSummary: import("./types.js").CostUsageSummary | null = null;
  @state() usageError: string | null = null;
  @state() usageStartDate = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  @state() usageEndDate = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  @state() usageSelectedSessions: string[] = [];
  @state() usageSelectedDays: string[] = [];
  @state() usageSelectedHours: number[] = [];
  @state() usageChartMode: "tokens" | "cost" = "tokens";
  @state() usageDailyChartMode: "total" | "by-type" = "by-type";
  @state() usageTimeSeriesMode: "cumulative" | "per-turn" = "per-turn";
  @state() usageTimeSeriesBreakdownMode: "total" | "by-type" = "by-type";
  @state() usageTimeSeries: import("./types.js").SessionUsageTimeSeries | null = null;
  @state() usageTimeSeriesLoading = false;
  @state() usageTimeSeriesCursorStart: number | null = null;
  @state() usageTimeSeriesCursorEnd: number | null = null;
  @state() usageSessionLogs: import("./views/usage.js").SessionLogEntry[] | null = null;
  @state() usageSessionLogsLoading = false;
  @state() usageSessionLogsExpanded = false;
  // Applied query (used to filter the already-loaded sessions list client-side).
  @state() usageQuery = "";
  // Draft query text (updates immediately as the user types; applied via debounce or "Search").
  @state() usageQueryDraft = "";
  @state() usageSessionSort: "tokens" | "cost" | "recent" | "messages" | "errors" = "recent";
  @state() usageSessionSortDir: "desc" | "asc" = "desc";
  @state() usageRecentSessions: string[] = [];
  @state() usageTimeZone: "local" | "utc" = "local";
  @state() usageContextExpanded = false;
  @state() usageHeaderPinned = false;
  @state() usageSessionsTab: "all" | "recent" = "all";
  @state() usageVisibleColumns: string[] = [
    "channel",
    "agent",
    "provider",
    "model",
    "messages",
    "tools",
    "errors",
    "duration",
  ];
  @state() usageLogFilterRoles: import("./views/usage.js").SessionLogRole[] = [];
  @state() usageLogFilterTools: string[] = [];
  @state() usageLogFilterHasTools = false;
  @state() usageLogFilterQuery = "";

  // Non-reactive (don’t trigger renders just for timer bookkeeping).
  usageQueryDebounceTimer: number | null = null;

  @state() cronLoading = false;
  @state() cronJobsLoadingMore = false;
  @state() cronJobs: CronJob[] = [];
  @state() cronJobsTotal = 0;
  @state() cronJobsHasMore = false;
  @state() cronJobsNextOffset: number | null = null;
  @state() cronJobsLimit = 50;
  @state() cronJobsQuery = "";
  @state() cronJobsEnabledFilter: import("./types.js").CronJobsEnabledFilter = "all";
  @state() cronJobsScheduleKindFilter: import("./controllers/cron.js").CronJobsScheduleKindFilter =
    "all";
  @state() cronJobsLastStatusFilter: import("./controllers/cron.js").CronJobsLastStatusFilter =
    "all";
  @state() cronJobsSortBy: import("./types.js").CronJobsSortBy = "nextRunAtMs";
  @state() cronJobsSortDir: import("./types.js").CronSortDir = "asc";
  @state() cronStatus: CronStatus | null = null;
  @state() cronError: string | null = null;
  @state() cronForm: CronFormState = { ...DEFAULT_CRON_FORM };
  @state() cronFieldErrors: import("./controllers/cron.js").CronFieldErrors = {};
  @state() cronEditingJobId: string | null = null;
  @state() cronRunsJobId: string | null = null;
  @state() cronRunsLoadingMore = false;
  @state() cronRuns: CronRunLogEntry[] = [];
  @state() cronRunsTotal = 0;
  @state() cronRunsHasMore = false;
  @state() cronRunsNextOffset: number | null = null;
  @state() cronRunsLimit = 50;
  @state() cronRunsScope: import("./types.js").CronRunScope = "all";
  @state() cronRunsStatuses: import("./types.js").CronRunsStatusValue[] = [];
  @state() cronRunsDeliveryStatuses: import("./types.js").CronDeliveryStatus[] = [];
  @state() cronRunsStatusFilter: import("./types.js").CronRunsStatusFilter = "all";
  @state() cronRunsQuery = "";
  @state() cronRunsSortDir: import("./types.js").CronSortDir = "desc";
  @state() cronModelSuggestions: string[] = [];
  @state() cronBusy = false;

  @state() updateAvailable: import("./types.js").UpdateAvailable | null = null;

  // Overview dashboard state
  @state() attentionItems: import("./types.js").AttentionItem[] = [];
  @state() paletteOpen = false;
  @state() paletteQuery = "";
  @state() paletteActiveIndex = 0;

  @state() skillsLoading = false;
  @state() skillsReport: SkillStatusReport | null = null;
  @state() skillsError: string | null = null;
  @state() skillsFilter = "";
  @state() skillsStatusFilter: "all" | "ready" | "needs-setup" | "disabled" = "all";
  @state() skillEdits: Record<string, string> = {};
  @state() skillsBusyKey: string | null = null;
  @state() skillMessages: Record<string, SkillMessage> = {};
  @state() skillActionOutputs: Record<string, import("./controllers/skills.ts").SkillActionOutput> =
    {};
  @state() skillConsentRequest: import("./controllers/skills.ts").SkillConsentRequest | null = null;
  @state() skillsDetailKey: string | null = null;

  @state() healthLoading = false;
  @state() healthResult: HealthSummary | null = null;
  @state() healthError: string | null = null;

  @state() debugLoading = false;
  @state() debugStatus: StatusSummary | null = null;
  @state() debugHealth: HealthSummary | null = null;
  @state() debugModels: ModelCatalogEntry[] = [];
  @state() debugHeartbeat: unknown = null;
  @state() debugCallMethod = "";
  @state() debugCallParams = "{}";
  @state() debugCallResult: string | null = null;
  @state() debugCallError: string | null = null;

  @state() logsLoading = false;
  @state() logsError: string | null = null;
  @state() logsFile: string | null = null;
  @state() logsEntries: LogEntry[] = [];
  @state() logsFilterText = "";
  @state() logsLevelFilters: Record<LogLevel, boolean> = {
    ...DEFAULT_LOG_LEVEL_FILTERS,
  };
  @state() logsAutoFollow = true;
  @state() logsTruncated = false;
  @state() logsCursor: number | null = null;
  @state() logsLastFetchAt: number | null = null;
  @state() logsLimit = 500;
  @state() logsMaxBytes = 250_000;
  @state() logsAtBottom = true;

  client: GatewayBrowserClient | null = null;
  private chatScrollFrame: number | null = null;
  private chatScrollTimeout: number | null = null;
  private chatHasAutoScrolled = false;
  private chatUserNearBottom = true;
  @state() chatNewMessagesBelow = false;
  private nodesPollInterval: number | null = null;
  private logsPollInterval: number | null = null;
  private debugPollInterval: number | null = null;
  private logsScrollFrame: number | null = null;
  private toolStreamById = new Map<string, ToolStreamEntry>();
  private toolStreamOrder: string[] = [];
  refreshSessionsAfterChat = new Set<string>();
  basePath = "";
  private popStateHandler = () =>
    onPopStateInternal(this as unknown as Parameters<typeof onPopStateInternal>[0]);
  private topbarObserver: ResizeObserver | null = null;
  private connectorOAuthCleanup: (() => void) | null = null;
  private connectorOAuthRefreshInFlight = false;
  private accountAuthCleanup: (() => void) | null = null;
  private accountAuthRefreshInFlight = false;
  private pendingAccountEmailLinkAuth: AlisioAccountEmailLinkAuthResult | null = null;
  private accountEmailLinkAuthInFlight = false;
  private openAiOAuthCleanup: (() => void) | null = null;
  private openAiOAuthRefreshInFlight = false;
  private execApprovalTicker: number | null = null;
  private globalKeydownHandler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "k") {
      e.preventDefault();
      this.paletteOpen = !this.paletteOpen;
      if (this.paletteOpen) {
        this.paletteQuery = "";
        this.paletteActiveIndex = 0;
      }
    }
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(NATIVE_WORKSPACE_READY_EVENT));
    }
    if (typeof window !== "undefined") {
      const pendingAccountEmailLinkAuth = readAlisioAccountEmailLinkAuthResultFromUrl(
        window.location.href,
      );
      if (pendingAccountEmailLinkAuth) {
        this.pendingAccountEmailLinkAuth = pendingAccountEmailLinkAuth;
        const cleanedUrl = clearAlisioAccountEmailLinkAuthFromUrl(window.location.href);
        if (cleanedUrl !== window.location.href) {
          window.history.replaceState({}, "", cleanedUrl);
        }
      }
    }
    this.onSlashAction = (action: string) => {
      switch (action) {
        case "toggle-focus":
          this.applySettings({
            ...this.settings,
            chatFocusMode: !this.settings.chatFocusMode,
          });
          break;
        case "export":
          exportChatMarkdown(this.chatMessages, this.assistantName);
          break;
        case "refresh-tools-effective": {
          void refreshVisibleToolsEffectiveForCurrentSessionInternal(this);
          break;
        }
        case "open-security":
          this.setTab("security");
          break;
      }
    };
    document.addEventListener("keydown", this.globalKeydownHandler);
    this.pendingConnectorChatResume = readPendingAlisioConnectorChatResume();
    this.connectorOAuthCleanup = subscribeAlisioConnectorOAuthSignals((signal) => {
      void this.refreshAfterConnectorOAuth(signal);
    });
    this.accountAuthCleanup = subscribeAlisioAccountAuthSignals(() => {
      void this.refreshAfterAccountAuth();
    });
    this.openAiOAuthCleanup = subscribeAlisioOpenAiOAuthSignals(() => {
      void this.refreshAfterOpenAiOAuth();
    });
    handleConnected(this as unknown as Parameters<typeof handleConnected>[0]);
  }

  protected firstUpdated() {
    handleFirstUpdated(this as unknown as Parameters<typeof handleFirstUpdated>[0]);
  }

  disconnectedCallback() {
    document.removeEventListener("keydown", this.globalKeydownHandler);
    this.connectorOAuthCleanup?.();
    this.connectorOAuthCleanup = null;
    this.accountAuthCleanup?.();
    this.accountAuthCleanup = null;
    this.openAiOAuthCleanup?.();
    this.openAiOAuthCleanup = null;
    if (this.execApprovalTicker != null) {
      window.clearInterval(this.execApprovalTicker);
      this.execApprovalTicker = null;
    }
    handleDisconnected(this as unknown as Parameters<typeof handleDisconnected>[0]);
    super.disconnectedCallback();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    handleUpdated(this as unknown as Parameters<typeof handleUpdated>[0], changed);
    if (this.connected && this.pendingAccountEmailLinkAuth) {
      void this.completePendingAccountEmailLinkAuth();
    }
    if (changed.has("execApprovalQueue")) {
      if (this.execApprovalQueue.length > 0 && this.execApprovalTicker == null) {
        this.execApprovalTicker = window.setInterval(() => this.requestUpdate(), 1000);
      }
      if (this.execApprovalQueue.length === 0 && this.execApprovalTicker != null) {
        window.clearInterval(this.execApprovalTicker);
        this.execApprovalTicker = null;
      }
    }
    if (!changed.has("sessionKey") || this.agentsPanel !== "tools") {
      return;
    }
    const activeSessionAgentId = resolveAgentIdFromSessionKey(this.sessionKey);
    if (this.agentsSelectedId && this.agentsSelectedId === activeSessionAgentId) {
      void loadToolsEffectiveInternal(this, {
        agentId: this.agentsSelectedId,
        sessionKey: this.sessionKey,
      });
      return;
    }
    this.toolsEffectiveResult = null;
    this.toolsEffectiveResultKey = null;
    this.toolsEffectiveError = null;
    this.toolsEffectiveLoading = false;
    this.toolsEffectiveLoadingKey = null;
  }

  connect() {
    connectGatewayInternal(this as unknown as Parameters<typeof connectGatewayInternal>[0]);
  }

  private async completePendingAccountEmailLinkAuth() {
    if (this.accountEmailLinkAuthInFlight || !this.pendingAccountEmailLinkAuth) {
      return;
    }
    if (!this.connected || !this.client) {
      return;
    }

    const pending = this.pendingAccountEmailLinkAuth;
    this.accountEmailLinkAuthInFlight = true;
    try {
      this.setTab("setup");
      this.setupStep = "account";
      if (pending.kind === "error") {
        this.alisioAccountError = pending.message;
        this.pendingAccountEmailLinkAuth = null;
        return;
      }

      const completed = await completeAlisioAccountEmailLinkAuth(this, pending);
      this.pendingAccountEmailLinkAuth = null;
      if (completed) {
        emitAlisioAccountAuthSignal();
      }
    } finally {
      this.accountEmailLinkAuthInFlight = false;
    }
  }

  private async refreshAfterOpenAiOAuth() {
    if (this.openAiOAuthRefreshInFlight) {
      return;
    }
    this.openAiOAuthRefreshInFlight = true;
    try {
      await refreshAfterAlisioOpenAiOAuth(
        this as unknown as Parameters<typeof refreshAfterAlisioOpenAiOAuth>[0],
      );
    } catch (error) {
      this.lastError = `OpenAI connection refresh failed: ${String(error)}`;
    } finally {
      this.openAiOAuthRefreshInFlight = false;
    }
  }

  private async refreshAfterAccountAuth() {
    if (this.accountAuthRefreshInFlight) {
      return;
    }
    this.accountAuthRefreshInFlight = true;
    try {
      await refreshAfterAlisioAccountAuth(
        this as unknown as Parameters<typeof refreshAfterAlisioAccountAuth>[0],
      );
    } catch (error) {
      this.lastError = `Account connection refresh failed: ${String(error)}`;
    } finally {
      this.accountAuthRefreshInFlight = false;
    }
  }

  private async refreshAfterConnectorOAuth(signal?: AlisioConnectorOAuthSignal) {
    if (this.connectorOAuthRefreshInFlight) {
      return;
    }
    this.connectorOAuthRefreshInFlight = true;
    try {
      await refreshAfterAlisioConnectorOAuth(
        this as unknown as Parameters<typeof refreshAfterAlisioConnectorOAuth>[0],
      );
      await this.retryPendingConnectorChatResume(signal);
    } catch (error) {
      this.lastError = `Connector connection refresh failed: ${String(error)}`;
    } finally {
      this.connectorOAuthRefreshInFlight = false;
    }
  }

  private async retryPendingConnectorChatResume(signal?: AlisioConnectorOAuthSignal) {
    const pending = this.pendingConnectorChatResume ?? readPendingAlisioConnectorChatResume();
    if (!pending) {
      this.pendingConnectorChatResume = null;
      return;
    }
    if (signal && signal.connectorId !== pending.connectorId) {
      this.pendingConnectorChatResume = pending;
      return;
    }
    const authorization = this.alisioConnectorAuthorizations.find(
      (entry) => entry.connectorId === pending.connectorId,
    );
    if (authorization?.state !== "connected") {
      this.pendingConnectorChatResume = pending;
      return;
    }

    this.pendingConnectorChatResume = null;
    clearPendingAlisioConnectorChatResume();
    if (pending.sessionKey.trim() && pending.sessionKey !== this.sessionKey) {
      this.sessionKey = pending.sessionKey;
      this.applySettings({
        ...this.settings,
        sessionKey: pending.sessionKey,
        lastActiveSessionKey: pending.sessionKey,
      });
    }
    await this.handleSendChat(pending.message, {
      attachments: pending.attachments,
    });
  }

  handleChatScroll(event: Event) {
    handleChatScrollInternal(
      this as unknown as Parameters<typeof handleChatScrollInternal>[0],
      event,
    );
  }

  handleLogsScroll(event: Event) {
    handleLogsScrollInternal(
      this as unknown as Parameters<typeof handleLogsScrollInternal>[0],
      event,
    );
  }

  exportLogs(lines: string[], label: string) {
    exportLogsInternal(lines, label);
  }

  resetToolStream() {
    resetToolStreamInternal(this as unknown as Parameters<typeof resetToolStreamInternal>[0]);
  }

  resetChatScroll() {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
  }

  scrollToBottom(opts?: { smooth?: boolean }) {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
    scheduleChatScrollInternal(
      this as unknown as Parameters<typeof scheduleChatScrollInternal>[0],
      true,
      Boolean(opts?.smooth),
    );
  }

  async loadAssistantIdentity() {
    await loadAssistantIdentityInternal(this);
  }

  applySettings(next: UiSettings) {
    applySettingsInternal(this as unknown as Parameters<typeof applySettingsInternal>[0], next);
  }

  setTab(next: Tab) {
    setTabInternal(this as unknown as Parameters<typeof setTabInternal>[0], next);
    this.navDrawerOpen = false;
  }

  setTheme(next: ThemeName, context?: Parameters<typeof setThemeInternal>[2]) {
    setThemeInternal(this as unknown as Parameters<typeof setThemeInternal>[0], next, context);
  }

  setThemeMode(next: ThemeMode, context?: Parameters<typeof setThemeModeInternal>[2]) {
    setThemeModeInternal(
      this as unknown as Parameters<typeof setThemeModeInternal>[0],
      next,
      context,
    );
  }

  async loadOverview() {
    await loadOverviewInternal(this as unknown as Parameters<typeof loadOverviewInternal>[0]);
  }

  async loadCron() {
    await loadCronInternal(this as unknown as Parameters<typeof loadCronInternal>[0]);
  }

  async handleAbortChat() {
    await handleAbortChatInternal(this as unknown as Parameters<typeof handleAbortChatInternal>[0]);
  }

  removeQueuedMessage(id: string) {
    removeQueuedMessageInternal(
      this as unknown as Parameters<typeof removeQueuedMessageInternal>[0],
      id,
    );
  }

  async handleSendChat(
    messageOverride?: string,
    opts?: Parameters<typeof handleSendChatInternal>[2],
  ) {
    await handleSendChatInternal(
      this as unknown as Parameters<typeof handleSendChatInternal>[0],
      messageOverride,
      opts,
    );
  }

  async handleExecApprovalDecision(decision: "allow-once" | "allow-always" | "deny") {
    const active = this.execApprovalQueue[0];
    if (!active || !this.client || this.execApprovalBusy) {
      return;
    }
    this.execApprovalBusy = true;
    this.execApprovalError = null;
    try {
      const method = active.kind === "plugin" ? "plugin.approval.resolve" : "exec.approval.resolve";
      await this.client.request(method, {
        id: active.id,
        decision,
      });
      this.execApprovalQueue = this.execApprovalQueue.filter((entry) => entry.id !== active.id);
    } catch (err) {
      this.execApprovalError = `Approval failed: ${String(err)}`;
    } finally {
      this.execApprovalBusy = false;
    }
  }

  handleGatewayUrlConfirm() {
    const nextGatewayUrl = this.pendingGatewayUrl;
    if (!nextGatewayUrl) {
      return;
    }
    const nextToken = this.pendingGatewayToken?.trim() || "";
    this.pendingGatewayUrl = null;
    this.pendingGatewayToken = null;
    applySettingsInternal(this as unknown as Parameters<typeof applySettingsInternal>[0], {
      ...this.settings,
      gatewayUrl: nextGatewayUrl,
      token: nextToken,
    });
    this.connect();
  }

  handleGatewayUrlCancel() {
    this.pendingGatewayUrl = null;
    this.pendingGatewayToken = null;
  }

  // Sidebar handlers for tool output viewing
  handleOpenSidebar(content: string) {
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }
    this.sidebarContent = content;
    this.sidebarError = null;
    this.sidebarOpen = true;
  }

  handleCloseSidebar() {
    this.sidebarOpen = false;
    // Clear content after transition
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
    }
    this.sidebarCloseTimer = window.setTimeout(() => {
      if (this.sidebarOpen) {
        return;
      }
      this.sidebarContent = null;
      this.sidebarError = null;
      this.sidebarCloseTimer = null;
    }, 200);
  }

  handleSplitRatioChange(ratio: number) {
    const newRatio = Math.max(0.4, Math.min(0.7, ratio));
    this.splitRatio = newRatio;
    this.applySettings({ ...this.settings, splitRatio: newRatio });
  }

  render() {
    return renderApp(this as unknown as AppViewState);
  }
}

if (typeof customElements !== "undefined" && !customElements.get("alisio-app")) {
  customElements.define("alisio-app", AlisioApp);
}
