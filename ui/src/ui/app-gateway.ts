import {
  GATEWAY_EVENT_ALISIO_MODELS_OPERATION,
  GATEWAY_EVENT_UPDATE_AVAILABLE,
  type GatewayAlisioModelsOperationEventPayload,
  type GatewayUpdateAvailableEventPayload,
} from "../../../src/gateway/events.js";
import { GATEWAY_CLIENT_NAMES } from "../../../src/gateway/protocol/client-info.js";
import { ConnectErrorDetailCodes } from "../../../src/gateway/protocol/connect-error-details.js";
import {
  CHAT_SESSIONS_ACTIVE_MINUTES,
  clearPendingQueueItemsForRun,
  flushChatQueueForEvent,
} from "./app-chat.ts";
import type { EventLogEntry } from "./app-events.ts";
import {
  applySettings,
  loadCron,
  refreshActiveTab,
  setLastActiveSessionKey,
} from "./app-settings.ts";
import { handleAgentEvent, resetToolStream, type AgentEventPayload } from "./app-tool-stream.ts";
import type { AlisioApp } from "./app.ts";
import { shouldReloadHistoryForFinalEvent } from "./chat-event-reload.ts";
import { formatConnectError } from "./connect-error.ts";
import { loadAgents } from "./controllers/agents.ts";
import {
  applyAlisioModelOperation,
  loadAlisioDoctorSummary,
  loadAlisioModels,
  loadAlisioProviderOverview,
  loadAlisioSharing,
} from "./controllers/alisio.ts";
import { loadAssistantIdentity } from "./controllers/assistant-identity.ts";
import { loadChannels } from "./controllers/channels.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import {
  handleChatEvent,
  handleSessionMessageEvent,
  type ChatEventPayload,
  type SessionMessageEventPayload,
} from "./controllers/chat.ts";
import { readComputerSessionEvent } from "./controllers/computer-session.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";
import { loadDevices } from "./controllers/devices.ts";
import type { ExecApprovalAuditEntry, ExecApprovalRequest } from "./controllers/exec-approval.ts";
import {
  addExecApproval,
  addExecApprovalAuditEntry,
  parseApprovalAuditEntry,
  parseExecApprovalRequested,
  parseExecApprovalResolved,
  parsePluginApprovalRequested,
  pruneExecApprovalQueue,
  removeExecApproval,
} from "./controllers/exec-approval.ts";
import { loadHealthState } from "./controllers/health.ts";
import { loadNodePairings } from "./controllers/node-pairing.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { applyRemoteComputerTaskUpdate } from "./controllers/remote-computers.ts";
import {
  loadSessions,
  subscribeSessions,
  syncSessionMessageSubscription,
} from "./controllers/sessions.ts";
import { loadSkills } from "./controllers/skills.ts";
import { loadTasksOverview } from "./controllers/tasks.ts";
import { clearDeviceAuthToken } from "./device-auth.ts";
import {
  clearStoredBrowserDeviceIdentity,
  loadManagedDeviceIdentity,
  loadStoredBrowserDeviceIdentity,
} from "./device-identity.ts";
import {
  isNonRecoverableAuthError,
  resolveGatewayErrorDetailCode,
  type GatewayEventFrame,
  type GatewayHelloOk,
} from "./gateway.ts";
import { GatewayBrowserClient } from "./gateway.ts";
import type { ModelsOperationMap } from "./models-view-types.ts";
import { publicTabFor, type Tab } from "./navigation.ts";
import type { UiSettings } from "./storage.ts";
import type {
  AgentsListResult,
  PresenceEntry,
  HealthSummary,
  StatusSummary,
  UpdateAvailable,
} from "./types.ts";

function isGenericBrowserFetchFailure(message: string): boolean {
  return /^(?:typeerror:\s*)?(?:fetch failed|failed to fetch)$/i.test(message.trim());
}

type GatewayHost = {
  settings: UiSettings;
  password: string;
  gatewayBootstrapUrl: string | null;
  gatewayBootstrapToken: string | null;
  clientInstanceId: string;
  client: GatewayBrowserClient | null;
  connected: boolean;
  hello: GatewayHelloOk | null;
  lastError: string | null;
  lastErrorCode: string | null;
  eventLogBuffer: EventLogEntry[];
  eventLog: EventLogEntry[];
  tab: Tab;
  settingsSection?: import("./navigation.ts").SettingsSection;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: StatusSummary | null;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  healthLoading: boolean;
  healthResult: HealthSummary | null;
  healthError: string | null;
  debugHealth: HealthSummary | null;
  debugHeartbeat?: unknown;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  serverVersion: string | null;
  sessionKey: string;
  chatRunId: string | null;
  chatFinalizing?: boolean;
  refreshSessionsAfterChat: Set<string>;
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalAuditTrail: ExecApprovalAuditEntry[];
  execApprovalError: string | null;
  updateAvailable: UpdateAvailable | null;
  bootstrapDeviceRetryConsumed?: boolean;
  alisioModelOperations: ModelsOperationMap;
  setComputerSession?: (
    sessionKey: string,
    session: import("./types.ts").ComputerSessionState | null,
  ) => void;
  notifyBrowserPaneActivity?: (
    sessionKey: string,
    surface?: import("./controllers/browser-pane.ts").BrowserPaneSurfaceKind,
  ) => void;
  refreshBrowserPaneBrowserState?: (sessionKey: string) => {
    hasActivity: boolean;
    changed: boolean;
  };
};

