import { DEFAULT_CONTEXT_TOKENS } from "../agents/defaults.js";
import type { ModelCatalogEntry } from "../agents/model-catalog.js";
import type { OpenClawConfig } from "../config/config.js";
import type { ModelDefinitionConfig, ModelProviderConfig } from "../config/types.js";
import { resolveOllamaApiBase } from "../plugin-sdk/ollama-surface.js";
import { ALISIO_REMOTE_PROVIDER_ID } from "../shared/alisio-remote-model-provider.js";
import {
  listAlisioRemoteModelServers,
  type AlisioRemoteModelServer,
  type AlisioRemoteModelServerKind,
} from "./alisio-store.js";

export type AlisioRemoteListedModel = {
  id: string;
  name: string;
  ownedBy?: string;
};

type ActiveRemoteInspection = {
  server: AlisioRemoteModelServer;
  providerBaseUrl: string;
  models: AlisioRemoteListedModel[];
};

export type AlisioRemoteServerInspection =
  | {
      status: "ready";
      providerBaseUrl: string;
      models: AlisioRemoteListedModel[];
    }
  | {
      status: "error";
      providerBaseUrl: string;
      message?: string;
      models: AlisioRemoteListedModel[];
    };

const providerBaseUrlCache = new Map<string, string>();

function normalizeListedRemoteModels(
  models: readonly AlisioRemoteListedModel[] | undefined,
): AlisioRemoteListedModel[] {
  const byKey = new Map<string, AlisioRemoteListedModel>();
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
      ...(model.ownedBy?.trim() ? { ownedBy: model.ownedBy.trim() } : {}),
    });
  }
  return [...byKey.values()].toSorted(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

function normalizeRemoteServerModels(payload: unknown, kind: AlisioRemoteModelServerKind) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (kind === "ollama") {
    const models = Array.isArray((payload as { models?: unknown[] }).models)
      ? ((payload as { models?: unknown[] }).models ?? [])
      : [];
    return models.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const name =
        typeof (entry as { name?: unknown }).name === "string"
          ? (entry as { name: string }).name.trim()
          : "";
      if (!name) {
        return [];
      }
      return [{ id: name, name, ownedBy: "ollama" }];
    });
  }

  const data = Array.isArray((payload as { data?: unknown[] }).data)
    ? ((payload as { data?: unknown[] }).data ?? [])
    : [];
  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const id =
      typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id.trim() : "";
    if (!id) {
      return [];
    }
    return [
      {
        id,
        name: id,
        ownedBy:
          typeof (entry as { owned_by?: unknown }).owned_by === "string"
            ? (entry as { owned_by: string }).owned_by.trim() || undefined
            : undefined,
      },
    ];
  });
}

function resolveRemoteCatalogTargets(server: AlisioRemoteModelServer) {
  const normalizedBaseUrl = server.baseUrl.replace(/\/+$/, "");
  if (server.kind === "ollama") {
    const providerBaseUrl = resolveOllamaApiBase(normalizedBaseUrl.replace(/\/api$/i, ""));
    return [
      {
        url: `${providerBaseUrl}/api/tags`,
        providerBaseUrl,
      },
    ];
  }
  if (normalizedBaseUrl.toLowerCase().endsWith("/v1")) {
    return [
      {
        url: `${normalizedBaseUrl}/models`,
        providerBaseUrl: normalizedBaseUrl,
      },
    ];
  }
  return [
    {
      url: `${normalizedBaseUrl}/models`,
      providerBaseUrl: normalizedBaseUrl,
    },
    {
      url: `${normalizedBaseUrl}/v1/models`,
      providerBaseUrl: `${normalizedBaseUrl}/v1`,
    },
  ];
}

