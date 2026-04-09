import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { loadConfig } from "../config/config.js";
import { buildAgentMainSessionKey, normalizeAgentId } from "../routing/session-key.js";
import { getHeader, normalizeGatewayRequestMessageChannel } from "./http-request-helpers.js";

export const ALISIO_MODEL_ID = "alisio";
export const ALISIO_DEFAULT_MODEL_ID = "alisio/default";
const LEGACY_MODEL_ID = "openclaw";
const LEGACY_DEFAULT_MODEL_ID = "openclaw/default";

function getCompatHeader(
  req: IncomingMessage,
  canonicalName: string,
  legacyName: string,
): string | undefined {
  return getHeader(req, canonicalName) ?? getHeader(req, legacyName);
}

export function normalizeGatewayModelAlias(model: string | undefined): string | undefined {
  const raw = model?.trim();
  if (!raw) {
    return undefined;
  }
  const lowered = raw.toLowerCase();
  if (lowered === LEGACY_MODEL_ID) {
    return ALISIO_MODEL_ID;
  }
  if (lowered === LEGACY_DEFAULT_MODEL_ID) {
    return ALISIO_DEFAULT_MODEL_ID;
  }
  const legacyMatch = raw.match(/^openclaw[:/](?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i);
  if (legacyMatch?.groups?.agentId) {
    return `${ALISIO_MODEL_ID}/${legacyMatch.groups.agentId}`;
  }
  return raw;
}

function resolveDefaultAgentIdFromConfig(cfg = loadConfig()): string {
  const agents = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const defaults = agents.filter((agent) => agent?.default);
  const chosen = defaults[0] ?? agents[0];
  const id = typeof chosen?.id === "string" ? chosen.id : "";
  return normalizeAgentId(id || "main");
}

export function resolveAgentIdFromHeader(req: IncomingMessage): string | undefined {
  const raw =
    getCompatHeader(req, "x-alisio-agent-id", "x-openclaw-agent-id")?.trim() ||
    getCompatHeader(req, "x-alisio-agent", "x-openclaw-agent")?.trim() ||
    "";
  if (!raw) {
    return undefined;
  }
  return normalizeAgentId(raw);
}

export function resolveAgentIdFromModel(
  model: string | undefined,
  cfg = loadConfig(),
): string | undefined {
  const raw = normalizeGatewayModelAlias(model)?.trim();
  if (!raw) {
    return undefined;
  }
  const lowered = raw.toLowerCase();
  if (lowered === ALISIO_MODEL_ID || lowered === ALISIO_DEFAULT_MODEL_ID) {
    return resolveDefaultAgentIdFromConfig(cfg);
  }

  const m =
    raw.match(/^alisio[:/](?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i) ??
    raw.match(/^agent:(?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i);
  const agentId = m?.groups?.agentId;
  if (!agentId) {
    return undefined;
  }
  return normalizeAgentId(agentId);
}

export async function resolveOpenAiCompatModelOverride(params: {
  req: IncomingMessage;
  agentId: string;
  model: string | undefined;
}): Promise<{ modelOverride?: string; errorMessage?: string }> {
  const { buildAllowedModelSet, modelKey, parseModelRef, resolveDefaultModelForAgent } =
    await import("../agents/model-selection.js");
  const { loadGatewayModelCatalog } = await import("./server-model-catalog.js");
  const requestModel = normalizeGatewayModelAlias(params.model)?.trim();
  if (requestModel && !resolveAgentIdFromModel(requestModel)) {
    return {
      errorMessage: "Invalid `model`. Use `alisio` or `alisio/<agentId>`.",
    };
  }

  const raw = normalizeGatewayModelAlias(
    getCompatHeader(params.req, "x-alisio-model", "x-openclaw-model"),
  )?.trim();
  if (!raw) {
    return {};
  }

  const cfg = loadConfig();
  const defaultModelRef = resolveDefaultModelForAgent({ cfg, agentId: params.agentId });
  const defaultProvider = defaultModelRef.provider;
  const parsed = parseModelRef(raw, defaultProvider);
  if (!parsed) {
    return { errorMessage: "Invalid `x-alisio-model`." };
  }

  const catalog = await loadGatewayModelCatalog();
  const allowed = buildAllowedModelSet({
    cfg,
    catalog,
    defaultProvider,
    agentId: params.agentId,
  });
  const normalized = modelKey(parsed.provider, parsed.model);
  if (!allowed.allowAny && !allowed.allowedKeys.has(normalized)) {
    return {
      errorMessage: `Model '${normalized}' is not allowed for agent '${params.agentId}'.`,
    };
  }

  return { modelOverride: raw };
}

export function resolveAgentIdForRequest(params: {
  req: IncomingMessage;
  model: string | undefined;
}): string {
  const cfg = loadConfig();
  const fromHeader = resolveAgentIdFromHeader(params.req);
  if (fromHeader) {
    return fromHeader;
  }

  const fromModel = resolveAgentIdFromModel(params.model, cfg);
  return fromModel ?? resolveDefaultAgentIdFromConfig(cfg);
}

export function resolveSessionKey(params: {
  req: IncomingMessage;
  agentId: string;
  user?: string | undefined;
  prefix: string;
}): string {
  const explicit = getCompatHeader(
    params.req,
    "x-alisio-session-key",
    "x-openclaw-session-key",
  )?.trim();
  if (explicit) {
    return explicit;
  }

  const user = params.user?.trim();
  const mainKey = user ? `${params.prefix}-user:${user}` : `${params.prefix}:${randomUUID()}`;
  return buildAgentMainSessionKey({ agentId: params.agentId, mainKey });
}

export function resolveGatewayRequestContext(params: {
  req: IncomingMessage;
  model: string | undefined;
  user?: string | undefined;
  sessionPrefix: string;
  defaultMessageChannel: string;
  useMessageChannelHeader?: boolean;
}): { agentId: string; sessionKey: string; messageChannel: string } {
  const agentId = resolveAgentIdForRequest({ req: params.req, model: params.model });
  const sessionKey = resolveSessionKey({
    req: params.req,
    agentId,
    user: params.user,
    prefix: params.sessionPrefix,
  });

  const messageChannel = params.useMessageChannelHeader
    ? (normalizeGatewayRequestMessageChannel(
        getCompatHeader(params.req, "x-alisio-message-channel", "x-openclaw-message-channel"),
      ) ?? params.defaultMessageChannel)
    : params.defaultMessageChannel;

  return { agentId, sessionKey, messageChannel };
}