type HeartbeatEventPayload = {
  ts: number;
  status: "sent" | "ok-empty" | "ok-token" | "skipped" | "failed";
  to?: string;
  preview?: string;
  durationMs?: number;
  hasMedia?: boolean;
  reason?: string;
  channel?: string;
  accountId?: string;
  silent?: boolean;
  indicatorType?: "ok" | "alert" | "error";
};

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
  mainKey?: string;
  mainSessionKey?: string;
  scope?: string;
};

type GatewayHostWithShutdownMessage = GatewayHost & {
  pendingShutdownMessage?: string | null;
  resumeChatQueueAfterReconnect?: boolean;
};

type ConnectGatewayOptions = {
  reason?: "initial" | "seq-gap";
};

const dashboardWarmupTimers = new WeakMap<GatewayHost, number>();
const gatewayHelloWatchdogTimers = new WeakMap<
  GatewayHost,
  ReturnType<typeof globalThis.setTimeout>
>();
const GATEWAY_HELLO_WATCHDOG_MS = 12_000;

export function resolveControlUiClientVersion(params: {
  gatewayUrl: string;
  serverVersion: string | null;
  pageUrl?: string;
}): string | undefined {
  const serverVersion = params.serverVersion?.trim();
  if (!serverVersion) {
    return undefined;
  }
  const pageUrl =
    params.pageUrl ?? (typeof window === "undefined" ? undefined : window.location.href);
  if (!pageUrl) {
    return undefined;
  }
  try {
    const page = new URL(pageUrl);
    const gateway = new URL(params.gatewayUrl, page);
    const allowedProtocols = new Set(["ws:", "wss:", "http:", "https:"]);
    if (!allowedProtocols.has(gateway.protocol) || gateway.host !== page.host) {
      return undefined;
    }
    return serverVersion;
  } catch {
    return undefined;
  }
}

function shouldRetryWithFreshDeviceSession(
  detailCode: string | null,
  _usingAutomaticBootstrap: boolean,
) {
  if (!detailCode) {
    return false;
  }
  return (
    detailCode === ConnectErrorDetailCodes.AUTH_DEVICE_TOKEN_MISMATCH ||
    detailCode === ConnectErrorDetailCodes.DEVICE_AUTH_INVALID ||
    detailCode === ConnectErrorDetailCodes.DEVICE_AUTH_DEVICE_ID_MISMATCH ||
    detailCode === ConnectErrorDetailCodes.DEVICE_AUTH_SIGNATURE_EXPIRED ||
    detailCode === ConnectErrorDetailCodes.DEVICE_AUTH_NONCE_REQUIRED ||
    detailCode === ConnectErrorDetailCodes.DEVICE_AUTH_NONCE_MISMATCH ||
    detailCode === ConnectErrorDetailCodes.DEVICE_AUTH_SIGNATURE_INVALID ||
    detailCode === ConnectErrorDetailCodes.DEVICE_AUTH_PUBLIC_KEY_INVALID
  );
}

function shouldRefreshControlUiBootstrap(
  detailCode: string | null,
  usingAutomaticBootstrap: boolean,
) {
  return (
    usingAutomaticBootstrap && detailCode === ConnectErrorDetailCodes.AUTH_BOOTSTRAP_TOKEN_INVALID
  );
}

async function clearStoredBrowserDeviceAuth() {
  const managedIdentity = await loadManagedDeviceIdentity();
  if (managedIdentity?.deviceId) {
    clearDeviceAuthToken({ deviceId: managedIdentity.deviceId, role: "operator" });
    return;
  }
  const browserIdentity = await loadStoredBrowserDeviceIdentity();
  if (!browserIdentity?.deviceId) {
    return;
  }
  clearDeviceAuthToken({ deviceId: browserIdentity.deviceId, role: "operator" });
  clearStoredBrowserDeviceIdentity();
}

function normalizeSessionKeyForDefaults(
  value: string | undefined,
  defaults: SessionDefaultsSnapshot,
): string {
  const raw = (value ?? "").trim();
  const mainSessionKey = defaults.mainSessionKey?.trim();
  if (!mainSessionKey) {
    return raw;
  }
  if (!raw) {
    return mainSessionKey;
  }
  const mainKey = defaults.mainKey?.trim() || "main";
  const defaultAgentId = defaults.defaultAgentId?.trim();
  const isAlias =
    raw === "main" ||
    raw === mainKey ||
    (defaultAgentId &&
      (raw === `agent:${defaultAgentId}:main` || raw === `agent:${defaultAgentId}:${mainKey}`));
  return isAlias ? mainSessionKey : raw;
}

function resolveTransientGatewayStatusMessage(params: {
  code: number;
  reason: string;
  error?: { message?: string } | undefined;
}): string | null {
  if (params.error?.message) {
    return null;
  }
  const normalizedReason = params.reason.trim().toLowerCase();
  if (params.code === 1012) {
    return "Reconnecting…";
  }
  if (
    normalizedReason.length === 0 ||
    normalizedReason === "connect failed" ||
    normalizedReason === "service restart" ||
    normalizedReason === "tick timeout"
  ) {
    return "Reconnecting…";
  }
  return null;
}

function normalizeUserFacingRuntimeReason(reason: string | null | undefined): string {
  const trimmed = reason?.trim() ?? "";
  if (!trimmed) {
    return "Alisio is stopping";
  }
  const normalized = trimmed.replace(/\bgateway\b/gi, "Alisio");
  if (/^alisio restarting$/i.test(normalized)) {
    return "Alisio is restarting";
  }
  if (/^alisio stopping$/i.test(normalized)) {
    return "Alisio is stopping";
  }
  return normalized;
}

