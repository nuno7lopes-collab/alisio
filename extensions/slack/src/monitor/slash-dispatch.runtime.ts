import { resolveMarkdownTableMode as resolveMarkdownTableModeImpl } from "alisio/plugin-sdk/config-runtime";
import {
  recordInboundSessionMetaSafe as recordInboundSessionMetaSafeImpl,
  resolveConversationLabel as resolveConversationLabelImpl,
} from "alisio/plugin-sdk/conversation-runtime";
import {
  dispatchReplyWithDispatcher as dispatchReplyWithDispatcherImpl,
  finalizeInboundContext as finalizeInboundContextImpl,
  resolveChunkMode as resolveChunkModeImpl,
} from "alisio/plugin-sdk/reply-runtime";
import { resolveAgentRoute as resolveAgentRouteImpl } from "alisio/plugin-sdk/routing";
import { deliverSlackSlashReplies as deliverSlackSlashRepliesImpl } from "./replies.js";

type ResolveChunkMode = typeof import("alisio/plugin-sdk/reply-runtime").resolveChunkMode;
type FinalizeInboundContext =
  typeof import("alisio/plugin-sdk/reply-runtime").finalizeInboundContext;
type DispatchReplyWithDispatcher =
  typeof import("alisio/plugin-sdk/reply-runtime").dispatchReplyWithDispatcher;
type ResolveConversationLabel =
  typeof import("alisio/plugin-sdk/conversation-runtime").resolveConversationLabel;
type RecordInboundSessionMetaSafe =
  typeof import("alisio/plugin-sdk/conversation-runtime").recordInboundSessionMetaSafe;
type ResolveMarkdownTableMode =
  typeof import("alisio/plugin-sdk/config-runtime").resolveMarkdownTableMode;
type ResolveAgentRoute = typeof import("alisio/plugin-sdk/routing").resolveAgentRoute;
type DeliverSlackSlashReplies = typeof import("./replies.js").deliverSlackSlashReplies;

export function resolveChunkMode(
  ...args: Parameters<ResolveChunkMode>
): ReturnType<ResolveChunkMode> {
  return resolveChunkModeImpl(...args);
}

export function finalizeInboundContext(
  ...args: Parameters<FinalizeInboundContext>
): ReturnType<FinalizeInboundContext> {
  return finalizeInboundContextImpl(...args);
}

export function dispatchReplyWithDispatcher(
  ...args: Parameters<DispatchReplyWithDispatcher>
): ReturnType<DispatchReplyWithDispatcher> {
  return dispatchReplyWithDispatcherImpl(...args);
}

export function resolveConversationLabel(
  ...args: Parameters<ResolveConversationLabel>
): ReturnType<ResolveConversationLabel> {
  return resolveConversationLabelImpl(...args);
}

export function recordInboundSessionMetaSafe(
  ...args: Parameters<RecordInboundSessionMetaSafe>
): ReturnType<RecordInboundSessionMetaSafe> {
  return recordInboundSessionMetaSafeImpl(...args);
}

export function resolveMarkdownTableMode(
  ...args: Parameters<ResolveMarkdownTableMode>
): ReturnType<ResolveMarkdownTableMode> {
  return resolveMarkdownTableModeImpl(...args);
}

export function resolveAgentRoute(
  ...args: Parameters<ResolveAgentRoute>
): ReturnType<ResolveAgentRoute> {
  return resolveAgentRouteImpl(...args);
}

export function deliverSlackSlashReplies(
  ...args: Parameters<DeliverSlackSlashReplies>
): ReturnType<DeliverSlackSlashReplies> {
  return deliverSlackSlashRepliesImpl(...args);
}
