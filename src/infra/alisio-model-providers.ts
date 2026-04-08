import type { Api } from "@mariozechner/pi-ai";
import type { ModelCatalogEntry } from "../agents/model-catalog.js";
import type { ModelDefinitionConfig } from "../config/types.js";
import type { NodeTaskEvent, NodeTaskResult } from "../gateway/node-registry.js";
import { findAlisioLocalModelCatalogEntry } from "../shared/alisio-local-models.js";
import {
  buildAlisioCurrentProviderId,
  buildAlisioServerProviderId,
  buildAlisioTargetProviderId,
  isAlisioDynamicProvider,
} from "../shared/alisio-remote-model-provider.js";

const ALISIO_DYNAMIC_API_PREFIX = "alisio:";
const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_TOKENS = 8_192;

type AlisioDynamicNodeTaskExecutor = (params: {
  input: unknown;
  timeoutMs?: number;
  onEvent?: (event: NodeTaskEvent) => void;
}) => Promise<NodeTaskResult>;

export type AlisioDynamicCatalogEntry = ModelCatalogEntry & {
  providerLabel?: string;
};

type AlisioDynamicSourceBase = {
  providerId: string;
  providerLabel: string;
  catalogEntries: AlisioDynamicCatalogEntry[];
};

export type AlisioDynamicProviderSource =
  | (AlisioDynamicSourceBase & {
      kind: "current-llama";
      targetId: string;
    })
  | (AlisioDynamicSourceBase & {
      kind: "current-openai";
      targetId: string;
      baseUrl: string;
      apiKey?: string;
    })
  | (AlisioDynamicSourceBase & {
      kind: "node-llama";
      targetId: string;
      runTask: AlisioDynamicNodeTaskExecutor;
    })
  | (AlisioDynamicSourceBase & {
      kind: "node-openai";
      targetId: string;
      runTask: AlisioDynamicNodeTaskExecutor;
    })
  | (AlisioDynamicSourceBase & {
      kind: "server-openai";
      serverId: string;
      baseUrl: string;
      apiKey?: string;
    })
  | (AlisioDynamicSourceBase & {
      kind: "server-ollama";
      serverId: string;
      baseUrl: string;
      apiKey?: string;
    });

export type AlisioDynamicProviderConfig = {
  provider: string;
  providerLabel: string;
  api: Api;
  baseUrl?: string;
  apiKey?: string;
  models: Array<
    Omit<ModelDefinitionConfig, "api"> & {
      api: Api;
    }
  >;
};

type AlisioDynamicProviderState = {
  sources: Map<string, AlisioDynamicProviderSource>;
  catalogEntries: AlisioDynamicCatalogEntry[];
};

const alisioDynamicProviderState: AlisioDynamicProviderState = {
  sources: new Map<string, AlisioDynamicProviderSource>(),
  catalogEntries: [],
};

function buildDynamicModelDefinition(
  entry: AlisioDynamicCatalogEntry,
  api: Api,
): AlisioDynamicProviderConfig["models"][number] {
  const localCatalogEntry = findAlisioLocalModelCatalogEntry(entry.id);
  const contextWindow = entry.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  return {
    id: entry.id,
    name: entry.name,
    api,
    reasoning: entry.reasoning ?? false,
    input:
      Array.isArray(entry.input) && entry.input.length > 0
        ? entry.input.filter((input) => input === "text" || input === "image")
        : ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow,
    maxTokens:
      localCatalogEntry && Number.isFinite(localCatalogEntry.parametersBillions)
        ? Math.min(contextWindow, DEFAULT_MAX_TOKENS)
        : Math.min(contextWindow, DEFAULT_MAX_TOKENS),
  };
}

