import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  loadAuthProfileStoreForRuntime,
  saveAuthProfileStore,
} from "../../../src/agents/auth-profiles.ts";
import {
  configureDesktopWorkerOpenClawRuntime,
  resolveDesktopWorkerOpenClawRuntimePaths,
} from "./openclaw-runtime-isolation.js";

const createdDirs: string[] = [];

const envKeys = [
  "OPENCLAW_STATE_DIR",
  "OPENCLAW_AGENT_DIR",
  "PI_CODING_AGENT_DIR",
  "OPENCLAW_CONFIG_PATH",
  "OPENCLAW_OAUTH_DIR",
  "OPENCLAW_DISABLE_EXTERNAL_CLI_SYNC",
] as const;

const envSnapshot = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<
  (typeof envKeys)[number],
  string | undefined
>;

afterEach(async () => {
  clearRuntimeAuthProfileStoreSnapshots();
  for (const key of envKeys) {
    const value = envSnapshot[key];
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
  await Promise.all(
    createdDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createTempDir() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "desktop-worker-runtime-"));
  createdDirs.push(directory);
  return directory;
}

describe("configureDesktopWorkerOpenClawRuntime", () => {
  it("isola o runtime embutido do auth store global do OpenClaw", async () => {
    const tempRoot = await createTempDir();
    const globalStateDir = path.join(tempRoot, "global-openclaw");
    const globalAgentDir = path.join(globalStateDir, "agents", "main", "agent");
    const globalOauthDir = path.join(globalStateDir, "credentials");
    await mkdir(globalAgentDir, { recursive: true });
    await mkdir(globalOauthDir, { recursive: true });

    process.env.OPENCLAW_STATE_DIR = globalStateDir;
    process.env.OPENCLAW_AGENT_DIR = globalAgentDir;
    process.env.PI_CODING_AGENT_DIR = globalAgentDir;
    process.env.OPENCLAW_CONFIG_PATH = path.join(globalStateDir, "openclaw.json");
    process.env.OPENCLAW_OAUTH_DIR = globalOauthDir;
    clearRuntimeAuthProfileStoreSnapshots();

    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          "openai-codex:default": {
            type: "oauth",
            provider: "openai-codex",
            access: "global-access-token",
            refresh: "global-refresh-token",
            expires: Date.now() + 60_000,
          },
        },
      },
      globalAgentDir,
    );

    expect(loadAuthProfileStoreForRuntime().profiles["openai-codex:default"]).toBeDefined();

    const storageDir = path.join(tempRoot, "lume");
    const isolated = await configureDesktopWorkerOpenClawRuntime(storageDir);
    const isolatedStore = loadAuthProfileStoreForRuntime();

    expect(isolatedStore.profiles["openai-codex:default"]).toBeUndefined();
    expect(process.env.OPENCLAW_STATE_DIR).toBe(isolated.stateDir);
    expect(process.env.OPENCLAW_AGENT_DIR).toBe(isolated.agentDir);
    expect(process.env.PI_CODING_AGENT_DIR).toBe(isolated.agentDir);
    expect(process.env.OPENCLAW_CONFIG_PATH).toBe(isolated.configPath);
    expect(process.env.OPENCLAW_OAUTH_DIR).toBe(isolated.oauthDir);
    expect(process.env.OPENCLAW_DISABLE_EXTERNAL_CLI_SYNC).toBe("1");
  });

  it("resolve caminhos do runtime embutido a partir da pasta da app", () => {
    const paths = resolveDesktopWorkerOpenClawRuntimePaths("/tmp/lume-user");

    expect(paths).toEqual({
      storageDir: "/tmp/lume-user",
      stateDir: "/tmp/lume-user/embedded-openclaw",
      agentDir: "/tmp/lume-user/embedded-openclaw/agents/main/agent",
      configPath: "/tmp/lume-user/embedded-openclaw/openclaw.json",
      oauthDir: "/tmp/lume-user/embedded-openclaw/credentials",
    });
  });
});
