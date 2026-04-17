import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CURRENT_SESSION_VERSION, SessionManager } from "@mariozechner/pi-coding-agent";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { resolveThinkingDefault } from "../../agents/model-selection.js";
import { rewriteTranscriptEntriesInSessionFile } from "../../agents/pi-embedded-runner/transcript-rewrite.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { dispatchInboundMessage } from "../../auto-reply/dispatch.js";
import {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  stripHeartbeatToken,
} from "../../auto-reply/heartbeat.js";
import { createReplyDispatcher } from "../../auto-reply/reply/reply-dispatcher.js";
import { stripInboundMetadata } from "../../auto-reply/reply/strip-inbound-meta.js";
import type { MsgContext } from "../../auto-reply/templating.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import type { ReplyPayload } from "../../auto-reply/types.js";
import { resolveSessionFilePath } from "../../config/sessions.js";
import { readLocalFileSafely } from "../../infra/fs-safe.js";
import { resolveHeartbeatVisibility } from "../../infra/heartbeat-visibility.js";
import { jsonUtf8Bytes } from "../../infra/json-utf8-bytes.js";
import { isWithinDir } from "../../infra/path-safety.js";
import { detectMime, normalizeMimeType } from "../../media/mime.js";
import { type SavedMedia, saveMediaBuffer } from "../../media/store.js";
import { extractOriginalFilename, getMediaDir } from "../../media/store.js";
import { optimizeImageToJpeg } from "../../media/web-media.js";
import { createChannelReplyPipeline } from "../../plugin-sdk/channel-reply-pipeline.js";
import { normalizeInputProvenance, type InputProvenance } from "../../sessions/input-provenance.js";
import { resolveSendPolicy } from "../../sessions/send-policy.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import { emitSessionTranscriptUpdate } from "../../sessions/transcript-events.js";
import { isAlisioDynamicProvider } from "../../shared/alisio-dynamic-provider.js";
import {
  stripInlineDirectiveTagsForDisplay,
  stripInlineDirectiveTagsFromMessageForDisplay,
} from "../../utils/directive-tags.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  isGatewayCliClient,
  isWebchatClient,
  normalizeMessageChannel,
} from "../../utils/message-channel.js";
import {
  abortChatRunById,
  type ChatAbortControllerEntry,
  type ChatAbortOps,
  isChatStopCommandText,
  resolveChatRunExpiresAtMs,
} from "../chat-abort.js";
import {
  type ChatImageContent,
  type ParsedChatAttachment,
  parseChatAttachments,
} from "../chat-attachments.js";
import { stripEnvelopeFromMessage, stripEnvelopeFromMessages } from "../chat-sanitize.js";
import { augmentChatHistoryWithCliSessionImports } from "../cli-session-history.js";
import { ADMIN_SCOPE } from "../method-scopes.js";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  hasGatewayClientCap,
} from "../protocol/client-info.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChatAbortParams,
  validateChatHistoryParams,
  validateChatInjectParams,
  validateChatSendParams,
} from "../protocol/index.js";
import { CHAT_SEND_SESSION_KEY_MAX_LENGTH } from "../protocol/schema/primitives.js";
import { getMaxChatHistoryMessagesBytes } from "../server-constants.js";
import {
  attachAlisioTranscriptMeta,
  capArrayByJsonBytes,
  loadSessionEntry,
  readSessionMessages,
  resolveSessionModelRef,
} from "../session-utils.js";
import { formatForLog } from "../ws-log.js";
import { injectTimestamp, timestampOptsFromConfig } from "./agent-timestamp.js";
import { setGatewayDedupeEntry } from "./agent-wait-dedupe.js";
import { publishAlisioDynamicModelProvidersForContext } from "./alisio.js";
import { normalizeRpcAttachmentsToChatAttachments } from "./attachment-normalize.js";
import { appendInjectedAssistantMessageToTranscript } from "./chat-transcript-inject.js";
import type {
  GatewayRequestContext,
  GatewayRequestHandlerOptions,
  GatewayRequestHandlers,
} from "./types.js";

type TranscriptAppendResult = {
  ok: boolean;
  messageId?: string;
  message?: Record<string, unknown>;
  error?: string;
};

type AbortOrigin = "rpc" | "stop-command";

type AbortedPartialSnapshot = {
  runId: string;
  sessionId: string;
  text: string;
  abortOrigin: AbortOrigin;
};

type ChatAbortRequester = {
  connId?: string;
  deviceId?: string;
  isAdmin: boolean;
};

const CHAT_HISTORY_TEXT_MAX_CHARS = 12_000;
const CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES = 128 * 1024;
const CHAT_HISTORY_OVERSIZED_PLACEHOLDER = "[chat.history omitted: message too large]";
const CHAT_HISTORY_INLINE_IMAGE_MAX_BYTES = 48 * 1024;
const CHAT_HISTORY_ATTACHMENT_READ_MAX_BYTES = 5_000_000;
// Control UI retries and reconnect recovery can replay the same chat.send well
// after the original 10s window. Keep this long enough to collapse duplicate
// sends into the same in-flight/cached run instead of persisting repeated turns.
const CHAT_SEND_SEMANTIC_DEDUPE_WINDOW_MS = 30_000;
let chatHistoryPlaceholderEmitCount = 0;
const CHANNEL_AGNOSTIC_SESSION_SCOPES = new Set([
  "main",
  "direct",
  "dm",
  "group",
  "channel",
  "cron",
  "run",
  "subagent",
  "acp",
  "thread",
  "topic",
]);
const CHANNEL_SCOPED_SESSION_SHAPES = new Set(["direct", "dm", "group", "channel"]);

type ChatSendDeliveryEntry = {
  deliveryContext?: {
    channel?: string;
    to?: string;
    accountId?: string;
    threadId?: string | number;
  };
  origin?: {
    provider?: string;
    accountId?: string;
    threadId?: string | number;
  };
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  lastThreadId?: string | number;
};

type ChatSendOriginatingRoute = {
  originatingChannel: string;
  originatingTo?: string;
  accountId?: string;
  messageThreadId?: string | number;
  explicitDeliverRoute: boolean;
};

type ChatSendExplicitOrigin = {
  originatingChannel?: string;
  originatingTo?: string;
  accountId?: string;
  messageThreadId?: string;
};

type SideResultPayload = {
  kind: "btw";
  runId: string;
  sessionKey: string;
  question: string;
  text: string;
  isError?: boolean;
  ts: number;
};

function resolveChatSendOriginatingRoute(params: {
  client?: { mode?: string | null; id?: string | null } | null;
  deliver?: boolean;
  entry?: ChatSendDeliveryEntry;
  explicitOrigin?: ChatSendExplicitOrigin;
  hasConnectedClient?: boolean;
  mainKey?: string;
  sessionKey: string;
}): ChatSendOriginatingRoute {
  if (params.explicitOrigin?.originatingChannel && params.explicitOrigin.originatingTo) {
    return {
      originatingChannel: params.explicitOrigin.originatingChannel,
      originatingTo: params.explicitOrigin.originatingTo,
      ...(params.explicitOrigin.accountId ? { accountId: params.explicitOrigin.accountId } : {}),
      ...(params.explicitOrigin.messageThreadId
        ? { messageThreadId: params.explicitOrigin.messageThreadId }
        : {}),
      explicitDeliverRoute: params.deliver === true,
    };
  }
  const shouldDeliverExternally = params.deliver === true;
  if (!shouldDeliverExternally) {
    return {
      originatingChannel: INTERNAL_MESSAGE_CHANNEL,
      explicitDeliverRoute: false,
    };
  }

  const routeChannelCandidate = normalizeMessageChannel(
    params.entry?.deliveryContext?.channel ??
      params.entry?.lastChannel ??
      params.entry?.origin?.provider,
  );
  const routeToCandidate = params.entry?.deliveryContext?.to ?? params.entry?.lastTo;
  const routeAccountIdCandidate =
    params.entry?.deliveryContext?.accountId ??
    params.entry?.lastAccountId ??
    params.entry?.origin?.accountId ??
    undefined;
  const routeThreadIdCandidate =
    params.entry?.deliveryContext?.threadId ??
    params.entry?.lastThreadId ??
    params.entry?.origin?.threadId;
  if (params.sessionKey.length > CHAT_SEND_SESSION_KEY_MAX_LENGTH) {
    return {
      originatingChannel: INTERNAL_MESSAGE_CHANNEL,
      explicitDeliverRoute: false,
    };
  }

  const parsedSessionKey = parseAgentSessionKey(params.sessionKey);
  const sessionScopeParts = (parsedSessionKey?.rest ?? params.sessionKey)
    .split(":", 3)
    .filter(Boolean);
  const sessionScopeHead = sessionScopeParts[0];
  const sessionChannelHint = normalizeMessageChannel(sessionScopeHead);
  const normalizedSessionScopeHead = (sessionScopeHead ?? "").trim().toLowerCase();
  const sessionPeerShapeCandidates = [sessionScopeParts[1], sessionScopeParts[2]]
    .map((part) => (part ?? "").trim().toLowerCase())
    .filter(Boolean);
  const isChannelAgnosticSessionScope = CHANNEL_AGNOSTIC_SESSION_SCOPES.has(
    normalizedSessionScopeHead,
  );
  const isChannelScopedSession = sessionPeerShapeCandidates.some((part) =>
    CHANNEL_SCOPED_SESSION_SHAPES.has(part),
  );
  const hasLegacyChannelPeerShape =
    !isChannelScopedSession &&
    typeof sessionScopeParts[1] === "string" &&
    sessionChannelHint === routeChannelCandidate;
  const isFromWebchatClient = isWebchatClient(params.client);
  const isFromGatewayCliClient = isGatewayCliClient(params.client);
  const hasClientMetadata =
    (typeof params.client?.mode === "string" && params.client.mode.trim().length > 0) ||
    (typeof params.client?.id === "string" && params.client.id.trim().length > 0);
  const configuredMainKey = (params.mainKey ?? "main").trim().toLowerCase();
  const isConfiguredMainSessionScope =
    normalizedSessionScopeHead.length > 0 && normalizedSessionScopeHead === configuredMainKey;
  const canInheritConfiguredMainRoute =
    isConfiguredMainSessionScope &&
    params.hasConnectedClient &&
    (isFromGatewayCliClient || !hasClientMetadata);

  // Webchat clients never inherit external delivery routes. Configured-main
  // sessions are stricter than channel-scoped sessions: only CLI callers, or
  // legacy callers with no client metadata, may inherit the last external route.
  const canInheritDeliverableRoute = Boolean(
    !isFromWebchatClient &&
    sessionChannelHint &&
    sessionChannelHint !== INTERNAL_MESSAGE_CHANNEL &&
    ((!isChannelAgnosticSessionScope && (isChannelScopedSession || hasLegacyChannelPeerShape)) ||
      canInheritConfiguredMainRoute),
  );
  const hasDeliverableRoute =
    canInheritDeliverableRoute &&
    routeChannelCandidate &&
    routeChannelCandidate !== INTERNAL_MESSAGE_CHANNEL &&
    typeof routeToCandidate === "string" &&
    routeToCandidate.trim().length > 0;

  if (!hasDeliverableRoute) {
    return {
      originatingChannel: INTERNAL_MESSAGE_CHANNEL,
      explicitDeliverRoute: false,
    };
  }

  return {
    originatingChannel: routeChannelCandidate,
    originatingTo: routeToCandidate,
    accountId: routeAccountIdCandidate,
    messageThreadId: routeThreadIdCandidate,
    explicitDeliverRoute: true,
  };
}

