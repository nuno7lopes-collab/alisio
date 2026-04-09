import { loadAuthProfileStore, listProfilesForProvider } from "../agents/auth-profiles.js";
import { DEFAULT_PROVIDER } from "../agents/defaults.js";
import { collectProviderApiKeys } from "../agents/live-auth-keys.js";
import { normalizeProviderId } from "../agents/provider-id.js";
import type { NodeRegistry } from "../gateway/node-registry.js";
import { loadGatewayModelCatalog } from "../gateway/server-model-catalog.js";
import { isAlisioDynamicProvider } from "../shared/alisio-dynamic-provider.js";

export type AlisioRuntimeProviderSignals = {
  authenticatedProviderReady: boolean;
  localTargetReady: boolean;
  activeServerReady: boolean;
};

type RuntimeSetupSnapshot = {
  targets: Array<{ chatProviderId?: string }>;
  servers: Array<{ active?: boolean; chatProviderId?: string }>;
  dynamicCatalogEntries: Array<{ provider: string; id: string; name: string }>;
};

export type AlisioRuntimeSetupState = {
  providerReady: boolean;
  signals: AlisioRuntimeProviderSignals;
  models: {
    total: number;
    defaultProvider: string;
    providers: string[];
  };
};

function buildEmptyRuntimeModels(): AlisioRuntimeSetupState["models"] {
  return {
    total: 0,
    defaultProvider: DEFAULT_PROVIDER,
    providers: [],
  };
}

function buildRuntimeSignals(
  authenticatedProviderReady: boolean,
  overrides?: Partial<Omit<AlisioRuntimeProviderSignals, "authenticatedProviderReady">>,
): AlisioRuntimeProviderSignals {
  return {
    authenticatedProviderReady,
    localTargetReady: overrides?.localTargetReady ?? false,
    activeServerReady: overrides?.activeServerReady ?? false,
  };
}

function hasPublishedChatProvider(providerId: string | undefined): boolean {
  return typeof providerId === "string" && providerId.trim().length > 0;
}

export function resolveAlisioRuntimeSignalsFromSnapshot(
  snapshot: Pick<RuntimeSetupSnapshot, "targets" | "servers">,
): Omit<AlisioRuntimeProviderSignals, "authenticatedProviderReady"> {
  return {
    localTargetReady: snapshot.targets.some((target) =>
      hasPublishedChatProvider(target.chatProviderId),
    ),
    activeServerReady: snapshot.servers.some(
      (server) => server.active && hasPublishedChatProvider(server.chatProviderId),
    ),
  };
}

export function resolveAlisioRuntimeProviderReady(
  runtimeSetup: Pick<AlisioRuntimeSetupState, "providerReady" | "models"> & {
    signals?: Partial<AlisioRuntimeProviderSignals>;
  },
): boolean {
  if (runtimeSetup.providerReady) {
    return true;
  }
  if (
    runtimeSetup.signals?.authenticatedProviderReady ||
    runtimeSetup.signals?.localTargetReady ||
    runtimeSetup.signals?.activeServerReady
  ) {
    return true;
  }
  return runtimeSetup.models.providers.some((provider) => isAlisioDynamicProvider(provider));
}

export async function loadAlisioRuntimeSetupState(params?: {
  loadGatewayModelCatalog?: typeof loadGatewayModelCatalog;
  loadAlisioModelProviderSnapshot?: () => Promise<RuntimeSetupSnapshot>;
  nodeRegistry?: NodeRegistry;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AlisioRuntimeSetupState> {
  try {
    const [modelCatalogResult, snapshotResult] = await Promise.allSettled([
      (params?.loadGatewayModelCatalog ?? loadGatewayModelCatalog)({
        nodeRegistry: params?.nodeRegistry,
        env: params?.env,
        fetchImpl: params?.fetchImpl,
      }),
      params?.loadAlisioModelProviderSnapshot
        ? params.loadAlisioModelProviderSnapshot()
        : Promise.resolve(null),
    ]);
    const snapshot = snapshotResult.status === "fulfilled" ? snapshotResult.value : null;
    const modelCatalog =
      modelCatalogResult.status === "fulfilled" && modelCatalogResult.value.length > 0
        ? modelCatalogResult.value
        : (snapshot?.dynamicCatalogEntries ?? []);
    const providers = Array.from(
      new Set(
        modelCatalog
          .map((entry) => normalizeProviderId(entry.provider))
          .filter((provider): provider is string => Boolean(provider)),
      ),
    ).toSorted((left, right) => left.localeCompare(right));
    const authStore = loadAuthProfileStore();
    const authenticatedProviderReady = providers.some(
      (provider) =>
        listProfilesForProvider(authStore, provider).length > 0 ||
        collectProviderApiKeys(provider).length > 0,
    );
    const signals = buildRuntimeSignals(
      authenticatedProviderReady,
      snapshot ? resolveAlisioRuntimeSignalsFromSnapshot(snapshot) : undefined,
    );
    const models = {
      total: modelCatalog.length,
      defaultProvider: providers[0] ?? DEFAULT_PROVIDER,
      providers,
    };
    return {
      providerReady: resolveAlisioRuntimeProviderReady({
        providerReady: authenticatedProviderReady,
        signals,
        models,
      }),
      signals,
      models,
    };
  } catch {
    return {
      providerReady: false,
      signals: buildRuntimeSignals(false),
      models: buildEmptyRuntimeModels(),
    };
  }
}
