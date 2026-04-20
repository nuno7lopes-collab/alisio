import { stripInboundMetadata } from "../../../../src/auto-reply/reply/strip-inbound-meta.js";
import { resetToolStream } from "../app-tool-stream.ts";
import { isImageChatAttachmentMimeType } from "../chat/attachment-support.ts";
import { extractText } from "../chat/message-extract.ts";
import { getOrCreateSessionCacheValue } from "../chat/session-cache.ts";
import { formatConnectError } from "../connect-error.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { generateUUID } from "../uuid.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/;
const PENDING_CHAT_SEND_STALE_MS = 15_000;
const USER_TURN_BURST_DEDUPE_WINDOW_MS = 30_000;
const RECENT_LOCAL_USER_TURN_PRESERVE_MS = 60_000;

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

type PendingChatSendEntry = {
  fingerprint: string;
  runId: string;
  ts: number;
};

type PendingChatSendState = {
  byFingerprint: Map<string, PendingChatSendEntry>;
  fingerprintByRunId: Map<string, string>;
};

const pendingChatSendsBySession = new WeakMap<object, Map<string, PendingChatSendState>>();

function getPendingChatSendState(
  state: Pick<ChatState, "sessionKey">,
  sessionKey?: string,
): PendingChatSendState {
  const resolvedSessionKey = (sessionKey ?? state.sessionKey).trim();
  let perState = pendingChatSendsBySession.get(state as object);
  if (!perState) {
    perState = new Map();
    pendingChatSendsBySession.set(state as object, perState);
  }
  let existing = perState.get(resolvedSessionKey);
  if (!existing) {
    existing = {
      byFingerprint: new Map(),
      fingerprintByRunId: new Map(),
    };
    perState.set(resolvedSessionKey, existing);
  }
  return existing;
}

function buildChatAttachmentFingerprint(attachments: ChatAttachment[]): string {
  return attachments
    .map((attachment) => ({
      dataUrl: attachment.dataUrl,
      fileName: attachment.fileName ?? null,
      mimeType: attachment.mimeType,
    }))
    .map((entry) => JSON.stringify(entry))
    .join("\u0002");
}

function buildPendingChatSendFingerprint(message: string, attachments: ChatAttachment[]): string {
  return JSON.stringify({
    attachments: buildChatAttachmentFingerprint(attachments),
    message: message.trim().replace(/\s+/g, " "),
  });
}

function clearPendingChatSendByRunId(
  state: Pick<ChatState, "sessionKey">,
  runId: string | null | undefined,
  sessionKey?: string,
): void {
  const normalizedRunId = runId?.trim();
  if (!normalizedRunId) {
    return;
  }
  const pending = getPendingChatSendState(state, sessionKey);
  const fingerprint = pending.fingerprintByRunId.get(normalizedRunId);
  if (!fingerprint) {
    return;
  }
  pending.fingerprintByRunId.delete(normalizedRunId);
  const existing = pending.byFingerprint.get(fingerprint);
  if (existing?.runId === normalizedRunId) {
    pending.byFingerprint.delete(fingerprint);
  }
}

function resolvePendingChatSendRunId(
  state: Pick<ChatState, "sessionKey" | "chatRunId" | "chatSending" | "chatFinalizing">,
  fingerprint: string,
  sessionKey?: string,
): string | null {
  const pending = getPendingChatSendState(state, sessionKey);
  const existing = pending.byFingerprint.get(fingerprint);
  if (!existing) {
    return null;
  }
  const ageMs = Date.now() - existing.ts;
  const activeRunId = state.chatRunId?.trim();
  if (
    activeRunId &&
    existing.runId === activeRunId &&
    (state.chatSending || Boolean(state.chatFinalizing))
  ) {
    return existing.runId;
  }
  if (ageMs <= PENDING_CHAT_SEND_STALE_MS) {
    return existing.runId;
  }
  clearPendingChatSendByRunId(state, existing.runId, sessionKey);
  return null;
}