function normalizeUserFacingGatewayCopy(value: string): string {
  return value.replace(/\bgateway\b/gi, "Alisio");
}

function shouldRefreshChatHistoryAfterReconnect(host: GatewayHost): boolean {
  const toolHost = host as unknown as { toolStreamOrder?: unknown[] };
  const chatHost = host as unknown as { chatStream?: string | null };
  return Boolean(
    host.chatRunId ||
    host.chatFinalizing ||
    toolHost.toolStreamOrder?.length ||
    chatHost.chatStream?.trim(),
  );
}

function messageHasStructuredAttachments(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const type = (block as { type?: unknown }).type;
    return type === "image" || type === "image_url" || type === "attachment";
  });
}

function activeRunNeedsCanonicalHistory(host: GatewayHost, runId: string | undefined): boolean {
  if (!runId) {
    return false;
  }
  const messages = (host as unknown as { chatMessages?: unknown[] }).chatMessages;
  if (!Array.isArray(messages)) {
    return false;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const role = typeof record.role === "string" ? record.role.toLowerCase() : "";
    if (role !== "user") {
      continue;
    }
    const idempotencyKey =
      typeof record.idempotencyKey === "string" ? record.idempotencyKey.trim() : "";
    if (idempotencyKey !== runId) {
      continue;
    }
    return messageHasStructuredAttachments(record);
  }
  return false;
}

function readHeartbeatEventPayload(payload: unknown): HeartbeatEventPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.ts !== "number" || !Number.isFinite(record.ts)) {
    return null;
  }
  const status = typeof record.status === "string" ? record.status : "";
  if (
    status !== "sent" &&
    status !== "ok-empty" &&
    status !== "ok-token" &&
    status !== "skipped" &&
    status !== "failed"
  ) {
    return null;
  }
  return {
    ts: record.ts,
    status,
    ...(typeof record.to === "string" ? { to: record.to } : {}),
    ...(typeof record.preview === "string" ? { preview: record.preview } : {}),
    ...(typeof record.durationMs === "number" ? { durationMs: record.durationMs } : {}),
    ...(typeof record.hasMedia === "boolean" ? { hasMedia: record.hasMedia } : {}),
    ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
    ...(typeof record.channel === "string" ? { channel: record.channel } : {}),
    ...(typeof record.accountId === "string" ? { accountId: record.accountId } : {}),
    ...(typeof record.silent === "boolean" ? { silent: record.silent } : {}),
    ...(record.indicatorType === "ok" ||
    record.indicatorType === "alert" ||
    record.indicatorType === "error"
      ? { indicatorType: record.indicatorType }
      : {}),
  };
}

function applySessionDefaults(host: GatewayHost, defaults?: SessionDefaultsSnapshot) {
  if (!defaults?.mainSessionKey) {
    return;
  }
  const resolvedSessionKey = normalizeSessionKeyForDefaults(host.sessionKey, defaults);
  const resolvedSettingsSessionKey = normalizeSessionKeyForDefaults(
    host.settings.sessionKey,
    defaults,
  );
  const resolvedLastActiveSessionKey = normalizeSessionKeyForDefaults(
    host.settings.lastActiveSessionKey,
    defaults,
  );
  const nextSessionKey = resolvedSessionKey || resolvedSettingsSessionKey || host.sessionKey;
  const nextSettings = {
    ...host.settings,
    sessionKey: resolvedSettingsSessionKey || nextSessionKey,
    lastActiveSessionKey: resolvedLastActiveSessionKey || nextSessionKey,
  };
  const shouldUpdateSettings =
    nextSettings.sessionKey !== host.settings.sessionKey ||
    nextSettings.lastActiveSessionKey !== host.settings.lastActiveSessionKey;
  if (nextSessionKey !== host.sessionKey) {
    host.sessionKey = nextSessionKey;
  }
  if (shouldUpdateSettings) {
    applySettings(host as unknown as Parameters<typeof applySettings>[0], nextSettings);
  }
}

function clearDashboardWarmup(host: GatewayHost) {
  if (typeof window === "undefined") {
    return;
  }
  const timer = dashboardWarmupTimers.get(host);
  if (timer == null) {
    return;
  }
  window.clearTimeout(timer);
  dashboardWarmupTimers.delete(host);
}

function scheduleDashboardWarmup(host: GatewayHost, client: GatewayBrowserClient) {
  if (typeof window === "undefined") {
    return;
  }
  clearDashboardWarmup(host);
  const timer = window.setTimeout(() => {
    dashboardWarmupTimers.delete(host);
    if (host.client !== client || !host.connected) {
      return;
    }
    // Keep post-hello warmup cheap. Heavy state like Memory is now loaded only
    // on demand so cold connects do not spiral into reconnect loops.
    void Promise.allSettled([
      loadAlisioProviderOverview(host as unknown as AlisioApp),
      loadChannels(host as unknown as AlisioApp, false),
      loadSkills(host as unknown as AlisioApp),
    ]);
  }, 1_500);
  dashboardWarmupTimers.set(host, timer);
}

function clearGatewayHelloWatchdog(host: GatewayHost) {
  if (
    typeof globalThis.setTimeout !== "function" ||
    typeof globalThis.clearTimeout !== "function"
  ) {
    return;
  }
  const timer = gatewayHelloWatchdogTimers.get(host);
  if (timer == null) {
    return;
  }
  globalThis.clearTimeout(timer);
  gatewayHelloWatchdogTimers.delete(host);
}

