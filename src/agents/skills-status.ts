import path from "node:path";
import type { AlisioConfig } from "../config/config.js";
import { evaluateEntryRequirementsForCurrentPlatform } from "../shared/entry-status.js";
import {
  evaluateRequirementsFromMetadataWithRemote,
  type RequirementConfigCheck,
  type Requirements,
} from "../shared/requirements.js";
import { CONFIG_DIR } from "../utils.js";
import {
  hasBinary,
  isBundledSkillAllowed,
  isConfigPathTruthy,
  listSkillAuditEntries,
  listSkillConsentGrants,
  loadWorkspaceSkillEntries,
  resolveSkillMarketplaceCatalog,
  type ResolvedSkillCatalogEntry,
  resolveBundledAllowlist,
  resolveSkillConfig,
  resolveSkillsInstallPreferences,
  type SkillAuditEntry,
  type SkillCompatibilitySpec,
  type SkillConsentGrant,
  type SkillEntry,
  type SkillEligibilityContext,
  type SkillInstallSpec,
  type SkillManifestIssue,
  type SkillOutputsSpec,
  type SkillPermissionSpec,
  type SkillSubscriptionSpec,
  type SkillsInstallPreferences,
} from "./skills.js";
import { resolveBundledSkillsContext } from "./skills/bundled-context.js";
import type {
  SkillMarketplaceAccess,
  SkillMarketplaceAccessContext,
} from "./skills/marketplace-access.js";
import { isBundledRuntimeSkillSource, resolveSkillSource } from "./skills/source.js";

export type SkillStatusConfigCheck = RequirementConfigCheck;

export type SkillInstallOption = {
  id: string;
  kind: SkillInstallSpec["kind"];
  label: string;
  bins: string[];
};

export type SkillStatusEntry = {
  kind?: "local-skill" | "mcp-server";
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  filePath: string;
  baseDir: string;
  skillKey: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
  requirements: Requirements;
  missing: Requirements;
  configChecks: SkillStatusConfigCheck[];
  install: SkillInstallOption[];
  manifestVersion?: string;
  manifestSource: "manifest" | "legacy-metadata" | "inferred";
  manifestValid: boolean;
  marketplaceReady: boolean;
  manifestIssues: SkillManifestIssue[];
  permissions: SkillPermissionSpec;
  outputs?: SkillOutputsSpec;
  compat?: SkillCompatibilitySpec;
  subscription?: SkillSubscriptionSpec;
  access?: SkillMarketplaceAccess;
  installed?: boolean;
  installable?: boolean;
  removable?: boolean;
  executable?: boolean;
  mcpServer?: {
    serverName: string;
    transport: "stdio" | "sse" | "streamable-http";
    launchSummary: string;
  };
  recentAudit?: SkillAuditEntry[];
  consentGrants?: SkillConsentGrant[];
};

export type SkillStatusReport = {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillStatusEntry[];
  marketplaceCatalog?: SkillStatusEntry[];
};

function resolveSkillKey(entry: SkillEntry): string {
  return entry.metadata?.skillKey ?? entry.skill.name;
}

function selectPreferredInstallSpec(
  install: SkillInstallSpec[],
  prefs: SkillsInstallPreferences,
): { spec: SkillInstallSpec; index: number } | undefined {
  if (install.length === 0) {
    return undefined;
  }

  const indexed = install.map((spec, index) => ({ spec, index }));
  const findKind = (kind: SkillInstallSpec["kind"]) =>
    indexed.find((item) => item.spec.kind === kind);

  const brewSpec = findKind("brew");
  const aptSpec = findKind("apt");
  const nodeSpec = findKind("node");
  const goSpec = findKind("go");
  const uvSpec = findKind("uv");
  const downloadSpec = findKind("download");
  const brewAvailable = hasBinary("brew");

  // Table-driven preference chain; first match wins.
  const pickers: Array<() => { spec: SkillInstallSpec; index: number } | undefined> = [
    () => (prefs.preferBrew && brewAvailable ? brewSpec : undefined),
    () => uvSpec,
    () => nodeSpec,
    // Only prefer brew when available to avoid guaranteed failure on Linux/Docker.
    () => (brewAvailable ? brewSpec : undefined),
    () => (process.platform === "linux" ? aptSpec : undefined),
    () => goSpec,
    // Prefer download over an unavailable brew spec.
    () => downloadSpec,
    // Last resort: surface descriptive brew-missing error instead of "no installer found".
    () => brewSpec,
    () => (process.platform === "linux" ? aptSpec : undefined),
    () => indexed[0],
  ];

  for (const pick of pickers) {
    const selected = pick();
    if (selected) {
      return selected;
    }
  }

  return undefined;
}

