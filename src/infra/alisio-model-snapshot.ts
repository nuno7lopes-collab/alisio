import type {
  NodeRegistry,
  NodeSession,
  NodeTaskEvent,
  NodeTaskResult,
} from "../gateway/node-registry.js";
import {
  buildAlisioCurrentProviderId,
  buildAlisioTargetProviderId,
} from "../shared/alisio-dynamic-provider.js";
import {
  ALISIO_LOCAL_MODEL_BACKEND,
  listPublishedAlisioLocalModels,
} from "../shared/alisio-local-models.js";
import { inspectManagedLocalModelRuntime } from "./alisio-local-llama-runtime.js";
import {
  listManagedLocalAvailableModels,
  type AlisioAvailableLocalModel,
  type AlisioInstalledLocalModel,
} from "./alisio-local-model-runtime.js";
import {
  listAlisioDynamicCatalogEntries,
  setAlisioDynamicModelProviders,
  type AlisioDynamicCatalogEntry,
  type AlisioDynamicProviderSource,
} from "./alisio-model-providers.js";
import {
  getAlisioSharingTargetAccessIndex,
  type AlisioSharingTargetState,
  type AlisioSharingRuntimeTarget,
} from "./alisio-store.js";
import {
  buildRuntimeCapabilities,
  type RuntimeCapabilities,
} from "./local-model-runtime-contracts.js";
import { logWarn } from "../logger.js";
import {
  summarizeHardwareRecommendation,
  type AlisioModelHardwareProfile,
} from "./model-hardware.js";

type RuntimeKind = typeof ALISIO_LOCAL_MODEL_BACKEND;
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
  location: "local" | "node";
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

