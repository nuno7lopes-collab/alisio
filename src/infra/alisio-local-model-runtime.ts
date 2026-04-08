import { ALISIO_LOCAL_MODEL_BACKEND } from "../shared/alisio-local-models.js";
import { fetchOpenAiCompatibleEndpoint } from "../shared/openai-compatible-endpoints.js";
import { legacyEnvKey, readEnv } from "./env.js";
import type { AlisioModelHardwareProfile } from "./model-hardware.js";
import { inspectLocalModelHardwareProfile } from "./model-hardware.js";

export type AlisioInstalledLocalModel = {
  id: string;
  name: string;
  ownedBy?: string;
};

export type AlisioLocalModelRuntimeStatus = "ready" | "not_configured" | "error";

export type AlisioLocalModelRuntimeInspection = {
  backend: typeof ALISIO_LOCAL_MODEL_BACKEND;
  status: AlisioLocalModelRuntimeStatus;
  message?: string;
  models: AlisioInstalledLocalModel[];
  hardware?: AlisioModelHardwareProfile;
};

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

function normalizeInstalledModels(payload: unknown): AlisioInstalledLocalModel[] {
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

export async function inspectLocalModelRuntime(params: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AlisioLocalModelRuntimeInspection> {
  const { baseUrl, authHeader } = resolveLocalModelRuntimeConfig(params.env);
  const hardware = inspectLocalModelHardwareProfile();
  if (!baseUrl) {
    return {
      backend: ALISIO_LOCAL_MODEL_BACKEND,
      status: "not_configured",
      message: "local model runtime not configured on this computer",
      models: [],
      hardware,
    };
  }

  const headers: Record<string, string> = {};
  if (authHeader) {
    headers.authorization = authHeader;
  }

  try {
    const response = await fetchOpenAiCompatibleEndpoint({
      baseUrl,
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
        backend: ALISIO_LOCAL_MODEL_BACKEND,
        status: "error",
        message: `local model runtime request failed (${response.status}): ${message || response.statusText}`,
        models: [],
        hardware,
      };
    }
    const payload = (await response.json()) as unknown;
    return {
      backend: ALISIO_LOCAL_MODEL_BACKEND,
      status: "ready",
      models: normalizeInstalledModels(payload),
      hardware,
    };
  } catch (error) {
    return {
      backend: ALISIO_LOCAL_MODEL_BACKEND,
      status: "error",
      message: String(error),
      models: [],
      hardware,
    };
  }
}
