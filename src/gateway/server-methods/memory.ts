import {
  exportPairingCode,
  importProfileKeyFromPairingCode,
  loadProfileRootKey,
  setupProfileRootKey,
  storeProfileRootKey,
} from "../../../packages/memory-crypto/src/index.js";
import { listAgentIds } from "../../agents/agent-scope.js";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import {
  resolveMemorySearchConfig,
  type ResolvedMemorySearchConfig,
} from "../../agents/memory-search.js";
import type { AlisioConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { resolveAlisioMemoryOwnerProfile } from "../../infra/alisio-memory-profile.js";
import {
  readPersonalContextSummary,
  type PersonalContextSummary,
} from "../../memory/personal-context.js";
import {
  getActiveMemorySearchManager,
  resolveActiveMemoryBackendConfig,
} from "../../plugins/memory-runtime.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateMemoryE2eeExportPairingCodeParams,
  validateMemoryE2eeImportPairingCodeParams,
  validateMemoryE2eeSetupParams,
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

function resolveMemoryE2eeContext(params: Record<string, unknown>, respond: RespondFn) {
  const agentContext = resolveAgentContext(params, respond);
  if (!agentContext) {
    return null;
  }
  const env = process.env;
  return {
    ...agentContext,
    env,
    stateDir: resolveStateDir(env),
    ownerProfile: resolveAlisioMemoryOwnerProfile(env),
  };
}

function logMemoryE2eeEvent(
  logGateway: {
    info: (message: string, meta?: Record<string, unknown>) => void;
  },
  event: "key_created" | "key_loaded" | "pairing_exported" | "pairing_imported",
  details: Record<string, unknown>,
) {
  logGateway.info("memory e2ee event", {
    event,
    ...details,
  });
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
  const canonicalStore = (status.custom?.canonicalStore ?? null) as {
    state?: "pending-sync" | "ready";
    path?: string;
    profileId?: string;
    profileSource?: "cloud-user" | "local-profile" | "state-dir";
    displayName?: string;
    workspaceScope?: string;
    workspaceDir?: string;
    backend?: "builtin" | "qmd";
    entities?: number;
    relations?: number;
    projections?: number;
    projectionInterface?: "markdown-repo";
    syncMode?: "local-first";
    cloudSync?: "unavailable" | "enabled" | "error";
    projectionSources?: Array<"workspace-memory">;
    ledgerEventsCount?: number;
    lastSyncedLamport?: number;
    checkpointsCount?: number;
    e2eeRequired?: true;
    syncAvailability?: "active" | "inactive" | "blocked";
    syncModeConfigured?: "cloud" | "direct" | "off";
    syncBlockedReason?:
      | "disabled"
      | "mode_off"
      | "missing_profile_key"
      | "missing_relay_base_url"
      | "missing_access_token"
      | "direct_disabled";
    lastSyncSuccessAt?: string;
    lastAckLamport?: number;
    pendingBacklog?: number;
    lastSyncedAt?: string;
    lastError?: string;
    replica?: {
      deviceId?: string;
      stateDir?: string;
    };
  } | null;
  if (
    canonicalStore?.state &&
    canonicalStore.path &&
    canonicalStore.profileId &&
    canonicalStore.profileSource &&
    canonicalStore.workspaceScope &&
    canonicalStore.workspaceDir &&
    canonicalStore.backend &&
    typeof canonicalStore.entities === "number" &&
    typeof canonicalStore.relations === "number" &&
    typeof canonicalStore.projections === "number" &&
    canonicalStore.projectionInterface &&
    canonicalStore.syncMode &&
    canonicalStore.cloudSync &&
    Array.isArray(canonicalStore.projectionSources) &&
    typeof canonicalStore.ledgerEventsCount === "number" &&
    typeof canonicalStore.lastSyncedLamport === "number" &&
    typeof canonicalStore.checkpointsCount === "number" &&
    (canonicalStore.syncAvailability === "active" ||
      canonicalStore.syncAvailability === "inactive" ||
      canonicalStore.syncAvailability === "blocked") &&
    (canonicalStore.syncModeConfigured === "cloud" ||
      canonicalStore.syncModeConfigured === "direct" ||
      canonicalStore.syncModeConfigured === "off") &&
    canonicalStore.e2eeRequired === true
  ) {
    runtime.canonicalStore = {
      state: canonicalStore.state,
      path: canonicalStore.path,
      profileId: canonicalStore.profileId,
      profileSource: canonicalStore.profileSource,
      ...(canonicalStore.displayName ? { displayName: canonicalStore.displayName } : {}),
      workspaceScope: canonicalStore.workspaceScope,
      workspaceDir: canonicalStore.workspaceDir,
      backend: canonicalStore.backend,
      entities: canonicalStore.entities,
      relations: canonicalStore.relations,
      projections: canonicalStore.projections,
      projectionInterface: canonicalStore.projectionInterface,
      syncMode: canonicalStore.syncMode,
      cloudSync: canonicalStore.cloudSync,
      projectionSources: canonicalStore.projectionSources,
      ledgerEventsCount: canonicalStore.ledgerEventsCount,
      lastSyncedLamport: canonicalStore.lastSyncedLamport,
      checkpointsCount: canonicalStore.checkpointsCount,
      e2eeRequired: canonicalStore.e2eeRequired,
      syncAvailability: canonicalStore.syncAvailability,
      syncModeConfigured: canonicalStore.syncModeConfigured,
      ...(canonicalStore.syncBlockedReason
        ? { syncBlockedReason: canonicalStore.syncBlockedReason }
        : {}),
      ...(canonicalStore.lastSyncSuccessAt
        ? { lastSyncSuccessAt: canonicalStore.lastSyncSuccessAt }
        : {}),
      ...(typeof canonicalStore.lastAckLamport === "number"
        ? { lastAckLamport: canonicalStore.lastAckLamport }
        : {}),
      ...(typeof canonicalStore.pendingBacklog === "number"
        ? { pendingBacklog: canonicalStore.pendingBacklog }
        : {}),
      ...(canonicalStore.lastSyncedAt ? { lastSyncedAt: canonicalStore.lastSyncedAt } : {}),
      ...(canonicalStore.lastError ? { lastError: canonicalStore.lastError } : {}),
      ...(canonicalStore.replica?.deviceId && canonicalStore.replica.stateDir
        ? {
            replica: {
              deviceId: canonicalStore.replica.deviceId,
              stateDir: canonicalStore.replica.stateDir,
            },
          }
        : {}),
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
  personalContext?: PersonalContextSummary;
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
    ...(params.personalContext ? { personalContext: params.personalContext } : {}),
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
  personalContext?: PersonalContextSummary;
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
      ...(params.personalContext ? { personalContext: params.personalContext } : {}),
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
      ...(params.personalContext ? { personalContext: params.personalContext } : {}),
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
    const personalContext = await readPersonalContextSummary({
      cfg: context.cfg,
      agentId: context.agentId,
      workspaceDir: resolveAgentWorkspaceDir(context.cfg, context.agentId),
      mainKey: context.cfg.session?.mainKey,
    });

    const state = resolveMemoryStatusState(context.cfg, context.agentId);
    if (state.configError || !state.enabled) {
      respond(
        true,
        buildStatusWithoutManager({
          agentId: context.agentId,
          enabled: state.enabled,
          personalContext,
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
          personalContext,
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
        personalContext,
        manager,
        config: state.config,
        backend: state.backend,
      });
      respond(true, result, undefined);
    } finally {
      await manager.close?.().catch(() => {});
    }
  },
  "memory.e2ee.setup": async ({ params, respond, context }) => {
    if (!validateMemoryE2eeSetupParams(params)) {
      respondInvalidMethodParams(
        respond,
        "memory.e2ee.setup",
        validateMemoryE2eeSetupParams.errors,
      );
      return;
    }

    const memoryContext = resolveMemoryE2eeContext(params, respond);
    if (!memoryContext) {
      return;
    }
    const { passphrase } = params as { passphrase: string };

    try {
      const result = await setupProfileRootKey({
        profileId: memoryContext.ownerProfile.profileId,
        passphrase,
        stateDir: memoryContext.stateDir,
        env: memoryContext.env,
      });
      logMemoryE2eeEvent(
        context.logGateway,
        result.action === "created" ? "key_created" : "key_loaded",
        {
          agentId: memoryContext.agentId,
          profileId: result.profileId,
          storedIn: result.storedIn,
        },
      );
      respond(
        true,
        {
          ok: true,
          profileId: result.profileId,
          action: result.action,
          storedIn: result.storedIn,
          path: result.path,
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `memory E2EE setup failed: ${formatError(err)}`),
      );
    }
  },
  "memory.e2ee.exportPairingCode": async ({ params, respond, context }) => {
    if (!validateMemoryE2eeExportPairingCodeParams(params)) {
      respondInvalidMethodParams(
        respond,
        "memory.e2ee.exportPairingCode",
        validateMemoryE2eeExportPairingCodeParams.errors,
      );
      return;
    }

    const memoryContext = resolveMemoryE2eeContext(params, respond);
    if (!memoryContext) {
      return;
    }
    const { passphrase, sourceDeviceId } = params as {
      passphrase: string;
      sourceDeviceId?: string;
    };

    try {
      const profileRootKey = await loadProfileRootKey({
        profileId: memoryContext.ownerProfile.profileId,
        stateDir: memoryContext.stateDir,
        env: memoryContext.env,
      });
      if (!profileRootKey) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "memory E2EE key is not initialized on this device",
          ),
        );
        return;
      }

      const createdAt = new Date().toISOString();
      const pairingCode = await exportPairingCode({
        profileId: memoryContext.ownerProfile.profileId,
        passphrase,
        profileRootKey,
        sourceDeviceId,
        createdAt,
      });
      logMemoryE2eeEvent(context.logGateway, "pairing_exported", {
        agentId: memoryContext.agentId,
        profileId: memoryContext.ownerProfile.profileId,
        createdAt,
        ...(sourceDeviceId ? { sourceDeviceId } : {}),
      });
      respond(
        true,
        {
          ok: true,
          profileId: memoryContext.ownerProfile.profileId,
          pairingCode,
          createdAt,
          ...(sourceDeviceId ? { sourceDeviceId } : {}),
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `memory pairing export failed: ${formatError(err)}`),
      );
    }
  },
  "memory.e2ee.importPairingCode": async ({ params, respond, context }) => {
    if (!validateMemoryE2eeImportPairingCodeParams(params)) {
      respondInvalidMethodParams(
        respond,
        "memory.e2ee.importPairingCode",
        validateMemoryE2eeImportPairingCodeParams.errors,
      );
      return;
    }

    const memoryContext = resolveMemoryE2eeContext(params, respond);
    if (!memoryContext) {
      return;
    }
    const { pairingCode, passphrase } = params as {
      pairingCode: string;
      passphrase: string;
    };

    try {
      const imported = await importProfileKeyFromPairingCode({
        pairingCode,
        passphrase,
        cache: false,
        stateDir: memoryContext.stateDir,
        env: memoryContext.env,
      });
      if (imported.profileId !== memoryContext.ownerProfile.profileId) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `memory pairing code targets ${imported.profileId}, expected ${memoryContext.ownerProfile.profileId}`,
          ),
        );
        return;
      }

      const cached = await storeProfileRootKey({
        profileId: imported.profileId,
        profileRootKey: imported.profileRootKey,
        stateDir: memoryContext.stateDir,
        env: memoryContext.env,
      });
      logMemoryE2eeEvent(context.logGateway, "pairing_imported", {
        agentId: memoryContext.agentId,
        profileId: imported.profileId,
        cached: cached.status,
        ...(imported.sourceDeviceId ? { sourceDeviceId: imported.sourceDeviceId } : {}),
      });
      respond(
        true,
        {
          ok: true,
          profileId: imported.profileId,
          cached: cached.status,
          createdAt: imported.createdAt,
          ...(imported.sourceDeviceId ? { sourceDeviceId: imported.sourceDeviceId } : {}),
        },
        undefined,
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `memory pairing import failed: ${formatError(err)}`),
      );
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
