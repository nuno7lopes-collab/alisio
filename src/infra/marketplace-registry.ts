import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExternalPluginCompatibility } from "../../packages/plugin-package-contract/src/index.js";
import { runtimeEnvKey, readEnv } from "./env.js";
import { isAtLeast, parseSemver } from "./runtime-guard.js";
import { compareComparableSemver, parseComparableSemver } from "./semver-compare.js";
import { createTempDownloadTarget } from "./temp-download.js";

const DEFAULT_MARKETPLACE_REGISTRY_URL = "https://clawhub.ai";
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export type MarketplaceRegistryPackageFamily = "skill" | "code-plugin" | "bundle-plugin";
export type MarketplaceRegistryPackageChannel = "official" | "community" | "private";
export type MarketplaceRegistryPackageCompatibility = ExternalPluginCompatibility;
export type MarketplaceRegistryPackageListItem = {
  name: string;
  displayName: string;
  family: MarketplaceRegistryPackageFamily;
  runtimeId?: string | null;
  channel: MarketplaceRegistryPackageChannel;
  isOfficial: boolean;
  summary?: string | null;
  ownerHandle?: string | null;
  createdAt: number;
  updatedAt: number;
  latestVersion?: string | null;
  capabilityTags?: string[];
  executesCode?: boolean;
  verificationTier?: string | null;
};
export type MarketplaceRegistryPackageDetail = {
  package:
    | (MarketplaceRegistryPackageListItem & {
        tags?: Record<string, string>;
        compatibility?: MarketplaceRegistryPackageCompatibility | null;
        capabilities?: {
          executesCode?: boolean;
          runtimeId?: string;
          capabilityTags?: string[];
          bundleFormat?: string;
          hostTargets?: string[];
          pluginKind?: string;
          channels?: string[];
          providers?: string[];
          hooks?: string[];
          bundledSkills?: string[];
        } | null;
        verification?: {
          tier?: string;
          scope?: string;
          summary?: string;
          sourceRepo?: string;
          sourceCommit?: string;
          hasProvenance?: boolean;
          scanStatus?: string;
        } | null;
      })
    | null;
  owner?: {
    handle?: string | null;
    displayName?: string | null;
    image?: string | null;
  } | null;
};

export type MarketplaceRegistryPackageVersion = {
  package: {
    name: string;
    displayName: string;
    family: MarketplaceRegistryPackageFamily;
  } | null;
  version: {
    version: string;
    createdAt: number;
    changelog: string;
    distTags?: string[];
    files?: unknown;
    compatibility?: MarketplaceRegistryPackageCompatibility | null;
    capabilities?: MarketplaceRegistryPackageDetail["package"] extends infer T
      ? T extends { capabilities?: infer C }
        ? C
        : never
      : never;
    verification?: MarketplaceRegistryPackageDetail["package"] extends infer T
      ? T extends { verification?: infer C }
        ? C
        : never
      : never;
  } | null;
};

export type MarketplaceRegistryPackageSearchResult = {
  score: number;
  package: MarketplaceRegistryPackageListItem;
};

export type MarketplaceRegistrySkillSearchResult = {
  score: number;
  slug: string;
  displayName: string;
  summary?: string;
  version?: string;
  updatedAt?: number;
};

export type MarketplaceRegistrySkillDetail = {
  skill: {
    slug: string;
    displayName: string;
    summary?: string;
    tags?: Record<string, string>;
    createdAt: number;
    updatedAt: number;
  } | null;
  latestVersion?: {
    version: string;
    createdAt: number;
    changelog?: string;
  } | null;
  metadata?: {
    os?: string[] | null;
    systems?: string[] | null;
  } | null;
  owner?: {
    handle?: string | null;
    displayName?: string | null;
    image?: string | null;
  } | null;
};

export type MarketplaceRegistrySkillListResponse = {
  items: Array<{
    slug: string;
    displayName: string;
    summary?: string;
    tags?: Record<string, string>;
    latestVersion?: {
      version: string;
      createdAt: number;
      changelog?: string;
    } | null;
    metadata?: {
      os?: string[] | null;
      systems?: string[] | null;
    } | null;
    createdAt: number;
    updatedAt: number;
  }>;
  nextCursor?: string | null;
};