function rememberPendingChatSend(
  state: Pick<ChatState, "sessionKey">,
  params: { fingerprint: string; runId: string; sessionKey?: string; ts: number },
): void {
  const pending = getPendingChatSendState(state, params.sessionKey);
  const entry: PendingChatSendEntry = {
    fingerprint: params.fingerprint,
    runId: params.runId,
    ts: params.ts,
  };
  pending.byFingerprint.set(params.fingerprint, entry);
  pending.fingerprintByRunId.set(params.runId, params.fingerprint);
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
    if (
      previous &&
      (isDuplicateAdjacentMessage(previous, message) ||
        isLikelyRetryDuplicateAdjacentMessage(previous, message))
    ) {
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
  return stripInboundMetadata(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !/^attachments?:\s/i.test(line))
    .join("\n")
    .replace(/\s+/g, " ")
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
  const transcriptMeta =
    entry.__alisio && typeof entry.__alisio === "object" && !Array.isArray(entry.__alisio)
      ? (entry.__alisio as Record<string, unknown>)
      : null;
  const id =
    (typeof entry.toolCallId === "string" && entry.toolCallId.trim()) ||
    (typeof entry.tool_call_id === "string" && entry.tool_call_id.trim()) ||
    (typeof entry.idempotencyKey === "string" && entry.idempotencyKey.trim()) ||
    (typeof entry.id === "string" && entry.id.trim()) ||
    (typeof entry.messageId === "string" && entry.messageId.trim()) ||
    (typeof transcriptMeta?.id === "string" && transcriptMeta.id.trim()) ||
    null;
  return id;
}

function normalizeSessionMessageMimeType(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const [mimeType] = trimmed.split(";", 1);
  const normalized = mimeType?.trim().toLowerCase();
  return normalized || undefined;
}

function extractSessionMessageFileName(value: string): string | undefined {
  const normalized = value.trim().split(/[\\/]/).at(-1)?.trim();
  return normalized || undefined;
}

type SessionMessageMediaDescriptor = {
  mimeType?: string;
  fileName?: string;
};

type SessionMessageImagePreview = {
  mimeType: string;
  data: string;
};

function buildInlineSessionMessageImageBlock(
  preview: SessionMessageImagePreview,
): Record<string, unknown> {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: preview.mimeType,
      data: preview.data,
    },
  };
}

function buildInlineSessionMessageAttachmentBlock(
  descriptor: SessionMessageMediaDescriptor,
): Record<string, unknown> {
  return {
    type: "attachment",
    ...(descriptor.fileName ? { fileName: descriptor.fileName } : {}),
    ...(descriptor.mimeType ? { mimeType: descriptor.mimeType } : {}),
  };
}

function resolveSessionMessageMediaDescriptors(
  message: Record<string, unknown>,
): SessionMessageMediaDescriptor[] {
  const mediaPaths = Array.isArray(message.MediaPaths)
    ? message.MediaPaths.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const mediaTypes = Array.isArray(message.MediaTypes) ? message.MediaTypes : [];
  if (mediaPaths.length > 0) {
    return mediaPaths.map((mediaPath, index) => ({
      mimeType:
        normalizeSessionMessageMimeType(mediaTypes[index]) ??
        (mediaPaths.length === 1 ? normalizeSessionMessageMimeType(message.MediaType) : undefined),
      fileName: extractSessionMessageFileName(mediaPath),
    }));
  }

  const mediaPath =
    typeof message.MediaPath === "string" && message.MediaPath.trim().length > 0
      ? message.MediaPath.trim()
      : "";
  if (!mediaPath) {
    return [];
  }
  return [
    {
      mimeType: normalizeSessionMessageMimeType(message.MediaType),
      fileName: extractSessionMessageFileName(mediaPath),
    },
  ];
}

function resolveSessionMessagePersistedImagePreviews(
  message: Record<string, unknown>,
): SessionMessageImagePreview[] {
  if (!Array.isArray(message.MediaPreviewImages)) {
    return [];
  }
  return message.MediaPreviewImages.map((entry) => {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const candidate = entry as { mimeType?: unknown; data?: unknown };
    const mimeType = normalizeSessionMessageMimeType(candidate.mimeType);
    const data = typeof candidate.data === "string" ? candidate.data.trim() : "";
    if (!mimeType || !isImageChatAttachmentMimeType(mimeType) || !data) {
      return null;
    }
    return { mimeType, data };
  }).filter((entry): entry is SessionMessageImagePreview => entry !== null);
}

