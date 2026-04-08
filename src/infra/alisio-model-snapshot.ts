import type {
  NodeRegistry,
  NodeSession,
  NodeTaskEvent,
  NodeTaskResult,
} from "../gateway/node-registry.js";
import {
  alisioRemoteModelServersUpgradeMessage,
  alisioSupportsRemoteModelServers,
} from "../shared/alisio-billing.js";
import {
  ALISIO_LOCAL_MODEL_BACKEND,
  listPublishedAlisioLocalModels,
} from "../shared/alisio-local-models.js";
import {
  buildAlisioCurrentProviderId,
  buildAlisioServerProviderId,
  buildAlisioTargetProviderId,
} from "../shared/alisio-remote-model-provider.js";
import { inspectManagedLocalModelRuntime } from "./alisio-local-llama-runtime.js";
import {
  inspectLocalModelRuntime,
  resolveLocalModelRuntimeConfig,
  type AlisioInstalledLocalModel,
} from "./alisio-local-model-runtime.js";
import {
  listAlisioDynamicCatalogEntries,
  setAlisioDynamicModelProviders,
  type AlisioDynamicCatalogEntry,
  type AlisioDynamicProviderSource,
} from "./alisio-model-providers.js";
import {
  type AlisioRemoteListedModel,
  inspectAlisioRemoteModelServer,
} from "./alisio-remote-model-provider.js";
import {
  listAlisioRemoteModelServers,
  resolveCurrentAlisioPlan,
  type AlisioRemoteModelServerKind,
} from "./alisio-store.js";
import {
  summarizeHardwareRecommendation,
  type AlisioModelHardwareProfile,
} from "./model-hardware.js";

type RuntimeKind = "llama.cpp" | "openai-compatible";
type RuntimeStatus = "ready" | "not_configured" | "error";
type PublishedCatalogEntry = Omit<
  ReturnType<typeof listPublishedAlisioLocalModels>[number],
  "sourceUri"
>;

export type AlisioModelTargetSnapshot = {
  targetId: string;
  label: string;
  platform?: string;
  current: boolean;
  connected: boolean;
  backend: typeof ALISIO_LOCAL_MODEL_BACKEND;
  runtimeKind: RuntimeKind;
  runtimeStatus: RuntimeStatus;
  runtimeMessage?: string;
  supportsInstall: boolean;
  chatProviderId?: string;
  installedModels: AlisioInstalledLocalModel[];
  hardware?: AlisioModelHardwareProfile;
  recommendations: ReturnType<typeof summarizeHardwareRecommendation>["recommendations"];
  bestModelId?: string;
  bestModelName?: string;
};

export type AlisioRemoteServerSnapshot = {
  serverId: string;
  label: string;
  kind: AlisioRemoteModelServerKind;
  baseUrl: string;
  active: boolean;
  hasApiKey: boolean;
  apiKey?: string;
  chatProviderId?: string;
  status: RuntimeStatus;
  message?: string;
  models: AlisioRemoteListedModel[];
};

export type AlisioModelProviderSnapshot = {
  catalog: PublishedCatalogEntry[];
  targets: AlisioModelTargetSnapshot[];
  servers: AlisioRemoteServerSnapshot[];
  dynamicSources: AlisioDynamicProviderSource[];
  dynamicCatalogEntries: AlisioDynamicCatalogEntry[];
};

type ConnectedTargetInspection = AlisioModelTargetSnapshot & {
  chatCapabilityId?: string;
};

type TargetRuntimeCandidate = {
  runtimeKind: RuntimeKind;
  runtimeStatus: RuntimeStatus;
  runtimeMessage?: string;
  chatCapabilityId?: string;
  installedModels: AlisioInstalledLocalModel[];
  hardware?: AlisioModelHardwareProfile;
  baseUrl?: string;
  apiKey?: string;
};

type CurrentDevice = {
  id?: string;
  label?: string;
  platform?: string;
};

type SnapshotCache = {
  snapshot: AlisioModelProviderSnapshot;
  expiresAtMs: number;
};

