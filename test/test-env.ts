import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import {
  isLiveEnvEnabled,
  isLiveTestEnabled,
  readLiveEnv,
} from "../src/agents/live-test-helpers.js";

type RestoreEntry = { key: string; value: string | undefined };

const LIVE_EXTERNAL_AUTH_DIRS = [".claude", ".codex", ".minimax"] as const;
const CANONICAL_STATE_DIRNAME = ".alisio";
const LEGACY_STATE_DIRNAME = ".alisio";
const CANONICAL_CONFIG_FILENAME = "alisio.json";
const LEGACY_CONFIG_FILENAME = "alisio.json";

function readEnvWithLegacyFallback(
  env: NodeJS.ProcessEnv,
  canonicalKey: string,
  legacyKey: string,
): string | undefined {
  const canonicalValue = env[canonicalKey]?.trim();
  if (canonicalValue) {
    return canonicalValue;
  }
  const legacyValue = env[legacyKey]?.trim();
  return legacyValue || undefined;
}

function resolveDefaultLiveStateDir(homeDir: string): string {
  const canonicalDir = path.join(homeDir, CANONICAL_STATE_DIRNAME);
  if (fs.existsSync(canonicalDir)) {
    return canonicalDir;
  }
  const legacyDir = path.join(homeDir, LEGACY_STATE_DIRNAME);
  if (fs.existsSync(legacyDir)) {
    return legacyDir;
  }
  return canonicalDir;
}

function resolveLiveStateDir(env: NodeJS.ProcessEnv, homeDir: string): string {
  const configuredStateDir = readEnvWithLegacyFallback(env, "ALISIO_STATE_DIR", "ALISIO_STATE_DIR");
  if (configuredStateDir) {
    return resolveHomeRelativePath(configuredStateDir, homeDir);
  }
  return resolveDefaultLiveStateDir(homeDir);
}

function resolveLiveConfigPath(env: NodeJS.ProcessEnv, homeDir: string, stateDir: string): string {
  const configuredConfigPath = readEnvWithLegacyFallback(
    env,
    "ALISIO_CONFIG_PATH",
    "ALISIO_CONFIG_PATH",
  );
  if (configuredConfigPath) {
    return resolveHomeRelativePath(configuredConfigPath, homeDir);
  }
  const canonicalConfigPath = path.join(stateDir, CANONICAL_CONFIG_FILENAME);
  if (fs.existsSync(canonicalConfigPath)) {
    return canonicalConfigPath;
  }
  const legacyConfigPath = path.join(stateDir, LEGACY_CONFIG_FILENAME);
  if (fs.existsSync(legacyConfigPath)) {
    return legacyConfigPath;
  }
  return canonicalConfigPath;
}

function stageLiveConfigSnapshot(sourcePath: string, targetStateDirs: string[]): void {
  if (!fs.existsSync(sourcePath)) {
    return;
  }
  const sanitizedConfig = sanitizeLiveConfig(fs.readFileSync(sourcePath, "utf8"));
  for (const targetStateDir of targetStateDirs) {
    fs.mkdirSync(targetStateDir, { recursive: true });
    fs.writeFileSync(path.join(targetStateDir, CANONICAL_CONFIG_FILENAME), sanitizedConfig, "utf8");
  }
  const legacyStateDir = targetStateDirs[1];
  if (legacyStateDir) {
    fs.writeFileSync(path.join(legacyStateDir, LEGACY_CONFIG_FILENAME), sanitizedConfig, "utf8");
  }
}

function stageLiveStateSubset(sourceStateDir: string, targetStateDirs: string[]): void {
  for (const targetStateDir of targetStateDirs) {
    fs.mkdirSync(targetStateDir, { recursive: true });
    copyDirIfExists(
      path.join(sourceStateDir, "credentials"),
      path.join(targetStateDir, "credentials"),
    );
    copyLiveAuthProfiles(sourceStateDir, targetStateDir);
  }
}

function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  switch (value.trim().toLowerCase()) {
    case "":
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return true;
  }
}

