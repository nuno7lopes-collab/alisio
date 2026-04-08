import { resolveOllamaApiBase } from "../plugin-sdk/ollama-surface.js";
import {
  ALISIO_LOCAL_MODEL_BACKEND,
  listPublishedAlisioLocalModels,
} from "../shared/alisio-local-models.js";
import { fetchOpenAiCompatibleEndpoint } from "../shared/openai-compatible-endpoints.js";
import { legacyEnvKey, readEnv } from "./env.js";
import type { AlisioModelHardwareProfile, AlisioModelRecommendation } from "./model-hardware.js";
import {
  inspectLocalModelHardwareProfile,
  summarizeHardwareRecommendation,
} from "./model-hardware.js";

export type AlisioInstalledLocalModel = {
  id: string;
  name: string;
  ownedBy?: string;
  running?: boolean;
};

export type AlisioLocalModelRuntimeStatus = "ready" | "not_configured" | "error";
export type AlisioLocalRuntimeKind =
  | typeof ALISIO_LOCAL_MODEL_BACKEND
  | "ollama"
  | "openai-compatible";

export type AlisioAvailableLocalModel = {
  id: string;
  name: string;
  runtimeKind: AlisioLocalRuntimeKind;
  summary?: string;
  ownedBy?: string;
  parametersBillions?: number;
  quantization?: string;
  diskGb?: number;
  memoryGb?: number;
  recommendation?: AlisioModelRecommendation;
};

export type AlisioLocalModelRuntimeInspection = {
  backend: typeof ALISIO_LOCAL_MODEL_BACKEND;
  runtimeKind: AlisioLocalRuntimeKind;
  status: AlisioLocalModelRuntimeStatus;
  message?: string;
  models: AlisioInstalledLocalModel[];
  availableModels: AlisioAvailableLocalModel[];
  hardware?: AlisioModelHardwareProfile;
  supportsInstall: boolean;
  supportsUpdate: boolean;
  supportsUninstall: boolean;
  consentRequired: boolean;
};

export type LocalRuntimeInspectParams = {
  baseUrl: string;
  apiKey: string | null;
  authHeader: string | null;
  hardware?: AlisioModelHardwareProfile;
  fetchImpl?: typeof fetch;
};

type LocalRuntimeInspectResult = {
  detected: boolean;
  inspection: AlisioLocalModelRuntimeInspection;
};

export interface LocalRuntime {
  kind: AlisioLocalRuntimeKind;
  inspect(params: LocalRuntimeInspectParams): Promise<LocalRuntimeInspectResult>;
}

type SuggestedLocalModelCatalogEntry = {
  id: string;
  name: string;
  runtimeKind: Extract<AlisioLocalRuntimeKind, "ollama" | typeof ALISIO_LOCAL_MODEL_BACKEND>;
  summary: string;
  parametersBillions: number;
  quantization?: string;
  diskGb: number;
  memoryGb: number;
  ownedBy?: string;
};

const publishedMarketplaceCatalog = listPublishedAlisioLocalModels();
const ollamaMarketplaceCatalog = [
  {
    id: "qwen3:4b",
    name: "Qwen3 4B",
    runtimeKind: "ollama",
    summary: "Perfil leve para portáteis e máquinas do dia a dia.",
    parametersBillions: 4,
    diskGb: 3.3,
    memoryGb: 8,
    ownedBy: "ollama",
  },
  {
    id: "qwen3:8b",
    name: "Qwen3 8B",
    runtimeKind: "ollama",
    summary: "Equilíbrio recomendado entre qualidade, velocidade e memória.",
    parametersBillions: 8,
    diskGb: 5.1,
    memoryGb: 12,
    ownedBy: "ollama",
  },
  {
    id: "qwen3:32b",
    name: "Qwen3 32B",
    runtimeKind: "ollama",
    summary: "Perfil máximo para desktops fortes e computadores dedicados a IA local.",
    parametersBillions: 32,
    diskGb: 19.8,
    memoryGb: 32,
    ownedBy: "ollama",
  },
] satisfies readonly SuggestedLocalModelCatalogEntry[];

function buildEmptyInspection(params: {
  runtimeKind: AlisioLocalRuntimeKind;
  status: AlisioLocalModelRuntimeStatus;
  message?: string;
  hardware?: AlisioModelHardwareProfile;
  availableModels?: AlisioAvailableLocalModel[];
  supportsInstall?: boolean;
  supportsUpdate?: boolean;
  supportsUninstall?: boolean;
  consentRequired?: boolean;
}): AlisioLocalModelRuntimeInspection {
  return {
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    runtimeKind: params.runtimeKind,
    status: params.status,
    message: params.message,
    models: [],
    availableModels: params.availableModels ?? [],
    hardware: params.hardware,
    supportsInstall: params.supportsInstall ?? false,
    supportsUpdate: params.supportsUpdate ?? false,
    supportsUninstall: params.supportsUninstall ?? false,
    consentRequired: params.consentRequired ?? false,
  };
}

