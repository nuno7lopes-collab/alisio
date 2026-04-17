import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveResolvedAgentIdentity } from "../agents/resolved-identity.js";
import type { AlisioConfig } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";

export const DEFAULT_ASSISTANT_IDENTITY: AssistantIdentity = {
  agentId: "main",
  name: "Assistant",
  avatar: "A",
};

export type AssistantIdentity = {
  agentId: string;
  name: string;
  avatar: string;
  emoji?: string;
};

export function resolveAssistantIdentity(params: {
  cfg: AlisioConfig;
  agentId?: string | null;
  workspaceDir?: string | null;
  accountProfile?: {
    agentName?: string;
  } | null;
}): AssistantIdentity {
  const agentId = normalizeAgentId(params.agentId ?? resolveDefaultAgentId(params.cfg));
  const resolved = resolveResolvedAgentIdentity({
    cfg: params.cfg,
    agentId,
    workspaceDir: params.workspaceDir,
    includeUiAssistant: true,
    includeAccountIdentity: true,
    accountProfile: params.accountProfile,
  });

  return {
    agentId,
    name: resolved.name || DEFAULT_ASSISTANT_IDENTITY.name,
    avatar: resolved.avatar || DEFAULT_ASSISTANT_IDENTITY.avatar,
    ...(resolved.emoji ? { emoji: resolved.emoji } : {}),
  };
}