function buildNormalizedSessionMessageContent(
  message: Record<string, unknown>,
): Array<Record<string, unknown>> | undefined {
  const attachments = resolveSessionMessageMediaDescriptors(message);
  const persistedPreviews = resolveSessionMessagePersistedImagePreviews(message);
  const hasMedia = attachments.length > 0 || persistedPreviews.length > 0;
  const contentBlocks: Array<Record<string, unknown>> = Array.isArray(message.content)
    ? message.content.filter((block): block is Record<string, unknown> =>
        Boolean(block && typeof block === "object"),
      )
    : [];
  const hadStructuredContent = Array.isArray(message.content);
  const hasStringContent = typeof message.content === "string" && message.content.trim().length > 0;
  const hasTextField = typeof message.text === "string" && message.text.trim().length > 0;
  if (!hadStructuredContent && hasStringContent && hasMedia) {
    contentBlocks.push({ type: "text", text: message.content });
  } else if (!hadStructuredContent && !hasStringContent && hasTextField && hasMedia) {
    contentBlocks.push({ type: "text", text: message.text });
  }

  const hasInlineImageBlockBeforePreviews = contentBlocks.some((block) => {
    const type = block.type;
    return type === "image" || type === "image_url";
  });
  const existingAttachmentKeys = new Set(
    contentBlocks
      .map((block) => {
        if (block.type !== "attachment") {
          return null;
        }
        const fileName = typeof block.fileName === "string" ? block.fileName.trim() : "";
        const mimeType = typeof block.mimeType === "string" ? block.mimeType.trim() : "";
        return fileName || mimeType ? `${fileName}\u0001${mimeType}` : null;
      })
      .filter((key): key is string => key !== null),
  );

  if (!hasInlineImageBlockBeforePreviews && persistedPreviews.length > 0) {
    contentBlocks.push(
      ...persistedPreviews.map((preview) => buildInlineSessionMessageImageBlock(preview)),
    );
  }
  const hasInlineImageBlock = hasInlineImageBlockBeforePreviews || persistedPreviews.length > 0;

  for (const attachment of attachments) {
    const normalizedMime = attachment.mimeType?.trim().toLowerCase();
    if (normalizedMime && isImageChatAttachmentMimeType(normalizedMime) && hasInlineImageBlock) {
      continue;
    }
    const attachmentKey = `${attachment.fileName?.trim() ?? ""}\u0001${normalizedMime ?? ""}`;
    if (existingAttachmentKeys.has(attachmentKey)) {
      continue;
    }
    existingAttachmentKeys.add(attachmentKey);
    contentBlocks.push(buildInlineSessionMessageAttachmentBlock(attachment));
  }

  if (!hadStructuredContent && !hasMedia) {
    return undefined;
  }
  return contentBlocks;
}

function getMessageTimestamp(message: unknown): number | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const timestamp = (message as { timestamp?: unknown }).timestamp;
  return typeof timestamp === "number" ? timestamp : null;
}

function collapseInvisibleRetryHistoryArtifacts(messages: unknown[]): unknown[] {
  if (messages.length === 0) {
    return messages;
  }
  const collapsed: unknown[] = [];
  let retryCandidateUser: unknown = null;
  for (const message of messages) {
    if (isInvisibleAssistantRetryError(message)) {
      const previousVisible = collapsed.at(-1);
      retryCandidateUser =
        previousVisible && normalizeComparableRole(previousVisible) === "user"
          ? previousVisible
          : null;
      continue;
    }
    if (
      retryCandidateUser &&
      normalizeComparableRole(message) === "user" &&
      areSemanticallyEquivalentMessages(retryCandidateUser, message)
    ) {
      retryCandidateUser = null;
      continue;
    }
    retryCandidateUser = null;
    collapsed.push(message);
  }
  return collapsed;
}

function isLikelyRetryDuplicateAdjacentMessage(previous: unknown, next: unknown): boolean {
  if (normalizeComparableRole(previous) !== "user" || normalizeComparableRole(next) !== "user") {
    return false;
  }
  if (!areSemanticallyEquivalentMessages(previous, next)) {
    return false;
  }
  const previousTimestamp = getMessageTimestamp(previous);
  const nextTimestamp = getMessageTimestamp(next);
  if (previousTimestamp === null || nextTimestamp === null) {
    return true;
  }
  return Math.abs(nextTimestamp - previousTimestamp) <= 5 * 60_000;
}

