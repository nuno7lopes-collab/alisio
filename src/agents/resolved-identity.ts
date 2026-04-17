import fs from "node:fs";
import type { AlisioConfig } from "../config/config.js";
import { deriveAlisioAvatarLabel, resolveAlisioAgentName } from "../shared/alisio-account.js";
import { coerceIdentityValue } from "../shared/assistant-identity-values.js";
import { resolveAvatarMime } from "../shared/avatar-policy.js";
import {
  resolveAgentConfig,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "./agent-scope.js";
import { resolveAgentAvatar } from "./identity-avatar.js";
import { loadAgentIdentityFromWorkspace } from "./identity-file.js";
import { resolveAgentIdentity } from "./identity.js";

const MAX_AGENT_NAME = 50;
const MAX_AGENT_AVATAR = 200;
const MAX_AGENT_EMOJI = 16;

export const DEFAULT_AGENT_DISPLAY_NAME = "Assistant";
export const DEFAULT_AGENT_DISPLAY_AVATAR = "A";

export type ResolvedAgentIdentity = {
  name: string;
  avatar: string;
  avatarUrl?: string;
  emoji?: string;
  theme?: string;
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

function normalizeAvatarDisplayToken(value: string | undefined): string | undefined {
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

function normalizeDerivedAvatarLabel(value: string | undefined): string | undefined {
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

function normalizeEmojiValue(value: string | undefined): string | undefined {
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

function resolveDefaultName(cfg: AlisioConfig, agentId: string): string {
  return agentId === resolveDefaultAgentId(cfg) ? DEFAULT_AGENT_DISPLAY_NAME : agentId;
}

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
  includeUiAssistant?: boolean;
  workspaceDir?: string | null;
}): string | undefined {
  const resolved = resolveAgentAvatar(params.cfg, params.agentId, {
    avatar: params.avatar,
    includeUiAssistant: params.includeUiAssistant,
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
  includeUiAssistant?: boolean;
  includeAccountIdentity?: boolean;
  accountProfile?: {
    agentName?: string;
  } | null;
}): ResolvedAgentIdentity {
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, params.agentId);
  const configIdentity = resolveAgentIdentity(params.cfg, params.agentId);
  const fileIdentity = loadAgentIdentityFromWorkspace(workspaceDir);
  const configAssistant =
    params.includeUiAssistant && params.agentId === resolveDefaultAgentId(params.cfg)
      ? params.cfg.ui?.assistant
      : undefined;
  const configuredAgentName =
    resolveAgentConfig(params.cfg, params.agentId)?.name?.trim() || undefined;
  const accountAgentName =
    params.includeAccountIdentity && params.accountProfile
      ? resolveAlisioAgentName(params.accountProfile.agentName)
      : undefined;

  const name =
    normalizeDisplayName(configAssistant?.name) ||
    normalizeDisplayName(configIdentity?.name) ||
    normalizeDisplayName(fileIdentity?.name) ||
    normalizeDisplayName(configuredAgentName) ||
    normalizeDisplayName(accountAgentName) ||
    resolveDefaultName(params.cfg, params.agentId);

  const rawAvatar =
    normalizeAvatarCandidate(configAssistant?.avatar) ||
    normalizeAvatarCandidate(configIdentity?.avatar) ||
    normalizeAvatarCandidate(configIdentity?.emoji) ||
    normalizeAvatarCandidate(fileIdentity?.avatar) ||
    normalizeAvatarCandidate(fileIdentity?.emoji);
  const avatarUrl = resolveRenderableAgentAvatarUrl({
    cfg: params.cfg,
    agentId: params.agentId,
    avatar: rawAvatar,
    includeUiAssistant: Boolean(configAssistant),
    workspaceDir,
  });
  const fallbackAvatar = deriveAlisioAvatarLabel({
    displayName: name,
    username: params.agentId,
  });
  const avatar =
    avatarUrl ||
    normalizeAvatarDisplayToken(rawAvatar) ||
    normalizeDerivedAvatarLabel(fallbackAvatar) ||
    DEFAULT_AGENT_DISPLAY_AVATAR;
  const emoji =
    normalizeEmojiValue(configAssistant?.avatar) ||
    normalizeEmojiValue(configIdentity?.emoji) ||
    normalizeEmojiValue(fileIdentity?.emoji) ||
    normalizeEmojiValue(rawAvatar);
  const theme = coerceIdentityValue(configIdentity?.theme ?? fileIdentity?.theme, MAX_AGENT_NAME);

  return {
    name,
    avatar,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(emoji ? { emoji } : {}),
    ...(theme ? { theme } : {}),
  };
}
