import { resetToolStream } from "../app-tool-stream.ts";
import { isImageChatAttachmentMimeType } from "../chat/attachment-support.ts";
import { extractText } from "../chat/message-extract.ts";
import { formatConnectError } from "../connect-error.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { generateUUID } from "../uuid.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/;

function isSilentReplyStream(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text);
}
/** Client-side defense-in-depth: detect assistant messages whose text is purely NO_REPLY. */
function isAssistantSilentReply(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
  if (role !== "assistant") {
    return false;
  }
  // entry.text takes precedence — matches gateway extractAssistantTextForSilentCheck
  if (typeof entry.text === "string") {
    return isSilentReplyStream(entry.text);
  }
  const text = extractText(message);
  return typeof text === "string" && isSilentReplyStream(text);
}

function fingerprintChatMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  try {
    return JSON.stringify(message);
  } catch {
    const entry = message as Record<string, unknown>;
    const role = typeof entry.role === "string" ? entry.role : "";
    const id = typeof entry.id === "string" ? entry.id : "";
    const messageId = typeof entry.messageId === "string" ? entry.messageId : "";
    const toolCallId = typeof entry.toolCallId === "string" ? entry.toolCallId : "";
    const timestamp = typeof entry.timestamp === "number" ? String(entry.timestamp) : "";
    const text = extractText(message) ?? "";
    return [role, id, messageId, toolCallId, timestamp, text].join("\u0001");
  }
}

function isDuplicateAdjacentMessage(previous: unknown, next: unknown): boolean {
  const prevFingerprint = fingerprintChatMessage(previous);
  const nextFingerprint = fingerprintChatMessage(next);
  return Boolean(prevFingerprint && nextFingerprint && prevFingerprint === nextFingerprint);
}

function dedupeAdjacentChatMessages(messages: unknown[]): unknown[] {
  const deduped: unknown[] = [];
  for (const message of messages) {
    const previous = deduped.at(-1);
    if (previous && isDuplicateAdjacentMessage(previous, message)) {
      continue;
    }
    deduped.push(message);
  }
  return deduped;
}

function normalizeComparableRole(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "unknown";
  }
  const entry = message as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "unknown";
  if (role === "toolresult" || role === "tool_result" || role === "tool" || role === "function") {
    return "tool";
  }
  return role;
}

function extractComparableMessageText(message: unknown): string {
  const role = normalizeComparableRole(message);
  const text = extractText(message)?.trim() ?? "";
  if (!text || role !== "user") {
    return text;
  }
  // Back-compat for older optimistic sends that encoded attachment summaries
  // as text instead of structured attachment blocks.
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !/^attachments?:\s/i.test(line))
    .join("\n")
    .trim();
}

function resolveComparableMediaCount(message: unknown): number {
  if (!message || typeof message !== "object") {
    return 0;
  }
  const entry = message as Record<string, unknown>;
  const mediaPaths = Array.isArray(entry.MediaPaths)
    ? entry.MediaPaths.filter((value) => typeof value === "string" && value.trim().length > 0)
        .length
    : 0;
  if (mediaPaths > 0) {
    return mediaPaths;
  }
  if (typeof entry.MediaPath === "string" && entry.MediaPath.trim()) {
    return 1;
  }
  const previewImages = Array.isArray(entry.MediaPreviewImages)
    ? entry.MediaPreviewImages.length
    : 0;
  if (previewImages > 0) {
    return previewImages;
  }
  const content = entry.content;
  if (!Array.isArray(content)) {
    return 0;
  }
  return content.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const type = (item as { type?: unknown }).type;
    return type === "image" || type === "image_url" || type === "attachment";
  }).length;
}

function resolveComparableStableId(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const entry = message as Record<string, unknown>;
  const id =
    (typeof entry.id === "string" && entry.id.trim()) ||
    (typeof entry.messageId === "string" && entry.messageId.trim()) ||
    (typeof entry.toolCallId === "string" && entry.toolCallId.trim()) ||
    (typeof entry.tool_call_id === "string" && entry.tool_call_id.trim()) ||
    (typeof entry.idempotencyKey === "string" && entry.idempotencyKey.trim()) ||
    null;
  return id;
}

