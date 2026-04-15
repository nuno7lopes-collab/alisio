import { isSubagentSessionKey, parseAgentSessionKey } from "../sessions/session-key-utils.js";

export type ConversationCategory =
  | "dashboard"
  | "desktop"
  | "external_dm"
  | "external_group"
  | "thread"
  | "topic"
  | "task"
  | "subagent"
  | "system"
  | "unknown";

export type ConversationSurfaceType =
  | "dashboard_chat"
  | "desktop_window"
  | "web_chat"
  | "whatsapp_chat"
  | "telegram_chat"
  | "telegram_topic"
  | "discord_channel"
  | "discord_thread"
  | "signal_chat"
  | "imessage_chat"
  | "slack_channel"
  | "slack_thread"
  | "matrix_room"
  | "matrix_thread"
  | "external_chat"
  | "external_thread"
  | "task_surface"
  | "subagent_surface"
  | "system_surface"
  | "unknown";

export type ConversationSurfaceRef = {
  type: ConversationSurfaceType;
  id: string;
  parent?: string | null;
  account?: string | null;
  channel?: string | null;
};

export type ConversationRuntimeType = "acp" | "codex" | "kimi" | "unknown";

export type ConversationRuntimeRef = {
  type: ConversationRuntimeType;
  id: string;
  backend?: string | null;
};

export type ConversationRelationshipKind =
  | "root"
  | "child"
  | "spawned"
  | "linked"
  | "cloned"
  | "task"
  | "subagent";

export type ConversationRelationship = {
  kind: ConversationRelationshipKind;
  parentConversationId?: string | null;
  spawnedByConversationId?: string | null;
};

export type ConversationLifecycleKind =
  | "conversation.created"
  | "transcript.rotated"
  | "runtime.reset"
  | "surface.rebound";

export type ConversationLifecycleEvent = {
  kind: ConversationLifecycleKind;
  conversationId?: string;
  transcriptId?: string;
  previousTranscriptId?: string;
  surfaceRef?: ConversationSurfaceRef;
  runtimeRef?: ConversationRuntimeRef;
};

type SurfaceDerivationInput = {
  conversationId: string;
  explicitSurfaceRef?: ConversationSurfaceRef | null;
  channel?: string | null;
  accountId?: string | null;
  chatType?: string | null;
  threadId?: string | number | null;
  surfaceId?: string | null;
  parentSurfaceId?: string | null;
};

type RelationshipDerivationInput = {
  conversationId: string;
  explicitRelationship?: ConversationRelationship | null;
  parentConversationId?: string | null;
  spawnedByConversationId?: string | null;
};

type CategoryDerivationInput = {
  conversationId: string;
  explicitCategory?: ConversationCategory | null;
  chatType?: string | null;
  relationship?: ConversationRelationship | null;
  surfaceRef?: ConversationSurfaceRef | null;
};

type RuntimeDerivationInput = {
  explicitRuntimeRef?: ConversationRuntimeRef | null;
  acp?: {
    backend?: string | null;
    runtimeSessionName?: string | null;
    identity?: {
      agentSessionId?: string | null;
      acpxSessionId?: string | null;
    } | null;
  } | null;
};

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeNullableText(value: unknown): string | null | undefined {
  if (value == null) {
    return undefined;
  }
  return normalizeText(value) ?? null;
}

