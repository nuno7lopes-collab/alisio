import { beforeEach, describe, expect, it, vi } from "vitest";

const parseMarketplaceRegistryPluginSpecMock = vi.fn();
const fetchMarketplaceRegistryPackageDetailMock = vi.fn();
const fetchMarketplaceRegistryPackageVersionMock = vi.fn();
const downloadMarketplaceRegistryPackageArchiveMock = vi.fn();
const archiveCleanupMock = vi.fn();
const resolveLatestVersionFromPackageMock = vi.fn();
const resolveCompatibilityHostVersionMock = vi.fn();
const installPluginFromArchiveMock = vi.fn();

vi.mock("../infra/marketplace-registry.js", async () => {
  const actual = await vi.importActual<typeof import("../infra/marketplace-registry.js")>(
    "../infra/marketplace-registry.js",
  );
  return {
    ...actual,
    parseMarketplaceRegistryPluginSpec: (...args: unknown[]) =>
      parseMarketplaceRegistryPluginSpecMock(...args),
    fetchMarketplaceRegistryPackageDetail: (...args: unknown[]) =>
      fetchMarketplaceRegistryPackageDetailMock(...args),
    fetchMarketplaceRegistryPackageVersion: (...args: unknown[]) =>
      fetchMarketplaceRegistryPackageVersionMock(...args),
    downloadMarketplaceRegistryPackageArchive: (...args: unknown[]) =>
      downloadMarketplaceRegistryPackageArchiveMock(...args),
    resolveLatestVersionFromPackage: (...args: unknown[]) =>
      resolveLatestVersionFromPackageMock(...args),
  };
});

vi.mock("../version.js", () => ({
  resolveCompatibilityHostVersion: (...args: unknown[]) =>
    resolveCompatibilityHostVersionMock(...args),
}));

vi.mock("./install.js", () => ({
  installPluginFromArchive: (...args: unknown[]) => installPluginFromArchiveMock(...args),
}));

const { MarketplaceRegistryRequestError } = await import("../infra/marketplace-registry.js");
const {
  MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE,
  formatMarketplaceRegistrySpecifier,
  installPluginFromMarketplaceRegistry,
} = await import("./marketplace-registry.js");

async function expectMarketplaceRegistryInstallError(params: {
  setup?: () => void;
  spec: string;
  expected: {
    ok: false;
    code: (typeof MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE)[keyof typeof MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE];
    error: string;
  };
}) {
  params.setup?.();
  await expect(installPluginFromMarketplaceRegistry({ spec: params.spec })).resolves.toMatchObject(
    params.expected,
  );
}

function createLoggerSpies() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function expectMarketplaceRegistryInstallFlow(params: {
  baseUrl: string;
  version: string;
  archivePath: string;
}) {
  expect(fetchMarketplaceRegistryPackageDetailMock).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "demo",
      baseUrl: params.baseUrl,
    }),
  );
  expect(fetchMarketplaceRegistryPackageVersionMock).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "demo",
      version: params.version,
    }),
  );
  expect(installPluginFromArchiveMock).toHaveBeenCalledWith(
    expect.objectContaining({
      archivePath: params.archivePath,
    }),
  );
}

function expectSuccessfulMarketplaceRegistryInstall(result: unknown) {
  expect(result).toMatchObject({
    ok: true,
    pluginId: "demo",
    version: "2026.3.22",
    marketplaceRegistry: {
      source: "marketplace",
      marketplacePackage: "demo",
      marketplaceFamily: "code-plugin",
      marketplaceChannel: "official",
      integrity: "sha256-demo",
    },
  });
}

