import fs from "node:fs";
import type { AlisioConfig } from "../config/config.js";
import { resolveAvatarMime } from "../shared/avatar-policy.js";
import { resolveAgentWorkspaceDir } from "./agent-scope.js";
import { resolveAgentAvatar } from "./identity-avatar.js";
import {
  DEFAULT_AGENT_DISPLAY_AVATAR,
  deriveDefaultAvatarLabel,
  normalizeAvatarDisplayToken,
  normalizeDerivedAvatarLabel,
  resolveCanonicalAgentIdentitySnapshot,
  resolveDefaultName,
} from "./identity-canonical.js";
export { DEFAULT_AGENT_DISPLAY_NAME, DEFAULT_AGENT_DISPLAY_AVATAR } from "./identity-canonical.js";

export type ResolvedAgentIdentity = {
  name: string;
  avatar: string;
  avatarUrl?: string;
  emoji?: string;
  theme?: string;
};

function toDataUrl(filePath: string): string | undefined {
  try {
    const buffer = fs.readFileSync(filePath);
    const mime = resolveAvatarMime(filePath);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export function resolveRenderableAgentAvatarUrl(params: {
  cfg: AlisioConfig;
  agentId: string;
  avatar?: string | null;
  workspaceDir?: string | null;
}): string | undefined {
  const resolved = resolveAgentAvatar(params.cfg, params.agentId, {
    avatar: params.avatar,
    workspaceDir: params.workspaceDir,
  });
  if (resolved.kind === "remote" || resolved.kind === "data") {
    return resolved.url;
  }
  if (resolved.kind === "local") {
    return toDataUrl(resolved.filePath);
  }
  return undefined;
}

export function resolveResolvedAgentIdentity(params: {
  cfg: AlisioConfig;
  agentId: string;
  workspaceDir?: string | null;
  includeAccountIdentity?: boolean;
  accountProfile?: {
    agentName?: string;
  } | null;
}): ResolvedAgentIdentity {
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, params.agentId);
  const snapshot = resolveCanonicalAgentIdentitySnapshot({
    cfg: params.cfg,
    agentId: params.agentId,
    workspaceDir,
    includeAccountIdentity: params.includeAccountIdentity,
    accountProfile: params.accountProfile,
  });

  const name = snapshot.name || resolveDefaultName(params.cfg, params.agentId);
  const rawAvatar = snapshot.avatar ?? snapshot.emoji;
  const avatarUrl = resolveRenderableAgentAvatarUrl({
    cfg: params.cfg,
    agentId: params.agentId,
    avatar: rawAvatar,
    workspaceDir,
  });
  const fallbackAvatar = deriveDefaultAvatarLabel({
    displayName: name,
    agentId: params.agentId,
  });
  const avatar =
    avatarUrl ||
    normalizeAvatarDisplayToken(rawAvatar) ||
    normalizeDerivedAvatarLabel(fallbackAvatar) ||
    DEFAULT_AGENT_DISPLAY_AVATAR;
  const emoji = snapshot.emoji;
  const theme = snapshot.theme;

  return {
    name,
    avatar,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(emoji ? { emoji } : {}),
    ...(theme ? { theme } : {}),
  };
}