export type AlisioModelProviderSnapshot = {
  catalog: PublishedCatalogEntry[];
  targets: AlisioModelTargetSnapshot[];
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

function buildDegradedSharingAccessIndex(
  targets: readonly AlisioSharingRuntimeTarget[],
): Record<string, AlisioSharingTargetState> {
  const timestamp = new Date().toISOString();
  return Object.fromEntries(
    targets.map((target) => {
      const access = target.current ? "owner" : "blocked";
      return [
        target.targetId,
        {
          ...target,
          ownerKey: "user:degraded-runtime",
          ownerScope: "user",
          ownerLabel: target.current ? "Current device" : "Sharing unavailable",
          registeredAt: timestamp,
          updatedAt: timestamp,
          deviceAccess: access,
          modelAccess: access,
          execAccess: access,
        } satisfies AlisioSharingTargetState,
      ];
    }),
  );
}

async function loadSnapshotSharingAccessIndex(
  targets: readonly AlisioSharingRuntimeTarget[],
  env?: NodeJS.ProcessEnv,
): Promise<Record<string, AlisioSharingTargetState>> {
  if (targets.length === 0) {
    return {};
  }
  try {
    return await getAlisioSharingTargetAccessIndex({ targets }, env);
  } catch (err) {
    // Keep local/runtime-backed model visibility alive even if the optional sharing cloud is stale.
    logWarn(
      `alisio-models: sharing access lookup failed; falling back to degraded runtime access: ${String(
        err,
      )}`,
    );
    return buildDegradedSharingAccessIndex(targets);
  }
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
    vramGb?: number;
  }>;
}) {
  const catalog = params.catalog.filter(
    (
      entry,
    ): entry is {
      id: string;
      name: string;
      memoryGb: number;
      parametersBillions: number;
      vramGb?: number;
    } =>
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

function isReadOnlyGrantedSharedAccess(access: AlisioSharingTargetState): boolean {
  return access.modelAccess === "shared" && Boolean(access.grantId?.trim());
}

function resolveTargetAvailableModels(params: {
  hardware?: AlisioModelHardwareProfile;
  supportsInstall: boolean;
  discoveredAvailableModels?: readonly AlisioAvailableLocalModel[];
}) {
  if (!params.supportsInstall) {
    return [...(params.discoveredAvailableModels ?? [])];
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
      runtimeLabel: "Local GGUF",
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
    runtimeKind: params.runtimeKind,
    runtimeLabel: payload?.runtimeLabel ?? "Local GGUF",
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
    hardware: params.candidate.hardware,
    supportsInstall: params.candidate.supportsInstall,
    discoveredAvailableModels: params.candidate.availableModels,
  });
  const recommendations = params.candidate.supportsInstall
    ? buildTargetRecommendations({
        hardware: params.candidate.hardware,
        catalog: availableModels,
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
    location: "node",
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
  const runtimeCandidate = await inspectNodeRuntimeCandidate({
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
  });
  const runtimeCandidates = [runtimeCandidate].filter(
    (candidate): candidate is TargetRuntimeCandidate => Boolean(candidate),
  );

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
}): AlisioDynamicProviderSource | null {
  if (
    params.target.runtimeKind !== ALISIO_LOCAL_MODEL_BACKEND ||
    params.target.runtimeStatus !== "ready" ||
    params.target.installedModels.length === 0
  ) {
    return null;
  }
  const providerId = buildAlisioCurrentProviderId();
  return {
    kind: "managed-local",
    location: "current",
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
    params.target.runtimeKind !== ALISIO_LOCAL_MODEL_BACKEND ||
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
    kind: "linked-node",
    location: "target",
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

async function loadSnapshot(params: {
  nodeRegistry: NodeRegistry;
  currentDevice?: CurrentDevice;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AlisioModelProviderSnapshot> {
  const env = params.env ?? process.env;
  const currentLlamaInspection = await inspectManagedLocalModelRuntime(env);
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
  ];
  const currentTargets = currentCandidates.map((candidate) => {
    const availableModels = resolveTargetAvailableModels({
      hardware: candidate.hardware,
      supportsInstall: candidate.supportsInstall,
      discoveredAvailableModels: candidate.availableModels,
    });
    const recommendations = candidate.supportsInstall
      ? buildTargetRecommendations({
          hardware: candidate.hardware,
          catalog: availableModels,
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
    const source = buildCurrentSource({
      currentDevice: params.currentDevice,
      target: targetBase,
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
  const sharingTargets = [
    ...currentTargets.map((entry) => toSharingRuntimeTarget(entry.target)),
    ...connectedTargets.map((entry) => toSharingRuntimeTarget(entry.target)),
  ];
  const sharingAccess = await loadSnapshotSharingAccessIndex(sharingTargets, env);
  const currentTargetsWithAccess = currentTargets.flatMap((entry) => {
    const access = sharingAccess[entry.target.deviceId];
    if (!access || (access.modelAccess !== "owner" && access.modelAccess !== "shared")) {
      return [];
    }
    const readOnlySharedAccess = isReadOnlyGrantedSharedAccess(access);
    return [
      {
        ...entry,
        target: {
          ...entry.target,
          supportsInstall: readOnlySharedAccess ? false : entry.target.supportsInstall,
          supportsUpdate: readOnlySharedAccess ? false : entry.target.supportsUpdate,
          supportsUninstall: readOnlySharedAccess ? false : entry.target.supportsUninstall,
          capabilities: readOnlySharedAccess
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
    const readOnlySharedAccess = isReadOnlyGrantedSharedAccess(access);
    return [
      {
        ...entry,
        target: {
          ...entry.target,
          supportsInstall: readOnlySharedAccess ? false : entry.target.supportsInstall,
          supportsUpdate: readOnlySharedAccess ? false : entry.target.supportsUpdate,
          supportsUninstall: readOnlySharedAccess ? false : entry.target.supportsUninstall,
          capabilities: readOnlySharedAccess
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
  const dynamicSources = [
    ...currentTargetsWithAccess.map((entry) => entry.source),
    ...connectedTargetsWithAccess.map((entry) => entry.source),
  ].filter((source): source is AlisioDynamicProviderSource => Boolean(source));

  setAlisioDynamicModelProviders(dynamicSources);

  return {
    catalog: publishedCatalog.map(({ sourceUri: _sourceUri, ...entry }) => entry),
    targets: sortTargets([
      ...currentTargetsWithAccess.map((entry) => entry.target),
      ...connectedTargetsWithAccess.map((entry) => entry.target),
    ]),
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
