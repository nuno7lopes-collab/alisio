import { resolveOllamaApiBase } from "../plugin-sdk/ollama-surface.js";
import {
  ALISIO_LOCAL_MODEL_BACKEND,
  listPublishedAlisioLocalModels,
} from "../shared/alisio-local-models.js";
import { fetchOpenAiCompatibleEndpoint } from "../shared/openai-compatible-endpoints.js";
import { legacyEnvKey, readEnv } from "./env.js";
import {
  buildRuntimeCapabilities,
  type AvailableModel,
  type InstalledModel,
  type LocalRuntimeKind,
  type RuntimeCapabilities,
} from "./local-model-runtime-contracts.js";
import type { AlisioModelHardwareProfile, AlisioModelRecommendation } from "./model-hardware.js";
import {
  inspectLocalModelHardwareProfile,
  summarizeHardwareRecommendation,
} from "./model-hardware.js";

export type AlisioInstalledLocalModel = InstalledModel;

export type AlisioLocalModelRuntimeStatus = "ready" | "not_configured" | "error";
export type AlisioLocalRuntimeKind = LocalRuntimeKind;

export type AlisioAvailableLocalModel = AvailableModel & {
  recommendation?: AlisioModelRecommendation;
};

export type AlisioLocalModelRuntimeInspection = {
  backend: typeof ALISIO_LOCAL_MODEL_BACKEND;
  runtimeKind: AlisioLocalRuntimeKind;
  runtimeLabel: string;
  status: AlisioLocalModelRuntimeStatus;
  message?: string;
  models: AlisioInstalledLocalModel[];
  availableModels: AlisioAvailableLocalModel[];
  hardware?: AlisioModelHardwareProfile;
  capabilities: RuntimeCapabilities;
  supportsInstall: boolean;
  supportsUpdate: boolean;
  supportsUninstall: boolean;
  consentRequired: boolean;
};

export type LocalRuntimeInspectParams = {
  baseUrl: string;
  apiKey: string | null;
  authHeader: string | null;
  configured: boolean;
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
  runtimeKind: Extract<
    AlisioLocalRuntimeKind,
    "ollama" | "lmstudio" | typeof ALISIO_LOCAL_MODEL_BACKEND
  >;
  summary: string;
  parametersBillions: number;
  quantization?: string;
  diskGb: number;
  memoryGb: number;
  ownedBy?: string;
};

type LocalEndpointRuntimeKind = Extract<
  AlisioLocalRuntimeKind,
  "ollama" | "lmstudio" | "openai-compatible"
>;

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

const lmStudioMarketplaceCatalog = [
  {
    id: "gpt-oss-20b",
    name: "gpt-oss-20b",
    runtimeKind: "lmstudio",
    summary: "Servido pelo LM Studio local quando o servidor OpenAI-compatible está activo.",
    parametersBillions: 20,
    diskGb: 13,
    memoryGb: 16,
    ownedBy: "lmstudio",
  },
] satisfies readonly SuggestedLocalModelCatalogEntry[];

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_LM_STUDIO_BASE_URL = "http://127.0.0.1:1234";
const OLLAMA_INSTALL_CAPABILITIES = buildRuntimeCapabilities({
  install: true,
  update: true,
  uninstall: true,
  consentRequired: true,
});
const LM_STUDIO_CAPABILITIES = buildRuntimeCapabilities({ startServer: true });
const OPENAI_COMPAT_CAPABILITIES = buildRuntimeCapabilities();

type LocalRuntimeCandidate = {
  kind: LocalEndpointRuntimeKind;
  baseUrl: string;
  apiKey: string | null;
  authHeader: string | null;
  configured: boolean;
};

function resolveRuntimeLabel(runtimeKind: AlisioLocalRuntimeKind) {
  switch (runtimeKind) {
    case "lmstudio":
      return "LM Studio";
    case "ollama":
      return "Ollama";
    case "openai-compatible":
      return "OpenAI-compatible";
    default:
      return "Local GGUF";
  }
}

