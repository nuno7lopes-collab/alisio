import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AlisioConfig } from "../../config/config.js";
import { resolveSafeInstallDir } from "../../infra/install-safe-path.js";
import { loadEmbeddedPiMcpConfig } from "../embedded-pi-mcp.js";
import {
  resolveMcpTransportConfig,
  type ResolvedMcpTransportConfig,
} from "../mcp-transport-config.js";
import { resolveMcpTransport, type ResolvedMcpTransport } from "../mcp-transport.js";
import { loadWorkspaceSkillEntries } from "../skills.js";
import {
  evaluateSkillMarketplaceAccess,
  formatSkillMarketplaceAccessError,
  resolveSkillMarketplaceAccessContext,
  type SkillMarketplaceAccess,
  type SkillMarketplaceAccessContext,
} from "./marketplace-access.js";
import type {
  SkillCompatibilitySpec,
  SkillEntry,
  SkillManifest,
  SkillManifestIssue,
  SkillOutputsSpec,
  SkillPermissionSpec,
  SkillSubscriptionSpec,
} from "./types.js";

type MarketplaceSkillKind = "local-skill" | "mcp-server";

type MarketplaceMcpTool = {
  name: string;
  title?: string;
  description?: string;
};

type MarketplaceMcpPrompt = {
  name: string;
  title?: string;
  description?: string;
};

type MarketplaceMcpResource = {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

export type MarketplaceMcpCapabilityCatalog = {
  serverName: string;
  transport: "stdio" | "sse" | "streamable-http";
  launchSummary: string;
  toolCount: number;
  promptCount: number;
  resourceCount: number;
  tools: MarketplaceMcpTool[];
  prompts: MarketplaceMcpPrompt[];
  resources: MarketplaceMcpResource[];
};

export type SkillCatalogEntry = {
  kind: MarketplaceSkillKind;
  name: string;
  description: string;
  source: string;
  version?: string;
  manifest: SkillManifest;
  outputs: SkillOutputsSpec;
  compat: SkillCompatibilitySpec;
  marketplaceReady: boolean;
  manifestSource: "manifest" | "legacy-metadata" | "inferred";
  manifestValid: boolean;
  manifestIssues: SkillManifestIssue[];
  permissions: SkillPermissionSpec;
  subscription?: SkillSubscriptionSpec;
  filePath?: string;
  baseDir?: string;
  generatedInstructions?: string;
  mcpServer?: {
    serverName: string;
    transport: "stdio" | "sse" | "streamable-http";
    launchSummary: string;
  };
};

export type ResolvedSkillCatalogEntry = SkillCatalogEntry & {
  access: SkillMarketplaceAccess;
};

export type MarketplaceSkillInstallResult =
  | {
      ok: true;
      skill: SkillCatalogEntry;
      targetDir: string;
      access: SkillMarketplaceAccess;
    }
  | {
      ok: false;
      error: string;
    };

export type MarketplaceSkillRemoveResult =
  | {
      ok: true;
      skill: SkillCatalogEntry;
      removedDir: string;
      access: SkillMarketplaceAccess;
    }
  | {
      ok: false;
      error: string;
    };

export type MarketplaceSkillExecutionResult =
  | {
      ok: true;
      skill: SkillCatalogEntry;
      instructions: string;
      sandbox: SkillPermissionSpec["sandbox"];
      access: SkillMarketplaceAccess;
      mcp?: MarketplaceMcpCapabilityCatalog;
    }
  | {
      ok: false;
      error: string;
    };

type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
type ListedPrompt = Awaited<ReturnType<Client["listPrompts"]>>["prompts"][number];
type ListedResource = Awaited<ReturnType<Client["listResources"]>>["resources"][number];

function defaultPermissions(): SkillPermissionSpec {
  return {
    consent: "explicit",
    sandbox: {
      mode: "isolated",
      filesystem: "read-only",
      network: "off",
    },
  };
}

function createFallbackManifest(entry: Pick<SkillEntry, "skill" | "metadata">): SkillManifest {
  return {
    schemaVersion: 1,
    name: entry.skill.name,
    version: "0.0.0",
    description: entry.skill.description,
    always: entry.metadata?.always,
    skillKey: entry.metadata?.skillKey,
    primaryEnv: entry.metadata?.primaryEnv,
    emoji: entry.metadata?.emoji,
    homepage: entry.metadata?.homepage,
    install: entry.metadata?.install,
    permissions: defaultPermissions(),
    outputs: {
      primary: "instructions",
      formats: ["text/markdown"],
    },
    compat: {
      os: entry.metadata?.os,
      requires: entry.metadata?.requires,
    },
  };
}

function toCatalogEntry(entry: SkillEntry): SkillCatalogEntry {
  const manifest = entry.manifest ?? createFallbackManifest(entry);
  return {
    kind: "local-skill",
    name: entry.skill.name,
    description: entry.skill.description,
    source: typeof entry.skill.source === "string" ? entry.skill.source : "unknown",
    version: manifest.version,
    manifest,
    outputs: manifest.outputs,
    compat: manifest.compat,
    marketplaceReady:
      entry.manifestValidation?.explicit === true && entry.manifestValidation?.valid === true,
    manifestSource: entry.manifestValidation?.source ?? "inferred",
    manifestValid: entry.manifestValidation?.valid ?? true,
    manifestIssues: entry.manifestValidation?.issues ?? [],
    permissions: manifest.permissions,
    subscription: manifest.subscription,
    filePath: entry.skill.filePath,
    baseDir: entry.skill.baseDir,
  };
}

function resolveEntries(params: {
  workspaceDir: string;
  config?: AlisioConfig;
  entries?: SkillEntry[];
}): SkillEntry[] {
  return (
    params.entries ??
    loadWorkspaceSkillEntries(params.workspaceDir, {
      config: params.config,
    })
  );
}

function findEntry(entries: SkillEntry[], skillName: string): SkillEntry | undefined {
  return entries.find((entry) => entry.skill.name === skillName);
}

function findCatalogEntry(
  catalog: SkillCatalogEntry[],
  skillName: string,
): SkillCatalogEntry | undefined {
  return catalog.find((entry) => entry.name === skillName);
}

function isPathWithin(parentDir: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(targetPath));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function describeManifestIssues(issues: SkillManifestIssue[]): string {
  return issues
    .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
    .join("; ");
}

function summarizePermissions(permissions: SkillPermissionSpec): string {
  const parts: string[] = [];
  const execBins = permissions.exec?.bins ?? [];
  const fileWrites = permissions.files?.write ?? [];
  if (execBins.length > 0) {
    parts.push(`exec=${execBins.join(",")}`);
  }
  if (permissions.network?.outbound === true) {
    const hosts = permissions.network.hosts?.length
      ? `:${permissions.network.hosts.join(",")}`
      : "";
    parts.push(`network=outbound${hosts}`);
  }
  if (fileWrites.length > 0) {
    parts.push(`write=${fileWrites.join(",")}`);
  }
  if (permissions.mcp?.consume === true) {
    parts.push("mcp=consume");
  }
  return parts.join(" ");
}

function listUniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  );
}