function normalizeInstallOptions(
  entry: SkillEntry,
  prefs: SkillsInstallPreferences,
): SkillInstallOption[] {
  // If the skill is explicitly OS-scoped, don't surface install actions on unsupported platforms.
  // (Installers run locally; remote OS eligibility is handled separately.)
  const requiredOs = entry.metadata?.os ?? [];
  if (requiredOs.length > 0 && !requiredOs.includes(process.platform)) {
    return [];
  }

  const install = entry.metadata?.install ?? [];
  if (install.length === 0) {
    return [];
  }

  const platform = process.platform;
  const filtered = install.filter((spec) => {
    const osList = spec.os ?? [];
    if (spec.kind === "apt" && platform !== "linux") {
      return false;
    }
    return osList.length === 0 || osList.includes(platform);
  });
  if (filtered.length === 0) {
    return [];
  }

  const toOption = (spec: SkillInstallSpec, index: number): SkillInstallOption => {
    const id = (spec.id ?? `${spec.kind}-${index}`).trim();
    const bins = spec.bins ?? [];
    let label = (spec.label ?? "").trim();
    if (spec.kind === "node" && spec.package) {
      label = `Install ${spec.package} (${prefs.nodeManager})`;
    }
    if (!label) {
      if (spec.kind === "apt" && spec.package) {
        label = `Install ${spec.package} (apt)`;
      } else if (spec.kind === "brew" && spec.formula) {
        label = `Install ${spec.formula} (brew)`;
      } else if (spec.kind === "node" && spec.package) {
        label = `Install ${spec.package} (${prefs.nodeManager})`;
      } else if (spec.kind === "go" && spec.module) {
        label = `Install ${spec.module} (go)`;
      } else if (spec.kind === "uv" && spec.package) {
        label = `Install ${spec.package} (uv)`;
      } else if (spec.kind === "download" && spec.url) {
        const url = spec.url.trim();
        const last = url.split("/").pop();
        label = `Download ${last && last.length > 0 ? last : url}`;
      } else {
        label = "Run installer";
      }
    }
    return { id, kind: spec.kind, label, bins };
  };

  const allDownloads = filtered.every((spec) => spec.kind === "download");
  if (allDownloads) {
    return filtered.map((spec, index) => toOption(spec, index));
  }

  const preferred = selectPreferredInstallSpec(filtered, prefs);
  if (!preferred) {
    return [];
  }
  return [toOption(preferred.spec, preferred.index)];
}

function buildSkillStatus(
  entry: SkillEntry,
  config?: AlisioConfig,
  prefs?: SkillsInstallPreferences,
  eligibility?: SkillEligibilityContext,
  bundledNames?: Set<string>,
): SkillStatusEntry {
  const skillKey = resolveSkillKey(entry);
  const skillConfig = resolveSkillConfig(config, skillKey);
  const disabled = skillConfig?.enabled === false;
  const allowBundled = resolveBundledAllowlist(config);
  const blockedByAllowlist = !isBundledSkillAllowed(entry, allowBundled);
  const always = entry.metadata?.always === true;
  const isEnvSatisfied = (envName: string) =>
    Boolean(
      process.env[envName] ||
      skillConfig?.env?.[envName] ||
      (skillConfig?.apiKey && entry.metadata?.primaryEnv === envName),
    );
  const isConfigSatisfied = (pathStr: string) => isConfigPathTruthy(config, pathStr);
  const skillSource = resolveSkillSource(entry.skill);
  const bundled =
    isBundledRuntimeSkillSource(skillSource) ||
    (skillSource === "unknown" && bundledNames?.has(entry.skill.name) === true);

  const { emoji, homepage, required, missing, requirementsSatisfied, configChecks } =
    evaluateEntryRequirementsForCurrentPlatform({
      always,
      entry,
      hasLocalBin: hasBinary,
      remote: eligibility?.remote,
      isEnvSatisfied,
      isConfigSatisfied,
    });
  const eligible = !disabled && !blockedByAllowlist && requirementsSatisfied;

  return {
    name: entry.skill.name,
    description: entry.skill.description,
    source: skillSource,
    bundled,
    filePath: entry.skill.filePath,
    baseDir: entry.skill.baseDir,
    skillKey,
    primaryEnv: entry.metadata?.primaryEnv,
    emoji,
    homepage,
    always,
    disabled,
    blockedByAllowlist,
    eligible,
    requirements: required,
    missing,
    configChecks,
    install: normalizeInstallOptions(entry, prefs ?? resolveSkillsInstallPreferences(config)),
    manifestVersion: entry.manifest?.version,
    manifestSource: entry.manifestValidation?.source ?? "inferred",
    manifestValid: entry.manifestValidation?.valid ?? true,
    marketplaceReady:
      entry.manifestValidation?.explicit === true && entry.manifestValidation?.valid,
    manifestIssues: entry.manifestValidation?.issues ?? [],
    permissions: entry.manifest?.permissions ?? {
      consent: "explicit",
      sandbox: {
        mode: "isolated",
        filesystem: "read-only",
        network: "off",
      },
    },
    outputs: entry.manifest?.outputs,
    compat: entry.manifest?.compat,
    subscription: entry.manifest?.subscription,
  };
}

