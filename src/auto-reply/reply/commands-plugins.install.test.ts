import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "../../config/home-env.test-harness.js";
import { handleCommands } from "./commands-core.js";
import { createCommandWorkspaceHarness } from "./commands-filesystem.test-support.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

const installPluginFromPathMock = vi.fn();
const installPluginFromMarketplaceRegistryMock = vi.fn();
const persistPluginInstallMock = vi.fn();

vi.mock("../../plugins/install.js", async () => {
  const actual = await vi.importActual<typeof import("../../plugins/install.js")>(
    "../../plugins/install.js",
  );
  return {
    ...actual,
    installPluginFromPath: installPluginFromPathMock,
  };
});

vi.mock("../../plugins/marketplace-registry.js", async () => {
  const actual = await vi.importActual<typeof import("../../plugins/marketplace-registry.js")>(
    "../../plugins/marketplace-registry.js",
  );
  return {
    ...actual,
    installPluginFromMarketplaceRegistry: installPluginFromMarketplaceRegistryMock,
  };
});

vi.mock("../../cli/plugins-install-persist.js", () => ({
  persistPluginInstall: persistPluginInstallMock,
}));

const workspaceHarness = createCommandWorkspaceHarness("alisio-command-plugins-install-");

describe("handleCommands /plugins install", () => {
  afterEach(async () => {
    installPluginFromPathMock.mockReset();
    installPluginFromMarketplaceRegistryMock.mockReset();
    persistPluginInstallMock.mockReset();
    await workspaceHarness.cleanupWorkspaces();
  });

  it("installs a plugin from a local path", async () => {
    installPluginFromPathMock.mockResolvedValue({
      ok: true,
      pluginId: "path-install-plugin",
      targetDir: "/tmp/path-install-plugin",
      version: "0.0.1",
      extensions: ["index.js"],
    });
    persistPluginInstallMock.mockResolvedValue({});

    await withTempHome("alisio-command-plugins-home-", async () => {
      const workspaceDir = await workspaceHarness.createWorkspace();
      const pluginDir = path.join(workspaceDir, "fixtures", "path-install-plugin");
      await fs.mkdir(pluginDir, { recursive: true });

      const params = buildCommandTestParams(
        `/plugins install ${pluginDir}`,
        {
          commands: {
            text: true,
            plugins: true,
          },
        },
        undefined,
        { workspaceDir },
      );
      params.command.senderIsOwner = true;

      const result = await handleCommands(params);
      expect(result.reply?.text).toContain('Installed plugin "path-install-plugin"');
      expect(installPluginFromPathMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: pluginDir,
        }),
      );
      expect(persistPluginInstallMock).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: "path-install-plugin",
          install: expect.objectContaining({
            source: "path",
            sourcePath: pluginDir,
            installPath: "/tmp/path-install-plugin",
            version: "0.0.1",
          }),
        }),
      );
    });
  });

  it("installs from an explicit marketplace: spec", async () => {
    installPluginFromMarketplaceRegistryMock.mockResolvedValue({
      ok: true,
      pluginId: "marketplace-demo",
      targetDir: "/tmp/marketplace-demo",
      version: "1.2.3",
      extensions: ["index.js"],
      packageName: "@alisio/marketplace-demo",
      marketplaceRegistry: {
        source: "marketplace",
        marketplaceRegistryUrl: "https://clawhub.ai",
        marketplacePackage: "@alisio/marketplace-demo",
        marketplaceFamily: "code-plugin",
        marketplaceChannel: "official",
        version: "1.2.3",
        integrity: "sha512-demo",
        resolvedAt: "2026-03-22T12:00:00.000Z",
      },
    });
    persistPluginInstallMock.mockResolvedValue({});

    await withTempHome("alisio-command-plugins-home-", async () => {
      const workspaceDir = await workspaceHarness.createWorkspace();
      const params = buildCommandTestParams(
        "/plugins install marketplace:@alisio/marketplace-demo@1.2.3",
        {
          commands: {
            text: true,
            plugins: true,
          },
        },
        undefined,
        { workspaceDir },
      );
      params.command.senderIsOwner = true;

      const result = await handleCommands(params);
      expect(result.reply?.text).toContain('Installed plugin "marketplace-demo"');
      expect(installPluginFromMarketplaceRegistryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          spec: "marketplace:@alisio/marketplace-demo@1.2.3",
        }),
      );
      expect(persistPluginInstallMock).toHaveBeenCalledWith(
        expect.objectContaining({
          pluginId: "marketplace-demo",
          install: expect.objectContaining({
            source: "marketplace",
            spec: "marketplace:@alisio/marketplace-demo@1.2.3",
            installPath: "/tmp/marketplace-demo",
            version: "1.2.3",
            integrity: "sha512-demo",
            marketplacePackage: "@alisio/marketplace-demo",
            marketplaceChannel: "official",
          }),
        }),
      );
    });
  });

  it("treats /plugin add as an install alias", async () => {
    installPluginFromMarketplaceRegistryMock.mockResolvedValue({
      ok: true,
      pluginId: "alias-demo",
      targetDir: "/tmp/alias-demo",
      version: "1.0.0",
      extensions: ["index.js"],
      packageName: "@alisio/alias-demo",
      marketplaceRegistry: {
        source: "marketplace",
        marketplaceRegistryUrl: "https://clawhub.ai",
        marketplacePackage: "@alisio/alias-demo",
        marketplaceFamily: "code-plugin",
        marketplaceChannel: "official",
        version: "1.0.0",
        integrity: "sha512-alias",
        resolvedAt: "2026-03-23T12:00:00.000Z",
      },
    });
    persistPluginInstallMock.mockResolvedValue({});

    await withTempHome("alisio-command-plugins-home-", async () => {
      const workspaceDir = await workspaceHarness.createWorkspace();
      const params = buildCommandTestParams(
        "/plugin add marketplace:@alisio/alias-demo@1.0.0",
        {
          commands: {
            text: true,
            plugins: true,
          },
        },
        undefined,
        { workspaceDir },
      );
      params.command.senderIsOwner = true;

      const result = await handleCommands(params);
      expect(result.reply?.text).toContain('Installed plugin "alias-demo"');
      expect(installPluginFromMarketplaceRegistryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          spec: "marketplace:@alisio/alias-demo@1.0.0",
        }),
      );
    });
  });
});
