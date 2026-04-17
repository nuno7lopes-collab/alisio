import { beforeEach, describe, expect, it } from "vitest";
import { installedPluginRoot } from "../../test/helpers/bundled-plugin-paths.js";
import type { AlisioConfig } from "../config/config.js";
import {
  applyExclusiveSlotSelection,
  buildPluginStatusReport,
  clearPluginManifestRegistryCache,
  enablePluginInConfig,
  installHooksFromNpmSpec,
  installPluginFromMarketplaceRegistry,
  installPluginFromMarketplace,
  installPluginFromNpmSpec,
  loadConfig,
  readConfigFileSnapshot,
  parseMarketplaceRegistryPluginSpec,
  recordHookInstall,
  recordPluginInstall,
  resetPluginsCliTestState,
  runPluginsCommand,
  runtimeErrors,
  runtimeLogs,
  writeConfigFile,
} from "./plugins-cli-test-helpers.js";

const CLI_STATE_ROOT = "/tmp/alisio-state";

function cliInstallPath(pluginId: string): string {
  return installedPluginRoot(CLI_STATE_ROOT, pluginId);
}

function createEnabledPluginConfig(pluginId: string): AlisioConfig {
  return {
    plugins: {
      entries: {
        [pluginId]: {
          enabled: true,
        },
      },
    },
  } as AlisioConfig;
}

function createMarketplaceRegistryInstalledConfig(params: {
  pluginId: string;
  install: Record<string, unknown>;
}): AlisioConfig {
  const enabledCfg = createEnabledPluginConfig(params.pluginId);
  return {
    ...enabledCfg,
    plugins: {
      ...enabledCfg.plugins,
      installs: {
        [params.pluginId]: params.install,
      },
    },
  } as AlisioConfig;
}

function createMarketplaceRegistryInstallResult(params: {
  pluginId: string;
  packageName: string;
  version: string;
  channel: string;
}): Awaited<ReturnType<typeof installPluginFromMarketplaceRegistry>> {
  return {
    ok: true,
    pluginId: params.pluginId,
    targetDir: cliInstallPath(params.pluginId),
    version: params.version,
    packageName: params.packageName,
    marketplaceRegistry: {
      source: "marketplace",
      marketplaceRegistryUrl: "https://clawhub.ai",
      marketplacePackage: params.packageName,
      marketplaceFamily: "code-plugin",
      marketplaceChannel: params.channel,
      version: params.version,
      integrity: "sha256-abc",
      resolvedAt: "2026-03-22T00:00:00.000Z",
    },
  };
}