export function buildWorkspaceSkillStatus(
  workspaceDir: string,
  opts?: {
    config?: AlisioConfig;
    managedSkillsDir?: string;
    entries?: SkillEntry[];
    eligibility?: SkillEligibilityContext;
  },
): SkillStatusReport {
  const managedSkillsDir = opts?.managedSkillsDir ?? path.join(CONFIG_DIR, "skills");
  const bundledContext = resolveBundledSkillsContext();
  const skillEntries =
    opts?.entries ??
    loadWorkspaceSkillEntries(workspaceDir, {
      config: opts?.config,
      managedSkillsDir,
      bundledSkillsDir: bundledContext.dir,
    });
  const prefs = resolveSkillsInstallPreferences(opts?.config);
  return {
    workspaceDir,
    managedSkillsDir,
    skills: skillEntries.map((entry) =>
      buildSkillStatus(entry, opts?.config, prefs, opts?.eligibility, bundledContext.names),
    ),
  };
}

function isInstalledMarketplaceSource(source: string): boolean {
  return (
    source === "openclaw-workspace" ||
    source === "agents-skills-project" ||
    source === "agents-skills-personal" ||
    source === "openclaw-managed" ||
    source === "alisio-mcp"
  );
}

function isPathWithin(parentDir: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(targetPath));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveMarketplaceInstallState(params: {
  entry: SkillStatusEntry;
  workspaceDir: string;
  managedSkillsDir: string;
  catalog: ResolvedSkillCatalogEntry;
}): Pick<SkillStatusEntry, "installed" | "installable" | "removable" | "executable"> {
  const installed = isInstalledMarketplaceSource(params.entry.source);
  const removable =
    params.catalog.kind === "local-skill" &&
    Boolean(params.entry.baseDir) &&
    (isPathWithin(path.join(path.resolve(params.workspaceDir), "skills"), params.entry.baseDir) ||
      isPathWithin(params.managedSkillsDir, params.entry.baseDir));
  return {
    installed,
    installable:
      params.catalog.kind === "local-skill" &&
      !installed &&
      params.catalog.marketplaceReady &&
      params.catalog.access.allowed,
    removable,
    executable: params.catalog.marketplaceReady && params.catalog.access.allowed,
  };
}

function createSyntheticMarketplaceStatusEntry(params: {
  catalog: ResolvedSkillCatalogEntry;
  config?: AlisioConfig;
  eligibility?: SkillEligibilityContext;
  workspaceDir: string;
  managedSkillsDir: string;
}): SkillStatusEntry {
  const requiredMetadata = {
    requires: params.catalog.compat.requires,
    os: params.catalog.compat.os,
  };
  const required = evaluateRequirementsFromMetadataWithRemote({
    always: false,
    metadata: requiredMetadata,
    hasLocalBin: hasBinary,
    localPlatform: process.platform,
    remote: params.eligibility?.remote,
    isEnvSatisfied: (envName) => Boolean(process.env[envName]),
    isConfigSatisfied: (pathStr) => isConfigPathTruthy(params.config, pathStr),
  });
  const installed = params.catalog.kind === "mcp-server";
  const eligible =
    installed &&
    required.eligible &&
    params.catalog.marketplaceReady &&
    params.catalog.access.allowed;
  return {
    kind: params.catalog.kind,
    name: params.catalog.name,
    description: params.catalog.description,
    source: params.catalog.source,
    bundled: false,
    filePath: params.catalog.filePath ?? `mcp:${params.catalog.name}`,
    baseDir: params.catalog.baseDir ?? "",
    skillKey: params.catalog.name,
    primaryEnv: params.catalog.manifest.primaryEnv,
    emoji: params.catalog.manifest.emoji,
    homepage: params.catalog.manifest.homepage,
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible,
    requirements: required.required,
    missing: required.missing,
    configChecks: required.configChecks,
    install: [],
    manifestVersion: params.catalog.version,
    manifestSource: params.catalog.manifestSource,
    manifestValid: params.catalog.manifestValid,
    marketplaceReady: params.catalog.marketplaceReady,
    manifestIssues: params.catalog.manifestIssues,
    permissions: params.catalog.permissions,
    outputs: params.catalog.outputs,
    compat: params.catalog.compat,
    subscription: params.catalog.subscription,
    access: params.catalog.access,
    installed,
    installable:
      params.catalog.kind === "local-skill" &&
      !installed &&
      params.catalog.marketplaceReady &&
      params.catalog.access.allowed,
    removable: false,
    executable: params.catalog.marketplaceReady && params.catalog.access.allowed,
    mcpServer: params.catalog.mcpServer,
  };
}