export type MarketplaceRegistryDownloadResult = {
  archivePath: string;
  integrity: string;
  cleanup: () => Promise<void>;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type MarketplaceRegistryRequestParams = {
  baseUrl?: string;
  path: string;
  token?: string;
  timeoutMs?: number;
  search?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
};

type MarketplaceRegistryConfigLike = {
  token?: unknown;
  accessToken?: unknown;
  authToken?: unknown;
  apiToken?: unknown;
  auth?: MarketplaceRegistryConfigLike | null;
  session?: MarketplaceRegistryConfigLike | null;
  credentials?: MarketplaceRegistryConfigLike | null;
  user?: MarketplaceRegistryConfigLike | null;
};

export class MarketplaceRegistryRequestError extends Error {
  readonly status: number;
  readonly requestPath: string;
  readonly responseBody: string;

  constructor(params: { path: string; status: number; body: string }) {
    super(`Marketplace registry ${params.path} failed (${params.status}): ${params.body}`);
    this.name = "MarketplaceRegistryRequestError";
    this.status = params.status;
    this.requestPath = params.path;
    this.responseBody = params.body;
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  const envValue =
    readEnv("ALISIO_MARKETPLACE_REGISTRY_URL", {
      fallback: runtimeEnvKey("MARKETPLACE_REGISTRY_URL"),
      description: "Marketplace registry base URL",
    }) ||
    readEnv("ALISIO_CLAWHUB_URL", {
      fallback: runtimeEnvKey("CLAWHUB_URL"),
      description: "Legacy marketplace registry base URL",
    }) ||
    process.env.MARKETPLACE_REGISTRY_URL?.trim() ||
    process.env.CLAWHUB_URL?.trim() ||
    DEFAULT_MARKETPLACE_REGISTRY_URL;
  const value = (baseUrl?.trim() || envValue).replace(/\/+$/, "");
  return value || DEFAULT_MARKETPLACE_REGISTRY_URL;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractTokenFromMarketplaceRegistryConfig(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as MarketplaceRegistryConfigLike;
  return (
    readNonEmptyString(record.accessToken) ??
    readNonEmptyString(record.authToken) ??
    readNonEmptyString(record.apiToken) ??
    readNonEmptyString(record.token) ??
    extractTokenFromMarketplaceRegistryConfig(record.auth) ??
    extractTokenFromMarketplaceRegistryConfig(record.session) ??
    extractTokenFromMarketplaceRegistryConfig(record.credentials) ??
    extractTokenFromMarketplaceRegistryConfig(record.user)
  );
}

function resolveMarketplaceRegistryConfigPaths(): string[] {
  const explicit =
    readEnv("ALISIO_MARKETPLACE_REGISTRY_CONFIG_PATH", {
      fallback: runtimeEnvKey("MARKETPLACE_REGISTRY_CONFIG_PATH"),
      description: "Marketplace registry config path",
    }) ||
    readEnv("ALISIO_CLAWHUB_CONFIG_PATH", {
      fallback: runtimeEnvKey("CLAWHUB_CONFIG_PATH"),
      description: "Legacy marketplace registry config path",
    }) ||
    process.env.MARKETPLACE_REGISTRY_CONFIG_PATH?.trim() ||
    process.env.CLAWHUB_CONFIG_PATH?.trim() ||
    process.env.CLAWDHUB_CONFIG_PATH?.trim(); // legacy misspelling from older clawhub CLI builds; keep for back-compat
  if (explicit) {
    return [explicit];
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const configHome =
    xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : path.join(os.homedir(), ".config");
  const marketplaceXdgPath = path.join(configHome, "alisio-marketplace", "config.json");
  const legacyXdgPath = path.join(configHome, "clawhub", "config.json");

  if (process.platform === "darwin") {
    return [
      path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "alisio-marketplace",
        "config.json",
      ),
      path.join(os.homedir(), "Library", "Application Support", "clawhub", "config.json"),
      marketplaceXdgPath,
      legacyXdgPath,
    ];
  }

  return [marketplaceXdgPath, legacyXdgPath];
}

export async function resolveMarketplaceRegistryAuthToken(): Promise<string | undefined> {
  const envToken =
    readEnv("ALISIO_MARKETPLACE_REGISTRY_TOKEN", {
      fallback: runtimeEnvKey("MARKETPLACE_REGISTRY_TOKEN"),
      description: "Marketplace registry auth token",
      redact: true,
    }) ||
    readEnv("ALISIO_CLAWHUB_TOKEN", {
      fallback: runtimeEnvKey("CLAWHUB_TOKEN"),
      description: "Legacy marketplace registry auth token",
      redact: true,
    }) ||
    process.env.MARKETPLACE_REGISTRY_TOKEN?.trim() ||
    process.env.CLAWHUB_TOKEN?.trim() ||
    process.env.CLAWHUB_AUTH_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  for (const configPath of resolveMarketplaceRegistryConfigPaths()) {
    try {
      const raw = await fs.readFile(configPath, "utf8");
      const token = extractTokenFromMarketplaceRegistryConfig(JSON.parse(raw));
      if (token) {
        return token;
      }
    } catch {
      // Try the next candidate path.
    }
  }
  return undefined;
}

function compareSemver(left: string, right: string): number | null {
  return compareComparableSemver(parseComparableSemver(left), parseComparableSemver(right));
}

function upperBoundForCaret(version: string): string | null {
  const parsed = parseComparableSemver(version);
  if (!parsed) {
    return null;
  }
  if (parsed.major > 0) {
    return `${parsed.major + 1}.0.0`;
  }
  if (parsed.minor > 0) {
    return `0.${parsed.minor + 1}.0`;
  }
  return `0.0.${parsed.patch + 1}`;
}

function satisfiesComparator(version: string, token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.startsWith("^")) {
    const base = trimmed.slice(1).trim();
    const upperBound = upperBoundForCaret(base);
    const lowerCmp = compareSemver(version, base);
    const upperCmp = upperBound ? compareSemver(version, upperBound) : null;
    return lowerCmp != null && upperCmp != null && lowerCmp >= 0 && upperCmp < 0;
  }

  const match = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(trimmed);
  if (!match) {
    return false;
  }
  const operator = match[1] ?? "=";
  const target = match[2]?.trim();
  if (!target) {
    return false;
  }
  const cmp = compareSemver(version, target);
  if (cmp == null) {
    return false;
  }
  switch (operator) {
    case ">=":
      return cmp >= 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case "<":
      return cmp < 0;
    case "=":
    default:
      return cmp === 0;
  }
}

function satisfiesSemverRange(version: string, range: string): boolean {
  const tokens = range
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }
  return tokens.every((token) => satisfiesComparator(version, token));
}

function buildUrl(
  params: Pick<MarketplaceRegistryRequestParams, "baseUrl" | "path" | "search">,
): URL {
  const url = new URL(params.path, `${normalizeBaseUrl(params.baseUrl)}/`);
  for (const [key, value] of Object.entries(params.search ?? {})) {
    if (!value) {
      continue;
    }
    url.searchParams.set(key, value);
  }
  return url;
}

async function marketplaceRegistryRequest(
  params: MarketplaceRegistryRequestParams,
): Promise<{ response: Response; url: URL }> {
  const url = buildUrl(params);
  const token = params.token?.trim() || (await resolveMarketplaceRegistryAuthToken());
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error(
          `Marketplace registry request timed out after ${params.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS}ms`,
        ),
      ),
    params.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await (params.fetchImpl ?? fetch)(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    });
    return { response, url };
  } finally {
    clearTimeout(timeout);
  }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text || response.statusText || `HTTP ${response.status}`;
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

