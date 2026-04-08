import { listAgentIds } from "../../agents/agent-scope.js";
import {
  resolveMemorySearchConfig,
  type ResolvedMemorySearchConfig,
} from "../../agents/memory-search.js";
import type { AlisioConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import {
  getActiveMemorySearchManager,
  resolveActiveMemoryBackendConfig,
} from "../../plugins/memory-runtime.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type MemoryStatusConfig,
  type MemoryStatusResult,
  type MemoryStatusRuntime,
  validateMemoryStatusParams,
  validateMemorySyncParams,
} from "../protocol/index.js";
import { formatError } from "../server-utils.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function respondInvalidMethodParams(
  respond: RespondFn,
  method: string,
  errors: Parameters<typeof formatValidationErrors>[0],
): void {
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${method} params: ${formatValidationErrors(errors)}`,
    ),
  );
}

function resolveAgentContext(params: Record<string, unknown>, respond: RespondFn) {
  const cfg = loadConfig();
  const rawAgentId = typeof params.agentId === "string" ? params.agentId : "";
  const agentId = normalizeAgentId(rawAgentId);
  if (!new Set(listAgentIds(cfg)).has(agentId)) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
    return null;
  }
  return { cfg, agentId };
}

function buildMemoryStatusConfig(config: ResolvedMemorySearchConfig): MemoryStatusConfig {
  return {
    provider: config.provider,
    ...(config.model ? { model: config.model } : {}),
    fallback: config.fallback,
    sources: [...config.sources],
    extraPaths: [...config.extraPaths],
    sync: {
      onSessionStart: config.sync.onSessionStart,
      onSearch: config.sync.onSearch,
      watch: config.sync.watch,
      watchDebounceMs: config.sync.watchDebounceMs,
      intervalMinutes: config.sync.intervalMinutes,
    },
    store: {
      driver: config.store.driver,
      path: config.store.path,
      ftsTokenizer: config.store.fts.tokenizer,
      vectorEnabled: config.store.vector.enabled,
    },
  };
}

function buildRuntimeStatus(
  status: ReturnType<
    NonNullable<Awaited<ReturnType<typeof getActiveMemorySearchManager>>["manager"]>["status"]
  >,
  vectorAvailable?: boolean,
): MemoryStatusRuntime {
  const runtime: MemoryStatusRuntime = {
    backend: status.backend,
    provider: status.provider,
  };

  if (status.model) {
    runtime.model = status.model;
  }
  if (status.requestedProvider) {
    runtime.requestedProvider = status.requestedProvider;
  }
  if (typeof status.files === "number") {
    runtime.files = status.files;
  }
  if (typeof status.chunks === "number") {
    runtime.chunks = status.chunks;
  }
  if (typeof status.dirty === "boolean") {
    runtime.dirty = status.dirty;
  }
  if (status.workspaceDir) {
    runtime.workspaceDir = status.workspaceDir;
  }
  if (status.dbPath) {
    runtime.dbPath = status.dbPath;
  }
  if (status.sourceCounts?.length) {
    runtime.sourceCounts = status.sourceCounts.map((entry) => ({
      source: entry.source,
      files: entry.files,
      chunks: entry.chunks,
    }));
  }
  if (status.cache) {
    runtime.cache = {
      enabled: status.cache.enabled,
      ...(typeof status.cache.entries === "number" ? { entries: status.cache.entries } : {}),
      ...(typeof status.cache.maxEntries === "number"
        ? { maxEntries: status.cache.maxEntries }
        : {}),
    };
  }
  if (status.fts) {
    runtime.fts = {
      enabled: status.fts.enabled,
      available: status.fts.available,
      ...(status.fts.error ? { error: status.fts.error } : {}),
    };
  }
  if (status.vector) {
    runtime.vector = {
      enabled: status.vector.enabled,
      ...(typeof status.vector.available === "boolean"
        ? { available: status.vector.available }
        : typeof vectorAvailable === "boolean"
          ? { available: vectorAvailable }
          : {}),
      ...(status.vector.extensionPath ? { extensionPath: status.vector.extensionPath } : {}),
      ...(status.vector.loadError ? { loadError: status.vector.loadError } : {}),
      ...(typeof status.vector.dims === "number" ? { dims: status.vector.dims } : {}),
    };
  }
  if (status.batch) {
    runtime.batch = {
      enabled: status.batch.enabled,
      failures: status.batch.failures,
      limit: status.batch.limit,
      wait: status.batch.wait,
      concurrency: status.batch.concurrency,
      pollIntervalMs: status.batch.pollIntervalMs,
      timeoutMs: status.batch.timeoutMs,
      ...(status.batch.lastError ? { lastError: status.batch.lastError } : {}),
      ...(status.batch.lastProvider ? { lastProvider: status.batch.lastProvider } : {}),
    };
  }

  return runtime;
}

function resolveMemoryBackendSnapshot(params: { cfg: AlisioConfig; agentId: string }) {
  const backend = resolveActiveMemoryBackendConfig(params);
  if (!backend) {
    return undefined;
  }
  if (backend.backend === "qmd") {
    return {
      backend: "qmd" as const,
      ...(backend.qmd?.command ? { command: backend.qmd.command } : {}),
    };
  }
  return { backend: "builtin" as const };
}

function buildStatusWithoutManager(params: {
  agentId: string;
  enabled: boolean;
  config?: MemoryStatusConfig;
  backend?: MemoryStatusResult["backend"];
  managerError?: string;
  configError?: string;
}): MemoryStatusResult {
  const error =
    params.configError ??
    params.managerError ??
    (params.enabled ? "memory search unavailable" : "memory disabled");
  return {
    agentId: params.agentId,
    enabled: params.enabled,
    ...(params.config ? { config: params.config } : {}),
    ...(params.backend ? { backend: params.backend } : {}),
    embedding: { ok: false, error },
    ...(params.managerError ? { managerError: params.managerError } : {}),
    ...(params.configError ? { configError: params.configError } : {}),
  };
}

async function collectManagerStatus(params: {
  agentId: string;
  enabled: boolean;
  manager: NonNullable<Awaited<ReturnType<typeof getActiveMemorySearchManager>>["manager"]>;
  config?: MemoryStatusConfig;
  backend?: MemoryStatusResult["backend"];
}): Promise<MemoryStatusResult> {
  try {
    const status = params.manager.status();
    let vectorAvailable: boolean | undefined;
    if (status.vector?.enabled && status.vector.available === undefined) {
      try {
        vectorAvailable = await params.manager.probeVectorAvailability();
      } catch {
        vectorAvailable = undefined;
      }
    }

    let embedding: MemoryStatusResult["embedding"];
    try {
      embedding = await params.manager.probeEmbeddingAvailability();
    } catch (err) {
      embedding = {
        ok: false,
        error: `gateway memory probe failed: ${formatError(err)}`,
      };
    }
    if (!embedding.ok && !embedding.error) {
      embedding = { ok: false, error: "memory embeddings unavailable" };
    }

    return {
      agentId: params.agentId,
      enabled: params.enabled,
      ...(params.config ? { config: params.config } : {}),
      ...(params.backend ? { backend: params.backend } : {}),
      runtime: buildRuntimeStatus(status, vectorAvailable),
      embedding,
    };
  } catch (err) {
    const managerError = formatError(err);
    return {
      agentId: params.agentId,
      enabled: params.enabled,
      ...(params.config ? { config: params.config } : {}),
      ...(params.backend ? { backend: params.backend } : {}),
      embedding: {
        ok: false,
        error: `gateway memory status failed: ${managerError}`,
      },
      managerError,
    };
  }
}

function resolveMemoryStatusState(cfg: AlisioConfig, agentId: string) {
  let config: MemoryStatusConfig | undefined;
  let enabled = false;
  let configError: string | undefined;

  try {
    const resolvedConfig = resolveMemorySearchConfig(cfg, agentId);
    if (resolvedConfig) {
      enabled = true;
      config = buildMemoryStatusConfig(resolvedConfig);
    }
  } catch (err) {
    configError = formatError(err);
  }

  let backend: MemoryStatusResult["backend"] | undefined;
  try {
    backend = resolveMemoryBackendSnapshot({ cfg, agentId });
  } catch {
    backend = undefined;
  }

  return { enabled, config, backend, configError };
}

export const memoryHandlers: GatewayRequestHandlers = {
  "memory.status": async ({ params, respond }) => {
    if (!validateMemoryStatusParams(params)) {
      respondInvalidMethodParams(respond, "memory.status", validateMemoryStatusParams.errors);
      return;
    }

    const context = resolveAgentContext(params, respond);
    if (!context) {
      return;
    }

    const state = resolveMemoryStatusState(context.cfg, context.agentId);
    if (state.configError || !state.enabled) {
      respond(
        true,
        buildStatusWithoutManager({
          agentId: context.agentId,
          enabled: state.enabled,
          config: state.config,
          backend: state.backend,
          configError: state.configError,
        }),
        undefined,
      );
      return;
    }

    const { manager, error } = await getActiveMemorySearchManager({
      cfg: context.cfg,
      agentId: context.agentId,
      purpose: "status",
    });
    if (!manager) {
      respond(
        true,
        buildStatusWithoutManager({
          agentId: context.agentId,
          enabled: state.enabled,
          config: state.config,
          backend: state.backend,
          managerError: error,
        }),
        undefined,
      );
      return;
    }

    try {
      const result = await collectManagerStatus({
        agentId: context.agentId,
        enabled: state.enabled,
        manager,
        config: state.config,
        backend: state.backend,
      });
      respond(true, result, undefined);
    } finally {
      await manager.close?.().catch(() => {});
    }
  },
  "memory.sync": async ({ params, respond }) => {
    if (!validateMemorySyncParams(params)) {
      respondInvalidMethodParams(respond, "memory.sync", validateMemorySyncParams.errors);
      return;
    }

    const context = resolveAgentContext(params, respond);
    if (!context) {
      return;
    }

    const state = resolveMemoryStatusState(context.cfg, context.agentId);
    if (state.configError) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `memory config unavailable: ${state.configError}`),
      );
      return;
    }
    if (!state.enabled) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "memory is disabled"));
      return;
    }

    const { manager, error } = await getActiveMemorySearchManager({
      cfg: context.cfg,
      agentId: context.agentId,
      purpose: "default",
    });
    if (!manager) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `memory sync unavailable: ${error ?? "unknown error"}`),
      );
      return;
    }
    if (!manager.sync) {
      await manager.close?.().catch(() => {});
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "memory backend does not support manual sync"),
      );
      return;
    }

    try {
      await manager.sync({
        reason: "gateway",
        force: true,
      });
      const status = await collectManagerStatus({
        agentId: context.agentId,
        enabled: state.enabled,
        manager,
        config: state.config,
        backend: state.backend,
      });
      respond(true, { ok: true, status }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `memory sync failed: ${formatError(err)}`),
      );
    } finally {
      await manager.close?.().catch(() => {});
    }
  },
};
