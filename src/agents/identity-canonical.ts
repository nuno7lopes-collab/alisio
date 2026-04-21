import type { AlisioConfig } from "../config/config.js";
import { deriveAlisioAvatarLabel, resolveAlisioAgentName } from "../shared/alisio-account.js";
import { coerceIdentityValue } from "../shared/assistant-identity-values.js";
import {
  resolveAgentConfig,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "./agent-scope.js";
import type { AgentIdentityFile } from "./identity-file.js";
import { loadAgentIdentityFromWorkspace } from "./identity-file.js";
import { resolveAgentIdentity } from "./identity.js";

const MAX_AGENT_NAME = 50;
const MAX_AGENT_AVATAR = 200;
const MAX_AGENT_EMOJI = 16;

export const DEFAULT_AGENT_DISPLAY_NAME = "Assistant";
export const DEFAULT_AGENT_DISPLAY_AVATAR = "A";

export type CanonicalAgentIdentitySource =
  | "identity-file"
  | "config-identity"
  | "agent-config"
  | "account-profile";

export type CanonicalAgentIdentitySnapshot = {
  name?: string;
  avatar?: string;
  emoji?: string;
  theme?: string;
  configuredAgentName?: string;
  workspaceIdentity: AgentIdentityFile | null;
  sources: {
    name?: CanonicalAgentIdentitySource;
    avatar?: CanonicalAgentIdentitySource;
    emoji?: CanonicalAgentIdentitySource;
    theme?: CanonicalAgentIdentitySource;
  };
};

function normalizeDisplayName(value: string | undefined): string | undefined {
  return coerceIdentityValue(value, MAX_AGENT_NAME);
}

function normalizeAvatarCandidate(value: string | undefined): string | undefined {
  const trimmed = coerceIdentityValue(value, MAX_AGENT_AVATAR);
  if (!trimmed) {
    return undefined;
  }
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
    return trimmed;
  }
  if (/[\\/]/.test(trimmed) || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(trimmed)) {
    return trimmed;
  }
  if (!/\s/.test(trimmed) && trimmed.length <= 4) {
    return trimmed;
  }
  return undefined;
}

export function normalizeAvatarDisplayToken(value: string | undefined): string | undefined {
  const trimmed = coerceIdentityValue(value, MAX_AGENT_AVATAR);
  if (!trimmed) {
    return undefined;
  }
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
    return undefined;
  }
  if (/[\\/]/.test(trimmed) || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(trimmed)) {
    return undefined;
  }
  if (!/\s/.test(trimmed) && trimmed.length <= 4) {
    return trimmed;
  }
  return undefined;
}

export function normalizeDerivedAvatarLabel(value: string | undefined): string | undefined {
  const trimmed = coerceIdentityValue(value, MAX_AGENT_AVATAR);
  if (!trimmed) {
    return undefined;
  }
  if (/[A-Za-z0-9]/.test(trimmed)) {
    return trimmed;
  }
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 127) {
      return trimmed;
    }
  }
  return undefined;
}

export function normalizeEmojiValue(value: string | undefined): string | undefined {
  const trimmed = coerceIdentityValue(value, MAX_AGENT_EMOJI);
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > MAX_AGENT_EMOJI) {
    return undefined;
  }
  let hasNonAscii = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 127) {
      hasNonAscii = true;
      break;
    }
  }
  if (!hasNonAscii) {
    return undefined;
  }
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) {
    return undefined;
  }
  if (/[\\/]/.test(trimmed) || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function resolveDefaultName(cfg: AlisioConfig, agentId: string): string {
  return agentId === resolveDefaultAgentId(cfg) ? DEFAULT_AGENT_DISPLAY_NAME : agentId;
}

export function deriveDefaultAvatarLabel(params: { displayName: string; agentId: string }): string {
  return deriveAlisioAvatarLabel({
    displayName: params.displayName,
    username: params.agentId,
  });
}

export function resolveCanonicalAgentIdentitySnapshot(params: {
  cfg: AlisioConfig;
  agentId: string;
  workspaceDir?: string | null;
  includeAccountIdentity?: boolean;
  accountProfile?: {
    agentName?: string;
  } | null;
}): CanonicalAgentIdentitySnapshot {
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, params.agentId);
  const configIdentity = resolveAgentIdentity(params.cfg, params.agentId);
  const workspaceIdentity = loadAgentIdentityFromWorkspace(workspaceDir);
  const configuredAgentName =
    resolveAgentConfig(params.cfg, params.agentId)?.name?.trim() || undefined;
  const accountAgentName =
    params.includeAccountIdentity && params.accountProfile
      ? resolveAlisioAgentName(params.accountProfile.agentName)
      : undefined;

  const name =
    normalizeDisplayName(workspaceIdentity?.name) ||
    normalizeDisplayName(configIdentity?.name) ||
    normalizeDisplayName(configuredAgentName) ||
    normalizeDisplayName(accountAgentName);
  const avatar =
    normalizeAvatarCandidate(workspaceIdentity?.avatar) ||
    normalizeAvatarCandidate(configIdentity?.avatar);
  const emoji =
    normalizeEmojiValue(workspaceIdentity?.emoji) || normalizeEmojiValue(configIdentity?.emoji);
  const theme = coerceIdentityValue(
    workspaceIdentity?.theme ?? configIdentity?.theme,
    MAX_AGENT_NAME,
  );

  return {
    ...(name ? { name } : {}),
    ...(avatar ? { avatar } : {}),
    ...(emoji ? { emoji } : {}),
    ...(theme ? { theme } : {}),
    ...(configuredAgentName ? { configuredAgentName } : {}),
    workspaceIdentity,
    sources: {
      ...(name
        ? {
            name: normalizeDisplayName(workspaceIdentity?.name)
              ? "identity-file"
              : normalizeDisplayName(configIdentity?.name)
                ? "config-identity"
                : normalizeDisplayName(configuredAgentName)
                  ? "agent-config"
                  : "account-profile",
          }
        : {}),
      ...(avatar
        ? {
            avatar: normalizeAvatarCandidate(workspaceIdentity?.avatar)
              ? "identity-file"
              : "config-identity",
          }
        : {}),
      ...(emoji
        ? {
            emoji: normalizeEmojiValue(workspaceIdentity?.emoji)
              ? "identity-file"
              : "config-identity",
          }
        : {}),
      ...(theme
        ? {
            theme: coerceIdentityValue(workspaceIdentity?.theme, MAX_AGENT_NAME)
              ? "identity-file"
              : "config-identity",
          }
        : {}),
    },
  };
}