function getMessageTimestamp(message: unknown): number | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const timestamp = (message as { timestamp?: unknown }).timestamp;
  return typeof timestamp === "number" ? timestamp : null;
}

function areSemanticallyEquivalentMessages(left: unknown, right: unknown): boolean {
  const leftId = resolveComparableStableId(left);
  const rightId = resolveComparableStableId(right);
  if (leftId && rightId) {
    return leftId === rightId;
  }

  const leftRole = normalizeComparableRole(left);
  const rightRole = normalizeComparableRole(right);
  if (leftRole !== rightRole) {
    return false;
  }

  const leftText = extractComparableMessageText(left);
  const rightText = extractComparableMessageText(right);
  const leftMediaCount = resolveComparableMediaCount(left);
  const rightMediaCount = resolveComparableMediaCount(right);

  if (leftText && rightText && leftText === rightText) {
    return leftMediaCount === rightMediaCount || leftMediaCount === 0 || rightMediaCount === 0;
  }

  if (!leftText && !rightText && leftMediaCount > 0 && rightMediaCount > 0) {
    return leftMediaCount === rightMediaCount;
  }

  return false;
}

function mergeUnmatchedMessageSlices(localSlice: unknown[], historySlice: unknown[]): unknown[] {
  if (localSlice.length === 0) {
    return historySlice;
  }
  if (historySlice.length === 0) {
    return localSlice;
  }

  return [
    ...localSlice.map((message, index) => ({ index, message, origin: "local" as const })),
    ...historySlice.map((message, index) => ({ index, message, origin: "history" as const })),
  ]
    .toSorted((left, right) => {
      const leftTimestamp = getMessageTimestamp(left.message);
      const rightTimestamp = getMessageTimestamp(right.message);
      if (
        typeof leftTimestamp === "number" &&
        typeof rightTimestamp === "number" &&
        leftTimestamp !== rightTimestamp
      ) {
        return leftTimestamp - rightTimestamp;
      }
      if (typeof leftTimestamp === "number" && typeof rightTimestamp !== "number") {
        return -1;
      }
      if (typeof leftTimestamp !== "number" && typeof rightTimestamp === "number") {
        return 1;
      }

      const leftRole = normalizeComparableRole(left.message);
      const rightRole = normalizeComparableRole(right.message);
      if (leftRole !== rightRole) {
        if (leftRole === "user") {
          return -1;
        }
        if (rightRole === "user") {
          return 1;
        }
      }

      if (left.origin !== right.origin) {
        return left.origin === "local" ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.message);
}

function mergeLocalPendingMessagesIntoHistory(
  localMessages: unknown[],
  historyMessages: unknown[],
) {
  if (localMessages.length === 0 || historyMessages.length === 0) {
    return dedupeAdjacentChatMessages(mergeUnmatchedMessageSlices(localMessages, historyMessages));
  }

  const localLen = localMessages.length;
  const historyLen = historyMessages.length;
  const dp = Array.from({ length: localLen + 1 }, () =>
    Array.from({ length: historyLen + 1 }, () => 0),
  );

  for (let localIndex = localLen - 1; localIndex >= 0; localIndex--) {
    for (let historyIndex = historyLen - 1; historyIndex >= 0; historyIndex--) {
      dp[localIndex][historyIndex] = areSemanticallyEquivalentMessages(
        localMessages[localIndex],
        historyMessages[historyIndex],
      )
        ? dp[localIndex + 1][historyIndex + 1] + 1
        : Math.max(dp[localIndex + 1][historyIndex], dp[localIndex][historyIndex + 1]);
    }
  }

  const merged: unknown[] = [];
  let localIndex = 0;
  let historyIndex = 0;
  while (localIndex < localLen && historyIndex < historyLen) {
    if (
      areSemanticallyEquivalentMessages(localMessages[localIndex], historyMessages[historyIndex])
    ) {
      merged.push(historyMessages[historyIndex]);
      localIndex += 1;
      historyIndex += 1;
      continue;
    }
    if (dp[localIndex + 1][historyIndex] >= dp[localIndex][historyIndex + 1]) {
      merged.push(localMessages[localIndex]);
      localIndex += 1;
      continue;
    }
    merged.push(historyMessages[historyIndex]);
    historyIndex += 1;
  }

  if (localIndex < localLen || historyIndex < historyLen) {
    merged.push(
      ...mergeUnmatchedMessageSlices(
        localMessages.slice(localIndex),
        historyMessages.slice(historyIndex),
      ),
    );
  }

  return dedupeAdjacentChatMessages(merged);
}

function appendChatMessageIfDistinct(state: ChatState, message: unknown): void {
  const previous = state.chatMessages.at(-1);
  if (previous && isDuplicateAdjacentMessage(previous, message)) {
    return;
  }
  state.chatMessages = [...state.chatMessages, message];
}

export type ChatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatThinkingLevel: string | null;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatFinalizing?: boolean;
  lastError: string | null;
  chatRuntimeSetupHint?: ChatRuntimeSetupHint | null;
};

export type ChatRuntimeSetupHint = {
  title: string;
  message: string;
  ctaLabel: string;
};

const chatHistoryRequestSeq = new WeakMap<object, number>();

function beginChatHistoryRequest(state: ChatState): {
  client: NonNullable<ChatState["client"]>;
  sessionKey: string;
  token: number;
} {
  const token = (chatHistoryRequestSeq.get(state as object) ?? 0) + 1;
  chatHistoryRequestSeq.set(state as object, token);
  return {
    client: state.client as NonNullable<ChatState["client"]>,
    sessionKey: state.sessionKey,
    token,
  };
}

function isCurrentChatHistoryRequest(
  state: ChatState,
  requestState: {
    client: NonNullable<ChatState["client"]>;
    sessionKey: string;
    token: number;
  },
): boolean {
  return (
    chatHistoryRequestSeq.get(state as object) === requestState.token &&
    state.client === requestState.client &&
    state.sessionKey === requestState.sessionKey
  );
}

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

function maybeResetToolStream(state: ChatState) {
  const toolHost = state as ChatState & Partial<Parameters<typeof resetToolStream>[0]>;
  if (
    toolHost.toolStreamById instanceof Map &&
    Array.isArray(toolHost.toolStreamOrder) &&
    Array.isArray(toolHost.chatToolMessages) &&
    Array.isArray(toolHost.chatStreamSegments)
  ) {
    resetToolStream(toolHost as Parameters<typeof resetToolStream>[0]);
  }
}

function describeRuntimeSetupError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return [error.name, error.message].filter(Boolean).join(": ");
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

function resolveChatRuntimeSetupHint(error: unknown): ChatRuntimeSetupHint | null {
  const formatted = formatConnectError(error);
  const combined = `${formatted} ${describeRuntimeSetupError(error)}`.trim().toLowerCase();
  const mentionsProviderSetup =
    combined.includes("no providers configured") ||
    combined.includes("no provider plugins found") ||
    combined.includes("missing provider") ||
    combined.includes("missing runtime") ||
    combined.includes("runtime missing") ||
    combined.includes("model provider") ||
    combined.includes("provider contract entry missing") ||
    combined.includes("provider auth");
  const mentionsCredentials =
    combined.includes("api key") ||
    combined.includes("token auth") ||
    combined.includes("oauth credentials");
  if (!mentionsProviderSetup && !mentionsCredentials) {
    return null;
  }
  return {
    title: "Runtime setup required",
    message: "Configure um provider e as credenciais do runtime antes de enviar mensagens no chat.",
    ctaLabel: "Abrir setup do runtime",
  };
}

export async function loadChatHistory(
  state: ChatState,
  opts?: { preserveEphemeral?: boolean; silent?: boolean },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const requestState = beginChatHistoryRequest(state);
  const silent = opts?.silent ?? false;
  const preserveEphemeral =
    opts?.preserveEphemeral ?? Boolean(state.chatRunId || state.chatFinalizing);
  if (!silent) {
    state.chatLoading = true;
  }
  state.lastError = null;
  state.chatRuntimeSetupHint = null;
  try {
    const res = await requestState.client.request<{
      messages?: Array<unknown>;
      thinkingLevel?: string;
    }>("chat.history", {
      sessionKey: requestState.sessionKey,
      limit: 200,
    });
    if (!isCurrentChatHistoryRequest(state, requestState)) {
      return;
    }
    const messages = Array.isArray(res.messages) ? res.messages : [];
    const historyMessages = dedupeAdjacentChatMessages(
      messages.filter((message) => !isAssistantSilentReply(message)),
    );
    const shouldMergeLocalPendingMessages = Boolean(
      opts?.preserveEphemeral || state.chatRunId || state.chatFinalizing,
    );
    state.chatMessages = shouldMergeLocalPendingMessages
      ? mergeLocalPendingMessagesIntoHistory(state.chatMessages, historyMessages)
      : historyMessages;
    state.chatThinkingLevel = res.thinkingLevel ?? null;
    if (!preserveEphemeral) {
      // Clear all streaming state — history includes tool results and text
      // inline, so keeping streaming artifacts would cause duplicates.
      maybeResetToolStream(state);
      state.chatStream = null;
      state.chatStreamStartedAt = null;
      state.chatFinalizing = false;
    }
  } catch (err) {
    if (!isCurrentChatHistoryRequest(state, requestState)) {
      return;
    }
    if (isMissingOperatorReadScopeError(err)) {
      state.chatMessages = [];
      state.chatThinkingLevel = null;
      state.lastError = formatMissingOperatorReadScopeMessage("existing chat history");
    } else {
      state.lastError = String(err);
    }
  } finally {
    if (!silent && isCurrentChatHistoryRequest(state, requestState)) {
      state.chatLoading = false;
    }
  }
}

function dataUrlToBase64(dataUrl: string): { content: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], content: match[2] };
}

