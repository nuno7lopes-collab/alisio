import {
  MarketplaceRegistryRequestError,
  downloadMarketplaceRegistryPackageArchive,
  fetchMarketplaceRegistryPackageDetail,
  fetchMarketplaceRegistryPackageVersion,
  parseMarketplaceRegistryPluginSpec,
  resolveMarketplaceRegistryBaseUrl,
  resolveLatestVersionFromPackage,
  satisfiesGatewayMinimum,
  satisfiesPluginApiRange,
  type MarketplaceRegistryPackageChannel,
  type MarketplaceRegistryPackageCompatibility,
  type MarketplaceRegistryPackageDetail,
  type MarketplaceRegistryPackageFamily,
} from "../infra/marketplace-registry.js";
import { resolveCompatibilityHostVersion } from "../version.js";
import { installPluginFromArchive, type InstallPluginResult } from "./install.js";

export const MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE = {
  INVALID_SPEC: "invalid_spec",
  PACKAGE_NOT_FOUND: "package_not_found",
  VERSION_NOT_FOUND: "version_not_found",
  NO_INSTALLABLE_VERSION: "no_installable_version",
  SKILL_PACKAGE: "skill_package",
  UNSUPPORTED_FAMILY: "unsupported_family",
  PRIVATE_PACKAGE: "private_package",
  INCOMPATIBLE_PLUGIN_API: "incompatible_plugin_api",
  INCOMPATIBLE_GATEWAY: "incompatible_gateway",
} as const;

export type MarketplaceRegistryInstallErrorCode =
  (typeof MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE)[keyof typeof MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE];

type PluginInstallLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type MarketplaceRegistryPluginInstallRecordFields = {
  source: "marketplace";
  marketplaceRegistryUrl: string;
  marketplacePackage: string;
  marketplaceFamily: Exclude<MarketplaceRegistryPackageFamily, "skill">;
  marketplaceChannel?: MarketplaceRegistryPackageChannel;
  version?: string;
  integrity?: string;
  resolvedAt?: string;
  installedAt?: string;
};

type MarketplaceRegistryInstallFailure = {
  ok: false;
  error: string;
  code?: MarketplaceRegistryInstallErrorCode;
};

export function formatMarketplaceRegistrySpecifier(params: {
  name: string;
  version?: string;
}): string {
  return `marketplace:${params.name}${params.version ? `@${params.version}` : ""}`;
}

function buildMarketplaceRegistryInstallFailure(
  error: string,
  code?: MarketplaceRegistryInstallErrorCode,
): MarketplaceRegistryInstallFailure {
  return { ok: false, error, code };
}

function mapMarketplaceRegistryRequestError(
  error: unknown,
  context: { stage: "package" | "version"; name: string; version?: string },
): MarketplaceRegistryInstallFailure {
  if (error instanceof MarketplaceRegistryRequestError && error.status === 404) {
    if (context.stage === "package") {
      return buildMarketplaceRegistryInstallFailure(
        "Package not found in Local Marketplace.",
        MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.PACKAGE_NOT_FOUND,
      );
    }
    return buildMarketplaceRegistryInstallFailure(
      `Version not found in Local Marketplace: ${context.name}@${context.version ?? "unknown"}.`,
      MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.VERSION_NOT_FOUND,
    );
  }
  return buildMarketplaceRegistryInstallFailure(
    error instanceof Error ? error.message : String(error),
  );
}

function resolveRequestedVersion(params: {
  detail: MarketplaceRegistryPackageDetail;
  requestedVersion?: string;
}): string | null {
  if (params.requestedVersion) {
    return params.requestedVersion;
  }
  return resolveLatestVersionFromPackage(params.detail);
}

async function resolveCompatiblePackageVersion(params: {
  detail: MarketplaceRegistryPackageDetail;
  requestedVersion?: string;
  baseUrl?: string;
  token?: string;
}): Promise<
  | {
      ok: true;
      version: string;
      compatibility?: MarketplaceRegistryPackageCompatibility | null;
    }
  | MarketplaceRegistryInstallFailure
