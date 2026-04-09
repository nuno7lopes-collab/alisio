import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { legacyEnvKey, readEnv } from "../infra/env.js";
import { resolveHomeRelativePath, resolveRequiredHomeDir } from "../infra/home-dir.js";

type GatewayPortConfig = {
  gateway?: {
    port?: number;
  };
};

/**
 * Nix mode detection: when `ALISIO_NIX_MODE=1`, the gateway is running under Nix.
 * In this mode:
 * - No auto-install flows should be attempted
 * - Missing dependencies should produce actionable Nix-specific error messages
 * - Config is managed externally (read-only from Nix perspective)
 */
export function resolveIsNixMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return readEnv("ALISIO_NIX_MODE", { env, fallback: legacyEnvKey("NIX_MODE") }) === "1";
}

export const isNixMode = resolveIsNixMode();

const LEGACY_RUNTIME_NAMESPACE = ["open", "claw"].join("");
const LEGACY_ALT_RUNTIME_NAMESPACE = ["claw", "dbot"].join("");
const LEGACY_STATE_DIRNAMES = [
  `.${LEGACY_RUNTIME_NAMESPACE}`,
  `.${LEGACY_ALT_RUNTIME_NAMESPACE}`,
] as const;
const STATE_DIRNAME = ".alisio";
const CONFIG_FILENAME = "alisio.json";
const LEGACY_CONFIG_FILENAMES = [
  `${LEGACY_RUNTIME_NAMESPACE}.json`,
  `${LEGACY_ALT_RUNTIME_NAMESPACE}.json`,
] as const;

function resolveDefaultHomeDir(): string {
  return resolveRequiredHomeDir(process.env, os.homedir);
}

/** Build a homedir thunk that respects `ALISIO_HOME` for the given env. */
function envHomedir(env: NodeJS.ProcessEnv): () => string {
  return () => resolveRequiredHomeDir(env, os.homedir);
}

function legacyStateDirs(homedir: () => string = resolveDefaultHomeDir): string[] {
  return LEGACY_STATE_DIRNAMES.map((dir) => path.join(homedir(), dir));
}

function newStateDir(homedir: () => string = resolveDefaultHomeDir): string {
  return path.join(homedir(), STATE_DIRNAME);
}

export function resolveLegacyStateDir(homedir: () => string = resolveDefaultHomeDir): string {
  return legacyStateDirs(homedir)[0] ?? newStateDir(homedir);
}

export function resolveLegacyStateDirs(homedir: () => string = resolveDefaultHomeDir): string[] {
  return legacyStateDirs(homedir);
}

export function resolveNewStateDir(homedir: () => string = resolveDefaultHomeDir): string {
  return newStateDir(homedir);
}

/**
 * State directory for mutable data (sessions, logs, caches).
 * Can be overridden via `ALISIO_STATE_DIR`.
 * Default: `~/.alisio`
 */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = envHomedir(env),
): string {
  const effectiveHomedir = () => resolveRequiredHomeDir(env, homedir);
  const override = readEnv("ALISIO_STATE_DIR", { env, fallback: legacyEnvKey("STATE_DIR") });
  if (override) {
    return resolveUserPath(override, env, effectiveHomedir);
  }
  const newDir = newStateDir(effectiveHomedir);
  if (readEnv("ALISIO_TEST_FAST", { env, fallback: legacyEnvKey("TEST_FAST") }) === "1") {
    return newDir;
  }
  const legacyDirs = legacyStateDirs(effectiveHomedir);
  const hasNew = fs.existsSync(newDir);
  if (hasNew) {
    return newDir;
  }
  const existingLegacy = legacyDirs.find((dir) => {
    try {
      return fs.existsSync(dir);
    } catch {
      return false;
    }
  });
  if (existingLegacy) {
    return existingLegacy;
  }
  return newDir;
}

function resolveUserPath(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = envHomedir(env),
): string {
  return resolveHomeRelativePath(input, { env, homedir });
}

export const STATE_DIR = resolveStateDir();

/**
 * Config file path (JSON or JSON5).
 * Can be overridden via `ALISIO_CONFIG_PATH`.
 * Default: `~/.alisio/alisio.json` (or `$ALISIO_STATE_DIR/alisio.json`)
 */
export function resolveCanonicalConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, envHomedir(env)),
): string {
  const override = readEnv("ALISIO_CONFIG_PATH", { env, fallback: legacyEnvKey("CONFIG_PATH") });
  if (override) {
    return resolveUserPath(override, env, envHomedir(env));
  }
  return path.join(stateDir, CONFIG_FILENAME);
}

/**
 * Resolve the active config path by preferring existing config candidates
 * before falling back to the canonical path.
 */
export function resolveConfigPathCandidate(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = envHomedir(env),
): string {
  if (readEnv("ALISIO_TEST_FAST", { env, fallback: legacyEnvKey("TEST_FAST") }) === "1") {
    return resolveCanonicalConfigPath(env, resolveStateDir(env, homedir));
  }
  const candidates = resolveDefaultConfigCandidates(env, homedir);
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (existing) {
    return existing;
  }
  return resolveCanonicalConfigPath(env, resolveStateDir(env, homedir));
}