function normalizeCatalogEntry(entry: AlisioDynamicCatalogEntry): AlisioDynamicCatalogEntry | null {
  const id = entry.id?.trim();
  const name = entry.name?.trim();
  const provider = entry.provider?.trim();
  if (!id || !name || !provider) {
    return null;
  }
  return {
    id,
    name,
    provider,
    providerLabel: entry.providerLabel?.trim() || undefined,
    contextWindow:
      typeof entry.contextWindow === "number" && entry.contextWindow > 0
        ? entry.contextWindow
        : undefined,
    reasoning: entry.reasoning === true ? true : undefined,
    input:
      Array.isArray(entry.input) && entry.input.length > 0
        ? entry.input.filter(
            (input) => input === "text" || input === "image" || input === "document",
          )
        : undefined,
  };
}

function normalizeSource(source: AlisioDynamicProviderSource): AlisioDynamicProviderSource | null {
  const providerId = source.providerId.trim();
  const providerLabel = source.providerLabel.trim();
  if (!providerId || !providerLabel) {
    return null;
  }
  const catalogEntries = source.catalogEntries
    .map(normalizeCatalogEntry)
    .filter((entry): entry is AlisioDynamicCatalogEntry => Boolean(entry));
  return {
    ...source,
    providerId,
    providerLabel,
    catalogEntries,
  };
}

function mergeCatalogEntries(
  sources: Iterable<AlisioDynamicProviderSource>,
): AlisioDynamicCatalogEntry[] {
  const byKey = new Map<string, AlisioDynamicCatalogEntry>();
  for (const source of sources) {
    for (const entry of source.catalogEntries) {
      const key = `${entry.provider.toLowerCase()}::${entry.id.toLowerCase()}`;
      if (byKey.has(key)) {
        continue;
      }
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].toSorted((left, right) => {
    const providerLabel = (left.providerLabel ?? left.provider).localeCompare(
      right.providerLabel ?? right.provider,
    );
    if (providerLabel !== 0) {
      return providerLabel;
    }
    const name = left.name.localeCompare(right.name);
    if (name !== 0) {
      return name;
    }
    return left.id.localeCompare(right.id);
  });
}

export function buildAlisioDynamicProviderApi(providerId: string): Api {
  return `${ALISIO_DYNAMIC_API_PREFIX}${providerId.trim()}` as Api;
}

export function clearAlisioDynamicModelProviders(): void {
  alisioDynamicProviderState.sources.clear();
  alisioDynamicProviderState.catalogEntries = [];
}

export function setAlisioDynamicModelProviders(
  sources: readonly AlisioDynamicProviderSource[],
): void {
  const normalizedSources = sources
    .map(normalizeSource)
    .filter((source): source is AlisioDynamicProviderSource => Boolean(source));
  alisioDynamicProviderState.sources = new Map(
    normalizedSources.map((source) => [source.providerId.toLowerCase(), source]),
  );
  alisioDynamicProviderState.catalogEntries = mergeCatalogEntries(normalizedSources);
}

export function listAlisioDynamicCatalogEntries(): AlisioDynamicCatalogEntry[] {
  return [...alisioDynamicProviderState.catalogEntries];
}

export function resolveAlisioDynamicProviderSource(
  providerId: string,
): AlisioDynamicProviderSource | undefined {
  return alisioDynamicProviderState.sources.get(providerId.trim().toLowerCase());
}

export function resolveAlisioDynamicProviderConfig(
  providerId: string,
): AlisioDynamicProviderConfig | undefined {
  const source = resolveAlisioDynamicProviderSource(providerId);
  if (!source) {
    return undefined;
  }
  const api = buildAlisioDynamicProviderApi(source.providerId);
  return {
    provider: source.providerId,
    providerLabel: source.providerLabel,
    api,
    baseUrl: "baseUrl" in source ? source.baseUrl : undefined,
    apiKey: "apiKey" in source ? source.apiKey : undefined,
    models: source.catalogEntries.map((entry) => buildDynamicModelDefinition(entry, api)),
  };
}

export {
  buildAlisioCurrentProviderId,
  buildAlisioServerProviderId,
  buildAlisioTargetProviderId,
  isAlisioDynamicProvider,
};