const publishedCatalog = listPublishedAlisioLocalModels();
const DEFAULT_CACHE_TTL_MS = 4_000;

let snapshotCache: SnapshotCache | null = null;
let pendingSnapshot: Promise<AlisioModelProviderSnapshot> | null = null;

function normalizeListedModels(
  models: ReadonlyArray<{ id?: string; name?: string; ownedBy?: string }> | undefined,
): AlisioInstalledLocalModel[] {
  const byKey = new Map<string, AlisioInstalledLocalModel>();
  for (const model of models ?? []) {
    const id = String(model?.id ?? "").trim();
    const name = String(model?.name ?? "").trim();
    if (!id || !name) {
      continue;
    }
    const key = id.toLowerCase();
    if (byKey.has(key)) {
      continue;
    }
    byKey.set(key, {
      id,
      name,
      ...(model?.ownedBy?.trim() ? { ownedBy: model.ownedBy.trim() } : {}),
    });
  }
  return [...byKey.values()].toSorted(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

function sortTargets(targets: readonly AlisioModelTargetSnapshot[]) {
  return [...targets].toSorted((left, right) => {
    if (left.current && !right.current) {
      return -1;
    }
    if (right.current && !left.current) {
      return 1;
    }
    return left.label.localeCompare(right.label) || left.targetId.localeCompare(right.targetId);
  });
}

function buildTargetRecommendations(params: { hardware?: AlisioModelHardwareProfile }) {
  if (!params.hardware) {
    return {
      recommendations: [],
      bestModelId: undefined,
      bestModelName: undefined,
    };
  }
  const summarized = summarizeHardwareRecommendation(params.hardware, publishedCatalog);
  return {
    recommendations: summarized.recommendations,
    bestModelId: summarized.bestModel?.id,
    bestModelName: summarized.bestModel?.name,
  };
}

function buildEmptyRecommendations() {
  return {
    recommendations: [],
    bestModelId: undefined,
    bestModelName: undefined,
  };
}

function rankRuntimeCandidate(candidate: TargetRuntimeCandidate | null | undefined) {
  if (!candidate) {
    return -1;
  }
  if (candidate.runtimeStatus === "ready") {
    return candidate.installedModels.length > 0 ? 4 : 3;
  }
  if (candidate.runtimeStatus === "error") {
    return 2;
  }
  return 1;
}

function choosePreferredRuntimeCandidate(
  candidates: readonly (TargetRuntimeCandidate | null | undefined)[],
): TargetRuntimeCandidate | null {
  return candidates.reduce<TargetRuntimeCandidate | null>((best, candidate) => {
    if (!candidate) {
      return best;
    }
    if (!best) {
      return candidate;
    }
    const bestRank = rankRuntimeCandidate(best);
    const candidateRank = rankRuntimeCandidate(candidate);
    if (candidateRank !== bestRank) {
      return candidateRank > bestRank ? candidate : best;
    }
    if (
      candidate.runtimeKind === ALISIO_LOCAL_MODEL_BACKEND &&
      best.runtimeKind !== ALISIO_LOCAL_MODEL_BACKEND
    ) {
      return candidate;
    }
    return best;
  }, null);
}

function hasCapability(node: NodeSession, capabilityId: string) {
  return node.capabilities.some((capability) => capability.id === capabilityId);
}

function resolveNodeTargetLabel(node: NodeSession) {
  return node.displayName ?? node.platform ?? node.nodeId;
}

function buildNodeTaskExecutor(params: {
  nodeRegistry: NodeRegistry;
  nodeId: string;
  capabilityId: string;
}) {
  return async ({
    input,
    timeoutMs,
    onEvent,
  }: {
    input: unknown;
    timeoutMs?: number;
    onEvent?: (event: NodeTaskEvent) => void;
  }) => {
    const task = params.nodeRegistry.startTask({
      nodeId: params.nodeId,
      capabilityId: params.capabilityId,
      input,
      timeoutMs,
      onEvent,
    });
    if (!task.ok) {
      return {
        ok: false,
        error: task.error,
      } satisfies NodeTaskResult;
    }
    return await task.result;
  };
}

function coerceNodeInspectionPayload(result: NodeTaskResult) {
  if (!result.ok || !result.payload || typeof result.payload !== "object") {
    return null;
  }
  return result.payload as {
    status?: RuntimeStatus;
    message?: string;
    models?: Array<{ id?: string; name?: string; ownedBy?: string }>;
    hardware?: AlisioModelHardwareProfile;
  };
}

async function inspectNodeRuntimeCandidate(params: {
  nodeRegistry: NodeRegistry;
  node: NodeSession;
  runtimeKind: RuntimeKind;
  catalogCapabilityId?: string;
  chatCapabilityId?: string;
}): Promise<TargetRuntimeCandidate | null> {
  if (!params.catalogCapabilityId) {
    return null;
  }

  const task = params.nodeRegistry.startTask({
    nodeId: params.node.nodeId,
    capabilityId: params.catalogCapabilityId,
    input: {},
    timeoutMs: 5_000,
  });
  if (!task.ok) {
    return {
      runtimeKind: params.runtimeKind,
      runtimeStatus: "error",
      runtimeMessage: task.error.message,
      installedModels: [],
      ...(params.chatCapabilityId ? { chatCapabilityId: params.chatCapabilityId } : {}),
    };
  }

  const result = await task.result.catch(
    (error) =>
      ({
        ok: false,
        error: { message: String(error) },
      }) satisfies NodeTaskResult,
  );
  const payload = coerceNodeInspectionPayload(result);
  return {
    runtimeKind: params.runtimeKind,
    runtimeStatus: payload?.status ?? "error",
    runtimeMessage:
      payload?.message ??
      result.error?.message ??
      (!result.ok ? "failed to read local model runtime" : undefined),
    installedModels: normalizeListedModels(payload?.models),
    hardware: payload?.hardware,
    ...(params.chatCapabilityId ? { chatCapabilityId: params.chatCapabilityId } : {}),
  };
}

async function inspectConnectedNodeTarget(params: {
  nodeRegistry: NodeRegistry;
  node: NodeSession;
}): Promise<ConnectedTargetInspection> {
  const { node } = params;
  const supportsInstall = hasCapability(node, "model.manage.llamacpp.v1");
  const supportsLlamaCatalog = hasCapability(node, "model.catalog.llamacpp.v1");
  const supportsLlamaChat = hasCapability(node, "model.chat.llamacpp.v1");
  const supportsOpenAiCatalog = hasCapability(node, "model.catalog.openai.v1");
  const supportsOpenAiChat = hasCapability(node, "model.chat.openai.v1");

  const [llamaCandidate, openAiCandidate] = await Promise.all([
    inspectNodeRuntimeCandidate({
      nodeRegistry: params.nodeRegistry,
      node,
      runtimeKind: ALISIO_LOCAL_MODEL_BACKEND,
      catalogCapabilityId: supportsLlamaCatalog ? "model.catalog.llamacpp.v1" : undefined,
      chatCapabilityId: supportsLlamaChat ? "model.chat.llamacpp.v1" : undefined,
    }),
    inspectNodeRuntimeCandidate({
      nodeRegistry: params.nodeRegistry,
      node,
      runtimeKind: "openai-compatible",
      catalogCapabilityId: supportsOpenAiCatalog ? "model.catalog.openai.v1" : undefined,
      chatCapabilityId: supportsOpenAiChat ? "model.chat.openai.v1" : undefined,
    }),
  ]);

  const preferred = choosePreferredRuntimeCandidate([llamaCandidate, openAiCandidate]);
  if (!preferred) {
    return {
      targetId: node.nodeId,
      label: resolveNodeTargetLabel(node),
      platform: node.platform,
      current: false,
      connected: true,
      backend: ALISIO_LOCAL_MODEL_BACKEND,
      runtimeKind: supportsInstall ? ALISIO_LOCAL_MODEL_BACKEND : "openai-compatible",
      runtimeStatus: "not_configured",
      runtimeMessage: "no model source is configured on this computer",
      supportsInstall,
      installedModels: [],
      recommendations: buildEmptyRecommendations().recommendations,
    };
  }
  const hardware = preferred.hardware ?? llamaCandidate?.hardware ?? openAiCandidate?.hardware;
  const recommendations = supportsInstall
    ? buildTargetRecommendations({ hardware })
    : buildEmptyRecommendations();

  return {
    targetId: node.nodeId,
    label: resolveNodeTargetLabel(node),
    platform: node.platform,
    current: false,
    connected: true,
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    runtimeKind: preferred.runtimeKind,
    runtimeStatus: preferred.runtimeStatus,
    runtimeMessage: preferred.runtimeMessage,
    supportsInstall,
    installedModels: preferred.installedModels,
    hardware,
    recommendations: recommendations.recommendations,
    bestModelId: recommendations.bestModelId,
    bestModelName: recommendations.bestModelName,
    ...(preferred.chatCapabilityId ? { chatCapabilityId: preferred.chatCapabilityId } : {}),
  };
}

function buildCurrentSource(params: {
  currentDevice?: CurrentDevice;
  target: AlisioModelTargetSnapshot;
  runtimeConfig: ReturnType<typeof resolveLocalModelRuntimeConfig>;
}): AlisioDynamicProviderSource | null {
  if (params.target.runtimeStatus !== "ready" || params.target.installedModels.length === 0) {
    return null;
  }
  const providerId = buildAlisioCurrentProviderId();
  if (params.target.runtimeKind === "openai-compatible") {
    if (!params.runtimeConfig.baseUrl) {
      return null;
    }
    return {
      kind: "current-openai",
      providerId,
      providerLabel: params.currentDevice?.label?.trim() || "This computer",
      targetId: params.target.targetId,
      baseUrl: params.runtimeConfig.baseUrl,
      ...(params.runtimeConfig.apiKey ? { apiKey: params.runtimeConfig.apiKey } : {}),
      catalogEntries: params.target.installedModels.map((model) => ({
        id: model.id,
        name: model.name,
        provider: providerId,
        providerLabel: params.currentDevice?.label?.trim() || "This computer",
        input: ["text"],
      })),
    };
  }
  return {
    kind: "current-llama",
    providerId,
    providerLabel: params.currentDevice?.label?.trim() || "This computer",
    targetId: params.target.targetId,
    catalogEntries: params.target.installedModels.map((model) => ({
      id: model.id,
      name: model.name,
      provider: providerId,
      providerLabel: params.currentDevice?.label?.trim() || "This computer",
      input: ["text"],
    })),
  };
}

function buildConnectedTargetSource(params: {
  nodeRegistry: NodeRegistry;
  target: ConnectedTargetInspection;
}): AlisioDynamicProviderSource | null {
  if (
    params.target.current ||
    params.target.runtimeStatus !== "ready" ||
    params.target.installedModels.length === 0 ||
    !params.target.chatCapabilityId
  ) {
    return null;
  }
  const providerId = buildAlisioTargetProviderId({
    targetId: params.target.targetId,
    runtimeKind: params.target.runtimeKind,
  });
  return {
    kind: params.target.runtimeKind === ALISIO_LOCAL_MODEL_BACKEND ? "node-llama" : "node-openai",
    providerId,
    providerLabel: params.target.label,
    targetId: params.target.targetId,
    runTask: buildNodeTaskExecutor({
      nodeRegistry: params.nodeRegistry,
      nodeId: params.target.targetId,
      capabilityId: params.target.chatCapabilityId,
    }),
    catalogEntries: params.target.installedModels.map((model) => ({
      id: model.id,
      name: model.name,
      provider: providerId,
      providerLabel: params.target.label,
      input: ["text"],
    })),
  };
}

function buildServerSource(server: AlisioRemoteServerSnapshot): AlisioDynamicProviderSource | null {
  if (!server.active || server.status !== "ready" || server.models.length === 0) {
    return null;
  }
  const providerId = buildAlisioServerProviderId(server.serverId);
  return {
    kind: server.kind === "ollama" ? "server-ollama" : "server-openai",
    providerId,
    providerLabel: server.label,
    serverId: server.serverId,
    baseUrl: server.baseUrl,
    ...(server.apiKey?.trim() ? { apiKey: server.apiKey.trim() } : {}),
    catalogEntries: server.models.map((model) => ({
      id: model.id,
      name: model.name,
      provider: providerId,
      providerLabel: server.label,
      input: ["text"],
    })),
  };
}

async function loadSnapshot(params: {
  nodeRegistry: NodeRegistry;
  currentDevice?: CurrentDevice;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AlisioModelProviderSnapshot> {
  const env = params.env ?? process.env;
  const currentPlan = await resolveCurrentAlisioPlan(env);
  const remoteModelServersAllowed = alisioSupportsRemoteModelServers(currentPlan);
  const currentRuntimeConfig = resolveLocalModelRuntimeConfig(env);
  const [currentLlamaInspection, currentOpenAiInspection] = await Promise.all([
    inspectManagedLocalModelRuntime(env),
    inspectLocalModelRuntime({
      env,
      fetchImpl: params.fetchImpl,
    }),
  ]);
  const currentLlamaCandidate: TargetRuntimeCandidate = {
    runtimeKind: ALISIO_LOCAL_MODEL_BACKEND,
    runtimeStatus: currentLlamaInspection.status,
    runtimeMessage: currentLlamaInspection.message,
    installedModels: normalizeListedModels(currentLlamaInspection.models),
    hardware: currentLlamaInspection.hardware,
  };
  const currentOpenAiCandidate = currentRuntimeConfig.baseUrl
    ? ({
        runtimeKind: "openai-compatible",
        runtimeStatus: currentOpenAiInspection.status,
        runtimeMessage: currentOpenAiInspection.message,
        installedModels: normalizeListedModels(currentOpenAiInspection.models),
        hardware: currentOpenAiInspection.hardware,
        baseUrl: currentRuntimeConfig.baseUrl,
        ...(currentRuntimeConfig.apiKey ? { apiKey: currentRuntimeConfig.apiKey } : {}),
      } satisfies TargetRuntimeCandidate)
    : null;
  const currentPreferredRuntime =
    choosePreferredRuntimeCandidate([currentLlamaCandidate, currentOpenAiCandidate]) ??
    currentLlamaCandidate;
  const currentHardware =
    currentPreferredRuntime.hardware ??
    currentLlamaCandidate.hardware ??
    currentOpenAiCandidate?.hardware;
  const currentRecommendations = buildTargetRecommendations({
    hardware: currentHardware,
  });
  const currentTargetBase: AlisioModelTargetSnapshot = {
    targetId: params.currentDevice?.id?.trim() || "current",
    label: params.currentDevice?.label?.trim() || "This computer",
    platform: params.currentDevice?.platform,
    current: true,
    connected: true,
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    runtimeKind: currentPreferredRuntime.runtimeKind,
    runtimeStatus: currentPreferredRuntime.runtimeStatus,
    runtimeMessage: currentPreferredRuntime.runtimeMessage,
    supportsInstall: true,
    installedModels: currentPreferredRuntime.installedModels,
    hardware: currentHardware,
    recommendations: currentRecommendations.recommendations,
    bestModelId: currentRecommendations.bestModelId,
    bestModelName: currentRecommendations.bestModelName,
  };
  const currentSource = buildCurrentSource({
    currentDevice: params.currentDevice,
    target: currentTargetBase,
    runtimeConfig: currentRuntimeConfig,
  });
  const currentTarget =
    currentSource && currentSource.catalogEntries.length > 0
      ? {
          ...currentTargetBase,
          chatProviderId: currentSource.providerId,
        }
      : currentTargetBase;

  const connectedTargets = await Promise.all(
    params.nodeRegistry.listConnected().map(async (node) => {
      const target = await inspectConnectedNodeTarget({
        nodeRegistry: params.nodeRegistry,
        node,
      });
      const source = buildConnectedTargetSource({
        nodeRegistry: params.nodeRegistry,
        target,
      });
      return {
        target:
          source && source.catalogEntries.length > 0
            ? {
                ...target,
                chatProviderId: source.providerId,
              }
            : target,
        source,
      };
    }),
  );

  const servers = await Promise.all(
    (await listAlisioRemoteModelServers(params.env ?? process.env)).map(async (server) => {
      if (!remoteModelServersAllowed) {
        return {
          serverId: server.serverId,
          label: server.label,
          kind: server.kind,
          baseUrl: server.baseUrl,
          active: server.active,
          hasApiKey: Boolean(server.apiKey?.trim() || server.apiKeyEncrypted),
          apiKey: server.apiKey?.trim() || undefined,
          status: "not_configured",
          message: alisioRemoteModelServersUpgradeMessage(),
          models: [],
        } satisfies AlisioRemoteServerSnapshot;
      }
      const inspection = await inspectAlisioRemoteModelServer(server, {
        fetchImpl: params.fetchImpl,
      });
      const nextServer = {
        serverId: server.serverId,
        label: server.label,
        kind: server.kind,
        baseUrl: server.baseUrl,
        active: server.active,
        hasApiKey: Boolean(server.apiKey?.trim() || server.apiKeyEncrypted),
        apiKey: server.apiKey?.trim() || undefined,
        status: inspection.status,
        message: "message" in inspection ? inspection.message : undefined,
        models: normalizeListedModels(inspection.models),
      } satisfies AlisioRemoteServerSnapshot;
      const source = buildServerSource(nextServer);
      return source && source.catalogEntries.length > 0
        ? {
            ...nextServer,
            chatProviderId: source.providerId,
          }
        : nextServer;
    }),
  );

  const dynamicSources = [
    currentSource,
    ...connectedTargets.map((entry) => entry.source),
    ...servers.map(buildServerSource),
  ].filter((source): source is AlisioDynamicProviderSource => Boolean(source));

  setAlisioDynamicModelProviders(dynamicSources);

  return {
    catalog: publishedCatalog.map(({ sourceUri: _sourceUri, ...entry }) => entry),
    targets: sortTargets([currentTarget, ...connectedTargets.map((entry) => entry.target)]),
    servers,
    dynamicSources,
    dynamicCatalogEntries: listAlisioDynamicCatalogEntries(),
  };
}

function withCurrentDevice(
  snapshot: AlisioModelProviderSnapshot,
  currentDevice?: CurrentDevice,
): AlisioModelProviderSnapshot {
  if (!currentDevice) {
    return snapshot;
  }
  const currentTarget = snapshot.targets.find((target) => target.current);
  if (!currentTarget) {
    return snapshot;
  }
  const nextTargets = snapshot.targets.map((target) =>
    !target.current
      ? target
      : {
          ...target,
          targetId: currentDevice.id?.trim() || target.targetId,
          label: currentDevice.label?.trim() || target.label,
          platform: currentDevice.platform ?? target.platform,
        },
  );
  return {
    ...snapshot,
    targets: nextTargets,
  };
}

export function clearAlisioModelProviderSnapshotCache() {
  snapshotCache = null;
  pendingSnapshot = null;
  setAlisioDynamicModelProviders([]);
}

export async function loadAlisioModelProviderSnapshot(params: {
  nodeRegistry: NodeRegistry;
  currentDevice?: CurrentDevice;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  force?: boolean;
  maxAgeMs?: number;
}): Promise<AlisioModelProviderSnapshot> {
  const maxAgeMs = params.maxAgeMs ?? DEFAULT_CACHE_TTL_MS;
  if (!params.force && snapshotCache && snapshotCache.expiresAtMs > Date.now()) {
    return withCurrentDevice(snapshotCache.snapshot, params.currentDevice);
  }
  if (!params.force && pendingSnapshot) {
    return withCurrentDevice(await pendingSnapshot, params.currentDevice);
  }

  pendingSnapshot = loadSnapshot(params);
  try {
    const snapshot = await pendingSnapshot;
    snapshotCache = {
      snapshot,
      expiresAtMs: Date.now() + maxAgeMs,
    };
    return withCurrentDevice(snapshot, params.currentDevice);
  } finally {
    pendingSnapshot = null;
  }
}