describe("plugins cli install", () => {
  beforeEach(() => {
    resetPluginsCliTestState();
  });

  it("exits when --marketplace is combined with --link", async () => {
    await expect(
      runPluginsCommand(["plugins", "install", "alpha", "--marketplace", "local/repo", "--link"]),
    ).rejects.toThrow("__exit__:1");

    expect(runtimeErrors.at(-1)).toContain("`--link` is not supported with `--marketplace`.");
    expect(installPluginFromMarketplace).not.toHaveBeenCalled();
  });

  it("exits when marketplace install fails", async () => {
    await expect(
      runPluginsCommand(["plugins", "install", "alpha", "--marketplace", "local/repo"]),
    ).rejects.toThrow("__exit__:1");

    expect(installPluginFromMarketplace).toHaveBeenCalledWith(
      expect.objectContaining({
        marketplace: "local/repo",
        plugin: "alpha",
      }),
    );
    expect(writeConfigFile).not.toHaveBeenCalled();
  });

  it("fails closed for unrelated invalid config before installer side effects", async () => {
    const invalidConfigErr = new Error("config invalid");
    (invalidConfigErr as { code?: string }).code = "INVALID_CONFIG";
    loadConfig.mockImplementation(() => {
      throw invalidConfigErr;
    });
    readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/alisio-config.json5",
      exists: true,
      raw: '{ "models": { "default": 123 } }',
      parsed: { models: { default: 123 } },
      resolved: { models: { default: 123 } },
      valid: false,
      config: { models: { default: 123 } },
      hash: "mock",
      issues: [{ path: "models.default", message: "invalid model ref" }],
      warnings: [],
      legacyIssues: [],
    });

    await expect(runPluginsCommand(["plugins", "install", "alpha"])).rejects.toThrow("__exit__:1");

    expect(runtimeErrors.at(-1)).toContain(
      "Config invalid; run `alisio doctor --fix` before installing plugins.",
    );
    expect(installPluginFromMarketplace).not.toHaveBeenCalled();
    expect(installPluginFromNpmSpec).not.toHaveBeenCalled();
    expect(writeConfigFile).not.toHaveBeenCalled();
  });

  it("installs marketplace plugins and persists config", async () => {
    const cfg = {
      plugins: {
        entries: {},
      },
    } as AlisioConfig;
    const enabledCfg = {
      plugins: {
        entries: {
          alpha: {
            enabled: true,
          },
        },
      },
    } as AlisioConfig;
    const installedCfg = {
      ...enabledCfg,
      plugins: {
        ...enabledCfg.plugins,
        installs: {
          alpha: {
            source: "marketplace",
            installPath: cliInstallPath("alpha"),
          },
        },
      },
    } as AlisioConfig;

    loadConfig.mockReturnValue(cfg);
    installPluginFromMarketplace.mockResolvedValue({
      ok: true,
      pluginId: "alpha",
      targetDir: cliInstallPath("alpha"),
      version: "1.2.3",
      marketplaceName: "Claude",
      marketplaceSource: "local/repo",
      marketplacePlugin: "alpha",
    });
    enablePluginInConfig.mockReturnValue({ config: enabledCfg });
    recordPluginInstall.mockReturnValue(installedCfg);
    buildPluginStatusReport.mockReturnValue({
      plugins: [{ id: "alpha", kind: "provider" }],
      diagnostics: [],
    });
    applyExclusiveSlotSelection.mockReturnValue({
      config: installedCfg,
      warnings: ["slot adjusted"],
    });

    await runPluginsCommand(["plugins", "install", "alpha", "--marketplace", "local/repo"]);

    expect(clearPluginManifestRegistryCache).toHaveBeenCalledTimes(1);
    expect(writeConfigFile).toHaveBeenCalledWith(installedCfg);
    expect(runtimeLogs.some((line) => line.includes("slot adjusted"))).toBe(true);
    expect(runtimeLogs.some((line) => line.includes("Installed plugin: alpha"))).toBe(true);
  });

  it("installs marketplace registry plugins and persists source metadata", async () => {
    const cfg = {
      plugins: {
        entries: {},
      },
    } as AlisioConfig;
    const enabledCfg = createEnabledPluginConfig("demo");
    const installedCfg = createMarketplaceRegistryInstalledConfig({
      pluginId: "demo",
      install: {
        source: "marketplace",
        spec: "marketplace:demo@1.2.3",
        installPath: cliInstallPath("demo"),
        marketplacePackage: "demo",
        marketplaceFamily: "code-plugin",
        marketplaceChannel: "official",
      },
    });

    loadConfig.mockReturnValue(cfg);
    parseMarketplaceRegistryPluginSpec.mockReturnValue({ name: "demo" });
    installPluginFromMarketplaceRegistry.mockResolvedValue(
      createMarketplaceRegistryInstallResult({
        pluginId: "demo",
        packageName: "demo",
        version: "1.2.3",
        channel: "official",
      }),
    );
    enablePluginInConfig.mockReturnValue({ config: enabledCfg });
    recordPluginInstall.mockReturnValue(installedCfg);
    applyExclusiveSlotSelection.mockReturnValue({
      config: installedCfg,
      warnings: [],
    });

    await runPluginsCommand(["plugins", "install", "marketplace:demo"]);

    expect(installPluginFromMarketplaceRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: "marketplace:demo",
      }),
    );
    expect(recordPluginInstall).toHaveBeenCalledWith(
      enabledCfg,
      expect.objectContaining({
        pluginId: "demo",
        source: "marketplace",
        spec: "marketplace:demo@1.2.3",
        marketplacePackage: "demo",
        marketplaceFamily: "code-plugin",
        marketplaceChannel: "official",
      }),
    );
    expect(writeConfigFile).toHaveBeenCalledWith(installedCfg);
    expect(runtimeLogs.some((line) => line.includes("Installed plugin: demo"))).toBe(true);
    expect(installPluginFromNpmSpec).not.toHaveBeenCalled();
  });

  it("prefers the marketplace registry before npm for bare plugin specs", async () => {
    const cfg = {
      plugins: {
        entries: {},
      },
    } as AlisioConfig;
    const enabledCfg = createEnabledPluginConfig("demo");
    const installedCfg = createMarketplaceRegistryInstalledConfig({
      pluginId: "demo",
      install: {
        source: "marketplace",
        spec: "marketplace:demo@1.2.3",
        installPath: cliInstallPath("demo"),
        marketplacePackage: "demo",
      },
    });

    loadConfig.mockReturnValue(cfg);
    installPluginFromMarketplaceRegistry.mockResolvedValue(
      createMarketplaceRegistryInstallResult({
        pluginId: "demo",
        packageName: "demo",
        version: "1.2.3",
        channel: "community",
      }),
    );
    enablePluginInConfig.mockReturnValue({ config: enabledCfg });
    recordPluginInstall.mockReturnValue(installedCfg);
    applyExclusiveSlotSelection.mockReturnValue({
      config: installedCfg,
      warnings: [],
    });

    await runPluginsCommand(["plugins", "install", "demo"]);

    expect(installPluginFromMarketplaceRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: "marketplace:demo",
      }),
    );
    expect(installPluginFromNpmSpec).not.toHaveBeenCalled();
    expect(writeConfigFile).toHaveBeenCalledWith(installedCfg);
  });

  it("falls back to npm when the marketplace registry does not have the package", async () => {
    const cfg = {
      plugins: {
        entries: {},
      },
    } as AlisioConfig;
    const enabledCfg = {
      plugins: {
        entries: {
          demo: {
            enabled: true,
          },
        },
      },
    } as AlisioConfig;

    loadConfig.mockReturnValue(cfg);
    installPluginFromMarketplaceRegistry.mockResolvedValue({
      ok: false,
      error: "Marketplace registry /api/v1/packages/demo failed (404): Package not found",
      code: "package_not_found",
    });
    installPluginFromNpmSpec.mockResolvedValue({
      ok: true,
      pluginId: "demo",
      targetDir: cliInstallPath("demo"),
      version: "1.2.3",
      npmResolution: {
        packageName: "demo",
        resolvedVersion: "1.2.3",
        tarballUrl: "https://registry.npmjs.org/demo/-/demo-1.2.3.tgz",
      },
    });
    enablePluginInConfig.mockReturnValue({ config: enabledCfg });
    recordPluginInstall.mockReturnValue(enabledCfg);
    applyExclusiveSlotSelection.mockReturnValue({
      config: enabledCfg,
      warnings: [],
    });

    await runPluginsCommand(["plugins", "install", "demo"]);

    expect(installPluginFromMarketplaceRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: "marketplace:demo",
      }),
    );
    expect(installPluginFromNpmSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: "demo",
      }),
    );
  });

  it("does not fall back to npm when the marketplace registry rejects a real package", async () => {
    installPluginFromMarketplaceRegistry.mockResolvedValue({
      ok: false,
      error: 'Use "alisio skills install demo" instead.',
      code: "skill_package",
    });

    await expect(runPluginsCommand(["plugins", "install", "demo"])).rejects.toThrow("__exit__:1");

    expect(installPluginFromNpmSpec).not.toHaveBeenCalled();
    expect(runtimeErrors.at(-1)).toContain('Use "alisio skills install demo" instead.');
  });

  it("falls back to installing hook packs from npm specs", async () => {
    const cfg = {} as AlisioConfig;
    const installedCfg = {
      hooks: {
        internal: {
          installs: {
            "demo-hooks": {
              source: "npm",
              spec: "@acme/demo-hooks@1.2.3",
            },
          },
        },
      },
    } as AlisioConfig;

    loadConfig.mockReturnValue(cfg);
    installPluginFromMarketplaceRegistry.mockResolvedValue({
      ok: false,
      error:
        "Marketplace registry /api/v1/packages/@acme/demo-hooks failed (404): Package not found",
      code: "package_not_found",
    });
    installPluginFromNpmSpec.mockResolvedValue({
      ok: false,
      error: "package.json missing alisio.plugin.json",
    });
    installHooksFromNpmSpec.mockResolvedValue({
      ok: true,
      hookPackId: "demo-hooks",
      hooks: ["command-audit"],
      targetDir: "/tmp/hooks/demo-hooks",
      version: "1.2.3",
      npmResolution: {
        name: "@acme/demo-hooks",
        spec: "@acme/demo-hooks@1.2.3",
        integrity: "sha256-demo",
      },
    });
    recordHookInstall.mockReturnValue(installedCfg);

    await runPluginsCommand(["plugins", "install", "@acme/demo-hooks"]);

    expect(installHooksFromNpmSpec).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: "@acme/demo-hooks",
      }),
    );
    expect(recordHookInstall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        hookId: "demo-hooks",
        hooks: ["command-audit"],
      }),
    );
    expect(writeConfigFile).toHaveBeenCalledWith(installedCfg);
    expect(runtimeLogs.some((line) => line.includes("Installed hook pack: demo-hooks"))).toBe(true);
  });
});