function shouldKeepGatewayHelloWatchdog(host: GatewayHost, error?: { details?: unknown }): boolean {
  if (!host.lastError) {
    return true;
  }
  if (
    host.lastError === "Reconnecting…" ||
    host.lastError === "Resyncing live state…" ||
    host.lastError.startsWith("Refreshing ")
  ) {
    return true;
  }
  return !isNonRecoverableAuthError(
    error
      ? {
          code: "CONNECT_CLOSE",
          message: host.lastError,
          details: error.details,
        }
      : undefined,
  );
}

function scheduleGatewayHelloWatchdog(host: GatewayHost, client: GatewayBrowserClient) {
  if (typeof globalThis.setTimeout !== "function") {
    return;
  }
  clearGatewayHelloWatchdog(host);
  const timer = globalThis.setTimeout(() => {
    gatewayHelloWatchdogTimers.delete(host);
    if (host.client !== client || host.connected || host.hello) {
      return;
    }
    host.lastError = "Refreshing Alisio connection…";
    host.lastErrorCode = null;
    connectGateway(host);
  }, GATEWAY_HELLO_WATCHDOG_MS);
  gatewayHelloWatchdogTimers.set(host, timer);
}

export function connectGateway(host: GatewayHost, options?: ConnectGatewayOptions) {
  const shutdownHost = host as GatewayHostWithShutdownMessage;
  const reconnectReason = options?.reason ?? "initial";
  let receivedHello = false;
  let refreshChatHistoryOnReconnect = reconnectReason === "seq-gap";
  const preserveChatVisualStateOnReconnect =
    reconnectReason === "seq-gap" && shouldRefreshChatHistoryAfterReconnect(host);
  shutdownHost.pendingShutdownMessage = null;
  shutdownHost.resumeChatQueueAfterReconnect = false;
  (host as { sessionMessageSubscribedKey?: string | null }).sessionMessageSubscribedKey = null;
  host.lastError = reconnectReason === "seq-gap" ? "Resyncing live state…" : null;
  host.lastErrorCode = null;
  host.hello = null;
  host.connected = false;
  clearDashboardWarmup(host);
  clearGatewayHelloWatchdog(host);
  if (reconnectReason === "seq-gap") {
    // A seq gap means the socket stayed on the same gateway; preserve prompts
    // that only arrived as ephemeral events and clear stale run-scoped indicators.
    host.execApprovalQueue = pruneExecApprovalQueue(host.execApprovalQueue);
    clearPendingQueueItemsForRun(
      host as unknown as Parameters<typeof clearPendingQueueItemsForRun>[0],
      host.chatRunId ?? undefined,
    );
    host.chatRunId = null;
    host.chatFinalizing = false;
    if (!preserveChatVisualStateOnReconnect) {
      (host as unknown as { chatStream: string | null }).chatStream = null;
      (host as unknown as { chatStreamStartedAt: number | null }).chatStreamStartedAt = null;
      resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
    }
    shutdownHost.resumeChatQueueAfterReconnect = true;
  } else {
    host.execApprovalQueue = [];
    host.execApprovalAuditTrail = [];
  }
  host.execApprovalError = null;

  const previousClient = host.client;
  const gatewayUrl = host.gatewayBootstrapUrl?.trim() || host.settings.gatewayUrl;
  const bootstrapToken = host.gatewayBootstrapToken?.trim() || undefined;
  const usingAutomaticBootstrap = Boolean(bootstrapToken);
  if (usingAutomaticBootstrap && host.settings.token.trim()) {
    applySettings(host as unknown as Parameters<typeof applySettings>[0], {
      ...host.settings,
      token: "",
    });
  }
  if (usingAutomaticBootstrap && host.password.trim()) {
    host.password = "";
  }
  const clientVersion = resolveControlUiClientVersion({
    gatewayUrl,
    serverVersion: host.serverVersion,
  });
  const client = new GatewayBrowserClient({
    url: gatewayUrl,
    token: usingAutomaticBootstrap ? undefined : host.settings.token.trim() || undefined,
    bootstrapToken,
    password: usingAutomaticBootstrap ? undefined : host.password.trim() || undefined,
    clientName: GATEWAY_CLIENT_NAMES.CONTROL_UI,
    clientVersion,
    mode: "webchat",
    instanceId: host.clientInstanceId,
    onHello: (hello) => {
      if (host.client !== client) {
        return;
      }
      clearGatewayHelloWatchdog(host);
      const includeChatHistory = !receivedHello || refreshChatHistoryOnReconnect;
      receivedHello = true;
      refreshChatHistoryOnReconnect = false;
      shutdownHost.pendingShutdownMessage = null;
      host.connected = true;
      host.bootstrapDeviceRetryConsumed = false;
      host.lastError = null;
      host.lastErrorCode = null;
      host.hello = hello;
      applySnapshot(host, hello);
      // Reset only if we are not resuming an in-flight run. If the reconnect
      // happened while the current chat was still active, keep ephemeral state
      // until history recovery decides whether to clear it.
      const reconnectInterruptedActiveChat =
        reconnectReason === "seq-gap"
          ? shouldRefreshChatHistoryAfterReconnect(host)
          : Boolean(host.chatRunId || host.chatFinalizing);
      if (!reconnectInterruptedActiveChat) {
        host.chatRunId = null;
        host.chatFinalizing = false;
        (host as unknown as { chatStream: string | null }).chatStream = null;
        (host as unknown as { chatStreamStartedAt: number | null }).chatStreamStartedAt = null;
        resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
      }
      if (shutdownHost.resumeChatQueueAfterReconnect) {
        // The interrupted run will never emit its terminal event now that the
        // old client is gone, so resume any deferred commands after hello.
        shutdownHost.resumeChatQueueAfterReconnect = false;
        void flushChatQueueForEvent(
          host as unknown as Parameters<typeof flushChatQueueForEvent>[0],
        );
      }
      void subscribeSessions(host as unknown as AlisioApp);
      void syncSessionMessageSubscription(host as unknown as AlisioApp);
      void loadAssistantIdentity(host as unknown as AlisioApp);
      void loadAgents(host as unknown as AlisioApp);
      void loadHealthState(host as unknown as AlisioApp);
      const currentTab = publicTabFor(host.tab);
      if (currentTab === "setup" || currentTab === "settings") {
        void (async () => {
          await loadAlisioDoctorSummary(host as unknown as AlisioApp);
          await refreshActiveTab(host as unknown as Parameters<typeof refreshActiveTab>[0], {
            includeChatHistory,
            preloadedShellState: "doctor",
          });
        })();
      } else {
        if (currentTab !== "chat" && currentTab !== "models") {
          void loadAlisioDoctorSummary(host as unknown as AlisioApp);
        }
        void refreshActiveTab(host as unknown as Parameters<typeof refreshActiveTab>[0], {
          includeChatHistory,
        });
      }
      scheduleDashboardWarmup(host, client);
    },
    onClose: ({ code, reason, error }) => {
      if (host.client !== client) {
        return;
      }
      clearDashboardWarmup(host);
      if (receivedHello && host.tab === "chat") {
        refreshChatHistoryOnReconnect ||= shouldRefreshChatHistoryAfterReconnect(host);
      }
      host.connected = false;
      const transientStatus = resolveTransientGatewayStatusMessage({ code, reason, error });
      // Code 1012 = Service Restart (expected during config saves, don't show as error)
      host.lastErrorCode =
        resolveGatewayErrorDetailCode(error) ??
        (typeof error?.code === "string" ? error.code : null);
      if (
        shouldRetryWithFreshDeviceSession(host.lastErrorCode, usingAutomaticBootstrap) &&
        !host.bootstrapDeviceRetryConsumed
      ) {
        clearGatewayHelloWatchdog(host);
        host.bootstrapDeviceRetryConsumed = true;
        host.lastError = "Refreshing secure device session…";
        void clearStoredBrowserDeviceAuth().finally(() => {
          if (host.client !== client) {
            return;
          }
          connectGateway(host);
        });
        return;
      }
      if (
        shouldRefreshControlUiBootstrap(host.lastErrorCode, usingAutomaticBootstrap) &&
        host.gatewayBootstrapToken?.trim()
      ) {
        clearGatewayHelloWatchdog(host);
        host.lastError = "Refreshing Alisio connection…";
        void loadControlUiBootstrapConfig(
          host as unknown as Parameters<typeof loadControlUiBootstrapConfig>[0],
        ).finally(() => {
          if (host.client !== client) {
            return;
          }
          connectGateway(host);
        });
        return;
      }
      if (code !== 1012) {
        if (error?.message) {
          const normalized = error.message.trim().toLowerCase();
          const shouldFormatError =
            isGenericBrowserFetchFailure(error.message) ||
            normalized.startsWith("unauthorized:") ||
            normalized.startsWith("invalid connect params") ||
            normalized.includes("connection token") ||
            normalized.includes("connection auth") ||
            normalized.includes("gateway auth") ||
            normalized.includes("device signature") ||
            normalized.includes("device auth") ||
            normalized.includes("bootstrap token");
          host.lastError = shouldFormatError
            ? formatConnectError({
                message: error.message,
                details: error.details,
                code: error.code,
              } as Parameters<typeof formatConnectError>[0])
            : normalizeUserFacingGatewayCopy(error.message);
          return;
        }
        host.lastError =
          shutdownHost.pendingShutdownMessage ??
          transientStatus ??
          `disconnected (${code}): ${reason || "no reason"}`;
      } else {
        host.lastError = shutdownHost.pendingShutdownMessage ?? transientStatus ?? null;
        host.lastErrorCode = null;
      }
      if (!shouldKeepGatewayHelloWatchdog(host, error)) {
        clearGatewayHelloWatchdog(host);
      }
    },
    onEvent: (evt) => {
      if (host.client !== client) {
        return;
      }
      handleGatewayEvent(host, evt);
    },
    onGap: ({ expected, received }) => {
      if (host.client !== client) {
        return;
      }
      void expected;
      void received;
      host.lastError = "Resyncing live state…";
      host.lastErrorCode = null;
      connectGateway(host, { reason: "seq-gap" });
    },
  });
  host.client = client;
  previousClient?.stop();
  client.start();
  scheduleGatewayHelloWatchdog(host, client);
}

