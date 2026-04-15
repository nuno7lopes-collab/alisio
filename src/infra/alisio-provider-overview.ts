import {
  ensureAuthProfileStore,
  listProfilesForProvider,
  type AuthProfileStore,
} from "../agents/auth-profiles.js";
import { resolveProviderAuthOverview } from "../commands/models/list.auth-overview.js";
import { readConfigFileSnapshot, type AlisioConfig } from "../config/config.js";
import { NodeRegistry } from "../gateway/node-registry.js";
import { listRegisteredMemoryEmbeddingProviders } from "../plugins/memory-embedding-providers.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { getActivePluginRegistry } from "../plugins/runtime.js";
import {
  resolveAlisioConnectorUiStatus,
  type AlisioConnectorUiStatus,
} from "../shared/alisio-connector-status.js";
import { isAlisioManagedProvider } from "../shared/alisio-dynamic-provider.js";
import type { AlisioAiState } from "./alisio-ai-state.js";
import {
  loadAlisioModelProviderSnapshot,
  type AlisioModelProviderSnapshot,
} from "./alisio-model-snapshot.js";
import {
  getAlisioAccountState,
  getAlisioAiState,
  listAlisioConnectorAuthorizations,
  listAlisioConnectorDefinitions,
  type AlisioAccountState,
  type AlisioConnectorAuthorization,
  type AlisioConnectorDefinition,
} from "./alisio-store.js";
import { loadProviderUsageSummary } from "./provider-usage.js";
import { withTimeout } from "./provider-usage.shared.js";
import type { ProviderUsageSnapshot, UsageSummary } from "./provider-usage.types.js";

export type AlisioProviderOverviewStatus =
  | "connected"
  | "ready"
  | "attention"
  | "coming_soon"
  | "unavailable";

export type AlisioProviderOverviewAuthSource =
  | "alisio-ai"
  | "profiles"
  | "env"
  | "models-json"
  | "runtime"
  | "connector"
  | "none";

export type AlisioProviderOverviewUsageWindow = {
  label: string;
  usedPercent: number;
  resetAt?: number;
};

export type AlisioProviderOverviewItem = {
  id: string;
  title: string;
  subtitle: string;
  detail?: string;
  status: AlisioProviderOverviewStatus;
  providerId?: string;
  providerLabel?: string;
  connectorId?: string;
  connectLabel?: string;
  accountLabel?: string;
  accountEmail?: string;
  docsPath?: string;
  authSource: AlisioProviderOverviewAuthSource;
  chips: string[];
  usageWindows: AlisioProviderOverviewUsageWindow[];
  current: boolean;
  active: boolean;
};

export type AlisioProviderOverviewSummary = {
  connected: number;
  ready: number;
  attention: number;
  total: number;
};

export type AlisioProviderOverviewState = {
  generatedAt: string;
  summary: AlisioProviderOverviewSummary;
  account: AlisioAccountState;
  ai: AlisioAiState;
  connectors: {
    catalog: AlisioConnectorDefinition[];
    authorizations: AlisioConnectorAuthorization[];
  };
  assistant: AlisioProviderOverviewItem[];
  providers: AlisioProviderOverviewItem[];
  runtimes: AlisioProviderOverviewItem[];
  apps: AlisioProviderOverviewItem[];
};

type ConfigSnapshotLike = Awaited<ReturnType<typeof readConfigFileSnapshot>>;

type AlisioProviderOverviewDeps = {
  readConfigFileSnapshot: typeof readConfigFileSnapshot;
  ensureAuthProfileStore: typeof ensureAuthProfileStore;
  getAlisioAccountState: typeof getAlisioAccountState;
  getAlisioAiState: typeof getAlisioAiState;
  listAlisioConnectorDefinitions: typeof listAlisioConnectorDefinitions;
  listAlisioConnectorAuthorizations: typeof listAlisioConnectorAuthorizations;
  loadAlisioModelProviderSnapshot: typeof loadAlisioModelProviderSnapshot;
  getActivePluginRegistry: typeof getActivePluginRegistry;
  listRegisteredMemoryEmbeddingProviders: typeof listRegisteredMemoryEmbeddingProviders;
  resolveProviderAuthOverview: typeof resolveProviderAuthOverview;
  loadProviderUsageSummary: typeof loadProviderUsageSummary;
};