function stripDisallowedChatControlChars(message: string): string {
  let output = "";
  for (const char of message) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      output += char;
    }
  }
  return output;
}

export function sanitizeChatSendMessageInput(
  message: string,
): { ok: true; message: string } | { ok: false; error: string } {
  const normalized = message.normalize("NFC");
  if (normalized.includes("\u0000")) {
    return { ok: false, error: "message must not contain null bytes" };
  }
  return { ok: true, message: stripDisallowedChatControlChars(normalized) };
}

function normalizeOptionalChatSystemReceipt(
  value: unknown,
): { ok: true; receipt?: string } | { ok: false; error: string } {
  if (value == null) {
    return { ok: true };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "systemProvenanceReceipt must be a string" };
  }
  const sanitized = sanitizeChatSendMessageInput(value);
  if (!sanitized.ok) {
    return sanitized;
  }
  const receipt = sanitized.message.trim();
  return { ok: true, receipt: receipt || undefined };
}

function buildChatSendSemanticDedupeKey(params: {
  attachments: Array<{
    content?: unknown;
    fileName?: string;
    mimeType?: string;
    type?: string;
  }>;
  message: string;
  sessionKey: string;
}): string {
  const hash = createHash("sha1");
  hash.update(params.sessionKey.trim());
  hash.update("\u0000");
  hash.update(params.message.trim().replace(/\s+/g, " "));
  for (const attachment of params.attachments) {
    hash.update("\u0001");
    hash.update(typeof attachment.type === "string" ? attachment.type : "");
    hash.update("\u0001");
    hash.update(typeof attachment.mimeType === "string" ? attachment.mimeType : "");
    hash.update("\u0001");
    hash.update(typeof attachment.fileName === "string" ? attachment.fileName : "");
    hash.update("\u0001");
    const content = attachment.content;
    if (typeof content === "string") {
      hash.update(String(content.length));
      hash.update("\u0001");
      hash.update(content);
    } else if (content != null) {
      hash.update(JSON.stringify(content));
    }
  }
  return `chat-semantic:${hash.digest("hex")}`;
}

function readChatSendRunIdFromDedupeEntry(
  entry: GatewayRequestContext["dedupe"] extends Map<string, infer TValue> ? TValue : never,
): string | null {
  const payload = entry.payload as { runId?: unknown } | undefined;
  const runId = typeof payload?.runId === "string" ? payload.runId.trim() : "";
  return runId || null;
}

function isAcpBridgeClient(client: GatewayRequestHandlerOptions["client"]): boolean {
  const info = client?.connect?.client;
  return (
    info?.id === GATEWAY_CLIENT_NAMES.CLI &&
    info?.mode === GATEWAY_CLIENT_MODES.CLI &&
    info?.displayName === "ACP" &&
    info?.version === "acp"
  );
}

function canInjectSystemProvenance(client: GatewayRequestHandlerOptions["client"]): boolean {
  const scopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
  return scopes.includes(ADMIN_SCOPE);
}

async function persistChatSendAttachments(params: {
  attachments: ParsedChatAttachment[];
  client: GatewayRequestHandlerOptions["client"];
  logGateway: GatewayRequestContext["logGateway"];
}): Promise<SavedMedia[]> {
  if (params.attachments.length === 0 || isAcpBridgeClient(params.client)) {
    return [];
  }
  const saved: SavedMedia[] = [];
  for (const attachment of params.attachments) {
    try {
      saved.push(
        await saveMediaBuffer(
          Buffer.from(attachment.base64, "base64"),
          attachment.mimeType,
          "inbound",
          undefined,
          attachment.fileName,
        ),
      );
    } catch (err) {
      params.logGateway.warn(
        `chat.send: failed to persist inbound attachment (${attachment.mimeType}): ${formatForLog(err)}`,
      );
    }
  }
  return saved;
}

function buildChatSendTranscriptMessage(params: {
  message: string;
  savedAttachments: SavedMedia[];
  imagePreviews: ChatHistoryImagePreview[];
  timestamp: number;
  idempotencyKey?: string;
}) {
  const mediaFields = resolveChatSendTranscriptMediaFields(params.savedAttachments);
  return {
    role: "user" as const,
    content: params.message,
    timestamp: params.timestamp,
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    ...mediaFields,
    ...(params.imagePreviews.length > 0 ? { MediaPreviewImages: params.imagePreviews } : {}),
  };
}

function resolveChatSendTranscriptMediaFields(savedAttachments: SavedMedia[]) {
  const mediaPaths = savedAttachments.map((entry) => entry.path);
  if (mediaPaths.length === 0) {
    return {};
  }
  const mediaTypes = savedAttachments.map(
    (entry) => entry.contentType ?? "application/octet-stream",
  );
  return {
    MediaPath: mediaPaths[0],
    MediaPaths: mediaPaths,
    MediaType: mediaTypes[0],
    MediaTypes: mediaTypes,
  };
}

function extractTranscriptUserText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textBlocks = content
    .map((block) =>
      block && typeof block === "object" && "text" in block ? block.text : undefined,
    )
    .filter((text): text is string => typeof text === "string");
  return textBlocks.length > 0 ? textBlocks.join("") : undefined;
}

async function rewriteChatSendUserTurnMediaPaths(params: {
  transcriptPath: string;
  sessionKey: string;
  message: string;
  savedAttachments: SavedMedia[];
  idempotencyKey?: string;
}) {
  const mediaFields = resolveChatSendTranscriptMediaFields(params.savedAttachments);
  if (!("MediaPath" in mediaFields)) {
    return;
  }
  const sessionManager = SessionManager.open(params.transcriptPath);
  const branch = sessionManager.getBranch();
  const stableMessageId =
    typeof params.idempotencyKey === "string" && params.idempotencyKey.trim()
      ? params.idempotencyKey.trim()
      : undefined;
  const target = [...branch].toReversed().find((entry) => {
    if (entry.type !== "message" || entry.message.role !== "user") {
      return false;
    }
    if (
      stableMessageId &&
      typeof (entry.message as { idempotencyKey?: unknown }).idempotencyKey === "string" &&
      (entry.message as { idempotencyKey?: string }).idempotencyKey === stableMessageId
    ) {
      return true;
    }
    const existingPaths = Array.isArray((entry.message as { MediaPaths?: unknown }).MediaPaths)
      ? (entry.message as { MediaPaths?: unknown[] }).MediaPaths
      : undefined;
    if (
      (typeof (entry.message as { MediaPath?: unknown }).MediaPath === "string" &&
        (entry.message as { MediaPath?: string }).MediaPath) ||
      (existingPaths && existingPaths.length > 0)
    ) {
      return false;
    }
    return (
      extractTranscriptUserText((entry.message as { content?: unknown }).content) === params.message
    );
  });
  if (!target || target.type !== "message") {
    return;
  }
  const rewrittenMessage = {
    ...target.message,
    ...(stableMessageId ? { idempotencyKey: stableMessageId } : {}),
    ...mediaFields,
  };
  await rewriteTranscriptEntriesInSessionFile({
    sessionFile: params.transcriptPath,
    sessionKey: params.sessionKey,
    request: {
      replacements: [
        {
          entryId: target.id,
          message: rewrittenMessage,
        },
      ],
    },
  });
}