function normalizeSurfaceType(value: unknown): ConversationSurfaceType | undefined {
  switch (value) {
    case "dashboard_chat":
    case "desktop_window":
    case "web_chat":
    case "whatsapp_chat":
    case "telegram_chat":
    case "telegram_topic":
    case "discord_channel":
    case "discord_thread":
    case "signal_chat":
    case "imessage_chat":
    case "slack_channel":
    case "slack_thread":
    case "matrix_room":
    case "matrix_thread":
    case "external_chat":
    case "external_thread":
    case "task_surface":
    case "subagent_surface":
    case "system_surface":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}

function normalizeCategory(value: unknown): ConversationCategory | undefined {
  switch (value) {
    case "dashboard":
    case "desktop":
    case "external_dm":
    case "external_group":
    case "thread":
    case "topic":
    case "task":
    case "subagent":
    case "system":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}

function normalizeRelationshipKind(value: unknown): ConversationRelationshipKind | undefined {
  switch (value) {
    case "root":
    case "child":
    case "spawned":
    case "linked":
    case "cloned":
    case "task":
    case "subagent":
      return value;
    default:
      return undefined;
  }
}

function normalizeRuntimeType(value: unknown): ConversationRuntimeType | undefined {
  switch (value) {
    case "acp":
    case "codex":
    case "kimi":
    case "unknown":
      return value;
    default:
      return undefined;
  }
}

function resolveSessionSurfaceType(params: {
  conversationId: string;
  channel?: string;
  chatType?: string;
  threadId?: string;
}): ConversationSurfaceType | undefined {
  const parsed = parseAgentSessionKey(params.conversationId);
  const rest = parsed?.rest ?? params.conversationId.trim().toLowerCase();
  if (rest === "main" || rest.startsWith("dashboard:")) {
    return "dashboard_chat";
  }
  if (rest.startsWith("cron:") || rest === "global" || rest === "unknown") {
    return "system_surface";
  }
  if (isSubagentSessionKey(params.conversationId)) {
    return "subagent_surface";
  }

  const channel = params.channel?.trim().toLowerCase();
  const chatType = params.chatType?.trim().toLowerCase();
  const hasThread = Boolean(params.threadId);
  if (channel === "telegram") {
    return hasThread ? "telegram_topic" : "telegram_chat";
  }
  if (channel === "discord") {
    return hasThread ? "discord_thread" : "discord_channel";
  }
  if (channel === "slack") {
    return hasThread ? "slack_thread" : "slack_channel";
  }
  if (channel === "matrix") {
    return hasThread ? "matrix_thread" : "matrix_room";
  }
  if (channel === "whatsapp" || channel === "webchat") {
    return "whatsapp_chat";
  }
  if (channel === "signal") {
    return "signal_chat";
  }
  if (channel === "imessage" || channel === "bluebubbles") {
    return "imessage_chat";
  }
  if (channel) {
    return hasThread ? "external_thread" : "external_chat";
  }
  if (chatType === "direct" || chatType === "group" || chatType === "channel") {
    return "external_chat";
  }
  return undefined;
}

export function normalizeConversationSurfaceRef(
  ref: ConversationSurfaceRef | null | undefined,
): ConversationSurfaceRef | undefined {
  if (!ref) {
    return undefined;
  }
  const type = normalizeSurfaceType(ref.type);
  const id = normalizeText(ref.id);
  if (!type || !id) {
    return undefined;
  }
  return {
    type,
    id,
    parent: normalizeNullableText(ref.parent),
    account: normalizeNullableText(ref.account),
    channel: normalizeNullableText(ref.channel),
  };
}

export function deriveConversationSurfaceRef(
  params: SurfaceDerivationInput,
): ConversationSurfaceRef | undefined {
  const explicit = normalizeConversationSurfaceRef(params.explicitSurfaceRef);
  if (explicit) {
    return explicit;
  }
  const threadId =
    typeof params.threadId === "number" ? String(params.threadId) : normalizeText(params.threadId);
  const channel = normalizeText(params.channel)?.toLowerCase();
  const type = resolveSessionSurfaceType({
    conversationId: params.conversationId,
    channel,
    chatType: normalizeText(params.chatType)?.toLowerCase(),
    threadId,
  });
  if (!type) {
    return undefined;
  }
  const id = normalizeText(params.surfaceId) ?? params.conversationId.trim();
  const supportsExternalBindingMetadata =
    type === "whatsapp_chat" ||
    type === "telegram_chat" ||
    type === "telegram_topic" ||
    type === "discord_channel" ||
    type === "discord_thread" ||
    type === "signal_chat" ||
    type === "imessage_chat" ||
    type === "slack_channel" ||
    type === "slack_thread" ||
    type === "matrix_room" ||
    type === "matrix_thread" ||
    type === "external_chat" ||
    type === "external_thread";
  return {
    type,
    id,
    parent: normalizeNullableText(params.parentSurfaceId) ?? undefined,
    account: supportsExternalBindingMetadata
      ? (normalizeNullableText(params.accountId) ?? undefined)
      : undefined,
    channel: supportsExternalBindingMetadata ? channel : undefined,
  };
}

export function normalizeConversationRelationship(
  relationship: ConversationRelationship | null | undefined,
): ConversationRelationship | undefined {
  if (!relationship) {
    return undefined;
  }
  const kind = normalizeRelationshipKind(relationship.kind);
  if (!kind) {
    return undefined;
  }
  return {
    kind,
    parentConversationId: normalizeNullableText(relationship.parentConversationId),
    spawnedByConversationId: normalizeNullableText(relationship.spawnedByConversationId),
  };
}

export function deriveConversationRelationship(
  params: RelationshipDerivationInput,
): ConversationRelationship {
  const explicit = normalizeConversationRelationship(params.explicitRelationship);
  if (explicit) {
    return explicit;
  }
  const parentConversationId = normalizeNullableText(params.parentConversationId);
  const spawnedByConversationId = normalizeNullableText(params.spawnedByConversationId);
  if (isSubagentSessionKey(params.conversationId)) {
    return {
      kind: "subagent",
      parentConversationId,
      spawnedByConversationId,
    };
  }
  if (
    parentConversationId &&
    spawnedByConversationId &&
    parentConversationId !== spawnedByConversationId
  ) {
    return {
      kind: "linked",
      parentConversationId,
      spawnedByConversationId,
    };
  }
  if (spawnedByConversationId) {
    return {
      kind: "spawned",
      parentConversationId,
      spawnedByConversationId,
    };
  }
  if (parentConversationId) {
    return {
      kind: "child",
      parentConversationId,
    };
  }
  return { kind: "root" };
}

export function deriveConversationCategory(params: CategoryDerivationInput): ConversationCategory {
  const explicit = normalizeCategory(params.explicitCategory);
  if (explicit) {
    return explicit;
  }
  const relationship = normalizeConversationRelationship(params.relationship);
  if (relationship?.kind === "task") {
    return "task";
  }
  if (relationship?.kind === "subagent" || isSubagentSessionKey(params.conversationId)) {
    return "subagent";
  }
  const surfaceRef = normalizeConversationSurfaceRef(params.surfaceRef);
  switch (surfaceRef?.type) {
    case "dashboard_chat":
    case "web_chat":
      return "dashboard";
    case "desktop_window":
      return "desktop";
    case "telegram_topic":
      return "topic";
    case "discord_thread":
    case "slack_thread":
    case "matrix_thread":
    case "external_thread":
      return "thread";
    case "task_surface":
      return "task";
    case "subagent_surface":
      return "subagent";
    case "system_surface":
      return "system";
  }
  const normalizedChatType = normalizeText(params.chatType)?.toLowerCase();
  if (normalizedChatType === "direct") {
    return "external_dm";
  }
  if (normalizedChatType === "group" || normalizedChatType === "channel") {
    return "external_group";
  }
  return "unknown";
}

export function normalizeConversationRuntimeRef(
  ref: ConversationRuntimeRef | null | undefined,
): ConversationRuntimeRef | undefined {
  if (!ref) {
    return undefined;
  }
  const type = normalizeRuntimeType(ref.type);
  const id = normalizeText(ref.id);
  if (!type || !id) {
    return undefined;
  }
  return {
    type,
    id,
    backend: normalizeNullableText(ref.backend),
  };
}

export function deriveConversationRuntimeRef(
  params: RuntimeDerivationInput,
): ConversationRuntimeRef | undefined {
  const explicit = normalizeConversationRuntimeRef(params.explicitRuntimeRef);
  if (explicit) {
    return explicit;
  }
  const runtimeId =
    normalizeText(params.acp?.identity?.agentSessionId) ??
    normalizeText(params.acp?.identity?.acpxSessionId) ??
    normalizeText(params.acp?.runtimeSessionName);
  if (!runtimeId) {
    return undefined;
  }
  return {
    type: "acp",
    id: runtimeId,
    backend: normalizeNullableText(params.acp?.backend),
  };
}