function restoreEnv(entries: RestoreEntry[]): void {
  for (const { key, value } of entries) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function resolveHomeRelativePath(input: string, homeDir: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") {
    return homeDir;
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(homeDir, trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

function loadProfileEnv(homeDir = os.homedir()): void {
  const profilePath = path.join(homeDir, ".profile");
  if (!fs.existsSync(profilePath)) {
    return;
  }
  const quietLiveLogs = isLiveEnvEnabled(
    ["ALISIO_LIVE_TEST_QUIET", "ALISIO_LIVE_TEST_QUIET"],
    process.env,
  );
  const applyEntry = (entry: string) => {
    const idx = entry.indexOf("=");
    if (idx <= 0) {
      return false;
    }
    const key = entry.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || (process.env[key] ?? "") !== "") {
      return false;
    }
    process.env[key] = entry.slice(idx + 1);
    return true;
  };
  const countAppliedEntries = (entries: Iterable<string>) => {
    let applied = 0;
    for (const entry of entries) {
      if (applyEntry(entry)) {
        applied += 1;
      }
    }
    return applied;
  };
  try {
    const output = execFileSync(
      "/bin/bash",
      ["-lc", `set -a; source "${profilePath}" >/dev/null 2>&1; env -0`],
      { encoding: "utf8" },
    );
    const applied = countAppliedEntries(output.split("\0").filter(Boolean));
    if (applied > 0 && !quietLiveLogs) {
      console.log(`[live] loaded ${applied} env vars from ~/.profile`);
    }
  } catch {
    try {
      const fallbackEntries = fs
        .readFileSync(profilePath, "utf8")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.replace(/^export\s+/u, ""))
        .map((line) => {
          const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
          if (!match) {
            return "";
          }
          let value = match[2].trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          return `${match[1]}=${value}`;
        })
        .filter(Boolean);
      const applied = countAppliedEntries(fallbackEntries);
      if (applied > 0 && !quietLiveLogs) {
        console.log(`[live] loaded ${applied} env vars from ~/.profile`);
      }
    } catch {
      // ignore profile load failures
    }
  }
}

function resolveRestoreEntries(): RestoreEntry[] {
  return [
    { key: "ALISIO_TEST_FAST", value: process.env.ALISIO_TEST_FAST },
    { key: "ALISIO_TEST_FAST", value: process.env.ALISIO_TEST_FAST },
    { key: "HOME", value: process.env.HOME },
    { key: "USERPROFILE", value: process.env.USERPROFILE },
    { key: "XDG_CONFIG_HOME", value: process.env.XDG_CONFIG_HOME },
    { key: "XDG_DATA_HOME", value: process.env.XDG_DATA_HOME },
    { key: "XDG_STATE_HOME", value: process.env.XDG_STATE_HOME },
    { key: "XDG_CACHE_HOME", value: process.env.XDG_CACHE_HOME },
    { key: "ALISIO_STATE_DIR", value: process.env.ALISIO_STATE_DIR },
    { key: "ALISIO_CONFIG_PATH", value: process.env.ALISIO_CONFIG_PATH },
    { key: "ALISIO_GATEWAY_PORT", value: process.env.ALISIO_GATEWAY_PORT },
    { key: "ALISIO_BRIDGE_ENABLED", value: process.env.ALISIO_BRIDGE_ENABLED },
    { key: "ALISIO_BRIDGE_HOST", value: process.env.ALISIO_BRIDGE_HOST },
    { key: "ALISIO_BRIDGE_PORT", value: process.env.ALISIO_BRIDGE_PORT },
    { key: "ALISIO_CANVAS_HOST_PORT", value: process.env.ALISIO_CANVAS_HOST_PORT },
    { key: "ALISIO_TEST_HOME", value: process.env.ALISIO_TEST_HOME },
    { key: "ALISIO_AGENT_DIR", value: process.env.ALISIO_AGENT_DIR },
    { key: "ALISIO_STATE_DIR", value: process.env.ALISIO_STATE_DIR },
    { key: "ALISIO_CONFIG_PATH", value: process.env.ALISIO_CONFIG_PATH },
    { key: "ALISIO_GATEWAY_PORT", value: process.env.ALISIO_GATEWAY_PORT },
    { key: "ALISIO_BRIDGE_ENABLED", value: process.env.ALISIO_BRIDGE_ENABLED },
    { key: "ALISIO_BRIDGE_HOST", value: process.env.ALISIO_BRIDGE_HOST },
    { key: "ALISIO_BRIDGE_PORT", value: process.env.ALISIO_BRIDGE_PORT },
    { key: "ALISIO_CANVAS_HOST_PORT", value: process.env.ALISIO_CANVAS_HOST_PORT },
    { key: "ALISIO_TEST_HOME", value: process.env.ALISIO_TEST_HOME },
    { key: "ALISIO_AGENT_DIR", value: process.env.ALISIO_AGENT_DIR },
    { key: "PI_CODING_AGENT_DIR", value: process.env.PI_CODING_AGENT_DIR },
    { key: "TELEGRAM_BOT_TOKEN", value: process.env.TELEGRAM_BOT_TOKEN },
    { key: "DISCORD_BOT_TOKEN", value: process.env.DISCORD_BOT_TOKEN },
    { key: "SLACK_BOT_TOKEN", value: process.env.SLACK_BOT_TOKEN },
    { key: "SLACK_APP_TOKEN", value: process.env.SLACK_APP_TOKEN },
    { key: "SLACK_USER_TOKEN", value: process.env.SLACK_USER_TOKEN },
    { key: "COPILOT_GITHUB_TOKEN", value: process.env.COPILOT_GITHUB_TOKEN },
    { key: "GH_TOKEN", value: process.env.GH_TOKEN },
    { key: "GITHUB_TOKEN", value: process.env.GITHUB_TOKEN },
    { key: "NODE_OPTIONS", value: process.env.NODE_OPTIONS },
  ];
}

function createIsolatedTestHome(restore: RestoreEntry[]): {
  cleanup: () => void;
  tempHome: string;
} {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "alisio-test-home-"));

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.ALISIO_TEST_HOME = tempHome;
  process.env.ALISIO_TEST_HOME = tempHome;
  process.env.ALISIO_TEST_FAST = "1";
  process.env.ALISIO_TEST_FAST = "1";

  // Ensure test runs never touch the developer's real config/state, even if they have overrides set.
  delete process.env.ALISIO_CONFIG_PATH;
  delete process.env.ALISIO_CONFIG_PATH;
  // Prefer deriving state dir from HOME so nested tests that change HOME also isolate correctly.
  delete process.env.ALISIO_STATE_DIR;
  delete process.env.ALISIO_STATE_DIR;
  delete process.env.ALISIO_AGENT_DIR;
  delete process.env.ALISIO_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  // Prefer test-controlled ports over developer overrides (avoid port collisions across tests/workers).
  delete process.env.ALISIO_GATEWAY_PORT;
  delete process.env.ALISIO_BRIDGE_ENABLED;
  delete process.env.ALISIO_BRIDGE_HOST;
  delete process.env.ALISIO_BRIDGE_PORT;
  delete process.env.ALISIO_CANVAS_HOST_PORT;
  delete process.env.ALISIO_GATEWAY_PORT;
  delete process.env.ALISIO_BRIDGE_ENABLED;
  delete process.env.ALISIO_BRIDGE_HOST;
  delete process.env.ALISIO_BRIDGE_PORT;
  delete process.env.ALISIO_CANVAS_HOST_PORT;
  // Avoid leaking real GitHub/Copilot tokens into non-live test runs.
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_APP_TOKEN;
  delete process.env.SLACK_USER_TOKEN;
  delete process.env.COPILOT_GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  // Avoid leaking local dev tooling flags into tests (e.g. --inspect).
  delete process.env.NODE_OPTIONS;

  // Windows: prefer the default state dir so auth/profile tests match real paths.
  if (process.platform === "win32") {
    const tempStateDir = path.join(tempHome, CANONICAL_STATE_DIRNAME);
    process.env.ALISIO_STATE_DIR = tempStateDir;
    process.env.ALISIO_STATE_DIR = tempStateDir;
  }

  process.env.XDG_CONFIG_HOME = path.join(tempHome, ".config");
  process.env.XDG_DATA_HOME = path.join(tempHome, ".local", "share");
  process.env.XDG_STATE_HOME = path.join(tempHome, ".local", "state");
  process.env.XDG_CACHE_HOME = path.join(tempHome, ".cache");

  const cleanup = () => {
    restoreEnv(restore);
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  return { cleanup, tempHome };
}