function buildEmptyInspection(params: {
  runtimeKind: AlisioLocalRuntimeKind;
  status: AlisioLocalModelRuntimeStatus;
  message?: string;
  hardware?: AlisioModelHardwareProfile;
  availableModels?: AlisioAvailableLocalModel[];
  capabilities?: Partial<RuntimeCapabilities>;
}): AlisioLocalModelRuntimeInspection {
  const capabilities = buildRuntimeCapabilities(params.capabilities);
  return {
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    runtimeKind: params.runtimeKind,
    runtimeLabel: resolveRuntimeLabel(params.runtimeKind),
    status: params.status,
    message: params.message,
    models: [],
    availableModels: params.availableModels ?? [],
    hardware: params.hardware,
    capabilities,
    supportsInstall: capabilities.install,
    supportsUpdate: capabilities.update,
    supportsUninstall: capabilities.uninstall,
    consentRequired: capabilities.consentRequired,
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
  runtimeKind: Extract<AlisioLocalRuntimeKind, "lmstudio" | "openai-compatible">,
): AlisioAvailableLocalModel[] {
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    runtimeKind,
    ownedBy: model.ownedBy,
  }));
}

function isDetectorMissStatus(status: number) {
  return status === 404 || status === 405 || status === 501;
}

function normalizeRuntimeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function isOllamaBaseUrl(value: string) {
  return (
    normalizeRuntimeBaseUrl(resolveOllamaApiBase(value)) ===
    normalizeRuntimeBaseUrl(resolveOllamaApiBase(DEFAULT_OLLAMA_BASE_URL))
  );
}

function isLmStudioBaseUrl(value: string) {
  const normalized = normalizeRuntimeBaseUrl(value);
  return (
    normalized === normalizeRuntimeBaseUrl(DEFAULT_LM_STUDIO_BASE_URL) ||
    normalized === `${normalizeRuntimeBaseUrl(DEFAULT_LM_STUDIO_BASE_URL)}/v1`
  );
}

function looksLikeLmStudioPayload(payload: unknown) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { data?: unknown[] }).data)
  ) {
    return false;
  }
  return (payload as { data: unknown[] }).data.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const ownedBy =
      typeof (entry as { owned_by?: unknown }).owned_by === "string"
        ? (entry as { owned_by: string }).owned_by.trim().toLowerCase()
        : "";
    return ownedBy === "lmstudio" || ownedBy === "lm-studio";
  });
}

export function resolveConfiguredLocalRuntimeKind(baseUrl: string): LocalEndpointRuntimeKind {
  if (isOllamaBaseUrl(baseUrl)) {
    return "ollama";
  }
  if (isLmStudioBaseUrl(baseUrl)) {
    return "lmstudio";
  }
  return "openai-compatible";
}

function resolveLocalRuntimeCandidates(
  env: NodeJS.ProcessEnv = process.env,
): LocalRuntimeCandidate[] {
  const { baseUrl, apiKey, authHeader } = resolveLocalModelRuntimeConfig(env);
  const candidates = new Map<string, LocalRuntimeCandidate>();
  const addCandidate = (
    kind: LocalRuntimeCandidate["kind"],
    candidateBaseUrl: string,
    configured: boolean,
  ) => {
    const normalizedBaseUrl = candidateBaseUrl.trim().replace(/\/+$/, "");
    if (!normalizedBaseUrl) {
      return;
    }
    const key = `${kind}::${normalizedBaseUrl.toLowerCase()}`;
    if (candidates.has(key)) {
      const existing = candidates.get(key);
      if (existing && configured && !existing.configured) {
        candidates.set(key, { ...existing, configured: true });
      }
      return;
    }
    candidates.set(key, {
      kind,
      baseUrl: normalizedBaseUrl,
      apiKey,
      authHeader,
      configured,
    });
  };

  if (baseUrl) {
    addCandidate(resolveConfiguredLocalRuntimeKind(baseUrl), baseUrl, true);
  }
  addCandidate("ollama", DEFAULT_OLLAMA_BASE_URL, false);
  addCandidate("lmstudio", DEFAULT_LM_STUDIO_BASE_URL, false);
  return [...candidates.values()];
}