function buildSuggestedAvailableModels(
  catalog: readonly SuggestedLocalModelCatalogEntry[],
  hardware: AlisioModelHardwareProfile | undefined,
): AlisioAvailableLocalModel[] {
  const recommendationById = new Map<string, AlisioModelRecommendation>();
  if (hardware) {
    const summarized = summarizeHardwareRecommendation(hardware, catalog);
    for (const recommendation of summarized.recommendations) {
      recommendationById.set(recommendation.modelId, recommendation);
    }
  }
  return catalog.map((entry) => ({
    id: entry.id,
    name: entry.name,
    runtimeKind: entry.runtimeKind,
    summary: entry.summary,
    ownedBy: entry.ownedBy,
    parametersBillions: entry.parametersBillions,
    quantization: entry.quantization,
    diskGb: entry.diskGb,
    memoryGb: entry.memoryGb,
    recommendation: recommendationById.get(entry.id),
  }));
}

export function resolveLocalModelRuntimeConfig(env: NodeJS.ProcessEnv = process.env): {
  baseUrl: string | null;
  apiKey: string | null;
  authHeader: string | null;
} {
  const baseUrlRaw = readEnv("ALISIO_NODE_MODEL_BASE_URL", {
    env,
    fallback: legacyEnvKey("NODE_MODEL_BASE_URL"),
    description: "local model runtime base URL",
  })?.trim();
  const apiKey =
    readEnv("ALISIO_NODE_MODEL_API_KEY", {
      env,
      fallback: legacyEnvKey("NODE_MODEL_API_KEY"),
      description: "local model runtime API key",
      redact: true,
    })?.trim() || env.OPENAI_API_KEY?.trim();
  return {
    baseUrl: baseUrlRaw ? baseUrlRaw.replace(/\/+$/, "") : null,
    apiKey: apiKey || null,
    authHeader: apiKey ? `Bearer ${apiKey}` : null,
  };
}

function normalizeOpenAiInstalledModels(payload: unknown): AlisioInstalledLocalModel[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { data?: unknown[] }).data)
  ) {
    return [];
  }
  return (payload as { data: unknown[] }).data.reduce<AlisioInstalledLocalModel[]>(
    (models, entry) => {
      if (!entry || typeof entry !== "object") {
        return models;
      }
      const id =
        typeof (entry as { id?: unknown }).id === "string"
          ? (entry as { id: string }).id.trim()
          : "";
      if (!id) {
        return models;
      }
      const ownedBy =
        typeof (entry as { owned_by?: unknown }).owned_by === "string"
          ? (entry as { owned_by: string }).owned_by.trim() || undefined
          : undefined;
      models.push({
        id,
        name: id,
        ownedBy,
      });
      return models;
    },
    [],
  );
}

function normalizeOllamaRunningModelIds(payload: unknown): Set<string> {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { models?: unknown[] }).models)
  ) {
    return new Set();
  }
  return new Set(
    ((payload as { models: unknown[] }).models ?? [])
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const nameCandidate =
          typeof (entry as { name?: unknown }).name === "string"
            ? (entry as { name: string }).name.trim()
            : typeof (entry as { model?: unknown }).model === "string"
              ? (entry as { model: string }).model.trim()
              : "";
        return nameCandidate ? [nameCandidate.toLowerCase()] : [];
      })
      .filter(Boolean),
  );
}

function normalizeOllamaInstalledModels(
  payload: unknown,
  runningModelIds: Set<string>,
): AlisioInstalledLocalModel[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { models?: unknown[] }).models)
  ) {
    return [];
  }
  const byKey = new Map<string, AlisioInstalledLocalModel>();
  for (const entry of (payload as { models: unknown[] }).models ?? []) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const name =
      typeof (entry as { name?: unknown }).name === "string"
        ? (entry as { name: string }).name.trim()
        : "";
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (byKey.has(key)) {
      continue;
    }
    byKey.set(key, {
      id: name,
      name,
      ownedBy: "ollama",
      ...(runningModelIds.has(key) ? { running: true } : {}),
    });
  }
  return [...byKey.values()].toSorted((left, right) => {
    const runningDelta = Number(Boolean(right.running)) - Number(Boolean(left.running));
    if (runningDelta !== 0) {
      return runningDelta;
    }
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}

function toOpenAiAvailableModels(
  models: readonly AlisioInstalledLocalModel[],
): AlisioAvailableLocalModel[] {
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    runtimeKind: "openai-compatible",
    ownedBy: model.ownedBy,
  }));
}