async function fetchJson<T>(params: MarketplaceRegistryRequestParams): Promise<T> {
  const { response, url } = await marketplaceRegistryRequest(params);
  if (!response.ok) {
    throw new MarketplaceRegistryRequestError({
      path: url.pathname,
      status: response.status,
      body: await readErrorBody(response),
    });
  }
  return (await response.json()) as T;
}

export function resolveMarketplaceRegistryBaseUrl(baseUrl?: string): string {
  return normalizeBaseUrl(baseUrl);
}

export function formatSha256Integrity(bytes: Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest("base64");
  return `sha256-${digest}`;
}

export function parseMarketplaceRegistryPluginSpec(raw: string): {
  name: string;
  version?: string;
  baseUrl?: string;
} | null {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  const prefix = lower.startsWith("marketplace:")
    ? "marketplace:"
    : lower.startsWith("clawhub:")
      ? "clawhub:"
      : null;
  if (!prefix) {
    return null;
  }
  const spec = trimmed.slice(prefix.length).trim();
  if (!spec) {
    return null;
  }
  const atIndex = spec.lastIndexOf("@");
  if (atIndex <= 0 || atIndex >= spec.length - 1) {
    return { name: spec };
  }
  return {
    name: spec.slice(0, atIndex).trim(),
    version: spec.slice(atIndex + 1).trim() || undefined,
  };
}

