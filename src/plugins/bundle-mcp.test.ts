import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AlisioConfig } from "../config/config.js";
import { captureEnv } from "../test-utils/env.js";
import { isRecord } from "../utils.js";
import { loadEnabledBundleMcpConfig } from "./bundle-mcp.js";
import { clearPluginDiscoveryCache } from "./discovery.js";
import { clearPluginManifestRegistryCache } from "./manifest-registry.js";

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

function createEnabledPluginEntries(pluginIds: readonly string[]) {
  return Object.fromEntries(pluginIds.map((pluginId) => [pluginId, { enabled: true }]));
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

async function withBundleHomeEnv<T>(
  tempHarness: { createTempDir: (prefix: string) => Promise<string> },
  prefix: string,
  run: (params: { homeDir: string; workspaceDir: string }) => Promise<T>,
): Promise<T> {
  const env = captureEnv(["HOME", "USERPROFILE", "ALISIO_HOME", "ALISIO_STATE_DIR"]);
  try {
    const homeDir = await tempHarness.createTempDir(`${prefix}-home-`);
    const workspaceDir = await tempHarness.createTempDir(`${prefix}-workspace-`);
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    delete process.env.ALISIO_HOME;
    delete process.env.ALISIO_STATE_DIR;
    return await run({ homeDir, workspaceDir });
  } finally {
    env.restore();
  }
}

function getServerArgs(value: unknown): unknown[] | undefined {
  return isRecord(value) && Array.isArray(value.args) ? value.args : undefined;
}

function normalizePathForAssertion(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  return path.normalize(value).replace(/\\/g, "/");
}

async function expectResolvedPathEqual(actual: unknown, expected: string): Promise<void> {
  expect(typeof actual).toBe("string");
  if (typeof actual !== "string") {
    return;
  }
  expect(normalizePathForAssertion(await fs.realpath(actual))).toBe(
    normalizePathForAssertion(await fs.realpath(expected)),
  );
}

function expectNoDiagnostics(diagnostics: unknown[]) {
  expect(diagnostics).toEqual([]);
}

const tempHarness = createBundleMcpTempHarness();

afterEach(async () => {
  await tempHarness.cleanup();
});

function createEnabledBundleConfig(pluginIds: string[]): AlisioConfig {
  return {
    plugins: {
      entries: createEnabledPluginEntries(pluginIds),
    },
  };
}

async function expectInlineBundleMcpServer(params: {
  loadedServer: unknown;
  pluginRoot: string;
  commandRelativePath: string;
  argRelativePaths: readonly string[];
}) {
  const loadedArgs = getServerArgs(params.loadedServer);
  const loadedCommand = isRecord(params.loadedServer) ? params.loadedServer.command : undefined;
  const loadedCwd = isRecord(params.loadedServer) ? params.loadedServer.cwd : undefined;
  const loadedEnv =
    isRecord(params.loadedServer) && isRecord(params.loadedServer.env)
      ? params.loadedServer.env
      : {};

  await expectResolvedPathEqual(loadedCwd, params.pluginRoot);
  expect(typeof loadedCommand).toBe("string");
  expect(loadedArgs).toHaveLength(params.argRelativePaths.length);
  expect(typeof loadedEnv.PLUGIN_ROOT).toBe("string");
  if (typeof loadedCommand !== "string" || typeof loadedCwd !== "string") {
    throw new Error("expected inline bundled MCP server to expose command and cwd");
  }
  expect(normalizePathForAssertion(path.relative(loadedCwd, loadedCommand))).toBe(
    normalizePathForAssertion(params.commandRelativePath),
  );
  expect(
    loadedArgs?.map((entry) =>
      typeof entry === "string"
        ? normalizePathForAssertion(path.relative(loadedCwd, entry))
        : entry,
    ),
  ).toEqual([...params.argRelativePaths]);
  await expectResolvedPathEqual(loadedEnv.PLUGIN_ROOT, params.pluginRoot);
}

describe("loadEnabledBundleMcpConfig", () => {
  it("loads enabled Claude bundle MCP config and absolutizes relative args", async () => {
    await withBundleHomeEnv(tempHarness, "alisio-bundle-mcp", async ({ homeDir, workspaceDir }) => {
      const { pluginRoot, serverPath } = await createBundleProbePlugin(homeDir);

      const config: AlisioConfig = {
        plugins: {
          entries: {
            "bundle-probe": { enabled: true },
          },
        },
      };

      const loaded = loadEnabledBundleMcpConfig({
        workspaceDir,
        cfg: config,
      });
      const resolvedServerPath = await fs.realpath(serverPath);
      const loadedServer = loaded.config.mcpServers.bundleProbe;
      const loadedArgs = getServerArgs(loadedServer);
      const loadedServerPath = typeof loadedArgs?.[0] === "string" ? loadedArgs[0] : undefined;
      const resolvedPluginRoot = await fs.realpath(pluginRoot);

      expectNoDiagnostics(loaded.diagnostics);
      expect(isRecord(loadedServer) ? loadedServer.command : undefined).toBe("node");
      expect(loadedArgs).toHaveLength(1);
      expect(loadedServerPath).toBeDefined();
      if (!loadedServerPath) {
        throw new Error("expected bundled MCP args to include the server path");
      }
      expect(normalizePathForAssertion(await fs.realpath(loadedServerPath))).toBe(
        normalizePathForAssertion(resolvedServerPath),
      );
      await expectResolvedPathEqual(loadedServer.cwd, resolvedPluginRoot);
    });
  });

  it("merges inline bundle MCP servers and skips disabled bundles", async () => {
    await withBundleHomeEnv(
      tempHarness,
      "alisio-bundle-inline",
      async ({ homeDir, workspaceDir }) => {
        await writeClaudeBundleManifest({
          homeDir,
          pluginId: "inline-enabled",
          manifest: {
            name: "inline-enabled",
            mcpServers: {
              enabledProbe: {
                command: "node",
                args: ["./enabled.mjs"],
              },
            },
          },
        });
        await writeClaudeBundleManifest({
          homeDir,
          pluginId: "inline-disabled",
          manifest: {
            name: "inline-disabled",
            mcpServers: {
              disabledProbe: {
                command: "node",
                args: ["./disabled.mjs"],
              },
            },
          },
        });

        const loaded = loadEnabledBundleMcpConfig({
          workspaceDir,
          cfg: {
            plugins: {
              entries: {
                ...createEnabledPluginEntries(["inline-enabled"]),
                "inline-disabled": { enabled: false },
              },
            },
          },
        });

        expect(loaded.config.mcpServers.enabledProbe).toBeDefined();
        expect(loaded.config.mcpServers.disabledProbe).toBeUndefined();
      },
    );
  });

  it("resolves inline Claude MCP paths from the plugin root and expands CLAUDE_PLUGIN_ROOT", async () => {
    await withBundleHomeEnv(
      tempHarness,
      "alisio-bundle-inline-placeholder",
      async ({ homeDir, workspaceDir }) => {
        const pluginRoot = await writeClaudeBundleManifest({
          homeDir,
          pluginId: "inline-claude",
          manifest: {
            name: "inline-claude",
            mcpServers: {
              inlineProbe: {
                command: "${CLAUDE_PLUGIN_ROOT}/bin/server.sh",
                args: ["${CLAUDE_PLUGIN_ROOT}/servers/probe.mjs", "./local-probe.mjs"],
                cwd: "${CLAUDE_PLUGIN_ROOT}",
                env: {
                  PLUGIN_ROOT: "${CLAUDE_PLUGIN_ROOT}",
                },
              },
            },
          },
        });

        const loaded = loadEnabledBundleMcpConfig({
          workspaceDir,
          cfg: createEnabledBundleConfig(["inline-claude"]),
        });
        const loadedServer = loaded.config.mcpServers.inlineProbe;

        expectNoDiagnostics(loaded.diagnostics);
        await expectInlineBundleMcpServer({
          loadedServer,
          pluginRoot,
          commandRelativePath: path.join("bin", "server.sh"),
          argRelativePaths: [
            normalizePathForAssertion(path.join("servers", "probe.mjs"))!,
            normalizePathForAssertion("local-probe.mjs")!,
          ],
        });
      },
    );
  });
});
