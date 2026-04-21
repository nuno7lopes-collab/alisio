import fs from "node:fs";
import path from "node:path";
import type { AlisioConfig } from "../config/config.js";
import {
  AVATAR_MAX_BYTES,
  isAvatarDataUrl,
  isAvatarHttpUrl,
  isPathWithinRoot,
  isSupportedLocalAvatarExtension,
} from "../shared/avatar-policy.js";
import { resolveUserPath } from "../utils.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "./agent-scope.js";
import {
  normalizeAvatarDisplayToken,
  resolveCanonicalAgentIdentitySnapshot,
} from "./identity-canonical.js";

export type AgentAvatarResolution =
  | { kind: "none"; reason: string }
  | { kind: "local"; filePath: string }
  | { kind: "remote"; url: string }
  | { kind: "data"; url: string };

function normalizeAvatarValue(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveAvatarSource(
  cfg: AlisioConfig,
  agentId: string,
  opts?: {
    avatar?: string | null;
    includeUiAssistant?: boolean;
    workspaceDir?: string | null;
  },
): string | null {
  const explicit = normalizeAvatarValue(opts?.avatar);
  if (explicit) {
    return explicit;
  }
  if (opts?.includeUiAssistant && agentId === resolveDefaultAgentId(cfg)) {
    const fromUiAssistant = normalizeAvatarValue(cfg.ui?.assistant?.avatar);
    if (fromUiAssistant && normalizeAvatarDisplayToken(fromUiAssistant)) {
      return fromUiAssistant;
    }
    if (fromUiAssistant && /^(https?:\/\/|data:image\/)/i.test(fromUiAssistant)) {
      return fromUiAssistant;
    }
  }
  const workspace = opts?.workspaceDir ?? resolveAgentWorkspaceDir(cfg, agentId);
  const snapshot = resolveCanonicalAgentIdentitySnapshot({
    cfg,
    agentId,
    workspaceDir: workspace,
  });
  return normalizeAvatarValue(snapshot.avatar);
}

function resolveExistingPath(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function resolveLocalAvatarPath(params: {
  raw: string;
  workspaceDir: string;
}): { ok: true; filePath: string } | { ok: false; reason: string } {
  const workspaceRoot = resolveExistingPath(params.workspaceDir);
  const raw = params.raw;
  const resolved =
    raw.startsWith("~") || path.isAbsolute(raw)
      ? resolveUserPath(raw)
      : path.resolve(workspaceRoot, raw);
  const realPath = resolveExistingPath(resolved);
  if (!isPathWithinRoot(workspaceRoot, realPath)) {
    return { ok: false, reason: "outside_workspace" };
  }
  if (!isSupportedLocalAvatarExtension(realPath)) {
    return { ok: false, reason: "unsupported_extension" };
  }
  try {
    const stat = fs.statSync(realPath);
    if (!stat.isFile()) {
      return { ok: false, reason: "missing" };
    }
    if (stat.size > AVATAR_MAX_BYTES) {
      return { ok: false, reason: "too_large" };
    }
  } catch {
    return { ok: false, reason: "missing" };
  }
  return { ok: true, filePath: realPath };
}

export function resolveAgentAvatar(
  cfg: AlisioConfig,
  agentId: string,
  opts?: {
    avatar?: string | null;
    includeUiAssistant?: boolean;
    workspaceDir?: string | null;
  },
): AgentAvatarResolution {
  const source = resolveAvatarSource(cfg, agentId, opts);
  if (!source) {
    return { kind: "none", reason: "missing" };
  }
  if (isAvatarHttpUrl(source)) {
    return { kind: "remote", url: source };
  }
  if (isAvatarDataUrl(source)) {
    return { kind: "data", url: source };
  }
  const workspaceDir = opts?.workspaceDir ?? resolveAgentWorkspaceDir(cfg, agentId);
  const resolved = resolveLocalAvatarPath({ raw: source, workspaceDir });
  if (!resolved.ok) {
    return { kind: "none", reason: resolved.reason };
  }
  return { kind: "local", filePath: resolved.filePath };
}
