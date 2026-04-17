import { DEFAULT_HEARTBEAT_ACK_MAX_CHARS, stripHeartbeatToken } from "../auto-reply/heartbeat.js";
import { normalizeVerboseLevel } from "../auto-reply/thinking.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { loadConfig } from "../config/config.js";
import { type AgentEventPayload, getAgentRunContext } from "../infra/agent-events.js";
import { resolveHeartbeatVisibility } from "../infra/heartbeat-visibility.js";
import { getTaskExecutionByRunId, recordTaskExecutionStep } from "../tasks/task-service.js";
import { stripInlineDirectiveTagsForDisplay } from "../utils/directive-tags.js";
import {
  deriveGatewaySessionLifecycleSnapshot,
  persistGatewaySessionLifecycleEvent,
} from "./session-lifecycle-state.js";
import { loadGatewaySessionRow, loadSessionEntry } from "./session-utils.js";
import { formatForLog } from "./ws-log.js";

function resolveHeartbeatAckMaxChars(): number {
  try {
    const cfg = loadConfig();
    return Math.max(
      0,
      cfg.agents?.defaults?.heartbeat?.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
    );
  } catch {
    return DEFAULT_HEARTBEAT_ACK_MAX_CHARS;
  }
}

function resolveHeartbeatContext(runId: string, sourceRunId?: string) {
  const primary = getAgentRunContext(runId);
  if (primary?.isHeartbeat) {
    return primary;
  }
  if (sourceRunId && sourceRunId !== runId) {
    const source = getAgentRunContext(sourceRunId);
    if (source?.isHeartbeat) {
      return source;
    }
  }
  return primary;
}

/**
 * Check if heartbeat ACK/noise should be hidden from interactive chat surfaces.
 */
function shouldHideHeartbeatChatOutput(runId: string, sourceRunId?: string): boolean {
  const runContext = resolveHeartbeatContext(runId, sourceRunId);
  if (!runContext?.isHeartbeat) {
    return false;
  }

  try {
    const cfg = loadConfig();
    const visibility = resolveHeartbeatVisibility({ cfg, channel: "webchat" });
    return !visibility.showOk;
  } catch {
    // Default to suppressing if we can't load config
    return true;
  }
}

function normalizeHeartbeatChatFinalText(params: {
  runId: string;
  sourceRunId?: string;
  text: string;
}): { suppress: boolean; text: string } {
  if (!shouldHideHeartbeatChatOutput(params.runId, params.sourceRunId)) {
    return { suppress: false, text: params.text };
  }

  const stripped = stripHeartbeatToken(params.text, {
    mode: "heartbeat",
    maxAckChars: resolveHeartbeatAckMaxChars(),
  });
  if (!stripped.didStrip) {
    return { suppress: false, text: params.text };
  }
  if (stripped.shouldSkip) {
    return { suppress: true, text: "" };
  }
  return { suppress: false, text: stripped.text };
}

function isSilentReplyLeadFragment(text: string): boolean {
  const normalized = text.trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  if (!/^[A-Z_]+$/.test(normalized)) {
    return false;
  }
  if (normalized === SILENT_REPLY_TOKEN) {
    return false;
  }
  return SILENT_REPLY_TOKEN.startsWith(normalized);
}

function appendUniqueSuffix(base: string, suffix: string): string {
  if (!suffix) {
    return base;
  }
  if (!base) {
    return suffix;
  }
  if (base.endsWith(suffix)) {
    return base;
  }
  const maxOverlap = Math.min(base.length, suffix.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (base.slice(-overlap) === suffix.slice(0, overlap)) {
      return base + suffix.slice(overlap);
    }
  }
  return base + suffix;
}

function trimTaskTraceText(value: unknown, maxLength = 240): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.slice(0, maxLength);
}