type AssistantMessageNormalizationOptions = {
  roleRequirement: "required" | "optional";
  roleCaseSensitive?: boolean;
  requireContentArray?: boolean;
  allowTextField?: boolean;
};

function normalizeAssistantMessage(
  message: unknown,
  options: AssistantMessageNormalizationOptions,
): Record<string, unknown> | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const candidate = message as Record<string, unknown>;
  const roleValue = candidate.role;
  if (typeof roleValue === "string") {
    const role = options.roleCaseSensitive ? roleValue : roleValue.toLowerCase();
    if (role !== "assistant") {
      return null;
    }
  } else if (options.roleRequirement === "required") {
    return null;
  }

  if (options.requireContentArray) {
    return Array.isArray(candidate.content) ? candidate : null;
  }
  if (!("content" in candidate) && !(options.allowTextField && "text" in candidate)) {
    return null;
  }
  return candidate;
}

function normalizeAbortedAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "required",
    roleCaseSensitive: true,
    requireContentArray: true,
  });
}

function normalizeFinalAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "optional",
    allowTextField: true,
  });
}

export async function sendChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }

  const now = Date.now();
  const runId = generateUUID();

  // Build user message content blocks
  const contentBlocks: Array<{
    type: string;
    text?: string;
    source?: unknown;
    mimeType?: string;
    fileName?: string;
  }> = [];
  if (msg) {
    contentBlocks.push({ type: "text", text: msg });
  }
  // Add structured attachment blocks so optimistic UI matches persisted history.
  if (hasAttachments) {
    for (const att of attachments) {
      if (isImageChatAttachmentMimeType(att.mimeType)) {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: att.mimeType, data: att.dataUrl },
        });
        continue;
      }
      contentBlocks.push({
        type: "attachment",
        mimeType: att.mimeType,
        ...(att.fileName ? { fileName: att.fileName } : {}),
      });
    }
  }

  state.chatMessages = [
    ...state.chatMessages,
    {
      role: "user",
      content: contentBlocks,
      timestamp: now,
      idempotencyKey: runId,
    },
  ];

  state.chatSending = true;
  state.lastError = null;
  state.chatRuntimeSetupHint = null;
  state.chatFinalizing = false;
  state.chatRunId = runId;
  state.chatStream = "";
  state.chatStreamStartedAt = now;

  // Convert attachments to API format
  const apiAttachments = hasAttachments
    ? attachments
        .map((att) => {
          const parsed = dataUrlToBase64(att.dataUrl);
          if (!parsed) {
            return null;
          }
          const attachmentType = parsed.mimeType.split("/")[0] || "file";
          return {
            type: attachmentType,
            mimeType: parsed.mimeType,
            content: parsed.content,
            ...(att.fileName ? { fileName: att.fileName } : {}),
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : undefined;

  try {
    await state.client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: msg,
      deliver: false,
      idempotencyKey: runId,
      attachments: apiAttachments,
    });
    return runId;
  } catch (err) {
    const error = formatConnectError(err);
    const runtimeSetupHint = resolveChatRuntimeSetupHint(err);
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.chatFinalizing = false;
    state.chatRuntimeSetupHint = runtimeSetupHint;
    state.lastError = runtimeSetupHint?.message ?? error;
    if (!runtimeSetupHint) {
      state.chatMessages = [
        ...state.chatMessages,
        {
          role: "assistant",
          content: [{ type: "text", text: "Error: " + error }],
          timestamp: Date.now(),
        },
      ];
    }
    return null;
  } finally {
    state.chatSending = false;
  }
}