function ensureParentDir(targetPath: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function copyDirIfExists(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath)) {
    return;
  }
  fs.mkdirSync(targetPath, { recursive: true });
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
  });
}

function copyFileIfExists(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath)) {
    return;
  }
  ensureParentDir(targetPath);
  fs.copyFileSync(sourcePath, targetPath);
}

function sanitizeLiveConfig(raw: string): string {
  try {
    const parsed: {
      agents?: {
        defaults?: Record<string, unknown>;
        list?: Array<Record<string, unknown>>;
      };
    } = JSON5.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return raw;
    }
    if (parsed.agents?.defaults && typeof parsed.agents.defaults === "object") {
      delete parsed.agents.defaults.workspace;
      delete parsed.agents.defaults.agentDir;
    }
    if (Array.isArray(parsed.agents?.list)) {
      parsed.agents.list = parsed.agents.list.map((entry) => {
        if (!entry || typeof entry !== "object") {
          return entry;
        }
        const nextEntry = { ...entry };
        delete nextEntry.workspace;
        delete nextEntry.agentDir;
        return nextEntry;
      });
    }
    return `${JSON.stringify(parsed, null, 2)}\n`;
  } catch {
    return raw;
  }
}

function copyLiveAuthProfiles(realStateDir: string, tempStateDir: string): void {
  const agentsDir = path.join(realStateDir, "agents");
  if (!fs.existsSync(agentsDir)) {
    return;
  }
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourcePath = path.join(agentsDir, entry.name, "agent", "auth-profiles.json");
    const targetPath = path.join(tempStateDir, "agents", entry.name, "agent", "auth-profiles.json");
    copyFileIfExists(sourcePath, targetPath);
  }
}