function isInvisibleAssistantRetryError(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
  if (role !== "assistant") {
    return false;
  }
  const hasRenderableText = (extractText(message)?.trim().length ?? 0) > 0;
  if (hasRenderableText || resolveComparableMediaCount(message) > 0) {
    return false;
  }
  const stopReason = typeof entry.stopReason === "string" ? entry.stopReason.toLowerCase() : "";
  const errorMessage = typeof entry.errorMessage === "string" ? entry.errorMessage.trim() : "";
  return stopReason === "error" && errorMessage.length > 0;
}

function resolveInvisibleAssistantRetryErrorMessage(message: unknown): string | null {
  if (!isInvisibleAssistantRetryError(message)) {
    return null;
  }
  const entry = message as Record<string, unknown>;
  const errorMessage = typeof entry.errorMessage === "string" ? entry.errorMessage.trim() : "";
  return errorMessage || null;
}

function resolveLatestHistoryErrorMessage(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role = normalizeComparableRole(message);
    if (role === "user") {
      return null;
    }
    if (role !== "assistant") {
      continue;
    }
    const invisibleError = resolveInvisibleAssistantRetryErrorMessage(message);
    if (invisibleError) {
      return invisibleError;
    }
    return null;
  }
  return null;
}

function areSemanticallyEquivalentMessages(left: unknown, right: unknown): boolean {
  const leftRole = normalizeComparableRole(left);
  const rightRole = normalizeComparableRole(right);
  if (leftRole !== rightRole) {
    return false;
  }

  const leftId = resolveComparableStableId(left);
  const rightId = resolveComparableStableId(right);
  if (leftId && rightId) {
    if (leftId === rightId) {
      return true;
    }
    // Optimistic user turns use idempotencyKey while persisted transcript echoes
    // use transcript ids. Treat them as the same user turn when the visible
    // content matches so reconnects/retries do not duplicate the bubble.
    if (leftRole !== "user") {
      return false;
    }
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

function findEquivalentMessageIndex(messages: unknown[], candidate: unknown): number {
  const candidateStableId = resolveComparableStableId(candidate);
  if (candidateStableId) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (resolveComparableStableId(messages[index]) === candidateStableId) {
        return index;
      }
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (areSemanticallyEquivalentMessages(messages[index], candidate)) {
      return index;
    }
  }

  return -1;
}

function buildBurstDuplicateUserFingerprint(message: unknown): string | null {
  if (normalizeComparableRole(message) !== "user") {
    return null;
  }
  const text = extractComparableMessageText(message);
  const mediaCount = resolveComparableMediaCount(message);
  if (!text && mediaCount <= 0) {
    return null;
  }
  return JSON.stringify({
    mediaCount,
    text,
  });
}

function shouldDropBurstDuplicateUserMessage(messages: unknown[], candidate: unknown): boolean {
  const candidateFingerprint = buildBurstDuplicateUserFingerprint(candidate);
  if (!candidateFingerprint) {
    return false;
  }
  const candidateTimestamp = getMessageTimestamp(candidate);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (buildBurstDuplicateUserFingerprint(existing) !== candidateFingerprint) {
      continue;
    }
    const existingTimestamp = getMessageTimestamp(existing);
    if (candidateTimestamp === null || existingTimestamp === null) {
      return true;
    }
    return Math.abs(candidateTimestamp - existingTimestamp) <= USER_TURN_BURST_DEDUPE_WINDOW_MS;
  }
  return false;
}

function findRecentEquivalentUserTurn(
  messages: unknown[],
  candidate: { text: string; mediaCount: number; timestamp: number },
): { runId: string | null } | null {
  const normalizedText = candidate.text.trim().replace(/\s+/g, " ");
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const existing = messages[index];
    if (normalizeComparableRole(existing) !== "user") {
      continue;
    }
    const existingTimestamp = getMessageTimestamp(existing);
    if (
      existingTimestamp !== null &&
      Math.abs(candidate.timestamp - existingTimestamp) > USER_TURN_BURST_DEDUPE_WINDOW_MS
    ) {
      continue;
    }
    const existingText = extractComparableMessageText(existing).trim().replace(/\s+/g, " ");
    const existingMediaCount = resolveComparableMediaCount(existing);
    if (existingText !== normalizedText || existingMediaCount !== candidate.mediaCount) {
      continue;
    }
    return {
      runId: resolveComparableStableId(existing),
    };
  }
  return null;
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

