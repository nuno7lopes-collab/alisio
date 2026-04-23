import {
  exportPairingCode,
  importProfileKeyFromPairingCode,
  loadProfileRootKey,
  setupProfileRootKey,
  storeProfileRootKey,
} from "../../../packages/memory-crypto/src/index.js";
import { listAgentIds } from "../../agents/agent-scope.js";
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
  applyAccountScopedWorkspaceOverride,
  buildGatewayPersonalContextScope,
  resolveAccountScopedWorkspaceForAgent,
} from "../alisio-account-context.js";
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
  validateMemoryStatusResult,
  validateMemoryStatusParams,
  validateMemorySyncResult,
  validateMemorySyncParams,
} from "../protocol/index.js";
import { formatError } from "../server-utils.js";
import { requireAuthenticatedAppAccount } from "./account-required.js";
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

function respondInvalidMethodResult(
  respond: RespondFn,
  method: string,
  errors: Parameters<typeof formatValidationErrors>[0],
): void {
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${method} result: ${formatValidationErrors(errors)}`,
    ),
  );
}

function respondMemoryStatusResult(respond: RespondFn, result: MemoryStatusResult): void {
  if (!validateMemoryStatusResult(result)) {
    respondInvalidMethodResult(respond, "memory.status", validateMemoryStatusResult.errors);
    return;
  }
  respond(true, result, undefined);
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

type CanonicalStoreRuntime = NonNullable<MemoryStatusRuntime["canonicalStore"]>;

const CANONICAL_STORE_STATES = ["pending-sync", "ready"] as const;
const CANONICAL_STORE_PROFILE_SOURCES = ["cloud-user", "local-profile", "state-dir"] as const;
const CANONICAL_STORE_BACKENDS = ["builtin", "qmd"] as const;
const CANONICAL_STORE_PROJECTION_INTERFACE = "markdown-repo" as const;
const CANONICAL_STORE_SYNC_MODE = "local-first" as const;
const CANONICAL_STORE_CLOUD_SYNC_VALUES = ["unavailable", "enabled", "error"] as const;
const CANONICAL_STORE_PROJECTION_SOURCES = ["workspace-memory"] as const;
const CANONICAL_STORE_SYNC_AVAILABILITIES = ["active", "inactive", "blocked"] as const;
const CANONICAL_STORE_SYNC_MODE_CONFIGURED = ["cloud", "direct", "off"] as const;
const CANONICAL_STORE_SYNC_BLOCKED_REASONS = [
  "disabled",
  "mode_off",
  "missing_profile_key",
  "missing_relay_base_url",
  "missing_access_token",
  "direct_disabled",
] as const;

function parseCanonicalStoreEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  return typeof value === "string" && allowed.includes(value) ? (value as T[number]) : undefined;
}

function readCanonicalStoreString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readCanonicalStoreInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function buildCanonicalStoreRuntime(value: unknown): CanonicalStoreRuntime | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const state = parseCanonicalStoreEnum(record.state, CANONICAL_STORE_STATES);
  const path = readCanonicalStoreString(record.path);
  const profileId = readCanonicalStoreString(record.profileId);
  const profileSource = parseCanonicalStoreEnum(
    record.profileSource,
    CANONICAL_STORE_PROFILE_SOURCES,
  );
  const workspaceScope = readCanonicalStoreString(record.workspaceScope);
  const workspaceDir = readCanonicalStoreString(record.workspaceDir);
  const backend = parseCanonicalStoreEnum(record.backend, CANONICAL_STORE_BACKENDS);
  const projectionInterface = parseCanonicalStoreEnum(record.projectionInterface, [
    CANONICAL_STORE_PROJECTION_INTERFACE,
  ] as const);
  const syncMode = parseCanonicalStoreEnum(record.syncMode, [CANONICAL_STORE_SYNC_MODE] as const);
  const cloudSync = parseCanonicalStoreEnum(record.cloudSync, CANONICAL_STORE_CLOUD_SYNC_VALUES);
  const entities = readCanonicalStoreInteger(record.entities);
  const relations = readCanonicalStoreInteger(record.relations);
  const projections = readCanonicalStoreInteger(record.projections);
  const ledgerEventsCount = readCanonicalStoreInteger(record.ledgerEventsCount);
  const lastSyncedLamport = readCanonicalStoreInteger(record.lastSyncedLamport);
  const checkpointsCount = readCanonicalStoreInteger(record.checkpointsCount);

  if (
    !state ||
    !path ||
    !profileId ||
    !profileSource ||
    !workspaceScope ||
    !workspaceDir ||
    !backend ||
    entities === undefined ||
    relations === undefined ||
    projections === undefined ||
    !projectionInterface ||
    !syncMode ||
    !cloudSync ||
    ledgerEventsCount === undefined ||
    lastSyncedLamport === undefined ||
    checkpointsCount === undefined ||
    record.e2eeRequired !== true ||
    !Array.isArray(record.projectionSources)
  ) {
    return undefined;
  }

  const projectionSources = record.projectionSources
    .map((entry) => parseCanonicalStoreEnum(entry, CANONICAL_STORE_PROJECTION_SOURCES))
    .filter(
      (entry): entry is (typeof CANONICAL_STORE_PROJECTION_SOURCES)[number] => entry !== undefined,
    );
  if (projectionSources.length !== record.projectionSources.length) {
    return undefined;
  }

  const syncAvailability = parseCanonicalStoreEnum(
    record.syncAvailability,
    CANONICAL_STORE_SYNC_AVAILABILITIES,
  );
  const syncModeConfigured = parseCanonicalStoreEnum(
    record.syncModeConfigured,
    CANONICAL_STORE_SYNC_MODE_CONFIGURED,
  );
  const syncBlockedReason = parseCanonicalStoreEnum(
    record.syncBlockedReason,
    CANONICAL_STORE_SYNC_BLOCKED_REASONS,
  );

  const replicaRecord =
    record.replica && typeof record.replica === "object" && !Array.isArray(record.replica)
      ? (record.replica as Record<string, unknown>)
      : null;
  const replica = replicaRecord
    ? {
        deviceId: readCanonicalStoreString(replicaRecord.deviceId),
        stateDir: readCanonicalStoreString(replicaRecord.stateDir),
      }
    : null;

  return {
    state,
    path,
    profileId,
    profileSource,
    ...(readCanonicalStoreString(record.displayName)
      ? { displayName: readCanonicalStoreString(record.displayName) }
      : {}),
    workspaceScope,
    workspaceDir,
    backend,
    entities,
    relations,
    projections,
    projectionInterface,
    syncMode,
    cloudSync,
    projectionSources,
    ledgerEventsCount,
    lastSyncedLamport,
    checkpointsCount,
    e2eeRequired: true,
    ...(syncAvailability ? { syncAvailability } : {}),
    ...(syncModeConfigured ? { syncModeConfigured } : {}),
    ...(syncBlockedReason ? { syncBlockedReason } : {}),
    ...(readCanonicalStoreString(record.lastSyncSuccessAt)
      ? { lastSyncSuccessAt: readCanonicalStoreString(record.lastSyncSuccessAt) }
      : {}),
    ...(readCanonicalStoreInteger(record.lastAckLamport) !== undefined
      ? { lastAckLamport: readCanonicalStoreInteger(record.lastAckLamport) }
      : {}),
    ...(readCanonicalStoreInteger(record.pendingBacklog) !== undefined
      ? { pendingBacklog: readCanonicalStoreInteger(record.pendingBacklog) }
      : {}),
    ...(readCanonicalStoreString(record.lastSyncedAt)
      ? { lastSyncedAt: readCanonicalStoreString(record.lastSyncedAt) }
      : {}),
    ...(readCanonicalStoreString(record.lastError)
      ? { lastError: readCanonicalStoreString(record.lastError) }
      : {}),
    ...(replica?.deviceId && replica.stateDir
      ? {
          replica: {
            deviceId: replica.deviceId,
            stateDir: replica.stateDir,
          },
        }
      : {}),
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
  const canonicalStore = buildCanonicalStoreRuntime(status.custom?.canonicalStore);
  if (canonicalStore) {
    runtime.canonicalStore = canonicalStore;
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
    const accountContext = await requireAuthenticatedAppAccount(respond);
    if (!accountContext) {
      return;
    }
    const scopedCfg = applyAccountScopedWorkspaceOverride({
      cfg: context.cfg,
      agentId: context.agentId,
      accountId: accountContext.canonical.accountId,
    });
    const personalContext = await readPersonalContextSummary({
      cfg: scopedCfg,
      agentId: context.agentId,
      workspaceDir: resolveAccountScopedWorkspaceForAgent({
        cfg: context.cfg,
        agentId: context.agentId,
        accountId: accountContext.canonical.accountId,
      }),
      mainKey: scopedCfg.session?.mainKey,
      ...buildGatewayPersonalContextScope(accountContext),
    });

    const state = resolveMemoryStatusState(scopedCfg, context.agentId);
    if (state.configError || !state.enabled) {
      respondMemoryStatusResult(
        respond,
        buildStatusWithoutManager({
          agentId: context.agentId,
          enabled: state.enabled,
          personalContext,
          config: state.config,
          backend: state.backend,
          configError: state.configError,
        }),
      );
      return;
    }

    const { manager, error } = await getActiveMemorySearchManager({
      cfg: scopedCfg,
      agentId: context.agentId,
      purpose: "status",
    });
    if (!manager) {
      respondMemoryStatusResult(
        respond,
        buildStatusWithoutManager({
          agentId: context.agentId,
          enabled: state.enabled,
          personalContext,
          config: state.config,
          backend: state.backend,
          managerError: error,
        }),
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
      respondMemoryStatusResult(respond, result);
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
    if (!(await requireAuthenticatedAppAccount(respond))) {
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
    if (!(await requireAuthenticatedAppAccount(respond))) {
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
    if (!(await requireAuthenticatedAppAccount(respond))) {
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
    const accountContext = await requireAuthenticatedAppAccount(respond);
    if (!accountContext) {
      return;
    }
    const scopedCfg = applyAccountScopedWorkspaceOverride({
      cfg: context.cfg,
      agentId: context.agentId,
      accountId: accountContext.canonical.accountId,
    });

    const state = resolveMemoryStatusState(scopedCfg, context.agentId);
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
      cfg: scopedCfg,
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
      if (!validateMemoryStatusResult(status)) {
        respondInvalidMethodResult(respond, "memory.sync", validateMemoryStatusResult.errors);
        return;
      }
      const result = { ok: true, status } as const;
      if (!validateMemorySyncResult(result)) {
        respondInvalidMethodResult(respond, "memory.sync", validateMemorySyncResult.errors);
        return;
      }
      respond(true, result, undefined);
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
