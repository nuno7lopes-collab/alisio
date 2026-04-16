import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.js";
import { t } from "../i18n/index.ts";
import { scheduleChatScroll, resetChatScroll } from "./app-scroll.ts";
import { setLastActiveSessionKey } from "./app-settings.ts";
import { resetToolStream } from "./app-tool-stream.ts";
import type { AlisioApp } from "./app.ts";
import { normalizeBasePath } from "./base-path.ts";
import { executeSlashCommand } from "./chat/slash-command-executor.ts";
import { parseSlashCommand } from "./chat/slash-commands.ts";
import { abortChatRun, loadChatHistory, sendChatMessage } from "./controllers/chat.ts";
import {
  sortExecApprovalQueue,
  type ExecApprovalAuditEntry,
  type ExecApprovalRequest,
} from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import { loadModels } from "./controllers/models.ts";
import {
  applyGatewayAccessMode,
  resolveSecurityAccessDiagnostics,
  type SecurityAccessMode,
} from "./controllers/security-access.ts";
import { loadSessions } from "./controllers/sessions.ts";
import { formatRelativeTimestamp } from "./format.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { ConfigSnapshot, NativeShellState } from "./types.ts";
import type { ChatModelOverride, ModelCatalogEntry, SessionsListResult } from "./types.ts";
import type { ChatAttachment, ChatQueueItem } from "./ui-types.ts";
import { generateUUID } from "./uuid.ts";
import {
  resolveApprovalAccessLabel,
  resolveApprovalAskLabel,
  resolveApprovalCommandText,
  resolveApprovalDecisionLabel,
  resolveApprovalEffectText,
} from "./views/approval-summary.ts";
import { formatApprovalRemaining } from "./views/exec-approval.ts";
import {
  formatMissingPermissions,
  summarizeNativeShellAccess,
} from "./views/native-shell-access-summary.ts";

export type ChatHost = {
  client: GatewayBrowserClient | null;
  chatMessages: unknown[];
  chatStream: string | null;
  chatFinalizing?: boolean;
  connected: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatQueue: ChatQueueItem[];
  chatRunId: string | null;
  chatSending: boolean;
  lastError?: string | null;
  sessionKey: string;
  basePath: string;
  hello: GatewayHelloOk | null;
  chatAvatarUrl: string | null;
  chatModelOverrides: Record<string, ChatModelOverride | null>;
  chatModelsLoading: boolean;
  chatModelCatalog: ModelCatalogEntry[];
  configSnapshot?: ConfigSnapshot | null;
  configForm?: Record<string, unknown> | null;
  execApprovalsSnapshot?: ExecApprovalsSnapshot | null;
  execApprovalsForm?: ExecApprovalsFile | null;
  execApprovalQueue?: ExecApprovalRequest[];
  execApprovalAuditTrail?: ExecApprovalAuditEntry[];
  gatewayAccessMode?: SecurityAccessMode | null;
  gatewayAccessModeLoading?: boolean;
  gatewayAccessModeBusy?: boolean;
  securityAccessDiagnostics?:
    | import("./controllers/security-access.ts").SecurityAccessDiagnostics
    | null;
  nativeShellLoading?: boolean;
  nativeShellError?: string | null;
  nativeShellState?: NativeShellState | null;
  sessionsResult?: SessionsListResult | null;
  updateComplete?: Promise<unknown>;
  refreshSessionsAfterChat: Set<string>;
  /** Callback for slash-command side effects that need app-level access. */
  onSlashAction?: (action: string) => void;
};

export const CHAT_SESSIONS_ACTIVE_MINUTES = 120;

export function isChatBusy(host: ChatHost) {
  return host.chatSending || Boolean(host.chatRunId) || Boolean(host.chatFinalizing);
}

export function isChatStopCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/stop") {
    return true;
  }
  return (
    normalized === "stop" ||
    normalized === "esc" ||
    normalized === "abort" ||
    normalized === "wait" ||
    normalized === "exit"
  );
}

function isChatResetCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/new" || normalized === "/reset") {
    return true;
  }
  return normalized.startsWith("/new ") || normalized.startsWith("/reset ");
}

export async function handleAbortChat(host: ChatHost) {
  if (!host.connected) {
    return;
  }
  host.chatMessage = "";
  await abortChatRun(host as unknown as AlisioApp);
}