export function handleGatewayEvent(host: GatewayHost, evt: GatewayEventFrame) {
  try {
    handleGatewayEventUnsafe(host, evt);
  } catch (err) {
    console.error("[gateway] handleGatewayEvent error:", evt.event, err);
  }
}

function handleTerminalChatEvent(
  host: GatewayHost,
  payload: ChatEventPayload | undefined,
  state: ReturnType<typeof handleChatEvent>,
  opts: { isActiveRun: boolean; hadBufferedAssistantStream: boolean },
): boolean {
  if (state !== "final" && state !== "error" && state !== "aborted") {
    return false;
  }
  // Check if tool events were seen before resetting (resetToolStream clears toolStreamOrder).
  const toolHost = host as unknown as Parameters<typeof resetToolStream>[0];
  const hadToolEvents = toolHost.toolStreamOrder.length > 0;
  clearPendingQueueItemsForRun(
    host as unknown as Parameters<typeof clearPendingQueueItemsForRun>[0],
    payload?.runId,
  );
  const runId = payload?.runId;
  if (runId && host.refreshSessionsAfterChat.has(runId)) {
    host.refreshSessionsAfterChat.delete(runId);
    if (state === "final") {
      void loadSessions(host as unknown as AlisioApp, {
        activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
      });
    }
  }
  const needsCanonicalHistoryForAttachments =
    opts.isActiveRun && activeRunNeedsCanonicalHistory(host, runId);
  const hasBufferedAssistantStream =
    opts.isActiveRun &&
    !needsCanonicalHistoryForAttachments &&
    !hadToolEvents &&
    state === "final" &&
    shouldReloadHistoryForFinalEvent(payload) &&
    opts.hadBufferedAssistantStream;
  const shouldRefreshHistory =
    state === "final" &&
    !hasBufferedAssistantStream &&
    ((opts.isActiveRun && hadToolEvents) ||
      needsCanonicalHistoryForAttachments ||
      shouldReloadHistoryForFinalEvent(payload));
  if (shouldRefreshHistory) {
    const preserveEphemeral = !opts.isActiveRun && Boolean(host.chatRunId || host.chatFinalizing);
    if (!preserveEphemeral) {
      host.chatFinalizing = true;
    }
    const toolHostForReload = host as unknown as Parameters<typeof resetToolStream>[0];
    let historyCommitted = false;
    void loadChatHistory(host as unknown as AlisioApp, {
      silent: true,
      preserveEphemeral,
    })
      .then(() => {
        historyCommitted = true;
      })
      .finally(() => {
        if (!preserveEphemeral) {
          host.chatFinalizing = false;
          if (!historyCommitted) {
            resetToolStream(toolHostForReload);
          }
        }
        void flushChatQueueForEvent(
          host as unknown as Parameters<typeof flushChatQueueForEvent>[0],
        );
      });
    return true;
  }
  if (opts.isActiveRun) {
    host.chatFinalizing = false;
  }
  resetToolStream(toolHost);
  void flushChatQueueForEvent(host as unknown as Parameters<typeof flushChatQueueForEvent>[0]);
  return false;
}