type ProviderAggregate = {
  id: string;
  label: string;
  docsPath?: string;
  capabilities: Set<string>;
};

const DEFAULT_USAGE_TIMEOUT_MS = 1_500;
const USAGE_SUMMARY_TIMEOUT_GRACE_MS = 250;
const CONNECTOR_RUNTIME_READY_IDS = new Set([
  "gmail-modify",
  "gmail-read",
  "gmail-send",
  "google-docs",
]);

function humanizeToken(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toUniqueList(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).filter(Boolean);
}

function sortItems(items: readonly AlisioProviderOverviewItem[]): AlisioProviderOverviewItem[] {
  const order: Record<AlisioProviderOverviewStatus, number> = {
    connected: 0,
    attention: 1,
    ready: 2,
    coming_soon: 3,
    unavailable: 4,
  };
  return [...items].toSorted(
    (left, right) =>
      order[left.status] - order[right.status] ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
}

function buildSummary(sections: {
  assistant: readonly AlisioProviderOverviewItem[];
  providers: readonly AlisioProviderOverviewItem[];
  runtimes: readonly AlisioProviderOverviewItem[];
  apps: readonly AlisioProviderOverviewItem[];
}): AlisioProviderOverviewSummary {
  const items = [
    ...sections.assistant,
    ...sections.providers,
    ...sections.runtimes,
    ...sections.apps,
  ];
  return {
    connected: items.filter((item) => item.status === "connected").length,
    ready: items.filter((item) => item.status === "ready").length,
    attention: items.filter((item) => item.status === "attention").length,
    total: items.length,
  };
}

function mapConnectorStatus(status: AlisioConnectorUiStatus): AlisioProviderOverviewStatus {
  switch (status) {
    case "connected":
      return "connected";
    case "needs_reconnect":
      return "attention";
    case "ready":
    case "setup_required":
      return "ready";
    case "in_review":
      return "coming_soon";
    case "unavailable":
    default:
      return "unavailable";
  }
}

function isConnectorRuntimeReady(connectorId: string): boolean {
  return CONNECTOR_RUNTIME_READY_IDS.has(connectorId);
}

function resolveConfigSnapshotConfig(snapshot: ConfigSnapshotLike): {
  cfg: AlisioConfig;
  modelsPath: string;
} {
  return {
    cfg: (snapshot.runtimeConfig ?? snapshot.config) as AlisioConfig,
    modelsPath: snapshot.path,
  };
}

function buildProviderChipList(params: {
  capabilities: Iterable<string>;
  authSource: AlisioProviderOverviewAuthSource;
  usage?: ProviderUsageSnapshot;
  profileCount: number;
}): string[] {
  const chips = [...params.capabilities];
  switch (params.authSource) {
    case "profiles":
      chips.push(params.profileCount === 1 ? "Stored profile" : `${params.profileCount} profiles`);
      break;
    case "env":
      chips.push("Environment");
      break;
    case "models-json":
      chips.push("Local config");
      break;
    default:
      break;
  }
  if (params.usage?.plan?.trim()) {
    chips.push(params.usage.plan.trim());
  }
  return toUniqueList(chips);
}

function resolveProviderAccount(params: {
  store: AuthProfileStore;
  provider: string;
  usage?: ProviderUsageSnapshot;
}): { accountLabel?: string; accountEmail?: string } {
  const usageLabel = params.usage?.accountLabel?.trim();
  const usageEmail = params.usage?.accountEmail?.trim();
  if (usageLabel || usageEmail) {
    return {
      ...(usageLabel ? { accountLabel: usageLabel } : {}),
      ...(usageEmail ? { accountEmail: usageEmail } : {}),
    };
  }

  for (const profileId of listProfilesForProvider(params.store, params.provider)) {
    const profile = params.store.profiles[profileId];
    if (!profile) {
      continue;
    }
    const displayName =
      "displayName" in profile && typeof profile.displayName === "string"
        ? profile.displayName.trim()
        : "";
    const email =
      "email" in profile && typeof profile.email === "string" ? profile.email.trim() : "";
    if (displayName || email) {
      return {
        ...(displayName ? { accountLabel: displayName } : {}),
        ...(email ? { accountEmail: email } : {}),
      };
    }
  }
  return {};
}

function resolveProviderDetail(params: {
  authSource: AlisioProviderOverviewAuthSource;
  hasAuth: boolean;
  usage?: ProviderUsageSnapshot;
  profileCount: number;
  accountLabel?: string;
  accountEmail?: string;
}): string {
  if (params.accountLabel?.trim() || params.accountEmail?.trim()) {
    return params.accountLabel?.trim() || params.accountEmail?.trim() || "";
  }
  if (params.hasAuth) {
    switch (params.authSource) {
      case "profiles":
        return params.profileCount === 1
          ? "Stored authentication is ready for runtime use."
          : "Stored provider profiles are ready for runtime use.";
      case "env":
        return "Runtime auth is currently resolved from the environment.";
      case "models-json":
        return "Runtime auth is currently resolved from local model configuration.";
      default:
        break;
    }
  }
  if (params.authSource !== "none") {
    return "Stored provider auth exists, but it needs attention before it can be used.";
  }
  if (params.usage?.error?.trim()) {
    return params.usage.error.trim();
  }
  return "No provider authentication is configured yet.";
}

function resolveProviderStatus(params: {
  authSource: AlisioProviderOverviewAuthSource;
  usage?: ProviderUsageSnapshot;
}): AlisioProviderOverviewStatus {
  if ((params.usage?.windows.length ?? 0) > 0) {
    return "connected";
  }
  if (params.authSource !== "none") {
    return "attention";
  }
  return "ready";
}

function buildAssistantItem(ai: AlisioAiState): AlisioProviderOverviewItem {
  const activeProfile = ai.profiles?.find((profile) => profile.profileId === ai.activeProfileId);
  const usageWindows = (ai.limits?.windows ?? []).map((window) => ({
    label: window.label,
    usedPercent: window.usedPercent,
    ...(typeof window.resetAt === "number" ? { resetAt: window.resetAt } : {}),
  }));
  const chips = toUniqueList([
    "OpenAI",
    ai.planLabel?.trim() || activeProfile?.planLabel?.trim() || "",
    ai.profiles && ai.profiles.length > 1 ? `${ai.profiles.length} profiles` : "",
  ]);
  return {
    id: "alisio-ai",
    title: "Alisio AI",
    subtitle:
      ai.email?.trim() ||
      activeProfile?.email?.trim() ||
      "Primary AI account for the person agent.",
    detail:
      ai.status === "expired"
        ? "The current AI session expired and must be refreshed."
        : ai.status === "disconnected"
          ? "Connect the primary AI account used by the person agent."
          : ai.status === "connecting"
            ? "Authentication is in progress for the primary AI account."
            : "Primary AI account is ready for chat and runtime use.",
    status:
      ai.status === "expired"
        ? "attention"
        : ai.status === "connected" || ai.status === "limits_unavailable"
          ? "connected"
          : "ready",
    providerId: ai.provider,
    providerLabel: "OpenAI",
    accountLabel: activeProfile?.label?.trim() || undefined,
    accountEmail: ai.email?.trim() || activeProfile?.email?.trim() || undefined,
    authSource: "alisio-ai",
    chips,
    usageWindows,
    current: true,
    active: ai.status === "connected" || ai.status === "limits_unavailable",
  };
}

function buildRuntimeItems(snapshot: AlisioModelProviderSnapshot): AlisioProviderOverviewItem[] {
  const targetItems = snapshot.targets.map<AlisioProviderOverviewItem>((target) => {
    const modelCount = target.installedModels.length;
    const availableCount = target.availableModels.length;
    return {
      id: target.targetId,
      title: target.label,
      subtitle: target.runtimeLabel,
      detail:
        target.runtimeStatus === "error"
          ? (target.runtimeMessage ?? "Runtime needs attention.")
          : modelCount > 0
            ? `${modelCount} installed model${modelCount === 1 ? "" : "s"} ready on this runtime.`
            : availableCount > 0
              ? `${availableCount} available model${availableCount === 1 ? "" : "s"} can be installed here.`
              : (target.runtimeMessage ?? "No local models are installed on this runtime yet."),
      status:
        target.runtimeStatus === "ready"
          ? "connected"
          : target.runtimeStatus === "error"
            ? "attention"
            : "ready",
      providerId: target.chatProviderId,
      authSource: "runtime",
      chips: toUniqueList([
        target.backend,
        target.current ? "Current device" : "Linked node",
        target.access === "shared" ? "Shared" : "",
        target.platform ?? "",
      ]),
      usageWindows: [],
      current: target.current,
      active: target.runtimeStatus === "ready",
    };
  });

  return sortItems(targetItems);
}

function buildAppItems(params: {
  definitions: readonly AlisioConnectorDefinition[];
  authorizations: readonly AlisioConnectorAuthorization[];
}): AlisioProviderOverviewItem[] {
  const byConnectorId = new Map(
    params.authorizations.map((authorization) => [authorization.connectorId, authorization]),
  );
  return sortItems(
    params.definitions.map((definition) => {
      const authorization = byConnectorId.get(definition.id);
      const connectorStatus = resolveAlisioConnectorUiStatus({
        definition,
        authorization,
      });
      const runtimeReady = isConnectorRuntimeReady(definition.id);
      const status =
        definition.availability === "unavailable"
          ? "unavailable"
          : definition.availability === "in_review" || !runtimeReady
            ? "coming_soon"
            : mapConnectorStatus(connectorStatus);
      const accountLabel = authorization?.connectedAccount?.label?.trim();
      const accountEmail = authorization?.connectedAccount?.email?.trim();
      return {
        id: `connector:${definition.id}`,
        title: definition.title,
        subtitle: definition.summary,
        detail: definition.detail?.trim() || undefined,
        status,
        connectorId: definition.id,
        connectLabel: definition.connectLabel,
        providerLabel: definition.providerLabel,
        accountLabel: accountLabel || undefined,
        accountEmail: accountEmail || undefined,
        docsPath: definition.setupUrl,
        authSource: "connector",
        chips: toUniqueList([definition.providerLabel, humanizeToken(definition.category)]),
        usageWindows: [],
        current: false,
        active: runtimeReady && connectorStatus === "connected",
      };
    }),
  );
}

function upsertProviderAggregate(
  map: Map<string, ProviderAggregate>,
  params: {
    id: string;
    label?: string;
    docsPath?: string;
    capabilities?: string[];
  },
): ProviderAggregate | null {
  const id = params.id.trim();
  if (!id || isAlisioManagedProvider(id)) {
    return null;
  }
  let existing = map.get(id);
  if (!existing) {
    existing = {
      id,
      label: params.label?.trim() || humanizeToken(id),
      ...(params.docsPath?.trim() ? { docsPath: params.docsPath.trim() } : {}),
      capabilities: new Set(params.capabilities ?? []),
    };
    map.set(id, existing);
    return existing;
  }
  if (
    params.label?.trim() &&
    (existing.label === humanizeToken(existing.id) ||
      existing.label.length < params.label.trim().length)
  ) {
    existing.label = params.label.trim();
  }
  if (params.docsPath?.trim() && !existing.docsPath) {
    existing.docsPath = params.docsPath.trim();
  }
  for (const capability of params.capabilities ?? []) {
    if (capability.trim()) {
      existing.capabilities.add(capability.trim());
    }
  }
  return existing;
}

function collectProviderAggregates(params: {
  cfg: AlisioConfig;
  store: AuthProfileStore;
  registry: PluginRegistry | null;
  usage: UsageSummary | null;
  snapshot: AlisioModelProviderSnapshot;
  memoryEmbeddingProviders: ReturnType<typeof listRegisteredMemoryEmbeddingProviders>;
}): Map<string, ProviderAggregate> {
  const providers = new Map<string, ProviderAggregate>();

  for (const entry of params.registry?.providers ?? []) {
    upsertProviderAggregate(providers, {
      id: entry.provider.id,
      label: entry.provider.label,
      docsPath: entry.provider.docsPath,
      capabilities: ["Text"],
    });
  }

  for (const providerId of Object.keys(params.cfg.models?.providers ?? {})) {
    upsertProviderAggregate(providers, {
      id: providerId,
      capabilities: ["Text"],
    });
  }

  for (const credential of Object.values(params.store.profiles)) {
    upsertProviderAggregate(providers, {
      id: credential.provider,
      capabilities: ["Text"],
    });
  }

  for (const usage of params.usage?.providers ?? []) {
    upsertProviderAggregate(providers, {
      id: usage.provider,
      label: usage.displayName,
      capabilities: ["Text"],
    });
  }

  for (const entry of params.snapshot.dynamicCatalogEntries) {
    upsertProviderAggregate(providers, {
      id: entry.provider,
      capabilities: ["Text"],
    });
  }

  for (const entry of params.registry?.speechProviders ?? []) {
    upsertProviderAggregate(providers, {
      id: entry.provider.id,
      label: entry.provider.label,
      capabilities: ["Speech"],
    });
  }

  for (const entry of params.registry?.imageGenerationProviders ?? []) {
    upsertProviderAggregate(providers, {
      id: entry.provider.id,
      label: entry.provider.label,
      capabilities: ["Image"],
    });
  }

  for (const entry of params.registry?.mediaUnderstandingProviders ?? []) {
    upsertProviderAggregate(providers, {
      id: entry.provider.id,
      capabilities: ["Media"],
    });
  }

  for (const entry of params.registry?.webSearchProviders ?? []) {
    upsertProviderAggregate(providers, {
      id: entry.provider.id,
      label: entry.provider.label,
      capabilities: ["Search"],
    });
  }

  for (const entry of params.memoryEmbeddingProviders) {
    upsertProviderAggregate(providers, {
      id: entry.adapter.id,
      capabilities: ["Memory"],
    });
  }

  return providers;
}

async function buildProviderItems(params: {
  cfg: AlisioConfig;
  modelsPath: string;
  store: AuthProfileStore;
  providerAggregates: Map<string, ProviderAggregate>;
  usage: UsageSummary | null;
  deps: AlisioProviderOverviewDeps;
}): Promise<AlisioProviderOverviewItem[]> {
  const usageByProvider = new Map<string, ProviderUsageSnapshot>(
    (params.usage?.providers ?? []).map((entry) => [entry.provider, entry]),
  );
  const entries = await Promise.all(
    [...params.providerAggregates.values()].map(async (provider) => {
      const overview = params.deps.resolveProviderAuthOverview({
        provider: provider.id,
        cfg: params.cfg,
        store: params.store,
        modelsPath: params.modelsPath,
      });
      const hasConfiguredAuth = overview.effective.kind !== "missing";
      const authSource: AlisioProviderOverviewAuthSource =
        overview.effective.kind === "profiles"
          ? "profiles"
          : overview.effective.kind === "env"
            ? "env"
            : overview.effective.kind === "models.json"
              ? "models-json"
              : "none";
      const usage = usageByProvider.get(provider.id);
      const account = resolveProviderAccount({
        store: params.store,
        provider: provider.id,
        usage,
      });
      return {
        id: provider.id,
        title: provider.label,
        subtitle:
          toUniqueList(provider.capabilities).join(" · ") || "Model provider available in runtime.",
        detail: resolveProviderDetail({
          authSource,
          hasAuth: hasConfiguredAuth,
          usage,
          profileCount: overview.profiles.count,
          accountLabel: account.accountLabel,
          accountEmail: account.accountEmail,
        }),
        status: resolveProviderStatus({
          authSource,
          usage,
        }),
        providerId: provider.id,
        providerLabel: provider.label,
        accountLabel: account.accountLabel,
        accountEmail: account.accountEmail,
        docsPath: provider.docsPath,
        authSource,
        chips: buildProviderChipList({
          capabilities: provider.capabilities,
          authSource,
          usage,
          profileCount: overview.profiles.count,
        }),
        usageWindows: (usage?.windows ?? []).map((window) => ({
          label: window.label,
          usedPercent: window.usedPercent,
          ...(typeof window.resetAt === "number" ? { resetAt: window.resetAt } : {}),
        })),
        current: false,
        active: hasConfiguredAuth || (usage?.windows.length ?? 0) > 0,
      } satisfies AlisioProviderOverviewItem;
    }),
  );
  return sortItems(entries);
}

function buildEmptyModelSnapshot(): AlisioModelProviderSnapshot {
  return {
    catalog: [],
    targets: [],
    dynamicSources: [],
    dynamicCatalogEntries: [],
  };
}

export async function loadAlisioProviderOverview(params?: {
  nodeRegistry?: NodeRegistry;
  env?: NodeJS.ProcessEnv;
  usageTimeoutMs?: number;
  includeUsage?: boolean;
  deps?: Partial<AlisioProviderOverviewDeps>;
}): Promise<AlisioProviderOverviewState> {
  const deps: AlisioProviderOverviewDeps = {
    readConfigFileSnapshot,
    ensureAuthProfileStore,
    getAlisioAccountState,
    getAlisioAiState,
    listAlisioConnectorDefinitions,
    listAlisioConnectorAuthorizations,
    loadAlisioModelProviderSnapshot,
    getActivePluginRegistry,
    listRegisteredMemoryEmbeddingProviders,
    resolveProviderAuthOverview,
    loadProviderUsageSummary,
    ...params?.deps,
  };
  const env = params?.env ?? process.env;
  const generatedAt = new Date().toISOString();
  const store = deps.ensureAuthProfileStore();
  const configSnapshot = await deps
    .readConfigFileSnapshot()
    .then(resolveConfigSnapshotConfig)
    .catch(() => ({
      cfg: {} as AlisioConfig,
      modelsPath: "models.json",
    }));
  const [account, ai, authorizations, usage] = await Promise.all([
    deps.getAlisioAccountState(env),
    deps.getAlisioAiState(env).catch(
      () =>
        ({
          provider: "openai",
          status: "disconnected",
        }) satisfies AlisioAiState,
    ),
    deps.listAlisioConnectorAuthorizations(env).catch(() => []),
    params?.includeUsage === true
      ? // Usage is additive metadata for the overview, not a hard dependency
        // for opening the Apps tab. Bound the whole summary load so a slow
        // provider never stalls the page when callers explicitly opt in.
        withTimeout(
          deps
            .loadProviderUsageSummary({
              timeoutMs: params?.usageTimeoutMs ?? DEFAULT_USAGE_TIMEOUT_MS,
              config: configSnapshot.cfg,
              env,
            })
            .catch(() => null),
          (params?.usageTimeoutMs ?? DEFAULT_USAGE_TIMEOUT_MS) + USAGE_SUMMARY_TIMEOUT_GRACE_MS,
          null,
        )
      : Promise.resolve(null),
  ]);
  const definitions = [...deps.listAlisioConnectorDefinitions()];
  const currentDevice = account.devices.find((device) => device.current) ?? account.devices[0];
  const nodeRegistry = params?.nodeRegistry ?? new NodeRegistry();
  const snapshot = await deps
    .loadAlisioModelProviderSnapshot({
      nodeRegistry,
      currentDevice: currentDevice
        ? {
            id: currentDevice.id,
            label: currentDevice.label,
            platform: currentDevice.platform,
          }
        : undefined,
      env,
    })
    .catch(() => buildEmptyModelSnapshot());

  const providerAggregates = collectProviderAggregates({
    cfg: configSnapshot.cfg,
    store,
    registry: deps.getActivePluginRegistry(),
    usage,
    snapshot,
    memoryEmbeddingProviders: deps.listRegisteredMemoryEmbeddingProviders(),
  });

  const assistant = [buildAssistantItem(ai)];
  const providers = await buildProviderItems({
    cfg: configSnapshot.cfg,
    modelsPath: configSnapshot.modelsPath,
    store,
    providerAggregates,
    usage,
    deps,
  });
  const runtimes = buildRuntimeItems(snapshot);
  const apps = buildAppItems({
    definitions,
    authorizations,
  });

  return {
    generatedAt,
    summary: buildSummary({ assistant, providers, runtimes, apps }),
    account,
    ai,
    connectors: {
      catalog: definitions,
      authorizations,
    },
    assistant,
    providers,
    runtimes,
    apps,
  };
}
