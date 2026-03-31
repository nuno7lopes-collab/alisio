import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveDesktopWorkerHome } from "./storage.js";

export type DesktopWorkerOpenClawRuntimePaths = {
  storageDir: string;
  stateDir: string;
  agentDir: string;
  configPath: string;
  oauthDir: string;
};

export function resolveDesktopWorkerOpenClawRuntimePaths(
  storageDir?: string,
): DesktopWorkerOpenClawRuntimePaths {
  const desktopHome = resolveDesktopWorkerHome(storageDir);
  const stateDir = path.join(desktopHome, "embedded-openclaw");
  return {
    storageDir: desktopHome,
    stateDir,
    agentDir: path.join(stateDir, "agents", "main", "agent"),
    configPath: path.join(stateDir, "openclaw.json"),
    oauthDir: path.join(stateDir, "credentials"),
  };
}

export async function configureDesktopWorkerOpenClawRuntime(
  storageDir?: string,
): Promise<DesktopWorkerOpenClawRuntimePaths> {
  const paths = resolveDesktopWorkerOpenClawRuntimePaths(storageDir);

  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.agentDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.oauthDir, { recursive: true, mode: 0o700 });

  process.env.OPENCLAW_STATE_DIR = paths.stateDir;
  process.env.OPENCLAW_AGENT_DIR = paths.agentDir;
  process.env.PI_CODING_AGENT_DIR = paths.agentDir;
  process.env.OPENCLAW_CONFIG_PATH = paths.configPath;
  process.env.OPENCLAW_OAUTH_DIR = paths.oauthDir;
  process.env.OPENCLAW_DISABLE_EXTERNAL_CLI_SYNC = "1";

  const { clearRuntimeAuthProfileStoreSnapshots } =
    await import("../../../src/agents/auth-profiles.ts");
  clearRuntimeAuthProfileStoreSnapshots();

  return paths;
}
