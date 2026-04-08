import {
  ALISIO_CONNECTOR_OAUTH_CHANNEL,
  ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY,
  ALISIO_CONNECTOR_OAUTH_STORAGE_KEY,
  LEGACY_ALISIO_CONNECTOR_OAUTH_CHANNEL,
  LEGACY_ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY,
  LEGACY_ALISIO_CONNECTOR_OAUTH_STORAGE_KEY,
  isAlisioConnectorOAuthSignal,
  type AlisioConnectorOAuthSignal,
} from "../../../src/shared/alisio-connector-oauth.js";
import { extractTextCached } from "./chat/message-extract.ts";
import { loadAlisioConnectors, loadAlisioDoctorSummary } from "./controllers/alisio.ts";
import type { ChatAttachment } from "./ui-types.ts";

export type { AlisioConnectorOAuthSignal } from "../../../src/shared/alisio-connector-oauth.js";

type ConnectorOAuthRefreshHost = Parameters<typeof loadAlisioConnectors>[0];
type ConnectorOAuthSignalHandler = (signal: AlisioConnectorOAuthSignal) => void;
const MAX_CONNECTOR_OAUTH_SIGNAL_AGE_MS = 5 * 60 * 1000;
const PENDING_CONNECTOR_CHAT_RESUME_MAX_AGE_MS = 15 * 60 * 1000;
const PENDING_CONNECTOR_CHAT_RESUME_STORAGE_KEY =
  "alisio:alisio-connector-oauth:pending-chat-resume:v1";

export type PendingAlisioConnectorChatResume = {
  connectorId: string;
  sessionKey: string;
  message: string;
  attachments?: ChatAttachment[];
  createdAtMs: number;
};

function buildAttachmentId(index: number) {
  return `connector-auth-replay-${index}`;
}

function clearPersistedConnectorOAuthSignal(): void {
  try {
    window.localStorage.removeItem(ALISIO_CONNECTOR_OAUTH_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_ALISIO_CONNECTOR_OAUTH_STORAGE_KEY);
  } catch {
    // Ignore storage access failures.
  }
}

function isFreshConnectorOAuthSignal(
  signal: AlisioConnectorOAuthSignal,
  now = Date.now(),
): boolean {
  const ageMs = now - signal.createdAtMs;
  return ageMs >= -60_000 && ageMs <= MAX_CONNECTOR_OAUTH_SIGNAL_AGE_MS;
}

function normalizeResumeAttachment(
  source: Record<string, unknown>,
  index: number,
): ChatAttachment | null {
  const rawMimeType =
    typeof source.media_type === "string"
      ? source.media_type
      : typeof source.mediaType === "string"
        ? source.mediaType
        : null;
  const mimeType = rawMimeType?.trim() || null;
  const rawData = typeof source.data === "string" ? source.data.trim() : "";
  if (!rawData) {
    return null;
  }
  const dataUrl = rawData.startsWith("data:")
    ? rawData
    : mimeType
      ? `data:${mimeType};base64,${rawData}`
      : null;
  if (!dataUrl || !mimeType) {
    return null;
  }
  return {
    id: buildAttachmentId(index),
    dataUrl,
    mimeType,
  };
}

function extractResumeAttachments(message: unknown): ChatAttachment[] {
  const entry = message as { content?: unknown };
  if (!Array.isArray(entry.content)) {
    return [];
  }
  return entry.content
    .map((block, index) => {
      if (!block || typeof block !== "object") {
        return null;
      }
      const item = block as Record<string, unknown>;
      if (item.type !== "image" || !item.source || typeof item.source !== "object") {
        return null;
      }
      return normalizeResumeAttachment(item.source as Record<string, unknown>, index);
    })
    .filter((attachment): attachment is ChatAttachment => attachment !== null);
}

function isPendingAlisioConnectorChatResume(
  value: unknown,
): value is PendingAlisioConnectorChatResume {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.connectorId !== "string" ||
    !candidate.connectorId.trim() ||
    typeof candidate.sessionKey !== "string" ||
    !candidate.sessionKey.trim() ||
    typeof candidate.message !== "string" ||
    typeof candidate.createdAtMs !== "number"
  ) {
    return false;
  }
  const attachments = candidate.attachments;
  if (attachments == null) {
    return true;
  }
  return (
    Array.isArray(attachments) &&
    attachments.every((attachment) =>
      Boolean(
        attachment &&
        typeof attachment === "object" &&
        typeof (attachment as { id?: unknown }).id === "string" &&
        typeof (attachment as { dataUrl?: unknown }).dataUrl === "string" &&
        typeof (attachment as { mimeType?: unknown }).mimeType === "string",
      ),
    )
  );
}