function extractRecentUnmatchedLocalUserMessages(
  localMessages: unknown[],
  historyMessages: unknown[],
): unknown[] {
  if (localMessages.length === 0) {
    return [];
  }
  const referenceTail = localMessages.slice(-24);
  const referenceTimestamp = Math.max(
    0,
    ...referenceTail.map((message) => getMessageTimestamp(message) ?? 0),
    ...historyMessages.slice(-24).map((message) => getMessageTimestamp(message) ?? 0),
  );

  return localMessages.filter((message) => {
    if (normalizeComparableRole(message) !== "user") {
      return false;
    }
    if (findEquivalentMessageIndex(historyMessages, message) >= 0) {
      return false;
    }
    if (resolveComparableStableId(message)) {
      return true;
    }
    const timestamp = getMessageTimestamp(message);
    if (timestamp == null) {
      return false;
    }
    return referenceTimestamp - timestamp <= RECENT_LOCAL_USER_TURN_PRESERVE_MS;
  });
}

function appendChatMessageIfDistinct(state: ChatState, message: unknown): void {
  const previous = state.chatMessages.at(-1);
  if (
    (previous &&
      (isDuplicateAdjacentMessage(previous, message) ||
        isLikelyRetryDuplicateAdjacentMessage(previous, message))) ||
    shouldDropBurstDuplicateUserMessage(state.chatMessages, message)
  ) {
    return;
  }
  state.chatMessages = dedupeAdjacentChatMessages([...state.chatMessages, message]);
}

function upsertChatMessage(state: ChatState, message: unknown): void {
  const existingIndex = findEquivalentMessageIndex(state.chatMessages, message);
  if (existingIndex < 0) {
    appendChatMessageIfDistinct(state, message);
    return;
  }
  const nextMessages = state.chatMessages.slice();
  nextMessages[existingIndex] = message;
  state.chatMessages = dedupeAdjacentChatMessages(nextMessages);
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
  refreshBrowserPaneBrowserState?: (sessionKey: string) => {
    hasActivity: boolean;
    changed: boolean;
  };
  notifyBrowserPaneActivityForSurface?: (
    sessionKey: string,
    surface: import("./browser-pane.ts").BrowserPaneSurfaceKind,
  ) => void;
};

export type ChatRuntimeSetupHint = {
  title: string;
  message: string;
  ctaLabel: string;
};

const chatHistoryRequestSeq = new WeakMap<object, number>();
const chatHistorySnapshots = new WeakMap<object, Map<string, CachedChatHistorySnapshot>>();

type CachedChatHistorySnapshot = {
  messages: unknown[];
  thinkingLevel: string | null;
  capturedAt: number;
};

function resolveChatHistorySnapshotKey(
  state: Pick<ChatState, "sessionKey">,
  sessionKey?: string,
): string {
  return sessionKey?.trim() || state.sessionKey.trim();
}

function getChatHistorySnapshotStore(state: ChatState): Map<string, CachedChatHistorySnapshot> {
  const existing = chatHistorySnapshots.get(state as object);
  if (existing) {
    return existing;
  }
  const created = new Map<string, CachedChatHistorySnapshot>();
  chatHistorySnapshots.set(state as object, created);
  return created;
}

function writeChatHistorySnapshot(
  state: ChatState,
  sessionKey: string,
  snapshot: CachedChatHistorySnapshot,
): void {
  const store = getChatHistorySnapshotStore(state);
  const cached = getOrCreateSessionCacheValue(store, sessionKey, () => ({
    messages: [],
    thinkingLevel: null,
    capturedAt: 0,
  }));
  cached.messages = [...snapshot.messages];
  cached.thinkingLevel = snapshot.thinkingLevel;
  cached.capturedAt = snapshot.capturedAt;
}

export function rememberChatHistorySnapshot(
  state: ChatState,
  opts?: {
    sessionKey?: string;
    messages?: unknown[];
    thinkingLevel?: string | null;
  },
): void {
  const sessionKey = resolveChatHistorySnapshotKey(state, opts?.sessionKey);
  if (!sessionKey) {
    return;
  }
  writeChatHistorySnapshot(state, sessionKey, {
    messages: [...(opts?.messages ?? state.chatMessages)],
    thinkingLevel: opts?.thinkingLevel ?? state.chatThinkingLevel ?? null,
    capturedAt: Date.now(),
  });
}