/**
 * Active config path (prefers existing config files).
 */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, envHomedir(env)),
  homedir: () => string = envHomedir(env),
): string {
  const override = readEnv("ALISIO_CONFIG_PATH", { env, fallback: legacyEnvKey("CONFIG_PATH") });
  if (override) {
    return resolveUserPath(override, env, homedir);
  }
  if (readEnv("ALISIO_TEST_FAST", { env, fallback: legacyEnvKey("TEST_FAST") }) === "1") {
    return path.join(stateDir, CONFIG_FILENAME);
  }
  const stateOverride = readEnv("ALISIO_STATE_DIR", { env, fallback: legacyEnvKey("STATE_DIR") });
  const candidates = [
    path.join(stateDir, CONFIG_FILENAME),
    ...LEGACY_CONFIG_FILENAMES.map((name) => path.join(stateDir, name)),
  ];
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (existing) {
    return existing;
  }
  if (stateOverride) {
    return path.join(stateDir, CONFIG_FILENAME);
  }
  const defaultStateDir = resolveStateDir(env, homedir);
  if (path.resolve(stateDir) === path.resolve(defaultStateDir)) {
    return resolveConfigPathCandidate(env, homedir);
  }
  return path.join(stateDir, CONFIG_FILENAME);
}

export const CONFIG_PATH = resolveConfigPathCandidate();

/**
 * Resolve default config path candidates across default locations.
 * Order: explicit config path → state-dir-derived paths → new default.
 */
export function resolveDefaultConfigCandidates(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = envHomedir(env),
): string[] {
  const effectiveHomedir = () => resolveRequiredHomeDir(env, homedir);
  const explicit = readEnv("ALISIO_CONFIG_PATH", { env, fallback: legacyEnvKey("CONFIG_PATH") });
  if (explicit) {
    return [resolveUserPath(explicit, env, effectiveHomedir)];
  }

  const candidates: string[] = [];
  const stateDirOverride = readEnv("ALISIO_STATE_DIR", {
    env,
    fallback: legacyEnvKey("STATE_DIR"),
  });
  if (stateDirOverride) {
    const resolved = resolveUserPath(stateDirOverride, env, effectiveHomedir);
    candidates.push(path.join(resolved, CONFIG_FILENAME));
    candidates.push(...LEGACY_CONFIG_FILENAMES.map((name) => path.join(resolved, name)));
  }

  const defaultDirs = [newStateDir(effectiveHomedir), ...legacyStateDirs(effectiveHomedir)];
  for (const dir of defaultDirs) {
    candidates.push(path.join(dir, CONFIG_FILENAME));
    candidates.push(...LEGACY_CONFIG_FILENAMES.map((name) => path.join(dir, name)));
  }
  return candidates;
}

export const DEFAULT_GATEWAY_PORT = 40705;

/**
 * Gateway lock directory (ephemeral).
 * Default: `os.tmpdir()/alisio-<uid>` (uid suffix when available).
 */
export function resolveGatewayLockDir(tmpdir: () => string = os.tmpdir): string {
  const base = tmpdir();
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const suffix = uid != null ? `alisio-${uid}` : "alisio";
  return path.join(base, suffix);
}

const OAUTH_FILENAME = "oauth.json";

/**
 * OAuth credentials storage directory.
 *
 * Precedence:
 * - `ALISIO_OAUTH_DIR` (explicit override)
 * - `$*_STATE_DIR/credentials` (canonical server/default)
 */
export function resolveOAuthDir(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, envHomedir(env)),
): string {
  const override = readEnv("ALISIO_OAUTH_DIR", { env, fallback: legacyEnvKey("OAUTH_DIR") });
  if (override) {
    return resolveUserPath(override, env, envHomedir(env));
  }
  return path.join(stateDir, "credentials");
}

export function resolveOAuthPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, envHomedir(env)),
): string {
  return path.join(resolveOAuthDir(env, stateDir), OAUTH_FILENAME);
}

function parseGatewayPortEnvValue(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  // Docker Compose publish strings can leak into host CLI env loading via repo `.env`,
  // for example `127.0.0.1:40705` or `[::1]:40705`. Accept only explicit host:port forms.
  const bracketedIpv6Match = trimmed.match(/^\[[^\]]+\]:(\d+)$/);
  if (bracketedIpv6Match?.[1]) {
    const parsed = Number.parseInt(bracketedIpv6Match[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const firstColon = trimmed.indexOf(":");
  const lastColon = trimmed.lastIndexOf(":");
  if (firstColon <= 0 || firstColon !== lastColon) {
    return null;
  }
  const suffix = trimmed.slice(firstColon + 1);
  if (!/^\d+$/.test(suffix)) {
    return null;
  }
  const parsed = Number.parseInt(suffix, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveGatewayPort(
  cfg?: GatewayPortConfig,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const envRaw = readEnv("ALISIO_GATEWAY_PORT", { env, fallback: legacyEnvKey("GATEWAY_PORT") });
  const envPort = parseGatewayPortEnvValue(envRaw);
  if (envPort !== null) {
    return envPort;
  }
  const configPort = cfg?.gateway?.port;
  if (typeof configPort === "number" && Number.isFinite(configPort)) {
    if (configPort > 0) {
      return configPort;
    }
  }
  return DEFAULT_GATEWAY_PORT;
}