export async function abortChatRun(state: ChatState): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const runId = state.chatRunId;
  try {
    await state.client.request(
      "chat.abort",
      runId ? { sessionKey: state.sessionKey, runId } : { sessionKey: state.sessionKey },
    );
    return true;
  } catch (err) {
    state.lastError = formatConnectError(err);
    return false;
  }
}

export function handleChatEvent(state: ChatState, payload?: ChatEventPayload) {
  if (!payload) {
    return null;
  }
  if (payload.sessionKey !== state.sessionKey) {
    return null;
  }

  // Final from another run (e.g. sub-agent announce): refresh history to show new message.
  // See https://github.com/\u006fpen\u0063law/\u006fpen\u0063law/issues/1909
  if (payload.runId && state.chatRunId && payload.runId !== state.chatRunId) {
    if (payload.state === "final") {
      const finalMessage = normalizeFinalAssistantMessage(payload.message);
      if (finalMessage && !isAssistantSilentReply(finalMessage)) {
        appendChatMessageIfDistinct(state, finalMessage);
        return null;
      }
      return "final";
    }
    return null;
  }

  if (payload.state === "delta") {
    const next = extractText(payload.message);
    if (typeof next === "string" && !isSilentReplyStream(next)) {
      if (!state.chatRunId && payload.runId) {
        state.chatRunId = payload.runId;
        state.chatStreamStartedAt ??= Date.now();
      }
      state.lastError = null;
      state.chatRuntimeSetupHint = null;
      const current = state.chatStream ?? "";
      if (!current || next.length >= current.length) {
        state.chatStream = next;
      }
    }
  } else if (payload.state === "final") {
    const finalMessage = normalizeFinalAssistantMessage(payload.message);
    if (finalMessage && !isAssistantSilentReply(finalMessage)) {
      state.lastError = null;
      state.chatRuntimeSetupHint = null;
      appendChatMessageIfDistinct(state, finalMessage);
    } else if (state.chatStream?.trim() && !isSilentReplyStream(state.chatStream)) {
      state.lastError = null;
      state.chatRuntimeSetupHint = null;
      appendChatMessageIfDistinct(state, {
        role: "assistant",
        content: [{ type: "text", text: state.chatStream }],
        timestamp: Date.now(),
      });
    }
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
  } else if (payload.state === "aborted") {
    const normalizedMessage = normalizeAbortedAssistantMessage(payload.message);
    if (normalizedMessage && !isAssistantSilentReply(normalizedMessage)) {
      state.lastError = null;
      state.chatRuntimeSetupHint = null;
      appendChatMessageIfDistinct(state, normalizedMessage);
    } else {
      const streamedText = state.chatStream ?? "";
      if (streamedText.trim() && !isSilentReplyStream(streamedText)) {
        state.lastError = null;
        state.chatRuntimeSetupHint = null;
        appendChatMessageIfDistinct(state, {
          role: "assistant",
          content: [{ type: "text", text: streamedText }],
          timestamp: Date.now(),
        });
      }
    }
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    state.chatFinalizing = false;
  } else if (payload.state === "error") {
    const runtimeSetupHint = resolveChatRuntimeSetupHint(payload.errorMessage ?? "chat error");
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    state.chatFinalizing = false;
    state.chatRuntimeSetupHint = runtimeSetupHint;
    state.lastError = runtimeSetupHint?.message ?? payload.errorMessage ?? "chat error";
  }
  return payload.state;
}