function enqueueChatMessage(
  host: ChatHost,
  text: string,
  attachments?: ChatAttachment[],
  refreshSessions?: boolean,
  localCommand?: { args: string; name: string },
) {
  const trimmed = text.trim();
  const hasAttachments = (attachments?.length ?? 0) > 0;
  if (!trimmed && !hasAttachments) {
    return;
  }
  host.chatQueue = [
    ...host.chatQueue,
    {
      id: generateUUID(),
      text: trimmed,
      createdAt: Date.now(),
      attachments: hasAttachments ? attachments?.map((att) => ({ ...att })) : undefined,
      refreshSessions,
      localCommandArgs: localCommand?.args,
      localCommandName: localCommand?.name,
    },
  ];
}

function enqueuePendingRunMessage(host: ChatHost, text: string, pendingRunId: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  host.chatQueue = [
    ...host.chatQueue,
    {
      id: generateUUID(),
      text: trimmed,
      createdAt: Date.now(),
      pendingRunId,
    },
  ];
}

async function sendChatMessageNow(
  host: ChatHost,
  message: string,
  opts?: {
    previousDraft?: string;
    restoreDraft?: boolean;
    attachments?: ChatAttachment[];
    previousAttachments?: ChatAttachment[];
    restoreAttachments?: boolean;
    refreshSessions?: boolean;
  },
) {
  resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
  // Reset scroll state before sending to ensure auto-scroll works for the response
  resetChatScroll(host as unknown as Parameters<typeof resetChatScroll>[0]);
  const runId = await sendChatMessage(host as unknown as AlisioApp, message, opts?.attachments);
  const ok = runId != null;
  if (!ok && opts?.previousDraft != null) {
    host.chatMessage = opts.previousDraft;
  }
  if (!ok && opts?.previousAttachments) {
    host.chatAttachments = opts.previousAttachments;
  }
  if (ok) {
    host.chatFinalizing = false;
    setLastActiveSessionKey(
      host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
      host.sessionKey,
    );
  }
  if (ok && opts?.restoreDraft && opts.previousDraft?.trim()) {
    host.chatMessage = opts.previousDraft;
  }
  if (ok && opts?.restoreAttachments && opts.previousAttachments?.length) {
    host.chatAttachments = opts.previousAttachments;
  }
  // Force scroll after sending to ensure viewport is at bottom for incoming stream
  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0], true);
  if (ok && !host.chatRunId) {
    void flushChatQueue(host);
  }
  if (ok && opts?.refreshSessions && runId) {
    host.refreshSessionsAfterChat.add(runId);
  }
  return ok;
}

async function flushChatQueue(host: ChatHost) {
  if (!host.connected || isChatBusy(host)) {
    return;
  }
  const nextIndex = host.chatQueue.findIndex((item) => !item.pendingRunId);
  if (nextIndex < 0) {
    return;
  }
  const next = host.chatQueue[nextIndex];
  host.chatQueue = host.chatQueue.filter((_, index) => index !== nextIndex);
  let ok = false;
  try {
    if (next.localCommandName) {
      await dispatchSlashCommand(host, next.localCommandName, next.localCommandArgs ?? "");
      ok = true;
    } else {
      ok = await sendChatMessageNow(host, next.text, {
        attachments: next.attachments,
        refreshSessions: next.refreshSessions,
      });
    }
  } catch (err) {
    host.lastError = String(err);
  }
  if (!ok) {
    host.chatQueue = [next, ...host.chatQueue];
  } else if (host.chatQueue.length > 0) {
    // Continue draining — local commands don't block on server response
    void flushChatQueue(host);
  }
}

export function removeQueuedMessage(host: ChatHost, id: string) {
  host.chatQueue = host.chatQueue.filter((item) => item.id !== id);
}

export function clearPendingQueueItemsForRun(host: ChatHost, runId: string | undefined) {
  if (!runId) {
    return;
  }
  host.chatQueue = host.chatQueue.filter((item) => item.pendingRunId !== runId);
}

function resolveChatSecurityDiagnostics(host: ChatHost) {
  if (host.securityAccessDiagnostics) {
    return host.securityAccessDiagnostics;
  }
  return resolveSecurityAccessDiagnostics({
    configForm:
      host.configForm ?? (host.configSnapshot?.config as Record<string, unknown> | null) ?? null,
    execApprovalsForm: host.execApprovalsForm ?? host.execApprovalsSnapshot?.file ?? null,
  });
}

function readChatLastError(host: Pick<ChatHost, "lastError">): string | null {
  return typeof host.lastError === "string" && host.lastError.length > 0 ? host.lastError : null;
}