> {
  const version = resolveRequestedVersion(params);
  if (!version) {
    return buildMarketplaceRegistryInstallFailure(
      `Marketplace package "${params.detail.package?.name ?? "unknown"}" has no installable version.`,
      MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.NO_INSTALLABLE_VERSION,
    );
  }
  let versionDetail;
  try {
    versionDetail = await fetchMarketplaceRegistryPackageVersion({
      name: params.detail.package?.name ?? "",
      version,
      baseUrl: params.baseUrl,
      token: params.token,
    });
  } catch (error) {
    return mapMarketplaceRegistryRequestError(error, {
      stage: "version",
      name: params.detail.package?.name ?? "unknown",
      version,
    });
  }
  return {
    ok: true,
    version,
    compatibility:
      versionDetail.version?.compatibility ?? params.detail.package?.compatibility ?? null,
  };
}

function validateMarketplaceRegistryPluginPackage(params: {
  detail: MarketplaceRegistryPackageDetail;
  compatibility?: MarketplaceRegistryPackageCompatibility | null;
  runtimeVersion: string;
}): MarketplaceRegistryInstallFailure | null {
  const pkg = params.detail.package;
  if (!pkg) {
    return buildMarketplaceRegistryInstallFailure(
      "Package not found in Local Marketplace.",
      MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.PACKAGE_NOT_FOUND,
    );
  }
  if (pkg.family === "skill") {
    return buildMarketplaceRegistryInstallFailure(
      `"${pkg.name}" is a skill. Use "alisio skills install ${pkg.name}" instead.`,
      MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.SKILL_PACKAGE,
    );
  }
  if (pkg.family !== "code-plugin" && pkg.family !== "bundle-plugin") {
    return buildMarketplaceRegistryInstallFailure(
      `Unsupported Marketplace package family: ${String(pkg.family)}`,
      MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.UNSUPPORTED_FAMILY,
    );
  }
  if (pkg.channel === "private") {
    return buildMarketplaceRegistryInstallFailure(
      `"${pkg.name}" is private in Local Marketplace and cannot be installed anonymously.`,
      MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.PRIVATE_PACKAGE,
    );
  }

  const compatibility = params.compatibility;
  const runtimeVersion = params.runtimeVersion;
  if (
    compatibility?.pluginApiRange &&
    !satisfiesPluginApiRange(runtimeVersion, compatibility.pluginApiRange)
  ) {
    return buildMarketplaceRegistryInstallFailure(
      `Plugin "${pkg.name}" requires plugin API ${compatibility.pluginApiRange}, but this Alisio runtime exposes ${runtimeVersion}.`,
      MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.INCOMPATIBLE_PLUGIN_API,
    );
  }

  if (
    compatibility?.minGatewayVersion &&
    !satisfiesGatewayMinimum(runtimeVersion, compatibility.minGatewayVersion)
  ) {
    return buildMarketplaceRegistryInstallFailure(
      `Plugin "${pkg.name}" requires Alisio >=${compatibility.minGatewayVersion}, but this host is ${runtimeVersion}.`,
      MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.INCOMPATIBLE_GATEWAY,
    );
  }
  return null;
}

function logMarketplaceRegistryPackageSummary(params: {
  detail: MarketplaceRegistryPackageDetail;
  version: string;
  compatibility?: MarketplaceRegistryPackageCompatibility | null;
  logger?: PluginInstallLogger;
}) {
  const pkg = params.detail.package;
  if (!pkg) {
    return;
  }
  const verification = pkg.verification?.tier ? ` verification=${pkg.verification.tier}` : "";
  params.logger?.info?.(
    `Marketplace ${pkg.family} ${pkg.name}@${params.version} channel=${pkg.channel}${verification}`,
  );
  const compatibilityParts = [
    params.compatibility?.pluginApiRange
      ? `pluginApi=${params.compatibility.pluginApiRange}`
      : null,
    params.compatibility?.minGatewayVersion
      ? `minGateway=${params.compatibility.minGatewayVersion}`
      : null,
  ].filter(Boolean);
  if (compatibilityParts.length > 0) {
    params.logger?.info?.(`Compatibility: ${compatibilityParts.join(" ")}`);
  }
  if (pkg.channel !== "official") {
    params.logger?.warn?.(
      `Marketplace package "${pkg.name}" is ${pkg.channel}; review source and verification before enabling.`,
    );
  }
}