function buildMcpServerManifest(params: {
  skillName: string;
  serverName: string;
  resolved: ResolvedMcpTransportConfig;
}): SkillManifest {
  const execBins =
    params.resolved.kind === "stdio"
      ? listUniqueStrings([path.basename(params.resolved.command)])
      : [];
  const hosts =
    params.resolved.kind === "http" ? listUniqueStrings([new URL(params.resolved.url).host]) : [];

  return {
    schemaVersion: 1,
    name: params.skillName,
    version: "1.0.0",
    description: `Consume the MCP server "${params.serverName}" as a marketplace skill.`,
    permissions: {
      consent: "explicit",
      sandbox: {
        mode: "isolated",
        filesystem: "read-only",
        network: "off",
      },
      ...(execBins.length > 0 ? { exec: { bins: execBins } } : {}),
      ...(hosts.length > 0 ? { network: { outbound: true, hosts } } : {}),
      mcp: {
        consume: true,
        exposeTools: true,
        exposePrompts: true,
        exposeResources: true,
      },
    },
    outputs: {
      primary: "tool",
      formats: ["application/json", "text/markdown"],
    },
    compat: {
      runtimes: ["mcp-client"],
      ...(execBins.length > 0 ? { requires: { bins: execBins } } : {}),
      mcp: {
        transports: [params.resolved.transportType],
        capabilities: ["tools", "prompts", "resources"],
      },
    },
    subscription: {
      required: false,
      plan: "local",
    },
  };
}

