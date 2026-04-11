import { createRequire } from "node:module";
import { runtimeEnvKey, readEnv } from "./env.js";

export const CORE_PACKAGE_NAME = "alisio" as const;
export const PUBLIC_PACKAGE_NAME = CORE_PACKAGE_NAME;
const REPO_NWO = `${CORE_PACKAGE_NAME}/${CORE_PACKAGE_NAME}`;
export const ALISIO_MAIN_PACKAGE_SPEC = `github:${REPO_NWO}#main`;
export const ALISIO_GIT_REPO_URL = `https://github.com/${REPO_NWO}.git`;
export const ALISIO_REGISTRY_PACKAGE_NAME = PUBLIC_PACKAGE_NAME;
export const ALISIO_REGISTRY_INSTALL_PREFIX = `${PUBLIC_PACKAGE_NAME}@`;

const KNOWN_DISTRIBUTIONS = new Set<string>([CORE_PACKAGE_NAME]);
const KNOWN_PACKAGE_NAMES = new Set<string>([CORE_PACKAGE_NAME]);

const PACKAGE_JSON_CANDIDATES = [
  "../../package.json",
  "../package.json",
  "../../../package.json",
  "./package.json",
] as const;

const BUILD_INFO_CANDIDATES = [
  "../build-info.json",
  "../../dist/build-info.json",
  "./build-info.json",
  "../../build-info.json",
] as const;

export type DistributionId = typeof CORE_PACKAGE_NAME;

type DistributionBuildInfo = {
  distribution?: unknown;
  update?: {
    registryPackageName?: unknown;
    registryInstallPrefix?: unknown;
    mainPackageSpec?: unknown;
    gitRepoUrl?: unknown;
  };
};

export type UpdateSourceConfig = {
  distribution: DistributionId;
  registryPackageName: string | null;
  registryInstallPrefix: string | null;
  mainPackageSpec: string | null;
  gitRepoUrl: string | null;
};

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDistribution(value: unknown): DistributionId | null {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized || !KNOWN_DISTRIBUTIONS.has(normalized)) {
    return null;
  }
  return normalized as DistributionId;
}

function readJsonCandidate<T>(moduleUrl: string, candidates: readonly string[]): T | null {
  try {
    const require = createRequire(moduleUrl);
    for (const candidate of candidates) {
      try {
        return require(candidate) as T;
      } catch {
        // Ignore missing or unreadable candidates.
      }
    }
  } catch {
    // Ignore invalid module URLs.
  }
  return null;
}

function readPackageNameForModuleUrl(moduleUrl: string): string | null {
  const parsed = readJsonCandidate<{ name?: unknown }>(moduleUrl, PACKAGE_JSON_CANDIDATES);
  const normalized = normalizeString(parsed?.name)?.toLowerCase();
  if (!normalized || !KNOWN_PACKAGE_NAMES.has(normalized)) {
    return null;
  }
  return normalized;
}

function readBuildInfoForModuleUrl(moduleUrl: string): DistributionBuildInfo | null {
  return readJsonCandidate<DistributionBuildInfo>(moduleUrl, BUILD_INFO_CANDIDATES);
}

function readDistributionEnv(env: NodeJS.ProcessEnv): string | undefined {
  return readEnv("ALISIO_DISTRIBUTION", {
    env,
    fallback: runtimeEnvKey("DISTRIBUTION"),
    description: "distribution id",
  });
}

function readUpdateEnv(
  env: NodeJS.ProcessEnv,
  suffix: string,
  description: string,
): string | undefined {
  return readEnv(`ALISIO_UPDATE_${suffix}`, {
    env,
    fallback: runtimeEnvKey(`UPDATE_${suffix}`),
    description,
  });
}

export function resolveDistributionId(params?: {
  moduleUrl?: string;
  env?: NodeJS.ProcessEnv;
}): DistributionId {
  const moduleUrl = params?.moduleUrl ?? import.meta.url;
  const env = params?.env ?? process.env;
  return (
    normalizeDistribution(readDistributionEnv(env)) ??
    normalizeDistribution(readBuildInfoForModuleUrl(moduleUrl)?.distribution) ??
    normalizeDistribution(readPackageNameForModuleUrl(moduleUrl)) ??
    CORE_PACKAGE_NAME
  );
}

function resolveConfiguredUpdateField(
  envValue: string | undefined,
  buildValue: unknown,
): string | null {
  return normalizeString(envValue) ?? normalizeString(buildValue);
}

function resolveDefaultUpdateSourceConfig(_distribution: DistributionId) {
  return {
    registryPackageName: ALISIO_REGISTRY_PACKAGE_NAME,
    registryInstallPrefix: ALISIO_REGISTRY_INSTALL_PREFIX,
    mainPackageSpec: ALISIO_MAIN_PACKAGE_SPEC,
    gitRepoUrl: ALISIO_GIT_REPO_URL,
  };
}

export function resolveUpdateSourceConfig(params?: {
  moduleUrl?: string;
  env?: NodeJS.ProcessEnv;
}): UpdateSourceConfig {
  const moduleUrl = params?.moduleUrl ?? import.meta.url;
  const env = params?.env ?? process.env;
  const buildInfo = readBuildInfoForModuleUrl(moduleUrl);
  const distribution = resolveDistributionId({ moduleUrl, env });
  const defaults = resolveDefaultUpdateSourceConfig(distribution);

  return {
    distribution,
    registryPackageName:
      resolveConfiguredUpdateField(
        readUpdateEnv(env, "REGISTRY_PACKAGE", "update registry package"),
        buildInfo?.update?.registryPackageName,
      ) ?? defaults.registryPackageName,
    registryInstallPrefix:
      resolveConfiguredUpdateField(
        readUpdateEnv(env, "REGISTRY_INSTALL_PREFIX", "update registry install prefix"),
        buildInfo?.update?.registryInstallPrefix,
      ) ?? defaults.registryInstallPrefix,
    mainPackageSpec:
      resolveConfiguredUpdateField(
        readUpdateEnv(env, "MAIN_PACKAGE_SPEC", "update main package spec"),
        buildInfo?.update?.mainPackageSpec,
      ) ?? defaults.mainPackageSpec,
    gitRepoUrl:
      resolveConfiguredUpdateField(
        readUpdateEnv(env, "GIT_REPO_URL", "update git repo URL"),
        buildInfo?.update?.gitRepoUrl,
      ) ?? defaults.gitRepoUrl,
  };
}

export function isKnownDistributionPackageName(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && KNOWN_PACKAGE_NAMES.has(normalized));
}