export async function fetchMarketplaceRegistryPackageDetail(params: {
  name: string;
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): Promise<MarketplaceRegistryPackageDetail> {
  return await fetchJson<MarketplaceRegistryPackageDetail>({
    baseUrl: params.baseUrl,
    path: `/api/v1/packages/${encodeURIComponent(params.name)}`,
    token: params.token,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
  });
}

export async function fetchMarketplaceRegistryPackageVersion(params: {
  name: string;
  version: string;
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): Promise<MarketplaceRegistryPackageVersion> {
  return await fetchJson<MarketplaceRegistryPackageVersion>({
    baseUrl: params.baseUrl,
    path: `/api/v1/packages/${encodeURIComponent(params.name)}/versions/${encodeURIComponent(
      params.version,
    )}`,
    token: params.token,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
  });
}

export async function searchMarketplaceRegistryPackages(params: {
  query: string;
  family?: MarketplaceRegistryPackageFamily;
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  limit?: number;
}): Promise<MarketplaceRegistryPackageSearchResult[]> {
  const result = await fetchJson<{ results: MarketplaceRegistryPackageSearchResult[] }>({
    baseUrl: params.baseUrl,
    path: "/api/v1/packages/search",
    token: params.token,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
    search: {
      q: params.query.trim(),
      family: params.family,
      limit: params.limit ? String(params.limit) : undefined,
    },
  });
  return result.results ?? [];
}

export async function searchMarketplaceRegistrySkills(params: {
  query: string;
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  limit?: number;
}): Promise<MarketplaceRegistrySkillSearchResult[]> {
  const result = await fetchJson<{ results: MarketplaceRegistrySkillSearchResult[] }>({
    baseUrl: params.baseUrl,
    path: "/api/v1/search",
    token: params.token,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
    search: {
      q: params.query.trim(),
      limit: params.limit ? String(params.limit) : undefined,
    },
  });
  return result.results ?? [];
}

export async function fetchMarketplaceRegistrySkillDetail(params: {
  slug: string;
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): Promise<MarketplaceRegistrySkillDetail> {
  return await fetchJson<MarketplaceRegistrySkillDetail>({
    baseUrl: params.baseUrl,
    path: `/api/v1/skills/${encodeURIComponent(params.slug)}`,
    token: params.token,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
  });
}

export async function listMarketplaceRegistrySkills(params: {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  limit?: number;
}): Promise<MarketplaceRegistrySkillListResponse> {
  return await fetchJson<MarketplaceRegistrySkillListResponse>({
    baseUrl: params.baseUrl,
    path: "/api/v1/skills",
    token: params.token,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
    search: {
      limit: params.limit ? String(params.limit) : undefined,
    },
  });
}

export async function downloadMarketplaceRegistryPackageArchive(params: {
  name: string;
  version?: string;
  tag?: string;
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): Promise<MarketplaceRegistryDownloadResult> {
  const search = params.version
    ? { version: params.version }
    : params.tag
      ? { tag: params.tag }
      : undefined;
  const { response, url } = await marketplaceRegistryRequest({
    baseUrl: params.baseUrl,
    path: `/api/v1/packages/${encodeURIComponent(params.name)}/download`,
    search,
    token: params.token,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
  });
  if (!response.ok) {
    throw new MarketplaceRegistryRequestError({
      path: url.pathname,
      status: response.status,
      body: await readErrorBody(response),
    });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const target = await createTempDownloadTarget({
    prefix: "alisio-marketplace-registry-package",
    fileName: `${params.name}.zip`,
    tmpDir: os.tmpdir(),
  });
  await fs.writeFile(target.path, bytes);
  return {
    archivePath: target.path,
    integrity: formatSha256Integrity(bytes),
    cleanup: target.cleanup,
  };
}

export async function downloadMarketplaceRegistrySkillArchive(params: {
  slug: string;
  version?: string;
  tag?: string;
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): Promise<MarketplaceRegistryDownloadResult> {
  const { response, url } = await marketplaceRegistryRequest({
    baseUrl: params.baseUrl,
    path: "/api/v1/download",
    token: params.token,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
    search: {
      slug: params.slug,
      version: params.version,
      tag: params.version ? undefined : params.tag,
    },
  });
  if (!response.ok) {
    throw new MarketplaceRegistryRequestError({
      path: url.pathname,
      status: response.status,
      body: await readErrorBody(response),
    });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const target = await createTempDownloadTarget({
    prefix: "alisio-marketplace-registry-skill",
    fileName: `${params.slug}.zip`,
    tmpDir: os.tmpdir(),
  });
  await fs.writeFile(target.path, bytes);
  return {
    archivePath: target.path,
    integrity: formatSha256Integrity(bytes),
    cleanup: target.cleanup,
  };
}

export function resolveLatestVersionFromPackage(
  detail: MarketplaceRegistryPackageDetail,
): string | null {
  return detail.package?.latestVersion ?? detail.package?.tags?.latest ?? null;
}

export function isMarketplaceRegistryFamilySkill(
  detail: MarketplaceRegistryPackageDetail | MarketplaceRegistrySkillDetail,
): boolean {
  if ("package" in detail) {
    return detail.package?.family === "skill";
  }
  return Boolean(detail.skill);
}

export function satisfiesPluginApiRange(
  pluginApiVersion: string,
  pluginApiRange?: string | null,
): boolean {
  if (!pluginApiRange) {
    return true;
  }
  return satisfiesSemverRange(pluginApiVersion, pluginApiRange);
}

export function satisfiesGatewayMinimum(
  currentVersion: string,
  minGatewayVersion?: string | null,
): boolean {
  if (!minGatewayVersion) {
    return true;
  }
  const current = parseSemver(currentVersion);
  const minimum = parseSemver(minGatewayVersion);
  if (!current || !minimum) {
    return false;
  }
  return isAtLeast(current, minimum);
}