function shouldDeferFinalChatCommit(
  host: GatewayHost,
  payload: ChatEventPayload | undefined,
): boolean {
  if (!payload || payload.state !== "final" || !payload.runId || payload.runId !== host.chatRunId) {
    return false;
  }
  const toolHost = host as unknown as Parameters<typeof resetToolStream>[0];
  const hadToolEvents = toolHost.toolStreamOrder.length > 0;
  const needsCanonicalHistoryForAttachments = activeRunNeedsCanonicalHistory(host, payload.runId);
  if (
    !hadToolEvents &&
    !needsCanonicalHistoryForAttachments &&
    shouldReloadHistoryForFinalEvent(payload) &&
    Boolean((host as unknown as { chatStream?: string | null }).chatStream?.trim())
  ) {
    return false;
  }
  return (
    hadToolEvents ||
    needsCanonicalHistoryForAttachments ||
    shouldReloadHistoryForFinalEvent(payload)
  );
}

function deferFinalChatCommit(host: GatewayHost, payload: ChatEventPayload): void {
  clearPendingQueueItemsForRun(
    host as unknown as Parameters<typeof clearPendingQueueItemsForRun>[0],
    payload.runId,
  );
  if (host.refreshSessionsAfterChat.has(payload.runId)) {
    host.refreshSessionsAfterChat.delete(payload.runId);
    void loadSessions(host as unknown as AlisioApp, {
      activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
    });
  }
  // Keep the final tool trace visible until the canonical history snapshot lands.
  host.chatRunId = null;
  (host as unknown as { chatStream: string | null }).chatStream = null;
  (host as unknown as { chatStreamStartedAt: number | null }).chatStreamStartedAt = null;
  host.chatFinalizing = true;
  const toolHost = host as unknown as Parameters<typeof resetToolStream>[0];
  let historyCommitted = false;
  void loadChatHistory(host as unknown as AlisioApp, {
    silent: true,
    preserveEphemeral: false,
  })
    .then(() => {
      historyCommitted = true;
    })
    .finally(() => {
      host.chatFinalizing = false;
      if (!historyCommitted) {
        resetToolStream(toolHost);
      }
      void flushChatQueueForEvent(host as unknown as Parameters<typeof flushChatQueueForEvent>[0]);
    });
}

function handleChatGatewayEvent(host: GatewayHost, payload: ChatEventPayload | undefined) {
  const isActiveRun = Boolean(payload?.runId && payload.runId === host.chatRunId);
  const hadBufferedAssistantStream =
    isActiveRun && Boolean((host as unknown as { chatStream?: string | null }).chatStream?.trim());
  if (payload?.sessionKey) {
    setLastActiveSessionKey(
      host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
      payload.sessionKey,
    );
  }
  if (shouldDeferFinalChatCommit(host, payload)) {
    deferFinalChatCommit(host, payload!);
    return;
  }
  const state = handleChatEvent(host as unknown as AlisioApp, payload);
  const historyReloaded = handleTerminalChatEvent(host, payload, state, {
    isActiveRun,
    hadBufferedAssistantStream,
  });
  if (historyReloaded) {
    return;
  }
}