function chooseBetterInspection(
  current: AlisioLocalModelRuntimeInspection | undefined,
  next: AlisioLocalModelRuntimeInspection,
) {
  if (!current) {
    return next;
  }
  const rank = (inspection: AlisioLocalModelRuntimeInspection) => {
    if (inspection.status === "ready" && inspection.models.length > 0) {
      return 4;
    }
    if (inspection.status === "ready") {
      return 3;
    }
    if (inspection.status === "error") {
      return 2;
    }
    return 1;
  };
  return rank(next) > rank(current) ? next : current;
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
        detected: true,
        inspection: buildEmptyInspection({
          runtimeKind: "ollama",
          status: params.configured ? "error" : "not_configured",
          message: params.configured
            ? "Ollama did not respond"
            : "Start Ollama on this device to list and manage installed models.",
          hardware: params.hardware,
          availableModels: buildSuggestedAvailableModels(ollamaMarketplaceCatalog, params.hardware),
          capabilities: OLLAMA_INSTALL_CAPABILITIES,
        }),
      };
    }

    if (!tagsResponse.ok) {
      const message = await tagsResponse.text().catch(() => tagsResponse.statusText);
      return {
        detected: true,
        inspection: buildEmptyInspection({
          runtimeKind: "ollama",
          status:
            !params.configured && isDetectorMissStatus(tagsResponse.status)
              ? "not_configured"
              : "error",
          message:
            !params.configured && isDetectorMissStatus(tagsResponse.status)
              ? "Start Ollama on this device to list and manage installed models."
              : `Ollama request failed (${tagsResponse.status}): ${message || tagsResponse.statusText}`,
          hardware: params.hardware,
          availableModels: buildSuggestedAvailableModels(ollamaMarketplaceCatalog, params.hardware),
          capabilities: OLLAMA_INSTALL_CAPABILITIES,
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
        runtimeLabel: resolveRuntimeLabel("ollama"),
        status: "ready",
        models,
        availableModels: buildSuggestedAvailableModels(ollamaMarketplaceCatalog, params.hardware),
        hardware: params.hardware,
        capabilities: OLLAMA_INSTALL_CAPABILITIES,
        supportsInstall: true,
        supportsUpdate: true,
        supportsUninstall: true,
        consentRequired: true,
      },
    };
  },
};

const lmStudioRuntime: LocalRuntime = {
  kind: "lmstudio",
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
          signal: AbortSignal.timeout(5_000),
        },
      });
      if (!response.ok) {
        const message = await response.text().catch(() => response.statusText);
        return {
          detected: true,
          inspection: buildEmptyInspection({
            runtimeKind: "lmstudio",
            status:
              !params.configured && isDetectorMissStatus(response.status)
                ? "not_configured"
                : "error",
            message:
              !params.configured && isDetectorMissStatus(response.status)
                ? "Start the LM Studio local server on this device to expose models here."
                : `LM Studio request failed (${response.status}): ${message || response.statusText}`,
            hardware: params.hardware,
            capabilities: LM_STUDIO_CAPABILITIES,
          }),
        };
      }
      const payload = (await response.json()) as unknown;
      const models = normalizeOpenAiInstalledModels(payload);
      return {
        detected: true,
        inspection: {
          backend: ALISIO_LOCAL_MODEL_BACKEND,
          runtimeKind: "lmstudio",
          runtimeLabel: resolveRuntimeLabel("lmstudio"),
          status: "ready",
          models,
          availableModels: toOpenAiAvailableModels(models, "lmstudio"),
          hardware: params.hardware,
          capabilities: LM_STUDIO_CAPABILITIES,
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
          runtimeKind: "lmstudio",
          status: params.configured ? "error" : "not_configured",
          message: params.configured
            ? String(error)
            : "Start the LM Studio local server on this device to expose models here.",
          hardware: params.hardware,
          capabilities: LM_STUDIO_CAPABILITIES,
        }),
      };
    }
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
            capabilities: OPENAI_COMPAT_CAPABILITIES,
          }),
        };
      }
      const payload = (await response.json()) as unknown;
      const runtimeKind = looksLikeLmStudioPayload(payload) ? "lmstudio" : "openai-compatible";
      const models = normalizeOpenAiInstalledModels(payload);
      return {
        detected: true,
        inspection: {
          backend: ALISIO_LOCAL_MODEL_BACKEND,
          runtimeKind,
          runtimeLabel: resolveRuntimeLabel(runtimeKind),
          status: "ready",
          models,
          availableModels: toOpenAiAvailableModels(models, runtimeKind),
          hardware: params.hardware,
          capabilities:
            runtimeKind === "lmstudio" ? LM_STUDIO_CAPABILITIES : OPENAI_COMPAT_CAPABILITIES,
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
          capabilities: OPENAI_COMPAT_CAPABILITIES,
        }),
      };
    }
  },
};

