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
  resolveConfiguredLocalRuntimeKind,
  resolveCurrentRuntimeBaseUrlForKind,
  inspectLocalModelRuntimes,
  listManagedLocalAvailableModels,
  listLmStudioAvailableModels,
  listOllamaAvailableModels,
  resolveLocalModelRuntimeConfig,
  type AlisioAvailableLocalModel,
  type AlisioInstalledLocalModel,
  type AlisioLocalRuntimeKind,
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
  getAlisioSharingTargetAccessIndex,
  listAlisioRemoteModelServers,
  resolveCurrentAlisioPlan,
  type AlisioSharingRuntimeTarget,
  type AlisioRemoteModelServerKind,
} from "./alisio-store.js";
import {
  buildRuntimeCapabilities,
  type RuntimeCapabilities,
} from "./local-model-runtime-contracts.js";
import {
  summarizeHardwareRecommendation,
  type AlisioModelHardwareProfile,
} from "./model-hardware.js";

type RuntimeKind = AlisioLocalRuntimeKind;
type RuntimeStatus = "ready" | "not_configured" | "error";
type PublishedCatalogEntry = Omit<
  ReturnType<typeof listPublishedAlisioLocalModels>[number],
  "sourceUri"
>;

export type AlisioModelTargetSnapshot = {
  targetId: string;
  deviceId: string;
  label: string;
  runtimeLabel: string;
  platform?: string;
  current: boolean;
  connected: boolean;
  location: "local" | "server";
  backend: typeof ALISIO_LOCAL_MODEL_BACKEND;
  runtimeKind: RuntimeKind;
  runtimeStatus: RuntimeStatus;
  runtimeMessage?: string;
  capabilities: RuntimeCapabilities;
  supportsInstall: boolean;
  supportsUpdate: boolean;
  supportsUninstall: boolean;
  consentRequired: boolean;
  access?: "owner" | "shared";
  ownerLabel?: string;
  ownerScope?: "user" | "organization";
  grantId?: string;
  chatProviderId?: string;
  installedModels: AlisioInstalledLocalModel[];
  availableModels: AlisioAvailableLocalModel[];
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
  runtimeLabel: string;
  runtimeStatus: RuntimeStatus;
  runtimeMessage?: string;
  chatCapabilityId?: string;
  installedModels: AlisioInstalledLocalModel[];
  availableModels: AlisioAvailableLocalModel[];
  hardware?: AlisioModelHardwareProfile;
  baseUrl?: string;
  apiKey?: string;
  capabilities: RuntimeCapabilities;
  supportsInstall: boolean;
  supportsUpdate: boolean;
  supportsUninstall: boolean;
  consentRequired: boolean;
};

type CurrentDevice = {
  id?: string;
  label?: string;
  platform?: string;
};

function toSharingRuntimeTarget(
  target: Pick<
    AlisioModelTargetSnapshot,
    "deviceId" | "label" | "platform" | "connected" | "current"
  >,
): AlisioSharingRuntimeTarget {
  return {
    targetId: target.deviceId,
    label: target.label,
    platform: target.platform,
    sourceKind: target.current ? "current" : "node",
    connected: target.connected,
    current: target.current,
  };
}

type SnapshotCache = {
  snapshot: AlisioModelProviderSnapshot;
  expiresAtMs: number;
};

const publishedCatalog = listPublishedAlisioLocalModels();
const DEFAULT_CACHE_TTL_MS = 4_000;

let snapshotCache: SnapshotCache | null = null;
let pendingSnapshot: Promise<AlisioModelProviderSnapshot> | null = null;

function normalizeListedModels(
  models:
    | ReadonlyArray<{ id?: string; name?: string; ownedBy?: string; running?: boolean }>
    | undefined,
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
      ...(model?.running === true ? { running: true } : {}),
    });
  }
  return [...byKey.values()].toSorted(
    (left, right) =>
      Number(Boolean(right.running)) - Number(Boolean(left.running)) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
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
    if (left.deviceId !== right.deviceId) {
      return left.label.localeCompare(right.label) || left.deviceId.localeCompare(right.deviceId);
    }
    return (
      Number(Boolean(right.installedModels.length)) -
        Number(Boolean(left.installedModels.length)) ||
      left.runtimeLabel.localeCompare(right.runtimeLabel) ||
      left.targetId.localeCompare(right.targetId)
    );
  });
}