function resolveGuardrailLabel(security?: string | null) {
  return resolveApprovalAccessLabel({
    command: "policy",
    security,
  });
}

function buildSecuritySummaryMessage(host: ChatHost): string {
  const diagnostics = resolveChatSecurityDiagnostics(host);
  const queue = sortExecApprovalQueue(host.execApprovalQueue ?? []);
  const recentAudit = (host.execApprovalAuditTrail ?? []).slice(0, 3);
  const mode = host.gatewayAccessMode ?? diagnostics.mode;
  const nativeShellSummary = summarizeNativeShellAccess(host.nativeShellState);
  const policySummary = diagnostics
    ? `${resolveGuardrailLabel(diagnostics.configDefaults.security)} · ${resolveApprovalAskLabel(
        diagnostics.configDefaults.ask,
      )} / ${resolveGuardrailLabel(diagnostics.approvalDefaults.security)} · ${resolveApprovalAskLabel(
        diagnostics.approvalDefaults.ask,
      )} / ${resolveGuardrailLabel(diagnostics.approvalDefaults.askFallback)}`
    : t("alisio.chat.access.loading");

  const lines = [
    `**${t("alisio.chat.access.title")}**`,
    `- ${t("alisio.security.stats.mode")}: ${mode ? accessModeLabel(mode) : t("alisio.chat.access.loading")}`,
    `- ${t("alisio.security.stats.pending")}: ${String(queue.length)}`,
    `- ${t("alisio.chat.access.policyTitle")}: ${policySummary}`,
  ];

  if (host.nativeShellLoading && !nativeShellSummary) {
    lines.push(
      `- ${t("alisio.chat.access.computerTitle")}: ${t("alisio.chat.access.computerLoading")}`,
    );
  } else if (host.nativeShellError) {
    lines.push(`- ${t("alisio.chat.access.computerTitle")}: ${host.nativeShellError}`);
  } else if (nativeShellSummary) {
    lines.push(
      `- ${t("alisio.chat.access.computerTitle")}: ${t("alisio.chat.access.computerGranted", {
        granted: String(nativeShellSummary.granted),
        total: String(nativeShellSummary.total),
      })}`,
    );
    if (nativeShellSummary.missingLabels.length > 0) {
      lines.push(
        `- ${t("alisio.chat.access.computerNeedsReview", {
          value: formatMissingPermissions(nativeShellSummary.missingLabels),
        })}`,
      );
    }
  } else {
    lines.push(
      `- ${t("alisio.chat.access.computerTitle")}: ${t("alisio.chat.access.computerUnavailable")}`,
    );
  }

  if (queue.length > 0) {
    lines.push("", `**${t("alisio.security.stats.pending")}**`);
    for (const entry of queue.slice(0, 5)) {
      lines.push(
        `- \`${entry.id}\` — ${resolveApprovalEffectText(entry)} (${formatApprovalRemaining(
          Math.max(0, entry.expiresAtMs - Date.now()),
        )})`,
      );
    }
  }

  if (recentAudit.length > 0) {
    lines.push("", `**${t("alisio.security.audit.title")}**`);
    for (const entry of recentAudit) {
      lines.push(
        `- ${resolveApprovalDecisionLabel(entry.decision)} · \`${resolveApprovalCommandText(
          entry.request,
        )}\` · ${formatRelativeTimestamp(entry.ts, { dateFallback: true })}`,
      );
    }
  }

  return lines.join("\n");
}

function accessModeLabel(mode: SecurityAccessMode) {
  if (mode === "full-access") {
    return t("alisio.security.access.fullAccess.label");
  }
  if (mode === "recommended") {
    return t("alisio.security.access.recommended.label");
  }
  return t("alisio.security.access.custom.label");
}

function handleLocalTasksCommand(host: ChatHost) {
  host.onSlashAction?.("open-tasks");
  injectCommandResult(
    host,
    `**${t("chat.localCommands.tasksTitle")}**\n\n${t("chat.localCommands.tasksBody")}`,
  );
}