function isDetectorMissStatus(status: number) {
  return status === 404 || status === 405 || status === 501;
}

const ollamaRuntime: LocalRuntime = {
  kind: "ollama",
  async inspect(params) {
    const headers: Record<string, string> = {};
    if (params.authHeader) {
      headers.authorization = params.authHeader;
    }
    const apiBase = resolveOllamaApiBase(params.baseUrl);
    let tagsResponse: Response;
    try {
      tagsResponse = await (params.fetchImpl ?? fetch)(`${apiBase}/api/tags`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      return {
        detected: false,
        inspection: buildEmptyInspection({
          runtimeKind: "ollama",
          status: "error",
          message: "Ollama did not respond",
          hardware: params.hardware,
          availableModels: buildSuggestedAvailableModels(ollamaMarketplaceCatalog, params.hardware),
          supportsInstall: true,
          supportsUpdate: true,
          supportsUninstall: true,
          consentRequired: true,
        }),
      };
    }

    if (!tagsResponse.ok) {
      const message = await tagsResponse.text().catch(() => tagsResponse.statusText);
      return {
        detected: !isDetectorMissStatus(tagsResponse.status),
        inspection: buildEmptyInspection({
          runtimeKind: "ollama",
          status: "error",
          message: `Ollama request failed (${tagsResponse.status}): ${message || tagsResponse.statusText}`,
          hardware: params.hardware,
          availableModels: buildSuggestedAvailableModels(ollamaMarketplaceCatalog, params.hardware),
          supportsInstall: true,
          supportsUpdate: true,
          supportsUninstall: true,
          consentRequired: true,
        }),
      };
    }

    const tagsPayload = (await tagsResponse.json()) as unknown;
    let runningModelIds = new Set<string>();
    try {
      const psResponse = await (params.fetchImpl ?? fetch)(`${apiBase}/api/ps`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(3_000),
      });
      if (psResponse.ok) {
        runningModelIds = normalizeOllamaRunningModelIds((await psResponse.json()) as unknown);
      }
    } catch {
      // Best-effort only. /api/ps enriches the local view but should not block listing.
    }

    const models = normalizeOllamaInstalledModels(tagsPayload, runningModelIds);
    return {
      detected: true,
      inspection: {
        backend: ALISIO_LOCAL_MODEL_BACKEND,
        runtimeKind: "ollama",
        status: "ready",
        models,
        availableModels: buildSuggestedAvailableModels(ollamaMarketplaceCatalog, params.hardware),
        hardware: params.hardware,
        supportsInstall: true,
        supportsUpdate: true,
        supportsUninstall: true,
        consentRequired: true,
      },
    };
  },
};

const openAiCompatibleRuntime: LocalRuntime = {
  kind: "openai-compatible",
  async inspect(params) {
    const headers: Record<string, string> = {};
    if (params.authHeader) {
      headers.authorization = params.authHeader;
    }

    try {
      const response = await fetchOpenAiCompatibleEndpoint({
        baseUrl: params.baseUrl,
        endpoint: "models",
        fetchImpl: params.fetchImpl,
        init: {
          method: "GET",
          headers,
        },
      });
      if (!response.ok) {
        const message = await response.text().catch(() => response.statusText);
        return {
          detected: true,
          inspection: buildEmptyInspection({
            runtimeKind: "openai-compatible",
            status: "error",
            message: `local model runtime request failed (${response.status}): ${message || response.statusText}`,
            hardware: params.hardware,
          }),
        };
      }
      const payload = (await response.json()) as unknown;
      const models = normalizeOpenAiInstalledModels(payload);
      return {
        detected: true,
        inspection: {
          backend: ALISIO_LOCAL_MODEL_BACKEND,
          runtimeKind: "openai-compatible",
          status: "ready",
          models,
          availableModels: toOpenAiAvailableModels(models),
          hardware: params.hardware,
          supportsInstall: false,
          supportsUpdate: false,
          supportsUninstall: false,
          consentRequired: false,
        },
      };
    } catch (error) {
      return {
        detected: true,
        inspection: buildEmptyInspection({
          runtimeKind: "openai-compatible",
          status: "error",
          message: String(error),
          hardware: params.hardware,
        }),
      };
    }
  },
};

