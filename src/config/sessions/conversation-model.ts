import type { ConversationBindingContext } from "../../channels/conversation-binding-context.js";
import { deriveSessionChatType } from "../../sessions/session-key-utils.js";
import {
  deriveConversationCategory,
  deriveConversationRelationship,
  deriveConversationRuntimeRef,
  deriveConversationSurfaceRef,
  type ConversationCategory,
  type ConversationRelationship,
  type ConversationRuntimeRef,
  type ConversationSurfaceRef,
} from "../../shared/conversation-model.js";
import type { SessionEntry } from "./types.js";

type ResolvedConversationModel = {
  conversationId: string;
  conversationKey: string;
  transcriptId?: string;
  category: ConversationCategory;
  surfaceRef?: ConversationSurfaceRef;
  runtimeRef?: ConversationRuntimeRef;
  relationship: ConversationRelationship;
};

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function resolveLegacySurfaceId(entry: SessionEntry | undefined): string | undefined {
  return (
    normalizeText(entry?.surfaceRef?.id) ??
    normalizeText(entry?.groupId) ??
    normalizeText(entry?.lastTo) ??
    normalizeText(entry?.origin?.to) ??
    normalizeText(entry?.origin?.from)
  );
}

function resolveLegacyParentSurfaceId(
  entry: SessionEntry | undefined,
  surfaceId: string | undefined,
): string | undefined {
  const explicitParent = normalizeText(entry?.surfaceRef?.parent);
  if (explicitParent) {
    return explicitParent;
  }
  const topicLikeId = surfaceId ?? resolveLegacySurfaceId(entry);
  if (!topicLikeId) {
    return undefined;
  }
  const match = /^(.+):topic:[^:]+$/i.exec(topicLikeId);
  return match?.[1]?.trim() || undefined;
}

function resolveSessionChatType(
  entry: SessionEntry | undefined,
  sessionKey: string,
): string | undefined {
  return entry?.chatType ?? deriveSessionChatType(sessionKey);
}

export function deriveSessionConversationModel(params: {
  sessionKey: string;
  entry?: SessionEntry;
  bindingContext?: ConversationBindingContext | null;
}): ResolvedConversationModel {
  const conversationId = params.sessionKey.trim();
  const entry = params.entry;
  const bindingContext = params.bindingContext ?? undefined;
  const chatType = resolveSessionChatType(entry, conversationId);
  const surfaceId =
    bindingContext?.conversationId ?? resolveLegacySurfaceId(entry) ?? conversationId;
  const parentSurfaceId =
    bindingContext?.parentConversationId ?? resolveLegacyParentSurfaceId(entry, surfaceId);
  const surfaceRef = deriveConversationSurfaceRef({
    conversationId,
    explicitSurfaceRef: entry?.surfaceRef,
    channel:
      bindingContext?.channel ?? entry?.origin?.provider ?? entry?.lastChannel ?? entry?.channel,
    accountId:
      bindingContext?.accountId ?? entry?.origin?.accountId ?? entry?.lastAccountId ?? undefined,
    chatType,
    threadId:
      bindingContext?.threadId ?? entry?.origin?.threadId ?? entry?.lastThreadId ?? undefined,
    surfaceId,
    parentSurfaceId,
  });
  const relationship = deriveConversationRelationship({
    conversationId,
    explicitRelationship: entry?.relationship,
    parentConversationId: entry?.parentSessionKey,
    spawnedByConversationId: entry?.spawnedBy,
  });
  const category = deriveConversationCategory({
    conversationId,
    explicitCategory: entry?.category,
    chatType,
    relationship,
    surfaceRef,
  });
  const runtimeRef = deriveConversationRuntimeRef({
    acp: entry?.acp,
  });
  return {
    conversationId,
    conversationKey: conversationId,
    transcriptId: entry?.sessionId,
    category,
    surfaceRef,
    runtimeRef,
    relationship,
  };
}