function parsePendingAlisioConnectorChatResume(
  raw: unknown,
): PendingAlisioConnectorChatResume | null {
  if (isPendingAlisioConnectorChatResume(raw)) {
    return raw;
  }
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPendingAlisioConnectorChatResume(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPendingAlisioConnectorChatResumeFresh(
  pending: PendingAlisioConnectorChatResume,
  now = Date.now(),
): boolean {
  const ageMs = now - pending.createdAtMs;
  return ageMs >= -60_000 && ageMs <= PENDING_CONNECTOR_CHAT_RESUME_MAX_AGE_MS;
}

function parseConnectorOAuthSignal(raw: unknown): AlisioConnectorOAuthSignal | null {
  if (isAlisioConnectorOAuthSignal(raw)) {
    return raw;
  }
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isAlisioConnectorOAuthSignal(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function subscribeAlisioConnectorOAuthSignals(
  onSignal: ConnectorOAuthSignalHandler,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  let lastSignalId: string | null = null;
  const handleSignal = (raw: unknown) => {
    const signal = parseConnectorOAuthSignal(raw);
    if (!signal || signal.signalId === lastSignalId || !isFreshConnectorOAuthSignal(signal)) {
      return;
    }
    lastSignalId = signal.signalId;
    clearPersistedConnectorOAuthSignal();
    onSignal(signal);
  };

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== ALISIO_CONNECTOR_OAUTH_STORAGE_KEY &&
      event.key !== LEGACY_ALISIO_CONNECTOR_OAUTH_STORAGE_KEY
    ) {
      return;
    }
    if (!event.newValue) {
      return;
    }
    handleSignal(event.newValue);
  };

  const channel =
    typeof window.BroadcastChannel === "function"
      ? new BroadcastChannel(ALISIO_CONNECTOR_OAUTH_CHANNEL)
      : null;
  const legacyChannel =
    typeof window.BroadcastChannel === "function"
      ? new BroadcastChannel(LEGACY_ALISIO_CONNECTOR_OAUTH_CHANNEL)
      : null;
  const handleMessage = (event: MessageEvent<unknown>) => {
    handleSignal(event.data);
  };

  window.addEventListener("storage", handleStorage);
  channel?.addEventListener("message", handleMessage as EventListener);
  legacyChannel?.addEventListener("message", handleMessage as EventListener);
  try {
    handleSignal(window.localStorage.getItem(ALISIO_CONNECTOR_OAUTH_STORAGE_KEY));
    handleSignal(window.localStorage.getItem(LEGACY_ALISIO_CONNECTOR_OAUTH_STORAGE_KEY));
  } catch {
    // Ignore storage access failures.
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.removeEventListener("message", handleMessage as EventListener);
    legacyChannel?.removeEventListener("message", handleMessage as EventListener);
    channel?.close();
    legacyChannel?.close();
  };
}

export function rememberAlisioConnectorOAuthReturnTo(url: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const parsed = new URL(url, window.location.href);
    const protocol = parsed.protocol.toLowerCase();
    if (
      (protocol !== "http:" && protocol !== "https:") ||
      parsed.origin !== window.location.origin
    ) {
      return;
    }
    const normalized = parsed.toString();
    window.localStorage.setItem(ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY, normalized);
    window.localStorage.setItem(LEGACY_ALISIO_CONNECTOR_OAUTH_RETURN_TO_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage failures and invalid return targets.
  }
}

export function clearPendingAlisioConnectorChatResume(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(PENDING_CONNECTOR_CHAT_RESUME_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function rememberPendingAlisioConnectorChatResume(
  pending: PendingAlisioConnectorChatResume,
): PendingAlisioConnectorChatResume {
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(
        PENDING_CONNECTOR_CHAT_RESUME_STORAGE_KEY,
        JSON.stringify(pending),
      );
    } catch {
      // Ignore storage failures; the in-memory state still covers popup flows.
    }
  }
  return pending;
}

export function readPendingAlisioConnectorChatResume(): PendingAlisioConnectorChatResume | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const pending = parsePendingAlisioConnectorChatResume(
      window.sessionStorage.getItem(PENDING_CONNECTOR_CHAT_RESUME_STORAGE_KEY),
    );
    if (!pending || !isPendingAlisioConnectorChatResumeFresh(pending)) {
      clearPendingAlisioConnectorChatResume();
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

export function buildPendingAlisioConnectorChatResume(params: {
  connectorId: string;
  sessionKey: string;
  messages: unknown[];
  now?: number;
}): PendingAlisioConnectorChatResume | null {
  for (let index = params.messages.length - 1; index >= 0; index -= 1) {
    const message = params.messages[index] as { role?: unknown };
    if (message?.role !== "user") {
      continue;
    }
    const text = extractTextCached(message)?.trim() ?? "";
    const attachments = extractResumeAttachments(message);
    if (!text && attachments.length === 0) {
      continue;
    }
    return {
      connectorId: params.connectorId,
      sessionKey: params.sessionKey,
      message: text,
      ...(attachments.length > 0 ? { attachments } : {}),
      createdAtMs: params.now ?? Date.now(),
    };
  }
  return null;
}

export async function refreshAfterAlisioConnectorOAuth(
  host: ConnectorOAuthRefreshHost,
): Promise<void> {
  await Promise.allSettled([
    loadAlisioConnectors(host, { force: true }),
    loadAlisioDoctorSummary(host, { force: true }),
  ]);
}
