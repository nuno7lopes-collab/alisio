import { loadAuthProfileStore, listProfilesForProvider } from "../agents/auth-profiles.js";
import { DEFAULT_PROVIDER } from "../agents/defaults.js";
import { collectProviderApiKeys } from "../agents/live-auth-keys.js";
import { normalizeProviderId } from "../agents/provider-id.js";
import { loadGatewayModelCatalog } from "../gateway/server-model-catalog.js";

export type AlisioRuntimeSetupState = {
  providerReady: boolean;
  models: {
    total: number;
    defaultProvider: string;
    providers: string[];
  };
};

export async function loadAlisioRuntimeSetupState(params?: {
  loadGatewayModelCatalog?: typeof loadGatewayModelCatalog;
}): Promise<AlisioRuntimeSetupState> {
  try {
    const modelCatalog = await (params?.loadGatewayModelCatalog ?? loadGatewayModelCatalog)();
    const providers = Array.from(
      new Set(
        modelCatalog
          .map((entry) => normalizeProviderId(entry.provider))
          .filter((provider): provider is string => Boolean(provider)),
      ),
    ).toSorted((left, right) => left.localeCompare(right));
    const authStore = loadAuthProfileStore();
    const providerReady = providers.some(
      (provider) =>
        listProfilesForProvider(authStore, provider).length > 0 ||
        collectProviderApiKeys(provider).length > 0,
    );
    return {
      providerReady,
      models: {
        total: modelCatalog.length,
        defaultProvider: providers[0] ?? DEFAULT_PROVIDER,
        providers,
      },
    };
  } catch {
    return {
      providerReady: false,
      models: {
        total: 0,
        defaultProvider: DEFAULT_PROVIDER,
        providers: [],
      },
    };
  }
}