function buildRemoteProviderBaseUrl(server: AlisioRemoteModelServer) {
  if (server.kind === "ollama") {
    return resolveOllamaApiBase(server.baseUrl);
  }
  const normalizedBaseUrl = server.baseUrl.replace(/\/+$/, "");
  return normalizedBaseUrl.toLowerCase().endsWith("/v1")
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/v1`;
}

function buildRemoteProviderModels(
  models: readonly AlisioRemoteListedModel[],
): ModelDefinitionConfig[] {
  return normalizeListedRemoteModels(models).map((model) => ({
    id: model.id,
    name: model.name,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_TOKENS,
    maxTokens: DEFAULT_CONTEXT_TOKENS,
  }));
}

function buildRemoteProviderConfig(params: {
  server: AlisioRemoteModelServer;
  providerBaseUrl?: string;
  models: readonly AlisioRemoteListedModel[];
}): ModelProviderConfig {
  const api: ModelDefinitionConfig["api"] =
    params.server.kind === "ollama" ? "ollama" : "openai-responses";
  const models = buildRemoteProviderModels(params.models);
  return {
    baseUrl: params.providerBaseUrl ?? buildRemoteProviderBaseUrl(params.server),
    api,
    models,
    ...(params.server.apiKey?.trim() ? { apiKey: params.server.apiKey.trim() } : {}),
  };
}

function mergeRemoteCatalogEntries(
  baseCatalog: readonly ModelCatalogEntry[],
  remoteCatalog: readonly ModelCatalogEntry[],
) {
  if (remoteCatalog.length === 0) {
    return [...baseCatalog];
  }
  const merged = [...baseCatalog];
  const seen = new Set(
    baseCatalog.map(
      (entry) => `${entry.provider.toLowerCase().trim()}::${entry.id.toLowerCase().trim()}`,
    ),
  );
  for (const entry of remoteCatalog) {
    const key = `${entry.provider.toLowerCase().trim()}::${entry.id.toLowerCase().trim()}`;
    if (seen.has(key)) {
      continue;
    }
    merged.push(entry);
    seen.add(key);
  }
  return merged.toSorted((left, right) => {
    const providerOrder = left.provider.localeCompare(right.provider);
    if (providerOrder !== 0) {
      return providerOrder;
    }
    return left.name.localeCompare(right.name);
  });
}

async function getActiveRemoteServer(env?: NodeJS.ProcessEnv) {
  const servers = await listAlisioRemoteModelServers(env);
  return servers.find((server) => server.active) ?? servers[0] ?? null;
}

export async function inspectAlisioRemoteModelServer(
  server: AlisioRemoteModelServer,
  params?: {
    fetchImpl?: typeof fetch;
  },
): Promise<AlisioRemoteServerInspection> {
  const headers: Record<string, string> = {};
  if (server.apiKey?.trim()) {
    headers.authorization = `Bearer ${server.apiKey.trim()}`;
  }
  let lastError = "server did not respond";

  for (const target of resolveRemoteCatalogTargets(server)) {
    try {
      const response = await (params?.fetchImpl ?? fetch)(target.url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`.trim();
        continue;
      }
      const payload = (await response.json()) as unknown;
      providerBaseUrlCache.set(server.serverId, target.providerBaseUrl);
      return {
        status: "ready",
        providerBaseUrl: target.providerBaseUrl,
        models: normalizeListedRemoteModels(normalizeRemoteServerModels(payload, server.kind)),
      };
    } catch (error) {
      lastError = String(error);
    }
  }

  return {
    status: "error",
    providerBaseUrl: buildRemoteProviderBaseUrl(server),
    message: lastError,
    models: [],
  };
}

async function inspectActiveRemoteServer(params?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ActiveRemoteInspection | null> {
  const server = await getActiveRemoteServer(params?.env);
  if (!server) {
    return null;
  }
  const inspection = await inspectAlisioRemoteModelServer(server, {
    fetchImpl: params?.fetchImpl,
  });

  return {
    server,
    providerBaseUrl: inspection.providerBaseUrl,
    models: inspection.models,
  };
}

export async function loadAlisioRemoteCatalogEntries(params?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ModelCatalogEntry[]> {
  const inspection = await inspectActiveRemoteServer(params);
  if (!inspection || inspection.models.length === 0) {
    return [];
  }
  return inspection.models.map((model) => ({
    id: model.id,
    name: model.name,
    provider: ALISIO_REMOTE_PROVIDER_ID,
    input: ["text"],
  }));
}

export async function augmentConfigWithAlisioRemoteProvider(params: {
  config: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  requiredModelIds?: readonly string[];
  inspect?: boolean;
}): Promise<OpenClawConfig> {
  const server = await getActiveRemoteServer(params.env);
  if (!server) {
    return params.config;
  }
  const inspection =
    params.inspect === false
      ? null
      : await inspectActiveRemoteServer({
          env: params.env,
          fetchImpl: params.fetchImpl,
        });

  const requiredModels = (params.requiredModelIds ?? []).flatMap((modelId) => {
    const trimmed = modelId.trim();
    if (!trimmed) {
      return [];
    }
    return [{ id: trimmed, name: trimmed, ownedBy: server.kind }];
  });
  const models = normalizeListedRemoteModels([...(inspection?.models ?? []), ...requiredModels]);
  if (models.length === 0) {
    return params.config;
  }

  const nextProvider = buildRemoteProviderConfig({
    server,
    providerBaseUrl:
      inspection?.providerBaseUrl ?? providerBaseUrlCache.get(server.serverId) ?? undefined,
    models,
  });
  const nextProviders = {
    ...params.config.models?.providers,
    [ALISIO_REMOTE_PROVIDER_ID]: nextProvider,
  };

  return {
    ...params.config,
    models: {
      ...params.config.models,
      providers: nextProviders,
    },
  };
}

export { mergeRemoteCatalogEntries };