async function handleLocalSecurityCommand(host: ChatHost, name: string, args: string) {
  if (name === "approvals") {
    injectCommandResult(host, buildSecuritySummaryMessage(host));
    return;
  }

  const action = args.trim().toLowerCase();
  if (!action || action === "status") {
    injectCommandResult(host, buildSecuritySummaryMessage(host));
    return;
  }

  if (action === "advanced" || action === "review") {
    host.onSlashAction?.("open-security");
    injectCommandResult(
      host,
      `**${t("alisio.security.title")}**\n\n${t("alisio.chat.access.openAdvanced")}`,
    );
    return;
  }

  const nextMode =
    action === "safe" || action === "recommended"
      ? "recommended"
      : action === "full"
        ? "full-access"
        : null;

  if (!nextMode) {
    injectCommandResult(
      host,
      t("chat.localCommands.unknownSecurityMode", { action }),
    );
    return;
  }

  if (!host.connected || !host.client) {
    injectCommandResult(host, t("chat.localCommands.connectBeforeSecurityChange"));
    return;
  }

  try {
    host.lastError = null;
    await applyGatewayAccessMode(
      host as unknown as Parameters<typeof applyGatewayAccessMode>[0],
      nextMode,
    );
    const accessProfileError = readChatLastError(host);
    if (accessProfileError) {
      injectCommandResult(
        host,
        t("chat.localCommands.securityChangeFailed", { error: String(accessProfileError) }),
      );
      return;
    }
    injectCommandResult(
      host,
      `**${t("alisio.security.title")}**\n\n${t(
        nextMode === "recommended"
          ? "alisio.security.access.recommended.description"
          : "alisio.security.access.fullAccess.description",
      )}`,
    );
  } catch (err) {
    injectCommandResult(
      host,
      t("chat.localCommands.securityChangeFailed", { error: String(err) }),
    );
  }
}

export async function handleSendChat(
  host: ChatHost,
  messageOverride?: string,
  opts?: { restoreDraft?: boolean; attachments?: ChatAttachment[] },
) {
  if (!host.connected) {
    return;
  }
  const previousDraft = host.chatMessage;
  const message = (messageOverride ?? host.chatMessage).trim();
  const attachments = host.chatAttachments ?? [];
  const attachmentsToSend = messageOverride == null ? attachments : (opts?.attachments ?? []);
  const hasAttachments = attachmentsToSend.length > 0;

  if (!message && !hasAttachments) {
    return;
  }

  if (isChatStopCommand(message)) {
    await handleAbortChat(host);
    return;
  }

  // Intercept local slash commands (/status, /model, /compact, etc.)
  const parsed = parseSlashCommand(message);
  if (parsed?.command.executeLocal) {
    if (isChatBusy(host) && shouldQueueLocalSlashCommand(parsed.command.key)) {
      if (messageOverride == null) {
        host.chatMessage = "";
        host.chatAttachments = [];
      }
      enqueueChatMessage(host, message, undefined, isChatResetCommand(message), {
        args: parsed.args,
        name: parsed.command.key,
      });
      return;
    }
    const prevDraft = messageOverride == null ? previousDraft : undefined;
    if (messageOverride == null) {
      host.chatMessage = "";
      host.chatAttachments = [];
    }
    await dispatchSlashCommand(host, parsed.command.key, parsed.args, {
      previousDraft: prevDraft,
      restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
    });
    return;
  }

  const refreshSessions = isChatResetCommand(message);
  if (messageOverride == null) {
    host.chatMessage = "";
    host.chatAttachments = [];
  }

  if (isChatBusy(host)) {
    enqueueChatMessage(host, message, attachmentsToSend, refreshSessions);
    return;
  }

  await sendChatMessageNow(host, message, {
    previousDraft: messageOverride == null ? previousDraft : undefined,
    restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
    attachments: hasAttachments ? attachmentsToSend : undefined,
    previousAttachments: messageOverride == null ? attachments : undefined,
    restoreAttachments: Boolean(messageOverride && opts?.restoreDraft),
    refreshSessions,
  });
}

function shouldQueueLocalSlashCommand(name: string): boolean {
  return ![
    "stop",
    "focus",
    "export-session",
    "steer",
    "redirect",
    "permissions",
    "approvals",
    "tasks",
  ].includes(name);
}

// ── Slash Command Dispatch ──