function normalizeTaskToolStep(evt: AgentEventPayload) {
  if (evt.stream !== "tool") {
    return null;
  }
  const execution = getTaskExecutionByRunId(evt.runId);
  if (!execution) {
    return null;
  }
  const data =
    evt.data && typeof evt.data === "object" && !Array.isArray(evt.data)
      ? (evt.data)
      : {};
  const phase = typeof data.phase === "string" ? data.phase : "result";
  const toolName = trimTaskTraceText(data.name, 120);
  if (!toolName) {
    return null;
  }
  const args =
    data.args && typeof data.args === "object" && !Array.isArray(data.args)
      ? (data.args as Record<string, unknown>)
      : {};
  const path =
    trimTaskTraceText(args.path) ??
    trimTaskTraceText(args.file) ??
    trimTaskTraceText(args.targetPath) ??
    trimTaskTraceText(args.destinationPath);
  const command = trimTaskTraceText(args.command) ?? trimTaskTraceText(args.cmd);
  const url = trimTaskTraceText(args.url) ?? trimTaskTraceText(args.href);
  const query = trimTaskTraceText(args.query) ?? trimTaskTraceText(args.pattern);
  const lowerName = toolName.toLowerCase();
  const browserTool =
    lowerName.includes("browser") ||
    lowerName.includes("page") ||
    lowerName.includes("tab") ||
    lowerName.includes("navigate") ||
    lowerName.includes("goto");
  const browserSnapshotTool =
    browserTool &&
    (lowerName.includes("snapshot") ||
      lowerName.includes("screenshot") ||
      lowerName.includes("capture"));
  const writeTool =
    lowerName === "edit" ||
    lowerName === "write" ||
    lowerName === "create" ||
    lowerName === "rename" ||
    lowerName === "apply_patch";
  const searchTool =
    lowerName === "search" ||
    lowerName === "grep" ||
    lowerName === "rg" ||
    lowerName === "find";
  const isStart = phase === "start";
  const isError = phase === "error";

  let kind:
    | "command_started"
    | "command_finished"
    | "file_read"
    | "file_written"
    | "search_performed"
    | "browser_navigated"
    | "browser_snapshot"
    | "tool_called"
    | "tool_result";
  if (lowerName === "exec" || lowerName === "command") {
    kind = isStart ? "command_started" : "command_finished";
  } else if (writeTool) {
    kind = "file_written";
  } else if (lowerName === "read" || lowerName === "view" || lowerName === "cat") {
    kind = "file_read";
  } else if (searchTool) {
    kind = "search_performed";
  } else if (browserSnapshotTool) {
    kind = "browser_snapshot";
  } else if (browserTool) {
    kind = "browser_navigated";
  } else {
    kind = isStart ? "tool_called" : "tool_result";
  }
  if (
    phase !== "start" &&
    phase !== "error" &&
    kind !== "command_finished" &&
    kind !== "tool_result"
  ) {
    return null;
  }

  const summary =
    trimTaskTraceText(data.summary) ??
    command ??
    path ??
    url ??
    query ??
    toolName;

  return {
    taskId: execution.taskId,
    executionId: execution.executionId,
    kind,
    status: isError
      ? "failed"
      : isStart
        ? kind === "file_read" || kind === "file_written" || kind === "search_performed"
          ? "info"
          : "running"
        : "succeeded",
    tool: toolName,
    summary,
    dataJson: JSON.stringify({
      toolCallId: trimTaskTraceText(data.toolCallId, 120),
      phase,
      kind: execution.kind,
      runId: execution.runId,
      sessionKey: execution.sessionKey,
      command,
      path,
      url,
      query,
    }),
    createdAt: evt.ts,
  } as const;
}

function recordTaskToolStep(evt: AgentEventPayload) {
  const step = normalizeTaskToolStep(evt);
  if (!step) {
    return;
  }
  try {
    recordTaskExecutionStep(step);
  } catch {
    // Tool delivery must stay live even if the task trace store fails.
  }
}

function resolveMergedAssistantText(params: {
  previousText: string;
  nextText: string;
  nextDelta: string;
}) {
  const { previousText, nextText, nextDelta } = params;
  if (nextText && previousText) {
    if (nextText.startsWith(previousText)) {
      return nextText;
    }
    if (previousText.startsWith(nextText) && !nextDelta) {
      return previousText;
    }
  }
  if (nextDelta) {
    return appendUniqueSuffix(previousText, nextDelta);
  }
  if (nextText) {
    return nextText;
  }
  return previousText;
}

export type ChatRunEntry = {
  sessionKey: string;
  clientRunId: string;
};

export type ChatRunRegistry = {
  add: (sessionId: string, entry: ChatRunEntry) => void;
  peek: (sessionId: string) => ChatRunEntry | undefined;
  shift: (sessionId: string) => ChatRunEntry | undefined;
  remove: (sessionId: string, clientRunId: string, sessionKey?: string) => ChatRunEntry | undefined;
  clear: () => void;
};