export async function installPluginFromMarketplaceRegistry(params: {
  spec: string;
  baseUrl?: string;
  token?: string;
  logger?: PluginInstallLogger;
  mode?: "install" | "update";
  dryRun?: boolean;
  expectedPluginId?: string;
}): Promise<
  | ({
      ok: true;
    } & Extract<InstallPluginResult, { ok: true }> & {
        marketplaceRegistry: MarketplaceRegistryPluginInstallRecordFields;
        packageName: string;
      })
  | MarketplaceRegistryInstallFailure
  | Extract<InstallPluginResult, { ok: false }>
> {
  const parsed = parseMarketplaceRegistryPluginSpec(params.spec);
  if (!parsed?.name) {
    return buildMarketplaceRegistryInstallFailure(
      `invalid marketplace plugin spec: ${params.spec}`,
      MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.INVALID_SPEC,
    );
  }

  params.logger?.info?.(`Resolving ${formatMarketplaceRegistrySpecifier(parsed)}…`);
  let detail: MarketplaceRegistryPackageDetail;
  try {
    detail = await fetchMarketplaceRegistryPackageDetail({
      name: parsed.name,
      baseUrl: params.baseUrl,
      token: params.token,
    });
  } catch (error) {
    return mapMarketplaceRegistryRequestError(error, {
      stage: "package",
      name: parsed.name,
    });
  }
  const versionState = await resolveCompatiblePackageVersion({
    detail,
    requestedVersion: parsed.version,
    baseUrl: params.baseUrl,
    token: params.token,
  });
  if (!versionState.ok) {
    return versionState;
  }
  const runtimeVersion = resolveCompatibilityHostVersion();
  const validationFailure = validateMarketplaceRegistryPluginPackage({
    detail,
    compatibility: versionState.compatibility,
    runtimeVersion,
  });
  if (validationFailure) {
    return validationFailure;
  }
  logMarketplaceRegistryPackageSummary({
    detail,
    version: versionState.version,
    compatibility: versionState.compatibility,
    logger: params.logger,
  });

  let archive;
  try {
    archive = await downloadMarketplaceRegistryPackageArchive({
      name: parsed.name,
      version: versionState.version,
      baseUrl: params.baseUrl,
      token: params.token,
    });
  } catch (error) {
    return buildMarketplaceRegistryInstallFailure(
      error instanceof Error ? error.message : String(error),
    );
  }
  try {
    params.logger?.info?.(
      `Downloading ${detail.package?.family === "bundle-plugin" ? "bundle" : "plugin"} ${parsed.name}@${versionState.version} from Local Marketplace…`,
    );
    const installResult = await installPluginFromArchive({
      archivePath: archive.archivePath,
      logger: params.logger,
      mode: params.mode,
      dryRun: params.dryRun,
      expectedPluginId: params.expectedPluginId,
    });
    if (!installResult.ok) {
      return installResult;
    }

    const pkg = detail.package!;
    const marketplaceFamily =
      pkg.family === "code-plugin" || pkg.family === "bundle-plugin" ? pkg.family : null;
    if (!marketplaceFamily) {
      return buildMarketplaceRegistryInstallFailure(
        `Unsupported Marketplace package family: ${pkg.family}`,
        MARKETPLACE_REGISTRY_INSTALL_ERROR_CODE.UNSUPPORTED_FAMILY,
      );
    }
    return {
      ...installResult,
      packageName: parsed.name,
      marketplaceRegistry: {
        source: "marketplace",
        marketplaceRegistryUrl: resolveMarketplaceRegistryBaseUrl(params.baseUrl),
        marketplacePackage: parsed.name,
        marketplaceFamily,
        marketplaceChannel: pkg.channel,
        version: installResult.version ?? versionState.version,
        integrity: archive.integrity,
        resolvedAt: new Date().toISOString(),
      },
    };
  } finally {
    await archive.cleanup().catch(() => undefined);
  }
}