function stageLiveTestState(params: {
  env: NodeJS.ProcessEnv;
  realHome: string;
  tempHome: string;
}): void {
  let realStateDir = resolveLiveStateDir(params.env, params.realHome);
  const priorIsolatedHome = readEnvWithLegacyFallback(
    params.env,
    "ALISIO_TEST_HOME",
    "ALISIO_TEST_HOME",
  );
  const snapshotHome = params.env.HOME?.trim();
  if (
    priorIsolatedHome &&
    snapshotHome &&
    snapshotHome !== priorIsolatedHome &&
    [CANONICAL_STATE_DIRNAME, LEGACY_STATE_DIRNAME]
      .map((dirName) => path.join(priorIsolatedHome, dirName))
      .includes(realStateDir)
  ) {
    realStateDir = resolveDefaultLiveStateDir(params.realHome);
  }
  const tempStateDirs = [
    path.join(params.tempHome, CANONICAL_STATE_DIRNAME),
    path.join(params.tempHome, LEGACY_STATE_DIRNAME),
  ];
  const realConfigPath = resolveLiveConfigPath(params.env, params.realHome, realStateDir);
  stageLiveConfigSnapshot(realConfigPath, tempStateDirs);
  stageLiveStateSubset(realStateDir, tempStateDirs);

  for (const authDir of LIVE_EXTERNAL_AUTH_DIRS) {
    copyDirIfExists(path.join(params.realHome, authDir), path.join(params.tempHome, authDir));
  }
}

export function installTestEnv(): { cleanup: () => void; tempHome: string } {
  const live = isLiveTestEnabled(["ALISIO_LIVE_GATEWAY", "ALISIO_LIVE_GATEWAY"], process.env);
  const allowRealHome = isTruthyEnvValue(
    readLiveEnv(["ALISIO_LIVE_USE_REAL_HOME", "ALISIO_LIVE_USE_REAL_HOME"], process.env),
  );
  const realHome = process.env.HOME ?? os.homedir();
  const liveEnvSnapshot = { ...process.env };

  loadProfileEnv(realHome);

  if (live && allowRealHome) {
    return { cleanup: () => {}, tempHome: realHome };
  }

  const restore = resolveRestoreEntries();
  const testEnv = createIsolatedTestHome(restore);

  if (live) {
    stageLiveTestState({ env: liveEnvSnapshot, realHome, tempHome: testEnv.tempHome });
  }

  return testEnv;
}

export function withIsolatedTestHome(): { cleanup: () => void; tempHome: string } {
  return installTestEnv();
}