export function hydrateChatHistoryFromCache(state: ChatState, sessionKey?: string): boolean {
  const resolvedSessionKey = resolveChatHistorySnapshotKey(state, sessionKey);
  if (!resolvedSessionKey) {
    return false;
  }
  const store = chatHistorySnapshots.get(state as object);
  const cached = store?.get(resolvedSessionKey);
  if (!cached) {
    return false;
  }
  // Refresh insertion order so recently used snapshots stay hot.
  store?.delete(resolvedSessionKey);
  store?.set(resolvedSessionKey, cached);
  state.chatMessages = [...cached.messages];
  state.chatThinkingLevel = cached.thinkingLevel;
  return true;
}

export function clearChatHistorySnapshot(state: ChatState, sessionKey: string | string[]): void {
  const store = chatHistorySnapshots.get(state as object);
  if (!store) {
    return;
  }
  const keys = Array.isArray(sessionKey) ? sessionKey : [sessionKey];
  for (const key of keys) {
    const resolved = resolveChatHistorySnapshotKey(state, key);
    if (!resolved) {
      continue;
    }
    store.delete(resolved);
  }
}

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

export type SessionMessageEventPayload = {
  sessionKey: string;
  message?: unknown;
  messageId?: string;
  messageSeq?: number;
};

function normalizeSessionMessagePayload(
  payload?: SessionMessageEventPayload,
): Record<string, unknown> | null {
  if (!payload?.message || typeof payload.message !== "object" || Array.isArray(payload.message)) {
    return null;
  }
  const record = payload.message as Record<string, unknown>;
  const transcriptMeta =
    record.__alisio && typeof record.__alisio === "object" && !Array.isArray(record.__alisio)
      ? (record.__alisio as Record<string, unknown>)
      : {};
  const messageId =
    (typeof payload.messageId === "string" && payload.messageId.trim()) ||
    (typeof transcriptMeta.id === "string" && transcriptMeta.id.trim()) ||
    "";
  const messageSeq =
    typeof payload.messageSeq === "number" && Number.isFinite(payload.messageSeq)
      ? payload.messageSeq
      : typeof transcriptMeta.seq === "number" && Number.isFinite(transcriptMeta.seq)
        ? transcriptMeta.seq
        : null;
  const content = buildNormalizedSessionMessageContent(record);

  return {
    ...record,
    ...(content ? { content } : {}),
    ...(messageId && typeof record.messageId !== "string" ? { messageId } : {}),
    __alisio: {
      ...transcriptMeta,
      ...(messageId ? { id: messageId } : {}),
      ...(messageSeq != null ? { seq: messageSeq } : {}),
    },
  };
}

export function handleSessionMessageEvent(
  state: ChatState,
  payload?: SessionMessageEventPayload,
): boolean {
  if (!payload || payload.sessionKey !== state.sessionKey) {
    return false;
  }
  const message = normalizeSessionMessagePayload(payload);
  if (!message) {
    return false;
  }
  // Assistant replies already arrive over broadcast chat events for every
  // connected operator UI. Replaying them from session.message would create a
  // second canonical source and can duplicate assistant turns across tabs.
  if (normalizeComparableRole(message) !== "user") {
    return false;
  }
  upsertChatMessage(state, message);
  return true;
}

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