function buildTargetRecommendations(params: {
  hardware?: AlisioModelHardwareProfile;
  catalog: ReadonlyArray<{
    id: string;
    name: string;
    memoryGb?: number;
    parametersBillions?: number;
  }>;
}) {
  const catalog = params.catalog.filter(
    (entry): entry is { id: string; name: string; memoryGb: number; parametersBillions: number } =>
      typeof entry.memoryGb === "number" &&
      Number.isFinite(entry.memoryGb) &&
      typeof entry.parametersBillions === "number" &&
      Number.isFinite(entry.parametersBillions),
  );
  if (!params.hardware || catalog.length === 0) {
    return buildEmptyRecommendations();
  }
  const summarized = summarizeHardwareRecommendation(params.hardware, catalog);
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

function resolveTargetAvailableModels(params: {
  runtimeKind: RuntimeKind;
  hardware?: AlisioModelHardwareProfile;
  supportsInstall: boolean;
  discoveredAvailableModels?: readonly AlisioAvailableLocalModel[];
}) {
  if (!params.supportsInstall) {
    return [...(params.discoveredAvailableModels ?? [])];
  }
  if (params.runtimeKind === "ollama") {
    return listOllamaAvailableModels(params.hardware);
  }
  if (params.runtimeKind === "lmstudio") {
    return listLmStudioAvailableModels(params.hardware);
  }
  return listManagedLocalAvailableModels(params.hardware);
}

function buildRuntimeTargetId(deviceId: string, runtimeKind: RuntimeKind) {
  return `${deviceId}::${runtimeKind}`;
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
    runtimeKind?: RuntimeKind;
    runtimeLabel?: string;
    status?: RuntimeStatus;
    message?: string;
    models?: Array<{ id?: string; name?: string; ownedBy?: string; running?: boolean }>;
    availableModels?: AlisioAvailableLocalModel[];
    hardware?: AlisioModelHardwareProfile;
    capabilities?: RuntimeCapabilities;
    supportsInstall?: boolean;
    supportsUpdate?: boolean;
    supportsUninstall?: boolean;
    consentRequired?: boolean;
  };
}

async function inspectNodeRuntimeCandidate(params: {
  nodeRegistry: NodeRegistry;
  node: NodeSession;
  runtimeKind: RuntimeKind;
  catalogCapabilityId?: string;
  chatCapabilityId?: string;
  fallbackCapabilities?: Partial<RuntimeCapabilities>;
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
      runtimeLabel:
        params.runtimeKind === "ollama"
          ? "Ollama"
          : params.runtimeKind === "lmstudio"
            ? "LM Studio"
            : params.runtimeKind === "openai-compatible"
              ? "OpenAI-compatible"
              : "Local GGUF",
      runtimeStatus: "error",
      runtimeMessage: task.error.message,
      installedModels: [],
      availableModels: [],
      capabilities: buildRuntimeCapabilities(params.fallbackCapabilities),
      supportsInstall: params.fallbackCapabilities?.install ?? false,
      supportsUpdate: params.fallbackCapabilities?.update ?? false,
      supportsUninstall: params.fallbackCapabilities?.uninstall ?? false,
      consentRequired: params.fallbackCapabilities?.consentRequired ?? false,
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
    runtimeKind: payload?.runtimeKind ?? params.runtimeKind,
    runtimeLabel:
      payload?.runtimeLabel ??
      (payload?.runtimeKind === "ollama"
        ? "Ollama"
        : payload?.runtimeKind === "lmstudio"
          ? "LM Studio"
          : payload?.runtimeKind === "openai-compatible"
            ? "OpenAI-compatible"
            : "Local GGUF"),
    runtimeStatus: payload?.status ?? "error",
    runtimeMessage:
      payload?.message ??
      result.error?.message ??
      (!result.ok ? "failed to read local model runtime" : undefined),
    installedModels: normalizeListedModels(payload?.models),
    availableModels: payload?.availableModels ?? [],
    hardware: payload?.hardware,
    capabilities:
      payload?.capabilities ??
      buildRuntimeCapabilities({
        install: payload?.supportsInstall === true || params.fallbackCapabilities?.install === true,
        update: payload?.supportsUpdate === true || params.fallbackCapabilities?.update === true,
        uninstall:
          payload?.supportsUninstall === true || params.fallbackCapabilities?.uninstall === true,
        consentRequired:
          payload?.consentRequired === true ||
          params.fallbackCapabilities?.consentRequired === true,
        startServer:
          payload?.capabilities?.startServer === true ||
          params.fallbackCapabilities?.startServer === true,
      }),
    supportsInstall:
      payload?.supportsInstall === true || params.fallbackCapabilities?.install === true,
    supportsUpdate:
      payload?.supportsUpdate === true || params.fallbackCapabilities?.update === true,
    supportsUninstall:
      payload?.supportsUninstall === true || params.fallbackCapabilities?.uninstall === true,
    consentRequired:
      payload?.consentRequired === true || params.fallbackCapabilities?.consentRequired === true,
    ...(params.chatCapabilityId ? { chatCapabilityId: params.chatCapabilityId } : {}),
  };
}

