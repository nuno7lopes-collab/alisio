import type { AlisioApp } from "./app.ts";
import { resolvePreferredMemoryAgentId } from "./controllers/agent-memory.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import { loadDebug } from "./controllers/debug.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadMemoryStatus } from "./controllers/memory-runtime.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadTasksOverview } from "./controllers/tasks.ts";
import type { SessionsListResult } from "./types.ts";

const CHAT_RECOVERY_POLL_INTERVAL_MS = 5_000;

type PollingHost = {
  nodesPollInterval: number | null;
  memoryPollInterval: number | null;
  tasksPollInterval: number | null;
  logsPollInterval: number | null;
  debugPollInterval: number | null;
  chatRecoveryPollInterval: number | null;
  tab: string;
  settingsSection?: string;
  connected?: boolean;
  client?: { request: <T>(method: string, params: Record<string, unknown>) => Promise<T> } | null;
  sessionKey?: string;
  assistantAgentId?: string | null;
  memorySelectedAgentId?: string | null;
  agentsList?: { defaultId?: string | null; agents: Array<{ id: string }> } | null;
  chatRunId?: string | null;
  chatFinalizing?: boolean;
  chatStream?: string | null;
  chatStreamStartedAt?: number | null;
  resetToolStream?: () => void;
};

function shouldPollNodes(host: PollingHost) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return false;
  }
  return host.tab === "connections" || host.tab === "security";
}

export function startNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval != null) {
    return;
  }
  host.nodesPollInterval = window.setInterval(() => {
    if (!shouldPollNodes(host)) {
      return;
    }
    void loadNodes(host as unknown as AlisioApp, { quiet: true });
  }, 5000);
}

export function stopNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval == null) {
    return;
  }
  clearInterval(host.nodesPollInterval);
  host.nodesPollInterval = null;
}

function shouldPollMemory(host: PollingHost) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return false;
  }
  return host.tab === "memory";
}

function shouldPollTasks(host: PollingHost) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return false;
  }
  return host.tab === "tasks";
}

export function startMemoryPolling(host: PollingHost) {
  if (host.memoryPollInterval != null) {
    return;
  }
  host.memoryPollInterval = window.setInterval(() => {
    if (!shouldPollMemory(host)) {
      return;
    }
    const agentId = resolvePreferredMemoryAgentId({
      agentsList: host.agentsList ?? null,
      memorySelectedAgentId: host.memorySelectedAgentId ?? null,
      sessionKey: host.sessionKey,
      assistantAgentId: host.assistantAgentId ?? null,
    });
    if (!agentId) {
      return;
    }
    void loadMemoryStatus(host as unknown as AlisioApp, agentId);
  }, 5000);
}

export function stopMemoryPolling(host: PollingHost) {
  if (host.memoryPollInterval == null) {
    return;
  }
  clearInterval(host.memoryPollInterval);
  host.memoryPollInterval = null;
}

export function startTasksPolling(host: PollingHost) {
  if (host.tasksPollInterval != null) {
    return;
  }
  host.tasksPollInterval = window.setInterval(() => {
    if (!shouldPollTasks(host)) {
      return;
    }
    void loadTasksOverview(host as unknown as AlisioApp, { quiet: true });
  }, 5000);
}

export function stopTasksPolling(host: PollingHost) {
  if (host.tasksPollInterval == null) {
    return;
  }
  clearInterval(host.tasksPollInterval);
  host.tasksPollInterval = null;
}

export function startLogsPolling(host: PollingHost) {
  if (host.logsPollInterval != null) {
    return;
  }
  host.logsPollInterval = window.setInterval(() => {
    if (!(host.tab === "settings" && host.settingsSection === "logs")) {
      return;
    }
    void loadLogs(host as unknown as AlisioApp, { quiet: true });
  }, 2000);
}

export function stopLogsPolling(host: PollingHost) {
  if (host.logsPollInterval == null) {
    return;
  }
  clearInterval(host.logsPollInterval);
  host.logsPollInterval = null;
}

export function startDebugPolling(host: PollingHost) {
  if (host.debugPollInterval != null) {
    return;
  }
  host.debugPollInterval = window.setInterval(() => {
    if (!(host.tab === "settings" && host.settingsSection === "debug")) {
      return;
    }
    void loadDebug(host as unknown as AlisioApp);
  }, 3000);
}

export function stopDebugPolling(host: PollingHost) {
  if (host.debugPollInterval == null) {
    return;
  }
  clearInterval(host.debugPollInterval);
  host.debugPollInterval = null;
}

function shouldPollChatRecovery(host: PollingHost) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return false;
  }
  return Boolean(host.connected && host.client && (host.chatRunId || host.chatFinalizing));
}

function shouldRecoverChatFromSessionState(
  host: Pick<PollingHost, "chatFinalizing" | "chatStreamStartedAt">,
  row: SessionsListResult["sessions"][number] | undefined,
) {
  if (!row) {
    return false;
  }
  if (row.status === "running" && row.endedAt == null) {
    return false;
  }
  if (host.chatFinalizing) {
    return true;
  }
  const localStart = host.chatStreamStartedAt ?? 0;
  if (localStart <= 0) {
    return false;
  }
  const terminalTs = Math.max(row.endedAt ?? 0, row.updatedAt ?? 0);
  return terminalTs >= localStart;
}

async function pollChatRecovery(host: PollingHost) {
  if (!shouldPollChatRecovery(host)) {
    return;
  }
  try {
    const result = await host.client!.request<SessionsListResult | undefined>("sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    const row = result?.sessions.find((entry) => entry.key === host.sessionKey);
    if (!shouldRecoverChatFromSessionState(host, row)) {
      return;
    }
    host.chatRunId = null;
    host.chatFinalizing = false;
    host.chatStream = null;
    host.chatStreamStartedAt = null;
    host.resetToolStream?.();
    await loadChatHistory(host as unknown as AlisioApp, {
      silent: true,
      preserveEphemeral: false,
    });
  } catch {
    // Ignore recovery probes; the next poll or reconnect path can recover state.
  }
}

export function startChatRecoveryPolling(host: PollingHost) {
  if (host.chatRecoveryPollInterval != null) {
    return;
  }
  host.chatRecoveryPollInterval = window.setInterval(() => {
    void pollChatRecovery(host);
  }, CHAT_RECOVERY_POLL_INTERVAL_MS);
}

export function stopChatRecoveryPolling(host: PollingHost) {
  if (host.chatRecoveryPollInterval == null) {
    return;
  }
  clearInterval(host.chatRecoveryPollInterval);
  host.chatRecoveryPollInterval = null;
}