const localEndpointRuntimes = [
  ollamaRuntime,
  openAiCompatibleRuntime,
] satisfies readonly LocalRuntime[];

export function listSupportedLocalRuntimes(): readonly LocalRuntime[] {
  return localEndpointRuntimes;
}

export function listManagedLocalAvailableModels(
  hardware?: AlisioModelHardwareProfile,
): AlisioAvailableLocalModel[] {
  return buildSuggestedAvailableModels(
    publishedMarketplaceCatalog.map((entry) => ({
      id: entry.id,
      name: entry.name,
      runtimeKind: ALISIO_LOCAL_MODEL_BACKEND,
      summary: entry.summary,
      parametersBillions: entry.parametersBillions,
      quantization: entry.quantization,
      diskGb: entry.diskGb,
      memoryGb: entry.memoryGb,
      ownedBy: entry.backend,
    })),
    hardware,
  );
}

export function listOllamaAvailableModels(
  hardware?: AlisioModelHardwareProfile,
): AlisioAvailableLocalModel[] {
  return buildSuggestedAvailableModels(ollamaMarketplaceCatalog, hardware);
}

function buildLocalRuntimeHeaders(params: { authHeader: string | null; includeJson?: boolean }) {
  return {
    ...(params.includeJson ? { "content-type": "application/json" } : {}),
    ...(params.authHeader ? { authorization: params.authHeader } : {}),
  };
}

export async function installOllamaLocalModel(params: {
  modelId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  onProgress?: (status: { totalSize: number; downloadedSize: number }) => void;
}): Promise<AlisioInstalledLocalModel> {
  const { baseUrl, authHeader } = resolveLocalModelRuntimeConfig(params.env);
  if (!baseUrl) {
    throw new Error("local model runtime not configured on this computer");
  }

  const response = await (params.fetchImpl ?? fetch)(`${resolveOllamaApiBase(baseUrl)}/api/pull`, {
    method: "POST",
    headers: buildLocalRuntimeHeaders({ authHeader, includeJson: true }),
    body: JSON.stringify({
      model: params.modelId,
      stream: true,
    }),
    signal: AbortSignal.timeout(1_800_000),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Ollama request failed (${response.status}): ${message || response.statusText}`,
    );
  }
  if (!response.body) {
    return {
      id: params.modelId,
      name: params.modelId,
      ownedBy: "ollama",
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const payload = JSON.parse(trimmed) as {
          completed?: number;
          total?: number;
        };
        if (
          typeof payload.completed === "number" &&
          Number.isFinite(payload.completed) &&
          typeof payload.total === "number" &&
          Number.isFinite(payload.total) &&
          payload.total > 0
        ) {
          params.onProgress?.({
            downloadedSize: payload.completed,
            totalSize: payload.total,
          });
        }
      }
      if (done) {
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    id: params.modelId,
    name: params.modelId,
    ownedBy: "ollama",
  };
}

export async function uninstallOllamaLocalModel(params: {
  modelId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AlisioInstalledLocalModel> {
  const { baseUrl, authHeader } = resolveLocalModelRuntimeConfig(params.env);
  if (!baseUrl) {
    throw new Error("local model runtime not configured on this computer");
  }

  const response = await (params.fetchImpl ?? fetch)(
    `${resolveOllamaApiBase(baseUrl)}/api/delete`,
    {
      method: "DELETE",
      headers: buildLocalRuntimeHeaders({ authHeader, includeJson: true }),
      body: JSON.stringify({ model: params.modelId }),
      signal: AbortSignal.timeout(300_000),
    },
  );
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Ollama request failed (${response.status}): ${message || response.statusText}`,
    );
  }

  return {
    id: params.modelId,
    name: params.modelId,
    ownedBy: "ollama",
  };
}

export async function inspectLocalModelRuntime(params: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AlisioLocalModelRuntimeInspection> {
  const { baseUrl, apiKey, authHeader } = resolveLocalModelRuntimeConfig(params.env);
  const hardware = inspectLocalModelHardwareProfile();
  if (!baseUrl) {
    return buildEmptyInspection({
      runtimeKind: "openai-compatible",
      status: "not_configured",
      message: "local model runtime not configured on this computer",
      hardware,
    });
  }

  for (const runtime of localEndpointRuntimes) {
    const result = await runtime.inspect({
      baseUrl,
      apiKey,
      authHeader,
      hardware,
      fetchImpl: params.fetchImpl,
    });
    if (result.detected) {
      return result.inspection;
    }
  }

  return buildEmptyInspection({
    runtimeKind: "openai-compatible",
    status: "error",
    message: "local model runtime did not match a supported connector",
    hardware,
  });
}