function buildConnectedNodeTarget(params: {
  node: NodeSession;
  candidate: TargetRuntimeCandidate;
}): ConnectedTargetInspection {
  const availableModels = resolveTargetAvailableModels({
    runtimeKind: params.candidate.runtimeKind,
    hardware: params.candidate.hardware,
    supportsInstall: params.candidate.supportsInstall,
    discoveredAvailableModels: params.candidate.availableModels,
  });
  const recommendations = params.candidate.supportsInstall
    ? buildTargetRecommendations({
        hardware: params.candidate.hardware,
        catalog:
          params.candidate.runtimeKind === "ollama"
            ? listOllamaAvailableModels(params.candidate.hardware)
            : params.candidate.runtimeKind === "lmstudio"
              ? listLmStudioAvailableModels(params.candidate.hardware)
              : availableModels,
      })
    : buildEmptyRecommendations();

  return {
    targetId: buildRuntimeTargetId(params.node.nodeId, params.candidate.runtimeKind),
    deviceId: params.node.nodeId,
    label: resolveNodeTargetLabel(params.node),
    runtimeLabel: params.candidate.runtimeLabel,
    platform: params.node.platform,
    current: false,
    connected: true,
    location: "server",
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    runtimeKind: params.candidate.runtimeKind,
    runtimeStatus: params.candidate.runtimeStatus,
    runtimeMessage: params.candidate.runtimeMessage,
    capabilities: params.candidate.capabilities,
    supportsInstall: params.candidate.supportsInstall,
    supportsUpdate: params.candidate.supportsUpdate,
    supportsUninstall: params.candidate.supportsUninstall,
    consentRequired: params.candidate.consentRequired,
    installedModels: params.candidate.installedModels,
    availableModels,
    hardware: params.candidate.hardware,
    recommendations: recommendations.recommendations,
    bestModelId: recommendations.bestModelId,
    bestModelName: recommendations.bestModelName,
    ...(params.candidate.chatCapabilityId
      ? { chatCapabilityId: params.candidate.chatCapabilityId }
      : {}),
  };
}