export function createChatRunRegistry(): ChatRunRegistry {
  const chatRunSessions = new Map<string, ChatRunEntry[]>();

  const add = (sessionId: string, entry: ChatRunEntry) => {
    const queue = chatRunSessions.get(sessionId);
    if (queue) {
      queue.push(entry);
    } else {
      chatRunSessions.set(sessionId, [entry]);
    }
  };

  const peek = (sessionId: string) => chatRunSessions.get(sessionId)?.[0];

  const shift = (sessionId: string) => {
    const queue = chatRunSessions.get(sessionId);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const entry = queue.shift();
    if (!queue.length) {
      chatRunSessions.delete(sessionId);
    }
    return entry;
  };

  const remove = (sessionId: string, clientRunId: string, sessionKey?: string) => {
    const queue = chatRunSessions.get(sessionId);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const idx = queue.findIndex(
      (entry) =>
        entry.clientRunId === clientRunId && (sessionKey ? entry.sessionKey === sessionKey : true),
    );
    if (idx < 0) {
      return undefined;
    }
    const [entry] = queue.splice(idx, 1);
    if (!queue.length) {
      chatRunSessions.delete(sessionId);
    }
    return entry;
  };

  const clear = () => {
    chatRunSessions.clear();
  };

  return { add, peek, shift, remove, clear };
}

export type ChatRunState = {
  registry: ChatRunRegistry;
  buffers: Map<string, string>;
  deltaSentAt: Map<string, number>;
  /** Length of text at the time of the last broadcast, used to avoid duplicate flushes. */
  deltaLastBroadcastLen: Map<string, number>;
  abortedRuns: Map<string, number>;
  pendingErrors: Map<
    string,
    {
      sourceRunId: string;
      sessionKey?: string;
      seq: number;
      ts: number;
      error?: unknown;
      timer: NodeJS.Timeout;
    }
  >;
  clear: () => void;
};

const CHAT_RUN_ERROR_RETRY_GRACE_MS = 15_000;

export function createChatRunState(): ChatRunState {
  const registry = createChatRunRegistry();
  const buffers = new Map<string, string>();
  const deltaSentAt = new Map<string, number>();
  const deltaLastBroadcastLen = new Map<string, number>();
  const abortedRuns = new Map<string, number>();
  const pendingErrors = new Map<
    string,
    {
      sourceRunId: string;
      sessionKey?: string;
      seq: number;
      ts: number;
      error?: unknown;
      timer: NodeJS.Timeout;
    }
  >();

  const clear = () => {
    for (const pending of pendingErrors.values()) {
      clearTimeout(pending.timer);
    }
    registry.clear();
    buffers.clear();
    deltaSentAt.clear();
    deltaLastBroadcastLen.clear();
    abortedRuns.clear();
    pendingErrors.clear();
  };

  return {
    registry,
    buffers,
    deltaSentAt,
    deltaLastBroadcastLen,
    abortedRuns,
    pendingErrors,
    clear,
  };
}

export type ToolEventRecipientRegistry = {
  add: (runId: string, connId: string) => void;
  get: (runId: string) => ReadonlySet<string> | undefined;
  markFinal: (runId: string) => void;
};

export type SessionEventSubscriberRegistry = {
  subscribe: (connId: string) => void;
  unsubscribe: (connId: string) => void;
  getAll: () => ReadonlySet<string>;
  clear: () => void;
};

export type SessionMessageSubscriberRegistry = {
  subscribe: (connId: string, sessionKey: string) => void;
  unsubscribe: (connId: string, sessionKey: string) => void;
  unsubscribeAll: (connId: string) => void;
  get: (sessionKey: string) => ReadonlySet<string>;
  clear: () => void;
};

type ToolRecipientEntry = {
  connIds: Set<string>;
  updatedAt: number;
  finalizedAt?: number;
};

const TOOL_EVENT_RECIPIENT_TTL_MS = 10 * 60 * 1000;
const TOOL_EVENT_RECIPIENT_FINAL_GRACE_MS = 30 * 1000;

export function createSessionEventSubscriberRegistry(): SessionEventSubscriberRegistry {
  const connIds = new Set<string>();
  const empty = new Set<string>();

  return {
    subscribe: (connId: string) => {
      const normalized = connId.trim();
      if (!normalized) {
        return;
      }
      connIds.add(normalized);
    },
    unsubscribe: (connId: string) => {
      const normalized = connId.trim();
      if (!normalized) {
        return;
      }
      connIds.delete(normalized);
    },
    getAll: () => (connIds.size > 0 ? connIds : empty),
    clear: () => {
      connIds.clear();
    },
  };
}

