import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { normalizeAvatarDisplayToken } from "../agents/identity-canonical.js";
import { resolveResolvedAgentIdentity } from "../agents/resolved-identity.js";
import type { AlisioConfig } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { coerceIdentityValue } from "../shared/assistant-identity-values.js";

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
    includeAccountIdentity: true,
    accountProfile: params.accountProfile,
  });
  const uiAssistant =
    agentId === resolveDefaultAgentId(params.cfg) ? params.cfg.ui?.assistant : null;
  const uiName = coerceIdentityValue(uiAssistant?.name, 50);
  const uiAvatar = coerceIdentityValue(uiAssistant?.avatar, 200);
  const uiAvatarToken = normalizeAvatarDisplayToken(uiAvatar);

  return {
    agentId,
    name: uiName || resolved.name || DEFAULT_ASSISTANT_IDENTITY.name,
    avatar: uiAvatarToken || resolved.avatar || DEFAULT_ASSISTANT_IDENTITY.avatar,
    ...(resolved.emoji ? { emoji: resolved.emoji } : {}),
  };
}