async function inspectConnectedNodeTargets(params: {
  nodeRegistry: NodeRegistry;
  node: NodeSession;
}): Promise<ConnectedTargetInspection[]> {
  const { node } = params;
  const runtimeCandidates = (
    await Promise.all([
      inspectNodeRuntimeCandidate({
        nodeRegistry: params.nodeRegistry,
        node,
        runtimeKind: ALISIO_LOCAL_MODEL_BACKEND,
        catalogCapabilityId: hasCapability(node, "model.catalog.llamacpp.v1")
          ? "model.catalog.llamacpp.v1"
          : undefined,
        chatCapabilityId: hasCapability(node, "model.chat.llamacpp.v1")
          ? "model.chat.llamacpp.v1"
          : undefined,
        fallbackCapabilities: hasCapability(node, "model.manage.llamacpp.v1")
          ? {
              install: true,
              update: true,
              uninstall: true,
              consentRequired: true,
            }
          : undefined,
      }),
      inspectNodeRuntimeCandidate({
        nodeRegistry: params.nodeRegistry,
        node,
        runtimeKind: "ollama",
        catalogCapabilityId: hasCapability(node, "model.catalog.ollama.v1")
          ? "model.catalog.ollama.v1"
          : undefined,
        chatCapabilityId: hasCapability(node, "model.chat.ollama.v1")
          ? "model.chat.ollama.v1"
          : undefined,
        fallbackCapabilities: hasCapability(node, "model.manage.ollama.v1")
          ? {
              install: true,
              update: true,
              uninstall: true,
              consentRequired: true,
            }
          : undefined,
      }),
      inspectNodeRuntimeCandidate({
        nodeRegistry: params.nodeRegistry,
        node,
        runtimeKind: "lmstudio",
        catalogCapabilityId: hasCapability(node, "model.catalog.lmstudio.v1")
          ? "model.catalog.lmstudio.v1"
          : undefined,
        chatCapabilityId: hasCapability(node, "model.chat.lmstudio.v1")
          ? "model.chat.lmstudio.v1"
          : undefined,
        fallbackCapabilities: hasCapability(node, "model.server.start.lmstudio.v1")
          ? { startServer: true }
          : undefined,
      }),
      inspectNodeRuntimeCandidate({
        nodeRegistry: params.nodeRegistry,
        node,
        runtimeKind: "openai-compatible",
        catalogCapabilityId: hasCapability(node, "model.catalog.openai.v1")
          ? "model.catalog.openai.v1"
          : undefined,
        chatCapabilityId: hasCapability(node, "model.chat.openai.v1")
          ? "model.chat.openai.v1"
          : undefined,
      }),
    ])
  ).filter((candidate): candidate is TargetRuntimeCandidate => Boolean(candidate));

  if (runtimeCandidates.length === 0) {
    return [];
  }

  return runtimeCandidates.map((candidate) =>
    buildConnectedNodeTarget({
      node,
      candidate,
    }),
  );
}