export function createSessionMessageSubscriberRegistry(): SessionMessageSubscriberRegistry {
  const sessionToConnIds = new Map<string, Set<string>>();
  const connToSessionKeys = new Map<string, Set<string>>();
  const empty = new Set<string>();

  const normalize = (value: string): string => value.trim();

  return {
    subscribe: (connId: string, sessionKey: string) => {
      const normalizedConnId = normalize(connId);
      const normalizedSessionKey = normalize(sessionKey);
      if (!normalizedConnId || !normalizedSessionKey) {
        return;
      }
      const connIds = sessionToConnIds.get(normalizedSessionKey) ?? new Set<string>();
      connIds.add(normalizedConnId);
      sessionToConnIds.set(normalizedSessionKey, connIds);

      const sessionKeys = connToSessionKeys.get(normalizedConnId) ?? new Set<string>();
      sessionKeys.add(normalizedSessionKey);
      connToSessionKeys.set(normalizedConnId, sessionKeys);
    },
    unsubscribe: (connId: string, sessionKey: string) => {
      const normalizedConnId = normalize(connId);
      const normalizedSessionKey = normalize(sessionKey);
      if (!normalizedConnId || !normalizedSessionKey) {
        return;
      }
      const connIds = sessionToConnIds.get(normalizedSessionKey);
      if (connIds) {
        connIds.delete(normalizedConnId);
        if (connIds.size === 0) {
          sessionToConnIds.delete(normalizedSessionKey);
        }
      }
      const sessionKeys = connToSessionKeys.get(normalizedConnId);
      if (sessionKeys) {
        sessionKeys.delete(normalizedSessionKey);
        if (sessionKeys.size === 0) {
          connToSessionKeys.delete(normalizedConnId);
        }
      }
    },
    unsubscribeAll: (connId: string) => {
      const normalizedConnId = normalize(connId);
      if (!normalizedConnId) {
        return;
      }
      const sessionKeys = connToSessionKeys.get(normalizedConnId);
      if (!sessionKeys) {
        return;
      }
      for (const sessionKey of sessionKeys) {
        const connIds = sessionToConnIds.get(sessionKey);
        if (!connIds) {
          continue;
        }
        connIds.delete(normalizedConnId);
        if (connIds.size === 0) {
          sessionToConnIds.delete(sessionKey);
        }
      }
      connToSessionKeys.delete(normalizedConnId);
    },
    get: (sessionKey: string) => {
      const normalizedSessionKey = normalize(sessionKey);
      if (!normalizedSessionKey) {
        return empty;
      }
      return sessionToConnIds.get(normalizedSessionKey) ?? empty;
    },
    clear: () => {
      sessionToConnIds.clear();
      connToSessionKeys.clear();
    },
  };
}

export function createToolEventRecipientRegistry(): ToolEventRecipientRegistry {
  const recipients = new Map<string, ToolRecipientEntry>();

  const prune = () => {
    if (recipients.size === 0) {
      return;
    }
    const now = Date.now();
    for (const [runId, entry] of recipients) {
      const cutoff = entry.finalizedAt
        ? entry.finalizedAt + TOOL_EVENT_RECIPIENT_FINAL_GRACE_MS
        : entry.updatedAt + TOOL_EVENT_RECIPIENT_TTL_MS;
      if (now >= cutoff) {
        recipients.delete(runId);
      }
    }
  };

  const add = (runId: string, connId: string) => {
    if (!runId || !connId) {
      return;
    }
    const now = Date.now();
    const existing = recipients.get(runId);
    if (existing) {
      existing.connIds.add(connId);
      existing.updatedAt = now;
    } else {
      recipients.set(runId, {
        connIds: new Set([connId]),
        updatedAt: now,
      });
    }
    prune();
  };

  const get = (runId: string) => {
    const entry = recipients.get(runId);
    if (!entry) {
      return undefined;
    }
    entry.updatedAt = Date.now();
    prune();
    return entry.connIds;
  };

  const markFinal = (runId: string) => {
    const entry = recipients.get(runId);
    if (!entry) {
      return;
    }
    entry.finalizedAt = Date.now();
    prune();
  };

  return { add, get, markFinal };
}

export type ChatEventBroadcast = (
  event: string,
  payload: unknown,
  opts?: { dropIfSlow?: boolean },
) => void;

export type NodeSendToSession = (sessionKey: string, event: string, payload: unknown) => void;

export type AgentEventHandlerOptions = {
  broadcast: ChatEventBroadcast;
  broadcastToConnIds: (
    event: string,
    payload: unknown,
    connIds: ReadonlySet<string>,
    opts?: { dropIfSlow?: boolean },
  ) => void;
  nodeSendToSession: NodeSendToSession;
  agentRunSeq: Map<string, number>;
  chatRunState: ChatRunState;
  resolveSessionKeyForRun: (runId: string) => string | undefined;
  clearAgentRunContext: (runId: string) => void;
  toolEventRecipients: ToolEventRecipientRegistry;
  sessionEventSubscribers: SessionEventSubscriberRegistry;
};

