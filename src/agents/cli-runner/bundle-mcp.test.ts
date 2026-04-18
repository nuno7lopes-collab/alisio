import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AlisioConfig } from "../../config/config.js";
import { captureEnv } from "../../test-utils/env.js";
import { clearPluginDiscoveryCache } from "../../plugins/discovery.js";
import { clearPluginManifestRegistryCache } from "../../plugins/manifest-registry.js";
import { prepareCliBundleMcpConfig } from "./bundle-mcp.js";

function createBundleMcpTempHarness() {
  const tempDirs: string[] = [];

  return {
    async createTempDir(prefix: string): Promise<string> {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
      tempDirs.push(dir);
      return dir;
    },
    async cleanup() {
      clearPluginDiscoveryCache();
      clearPluginManifestRegistryCache();
      await Promise.all(
        tempDirs
          .splice(0, tempDirs.length)
          .map((dir) => fs.rm(dir, { recursive: true, force: true })),
      );
    },
  };
}

function resolveBundlePluginRoot(homeDir: string, pluginId: string) {
  return path.join(homeDir, ".alisio", "extensions", pluginId);
}

async function writeClaudeBundleManifest(params: {
  homeDir: string;
  pluginId: string;
  manifest: Record<string, unknown>;
}) {
  const pluginRoot = resolveBundlePluginRoot(params.homeDir, params.pluginId);
  await fs.mkdir(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
  await fs.writeFile(
    path.join(pluginRoot, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(params.manifest, null, 2)}\n`,
    "utf-8",
  );
  return pluginRoot;
}

async function createBundleProbePlugin(homeDir: string) {
  const pluginRoot = resolveBundlePluginRoot(homeDir, "bundle-probe");
  const serverPath = path.join(pluginRoot, "servers", "probe.mjs");
  await fs.mkdir(path.dirname(serverPath), { recursive: true });
  await fs.writeFile(serverPath, "export {};\n", "utf-8");
  await writeClaudeBundleManifest({
    homeDir,
    pluginId: "bundle-probe",
    manifest: { name: "bundle-probe" },
  });
  await fs.writeFile(
    path.join(pluginRoot, ".mcp.json"),
    `${JSON.stringify(
      {
        mcpServers: {
          bundleProbe: {
            command: "node",
            args: ["./servers/probe.mjs"],
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  return { pluginRoot, serverPath };
}

const tempHarness = createBundleMcpTempHarness();

afterEach(async () => {
  await tempHarness.cleanup();
});

describe("prepareCliBundleMcpConfig", () => {
  it("injects a strict empty --mcp-config overlay for bundle-MCP-enabled backends without servers", async () => {
    const workspaceDir = await tempHarness.createTempDir("alisio-cli-bundle-mcp-empty-");

    const prepared = await prepareCliBundleMcpConfig({
      enabled: true,
      backend: {
        command: "node",
        args: ["./fake-claude.mjs"],
      },
      workspaceDir,
      config: {},
    });

    const configFlagIndex = prepared.backend.args?.indexOf("--mcp-config") ?? -1;
    expect(configFlagIndex).toBeGreaterThanOrEqual(0);
    expect(prepared.backend.args).toContain("--strict-mcp-config");
    const generatedConfigPath = prepared.backend.args?.[configFlagIndex + 1];
    expect(typeof generatedConfigPath).toBe("string");
    const raw = JSON.parse(await fs.readFile(generatedConfigPath as string, "utf-8")) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(raw.mcpServers).toEqual({});

    await prepared.cleanup?.();
  });

  it("injects a merged --mcp-config overlay for bundle-MCP-enabled backends", async () => {
    const env = captureEnv(["HOME"]);
    try {
      const homeDir = await tempHarness.createTempDir("alisio-cli-bundle-mcp-home-");
      const workspaceDir = await tempHarness.createTempDir("alisio-cli-bundle-mcp-workspace-");
      process.env.HOME = homeDir;

      const { serverPath } = await createBundleProbePlugin(homeDir);

      const config: AlisioConfig = {
        plugins: {
          entries: {
            "bundle-probe": { enabled: true },
          },
        },
      };

      const prepared = await prepareCliBundleMcpConfig({
        enabled: true,
        backend: {
          command: "node",
          args: ["./fake-claude.mjs"],
        },
        workspaceDir,
        config,
      });

      const configFlagIndex = prepared.backend.args?.indexOf("--mcp-config") ?? -1;
      expect(configFlagIndex).toBeGreaterThanOrEqual(0);
      expect(prepared.backend.args).toContain("--strict-mcp-config");
      const generatedConfigPath = prepared.backend.args?.[configFlagIndex + 1];
      expect(typeof generatedConfigPath).toBe("string");
      const raw = JSON.parse(await fs.readFile(generatedConfigPath as string, "utf-8")) as {
        mcpServers?: Record<string, { args?: string[] }>;
      };
      expect(raw.mcpServers?.bundleProbe?.args).toEqual([await fs.realpath(serverPath)]);
      expect(prepared.mcpConfigHash).toMatch(/^[0-9a-f]{64}$/);

      await prepared.cleanup?.();
    } finally {
      env.restore();
    }
  });

  it("leaves args untouched when bundle MCP is disabled", async () => {
    const prepared = await prepareCliBundleMcpConfig({
      enabled: false,
      backend: {
        command: "node",
        args: ["./fake-cli.mjs"],
      },
      workspaceDir: "/tmp/alisio-bundle-mcp-disabled",
    });

    expect(prepared.backend.args).toEqual(["./fake-cli.mjs"]);
    expect(prepared.cleanup).toBeUndefined();
  });
});