describe("installPluginFromMarketplaceRegistry", () => {
  beforeEach(() => {
    parseMarketplaceRegistryPluginSpecMock.mockReset();
    fetchMarketplaceRegistryPackageDetailMock.mockReset();
    fetchMarketplaceRegistryPackageVersionMock.mockReset();
    downloadMarketplaceRegistryPackageArchiveMock.mockReset();
    archiveCleanupMock.mockReset();
    resolveLatestVersionFromPackageMock.mockReset();
    resolveCompatibilityHostVersionMock.mockReset();
    installPluginFromArchiveMock.mockReset();

    parseMarketplaceRegistryPluginSpecMock.mockReturnValue({ name: "demo" });
    fetchMarketplaceRegistryPackageDetailMock.mockResolvedValue({
      package: {
        name: "demo",
        displayName: "Demo",
        family: "code-plugin",
        channel: "official",
        isOfficial: true,
        createdAt: 0,
        updatedAt: 0,
        compatibility: {
          pluginApiRange: ">=2026.3.22",
          minGatewayVersion: "2026.3.0",
        },
      },
    });
    resolveLatestVersionFromPackageMock.mockReturnValue("2026.3.22");
    fetchMarketplaceRegistryPackageVersionMock.mockResolvedValue({
      version: {
        version: "2026.3.22",
        createdAt: 0,
        changelog: "",
        compatibility: {
          pluginApiRange: ">=2026.3.22",
          minGatewayVersion: "2026.3.0",
        },
      },
    });
    downloadMarketplaceRegistryPackageArchiveMock.mockResolvedValue({
      archivePath: "/tmp/marketplace-demo/archive.zip",
      integrity: "sha256-demo",
      cleanup: archiveCleanupMock,
    });
    archiveCleanupMock.mockResolvedValue(undefined);
    resolveCompatibilityHostVersionMock.mockReturnValue("2026.3.22");
    installPluginFromArchiveMock.mockResolvedValue({
      ok: true,
      pluginId: "demo",
      targetDir: "/tmp/alisio/plugins/demo",
      version: "2026.3.22",
    });
  });

  it("formats marketplace specifiers", () => {
    expect(formatMarketplaceRegistrySpecifier({ name: "demo" })).toBe("marketplace:demo");
    expect(formatMarketplaceRegistrySpecifier({ name: "demo", version: "1.2.3" })).toBe(
      "marketplace:demo@1.2.3",
    );
  });

  it("installs a marketplace registry code plugin through the archive installer", async () => {
    const logger = createLoggerSpies();
    const result = await installPluginFromMarketplaceRegistry({
      spec: "marketplace:demo",
      baseUrl: "https://clawhub.ai",
      logger,
    });

    expectMarketplaceRegistryInstallFlow({
      baseUrl: "https://clawhub.ai",
      version: "2026.3.22",
      archivePath: "/tmp/marketplace-demo/archive.zip",
    });
    expectSuccessfulMarketplaceRegistryInstall(result);
    expect(logger.info).toHaveBeenCalledWith(
      "Marketplace code-plugin demo@2026.3.22 channel=official",
    );
    expect(logger.info).toHaveBeenCalledWith(
      "Compatibility: pluginApi=>=2026.3.22 minGateway=2026.3.0",
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(archiveCleanupMock).toHaveBeenCalledTimes(1);
  });

  it("cleans up the downloaded archive even when archive install fails", async () => {
    installPluginFromArchiveMock.mockResolvedValueOnce({
      ok: false,
      error: "bad archive",
    });

    const result = await installPluginFromMarketplaceRegistry({
      spec: "marketplace:demo",
      baseUrl: "https://clawhub.ai",
    });

    expect(result).toMatchObject({
      ok: false,
      error: "bad archive",
    });
    expect(archiveCleanupMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "rejects packages whose plugin API range exceeds the runtime version",
      setup: () => {
        resolveCompatibilityHostVersionMock.mockReturnValueOnce("2026.3.21");
      },
      spec: "marketplace:demo",
      expected: {
        ok: false,
        code: MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.INCOMPATIBLE_PLUGIN_API,
        error:
          'Plugin "demo" requires plugin API >=2026.3.22, but this Alisio runtime exposes 2026.3.21.',
      },
    },
    {
      name: "rejects skill families and redirects to skills install",
      setup: () => {
        fetchMarketplaceRegistryPackageDetailMock.mockResolvedValueOnce({
          package: {
            name: "calendar",
            displayName: "Calendar",
            family: "skill",
            channel: "official",
            isOfficial: true,
            createdAt: 0,
            updatedAt: 0,
          },
        });
      },
      spec: "marketplace:calendar",
      expected: {
        ok: false,
        code: MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.SKILL_PACKAGE,
        error: '"calendar" is a skill. Use "alisio skills install calendar" instead.',
      },
    },
    {
      name: "returns typed package-not-found failures",
      setup: () => {
        fetchMarketplaceRegistryPackageDetailMock.mockRejectedValueOnce(
          new MarketplaceRegistryRequestError({
            path: "/api/v1/packages/demo",
            status: 404,
            body: "Package not found",
          }),
        );
      },
      spec: "marketplace:demo",
      expected: {
        ok: false,
        code: MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.PACKAGE_NOT_FOUND,
        error: "Package not found in Local Marketplace.",
      },
    },
    {
      name: "returns typed version-not-found failures",
      setup: () => {
        parseMarketplaceRegistryPluginSpecMock.mockReturnValueOnce({
          name: "demo",
          version: "9.9.9",
        });
        fetchMarketplaceRegistryPackageVersionMock.mockRejectedValueOnce(
          new MarketplaceRegistryRequestError({
            path: "/api/v1/packages/demo/versions/9.9.9",
            status: 404,
            body: "Version not found",
          }),
        );
      },
      spec: "marketplace:demo@9.9.9",
      expected: {
        ok: false,
        code: MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.VERSION_NOT_FOUND,
        error: "Version not found in Local Marketplace: demo@9.9.9.",
      },
    },
  ] as const)("$name", async ({ setup, spec, expected }) => {
    await expectMarketplaceRegistryInstallError({ setup, spec, expected });
  });
});
