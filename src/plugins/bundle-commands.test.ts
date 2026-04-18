import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureEnv } from "../test-utils/env.js";
import { loadEnabledClaudeBundleCommands } from "./bundle-commands.js";
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

async function writeBundleTextFiles(
  rootDir: string,
  files: Readonly<Record<string, string>>,
) {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const filePath = path.join(rootDir, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents, "utf-8");
    }),
  );
}

function createEnabledPluginEntries(pluginIds: readonly string[]) {
  return Object.fromEntries(pluginIds.map((pluginId) => [pluginId, { enabled: true }]));
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

const tempHarness = createBundleMcpTempHarness();

afterEach(async () => {
  await tempHarness.cleanup();
});

async function writeClaudeBundleCommandFixture(params: {
  homeDir: string;
  pluginId: string;
  commands: Array<{ relativePath: string; contents: string[] }>;
}) {
  const pluginRoot = await writeClaudeBundleManifest({
    homeDir: params.homeDir,
    pluginId: params.pluginId,
    manifest: { name: params.pluginId },
  });
  await writeBundleTextFiles(
    pluginRoot,
    Object.fromEntries(
      params.commands.map((command) => [
        command.relativePath,
        [...command.contents, ""].join("\n"),
      ]),
    ),
  );
}

function expectEnabledClaudeBundleCommands(
  commands: ReturnType<typeof loadEnabledClaudeBundleCommands>,
  expected: Array<{
    pluginId: string;
    rawName: string;
    description: string;
    promptTemplate: string;
  }>,
) {
  expect(commands).toEqual(
    expect.arrayContaining(expected.map((entry) => expect.objectContaining(entry))),
  );
}

describe("loadEnabledClaudeBundleCommands", () => {
  it("loads enabled Claude bundle markdown commands and skips disabled-model-invocation entries", async () => {
    await withBundleHomeEnv(
      tempHarness,
      "alisio-bundle-commands",
      async ({ homeDir, workspaceDir }) => {
        await writeClaudeBundleCommandFixture({
          homeDir,
          pluginId: "compound-bundle",
          commands: [
            {
              relativePath: "commands/office-hours.md",
              contents: [
                "---",
                "description: Help with scoping and architecture",
                "---",
                "Give direct engineering advice.",
              ],
            },
            {
              relativePath: "commands/workflows/review.md",
              contents: [
                "---",
                "name: workflows:review",
                "description: Run a structured review",
                "---",
                "Review the code. $ARGUMENTS",
              ],
            },
            {
              relativePath: "commands/disabled.md",
              contents: ["---", "disable-model-invocation: true", "---", "Do not load me."],
            },
          ],
        });

        const commands = loadEnabledClaudeBundleCommands({
          workspaceDir,
          cfg: {
            plugins: {
              entries: createEnabledPluginEntries(["compound-bundle"]),
            },
          },
        });

        expectEnabledClaudeBundleCommands(commands, [
          {
            pluginId: "compound-bundle",
            rawName: "office-hours",
            description: "Help with scoping and architecture",
            promptTemplate: "Give direct engineering advice.",
          },
          {
            pluginId: "compound-bundle",
            rawName: "workflows:review",
            description: "Run a structured review",
            promptTemplate: "Review the code. $ARGUMENTS",
          },
        ]);
        expect(commands.some((entry) => entry.rawName === "disabled")).toBe(false);
      },
    );
  });
});
