import type { Skill } from "@mariozechner/pi-coding-agent";
import JSON5 from "json5";
import { validateRegistryNpmSpec } from "../../infra/npm-registry-spec.js";
import { parseFrontmatterBlock } from "../../markdown/frontmatter.js";
import {
  applyAlisioManifestInstallCommonFields,
  getFrontmatterString,
  normalizeStringList,
  parseAlisioManifestInstallBase,
  parseFrontmatterBool,
  resolveAlisioManifestBlock,
  resolveAlisioManifestInstall,
  resolveAlisioManifestOs,
  resolveAlisioManifestRequires,
} from "../../shared/frontmatter.js";
import { parseBooleanValue } from "../../utils/boolean.js";
import type {
  LegacySkillMetadata,
  ParsedSkillFrontmatter,
  SkillEntry,
  SkillManifest,
  SkillManifestIssue,
  SkillManifestValidation,
  SkillInstallSpec,
  SkillInvocationPolicy,
} from "./types.js";

export function parseFrontmatter(content: string): ParsedSkillFrontmatter {
  return parseFrontmatterBlock(content);
}

const BREW_FORMULA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9@+._/-]*$/;
const APT_PACKAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+:-]*$/;
const GO_MODULE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~+\-/]*(?:@[A-Za-z0-9][A-Za-z0-9._~+\-/]*)?$/;
const UV_PACKAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-[\]=<>!~+,]*$/;
const SKILL_MANIFEST_KEYS = ["manifest", "skill-manifest", "skill_manifest"] as const;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MCP_CAPABILITIES = new Set(["tools", "prompts", "resources"]);
const MCP_TRANSPORTS = new Set(["stdio", "sse", "streamable-http"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeUniqueStringList(input: unknown): string[] {
  return Array.from(new Set(normalizeStringList(input)));
}

function normalizeOptionalBoolean(input: unknown): boolean | undefined {
  if (typeof input === "boolean") {
    return input;
  }
  if (typeof input === "string") {
    return parseBooleanValue(input);
  }
  return undefined;
}

function normalizeEnum<T extends string>(input: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof input !== "string") {
    return fallback;
  }
  const value = input.trim().toLowerCase();
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function parseStructuredFrontmatterObject(
  frontmatter: ParsedSkillFrontmatter,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const raw = getFrontmatterString(frontmatter, key);
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON5.parse(raw);
      const record = asRecord(parsed);
      if (record) {
        return record;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function createDefaultPermissions(): SkillManifest["permissions"] {
  return {
    consent: "explicit",
    sandbox: {
      mode: "isolated",
      filesystem: "read-only",
      network: "off",
    },
  };
}

function createDefaultOutputs(): SkillManifest["outputs"] {
  return {
    primary: "instructions",
    formats: ["markdown"],
  };
}

function createDefaultCompatibility(): SkillManifest["compat"] {
  return {
    runtimes: ["alisio"],
  };
}

function buildMetadataFromLegacyObject(metadataObj: Record<string, unknown>): LegacySkillMetadata {
  const requires = resolveAlisioManifestRequires(metadataObj);
  const install = resolveAlisioManifestInstall(metadataObj, parseInstallSpec);
  const osRaw = resolveAlisioManifestOs(metadataObj);
  return {
    always: typeof metadataObj.always === "boolean" ? metadataObj.always : undefined,
    emoji: typeof metadataObj.emoji === "string" ? metadataObj.emoji : undefined,
    homepage: typeof metadataObj.homepage === "string" ? metadataObj.homepage : undefined,
    skillKey: typeof metadataObj.skillKey === "string" ? metadataObj.skillKey : undefined,
    primaryEnv: typeof metadataObj.primaryEnv === "string" ? metadataObj.primaryEnv : undefined,
    os: osRaw.length > 0 ? osRaw : undefined,
    requires: requires,
    install: install.length > 0 ? install : undefined,
  };
}

function resolveLegacyMetadata(
  frontmatter: ParsedSkillFrontmatter,
): LegacySkillMetadata | undefined {
  const metadataObj = resolveAlisioManifestBlock({ frontmatter });
  if (!metadataObj) {
    return undefined;
  }
  return buildMetadataFromLegacyObject(metadataObj);
}

function buildMetadataFromManifest(manifest: SkillManifest): LegacySkillMetadata {
  return {
    always: manifest.always,
    emoji: manifest.emoji,
    homepage: manifest.homepage,
    skillKey: manifest.skillKey,
    primaryEnv: manifest.primaryEnv,
    os: manifest.compat.os,
    requires: manifest.compat.requires,
    install: manifest.install,
  };
}

function buildManifestFromMetadata(params: {
  metadata?: LegacySkillMetadata;
  skill?: Skill;
  frontmatter: ParsedSkillFrontmatter;
}): SkillManifest {
  const description =
    typeof params.frontmatter.description === "string" ? params.frontmatter.description.trim() : "";
  const metadata = params.metadata;
  return {
    schemaVersion: 1,
    name: params.skill?.name ?? params.frontmatter.name ?? "unknown-skill",
    version: "0.0.0-legacy",
    ...(description ? { description } : {}),
    ...(metadata?.always !== undefined ? { always: metadata.always } : {}),
    ...(metadata?.skillKey ? { skillKey: metadata.skillKey } : {}),
    ...(metadata?.primaryEnv ? { primaryEnv: metadata.primaryEnv } : {}),
    ...(metadata?.emoji ? { emoji: metadata.emoji } : {}),
    ...(metadata?.homepage ? { homepage: metadata.homepage } : {}),
    ...(metadata?.install ? { install: metadata.install } : {}),
    permissions: createDefaultPermissions(),
    outputs: createDefaultOutputs(),
    compat: {
      ...createDefaultCompatibility(),
      ...(metadata?.os ? { os: metadata.os } : {}),
      ...(metadata?.requires ? { requires: metadata.requires } : {}),
    },
  };
}

function permissionsRequireExplicitConsent(permissions: SkillManifest["permissions"]): boolean {
  if (permissions.sandbox.mode !== "isolated") {
    return true;
  }
  if (permissions.sandbox.filesystem !== "read-only") {
    return true;
  }
  if (permissions.sandbox.network !== "off") {
    return true;
  }
  if ((permissions.exec?.bins?.length ?? 0) > 0) {
    return true;
  }
  if ((permissions.files?.write?.length ?? 0) > 0) {
    return true;
  }
  if (permissions.network?.outbound === true) {
    return true;
  }
  if (permissions.mcp?.consume === true) {
    return true;
  }
  return false;
}

function pushIssue(
  issues: SkillManifestIssue[],
  level: SkillManifestIssue["level"],
  message: string,
  path?: string,
) {
  issues.push(path ? { level, message, path } : { level, message });
}

function normalizeManifest(
  raw: Record<string, unknown>,
  issues: SkillManifestIssue[],
): SkillManifest {
  const permissionsRaw = asRecord(raw.permissions);
  const sandboxRaw = asRecord(permissionsRaw?.sandbox);
  const execRaw = asRecord(permissionsRaw?.exec);
  const envRaw = asRecord(permissionsRaw?.env);
  const filesRaw = asRecord(permissionsRaw?.files);
  const networkRaw = asRecord(permissionsRaw?.network);
  const permissionsMcpRaw = asRecord(permissionsRaw?.mcp);
  const outputsRaw = asRecord(raw.outputs);
  const compatRaw = asRecord(raw.compat);
  const compatRequiresRaw = asRecord(compatRaw?.requires);
  const compatMcpRaw = asRecord(compatRaw?.mcp);
  const subscriptionRaw = asRecord(raw.subscription);
  const installRaw = Array.isArray(raw.install) ? raw.install : [];
  const install = installRaw
    .map((entry) => parseInstallSpec(entry))
    .filter(Boolean) as SkillInstallSpec[];

  const primary = normalizeEnum(
    outputsRaw?.primary,
    ["instructions", "tool", "prompt", "resource"] as const,
    "instructions",
  );
  const formats = normalizeUniqueStringList(outputsRaw?.formats);
  const manifest: SkillManifest = {
    schemaVersion: 1,
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    version: typeof raw.version === "string" ? raw.version.trim() : "",
    ...(typeof raw.description === "string" && raw.description.trim()
      ? { description: raw.description.trim() }
      : {}),
    ...(normalizeOptionalBoolean(raw.always) !== undefined
      ? { always: normalizeOptionalBoolean(raw.always) }
      : {}),
    ...(typeof raw.skillKey === "string" && raw.skillKey.trim()
      ? { skillKey: raw.skillKey.trim() }
      : {}),
    ...(typeof raw.primaryEnv === "string" && raw.primaryEnv.trim()
      ? { primaryEnv: raw.primaryEnv.trim() }
      : {}),
    ...(typeof raw.emoji === "string" && raw.emoji.trim() ? { emoji: raw.emoji.trim() } : {}),
    ...(typeof raw.homepage === "string" && raw.homepage.trim()
      ? { homepage: raw.homepage.trim() }
      : {}),
    ...(install.length > 0 ? { install } : {}),
    permissions: {
      consent: normalizeEnum(
        permissionsRaw?.consent,
        ["implicit", "explicit"] as const,
        "explicit",
      ),
      sandbox: {
        mode: normalizeEnum(sandboxRaw?.mode, ["isolated", "inherit"] as const, "isolated"),
        filesystem: normalizeEnum(
          sandboxRaw?.filesystem,
          ["read-only", "workspace-write"] as const,
          "read-only",
        ),
        network: normalizeEnum(sandboxRaw?.network, ["off", "inherit"] as const, "off"),
      },
      ...(execRaw && normalizeUniqueStringList(execRaw.bins).length > 0
        ? { exec: { bins: normalizeUniqueStringList(execRaw.bins) } }
        : {}),
      ...(envRaw && normalizeUniqueStringList(envRaw.read).length > 0
        ? { env: { read: normalizeUniqueStringList(envRaw.read) } }
        : {}),
      ...(filesRaw &&
      (normalizeUniqueStringList(filesRaw.read).length > 0 ||
        normalizeUniqueStringList(filesRaw.write).length > 0)
        ? {
            files: {
              ...(normalizeUniqueStringList(filesRaw.read).length > 0
                ? { read: normalizeUniqueStringList(filesRaw.read) }
                : {}),
              ...(normalizeUniqueStringList(filesRaw.write).length > 0
                ? { write: normalizeUniqueStringList(filesRaw.write) }
                : {}),
            },
          }
        : {}),
      ...(networkRaw &&
      (normalizeOptionalBoolean(networkRaw.outbound) === true ||
        normalizeUniqueStringList(networkRaw.hosts).length > 0)
        ? {
            network: {
              outbound: normalizeOptionalBoolean(networkRaw.outbound) ?? false,
              ...(normalizeUniqueStringList(networkRaw.hosts).length > 0
                ? { hosts: normalizeUniqueStringList(networkRaw.hosts) }
                : {}),
            },
          }
        : {}),
      ...(permissionsMcpRaw &&
      (normalizeOptionalBoolean(permissionsMcpRaw.consume) !== undefined ||
        normalizeOptionalBoolean(permissionsMcpRaw.exposeTools) !== undefined ||
        normalizeOptionalBoolean(permissionsMcpRaw.exposePrompts) !== undefined ||
        normalizeOptionalBoolean(permissionsMcpRaw.exposeResources) !== undefined)
        ? {
            mcp: {
              ...(normalizeOptionalBoolean(permissionsMcpRaw.consume) !== undefined
                ? { consume: normalizeOptionalBoolean(permissionsMcpRaw.consume) }
                : {}),
              ...(normalizeOptionalBoolean(permissionsMcpRaw.exposeTools) !== undefined
                ? { exposeTools: normalizeOptionalBoolean(permissionsMcpRaw.exposeTools) }
                : {}),
              ...(normalizeOptionalBoolean(permissionsMcpRaw.exposePrompts) !== undefined
                ? { exposePrompts: normalizeOptionalBoolean(permissionsMcpRaw.exposePrompts) }
                : {}),
              ...(normalizeOptionalBoolean(permissionsMcpRaw.exposeResources) !== undefined
                ? { exposeResources: normalizeOptionalBoolean(permissionsMcpRaw.exposeResources) }
                : {}),
            },
          }
        : {}),
    },
    outputs: {
      primary,
      formats: formats.length > 0 ? formats : primary === "instructions" ? ["markdown"] : ["json"],
    },
    compat: {
      ...(normalizeUniqueStringList(compatRaw?.os).length > 0
        ? { os: normalizeUniqueStringList(compatRaw?.os) }
        : {}),
      runtimes: (() => {
        const runtimes = normalizeUniqueStringList(compatRaw?.runtimes);
        return runtimes.length > 0 ? runtimes : ["alisio"];
      })(),
      ...(compatRequiresRaw &&
      (normalizeUniqueStringList(compatRequiresRaw.bins).length > 0 ||
        normalizeUniqueStringList(compatRequiresRaw.anyBins).length > 0 ||
        normalizeUniqueStringList(compatRequiresRaw.env).length > 0 ||
        normalizeUniqueStringList(compatRequiresRaw.config).length > 0)
        ? {
            requires: {
              ...(normalizeUniqueStringList(compatRequiresRaw.bins).length > 0
                ? { bins: normalizeUniqueStringList(compatRequiresRaw.bins) }
                : {}),
              ...(normalizeUniqueStringList(compatRequiresRaw.anyBins).length > 0
                ? { anyBins: normalizeUniqueStringList(compatRequiresRaw.anyBins) }
                : {}),
              ...(normalizeUniqueStringList(compatRequiresRaw.env).length > 0
                ? { env: normalizeUniqueStringList(compatRequiresRaw.env) }
                : {}),
              ...(normalizeUniqueStringList(compatRequiresRaw.config).length > 0
                ? { config: normalizeUniqueStringList(compatRequiresRaw.config) }
                : {}),
            },
          }
        : {}),
      ...(compatMcpRaw &&
      (normalizeUniqueStringList(compatMcpRaw.transports).length > 0 ||
        normalizeUniqueStringList(compatMcpRaw.capabilities).length > 0)
        ? {
            mcp: {
              ...(normalizeUniqueStringList(compatMcpRaw.transports).length > 0
                ? {
                    transports: normalizeUniqueStringList(compatMcpRaw.transports).filter(
                      (transport) => MCP_TRANSPORTS.has(transport),
                    ),
                  }
                : {}),
              ...(normalizeUniqueStringList(compatMcpRaw.capabilities).length > 0
                ? {
                    capabilities: normalizeUniqueStringList(compatMcpRaw.capabilities).filter(
                      (capability): capability is "tools" | "prompts" | "resources" =>
                        MCP_CAPABILITIES.has(capability),
                    ),
                  }
                : {}),
            },
          }
        : {}),
    },
    ...(subscriptionRaw &&
    (normalizeOptionalBoolean(subscriptionRaw.required) !== undefined ||
      (typeof subscriptionRaw.plan === "string" && subscriptionRaw.plan.trim()) ||
      (typeof subscriptionRaw.featureFlag === "string" && subscriptionRaw.featureFlag.trim()))
      ? {
          subscription: {
            required: normalizeOptionalBoolean(subscriptionRaw.required) ?? false,
            ...(typeof subscriptionRaw.plan === "string" && subscriptionRaw.plan.trim()
              ? { plan: subscriptionRaw.plan.trim() }
              : {}),
            ...(typeof subscriptionRaw.featureFlag === "string" &&
            subscriptionRaw.featureFlag.trim()
              ? { featureFlag: subscriptionRaw.featureFlag.trim() }
              : {}),
          },
        }
      : {}),
  };

  if (
    permissionsRequireExplicitConsent(manifest.permissions) &&
    manifest.permissions.consent !== "explicit"
  ) {
    pushIssue(
      issues,
      "error",
      "manifest.permissions.consent must be explicit when the skill requests execution, network, MCP, or writable filesystem access.",
      "manifest.permissions.consent",
    );
  }

  return manifest;
}

function buildValidation(
  valid: boolean,
  explicit: boolean,
  source: SkillManifestValidation["source"],
  issues: SkillManifestIssue[],
): SkillManifestValidation {
  return {
    valid,
    explicit,
    source,
    issues,
  };
}

function normalizeSafeBrewFormula(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const formula = raw.trim();
  if (!formula || formula.startsWith("-") || formula.includes("\\") || formula.includes("..")) {
    return undefined;
  }
  if (!BREW_FORMULA_PATTERN.test(formula)) {
    return undefined;
  }
  return formula;
}

function normalizeSafeNpmSpec(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const spec = raw.trim();
  if (!spec || spec.startsWith("-")) {
    return undefined;
  }
  if (validateRegistryNpmSpec(spec) !== null) {
    return undefined;
  }
  return spec;
}

function normalizeSafeAptPackage(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const pkg = raw.trim();
  if (!pkg || pkg.startsWith("-") || pkg.includes("\\") || pkg.includes("/")) {
    return undefined;
  }
  if (!APT_PACKAGE_PATTERN.test(pkg)) {
    return undefined;
  }
  return pkg;
}

function normalizeSafeGoModule(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const moduleSpec = raw.trim();
  if (
    !moduleSpec ||
    moduleSpec.startsWith("-") ||
    moduleSpec.includes("\\") ||
    moduleSpec.includes("://")
  ) {
    return undefined;
  }
  if (!GO_MODULE_PATTERN.test(moduleSpec)) {
    return undefined;
  }
  return moduleSpec;
}

function normalizeSafeUvPackage(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const pkg = raw.trim();
  if (!pkg || pkg.startsWith("-") || pkg.includes("\\") || pkg.includes("://")) {
    return undefined;
  }
  if (!UV_PACKAGE_PATTERN.test(pkg)) {
    return undefined;
  }
  return pkg;
}

function normalizeSafeDownloadUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim();
  if (!value || /\s/.test(value)) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function parseInstallSpec(input: unknown): SkillInstallSpec | undefined {
  const parsed = parseAlisioManifestInstallBase(input, [
    "apt",
    "brew",
    "node",
    "npm",
    "go",
    "uv",
    "download",
  ]);
  if (!parsed) {
    return undefined;
  }
  const { raw } = parsed;
  const normalizedKind = parsed.kind === "npm" ? "node" : parsed.kind;
  const spec = applyAlisioManifestInstallCommonFields<SkillInstallSpec>(
    {
      kind: normalizedKind as SkillInstallSpec["kind"],
    },
    parsed,
  );
  const osList = normalizeStringList(raw.os);
  if (osList.length > 0) {
    spec.os = osList;
  }
  const formula = normalizeSafeBrewFormula(raw.formula);
  if (formula) {
    spec.formula = formula;
  }
  const cask = normalizeSafeBrewFormula(raw.cask);
  if (!spec.formula && cask) {
    spec.formula = cask;
  }
  if (spec.kind === "apt") {
    const pkg = normalizeSafeAptPackage(raw.package);
    if (pkg) {
      spec.package = pkg;
    }
  } else if (spec.kind === "node") {
    const pkg = normalizeSafeNpmSpec(raw.package);
    if (pkg) {
      spec.package = pkg;
    }
  } else if (spec.kind === "uv") {
    const pkg = normalizeSafeUvPackage(raw.package);
    if (pkg) {
      spec.package = pkg;
    }
  }
  const moduleSpec = normalizeSafeGoModule(raw.module);
  if (moduleSpec) {
    spec.module = moduleSpec;
  }
  const downloadUrl = normalizeSafeDownloadUrl(raw.url);
  if (downloadUrl) {
    spec.url = downloadUrl;
  }
  if (typeof raw.archive === "string") {
    spec.archive = raw.archive;
  }
  if (typeof raw.extract === "boolean") {
    spec.extract = raw.extract;
  }
  if (typeof raw.stripComponents === "number") {
    spec.stripComponents = raw.stripComponents;
  }
  if (typeof raw.targetDir === "string") {
    spec.targetDir = raw.targetDir;
  }

  if (spec.kind === "apt" && !spec.package) {
    return undefined;
  }
  if (spec.kind === "brew" && !spec.formula) {
    return undefined;
  }
  if (spec.kind === "node" && !spec.package) {
    return undefined;
  }
  if (spec.kind === "go" && !spec.module) {
    return undefined;
  }
  if (spec.kind === "uv" && !spec.package) {
    return undefined;
  }
  if (spec.kind === "download" && !spec.url) {
    return undefined;
  }

  return spec;
}

export function resolveSkillManifestContract(params: {
  frontmatter: ParsedSkillFrontmatter;
  skill?: Skill;
}): {
  manifest: SkillManifest;
  metadata: LegacySkillMetadata;
  validation: SkillManifestValidation;
} {
  const explicitRaw = parseStructuredFrontmatterObject(params.frontmatter, SKILL_MANIFEST_KEYS);
  if (explicitRaw) {
    const issues: SkillManifestIssue[] = [];
    const manifest = normalizeManifest(explicitRaw, issues);

    if (!("name" in explicitRaw)) {
      pushIssue(issues, "error", "manifest.name is required.", "manifest.name");
    }
    if (!("version" in explicitRaw)) {
      pushIssue(issues, "error", "manifest.version is required.", "manifest.version");
    }
    if (!("permissions" in explicitRaw)) {
      pushIssue(issues, "error", "manifest.permissions is required.", "manifest.permissions");
    }
    if (!("outputs" in explicitRaw)) {
      pushIssue(issues, "error", "manifest.outputs is required.", "manifest.outputs");
    }
    if (!("compat" in explicitRaw)) {
      pushIssue(issues, "error", "manifest.compat is required.", "manifest.compat");
    }
    if (!manifest.name) {
      pushIssue(issues, "error", "manifest.name cannot be empty.", "manifest.name");
    }
    if (!manifest.version) {
      pushIssue(issues, "error", "manifest.version cannot be empty.", "manifest.version");
    } else if (!SEMVER_PATTERN.test(manifest.version)) {
      pushIssue(
        issues,
        "error",
        "manifest.version must use semantic versioning (for example 1.2.3).",
        "manifest.version",
      );
    }
    if (params.skill && manifest.name && manifest.name !== params.skill.name) {
      pushIssue(
        issues,
        "error",
        `manifest.name "${manifest.name}" must match the skill name "${params.skill.name}".`,
        "manifest.name",
      );
    }
    if (manifest.subscription?.required && !manifest.subscription.plan) {
      pushIssue(
        issues,
        "warn",
        "manifest.subscription.plan should be set when subscription.required is true.",
        "manifest.subscription.plan",
      );
    }

    const valid = !issues.some((issue) => issue.level === "error");
    return {
      manifest,
      metadata: buildMetadataFromManifest(manifest),
      validation: buildValidation(valid, true, "manifest", issues),
    };
  }

  const metadata = resolveLegacyMetadata(params.frontmatter);
  if (metadata) {
    const manifest = buildManifestFromMetadata({
      metadata,
      skill: params.skill,
      frontmatter: params.frontmatter,
    });
    return {
      manifest,
      metadata,
      validation: buildValidation(true, false, "legacy-metadata", [
        {
          level: "warn",
          message:
            "Legacy metadata was converted into a default marketplace manifest. Add manifest: ... to declare permissions and compatibility explicitly.",
          path: "metadata",
        },
      ]),
    };
  }

  const manifest = buildManifestFromMetadata({
    skill: params.skill,
    frontmatter: params.frontmatter,
  });
  return {
    manifest,
    metadata: buildMetadataFromManifest(manifest),
    validation: buildValidation(true, false, "inferred", [
      {
        level: "warn",
        message:
          "No explicit skill manifest was found. Marketplace defaults were inferred with isolated sandbox settings.",
        path: "manifest",
      },
    ]),
  };
}

export function resolveSkillManifest(
  frontmatter: ParsedSkillFrontmatter,
  skill?: Skill,
): SkillManifest | undefined {
  return resolveSkillManifestContract({ frontmatter, skill }).manifest;
}

export function resolveSkillManifestValidation(
  frontmatter: ParsedSkillFrontmatter,
  skill?: Skill,
): SkillManifestValidation {
  return resolveSkillManifestContract({ frontmatter, skill }).validation;
}

export function resolveLegacySkillMetadata(
  frontmatter: ParsedSkillFrontmatter,
): LegacySkillMetadata | undefined {
  return resolveSkillManifestContract({ frontmatter }).metadata;
}

export function resolveSkillInvocationPolicy(
  frontmatter: ParsedSkillFrontmatter,
): SkillInvocationPolicy {
  return {
    userInvocable: parseFrontmatterBool(getFrontmatterString(frontmatter, "user-invocable"), true),
    disableModelInvocation: parseFrontmatterBool(
      getFrontmatterString(frontmatter, "disable-model-invocation"),
      false,
    ),
  };
}

export function resolveSkillKey(skill: Skill, entry?: SkillEntry): string {
  return entry?.metadata?.skillKey ?? skill.name;
}