function applyComputerSessionUpdate(host: GatewayHost, payload: unknown): void {
  const sessionUpdate = readComputerSessionEvent(payload);
  if (!sessionUpdate) {
    return;
  }
  host.setComputerSession?.(sessionUpdate.sessionKey, sessionUpdate.session);
}

function readTranscriptHistoryResyncSessionKey(host: GatewayHost, payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const event = payload as Record<string, unknown>;
  const sessionKey = typeof event.sessionKey === "string" ? event.sessionKey.trim() : "";
  if (!sessionKey || sessionKey !== host.sessionKey) {
    return null;
  }
  const phase = typeof event.phase === "string" ? event.phase.trim().toLowerCase() : "";
  return phase === "transcript" ? sessionKey : null;
}

function readComputerPaneActivitySessionKey(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const event = payload as Record<string, unknown>;
  if (event.stream !== "tool") {
    return null;
  }
  const data =
    event.data && typeof event.data === "object"
      ? (event.data as Record<string, unknown>)
      : undefined;
  const toolName = typeof data?.name === "string" ? data.name.trim().toLowerCase() : "";
  if (toolName !== "computer") {
    return null;
  }
  const sessionKey = typeof event.sessionKey === "string" ? event.sessionKey.trim() : "";
  return sessionKey || null;
}

function readBrowserPaneActivitySessionKey(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const event = payload as Record<string, unknown>;
  if (event.stream !== "tool") {
    return null;
  }
  const data =
    event.data && typeof event.data === "object"
      ? (event.data as Record<string, unknown>)
      : undefined;
  const toolName = typeof data?.name === "string" ? data.name.trim().toLowerCase() : "";
  if (!toolName.includes("browser")) {
    return null;
  }
  const sessionKey = typeof event.sessionKey === "string" ? event.sessionKey.trim() : "";
  return sessionKey || null;
}

