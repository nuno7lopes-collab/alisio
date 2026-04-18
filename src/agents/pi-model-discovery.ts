import path from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import * as PiCodingAgent from "@mariozechner/pi-coding-agent";
import type {
  AuthStorage as PiAuthStorage,
  ModelRegistry as PiModelRegistry,
} from "@mariozechner/pi-coding-agent";
import { normalizeModelCompat } from "../plugins/provider-model-compat.js";
import {
  applyProviderResolvedModelCompatWithPlugins,
  applyProviderResolvedTransportWithPlugin,
  normalizeProviderResolvedModelWithPlugin,
} from "../plugins/provider-runtime.js";
import type { ProviderRuntimeModel } from "../plugins/types.js";
import { ensureAuthProfileStore } from "./auth-profiles.js";
import { PROVIDER_ENV_API_KEY_CANDIDATES } from "./model-auth-env-vars.js";
import { resolveEnvApiKey } from "./model-auth-env.js";
import { resolvePiCredentialMapFromStore, type PiCredentialMap } from "./pi-auth-credentials.js";

const PiAuthStorageClass = PiCodingAgent.AuthStorage;
const PiModelRegistryClass = PiCodingAgent.ModelRegistry;

export { PiAuthStorageClass as AuthStorage, PiModelRegistryClass as ModelRegistry };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRegistryModel<T>(value: T, agentDir: string): T {
  if (!isRecord(value)) {
    return value;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.api !== "string"
  ) {
    return value;
  }
  const model = value as unknown as ProviderRuntimeModel;
  const pluginNormalized =
    normalizeProviderResolvedModelWithPlugin({
      provider: model.provider,
      context: {
        provider: model.provider,
        modelId: model.id,
        model,
        agentDir,
      },
    }) ?? model;
  const compatNormalized =
    applyProviderResolvedModelCompatWithPlugins({
      provider: model.provider,
      context: {
        provider: model.provider,
        modelId: model.id,
        model: pluginNormalized,
        agentDir,
      },
    }) ?? pluginNormalized;
  const transportNormalized =
    applyProviderResolvedTransportWithPlugin({
      provider: model.provider,
      context: {
        provider: model.provider,
        modelId: model.id,
        model: compatNormalized,
        agentDir,
      },
    }) ?? compatNormalized;
  return normalizeModelCompat(transportNormalized as Model<Api>) as T;
}

class AlisioModelRegistry extends PiModelRegistryClass {
  constructor(
    authStorage: PiAuthStorage,
    modelsJsonPath: string,
    private readonly agentDir: string,
  ) {
    super(authStorage, modelsJsonPath);
  }

  override getAll(): Array<Model<Api>> {
    return super.getAll().map((entry) => normalizeRegistryModel(entry, this.agentDir));
  }

  override getAvailable(): Array<Model<Api>> {
    return super.getAvailable().map((entry) => normalizeRegistryModel(entry, this.agentDir));
  }

  override find(provider: string, modelId: string): Model<Api> | undefined {
    return normalizeRegistryModel(super.find(provider, modelId), this.agentDir);
  }
}

function createAuthStorage(AuthStorageLike: unknown, creds: PiCredentialMap) {
  const withInMemory = AuthStorageLike as { inMemory?: (data?: unknown) => unknown };
  if (typeof withInMemory.inMemory === "function") {
    return withInMemory.inMemory(creds) as PiAuthStorage;
  }
  throw new TypeError("Installed pi-coding-agent must expose AuthStorage.inMemory()");
}

function resolvePiCredentials(agentDir: string): PiCredentialMap {
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const credentials = resolvePiCredentialMapFromStore(store);
  // pi-coding-agent hides providers from its registry when auth storage lacks
  // a matching credential entry. Mirror env-backed provider auth here so
  // live/model discovery sees the same providers runtime auth can use.
  for (const provider of Object.keys(PROVIDER_ENV_API_KEY_CANDIDATES)) {
    if (credentials[provider]) {
      continue;
    }
    const resolved = resolveEnvApiKey(provider);
    if (!resolved?.apiKey) {
      continue;
    }
    credentials[provider] = {
      type: "api_key",
      key: resolved.apiKey,
    };
  }
  return credentials;
}

// Compatibility helpers for pi-coding-agent 0.50+ (discover* helpers removed).
export function discoverAuthStorage(agentDir: string): PiAuthStorage {
  const credentials = resolvePiCredentials(agentDir);
  return createAuthStorage(PiAuthStorageClass, credentials);
}

export function discoverModels(authStorage: PiAuthStorage, agentDir: string): PiModelRegistry {
  return new AlisioModelRegistry(authStorage, path.join(agentDir, "models.json"), agentDir);
}