export function createAgentEventHandler({
  broadcast,
  broadcastToConnIds,
  nodeSendToSession,
  agentRunSeq,
  chatRunState,
  resolveSessionKeyForRun,
  clearAgentRunContext,
  toolEventRecipients,
  sessionEventSubscribers,
}: AgentEventHandlerOptions) {
  const buildSessionEventSnapshot = (sessionKey: string, evt?: AgentEventPayload) => {
    const row = loadGatewaySessionRow(sessionKey);
    const lifecyclePatch = evt
      ? deriveGatewaySessionLifecycleSnapshot({
          session: row
            ? {
                updatedAt: row.updatedAt ?? undefined,
                status: row.status,
                startedAt: row.startedAt,
                endedAt: row.endedAt,
                runtimeMs: row.runtimeMs,
                abortedLastRun: row.abortedLastRun,
              }
            : undefined,
          event: evt,
        })
      : {};
    const session = row ? { ...row, ...lifecyclePatch } : undefined;
    const snapshotSource = session ?? lifecyclePatch;
    return {
      ...(session ? { session } : {}),
      updatedAt: snapshotSource.updatedAt,
      sessionId: row?.sessionId,
      kind: row?.kind,
      channel: row?.channel,
      subject: row?.subject,
      groupChannel: row?.groupChannel,
      space: row?.space,
      chatType: row?.chatType,
      origin: row?.origin,
      spawnedBy: row?.spawnedBy,
      spawnedWorkspaceDir: row?.spawnedWorkspaceDir,
      forkedFromParent: row?.forkedFromParent,
      spawnDepth: row?.spawnDepth,
      subagentRole: row?.subagentRole,
      subagentControlScope: row?.subagentControlScope,
      label: row?.label,
      displayName: row?.displayName,
      observer: row?.observer,
      deliveryContext: row?.deliveryContext,
      parentSessionKey: row?.parentSessionKey,
      childSessions: row?.childSessions,
      thinkingLevel: row?.thinkingLevel,
      fastMode: row?.fastMode,
      verboseLevel: row?.verboseLevel,
      reasoningLevel: row?.reasoningLevel,
      elevatedLevel: row?.elevatedLevel,
      sendPolicy: row?.sendPolicy,
      systemSent: row?.systemSent,
      inputTokens: row?.inputTokens,
      outputTokens: row?.outputTokens,
      lastChannel: row?.lastChannel,
      lastTo: row?.lastTo,
      lastAccountId: row?.lastAccountId,
      lastThreadId: row?.lastThreadId,
      totalTokens: row?.totalTokens,
      totalTokensFresh: row?.totalTokensFresh,
      contextTokens: row?.contextTokens,
      estimatedCostUsd: row?.estimatedCostUsd,
      responseUsage: row?.responseUsage,
      modelProvider: row?.modelProvider,
      model: row?.model,
      status: snapshotSource.status,
      startedAt: snapshotSource.startedAt,
      endedAt: snapshotSource.endedAt,
      runtimeMs: snapshotSource.runtimeMs,
      abortedLastRun: snapshotSource.abortedLastRun,
    };
  };

  const clearPendingLifecycleError = (clientRunId: string) => {
    const pending = chatRunState.pendingErrors.get(clientRunId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    chatRunState.pendingErrors.delete(clientRunId);
  };

  const commitPendingLifecycleError = (clientRunId: string) => {
    const pending = chatRunState.pendingErrors.get(clientRunId);
    if (!pending) {
      return;
    }
    chatRunState.pendingErrors.delete(clientRunId);
    const resolvedSessionKey =
      pending.sessionKey ?? resolveSessionKeyForRun(pending.sourceRunId) ?? "";
    if (resolvedSessionKey) {
      emitChatFinal(
        resolvedSessionKey,
        clientRunId,
        pending.sourceRunId,
        pending.seq,
        "error",
        pending.error,
      );
    }
    if (resolvedSessionKey) {
      const errorEvent: AgentEventPayload = {
        runId: pending.sourceRunId,
        seq: pending.seq,
        stream: "lifecycle",
        ts: pending.ts,
        sessionKey: resolvedSessionKey,
        data: {
          phase: "error",
          ...(pending.error !== undefined ? { error: pending.error } : {}),
        },
      };
      void persistGatewaySessionLifecycleEvent({
        sessionKey: resolvedSessionKey,
        event: errorEvent,
      }).catch(() => undefined);
      const sessionEventConnIds = sessionEventSubscribers.getAll();
      if (sessionEventConnIds.size > 0) {
        broadcastToConnIds(
          "sessions.changed",
          {
            sessionKey: resolvedSessionKey,
            phase: "error",
            runId: pending.sourceRunId,
            ts: pending.ts,
            ...buildSessionEventSnapshot(resolvedSessionKey, errorEvent),
          },
          sessionEventConnIds,
          { dropIfSlow: true },
        );
      }
    }
    toolEventRecipients.markFinal(pending.sourceRunId);
    clearAgentRunContext(pending.sourceRunId);
    agentRunSeq.delete(pending.sourceRunId);
    agentRunSeq.delete(clientRunId);
    chatRunState.registry.remove(pending.sourceRunId, clientRunId, resolvedSessionKey);
  };

  const schedulePendingLifecycleError = (params: {
    clientRunId: string;
    sourceRunId: string;
    sessionKey?: string;
    seq: number;
    ts: number;
    error?: unknown;
  }) => {
    clearPendingLifecycleError(params.clientRunId);
    const timer = setTimeout(() => {
      commitPendingLifecycleError(params.clientRunId);
    }, CHAT_RUN_ERROR_RETRY_GRACE_MS);
    timer.unref?.();
    chatRunState.pendingErrors.set(params.clientRunId, { ...params, timer });
  };

  const emitChatDelta = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
    text: string,
    delta?: unknown,
  ) => {
    const cleanedText = stripInlineDirectiveTagsForDisplay(text).text;
    const cleanedDelta =
      typeof delta === "string" ? stripInlineDirectiveTagsForDisplay(delta).text : "";
    const previousText = chatRunState.buffers.get(clientRunId) ?? "";
    const mergedText = resolveMergedAssistantText({
      previousText,
      nextText: cleanedText,
      nextDelta: cleanedDelta,
    });
    if (!mergedText) {
      return;
    }
    chatRunState.buffers.set(clientRunId, mergedText);
    if (isSilentReplyText(mergedText, SILENT_REPLY_TOKEN)) {
      return;
    }
    if (isSilentReplyLeadFragment(mergedText)) {
      return;
    }
    if (shouldHideHeartbeatChatOutput(clientRunId, sourceRunId)) {
      return;
    }
    const now = Date.now();
    const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
    if (now - last < 150) {
      return;
    }
    chatRunState.deltaSentAt.set(clientRunId, now);
    chatRunState.deltaLastBroadcastLen.set(clientRunId, mergedText.length);
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "delta" as const,
      message: {
        role: "assistant",
        content: [{ type: "text", text: mergedText }],
        timestamp: now,
      },
    };
    broadcast("chat", payload, { dropIfSlow: true });
    nodeSendToSession(sessionKey, "chat", payload);
  };

  const resolveBufferedChatTextState = (clientRunId: string, sourceRunId: string) => {
    const bufferedText = stripInlineDirectiveTagsForDisplay(
      chatRunState.buffers.get(clientRunId) ?? "",
    ).text.trim();
    const normalizedHeartbeatText = normalizeHeartbeatChatFinalText({
      runId: clientRunId,
      sourceRunId,
      text: bufferedText,
    });
    const text = normalizedHeartbeatText.text.trim();
    const shouldSuppressSilent =
      normalizedHeartbeatText.suppress || isSilentReplyText(text, SILENT_REPLY_TOKEN);
    return { text, shouldSuppressSilent };
  };

  const flushBufferedChatDeltaIfNeeded = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
  ) => {
    const { text, shouldSuppressSilent } = resolveBufferedChatTextState(clientRunId, sourceRunId);
    const shouldSuppressSilentLeadFragment = isSilentReplyLeadFragment(text);
    const shouldSuppressHeartbeatStreaming = shouldHideHeartbeatChatOutput(
      clientRunId,
      sourceRunId,
    );
    if (
      !text ||
      shouldSuppressSilent ||
      shouldSuppressSilentLeadFragment ||
      shouldSuppressHeartbeatStreaming
    ) {
      return;
    }

    const lastBroadcastLen = chatRunState.deltaLastBroadcastLen.get(clientRunId) ?? 0;
    if (text.length <= lastBroadcastLen) {
      return;
    }

    const now = Date.now();
    const flushPayload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "delta" as const,
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        timestamp: now,
      },
    };
    broadcast("chat", flushPayload, { dropIfSlow: true });
    nodeSendToSession(sessionKey, "chat", flushPayload);
    chatRunState.deltaLastBroadcastLen.set(clientRunId, text.length);
    chatRunState.deltaSentAt.set(clientRunId, now);
  };

  const emitChatFinal = (
    sessionKey: string,
    clientRunId: string,
    sourceRunId: string,
    seq: number,
    jobState: "done" | "error",
    error?: unknown,
    stopReason?: string,
  ) => {
    const { text, shouldSuppressSilent } = resolveBufferedChatTextState(clientRunId, sourceRunId);
    // Flush any throttled delta so streaming clients receive the complete text
    // before the final event. The 150 ms throttle in emitChatDelta may have
    // suppressed the most recent chunk, leaving the client with stale text.
    // Only flush if the buffer has grown since the last broadcast to avoid duplicates.
    flushBufferedChatDeltaIfNeeded(sessionKey, clientRunId, sourceRunId, seq);
    chatRunState.deltaLastBroadcastLen.delete(clientRunId);
    chatRunState.buffers.delete(clientRunId);
    chatRunState.deltaSentAt.delete(clientRunId);
    if (jobState === "done") {
      const payload = {
        runId: clientRunId,
        sessionKey,
        seq,
        state: "final" as const,
        ...(stopReason && { stopReason }),
        message:
          text && !shouldSuppressSilent
            ? {
                role: "assistant",
                content: [{ type: "text", text }],
                timestamp: Date.now(),
              }
            : undefined,
      };
      broadcast("chat", payload);
      nodeSendToSession(sessionKey, "chat", payload);
      return;
    }
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "error" as const,
      errorMessage: error ? formatForLog(error) : undefined,
    };
    broadcast("chat", payload);
    nodeSendToSession(sessionKey, "chat", payload);
  };

  const resolveToolVerboseLevel = (runId: string, sessionKey?: string) => {
    const runContext = getAgentRunContext(runId);
    const runVerbose = normalizeVerboseLevel(runContext?.verboseLevel);
    if (runVerbose) {
      return runVerbose;
    }
    if (!sessionKey) {
      return "off";
    }
    try {
      const { cfg, entry } = loadSessionEntry(sessionKey);
      const sessionVerbose = normalizeVerboseLevel(entry?.verboseLevel);
      if (sessionVerbose) {
        return sessionVerbose;
      }
      const defaultVerbose = normalizeVerboseLevel(cfg.agents?.defaults?.verboseDefault);
      return defaultVerbose ?? "off";
    } catch {
      return "off";
    }
  };

  return (evt: AgentEventPayload) => {
    const chatLink = chatRunState.registry.peek(evt.runId);
    const eventSessionKey =
      typeof evt.sessionKey === "string" && evt.sessionKey.trim() ? evt.sessionKey : undefined;
    const isControlUiVisible = getAgentRunContext(evt.runId)?.isControlUiVisible ?? true;
    const sessionKey =
      chatLink?.sessionKey ?? eventSessionKey ?? resolveSessionKeyForRun(evt.runId);
    const clientRunId = chatLink?.clientRunId ?? evt.runId;
    const eventRunId = chatLink?.clientRunId ?? evt.runId;
    const eventForClients = chatLink ? { ...evt, runId: eventRunId } : evt;
    const isAborted =
      chatRunState.abortedRuns.has(clientRunId) || chatRunState.abortedRuns.has(evt.runId);
    const lifecyclePhase =
      evt.stream === "lifecycle" && typeof evt.data?.phase === "string" ? evt.data.phase : null;
    if (lifecyclePhase !== "error") {
      clearPendingLifecycleError(clientRunId);
    }
    // Include sessionKey so Control UI can filter tool streams per session.
    const agentPayload = sessionKey ? { ...eventForClients, sessionKey } : eventForClients;
    const last = agentRunSeq.get(evt.runId) ?? 0;
    const isToolEvent = evt.stream === "tool";
    const toolVerbose = isToolEvent ? resolveToolVerboseLevel(evt.runId, sessionKey) : "off";
    // Build tool payload: strip result/partialResult unless verbose=full
    const toolPayload =
      isToolEvent && toolVerbose !== "full"
        ? (() => {
            const data = evt.data ? { ...evt.data } : {};
            delete data.result;
            delete data.partialResult;
            return sessionKey
              ? { ...eventForClients, sessionKey, data }
              : { ...eventForClients, data };
          })()
        : agentPayload;
    if (last > 0 && evt.seq !== last + 1) {
      broadcast("agent", {
        runId: eventRunId,
        stream: "error",
        ts: Date.now(),
        sessionKey,
        data: {
          reason: "seq gap",
          expected: last + 1,
          received: evt.seq,
        },
      });
    }
    agentRunSeq.set(evt.runId, evt.seq);
    if (isToolEvent) {
      const toolPhase = typeof evt.data?.phase === "string" ? evt.data.phase : "";
      recordTaskToolStep(evt);
      // Flush pending assistant text before tool-start events so clients can
      // render complete pre-tool text above tool cards (not truncated by delta throttle).
      if (toolPhase === "start" && isControlUiVisible && sessionKey && !isAborted) {
        flushBufferedChatDeltaIfNeeded(sessionKey, clientRunId, evt.runId, evt.seq);
      }
      // Always broadcast tool events to registered WS recipients with
      // tool-events capability, regardless of verboseLevel. The verbose
      // setting only controls whether tool details are sent as channel
      // messages to messaging surfaces (Telegram, Discord, etc.).
      const recipients = toolEventRecipients.get(evt.runId);
      if (recipients && recipients.size > 0) {
        broadcastToConnIds(
          "agent",
          sessionKey ? { ...toolPayload, ...buildSessionEventSnapshot(sessionKey) } : toolPayload,
          recipients,
        );
      }
      // Session subscribers power operator UIs that attach to an existing
      // in-flight session after the run has already started. Those clients do
      // not know the runId in advance, so they cannot register as run-scoped
      // tool recipients. Mirror tool lifecycle onto a session-scoped event so
      // they can render live pending tool cards without polling history.
      if (sessionKey) {
        const sessionSubscribers = sessionEventSubscribers.getAll();
        if (sessionSubscribers.size > 0) {
          broadcastToConnIds(
            "session.tool",
            { ...toolPayload, ...buildSessionEventSnapshot(sessionKey) },
            sessionSubscribers,
            { dropIfSlow: true },
          );
        }
      }
    } else {
      broadcast("agent", agentPayload);
    }

    if (isControlUiVisible && sessionKey) {
      // Send tool events to node/channel subscribers only when verbose is enabled;
      // WS clients already received the event above via broadcastToConnIds.
      if (!isToolEvent || toolVerbose !== "off") {
        nodeSendToSession(
          sessionKey,
          "agent",
          isToolEvent ? { ...toolPayload, ...buildSessionEventSnapshot(sessionKey) } : agentPayload,
        );
      }
      if (!isAborted && evt.stream === "assistant" && typeof evt.data?.text === "string") {
        emitChatDelta(sessionKey, clientRunId, evt.runId, evt.seq, evt.data.text, evt.data.delta);
      } else if (!isAborted && lifecyclePhase === "end") {
        const evtStopReason =
          typeof evt.data?.stopReason === "string" ? evt.data.stopReason : undefined;
        if (chatLink) {
          const finished = chatRunState.registry.shift(evt.runId);
          if (!finished) {
            clearAgentRunContext(evt.runId);
            return;
          }
          emitChatFinal(
            finished.sessionKey,
            finished.clientRunId,
            evt.runId,
            evt.seq,
            "done",
            evt.data?.error,
            evtStopReason,
          );
        } else {
          emitChatFinal(
            sessionKey,
            eventRunId,
            evt.runId,
            evt.seq,
            "done",
            evt.data?.error,
            evtStopReason,
          );
        }
      } else if (!isAborted && lifecyclePhase === "error") {
        schedulePendingLifecycleError({
          clientRunId,
          sourceRunId: evt.runId,
          sessionKey,
          seq: evt.seq,
          ts: evt.ts,
          error: evt.data?.error,
        });
      } else if (isAborted && (lifecyclePhase === "end" || lifecyclePhase === "error")) {
        chatRunState.abortedRuns.delete(clientRunId);
        chatRunState.abortedRuns.delete(evt.runId);
        chatRunState.buffers.delete(clientRunId);
        chatRunState.deltaSentAt.delete(clientRunId);
        if (chatLink) {
          chatRunState.registry.remove(evt.runId, clientRunId, sessionKey);
        }
      }
    }

    if (lifecyclePhase === "end") {
      toolEventRecipients.markFinal(evt.runId);
      clearAgentRunContext(evt.runId);
      agentRunSeq.delete(evt.runId);
      agentRunSeq.delete(clientRunId);
    }

    if (
      sessionKey &&
      (lifecyclePhase === "start" || lifecyclePhase === "end" || lifecyclePhase === "observer")
    ) {
      if (lifecyclePhase === "start" || lifecyclePhase === "end") {
        void persistGatewaySessionLifecycleEvent({ sessionKey, event: evt }).catch(() => undefined);
      }
      const sessionEventConnIds = sessionEventSubscribers.getAll();
      if (sessionEventConnIds.size > 0) {
        broadcastToConnIds(
          "sessions.changed",
          {
            sessionKey,
            phase: lifecyclePhase,
            runId: evt.runId,
            ts: evt.ts,
            ...buildSessionEventSnapshot(sessionKey, evt),
          },
          sessionEventConnIds,
          { dropIfSlow: true },
        );
      }
    }
  };
}