function refreshBrowserPaneBrowserStateIfPresent(
  state: ChatState,
  sessionKey = state.sessionKey,
): { hasActivity: boolean; changed: boolean } {
  return (
    state.refreshBrowserPaneBrowserState?.(sessionKey) ?? {
      hasActivity: false,
      changed: false,
    }
  );
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
    const latestHistoryErrorMessage = resolveLatestHistoryErrorMessage(messages);
    const historyMessages = dedupeAdjacentChatMessages(
      collapseInvisibleRetryHistoryArtifacts(
        messages.filter((message) => !isAssistantSilentReply(message)),
      ),
    );
    const shouldMergeLocalPendingMessages = Boolean(
      opts?.preserveEphemeral || state.chatRunId || state.chatFinalizing,
    );
    const recentUnmatchedUserTurns = shouldMergeLocalPendingMessages
      ? []
      : extractRecentUnmatchedLocalUserMessages(state.chatMessages, historyMessages);
    state.chatMessages = shouldMergeLocalPendingMessages
      ? mergeLocalPendingMessagesIntoHistory(state.chatMessages, historyMessages)
      : recentUnmatchedUserTurns.length > 0
        ? dedupeAdjacentChatMessages(
            mergeUnmatchedMessageSlices(historyMessages, recentUnmatchedUserTurns),
          )
        : historyMessages;
    state.chatThinkingLevel = res.thinkingLevel ?? null;
    state.chatRuntimeSetupHint = latestHistoryErrorMessage
      ? resolveChatRuntimeSetupHint(latestHistoryErrorMessage)
      : null;
    state.lastError = latestHistoryErrorMessage
      ? (state.chatRuntimeSetupHint?.message ?? formatConnectError(latestHistoryErrorMessage))
      : null;
    rememberChatHistorySnapshot(state, {
      sessionKey: requestState.sessionKey,
      messages: state.chatMessages,
      thinkingLevel: state.chatThinkingLevel,
    });
    if (!preserveEphemeral) {
      clearPendingChatSendByRunId(state, state.chatRunId, requestState.sessionKey);
      // Clear all streaming state — history includes tool results and text
      // inline, so keeping streaming artifacts would cause duplicates.
      maybeResetToolStream(state);
      state.chatStream = null;
      state.chatStreamStartedAt = null;
      state.chatFinalizing = false;
    }
    refreshBrowserPaneBrowserStateIfPresent(state, requestState.sessionKey);
  } catch (err) {
    if (!isCurrentChatHistoryRequest(state, requestState)) {
      return;
    }
    if (isMissingOperatorReadScopeError(err)) {
      state.chatMessages = [];
      state.chatThinkingLevel = null;
      rememberChatHistorySnapshot(state, {
        sessionKey: requestState.sessionKey,
        messages: [],
        thinkingLevel: null,
      });
      state.lastError = formatMissingOperatorReadScopeMessage("existing chat history");
    } else {
      state.lastError = String(err);
    }
    refreshBrowserPaneBrowserStateIfPresent(state, requestState.sessionKey);
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
  const normalizedAttachments = hasAttachments ? [...attachments] : [];
  const fingerprint = buildPendingChatSendFingerprint(msg, normalizedAttachments);
  const existingRunId = resolvePendingChatSendRunId(state, fingerprint);
  if (existingRunId) {
    return existingRunId;
  }
  if (state.chatRunId || state.chatFinalizing) {
    const recentEquivalentTurn = findRecentEquivalentUserTurn(state.chatMessages, {
      text: msg,
      mediaCount: normalizedAttachments.length,
      timestamp: now,
    });
    if (recentEquivalentTurn) {
      return state.chatRunId ?? recentEquivalentTurn.runId ?? null;
    }
  }
  const runId = generateUUID();
  rememberPendingChatSend(state, {
    fingerprint,
    runId,
    ts: now,
  });

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

  appendChatMessageIfDistinct(state, {
    role: "user",
    content: contentBlocks,
    timestamp: now,
    idempotencyKey: runId,
  });

  state.chatSending = true;
  state.lastError = null;
  state.chatRuntimeSetupHint = null;
  state.chatFinalizing = false;
  state.chatRunId = runId;
  state.chatStream = "";
  state.chatStreamStartedAt = now;

  // Convert attachments to API format
  const apiAttachments = hasAttachments
    ? normalizedAttachments
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
      appendChatMessageIfDistinct(state, {
        role: "assistant",
        content: [{ type: "text", text: "Error: " + error }],
        timestamp: Date.now(),
      });
    }
    clearPendingChatSendByRunId(state, runId);
    state.chatMessages = dedupeAdjacentChatMessages(
      collapseInvisibleRetryHistoryArtifacts(state.chatMessages),
    );
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

  if (payload.state === "final" || payload.state === "aborted" || payload.state === "error") {
    clearPendingChatSendByRunId(state, payload.runId, payload.sessionKey);
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
    state.chatMessages = dedupeAdjacentChatMessages(
      collapseInvisibleRetryHistoryArtifacts(state.chatMessages),
    );
  }
  const browserPaneRefresh = refreshBrowserPaneBrowserStateIfPresent(state, payload.sessionKey);
  if (browserPaneRefresh.hasActivity && browserPaneRefresh.changed) {
    state.notifyBrowserPaneActivityForSurface?.(payload.sessionKey, "preview");
  }
  return payload.state;
}
