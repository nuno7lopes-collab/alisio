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
} from "./controllers/alisio.ts";
import { loadAssistantIdentity } from "./controllers/assistant-identity.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import { handleChatEvent, type ChatEventPayload } from "./controllers/chat.ts";
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
import { loadSessions, subscribeSessions } from "./controllers/sessions.ts";
import { clearDeviceAuthToken } from "./device-auth.ts";
import { loadOrCreateDeviceIdentity } from "./device-identity.ts";
import {
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
  usingAutomaticBootstrap: boolean,
) {
  if (!usingAutomaticBootstrap || !detailCode) {
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
  const identity = await loadOrCreateDeviceIdentity().catch(() => null);
  if (!identity?.deviceId) {
    return;
  }
  clearDeviceAuthToken({ deviceId: identity.deviceId, role: "operator" });
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

export function connectGateway(host: GatewayHost, options?: ConnectGatewayOptions) {
  const shutdownHost = host as GatewayHostWithShutdownMessage;
  const reconnectReason = options?.reason ?? "initial";
  let receivedHello = false;
  let refreshChatHistoryOnReconnect = reconnectReason === "seq-gap";
  shutdownHost.pendingShutdownMessage = null;
  shutdownHost.resumeChatQueueAfterReconnect = false;
  host.lastError = reconnectReason === "seq-gap" ? "Resyncing live state…" : null;
  host.lastErrorCode = null;
  host.hello = null;
  host.connected = false;
  if (reconnectReason === "seq-gap") {
    // A seq gap means the socket stayed on the same gateway; preserve prompts
    // that only arrived as ephemeral events and clear stale run-scoped indicators.
    host.execApprovalQueue = pruneExecApprovalQueue(host.execApprovalQueue);
    clearPendingQueueItemsForRun(
      host as unknown as Parameters<typeof clearPendingQueueItemsForRun>[0],
      host.chatRunId ?? undefined,
    );
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
      // Reset orphaned chat run state from before disconnect.
      // Any in-flight run's final event was lost during the disconnect window.
      host.chatRunId = null;
      host.chatFinalizing = false;
      (host as unknown as { chatStream: string | null }).chatStream = null;
      (host as unknown as { chatStreamStartedAt: number | null }).chatStreamStartedAt = null;
      resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
      if (shutdownHost.resumeChatQueueAfterReconnect) {
        // The interrupted run will never emit its terminal event now that the
        // old client is gone, so resume any deferred commands after hello.
        shutdownHost.resumeChatQueueAfterReconnect = false;
        void flushChatQueueForEvent(
          host as unknown as Parameters<typeof flushChatQueueForEvent>[0],
        );
      }
      void subscribeSessions(host as unknown as AlisioApp);
      void loadAssistantIdentity(host as unknown as AlisioApp);
      void loadAgents(host as unknown as AlisioApp);
      void loadHealthState(host as unknown as AlisioApp);
      void loadNodes(host as unknown as AlisioApp, { quiet: true });
      void loadDevices(host as unknown as AlisioApp, { quiet: true });
      void loadNodePairings(host as unknown as AlisioApp, { quiet: true });
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
    },
    onClose: ({ code, reason, error }) => {
      if (host.client !== client) {
        return;
      }
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
  opts: { isActiveRun: boolean },
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
  const shouldRefreshHistory =
    state === "final" &&
    ((opts.isActiveRun && hadToolEvents) || shouldReloadHistoryForFinalEvent(payload));
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
  return hadToolEvents || shouldReloadHistoryForFinalEvent(payload);
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
  const historyReloaded = handleTerminalChatEvent(host, payload, state, { isActiveRun });
  if (historyReloaded) {
    return;
  }
}

function handleGatewayEventUnsafe(host: GatewayHost, evt: GatewayEventFrame) {
  host.eventLogBuffer = [
    { ts: Date.now(), event: evt.event, payload: evt.payload },
    ...host.eventLogBuffer,
  ].slice(0, 250);
  if (host.tab === "settings" && host.settingsSection === "debug") {
    host.eventLog = host.eventLogBuffer;
  }

  if (evt.event === "agent") {
    handleAgentEvent(
      host as unknown as Parameters<typeof handleAgentEvent>[0],
      evt.payload as AgentEventPayload | undefined,
    );
    return;
  }

  if (evt.event === "chat") {
    handleChatGatewayEvent(host, evt.payload as ChatEventPayload | undefined);
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
    void loadSessions(host as unknown as AlisioApp);
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

  if (evt.event === "device.pair.requested" || evt.event === "device.pair.resolved") {
    void loadDevices(host as unknown as AlisioApp, { quiet: true });
  }

  if (evt.event === "node.pair.requested") {
    void loadNodePairings(host as unknown as AlisioApp, { quiet: true });
    return;
  }

  if (evt.event === "node.pair.resolved") {
    void Promise.allSettled([
      loadNodePairings(host as unknown as AlisioApp, { quiet: true }),
      loadNodes(host as unknown as AlisioApp, { quiet: true }),
    ]);
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