const localEndpointRuntimes = [
  ollamaRuntime,
  lmStudioRuntime,
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

export function listLmStudioAvailableModels(
  hardware?: AlisioModelHardwareProfile,
): AlisioAvailableLocalModel[] {
  return buildSuggestedAvailableModels(lmStudioMarketplaceCatalog, hardware);
}

export function resolveCurrentRuntimeBaseUrlForKind(params: {
  runtimeKind: LocalEndpointRuntimeKind;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const runtimeConfig = resolveLocalModelRuntimeConfig(env);
  const configuredKind = runtimeConfig.baseUrl
    ? resolveConfiguredLocalRuntimeKind(runtimeConfig.baseUrl)
    : null;
  if (params.runtimeKind === "ollama") {
    return configuredKind === "ollama" ? runtimeConfig.baseUrl : DEFAULT_OLLAMA_BASE_URL;
  }
  if (params.runtimeKind === "lmstudio") {
    return configuredKind === "lmstudio" ? runtimeConfig.baseUrl : DEFAULT_LM_STUDIO_BASE_URL;
  }
  return configuredKind === "openai-compatible" ? runtimeConfig.baseUrl : null;
}

function resolveOllamaManagementBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const { baseUrl } = resolveLocalModelRuntimeConfig(env);
  return baseUrl && resolveConfiguredLocalRuntimeKind(baseUrl) === "ollama"
    ? baseUrl
    : DEFAULT_OLLAMA_BASE_URL;
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
  const env = params.env ?? process.env;
  const { authHeader } = resolveLocalModelRuntimeConfig(env);
  const baseUrl = resolveOllamaManagementBaseUrl(env);

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
  const env = params.env ?? process.env;
  const { authHeader } = resolveLocalModelRuntimeConfig(env);
  const baseUrl = resolveOllamaManagementBaseUrl(env);

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

export async function inspectLocalModelRuntimes(params: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AlisioLocalModelRuntimeInspection[]> {
  const hardware = inspectLocalModelHardwareProfile();
  const inspectionsByRuntime = new Map<AlisioLocalRuntimeKind, AlisioLocalModelRuntimeInspection>();

  for (const candidate of resolveLocalRuntimeCandidates(params.env)) {
    const runtime = localEndpointRuntimes.find((entry) => entry.kind === candidate.kind);
    if (!runtime) {
      continue;
    }
    const result = await runtime.inspect({
      baseUrl: candidate.baseUrl,
      apiKey: candidate.apiKey,
      authHeader: candidate.authHeader,
      configured: candidate.configured,
      hardware,
      fetchImpl: params.fetchImpl,
    });
    inspectionsByRuntime.set(
      result.inspection.runtimeKind,
      chooseBetterInspection(
        inspectionsByRuntime.get(result.inspection.runtimeKind),
        result.inspection,
      ),
    );
  }

  return [...inspectionsByRuntime.values()].toSorted((left, right) => {
    if (left.status === "ready" && right.status !== "ready") {
      return -1;
    }
    if (right.status === "ready" && left.status !== "ready") {
      return 1;
    }
    const leftInstallable = Number(Boolean(left.supportsInstall));
    const rightInstallable = Number(Boolean(right.supportsInstall));
    if (leftInstallable !== rightInstallable) {
      return rightInstallable - leftInstallable;
    }
    return left.runtimeLabel.localeCompare(right.runtimeLabel);
  });
}

export async function inspectLocalModelRuntime(params: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AlisioLocalModelRuntimeInspection> {
  const inspections = await inspectLocalModelRuntimes(params);
  return (
    inspections[0] ??
    buildEmptyInspection({
      runtimeKind: "openai-compatible",
      status: "not_configured",
      message: "local model runtime not configured on this computer",
      hardware: inspectLocalModelHardwareProfile(),
      capabilities: OPENAI_COMPAT_CAPABILITIES,
    })
  );
}