function groupSkillAuditEntries(entries: SkillAuditEntry[]): Map<string, SkillAuditEntry[]> {
  const grouped = new Map<string, SkillAuditEntry[]>();
  for (const entry of entries) {
    const next = grouped.get(entry.skillName) ?? [];
    next.push(entry);
    grouped.set(entry.skillName, next);
  }
  return grouped;
}

function groupSkillConsentGrants(grants: SkillConsentGrant[]): Map<string, SkillConsentGrant[]> {
  const grouped = new Map<string, SkillConsentGrant[]>();
  for (const grant of grants) {
    const next = grouped.get(grant.skillName) ?? [];
    next.push(grant);
    grouped.set(grant.skillName, next);
  }
  return grouped;
}

export async function resolveWorkspaceMarketplaceCatalogStatus(
  workspaceDir: string,
  opts?: {
    config?: AlisioConfig;
    managedSkillsDir?: string;
    entries?: SkillEntry[];
    eligibility?: SkillEligibilityContext;
    access?: SkillMarketplaceAccessContext;
  },
): Promise<SkillStatusEntry[]> {
  const localReport = buildWorkspaceSkillStatus(workspaceDir, opts);
  const catalog = await resolveSkillMarketplaceCatalog({
    workspaceDir,
    config: opts?.config,
    entries: opts?.entries,
    access: opts?.access,
  });
  const auditEntries = await listSkillAuditEntries({
    workspaceDir,
    limit: 200,
  });
  const grants = await listSkillConsentGrants({ workspaceDir });
  const auditBySkill = groupSkillAuditEntries(auditEntries);
  const grantsBySkill = groupSkillConsentGrants(grants);
  const localByName = new Map(localReport.skills.map((entry) => [entry.name, entry] as const));
  const managedSkillsDir = path.resolve(opts?.managedSkillsDir ?? path.join(CONFIG_DIR, "skills"));

  return catalog.map((catalogEntry) => {
    const local = localByName.get(catalogEntry.name);
    const next: SkillStatusEntry = (() => {
      if (!local) {
        return createSyntheticMarketplaceStatusEntry({
          catalog: catalogEntry,
          config: opts?.config,
          eligibility: opts?.eligibility,
          workspaceDir,
          managedSkillsDir,
        });
      }

      const localEntry: SkillStatusEntry = local;
      const installState = resolveMarketplaceInstallState({
        entry: localEntry,
        workspaceDir,
        managedSkillsDir,
        catalog: catalogEntry,
      });
      const readyForUse =
        installState.installed === true &&
        localEntry.eligible &&
        catalogEntry.marketplaceReady &&
        catalogEntry.access.allowed;

      return {
        ...localEntry,
        kind: catalogEntry.kind,
        manifestVersion: catalogEntry.version,
        manifestSource: catalogEntry.manifestSource,
        manifestValid: catalogEntry.manifestValid,
        marketplaceReady: catalogEntry.marketplaceReady,
        manifestIssues: catalogEntry.manifestIssues,
        permissions: catalogEntry.permissions,
        outputs: catalogEntry.outputs,
        compat: catalogEntry.compat,
        subscription: catalogEntry.subscription,
        access: catalogEntry.access,
        mcpServer: catalogEntry.mcpServer,
        eligible: readyForUse,
        ...installState,
      };
    })();

    return {
      ...next,
      recentAudit: auditBySkill.get(catalogEntry.name) ?? [],
      consentGrants: grantsBySkill.get(catalogEntry.name) ?? [],
    };
  });
}