async function dispatchSlashCommand(
  host: ChatHost,
  name: string,
  args: string,
  sendOpts?: { previousDraft?: string; restoreDraft?: boolean },
) {
  switch (name) {
    case "stop":
      await handleAbortChat(host);
      return;
    case "new":
      await sendChatMessageNow(host, "/new", {
        refreshSessions: true,
        previousDraft: sendOpts?.previousDraft,
        restoreDraft: sendOpts?.restoreDraft,
      });
      return;
    case "reset":
      await sendChatMessageNow(host, "/reset", {
        refreshSessions: true,
        previousDraft: sendOpts?.previousDraft,
        restoreDraft: sendOpts?.restoreDraft,
      });
      return;
    case "clear":
      await clearChatHistory(host);
      return;
    case "focus":
      host.onSlashAction?.("toggle-focus");
      return;
    case "export-session":
      host.onSlashAction?.("export");
      return;
    case "permissions":
    case "approvals":
      await handleLocalSecurityCommand(host, name, args);
      scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
      return;
    case "tasks":
      handleLocalTasksCommand(host);
      scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
      return;
  }

  if (!host.client) {
    return;
  }

  const targetSessionKey = host.sessionKey;
  const result = await executeSlashCommand(host.client, targetSessionKey, name, args, {
    chatModelCatalog: host.chatModelCatalog,
    sessionsResult: host.sessionsResult,
  });

  if (result.content) {
    injectCommandResult(host, result.content);
  }

  if (result.trackRunId) {
    host.chatRunId = result.trackRunId;
    host.chatStream = "";
    host.chatSending = false;
    host.chatFinalizing = false;
  }

  if (result.pendingCurrentRun && host.chatRunId) {
    enqueuePendingRunMessage(host, `/${name} ${args}`.trim(), host.chatRunId);
  }

  if (result.sessionPatch && "modelOverride" in result.sessionPatch) {
    host.chatModelOverrides = {
      ...host.chatModelOverrides,
      [targetSessionKey]: result.sessionPatch.modelOverride ?? null,
    };
    host.onSlashAction?.("refresh-tools-effective");
  }

  if (result.action === "refresh") {
    await refreshChat(host);
  }

  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
}

async function clearChatHistory(host: ChatHost) {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request("sessions.reset", { key: host.sessionKey });
    host.chatMessages = [];
    host.chatStream = null;
    host.chatRunId = null;
    host.chatFinalizing = false;
    await loadChatHistory(host as unknown as AlisioApp);
  } catch (err) {
    host.lastError = String(err);
  }
  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
}

function injectCommandResult(host: ChatHost, content: string) {
  host.chatMessages = [
    ...host.chatMessages,
    {
      role: "system",
      content,
      timestamp: Date.now(),
    },
  ];
}

export async function refreshChat(
  host: ChatHost,
  opts?: { includeHistory?: boolean; scheduleScroll?: boolean },
) {
  const includeHistory = opts?.includeHistory ?? true;
  await Promise.all([
    includeHistory
      ? loadChatHistory(host as unknown as AlisioApp, {
          preserveEphemeral: Boolean(host.chatRunId || host.chatFinalizing),
        })
      : Promise.resolve(),
    loadSessions(host as unknown as AlisioApp, {
      activeMinutes: 0,
      limit: 0,
      includeGlobal: true,
      includeUnknown: true,
    }),
    refreshChatAvatar(host),
    refreshChatModels(host),
  ]);
  if (opts?.scheduleScroll !== false) {
    scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
  }
}

async function refreshChatModels(host: ChatHost) {
  if (!host.client || !host.connected) {
    host.chatModelsLoading = false;
    host.chatModelCatalog = [];
    return;
  }
  host.chatModelsLoading = true;
  try {
    host.chatModelCatalog = await loadModels(host.client);
  } finally {
    host.chatModelsLoading = false;
  }
}

export const flushChatQueueForEvent = flushChatQueue;

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
};

function resolveAgentIdForSession(host: ChatHost): string | null {
  const parsed = parseAgentSessionKey(host.sessionKey);
  if (parsed?.agentId) {
    return parsed.agentId;
  }
  const snapshot = host.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const fallback = snapshot?.sessionDefaults?.defaultAgentId?.trim();
  return fallback || "main";
}

function buildAvatarMetaUrl(basePath: string, agentId: string): string {
  const base = normalizeBasePath(basePath);
  const encoded = encodeURIComponent(agentId);
  return base ? `${base}/avatar/${encoded}?meta=1` : `avatar/${encoded}?meta=1`;
}

export async function refreshChatAvatar(host: ChatHost) {
  if (!host.connected) {
    host.chatAvatarUrl = null;
    return;
  }
  const agentId = resolveAgentIdForSession(host);
  if (!agentId) {
    host.chatAvatarUrl = null;
    return;
  }
  host.chatAvatarUrl = null;
  const url = buildAvatarMetaUrl(host.basePath, agentId);
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      host.chatAvatarUrl = null;
      return;
    }
    const data = (await res.json()) as { avatarUrl?: unknown };
    const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() : "";
    host.chatAvatarUrl = avatarUrl || null;
  } catch {
    host.chatAvatarUrl = null;
  }
}