function truncateChatHistoryText(text: string): { text: string; truncated: boolean } {
  if (text.length <= CHAT_HISTORY_TEXT_MAX_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, CHAT_HISTORY_TEXT_MAX_CHARS)}\n...(truncated)...`,
    truncated: true,
  };
}

type ChatHistoryMediaDescriptor = {
  path: string;
  mimeType?: string;
  fileName?: string;
};

type ChatHistoryImagePreview = {
  mimeType: string;
  data: string;
};

function normalizeChatHistoryMediaMime(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return normalizeMimeType(value);
}

function resolveChatHistoryMediaDescriptors(
  message: Record<string, unknown>,
): ChatHistoryMediaDescriptor[] {
  const mediaPaths = Array.isArray(message.MediaPaths)
    ? message.MediaPaths.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const mediaTypes = Array.isArray(message.MediaTypes) ? message.MediaTypes : [];
  if (mediaPaths.length > 0) {
    return mediaPaths.map((mediaPath, index) => ({
      path: mediaPath,
      mimeType:
        normalizeChatHistoryMediaMime(mediaTypes[index]) ??
        (mediaPaths.length === 1 ? normalizeChatHistoryMediaMime(message.MediaType) : undefined),
      fileName: extractOriginalFilename(mediaPath),
    }));
  }

  const mediaPath =
    typeof message.MediaPath === "string" && message.MediaPath.trim().length > 0
      ? message.MediaPath
      : undefined;
  if (!mediaPath) {
    return [];
  }
  return [
    {
      path: mediaPath,
      mimeType: normalizeChatHistoryMediaMime(message.MediaType),
      fileName: extractOriginalFilename(mediaPath),
    },
  ];
}

async function buildChatHistoryImagePreview(params: {
  buffer: Buffer;
  mimeType?: string;
  filePath?: string;
  fileName?: string;
}): Promise<ChatHistoryImagePreview | null> {
  const detectedMime = normalizeChatHistoryMediaMime(
    await detectMime({
      buffer: params.buffer,
      headerMime: params.mimeType,
      filePath: params.filePath,
    }),
  );
  if (!detectedMime?.startsWith("image/")) {
    return null;
  }

  let previewBuffer = params.buffer;
  let previewMime = detectedMime;
  if (previewBuffer.byteLength > CHAT_HISTORY_INLINE_IMAGE_MAX_BYTES) {
    const optimized = await optimizeImageToJpeg(
      previewBuffer,
      CHAT_HISTORY_INLINE_IMAGE_MAX_BYTES,
      {
        contentType: detectedMime,
        fileName: params.fileName,
      },
    );
    previewBuffer = optimized.buffer;
    previewMime = "image/jpeg";
  }

  return {
    mimeType: previewMime,
    data: previewBuffer.toString("base64"),
  };
}

function buildInlineChatHistoryImageBlock(
  preview: ChatHistoryImagePreview,
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

function buildInlineChatHistoryAttachmentBlock(
  attachment: ChatHistoryMediaDescriptor,
): Record<string, unknown> {
  return {
    type: "attachment",
    ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
  };
}

function resolveChatHistoryPersistedImagePreviews(
  message: Record<string, unknown>,
): ChatHistoryImagePreview[] {
  const raw = message.MediaPreviewImages;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as { mimeType?: unknown; data?: unknown };
      const mimeType = normalizeChatHistoryMediaMime(candidate.mimeType);
      const data = typeof candidate.data === "string" ? candidate.data.trim() : "";
      if (!mimeType?.startsWith("image/") || !data) {
        return null;
      }
      return { mimeType, data };
    })
    .filter((entry): entry is ChatHistoryImagePreview => entry !== null);
}

async function buildInlineChatHistoryImageBlockFromAttachment(
  attachment: ChatHistoryMediaDescriptor,
): Promise<Record<string, unknown> | null> {
  const mediaRoot = path.resolve(getMediaDir());
  const filePath = path.resolve(attachment.path);
  if (!isWithinDir(mediaRoot, filePath)) {
    return null;
  }

  const { buffer } = await readLocalFileSafely({
    filePath,
    maxBytes: CHAT_HISTORY_ATTACHMENT_READ_MAX_BYTES,
  });
  const preview = await buildChatHistoryImagePreview({
    buffer,
    mimeType: attachment.mimeType,
    filePath,
    fileName: attachment.fileName,
  });
  if (!preview) {
    return null;
  }

  return buildInlineChatHistoryImageBlock(preview);
}

async function buildPersistedChatImagePreviews(
  attachments: ParsedChatAttachment[],
): Promise<ChatHistoryImagePreview[]> {
  const previews = await Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.kind !== "image") {
        return null;
      }
      return await buildChatHistoryImagePreview({
        buffer: Buffer.from(attachment.base64, "base64"),
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
      });
    }),
  );
  return previews.filter((preview): preview is ChatHistoryImagePreview => preview !== null);
}

async function rehydrateChatHistoryMessageMedia(message: unknown): Promise<unknown> {
  if (!message || typeof message !== "object") {
    return message;
  }
  const entry = message as Record<string, unknown>;
  const attachments = resolveChatHistoryMediaDescriptors(entry);
  if (attachments.length === 0) {
    return message;
  }

  const contentBlocks: Array<Record<string, unknown>> = Array.isArray(entry.content)
    ? entry.content.filter((block): block is Record<string, unknown> =>
        Boolean(block && typeof block === "object"),
      )
    : [];
  if (
    contentBlocks.length === 0 &&
    typeof entry.content === "string" &&
    entry.content.trim().length > 0
  ) {
    contentBlocks.push({ type: "text", text: entry.content });
  }

  const hasInlineImageBlock = contentBlocks.some((block) => {
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

  const persistedPreviews = resolveChatHistoryPersistedImagePreviews(entry);
  if (!hasInlineImageBlock && persistedPreviews.length > 0) {
    contentBlocks.push(
      ...persistedPreviews.map((preview) => buildInlineChatHistoryImageBlock(preview)),
    );
  }

  if (!hasInlineImageBlock && persistedPreviews.length === 0) {
    for (const attachment of attachments) {
      try {
        const imageBlock = await buildInlineChatHistoryImageBlockFromAttachment(attachment);
        if (imageBlock) {
          contentBlocks.push(imageBlock);
          break;
        }
      } catch {
        // Keep history shape unchanged when preview generation fails.
      }
    }
  }

  for (const attachment of attachments) {
    const normalizedMime = attachment.mimeType?.trim().toLowerCase();
    if (normalizedMime?.startsWith("image/")) {
      continue;
    }
    const attachmentKey = `${attachment.fileName?.trim() ?? ""}\u0001${normalizedMime ?? ""}`;
    if (existingAttachmentKeys.has(attachmentKey)) {
      continue;
    }
    existingAttachmentKeys.add(attachmentKey);
    contentBlocks.push(buildInlineChatHistoryAttachmentBlock(attachment));
  }

  if (contentBlocks.length === 0) {
    return message;
  }

  return {
    ...entry,
    content: contentBlocks,
  };
}

async function rehydrateChatHistoryMessagesWithMedia(messages: unknown[]): Promise<unknown[]> {
  if (messages.length === 0) {
    return messages;
  }
  return await Promise.all(messages.map((message) => rehydrateChatHistoryMessageMedia(message)));
}

function sanitizeThinkingSignatureForHistory(value: unknown):
  | {
      type: "reasoning.summary";
    }
  | undefined {
  let type: string | undefined;
  if (value && typeof value === "object") {
    const candidate = (value as { type?: unknown }).type;
    type = typeof candidate === "string" ? candidate.trim() : undefined;
  } else if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as { type?: unknown };
      type = typeof parsed.type === "string" ? parsed.type.trim() : undefined;
    } catch {
      const trimmed = value.trim();
      type = trimmed || undefined;
    }
  }
  return type === "reasoning.summary" ? { type: "reasoning.summary" } : undefined;
}

function sanitizeChatHistoryContentBlock(block: unknown): { block: unknown; changed: boolean } {
  if (!block || typeof block !== "object") {
    return { block, changed: false };
  }
  const entry = { ...(block as Record<string, unknown>) };
  let changed = false;
  if (typeof entry.text === "string") {
    const stripped = stripInlineDirectiveTagsForDisplay(entry.text);
    const res = truncateChatHistoryText(stripped.text);
    entry.text = res.text;
    changed ||= stripped.changed || res.truncated;
  }
  if (typeof entry.partialJson === "string") {
    const res = truncateChatHistoryText(entry.partialJson);
    entry.partialJson = res.text;
    changed ||= res.truncated;
  }
  if (typeof entry.arguments === "string") {
    const res = truncateChatHistoryText(entry.arguments);
    entry.arguments = res.text;
    changed ||= res.truncated;
  }
  if (typeof entry.thinking === "string") {
    const res = truncateChatHistoryText(entry.thinking);
    entry.thinking = res.text;
    changed ||= res.truncated;
  }
  if ("thinkingSignature" in entry) {
    const sanitizedSignature = sanitizeThinkingSignatureForHistory(entry.thinkingSignature);
    if (sanitizedSignature) {
      const original = entry.thinkingSignature;
      const originalIsMinimalSummary =
        original &&
        typeof original === "object" &&
        (original as { type?: unknown }).type === sanitizedSignature.type &&
        Object.keys(original as Record<string, unknown>).length === 1;
      if (!originalIsMinimalSummary) {
        entry.thinkingSignature = sanitizedSignature;
        changed = true;
      }
    } else {
      delete entry.thinkingSignature;
      changed = true;
    }
  }
  const type = typeof entry.type === "string" ? entry.type : "";
  if (type === "image" && typeof entry.data === "string") {
    const bytes = Buffer.byteLength(entry.data, "utf8");
    delete entry.data;
    entry.omitted = true;
    entry.bytes = bytes;
    changed = true;
  }
  return { block: changed ? entry : block, changed };
}

/**
 * Validate that a value is a finite number, returning undefined otherwise.
 */
function toFiniteNumber(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

/**
 * Sanitize usage metadata to ensure only finite numeric fields are included.
 * Prevents UI crashes from malformed transcript JSON.
 */
function sanitizeUsage(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const u = raw as Record<string, unknown>;
  const out: Record<string, number> = {};

  // Whitelist known usage fields and validate they're finite numbers
  const knownFields = [
    "input",
    "output",
    "totalTokens",
    "inputTokens",
    "outputTokens",
    "cacheRead",
    "cacheWrite",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
  ];

  for (const k of knownFields) {
    const n = toFiniteNumber(u[k]);
    if (n !== undefined) {
      out[k] = n;
    }
  }

  // Preserve nested usage.cost when present
  if ("cost" in u && u.cost != null && typeof u.cost === "object") {
    const sanitizedCost = sanitizeCost(u.cost);
    if (sanitizedCost) {
      (out as Record<string, unknown>).cost = sanitizedCost;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Sanitize cost metadata to ensure only finite numeric fields are included.
 * Prevents UI crashes from calling .toFixed() on non-numbers.
 */
function sanitizeCost(raw: unknown): { total?: number } | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const c = raw as Record<string, unknown>;
  const total = toFiniteNumber(c.total);
  return total !== undefined ? { total } : undefined;
}

function sanitizeChatHistoryMessage(message: unknown): { message: unknown; changed: boolean } {
  if (!message || typeof message !== "object") {
    return { message, changed: false };
  }
  const entry = { ...(message as Record<string, unknown>) };
  let changed = false;

  if ("details" in entry) {
    delete entry.details;
    changed = true;
  }

  // Keep usage/cost so the chat UI can render per-message token and cost badges.
  // Only retain usage/cost on assistant messages and validate numeric fields to prevent UI crashes.
  if (entry.role !== "assistant") {
    if ("usage" in entry) {
      delete entry.usage;
      changed = true;
    }
    if ("cost" in entry) {
      delete entry.cost;
      changed = true;
    }
  } else {
    // Validate and sanitize usage/cost for assistant messages
    if ("usage" in entry) {
      const sanitized = sanitizeUsage(entry.usage);
      if (sanitized) {
        entry.usage = sanitized;
      } else {
        delete entry.usage;
      }
      changed = true;
    }
    if ("cost" in entry) {
      const sanitized = sanitizeCost(entry.cost);
      if (sanitized) {
        entry.cost = sanitized;
      } else {
        delete entry.cost;
      }
      changed = true;
    }
  }

  if (typeof entry.content === "string") {
    const stripped = stripInlineDirectiveTagsForDisplay(entry.content);
    const res = truncateChatHistoryText(stripped.text);
    entry.content = res.text;
    changed ||= stripped.changed || res.truncated;
  } else if (Array.isArray(entry.content)) {
    const updated = entry.content.map((block) => sanitizeChatHistoryContentBlock(block));
    if (updated.some((item) => item.changed)) {
      entry.content = updated.map((item) => item.block);
      changed = true;
    }
  }

  if (typeof entry.text === "string") {
    const stripped = stripInlineDirectiveTagsForDisplay(entry.text);
    const res = truncateChatHistoryText(stripped.text);
    entry.text = res.text;
    changed ||= stripped.changed || res.truncated;
  }

  return { message: changed ? entry : message, changed };
}

/**
 * Extract the visible text from an assistant history message for silent-token checks.
 * Returns `undefined` for non-assistant messages or messages with no extractable text.
 * When `entry.text` is present it takes precedence over `entry.content` to avoid
 * dropping messages that carry real text alongside a stale `content: "NO_REPLY"`.
 */
function extractAssistantTextForSilentCheck(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const entry = message as Record<string, unknown>;
  if (entry.role !== "assistant") {
    return undefined;
  }
  if (typeof entry.text === "string") {
    return entry.text;
  }
  if (typeof entry.content === "string") {
    return entry.content;
  }
  if (!Array.isArray(entry.content) || entry.content.length === 0) {
    return undefined;
  }

  const texts: string[] = [];
  for (const block of entry.content) {
    if (!block || typeof block !== "object") {
      return undefined;
    }
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type !== "text" || typeof typed.text !== "string") {
      return undefined;
    }
    texts.push(typed.text);
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}

function assistantHistoryMessageHasMedia(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  if (typeof entry.MediaPath === "string" && entry.MediaPath.trim().length > 0) {
    return true;
  }
  if (
    Array.isArray(entry.MediaPaths) &&
    entry.MediaPaths.some((value) => typeof value === "string" && value.trim().length > 0)
  ) {
    return true;
  }
  if (!Array.isArray(entry.content)) {
    return false;
  }
  return entry.content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const type = (block as { type?: unknown }).type;
    return type === "image" || type === "image_url" || type === "attachment";
  });
}

function shouldHideHeartbeatHistoryMessage(
  text: string,
  cfg: Parameters<typeof resolveHeartbeatVisibility>[0]["cfg"],
): boolean {
  const visibility = resolveHeartbeatVisibility({ cfg, channel: "webchat" });
  if (visibility.showOk) {
    return false;
  }
  const stripped = stripHeartbeatToken(text, {
    mode: "heartbeat",
    maxAckChars: cfg.agents?.defaults?.heartbeat?.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  });
  return stripped.didStrip && stripped.shouldSkip;
}

function normalizeChatHistoryRole(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "unknown";
  }
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role.trim().toLowerCase() : "unknown";
}

function extractChatHistoryComparableText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const entry = message as { content?: unknown; text?: unknown };
  if (typeof entry.content === "string") {
    return stripInboundMetadata(entry.content).trim();
  }
  if (Array.isArray(entry.content)) {
    return entry.content
      .map((block) =>
        block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
          ? stripInboundMetadata((block as { text: string }).text).trim()
          : "",
      )
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return typeof entry.text === "string" ? stripInboundMetadata(entry.text).trim() : "";
}

function isInvisibleRetryHistoryMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as {
    role?: unknown;
    content?: unknown;
    text?: unknown;
    stopReason?: unknown;
    errorMessage?: unknown;
  };
  if (normalizeChatHistoryRole(message) !== "assistant") {
    return false;
  }
  const hasVisibleText = extractChatHistoryComparableText(message).length > 0;
  if (hasVisibleText || assistantHistoryMessageHasMedia(message)) {
    return false;
  }
  return (
    typeof entry.stopReason === "string" &&
    entry.stopReason.trim().toLowerCase() === "error" &&
    typeof entry.errorMessage === "string" &&
    entry.errorMessage.trim().length > 0
  );
}

function areEquivalentRetryDuplicateUserMessages(previous: unknown, next: unknown): boolean {
  return (
    normalizeChatHistoryRole(previous) === "user" &&
    normalizeChatHistoryRole(next) === "user" &&
    extractChatHistoryComparableText(previous).length > 0 &&
    extractChatHistoryComparableText(previous) === extractChatHistoryComparableText(next)
  );
}

function readChatHistoryMessageTimestamp(message: unknown): number | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const timestamp = (message as { timestamp?: unknown }).timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : null;
}

function collapseInvisibleRetryHistoryArtifacts(messages: unknown[]): unknown[] {
  if (messages.length === 0) {
    return messages;
  }
  const collapsed: unknown[] = [];
  let retryCandidateUser: unknown = null;
  let changed = false;
  for (const message of messages) {
    if (isInvisibleRetryHistoryMessage(message)) {
      const previousVisible = collapsed.at(-1);
      retryCandidateUser =
        previousVisible && normalizeChatHistoryRole(previousVisible) === "user"
          ? previousVisible
          : null;
      changed = true;
      continue;
    }
    if (
      retryCandidateUser &&
      areEquivalentRetryDuplicateUserMessages(retryCandidateUser, message)
    ) {
      retryCandidateUser = null;
      changed = true;
      continue;
    }
    retryCandidateUser = null;
    collapsed.push(message);
  }
  return changed ? collapsed : messages;
}

function collapseAdjacentRetryDuplicateUserMessages(messages: unknown[]): unknown[] {
  if (messages.length < 2) {
    return messages;
  }
  const collapsed: unknown[] = [];
  let changed = false;
  for (const message of messages) {
    const previous = collapsed.at(-1);
    if (previous && areEquivalentRetryDuplicateUserMessages(previous, message)) {
      const previousTs = readChatHistoryMessageTimestamp(previous);
      const nextTs = readChatHistoryMessageTimestamp(message);
      if (previousTs === null || nextTs === null || Math.abs(nextTs - previousTs) <= 5 * 60_000) {
        changed = true;
        continue;
      }
    }
    collapsed.push(message);
  }
  return changed ? collapsed : messages;
}

function sanitizeChatHistoryMessages(
  messages: unknown[],
  cfg: Parameters<typeof resolveHeartbeatVisibility>[0]["cfg"],
): unknown[] {
  if (messages.length === 0) {
    return messages;
  }
  const retryCollapsed = collapseAdjacentRetryDuplicateUserMessages(
    collapseInvisibleRetryHistoryArtifacts(messages),
  );
  let changed = false;
  const next: unknown[] = [];
  if (retryCollapsed !== messages) {
    changed = true;
  }
  for (const message of retryCollapsed) {
    const res = sanitizeChatHistoryMessage(message);
    changed ||= res.changed;
    // Drop assistant messages whose entire visible text is the silent reply token.
    const text = extractAssistantTextForSilentCheck(res.message);
    if (text !== undefined && isSilentReplyText(text, SILENT_REPLY_TOKEN)) {
      changed = true;
      continue;
    }
    if (
      text !== undefined &&
      !assistantHistoryMessageHasMedia(res.message) &&
      shouldHideHeartbeatHistoryMessage(text, cfg)
    ) {
      changed = true;
      continue;
    }
    next.push(res.message);
  }
  return changed ? next : messages;
}

function buildOversizedHistoryPlaceholder(message?: unknown): Record<string, unknown> {
  const role =
    message &&
    typeof message === "object" &&
    typeof (message as { role?: unknown }).role === "string"
      ? (message as { role: string }).role
      : "assistant";
  const timestamp =
    message &&
    typeof message === "object" &&
    typeof (message as { timestamp?: unknown }).timestamp === "number"
      ? (message as { timestamp: number }).timestamp
      : Date.now();
  return attachAlisioTranscriptMeta(
    {
      role,
      timestamp,
      content: [{ type: "text", text: CHAT_HISTORY_OVERSIZED_PLACEHOLDER }],
    },
    { truncated: true, reason: "oversized" },
  ) as Record<string, unknown>;
}

function replaceOversizedChatHistoryMessages(params: {
  messages: unknown[];
  maxSingleMessageBytes: number;
}): { messages: unknown[]; replacedCount: number } {
  const { messages, maxSingleMessageBytes } = params;
  if (messages.length === 0) {
    return { messages, replacedCount: 0 };
  }
  let replacedCount = 0;
  const next = messages.map((message) => {
    if (jsonUtf8Bytes(message) <= maxSingleMessageBytes) {
      return message;
    }
    replacedCount += 1;
    return buildOversizedHistoryPlaceholder(message);
  });
  return { messages: replacedCount > 0 ? next : messages, replacedCount };
}

function enforceChatHistoryFinalBudget(params: { messages: unknown[]; maxBytes: number }): {
  messages: unknown[];
  placeholderCount: number;
} {
  const { messages, maxBytes } = params;
  if (messages.length === 0) {
    return { messages, placeholderCount: 0 };
  }
  if (jsonUtf8Bytes(messages) <= maxBytes) {
    return { messages, placeholderCount: 0 };
  }
  const last = messages.at(-1);
  if (last && jsonUtf8Bytes([last]) <= maxBytes) {
    return { messages: [last], placeholderCount: 0 };
  }
  const placeholder = buildOversizedHistoryPlaceholder(last);
  if (jsonUtf8Bytes([placeholder]) <= maxBytes) {
    return { messages: [placeholder], placeholderCount: 1 };
  }
  return { messages: [], placeholderCount: 0 };
}

function resolveTranscriptPath(params: {
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
}): string | null {
  const { sessionId, storePath, sessionFile, agentId } = params;
  if (!storePath && !sessionFile) {
    return null;
  }
  try {
    const sessionsDir = storePath ? path.dirname(storePath) : undefined;
    return resolveSessionFilePath(
      sessionId,
      sessionFile ? { sessionFile } : undefined,
      sessionsDir || agentId ? { sessionsDir, agentId } : undefined,
    );
  } catch {
    return null;
  }
}

function ensureTranscriptFile(params: { transcriptPath: string; sessionId: string }): {
  ok: boolean;
  error?: string;
} {
  if (fs.existsSync(params.transcriptPath)) {
    return { ok: true };
  }
  try {
    fs.mkdirSync(path.dirname(params.transcriptPath), { recursive: true });
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: params.sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    fs.writeFileSync(params.transcriptPath, `${JSON.stringify(header)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function transcriptHasIdempotencyKey(transcriptPath: string, idempotencyKey: string): boolean {
  try {
    const lines = fs.readFileSync(transcriptPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const parsed = JSON.parse(line) as { message?: { idempotencyKey?: unknown } };
      if (parsed?.message?.idempotencyKey === idempotencyKey) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function appendAssistantTranscriptMessage(params: {
  message: string;
  label?: string;
  sessionId: string;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
  createIfMissing?: boolean;
  idempotencyKey?: string;
  abortMeta?: {
    aborted: true;
    origin: AbortOrigin;
    runId: string;
  };
}): TranscriptAppendResult {
  const transcriptPath = resolveTranscriptPath({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
    agentId: params.agentId,
  });
  if (!transcriptPath) {
    return { ok: false, error: "transcript path not resolved" };
  }

  if (!fs.existsSync(transcriptPath)) {
    if (!params.createIfMissing) {
      return { ok: false, error: "transcript file not found" };
    }
    const ensured = ensureTranscriptFile({
      transcriptPath,
      sessionId: params.sessionId,
    });
    if (!ensured.ok) {
      return { ok: false, error: ensured.error ?? "failed to create transcript file" };
    }
  }

  if (params.idempotencyKey && transcriptHasIdempotencyKey(transcriptPath, params.idempotencyKey)) {
    return { ok: true };
  }

  return appendInjectedAssistantMessageToTranscript({
    transcriptPath,
    message: params.message,
    label: params.label,
    idempotencyKey: params.idempotencyKey,
    abortMeta: params.abortMeta,
  });
}

function collectSessionAbortPartials(params: {
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  chatRunBuffers: Map<string, string>;
  runIds: ReadonlySet<string>;
  abortOrigin: AbortOrigin;
}): AbortedPartialSnapshot[] {
  const out: AbortedPartialSnapshot[] = [];
  for (const [runId, active] of params.chatAbortControllers) {
    if (!params.runIds.has(runId)) {
      continue;
    }
    const text = params.chatRunBuffers.get(runId);
    if (!text || !text.trim()) {
      continue;
    }
    out.push({
      runId,
      sessionId: active.sessionId,
      text,
      abortOrigin: params.abortOrigin,
    });
  }
  return out;
}

function persistAbortedPartials(params: {
  context: Pick<GatewayRequestContext, "logGateway">;
  sessionKey: string;
  snapshots: AbortedPartialSnapshot[];
}) {
  if (params.snapshots.length === 0) {
    return;
  }
  const { storePath, entry } = loadSessionEntry(params.sessionKey);
  for (const snapshot of params.snapshots) {
    const sessionId = entry?.sessionId ?? snapshot.sessionId ?? snapshot.runId;
    const appended = appendAssistantTranscriptMessage({
      message: snapshot.text,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      createIfMissing: true,
      idempotencyKey: `${snapshot.runId}:assistant`,
      abortMeta: {
        aborted: true,
        origin: snapshot.abortOrigin,
        runId: snapshot.runId,
      },
    });
    if (!appended.ok) {
      params.context.logGateway.warn(
        `chat.abort transcript append failed: ${appended.error ?? "unknown error"}`,
      );
    }
  }
}

function createChatAbortOps(context: GatewayRequestContext): ChatAbortOps {
  return {
    chatAbortControllers: context.chatAbortControllers,
    chatRunBuffers: context.chatRunBuffers,
    chatDeltaSentAt: context.chatDeltaSentAt,
    chatDeltaLastBroadcastLen: context.chatDeltaLastBroadcastLen,
    chatAbortedRuns: context.chatAbortedRuns,
    removeChatRun: context.removeChatRun,
    agentRunSeq: context.agentRunSeq,
    broadcast: context.broadcast,
    nodeSendToSession: context.nodeSendToSession,
  };
}

function normalizeOptionalText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeExplicitChatSendOrigin(
  params: ChatSendExplicitOrigin,
): { ok: true; value?: ChatSendExplicitOrigin } | { ok: false; error: string } {
  const originatingChannel = normalizeOptionalText(params.originatingChannel);
  const originatingTo = normalizeOptionalText(params.originatingTo);
  const accountId = normalizeOptionalText(params.accountId);
  const messageThreadId = normalizeOptionalText(params.messageThreadId);
  const hasAnyExplicitOriginField = Boolean(
    originatingChannel || originatingTo || accountId || messageThreadId,
  );
  if (!hasAnyExplicitOriginField) {
    return { ok: true };
  }
  const normalizedChannel = normalizeMessageChannel(originatingChannel);
  if (!normalizedChannel) {
    return {
      ok: false,
      error: "originatingChannel is required when using originating route fields",
    };
  }
  if (!originatingTo) {
    return {
      ok: false,
      error: "originatingTo is required when using originating route fields",
    };
  }
  return {
    ok: true,
    value: {
      originatingChannel: normalizedChannel,
      originatingTo,
      ...(accountId ? { accountId } : {}),
      ...(messageThreadId ? { messageThreadId } : {}),
    },
  };
}

function resolveChatAbortRequester(
  client: GatewayRequestHandlerOptions["client"],
): ChatAbortRequester {
  const scopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
  return {
    connId: normalizeOptionalText(client?.connId),
    deviceId: normalizeOptionalText(client?.connect?.device?.id),
    isAdmin: scopes.includes(ADMIN_SCOPE),
  };
}

function canRequesterAbortChatRun(
  entry: ChatAbortControllerEntry,
  requester: ChatAbortRequester,
): boolean {
  if (requester.isAdmin) {
    return true;
  }
  const ownerDeviceId = normalizeOptionalText(entry.ownerDeviceId);
  const ownerConnId = normalizeOptionalText(entry.ownerConnId);
  if (!ownerDeviceId && !ownerConnId) {
    return true;
  }
  if (ownerDeviceId && requester.deviceId && ownerDeviceId === requester.deviceId) {
    return true;
  }
  if (ownerConnId && requester.connId && ownerConnId === requester.connId) {
    return true;
  }
  return false;
}

function resolveAuthorizedRunIdsForSession(params: {
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  sessionKey: string;
  requester: ChatAbortRequester;
}) {
  const authorizedRunIds: string[] = [];
  let matchedSessionRuns = 0;
  for (const [runId, active] of params.chatAbortControllers) {
    if (active.sessionKey !== params.sessionKey) {
      continue;
    }
    matchedSessionRuns += 1;
    if (canRequesterAbortChatRun(active, params.requester)) {
      authorizedRunIds.push(runId);
    }
  }
  return {
    matchedSessionRuns,
    authorizedRunIds,
  };
}

function abortChatRunsForSessionKeyWithPartials(params: {
  context: GatewayRequestContext;
  ops: ChatAbortOps;
  sessionKey: string;
  abortOrigin: AbortOrigin;
  stopReason?: string;
  requester: ChatAbortRequester;
}) {
  const { matchedSessionRuns, authorizedRunIds } = resolveAuthorizedRunIdsForSession({
    chatAbortControllers: params.context.chatAbortControllers,
    sessionKey: params.sessionKey,
    requester: params.requester,
  });
  if (authorizedRunIds.length === 0) {
    return {
      aborted: false,
      runIds: [],
      unauthorized: matchedSessionRuns > 0,
    };
  }
  const authorizedRunIdSet = new Set(authorizedRunIds);
  const snapshots = collectSessionAbortPartials({
    chatAbortControllers: params.context.chatAbortControllers,
    chatRunBuffers: params.context.chatRunBuffers,
    runIds: authorizedRunIdSet,
    abortOrigin: params.abortOrigin,
  });
  const runIds: string[] = [];
  for (const runId of authorizedRunIds) {
    const res = abortChatRunById(params.ops, {
      runId,
      sessionKey: params.sessionKey,
      stopReason: params.stopReason,
    });
    if (res.aborted) {
      runIds.push(runId);
    }
  }
  const res = { aborted: runIds.length > 0, runIds, unauthorized: false };
  if (res.aborted) {
    persistAbortedPartials({
      context: params.context,
      sessionKey: params.sessionKey,
      snapshots,
    });
  }
  return res;
}

function nextChatSeq(context: { agentRunSeq: Map<string, number> }, runId: string) {
  const next = (context.agentRunSeq.get(runId) ?? 0) + 1;
  context.agentRunSeq.set(runId, next);
  return next;
}

function broadcastChatFinal(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  message?: Record<string, unknown>;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const strippedEnvelopeMessage = stripEnvelopeFromMessage(params.message) as
    | Record<string, unknown>
    | undefined;
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "final" as const,
    message: stripInlineDirectiveTagsFromMessageForDisplay(strippedEnvelopeMessage),
  };
  params.context.broadcast("chat", payload);
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
  params.context.agentRunSeq.delete(params.runId);
}

function isBtwReplyPayload(payload: ReplyPayload | undefined): payload is ReplyPayload & {
  btw: { question: string };
  text: string;
} {
  return (
    typeof payload?.btw?.question === "string" &&
    payload.btw.question.trim().length > 0 &&
    typeof payload.text === "string" &&
    payload.text.trim().length > 0
  );
}

function broadcastSideResult(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  payload: SideResultPayload;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.payload.runId);
  params.context.broadcast("chat.side_result", {
    ...params.payload,
    seq,
  });
  params.context.nodeSendToSession(params.payload.sessionKey, "chat.side_result", {
    ...params.payload,
    seq,
  });
}

function broadcastChatError(params: {
  context: Pick<GatewayRequestContext, "broadcast" | "nodeSendToSession" | "agentRunSeq">;
  runId: string;
  sessionKey: string;
  errorMessage?: string;
}) {
  const seq = nextChatSeq({ agentRunSeq: params.context.agentRunSeq }, params.runId);
  const payload = {
    runId: params.runId,
    sessionKey: params.sessionKey,
    seq,
    state: "error" as const,
    errorMessage: params.errorMessage,
  };
  params.context.broadcast("chat", payload);
  params.context.nodeSendToSession(params.sessionKey, "chat", payload);
  params.context.agentRunSeq.delete(params.runId);
}

export const chatHandlers: GatewayRequestHandlers = {
  "chat.history": async ({ params, respond, context }) => {
    if (!validateChatHistoryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.history params: ${formatValidationErrors(validateChatHistoryParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey, limit } = params as {
      sessionKey: string;
      limit?: number;
    };
    const { cfg, storePath, entry } = loadSessionEntry(sessionKey);
    const sessionId = entry?.sessionId;
    const sessionAgentId = resolveSessionAgentId({ sessionKey, config: cfg });
    const resolvedSessionModel = resolveSessionModelRef(cfg, entry, sessionAgentId, sessionKey);
    const localMessages =
      sessionId && storePath ? readSessionMessages(sessionId, storePath, entry?.sessionFile) : [];
    const rawMessages = augmentChatHistoryWithCliSessionImports({
      entry,
      provider: resolvedSessionModel.provider,
      localMessages,
    });
    const hardMax = 1000;
    const defaultLimit = 200;
    const requested = typeof limit === "number" ? limit : defaultLimit;
    const max = Math.min(hardMax, requested);
    const sliced = rawMessages.length > max ? rawMessages.slice(-max) : rawMessages;
    const sanitized = stripEnvelopeFromMessages(sliced);
    const rehydrated = await rehydrateChatHistoryMessagesWithMedia(sanitized);
    const normalized = sanitizeChatHistoryMessages(rehydrated, cfg);
    const maxHistoryBytes = getMaxChatHistoryMessagesBytes();
    const perMessageHardCap = Math.min(CHAT_HISTORY_MAX_SINGLE_MESSAGE_BYTES, maxHistoryBytes);
    const replaced = replaceOversizedChatHistoryMessages({
      messages: normalized,
      maxSingleMessageBytes: perMessageHardCap,
    });
    const capped = capArrayByJsonBytes(replaced.messages, maxHistoryBytes).items;
    const bounded = enforceChatHistoryFinalBudget({ messages: capped, maxBytes: maxHistoryBytes });
    const placeholderCount = replaced.replacedCount + bounded.placeholderCount;
    if (placeholderCount > 0) {
      chatHistoryPlaceholderEmitCount += placeholderCount;
      context.logGateway.debug(
        `chat.history omitted oversized payloads placeholders=${placeholderCount} total=${chatHistoryPlaceholderEmitCount}`,
      );
    }
    let thinkingLevel = entry?.thinkingLevel;
    if (!thinkingLevel) {
      try {
        const catalog = await context.loadGatewayModelCatalog();
        thinkingLevel = resolveThinkingDefault({
          cfg,
          provider: resolvedSessionModel.provider,
          model: resolvedSessionModel.model,
          catalog,
        });
      } catch (err) {
        context.logGateway.warn(
          `chat.history thinking default fallback session=${sessionKey}: ${formatForLog(err)}`,
        );
        thinkingLevel = resolveThinkingDefault({
          cfg,
          provider: resolvedSessionModel.provider,
          model: resolvedSessionModel.model,
        });
      }
    }
    const verboseLevel = entry?.verboseLevel ?? cfg.agents?.defaults?.verboseDefault;
    respond(true, {
      sessionKey,
      sessionId,
      messages: bounded.messages,
      thinkingLevel,
      fastMode: entry?.fastMode,
      verboseLevel,
    });
  },
  "chat.abort": ({ params, respond, context, client }) => {
    if (!validateChatAbortParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.abort params: ${formatValidationErrors(validateChatAbortParams.errors)}`,
        ),
      );
      return;
    }
    const { sessionKey: rawSessionKey, runId } = params as {
      sessionKey: string;
      runId?: string;
    };

    const ops = createChatAbortOps(context);
    const requester = resolveChatAbortRequester(client);

    if (!runId) {
      const res = abortChatRunsForSessionKeyWithPartials({
        context,
        ops,
        sessionKey: rawSessionKey,
        abortOrigin: "rpc",
        stopReason: "rpc",
        requester,
      });
      if (res.unauthorized) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }

    const active = context.chatAbortControllers.get(runId);
    if (!active) {
      respond(true, { ok: true, aborted: false, runIds: [] });
      return;
    }
    if (active.sessionKey !== rawSessionKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "runId does not match sessionKey"),
      );
      return;
    }
    if (!canRequesterAbortChatRun(active, requester)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
      return;
    }

    const partialText = context.chatRunBuffers.get(runId);
    const res = abortChatRunById(ops, {
      runId,
      sessionKey: rawSessionKey,
      stopReason: "rpc",
    });
    if (res.aborted && partialText && partialText.trim()) {
      persistAbortedPartials({
        context,
        sessionKey: rawSessionKey,
        snapshots: [
          {
            runId,
            sessionId: active.sessionId,
            text: partialText,
            abortOrigin: "rpc",
          },
        ],
      });
    }
    respond(true, {
      ok: true,
      aborted: res.aborted,
      runIds: res.aborted ? [runId] : [],
    });
  },
  "chat.send": async ({ params, respond, context, client }) => {
    if (!validateChatSendParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.send params: ${formatValidationErrors(validateChatSendParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      sessionKey: string;
      message: string;
      extraSystemPrompt?: string;
      thinking?: string;
      deliver?: boolean;
      originatingChannel?: string;
      originatingTo?: string;
      originatingAccountId?: string;
      originatingThreadId?: string;
      attachments?: Array<{
        type?: string;
        mimeType?: string;
        fileName?: string;
        content?: unknown;
      }>;
      timeoutMs?: number;
      systemInputProvenance?: InputProvenance;
      systemProvenanceReceipt?: string;
      idempotencyKey: string;
    };
    const explicitOriginResult = normalizeExplicitChatSendOrigin({
      originatingChannel: p.originatingChannel,
      originatingTo: p.originatingTo,
      accountId: p.originatingAccountId,
      messageThreadId: p.originatingThreadId,
    });
    if (!explicitOriginResult.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, explicitOriginResult.error));
      return;
    }
    if (
      (p.systemInputProvenance || p.systemProvenanceReceipt || explicitOriginResult.value) &&
      !canInjectSystemProvenance(client)
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          p.systemInputProvenance || p.systemProvenanceReceipt
            ? "system provenance fields require admin scope"
            : "originating route fields require admin scope",
        ),
      );
      return;
    }
    const sanitizedMessageResult = sanitizeChatSendMessageInput(p.message);
    if (!sanitizedMessageResult.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, sanitizedMessageResult.error),
      );
      return;
    }
    const systemReceiptResult = normalizeOptionalChatSystemReceipt(p.systemProvenanceReceipt);
    if (!systemReceiptResult.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, systemReceiptResult.error));
      return;
    }
    const inboundMessage = sanitizedMessageResult.message;
    const systemInputProvenance = normalizeInputProvenance(p.systemInputProvenance);
    const systemProvenanceReceipt = systemReceiptResult.receipt;
    const stopCommand = isChatStopCommandText(inboundMessage);
    const normalizedAttachments = normalizeRpcAttachmentsToChatAttachments(p.attachments);
    const rawMessage = inboundMessage.trim();
    if (!rawMessage && normalizedAttachments.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "message or attachment required"),
      );
      return;
    }
    let parsedMessage = inboundMessage;
    let parsedImages: ChatImageContent[] = [];
    let parsedAttachments: ParsedChatAttachment[] = [];
    if (normalizedAttachments.length > 0) {
      try {
        parsedAttachments = await parseChatAttachments(normalizedAttachments, {
          maxBytes: 5_000_000,
          log: context.logGateway,
        });
        parsedImages = parsedAttachments
          .filter((attachment) => attachment.kind === "image")
          .map((attachment) => ({
            type: "image",
            data: attachment.base64,
            mimeType: attachment.mimeType,
          }));
      } catch (err) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
        return;
      }
    }
    const rawSessionKey = p.sessionKey;
    const loadedSession = loadSessionEntry(rawSessionKey);
    let cfg = loadedSession.cfg;
    const { entry, canonicalKey: sessionKey } = loadedSession;
    const storedExtraSystemPrompt =
      typeof entry?.extraSystemPrompt === "string" ? entry.extraSystemPrompt.trim() : "";
    const callerExtraSystemPrompt =
      typeof p.extraSystemPrompt === "string" ? p.extraSystemPrompt.trim() : "";
    const combinedExtraSystemPrompt =
      [...new Set([storedExtraSystemPrompt, callerExtraSystemPrompt].filter(Boolean))].join(
        "\n\n",
      ) || undefined;
    const resolvedEntryAgentId = resolveSessionAgentId({
      sessionKey,
      config: cfg,
    });
    const resolvedSessionModel = resolveSessionModelRef(
      cfg,
      entry,
      resolvedEntryAgentId,
      sessionKey,
    );
    if (isAlisioDynamicProvider(resolvedSessionModel.provider)) {
      await publishAlisioDynamicModelProvidersForContext(context);
    }
    const timeoutMs = resolveAgentTimeoutMs({
      cfg,
      overrideMs: p.timeoutMs,
    });
    const now = Date.now();
    const clientRunId = p.idempotencyKey;
    const semanticDedupeKey = buildChatSendSemanticDedupeKey({
      attachments: normalizedAttachments,
      message: inboundMessage,
      sessionKey,
    });

    const sendPolicy = resolveSendPolicy({
      cfg,
      entry,
      sessionKey,
      channel: entry?.channel,
      chatType: entry?.chatType,
    });
    if (sendPolicy === "deny") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "send blocked by session policy"),
      );
      return;
    }

    if (stopCommand) {
      const res = abortChatRunsForSessionKeyWithPartials({
        context,
        ops: createChatAbortOps(context),
        sessionKey: rawSessionKey,
        abortOrigin: "stop-command",
        stopReason: "stop",
        requester: resolveChatAbortRequester(client),
      });
      if (res.unauthorized) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      respond(true, { ok: true, aborted: res.aborted, runIds: res.runIds });
      return;
    }

    const semanticCached = context.dedupe.get(semanticDedupeKey);
    if (semanticCached && now - semanticCached.ts <= CHAT_SEND_SEMANTIC_DEDUPE_WINDOW_MS) {
      const semanticRunId = readChatSendRunIdFromDedupeEntry(semanticCached);
      if (semanticRunId) {
        const semanticActive = context.chatAbortControllers.get(semanticRunId);
        if (semanticActive) {
          respond(true, { runId: semanticRunId, status: "in_flight" as const }, undefined, {
            cached: true,
            runId: semanticRunId,
          });
          return;
        }
        const semanticTerminal = context.dedupe.get(`chat:${semanticRunId}`);
        if (semanticTerminal) {
          respond(semanticTerminal.ok, semanticTerminal.payload, semanticTerminal.error, {
            cached: true,
            runId: semanticRunId,
          });
          return;
        }
      }
      respond(semanticCached.ok, semanticCached.payload, semanticCached.error, {
        cached: true,
        runId: semanticRunId ?? undefined,
      });
      return;
    }

    const cached = context.dedupe.get(`chat:${clientRunId}`);
    if (cached) {
      respond(cached.ok, cached.payload, cached.error, {
        cached: true,
      });
      return;
    }

    const activeExisting = context.chatAbortControllers.get(clientRunId);
    if (activeExisting) {
      respond(true, { runId: clientRunId, status: "in_flight" as const }, undefined, {
        cached: true,
        runId: clientRunId,
      });
      return;
    }

    try {
      const abortController = new AbortController();
      context.chatAbortControllers.set(clientRunId, {
        controller: abortController,
        sessionId: entry?.sessionId ?? clientRunId,
        sessionKey: rawSessionKey,
        startedAtMs: now,
        expiresAtMs: resolveChatRunExpiresAtMs({ now, timeoutMs }),
        ownerConnId: normalizeOptionalText(client?.connId),
        ownerDeviceId: normalizeOptionalText(client?.connect?.device?.id),
      });
      const ackPayload = {
        runId: clientRunId,
        status: "started" as const,
      };
      setGatewayDedupeEntry({
        dedupe: context.dedupe,
        key: semanticDedupeKey,
        entry: {
          ts: now,
          ok: true,
          payload: ackPayload,
        },
      });
      respond(true, ackPayload, undefined, { runId: clientRunId });
      const persistedAttachmentsPromise = persistChatSendAttachments({
        attachments: parsedAttachments,
        client,
        logGateway: context.logGateway,
      });
      const persistedImagePreviewsPromise = buildPersistedChatImagePreviews(parsedAttachments);
      const requiresAttachmentMediaContext = parsedAttachments.some(
        (attachment) => attachment.kind !== "image",
      );
      const persistedMediaContextAttachments = requiresAttachmentMediaContext
        ? await persistedAttachmentsPromise
        : [];

      const trimmedMessage = parsedMessage.trim();
      const injectThinking = Boolean(
        p.thinking && trimmedMessage && !trimmedMessage.startsWith("/"),
      );
      const commandBody = injectThinking ? `/think ${p.thinking} ${parsedMessage}` : parsedMessage;
      const messageForAgent = systemProvenanceReceipt
        ? [systemProvenanceReceipt, parsedMessage].filter(Boolean).join("\n\n")
        : parsedMessage;
      const clientInfo = client?.connect?.client;
      const {
        originatingChannel,
        originatingTo,
        accountId,
        messageThreadId,
        explicitDeliverRoute,
      } = resolveChatSendOriginatingRoute({
        client: clientInfo,
        deliver: p.deliver,
        entry,
        explicitOrigin: explicitOriginResult.value,
        hasConnectedClient: client?.connect !== undefined,
        mainKey: cfg.session?.mainKey,
        sessionKey,
      });
      // Inject timestamp so agents know the current date/time.
      // Only BodyForAgent gets the timestamp — Body stays raw for UI display.
      // See: https://github.com/alisio/alisio/issues/3658
      const stampedMessage = injectTimestamp(messageForAgent, timestampOptsFromConfig(cfg));

      const ctx: MsgContext = {
        Body: messageForAgent,
        BodyForAgent: stampedMessage,
        BodyForCommands: commandBody,
        RawBody: parsedMessage,
        CommandBody: commandBody,
        InputProvenance: systemInputProvenance,
        SessionKey: sessionKey,
        Provider: INTERNAL_MESSAGE_CHANNEL,
        Surface: INTERNAL_MESSAGE_CHANNEL,
        OriginatingChannel: originatingChannel,
        OriginatingTo: originatingTo,
        ExplicitDeliverRoute: explicitDeliverRoute,
        AccountId: accountId,
        MessageThreadId: messageThreadId,
        ChatType: "direct",
        CommandAuthorized: true,
        MessageSid: clientRunId,
        SenderId: clientInfo?.id,
        SenderName: clientInfo?.displayName,
        SenderUsername: clientInfo?.displayName,
        GatewayClientScopes: client?.connect?.scopes,
        ...resolveChatSendTranscriptMediaFields(persistedMediaContextAttachments),
      };

      const agentId = resolvedEntryAgentId;
      const { onModelSelected, ...replyPipeline } = createChannelReplyPipeline({
        cfg,
        agentId,
        channel: INTERNAL_MESSAGE_CHANNEL,
      });
      const deliveredReplies: Array<{ payload: ReplyPayload; kind: "block" | "final" }> = [];
      let userTranscriptUpdatePromise: Promise<void> | null = null;
      const emitUserTranscriptUpdate = async () => {
        if (userTranscriptUpdatePromise) {
          await userTranscriptUpdatePromise;
          return;
        }
        userTranscriptUpdatePromise = (async () => {
          const { storePath: latestStorePath, entry: latestEntry } = loadSessionEntry(sessionKey);
          const resolvedSessionId = latestEntry?.sessionId ?? entry?.sessionId;
          if (!resolvedSessionId) {
            return;
          }
          const transcriptPath = resolveTranscriptPath({
            sessionId: resolvedSessionId,
            storePath: latestStorePath,
            sessionFile: latestEntry?.sessionFile ?? entry?.sessionFile,
            agentId,
          });
          if (!transcriptPath) {
            return;
          }
          const persistedAttachments = await persistedAttachmentsPromise;
          const imagePreviews = await persistedImagePreviewsPromise;
          emitSessionTranscriptUpdate({
            sessionFile: transcriptPath,
            sessionKey,
            message: buildChatSendTranscriptMessage({
              message: parsedMessage,
              savedAttachments: persistedAttachments,
              imagePreviews,
              timestamp: now,
              idempotencyKey: clientRunId,
            }),
          });
        })();
        await userTranscriptUpdatePromise;
      };
      let transcriptMediaRewriteDone = false;
      const rewriteUserTranscriptMedia = async () => {
        if (transcriptMediaRewriteDone) {
          return;
        }
        const { storePath: latestStorePath, entry: latestEntry } = loadSessionEntry(sessionKey);
        const resolvedSessionId = latestEntry?.sessionId ?? entry?.sessionId;
        if (!resolvedSessionId) {
          return;
        }
        const transcriptPath = resolveTranscriptPath({
          sessionId: resolvedSessionId,
          storePath: latestStorePath,
          sessionFile: latestEntry?.sessionFile ?? entry?.sessionFile,
          agentId,
        });
        if (!transcriptPath) {
          return;
        }
        transcriptMediaRewriteDone = true;
        await rewriteChatSendUserTurnMediaPaths({
          transcriptPath,
          sessionKey,
          message: parsedMessage,
          savedAttachments: await persistedAttachmentsPromise,
          idempotencyKey: clientRunId,
        });
      };
      const dispatcher = createReplyDispatcher({
        ...replyPipeline,
        onError: (err) => {
          context.logGateway.warn(`webchat dispatch failed: ${formatForLog(err)}`);
        },
        deliver: async (payload, info) => {
          if (info.kind !== "block" && info.kind !== "final") {
            return;
          }
          deliveredReplies.push({ payload, kind: info.kind });
        },
      });

      // Surface accepted inbound turns immediately so transcript subscribers
      // (gateway watchers, MCP bridges, external channel backends) do not wait
      // on model startup, completion, or failure paths before seeing the user turn.
      void emitUserTranscriptUpdate().catch((transcriptErr) => {
        context.logGateway.warn(
          `webchat eager user transcript update failed: ${formatForLog(transcriptErr)}`,
        );
      });

      let agentRunStarted = false;
      void dispatchInboundMessage({
        ctx,
        cfg,
        dispatcher,
        replyOptions: {
          runId: clientRunId,
          extraSystemPrompt: combinedExtraSystemPrompt,
          abortSignal: abortController.signal,
          images: parsedImages.length > 0 ? parsedImages : undefined,
          onAgentRunStart: (runId) => {
            agentRunStarted = true;
            void emitUserTranscriptUpdate();
            const connId = typeof client?.connId === "string" ? client.connId : undefined;
            const wantsToolEvents = hasGatewayClientCap(
              client?.connect?.caps,
              GATEWAY_CLIENT_CAPS.TOOL_EVENTS,
            );
            if (connId && wantsToolEvents) {
              context.registerToolEventRecipient(runId, connId);
              // Register for any other active runs *in the same session* so
              // late-joining clients (e.g. page refresh mid-response) receive
              // in-progress tool events without leaking cross-session data.
              for (const [activeRunId, active] of context.chatAbortControllers) {
                if (activeRunId !== runId && active.sessionKey === p.sessionKey) {
                  context.registerToolEventRecipient(activeRunId, connId);
                }
              }
            }
          },
          onModelSelected,
        },
      })
        .then(async () => {
          await rewriteUserTranscriptMedia();
          if (!agentRunStarted) {
            await emitUserTranscriptUpdate();
            const btwReplies = deliveredReplies
              .map((entry) => entry.payload)
              .filter(isBtwReplyPayload);
            const btwText = btwReplies
              .map((payload) => payload.text.trim())
              .filter(Boolean)
              .join("\n\n")
              .trim();
            if (btwReplies.length > 0 && btwText) {
              broadcastSideResult({
                context,
                payload: {
                  kind: "btw",
                  runId: clientRunId,
                  sessionKey,
                  question: btwReplies[0].btw.question.trim(),
                  text: btwText,
                  isError: btwReplies.some((payload) => payload.isError),
                  ts: Date.now(),
                },
              });
              broadcastChatFinal({
                context,
                runId: clientRunId,
                sessionKey,
              });
            } else {
              const combinedReply = deliveredReplies
                .filter((entry) => entry.kind === "final")
                .map((entry) => entry.payload)
                .map((part) => part.text?.trim() ?? "")
                .filter(Boolean)
                .join("\n\n")
                .trim();
              let message: Record<string, unknown> | undefined;
              if (combinedReply) {
                const { storePath: latestStorePath, entry: latestEntry } =
                  loadSessionEntry(sessionKey);
                const sessionId = latestEntry?.sessionId ?? entry?.sessionId ?? clientRunId;
                const appended = appendAssistantTranscriptMessage({
                  message: combinedReply,
                  sessionId,
                  storePath: latestStorePath,
                  sessionFile: latestEntry?.sessionFile,
                  agentId,
                  createIfMissing: true,
                });
                if (appended.ok) {
                  message = appended.message;
                } else {
                  context.logGateway.warn(
                    `webchat transcript append failed: ${appended.error ?? "unknown error"}`,
                  );
                  const now = Date.now();
                  message = {
                    role: "assistant",
                    content: [{ type: "text", text: combinedReply }],
                    timestamp: now,
                    // Keep this compatible with Pi stopReason enums even though this message isn't
                    // persisted to the transcript due to the append failure.
                    stopReason: "stop",
                    usage: { input: 0, output: 0, totalTokens: 0 },
                  };
                }
              }
              broadcastChatFinal({
                context,
                runId: clientRunId,
                sessionKey,
                message,
              });
            }
          } else {
            void emitUserTranscriptUpdate();
          }
          setGatewayDedupeEntry({
            dedupe: context.dedupe,
            key: `chat:${clientRunId}`,
            entry: {
              ts: Date.now(),
              ok: true,
              payload: { runId: clientRunId, status: "ok" as const },
            },
          });
          setGatewayDedupeEntry({
            dedupe: context.dedupe,
            key: semanticDedupeKey,
            entry: {
              ts: Date.now(),
              ok: true,
              payload: { runId: clientRunId, status: "ok" as const },
            },
          });
        })
        .catch((err) => {
          void rewriteUserTranscriptMedia().catch((rewriteErr) => {
            context.logGateway.warn(
              `webchat transcript media rewrite failed after error: ${formatForLog(rewriteErr)}`,
            );
          });
          void emitUserTranscriptUpdate().catch((transcriptErr) => {
            context.logGateway.warn(
              `webchat user transcript update failed after error: ${formatForLog(transcriptErr)}`,
            );
          });
          const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
          setGatewayDedupeEntry({
            dedupe: context.dedupe,
            key: `chat:${clientRunId}`,
            entry: {
              ts: Date.now(),
              ok: false,
              payload: {
                runId: clientRunId,
                status: "error" as const,
                summary: String(err),
              },
              error,
            },
          });
          setGatewayDedupeEntry({
            dedupe: context.dedupe,
            key: semanticDedupeKey,
            entry: {
              ts: Date.now(),
              ok: false,
              payload: {
                runId: clientRunId,
                status: "error" as const,
                summary: String(err),
              },
              error,
            },
          });
          broadcastChatError({
            context,
            runId: clientRunId,
            sessionKey,
            errorMessage: String(err),
          });
        })
        .finally(() => {
          context.chatAbortControllers.delete(clientRunId);
        });
    } catch (err) {
      const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
      const payload = {
        runId: clientRunId,
        status: "error" as const,
        summary: String(err),
      };
      setGatewayDedupeEntry({
        dedupe: context.dedupe,
        key: `chat:${clientRunId}`,
        entry: {
          ts: Date.now(),
          ok: false,
          payload,
          error,
        },
      });
      setGatewayDedupeEntry({
        dedupe: context.dedupe,
        key: semanticDedupeKey,
        entry: {
          ts: Date.now(),
          ok: false,
          payload,
          error,
        },
      });
      respond(false, payload, error, {
        runId: clientRunId,
        error: formatForLog(err),
      });
    }
  },
  "chat.inject": async ({ params, respond, context }) => {
    if (!validateChatInjectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.inject params: ${formatValidationErrors(validateChatInjectParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      sessionKey: string;
      message: string;
      label?: string;
    };

    // Load session to find transcript file
    const rawSessionKey = p.sessionKey;
    const { cfg, storePath, entry, canonicalKey: sessionKey } = loadSessionEntry(rawSessionKey);
    const sessionId = entry?.sessionId;
    if (!sessionId || !storePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session not found"));
      return;
    }

    const appended = appendAssistantTranscriptMessage({
      message: p.message,
      label: p.label,
      sessionId,
      storePath,
      sessionFile: entry?.sessionFile,
      agentId: resolveSessionAgentId({ sessionKey, config: cfg }),
      createIfMissing: true,
    });
    if (!appended.ok || !appended.messageId || !appended.message) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to write transcript: ${appended.error ?? "unknown error"}`,
        ),
      );
      return;
    }

    // Broadcast to webchat for immediate UI update
    const chatPayload = {
      runId: `inject-${appended.messageId}`,
      sessionKey,
      seq: 0,
      state: "final" as const,
      message: stripInlineDirectiveTagsFromMessageForDisplay(
        stripEnvelopeFromMessage(appended.message) as Record<string, unknown>,
      ),
    };
    context.broadcast("chat", chatPayload);
    context.nodeSendToSession(sessionKey, "chat", chatPayload);

    respond(true, { ok: true, messageId: appended.messageId });
  },
};