function buildStaticMcpServerInstructions(entry: SkillCatalogEntry): string {
  const serverInfo = entry.mcpServer;
  const lines = [`# ${entry.name}`, ""];
  if (!serverInfo) {
    lines.push(entry.description);
    return lines.join("\n");
  }
  lines.push(entry.description);
  lines.push("");
  lines.push(`Server: ${serverInfo.serverName}`);
  lines.push(`Transport: ${serverInfo.transport}`);
  lines.push(`Launch: ${serverInfo.launchSummary}`);
  lines.push("Consent: explicit");
  lines.push("Declared MCP surfaces: tools, prompts, resources");
  return lines.join("\n");
}

function buildMcpServerCatalogEntries(params: {
  workspaceDir: string;
  config?: AlisioConfig;
}): SkillCatalogEntry[] {
  const loaded = loadEmbeddedPiMcpConfig({
    workspaceDir: params.workspaceDir,
    cfg: params.config,
  });

  return Object.entries(loaded.mcpServers)
    .flatMap(([serverName, rawServer]) => {
      const resolved = resolveMcpTransportConfig(serverName, rawServer);
      if (!resolved) {
        return [];
      }

      const skillName = `mcp:${serverName}`;
      const manifest = buildMcpServerManifest({
        skillName,
        serverName,
        resolved,
      });
      const entry: SkillCatalogEntry = {
        kind: "mcp-server",
        name: skillName,
        description: manifest.description ?? `Consume the MCP server "${serverName}".`,
        source: "alisio-mcp",
        version: manifest.version,
        manifest,
        outputs: manifest.outputs,
        compat: manifest.compat,
        marketplaceReady: true,
        manifestSource: "manifest",
        manifestValid: true,
        manifestIssues: [],
        permissions: manifest.permissions,
        subscription: manifest.subscription,
        generatedInstructions: "",
        mcpServer: {
          serverName,
          transport: resolved.transportType,
          launchSummary: resolved.description,
        },
      };
      entry.generatedInstructions = buildStaticMcpServerInstructions(entry);
      return [entry];
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

export async function readMarketplaceSkillInstructions(skill: SkillCatalogEntry): Promise<string> {
  if (typeof skill.generatedInstructions === "string" && skill.generatedInstructions.length > 0) {
    return skill.generatedInstructions;
  }
  if (skill.filePath) {
    return await fs.readFile(skill.filePath, "utf8");
  }
  throw new Error(`Skill "${skill.name}" does not have readable instructions.`);
}

async function connectWithTimeout(
  client: Client,
  transport: ResolvedMcpTransport["transport"],
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`MCP server connection timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    client.connect(transport).then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function listAllTools(client: Client): Promise<ListedTool[]> {
  const tools: ListedTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

async function listAllPrompts(client: Client): Promise<ListedPrompt[]> {
  const prompts: ListedPrompt[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listPrompts(cursor ? { cursor } : undefined);
    prompts.push(...page.prompts);
    cursor = page.nextCursor;
  } while (cursor);
  return prompts;
}

async function listAllResources(client: Client): Promise<ListedResource[]> {
  const resources: ListedResource[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listResources(cursor ? { cursor } : undefined);
    resources.push(...page.resources);
    cursor = page.nextCursor;
  } while (cursor);
  return resources;
}

async function disposeMcpClient(params: {
  client: Client;
  transport: ResolvedMcpTransport["transport"];
  transportType: "stdio" | "sse" | "streamable-http";
  detachStderr?: () => void;
}) {
  params.detachStderr?.();
  if (params.transportType === "streamable-http") {
    await (params.transport as StreamableHTTPClientTransport)
      .terminateSession()
      .catch(() => undefined);
  }
  await params.client.close().catch(() => undefined);
  await params.transport.close().catch(() => undefined);
}

function formatNamedCapabilityList<T extends { name: string; description?: string }>(
  label: string,
  items: T[],
): string[] {
  const lines = [`${label} (${items.length}):`];
  if (items.length === 0) {
    lines.push("- none");
    return lines;
  }
  for (const item of items.slice(0, 25)) {
    lines.push(item.description ? `- ${item.name}: ${item.description}` : `- ${item.name}`);
  }
  if (items.length > 25) {
    lines.push(`- ... and ${items.length - 25} more`);
  }
  return lines;
}

function formatResourceCapabilityList(resources: MarketplaceMcpResource[]): string[] {
  const lines = [`Resources (${resources.length}):`];
  if (resources.length === 0) {
    lines.push("- none");
    return lines;
  }
  for (const resource of resources.slice(0, 25)) {
    const title = resource.title ?? resource.name ?? resource.uri;
    lines.push(resource.description ? `- ${title}: ${resource.description}` : `- ${title}`);
  }
  if (resources.length > 25) {
    lines.push(`- ... and ${resources.length - 25} more`);
  }
  return lines;
}

function buildDynamicMcpServerInstructions(params: {
  skill: SkillCatalogEntry;
  catalog: MarketplaceMcpCapabilityCatalog;
}): string {
  const lines = [buildStaticMcpServerInstructions(params.skill), ""];
  lines.push(...formatNamedCapabilityList("Tools", params.catalog.tools));
  lines.push("");
  lines.push(...formatNamedCapabilityList("Prompts", params.catalog.prompts));
  lines.push("");
  lines.push(...formatResourceCapabilityList(params.catalog.resources));
  return lines.join("\n");
}

async function executeMcpServerSkill(params: {
  skill: SkillCatalogEntry;
  workspaceDir: string;
  config?: AlisioConfig;
  access: SkillMarketplaceAccess;
}): Promise<MarketplaceSkillExecutionResult> {
  const serverInfo = params.skill.mcpServer;
  if (!serverInfo) {
    return {
      ok: false,
      error: `Skill "${params.skill.name}" is missing MCP server metadata.`,
    };
  }

  const loaded = loadEmbeddedPiMcpConfig({
    workspaceDir: params.workspaceDir,
    cfg: params.config,
  });
  const rawServer = loaded.mcpServers[serverInfo.serverName];
  if (!rawServer) {
    return {
      ok: false,
      error: `Configured MCP server "${serverInfo.serverName}" was not found.`,
    };
  }

  const resolved = resolveMcpTransport(serverInfo.serverName, rawServer);
  if (!resolved) {
    return {
      ok: false,
      error: `MCP server "${serverInfo.serverName}" is not using a supported local transport.`,
    };
  }

  const client = new Client({
    name: "alisio-skills-marketplace",
    version: "1.0.0",
  });

  try {
    await connectWithTimeout(client, resolved.transport, resolved.connectionTimeoutMs);
    const [tools, prompts, resources] = await Promise.all([
      listAllTools(client),
      listAllPrompts(client),
      listAllResources(client),
    ]);
    const capabilityCatalog: MarketplaceMcpCapabilityCatalog = {
      serverName: serverInfo.serverName,
      transport: resolved.transportType,
      launchSummary: resolved.description,
      toolCount: tools.length,
      promptCount: prompts.length,
      resourceCount: resources.length,
      tools: tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description?.trim() || undefined,
      })),
      prompts: prompts.map((prompt) => ({
        name: prompt.name,
        title: prompt.title,
        description: prompt.description?.trim() || undefined,
      })),
      resources: resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        title: resource.title,
        description: resource.description?.trim() || undefined,
        mimeType: resource.mimeType,
      })),
    };

    return {
      ok: true,
      skill: params.skill,
      instructions: buildDynamicMcpServerInstructions({
        skill: params.skill,
        catalog: capabilityCatalog,
      }),
      sandbox: params.skill.permissions.sandbox,
      access: params.access,
      mcp: capabilityCatalog,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to connect to MCP server "${serverInfo.serverName}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  } finally {
    await disposeMcpClient({
      client,
      transport: resolved.transport,
      transportType: resolved.transportType,
      detachStderr: resolved.detachStderr,
    });
  }
}

export function buildSkillMarketplaceCatalog(params: {
  workspaceDir: string;
  config?: AlisioConfig;
  entries?: SkillEntry[];
}): SkillCatalogEntry[] {
  const entries = resolveEntries(params);
  return [
    ...entries.map((entry) => toCatalogEntry(entry)),
    ...buildMcpServerCatalogEntries(params),
  ].toSorted((left, right) => left.name.localeCompare(right.name));
}

export async function resolveSkillMarketplaceCatalog(params: {
  workspaceDir: string;
  config?: AlisioConfig;
  entries?: SkillEntry[];
  access?: SkillMarketplaceAccessContext;
}): Promise<ResolvedSkillCatalogEntry[]> {
  const catalog = buildSkillMarketplaceCatalog(params);
  const accessContext = await resolveSkillMarketplaceAccessContext(params.access);
  return catalog.map((skill) => ({
    ...skill,
    access: evaluateSkillMarketplaceAccess({
      subscription: skill.subscription,
      currentPlan: accessContext.currentPlan,
      enabledFeatureFlags: accessContext.enabledFeatureFlags,
    }),
  }));
}

export async function installMarketplaceSkill(params: {
  catalogWorkspaceDir: string;
  targetWorkspaceDir: string;
  skillName: string;
  config?: AlisioConfig;
  entries?: SkillEntry[];
  force?: boolean;
  access?: SkillMarketplaceAccessContext;
}): Promise<MarketplaceSkillInstallResult> {
  const entries = resolveEntries({
    workspaceDir: params.catalogWorkspaceDir,
    config: params.config,
    entries: params.entries,
  });
  const catalog = buildSkillMarketplaceCatalog({
    workspaceDir: params.catalogWorkspaceDir,
    config: params.config,
    entries,
  });
  const catalogEntry = findCatalogEntry(catalog, params.skillName);
  if (!catalogEntry) {
    return { ok: false, error: `Skill not found: ${params.skillName}` };
  }
  if (catalogEntry.kind !== "local-skill") {
    return {
      ok: false,
      error: `Virtual MCP skill "${params.skillName}" cannot be installed into a workspace.`,
    };
  }
  const accessContext = await resolveSkillMarketplaceAccessContext(params.access);
  const access = evaluateSkillMarketplaceAccess({
    subscription: catalogEntry.subscription,
    currentPlan: accessContext.currentPlan,
    enabledFeatureFlags: accessContext.enabledFeatureFlags,
  });
  if (!access.allowed) {
    return {
      ok: false,
      error: formatSkillMarketplaceAccessError(params.skillName, access),
    };
  }
  if (!catalogEntry.marketplaceReady) {
    const issueDetails = describeManifestIssues(catalogEntry.manifestIssues);
    return {
      ok: false,
      error: issueDetails
        ? `Skill "${params.skillName}" is not marketplace-ready: ${issueDetails}`
        : `Skill "${params.skillName}" is not marketplace-ready.`,
    };
  }

  const entry = findEntry(entries, params.skillName);
  if (!entry) {
    return { ok: false, error: `Skill not found: ${params.skillName}` };
  }

  const skillsDir = path.join(path.resolve(params.targetWorkspaceDir), "skills");
  await fs.mkdir(skillsDir, { recursive: true });
  const safeTarget = resolveSafeInstallDir({
    baseDir: skillsDir,
    id: params.skillName,
    invalidNameMessage: "invalid marketplace install target",
  });
  if (!safeTarget.ok) {
    return { ok: false, error: safeTarget.error };
  }
  const targetDir = safeTarget.path;
  if (params.force) {
    await fs.rm(targetDir, { recursive: true, force: true });
  } else {
    try {
      await fs.access(targetDir);
      return {
        ok: false,
        error: `Skill already installed at ${targetDir}. Re-run with force to replace it.`,
      };
    } catch {
      // missing target is expected
    }
  }
  await fs.cp(entry.skill.baseDir, targetDir, {
    recursive: true,
    force: true,
  });
  return {
    ok: true,
    skill: catalogEntry,
    targetDir,
    access,
  };
}

export async function removeMarketplaceSkill(params: {
  workspaceDir: string;
  managedSkillsDir?: string;
  skillName: string;
  config?: AlisioConfig;
  entries?: SkillEntry[];
  access?: SkillMarketplaceAccessContext;
}): Promise<MarketplaceSkillRemoveResult> {
  const catalog = buildSkillMarketplaceCatalog({
    workspaceDir: params.workspaceDir,
    config: params.config,
    entries: params.entries,
  });
  const catalogEntry = findCatalogEntry(catalog, params.skillName);
  if (!catalogEntry) {
    return { ok: false, error: `Skill not found: ${params.skillName}` };
  }
  if (catalogEntry.kind !== "local-skill") {
    return {
      ok: false,
      error: `Virtual MCP skill "${params.skillName}" cannot be removed from a workspace.`,
    };
  }
  if (!catalogEntry.baseDir) {
    return {
      ok: false,
      error: `Skill "${params.skillName}" does not have a removable directory.`,
    };
  }

  const accessContext = await resolveSkillMarketplaceAccessContext(params.access);

  const resolvedBaseDir = path.resolve(catalogEntry.baseDir);
  const workspaceSkillsDir = path.join(path.resolve(params.workspaceDir), "skills");
  const removableRoots = [workspaceSkillsDir];
  if (params.managedSkillsDir) {
    removableRoots.push(path.resolve(params.managedSkillsDir));
  }

  const removable = removableRoots.some((root) => isPathWithin(root, resolvedBaseDir));
  if (!removable) {
    return {
      ok: false,
      error: `Skill "${params.skillName}" is not installed in a removable marketplace location.`,
    };
  }

  await fs.rm(resolvedBaseDir, { recursive: true, force: true });
  return {
    ok: true,
    skill: catalogEntry,
    removedDir: resolvedBaseDir,
    access: {
      allowed: true,
      required: Boolean(catalogEntry.subscription?.required),
      currentPlan: accessContext.currentPlan,
      ...(catalogEntry.subscription?.plan ? { plan: catalogEntry.subscription.plan } : {}),
      ...(catalogEntry.subscription?.featureFlag
        ? { featureFlag: catalogEntry.subscription.featureFlag }
        : {}),
      enabledFeatureFlags: [...accessContext.enabledFeatureFlags].toSorted(),
      issues: [],
    },
  };
}

export async function executeMarketplaceSkill(params: {
  workspaceDir: string;
  skillName: string;
  consent?: boolean;
  config?: AlisioConfig;
  entries?: SkillEntry[];
  access?: SkillMarketplaceAccessContext;
}): Promise<MarketplaceSkillExecutionResult> {
  const entries = resolveEntries(params);
  const catalog = buildSkillMarketplaceCatalog({
    workspaceDir: params.workspaceDir,
    config: params.config,
    entries,
  });
  const catalogEntry = findCatalogEntry(catalog, params.skillName);
  if (!catalogEntry) {
    return { ok: false, error: `Skill not found: ${params.skillName}` };
  }
  if (!catalogEntry.marketplaceReady) {
    const issueDetails = describeManifestIssues(catalogEntry.manifestIssues);
    return {
      ok: false,
      error: issueDetails
        ? `Skill "${params.skillName}" is not marketplace-ready: ${issueDetails}`
        : `Skill "${params.skillName}" is not marketplace-ready.`,
    };
  }
  const accessContext = await resolveSkillMarketplaceAccessContext(params.access);
  const access = evaluateSkillMarketplaceAccess({
    subscription: catalogEntry.subscription,
    currentPlan: accessContext.currentPlan,
    enabledFeatureFlags: accessContext.enabledFeatureFlags,
  });
  if (!access.allowed) {
    return {
      ok: false,
      error: formatSkillMarketplaceAccessError(params.skillName, access),
    };
  }
  if (catalogEntry.permissions.consent === "explicit" && params.consent !== true) {
    const permissionSummary = summarizePermissions(catalogEntry.permissions);
    return {
      ok: false,
      error: permissionSummary
        ? `Explicit consent is required for "${params.skillName}" (${permissionSummary}).`
        : `Explicit consent is required for "${params.skillName}".`,
    };
  }

  if (catalogEntry.kind === "mcp-server") {
    return await executeMcpServerSkill({
      skill: catalogEntry,
      workspaceDir: params.workspaceDir,
      config: params.config,
      access,
    });
  }

  const entry = findEntry(entries, params.skillName);
  if (!entry) {
    return { ok: false, error: `Skill not found: ${params.skillName}` };
  }

  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-skill-run-"));
  try {
    const sandboxSkillDir = path.join(sandboxRoot, path.basename(entry.skill.baseDir));
    await fs.cp(entry.skill.baseDir, sandboxSkillDir, {
      recursive: true,
      force: true,
    });
    const instructions = await fs.readFile(path.join(sandboxSkillDir, "SKILL.md"), "utf8");
    return {
      ok: true,
      skill: catalogEntry,
      instructions,
      sandbox: catalogEntry.permissions.sandbox,
      access,
    };
  } finally {
    await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
