import type { MsgContext } from "../../auto-reply/templating.js";
import {
  buildAgentPeerSessionKey,
  buildAgentMainSessionKey,
  DEFAULT_AGENT_ID,
  normalizeMainKey,
} from "../../routing/session-key.js";
import { normalizeE164 } from "../../utils.js";
import { resolveGatewayMessageChannel } from "../../utils/message-channel.js";
import { resolveDmScope } from "../session-defaults.js";
import type { DmScope } from "../types.base.js";
import { normalizeExplicitSessionKey } from "./explicit-session-key-normalization.js";
import { resolveGroupSessionKey } from "./group.js";
import type { SessionScope } from "./types.js";

// Decide which session bucket to use (per-sender vs global).
export function deriveSessionKey(scope: SessionScope, ctx: MsgContext) {
  if (scope === "global") {
    return "global";
  }
  const resolvedGroup = resolveGroupSessionKey(ctx);
  if (resolvedGroup) {
    return resolvedGroup.key;
  }
  const from = ctx.From ? normalizeE164(ctx.From) : "";
  return from || "unknown";
}

/**
 * Resolve the session key with channel-aware DM isolation when the inbound
 * context identifies a real message channel. Ambiguous legacy direct contexts
 * still fall back to the canonical main bucket.
 */
function stripPrefixCaseInsensitive(value: string, prefix: string): string {
  return value.toLowerCase().startsWith(prefix.toLowerCase()) ? value.slice(prefix.length) : value;
}

function resolveDirectSessionChannel(ctx: MsgContext): string | undefined {
  const provider = resolveGatewayMessageChannel(ctx.Provider);
  if (provider) {
    return provider;
  }
  const surface = resolveGatewayMessageChannel(ctx.Surface);
  if (surface) {
    return surface;
  }
  const originatingChannel = resolveGatewayMessageChannel(
    typeof ctx.OriginatingChannel === "string" ? ctx.OriginatingChannel : undefined,
  );
  if (originatingChannel) {
    return originatingChannel;
  }
  const from = typeof ctx.From === "string" ? ctx.From.trim() : "";
  if (!from) {
    return undefined;
  }
  return resolveGatewayMessageChannel(from.split(":", 1)[0]?.trim());
}

function resolveDirectPeerId(ctx: MsgContext, channel: string): string | undefined {
  const senderId =
    typeof ctx.SenderId === "string"
      ? ctx.SenderId.trim()
      : typeof ctx.SenderId === "number" || typeof ctx.SenderId === "bigint"
        ? String(ctx.SenderId).trim()
        : "";
  if (senderId) {
    return senderId.toLowerCase();
  }

  const from = typeof ctx.From === "string" ? ctx.From.trim() : "";
  if (!from) {
    return undefined;
  }
  if (channel === "whatsapp") {
    return normalizeE164(from);
  }

  const withoutChannel = stripPrefixCaseInsensitive(from, `${channel}:`).trim();
  const withoutKind = withoutChannel.replace(/^(?:user|direct|dm):/i, "").trim();
  return withoutKind ? withoutKind.toLowerCase() : undefined;
}

function resolveDirectSessionKey(params: {
  ctx: MsgContext;
  mainKey?: string;
  dmScope: DmScope;
}): string | undefined {
  const channel = resolveDirectSessionChannel(params.ctx);
  if (!channel && params.dmScope !== "per-peer") {
    return undefined;
  }
  const peerId = resolveDirectPeerId(params.ctx, channel ?? "unknown");
  if (!peerId) {
    return undefined;
  }
  return buildAgentPeerSessionKey({
    agentId: DEFAULT_AGENT_ID,
    mainKey: params.mainKey,
    channel: channel ?? "unknown",
    accountId: params.ctx.AccountId ?? null,
    peerKind: "direct",
    peerId,
    dmScope: params.dmScope,
  });
}

export function resolveSessionKey(
  scope: SessionScope,
  ctx: MsgContext,
  mainKey?: string,
  dmScope?: DmScope,
) {
  const explicit = ctx.SessionKey?.trim();
  if (explicit) {
    return normalizeExplicitSessionKey(explicit, ctx);
  }
  const raw = deriveSessionKey(scope, ctx);
  if (scope === "global") {
    return raw;
  }
  const canonicalMainKey = normalizeMainKey(mainKey);
  const canonicalMainSessionKey = buildAgentMainSessionKey({
    agentId: DEFAULT_AGENT_ID,
    mainKey: canonicalMainKey,
  });
  const isGroup = raw.includes(":group:") || raw.includes(":channel:");
  if (isGroup) {
    return `agent:${DEFAULT_AGENT_ID}:${raw}`;
  }
  const directSessionKey = resolveDirectSessionKey({
    ctx,
    mainKey: canonicalMainKey,
    dmScope: resolveDmScope(dmScope),
  });
  return directSessionKey ?? canonicalMainSessionKey;
}