function handleGatewayEventUnsafe(host: GatewayHost, evt: GatewayEventFrame) {
  host.eventLogBuffer = [
    { ts: Date.now(), event: evt.event, payload: evt.payload },
    ...host.eventLogBuffer,
  ].slice(0, 250);
  if (host.tab === "settings" && host.settingsSection === "debug") {
    host.eventLog = host.eventLogBuffer;
  }
  applyComputerSessionUpdate(host, evt.payload);

  if (evt.event === "agent") {
    const computerPaneActivitySessionKey = readComputerPaneActivitySessionKey(evt.payload);
    const browserPaneActivitySessionKey = readBrowserPaneActivitySessionKey(evt.payload);
    if (computerPaneActivitySessionKey) {
      host.notifyBrowserPaneActivity?.(computerPaneActivitySessionKey, "computer");
    }
    if (browserPaneActivitySessionKey) {
      host.notifyBrowserPaneActivity?.(browserPaneActivitySessionKey, "preview");
    }
    handleAgentEvent(
      host as unknown as Parameters<typeof handleAgentEvent>[0],
      evt.payload as AgentEventPayload | undefined,
    );
    if (browserPaneActivitySessionKey) {
      host.refreshBrowserPaneBrowserState?.(browserPaneActivitySessionKey);
    }
    return;
  }

  if (evt.event === "chat") {
    handleChatGatewayEvent(host, evt.payload as ChatEventPayload | undefined);
    return;
  }

  if (evt.event === "session.message") {
    handleSessionMessageEvent(
      host as unknown as AlisioApp,
      evt.payload as SessionMessageEventPayload,
    );
    return;
  }

  if (evt.event === "presence") {
    const payload = evt.payload as { presence?: PresenceEntry[] } | undefined;
    if (payload?.presence && Array.isArray(payload.presence)) {
      host.presenceEntries = payload.presence;
      host.presenceError = null;
      host.presenceStatus = null;
    }
    return;
  }

  if (evt.event === "heartbeat") {
    const payload = readHeartbeatEventPayload(evt.payload);
    if (!payload) {
      return;
    }
    host.debugHeartbeat = payload;
    const intervalMs =
      typeof host.healthResult?.heartbeatSeconds === "number" &&
      host.healthResult.heartbeatSeconds > 0
        ? host.healthResult.heartbeatSeconds * 1000
        : 0;
    const nextHeartbeatDueAtMs = intervalMs > 0 ? payload.ts + intervalMs : null;
    if (host.healthResult) {
      host.healthResult = {
        ...host.healthResult,
        nextHeartbeatDueAtMs,
      };
    }
    if (host.debugHealth) {
      host.debugHealth = {
        ...host.debugHealth,
        nextHeartbeatDueAtMs,
      };
    }
    return;
  }

  if (evt.event === "shutdown") {
    const payload = evt.payload as { reason?: unknown; restartExpectedMs?: unknown } | undefined;
    const reason = normalizeUserFacingRuntimeReason(
      payload && typeof payload.reason === "string" ? payload.reason : null,
    );
    const shutdownMessage =
      typeof payload?.restartExpectedMs === "number"
        ? `Restarting: ${reason}`
        : `Disconnected: ${reason}`;
    (host as GatewayHostWithShutdownMessage).pendingShutdownMessage = shutdownMessage;
    host.lastError = shutdownMessage;
    host.lastErrorCode = null;
    return;
  }

  if (evt.event === "sessions.changed") {
    const transcriptHistoryResyncSessionKey = readTranscriptHistoryResyncSessionKey(
      host,
      evt.payload,
    );
    if (transcriptHistoryResyncSessionKey) {
      void loadChatHistory(host as unknown as AlisioApp, {
        silent: true,
        preserveEphemeral: Boolean(host.chatRunId || host.chatFinalizing),
      });
    }
    void Promise.allSettled([
      loadSessions(host as unknown as AlisioApp),
      loadTasksOverview(host as unknown as AlisioApp, { quiet: true }),
    ]);
    return;
  }

  if (evt.event === "tasks.proposal.changed") {
    void loadTasksOverview(host as unknown as AlisioApp, { quiet: true });
    return;
  }

  if (evt.event === GATEWAY_EVENT_ALISIO_MODELS_OPERATION) {
    const payload = evt.payload as GatewayAlisioModelsOperationEventPayload | undefined;
    if (
      payload?.targetId?.trim() &&
      payload?.modelId?.trim() &&
      (payload.action === "install" || payload.action === "uninstall") &&
      (payload.phase === "started" ||
        payload.phase === "running" ||
        payload.phase === "completed" ||
        payload.phase === "failed")
    ) {
      applyAlisioModelOperation(host as unknown as AlisioApp, payload);
      if (payload.phase === "completed" || payload.phase === "failed") {
        void loadAlisioModels(host as unknown as AlisioApp);
      }
    }
    return;
  }

  if (evt.event === "cron") {
    void loadCron(host as unknown as Parameters<typeof loadCron>[0]);
  }

  if (evt.event === "device.pair.requested") {
    void loadDevices(host as unknown as AlisioApp, { quiet: true });
    return;
  }

  if (evt.event === "device.pair.resolved") {
    void Promise.allSettled([
      loadDevices(host as unknown as AlisioApp, { quiet: true }),
      loadAlisioSharing(host as unknown as AlisioApp, { quiet: true }),
    ]);
    return;
  }

  if (evt.event === "node.pair.requested") {
    void loadNodePairings(host as unknown as AlisioApp, { quiet: true });
    return;
  }

  if (evt.event === "node.pair.resolved") {
    void Promise.allSettled([
      loadNodePairings(host as unknown as AlisioApp, { quiet: true }),
      loadNodes(host as unknown as AlisioApp, { quiet: true }),
      loadAlisioSharing(host as unknown as AlisioApp, { quiet: true }),
    ]);
    return;
  }

  if (evt.event === "node.task.updated") {
    applyRemoteComputerTaskUpdate(host as unknown as AlisioApp, evt.payload);
    return;
  }

  if (evt.event === "devices.changed") {
    void loadAlisioSharing(host as unknown as AlisioApp, { quiet: true });
    if (publicTabFor(host.tab) === "models") {
      void loadAlisioModels(host as unknown as AlisioApp);
    }
    return;
  }

  if (evt.event === "exec.approval.requested") {
    const entry = parseExecApprovalRequested(evt.payload);
    if (entry) {
      host.execApprovalQueue = addExecApproval(host.execApprovalQueue, entry);
      host.execApprovalError = null;
      const delay = Math.max(0, entry.expiresAtMs - Date.now() + 500);
      window.setTimeout(() => {
        host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, entry.id);
      }, delay);
    }
    return;
  }

  if (evt.event === "exec.approval.resolved") {
    const resolved = parseExecApprovalResolved(evt.payload);
    if (resolved) {
      host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, resolved.id);
      const audit = parseApprovalAuditEntry("exec", evt.payload);
      if (audit) {
        host.execApprovalAuditTrail = addExecApprovalAuditEntry(host.execApprovalAuditTrail, audit);
      }
    }
    return;
  }

  if (evt.event === "plugin.approval.requested") {
    const entry = parsePluginApprovalRequested(evt.payload);
    if (entry) {
      host.execApprovalQueue = addExecApproval(host.execApprovalQueue, entry);
      host.execApprovalError = null;
      const delay = Math.max(0, entry.expiresAtMs - Date.now() + 500);
      window.setTimeout(() => {
        host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, entry.id);
      }, delay);
    }
    return;
  }

  if (evt.event === "plugin.approval.resolved") {
    const resolved = parseExecApprovalResolved(evt.payload);
    if (resolved) {
      host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, resolved.id);
      const audit = parseApprovalAuditEntry("plugin", evt.payload);
      if (audit) {
        host.execApprovalAuditTrail = addExecApprovalAuditEntry(host.execApprovalAuditTrail, audit);
      }
    }
    return;
  }

  if (evt.event === GATEWAY_EVENT_UPDATE_AVAILABLE) {
    const payload = evt.payload as GatewayUpdateAvailableEventPayload | undefined;
    host.updateAvailable = payload?.updateAvailable ?? null;
  }
}

export function applySnapshot(host: GatewayHost, hello: GatewayHelloOk) {
  const snapshot = hello.snapshot as
    | {
        presence?: PresenceEntry[];
        health?: HealthSummary;
        sessionDefaults?: SessionDefaultsSnapshot;
        updateAvailable?: UpdateAvailable;
      }
    | undefined;
  if (snapshot?.presence && Array.isArray(snapshot.presence)) {
    host.presenceEntries = snapshot.presence;
  }
  if (snapshot?.health) {
    host.debugHealth = snapshot.health;
    host.healthResult = snapshot.health;
  }
  if (snapshot?.sessionDefaults) {
    applySessionDefaults(host, snapshot.sessionDefaults);
  }
  host.updateAvailable = snapshot?.updateAvailable ?? null;
}