function buildCurrentSource(params: {
  currentDevice?: CurrentDevice;
  target: AlisioModelTargetSnapshot;
  baseUrl?: string;
  apiKey?: string;
}): AlisioDynamicProviderSource | null {
  if (params.target.runtimeStatus !== "ready" || params.target.installedModels.length === 0) {
    return null;
  }
  const providerId = buildAlisioCurrentProviderId(params.target.runtimeKind);
  if (
    params.target.runtimeKind === "openai-compatible" ||
    params.target.runtimeKind === "lmstudio"
  ) {
    if (!params.baseUrl) {
      return null;
    }
    return {
      kind: "current-openai",
      providerId,
      providerLabel: params.currentDevice?.label?.trim() || "This device",
      targetId: params.target.targetId,
      baseUrl: params.baseUrl,
      ...(params.apiKey ? { apiKey: params.apiKey } : {}),
      catalogEntries: params.target.installedModels.map((model) => ({
        id: model.id,
        name: model.name,
        provider: providerId,
        providerLabel: params.currentDevice?.label?.trim() || "This device",
        input: ["text"],
      })),
    };
  }
  if (params.target.runtimeKind === "ollama") {
    if (!params.baseUrl) {
      return null;
    }
    return {
      kind: "current-ollama",
      providerId,
      providerLabel: params.currentDevice?.label?.trim() || "This device",
      targetId: params.target.targetId,
      baseUrl: params.baseUrl,
      ...(params.apiKey ? { apiKey: params.apiKey } : {}),
      catalogEntries: params.target.installedModels.map((model) => ({
        id: model.id,
        name: model.name,
        provider: providerId,
        providerLabel: params.currentDevice?.label?.trim() || "This device",
        input: ["text"],
      })),
    };
  }
  return {
    kind: "current-llama",
    providerId,
    providerLabel: params.currentDevice?.label?.trim() || "This device",
    targetId: params.target.targetId,
    catalogEntries: params.target.installedModels.map((model) => ({
      id: model.id,
      name: model.name,
      provider: providerId,
      providerLabel: params.currentDevice?.label?.trim() || "This device",
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
    targetId: params.target.deviceId,
    runtimeKind: params.target.runtimeKind,
  });
  return {
    kind: params.target.runtimeKind === ALISIO_LOCAL_MODEL_BACKEND ? "node-llama" : "node-openai",
    providerId,
    providerLabel: params.target.label,
    targetId: params.target.targetId,
    runTask: buildNodeTaskExecutor({
      nodeRegistry: params.nodeRegistry,
      nodeId: params.target.deviceId,
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
  const configuredRuntimeKind = currentRuntimeConfig.baseUrl
    ? resolveConfiguredLocalRuntimeKind(currentRuntimeConfig.baseUrl)
    : null;
  const [currentLlamaInspection, currentEndpointInspections] = await Promise.all([
    inspectManagedLocalModelRuntime(env),
    inspectLocalModelRuntimes({
      env,
      fetchImpl: params.fetchImpl,
    }),
  ]);
  const currentDeviceId = params.currentDevice?.id?.trim() || "current";
  const currentDeviceLabel = params.currentDevice?.label?.trim() || "This computer";
  const currentCandidates: TargetRuntimeCandidate[] = [
    {
      runtimeKind: currentLlamaInspection.runtimeKind ?? ALISIO_LOCAL_MODEL_BACKEND,
      runtimeLabel: currentLlamaInspection.runtimeLabel ?? "Local GGUF",
      runtimeStatus: currentLlamaInspection.status,
      runtimeMessage: currentLlamaInspection.message,
      installedModels: normalizeListedModels(currentLlamaInspection.models),
      availableModels: currentLlamaInspection.availableModels ?? [],
      hardware: currentLlamaInspection.hardware,
      capabilities:
        currentLlamaInspection.capabilities ??
        buildRuntimeCapabilities({
          install: currentLlamaInspection.supportsInstall,
          update: currentLlamaInspection.supportsUpdate,
          uninstall: currentLlamaInspection.supportsUninstall,
          consentRequired: currentLlamaInspection.consentRequired,
        }),
      supportsInstall: currentLlamaInspection.supportsInstall,
      supportsUpdate: currentLlamaInspection.supportsUpdate,
      supportsUninstall: currentLlamaInspection.supportsUninstall,
      consentRequired: currentLlamaInspection.consentRequired,
    },
    ...currentEndpointInspections.map(
      (inspection) =>
        ({
          runtimeKind: inspection.runtimeKind,
          runtimeLabel: inspection.runtimeLabel,
          runtimeStatus: inspection.status,
          runtimeMessage: inspection.message,
          installedModels: normalizeListedModels(inspection.models),
          availableModels: inspection.availableModels ?? [],
          hardware: inspection.hardware,
          capabilities: inspection.capabilities,
          supportsInstall: inspection.supportsInstall,
          supportsUpdate: inspection.supportsUpdate,
          supportsUninstall: inspection.supportsUninstall,
          consentRequired: inspection.consentRequired,
        }) satisfies TargetRuntimeCandidate,
    ),
  ];
  const currentTargets = currentCandidates.map((candidate) => {
    const availableModels = resolveTargetAvailableModels({
      runtimeKind: candidate.runtimeKind,
      hardware: candidate.hardware,
      supportsInstall: candidate.supportsInstall,
      discoveredAvailableModels: candidate.availableModels,
    });
    const recommendations = candidate.supportsInstall
      ? buildTargetRecommendations({
          hardware: candidate.hardware,
          catalog:
            candidate.runtimeKind === "ollama"
              ? listOllamaAvailableModels(candidate.hardware)
              : candidate.runtimeKind === "lmstudio"
                ? listLmStudioAvailableModels(candidate.hardware)
                : availableModels,
        })
      : buildEmptyRecommendations();
    const targetBase: AlisioModelTargetSnapshot = {
      targetId: buildRuntimeTargetId(currentDeviceId, candidate.runtimeKind),
      deviceId: currentDeviceId,
      label: currentDeviceLabel,
      runtimeLabel: candidate.runtimeLabel,
      platform: params.currentDevice?.platform,
      current: true,
      connected: true,
      location: "local",
      backend: ALISIO_LOCAL_MODEL_BACKEND,
      runtimeKind: candidate.runtimeKind,
      runtimeStatus: candidate.runtimeStatus,
      runtimeMessage: candidate.runtimeMessage,
      capabilities: candidate.capabilities,
      supportsInstall: candidate.supportsInstall,
      supportsUpdate: candidate.supportsUpdate,
      supportsUninstall: candidate.supportsUninstall,
      consentRequired: candidate.consentRequired,
      installedModels: candidate.installedModels,
      availableModels,
      hardware: candidate.hardware,
      recommendations: recommendations.recommendations,
      bestModelId: recommendations.bestModelId,
      bestModelName: recommendations.bestModelName,
    };
    const endpointBaseUrl =
      candidate.runtimeKind === ALISIO_LOCAL_MODEL_BACKEND
        ? undefined
        : (resolveCurrentRuntimeBaseUrlForKind({
            runtimeKind: candidate.runtimeKind,
            env,
          }) ?? undefined);
    const endpointApiKey =
      configuredRuntimeKind === candidate.runtimeKind
        ? (currentRuntimeConfig.apiKey ?? undefined)
        : undefined;
    const source = buildCurrentSource({
      currentDevice: params.currentDevice,
      target: targetBase,
      baseUrl: endpointBaseUrl,
      apiKey: endpointApiKey,
    });
    return {
      target:
        source && source.catalogEntries.length > 0
          ? {
              ...targetBase,
              chatProviderId: source.providerId,
            }
          : targetBase,
      source,
    };
  });

  const connectedTargets = (
    await Promise.all(
      params.nodeRegistry.listConnected().map(async (node) => {
        const targets = await inspectConnectedNodeTargets({
          nodeRegistry: params.nodeRegistry,
          node,
        });
        return targets.map((target) => {
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
        });
      }),
    )
  ).flat();
  const sharingAccess = await getAlisioSharingTargetAccessIndex(
    {
      targets: [
        ...currentTargets.map((entry) => toSharingRuntimeTarget(entry.target)),
        ...connectedTargets.map((entry) => toSharingRuntimeTarget(entry.target)),
      ],
    },
    env,
  );
  const currentTargetsWithAccess = currentTargets.flatMap((entry) => {
    const access = sharingAccess[entry.target.deviceId];
    if (!access || (access.modelAccess !== "owner" && access.modelAccess !== "shared")) {
      return [];
    }
    return [
      {
        ...entry,
        target: {
          ...entry.target,
          supportsInstall: access.modelAccess === "shared" ? false : entry.target.supportsInstall,
          supportsUpdate: access.modelAccess === "shared" ? false : entry.target.supportsUpdate,
          supportsUninstall:
            access.modelAccess === "shared" ? false : entry.target.supportsUninstall,
          capabilities:
            access.modelAccess === "shared"
              ? {
                  ...entry.target.capabilities,
                  install: false,
                  update: false,
                  uninstall: false,
                }
              : entry.target.capabilities,
          access: access.modelAccess,
          ownerLabel: access.ownerLabel,
          ownerScope: access.ownerScope,
          grantId: access.grantId,
        } satisfies AlisioModelTargetSnapshot,
      },
    ];
  });
  const connectedTargetsWithAccess = connectedTargets.flatMap((entry) => {
    const access = sharingAccess[entry.target.deviceId];
    if (!access || (access.modelAccess !== "owner" && access.modelAccess !== "shared")) {
      return [];
    }
    return [
      {
        ...entry,
        target: {
          ...entry.target,
          supportsInstall: access.modelAccess === "shared" ? false : entry.target.supportsInstall,
          supportsUpdate: access.modelAccess === "shared" ? false : entry.target.supportsUpdate,
          supportsUninstall:
            access.modelAccess === "shared" ? false : entry.target.supportsUninstall,
          capabilities:
            access.modelAccess === "shared"
              ? {
                  ...entry.target.capabilities,
                  install: false,
                  update: false,
                  uninstall: false,
                }
              : entry.target.capabilities,
          access: access.modelAccess,
          ownerLabel: access.ownerLabel,
          ownerScope: access.ownerScope,
          grantId: access.grantId,
        } satisfies ConnectedTargetInspection,
      },
    ];
  });

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
    ...currentTargetsWithAccess.map((entry) => entry.source),
    ...connectedTargetsWithAccess.map((entry) => entry.source),
    ...servers.map(buildServerSource),
  ].filter((source): source is AlisioDynamicProviderSource => Boolean(source));

  setAlisioDynamicModelProviders(dynamicSources);

  return {
    catalog: publishedCatalog.map(({ sourceUri: _sourceUri, ...entry }) => entry),
    targets: sortTargets([
      ...currentTargetsWithAccess.map((entry) => entry.target),
      ...connectedTargetsWithAccess.map((entry) => entry.target),
    ]),
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
  if (!snapshot.targets.some((target) => target.current)) {
    return snapshot;
  }
  const nextTargets = snapshot.targets.map((target) =>
    !target.current
      ? target
      : {
          ...target,
          deviceId: currentDevice.id?.trim() || target.deviceId,
          targetId: buildRuntimeTargetId(
            currentDevice.id?.trim() || target.deviceId,
            target.runtimeKind,
          ),
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
