import { loadSessionStore, resolveStorePath } from "alisio/plugin-sdk/config-runtime";
import {
  createSubsystemLogger,
  resolveAgentWorkspaceDir,
  resolveGlobalSingleton,
} from "alisio/plugin-sdk/memory-core-host-engine-foundation";
import {
  loadConfig,
  resolveDefaultAgentId,
  type AlisioConfig,
} from "alisio/plugin-sdk/memory-core-host-runtime-core";
import { resolveMemoryBackendConfig } from "alisio/plugin-sdk/memory-core-host-runtime-files";
import {
  createMemorySleepScheduler,
  type HealthDashboard,
  type MemoryJobKind,
  type SleepRunResult,
} from "../../../../packages/memory-jobs/src/index.js";
import { resolveMemoryJobsFeatureFlags } from "./config.js";
import type {
  MemoryJobsCancelResult,
  MemoryJobsFeatureFlags,
  MemoryJobsRunOnceResult,
  MemoryJobsRuntimeSnapshot,
  MemoryJobsStatusSnapshot,
  SleepSchedulerFactory,
} from "./types.js";

const log = createSubsystemLogger("memory/jobs");

type SessionEntryLike = {
  status?: "running" | "done" | "failed" | "killed" | "timeout";
  acp?: {
    state?: "idle" | "running" | "error";
  };
};

type RuntimeDeps = {
  createScheduler?: SleepSchedulerFactory;
  loadConfig?: () => AlisioConfig;
  now?: () => number;
};

type ControllerState = {
  timer: NodeJS.Timeout | undefined;
  runningPromise: Promise<SleepRunResult> | undefined;
  flags: MemoryJobsFeatureFlags;
  lastGatewayRequestAtMs: number | undefined;
  lastGatewayRequestSeq: number;
  cancelRequested: boolean;
  lastStartedAtMs: number | undefined;
  lastEndedAtMs: number | undefined;
  lastStatus: SleepRunResult["status"] | undefined;
  lastPreemptedJob: MemoryJobKind | undefined;
  lastError: string | undefined;
  lastHealthDashboard: HealthDashboard | undefined;
  sliceCount: number;
  totalSliceMs: number;
};

type MemoryJobsController = {
  agentId: string;
  noteGatewayRequest(): number;
  getStatus(): MemoryJobsStatusSnapshot;
  runOnce(params?: { allowedRequestSeq?: number }): Promise<MemoryJobsRunOnceResult>;
  cancel(): Promise<MemoryJobsCancelResult>;
  ensureStarted(): void;
  dispose(): void;
};

type MemoryJobsRegistry = {
  controllers: Map<string, MemoryJobsController>;
  deps: RuntimeDeps;
};

const REGISTRY_SYMBOL: unique symbol = Symbol.for(
  "alisio.extensions.memory-core.memory-jobs-registry",
) as unknown as typeof REGISTRY_SYMBOL;

function defaultNow(): number {
  return Date.now();
}

function getRegistry(): MemoryJobsRegistry {
  return resolveGlobalSingleton<MemoryJobsRegistry>(REGISTRY_SYMBOL, () => ({
    controllers: new Map(),
    deps: {},
  }));
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readSessionStoreForAgent(
  cfg: AlisioConfig,
  agentId: string,
): Record<string, SessionEntryLike> {
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  return loadSessionStore(storePath) as Record<string, SessionEntryLike>;
}

function hasActiveSession(cfg: AlisioConfig, agentId: string): boolean {
  const store = readSessionStoreForAgent(cfg, agentId);
  return Object.values(store).some(
    (entry) => entry?.status === "running" || entry?.acp?.state === "running",
  );
}

function buildRuntimeState(params: {
  controller: ControllerState;
  activeSession: boolean;
  recentGatewayRequest: boolean;
  idle: boolean;
}): MemoryJobsRuntimeSnapshot {
  const state = !params.controller.flags.enabled
    ? "disabled"
    : params.controller.runningPromise
      ? params.controller.cancelRequested
        ? "cancelling"
        : "running"
      : params.idle
        ? "idle"
        : "waiting";
  return {
    state,
    running: Boolean(params.controller.runningPromise),
    cancelRequested: params.controller.cancelRequested,
    activeSession: params.activeSession,
    recentGatewayRequest: params.recentGatewayRequest,
    idle: params.idle,
    ...(typeof params.controller.lastStartedAtMs === "number"
      ? { lastStartedAtMs: params.controller.lastStartedAtMs }
      : {}),
    ...(typeof params.controller.lastEndedAtMs === "number"
      ? { lastEndedAtMs: params.controller.lastEndedAtMs }
      : {}),
    ...(params.controller.lastStatus ? { lastStatus: params.controller.lastStatus } : {}),
    ...(params.controller.lastPreemptedJob
      ? { lastPreemptedJob: params.controller.lastPreemptedJob }
      : {}),
    ...(params.controller.lastError ? { lastError: params.controller.lastError } : {}),
    ...(params.controller.lastHealthDashboard
      ? { lastHealthDashboard: params.controller.lastHealthDashboard }
      : {}),
    sliceCount: params.controller.sliceCount,
    totalSliceMs: params.controller.totalSliceMs,
  };
}

function logRunMetrics(params: {
  agentId: string;
  profileId: string;
  result: SleepRunResult;
  runtime: {
    sliceCount: number;
    totalSliceMs: number;
  };
}) {
  log.info("memory jobs slice finished", {
    agentId: params.agentId,
    profileId: params.profileId,
    sliceCount: params.runtime.sliceCount,
    totalSliceMs: params.runtime.totalSliceMs,
    lastJobStatus: params.result.status,
    workDoneCounts: params.result.workDoneCounts,
  });
}

function createMemoryJobsController(agentId: string, deps: RuntimeDeps): MemoryJobsController {
  const loadRuntimeConfig = deps.loadConfig ?? loadConfig;
  const createScheduler = deps.createScheduler ?? createMemorySleepScheduler;
  const now = deps.now ?? defaultNow;

  const state: ControllerState = {
    timer: undefined,
    runningPromise: undefined,
    flags: resolveMemoryJobsFeatureFlags(loadRuntimeConfig()),
    lastGatewayRequestAtMs: undefined,
    lastGatewayRequestSeq: 0,
    cancelRequested: false,
    lastStartedAtMs: undefined,
    lastEndedAtMs: undefined,
    lastStatus: undefined,
    lastPreemptedJob: undefined,
    lastError: undefined,
    lastHealthDashboard: undefined,
    sliceCount: 0,
    totalSliceMs: 0,
  };

  const refreshFlags = () => {
    state.flags = resolveMemoryJobsFeatureFlags(loadRuntimeConfig());
    return state.flags;
  };

  const hasRecentGatewayRequest = (allowedRequestSeq?: number) => {
    if (allowedRequestSeq !== undefined && state.lastGatewayRequestSeq === allowedRequestSeq) {
      return false;
    }
    if (typeof state.lastGatewayRequestAtMs !== "number") {
      return false;
    }
    return now() - state.lastGatewayRequestAtMs < state.flags.idleWindowMs;
  };

  const isInteractiveBusy = (cfg: AlisioConfig, allowedRequestSeq?: number) =>
    state.cancelRequested ||
    hasActiveSession(cfg, agentId) ||
    hasRecentGatewayRequest(allowedRequestSeq);

  const collectStatus = (allowedRequestSeq?: number): MemoryJobsStatusSnapshot => {
    const cfg = loadRuntimeConfig();
    refreshFlags();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const backend = resolveMemoryBackendConfig({ cfg, agentId }).backend;
    const scheduler = createScheduler({
      runtime: {
        cfg,
        agentId,
        workspaceDir,
        backend,
        env: process.env,
      },
      featureFlags: {
        enabled: state.flags.enabled,
        maxWallTimeMs: state.flags.maxSliceMs,
      },
      sliceMs: state.flags.maxSliceMs,
      autoMergeConfirmed: false,
      activityMonitor: {
        isSessionActive: () => isInteractiveBusy(cfg, allowedRequestSeq),
      },
      logger: log,
    });
    try {
      const activeSession = hasActiveSession(cfg, agentId);
      const recentGatewayRequest = hasRecentGatewayRequest(allowedRequestSeq);
      const idle =
        state.flags.enabled && !activeSession && !recentGatewayRequest && !state.cancelRequested;
      return {
        agentId,
        profileId: scheduler.options.profileId,
        workspaceScope: scheduler.options.workspaceScope,
        workspaceDir: scheduler.options.workspaceDir,
        backend,
        flags: state.flags,
        gatewayActivity: {
          ...(typeof state.lastGatewayRequestAtMs === "number"
            ? { lastRequestAtMs: state.lastGatewayRequestAtMs }
            : {}),
          lastRequestSeq: state.lastGatewayRequestSeq,
        },
        runtime: buildRuntimeState({
          controller: state,
          activeSession,
          recentGatewayRequest,
          idle,
        }),
        telemetry: scheduler.store.readTelemetry(scheduler.options.profileId),
        jobs: scheduler.store.listJobRecords(scheduler.options.profileId),
      };
    } finally {
      scheduler.close();
    }
  };

  const scheduleNextTick = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      void maybeAutoRun();
    }, state.flags.pollIntervalMs);
  };

  const runSlice = async (allowedRequestSeq?: number) => {
    if (state.runningPromise) {
      return state.runningPromise;
    }
    const cfg = loadRuntimeConfig();
    refreshFlags();
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const backend = resolveMemoryBackendConfig({ cfg, agentId }).backend;
    state.cancelRequested = false;
    const scheduler = createScheduler({
      runtime: {
        cfg,
        agentId,
        workspaceDir,
        backend,
        env: process.env,
      },
      featureFlags: {
        enabled: state.flags.enabled,
        maxWallTimeMs: state.flags.maxSliceMs,
      },
      sliceMs: state.flags.maxSliceMs,
      autoMergeConfirmed: false,
      activityMonitor: {
        isSessionActive: () => isInteractiveBusy(cfg, allowedRequestSeq),
      },
      logger: log,
    });
    state.lastStartedAtMs = now();
    state.runningPromise = scheduler
      .runOnce()
      .then((result) => {
        state.lastEndedAtMs = now();
        state.lastStatus = result.status;
        state.lastPreemptedJob = result.preemptedJob;
        state.lastHealthDashboard = result.healthDashboard;
        state.lastError = undefined;
        state.sliceCount += 1;
        state.totalSliceMs += Math.max(0, result.endedAtMs - result.startedAtMs);
        logRunMetrics({
          agentId,
          profileId: scheduler.options.profileId,
          result,
          runtime: {
            sliceCount: state.sliceCount,
            totalSliceMs: state.totalSliceMs,
          },
        });
        return result;
      })
      .catch((error: unknown) => {
        state.lastEndedAtMs = now();
        state.lastError = asErrorMessage(error);
        state.lastStatus = undefined;
        throw error;
      })
      .finally(() => {
        scheduler.close();
        state.runningPromise = undefined;
        scheduleNextTick();
      });
    return state.runningPromise;
  };

  const maybeAutoRun = async () => {
    const cfg = loadRuntimeConfig();
    refreshFlags();
    if (!state.flags.enabled || !state.flags.autoSleepEnabled) {
      scheduleNextTick();
      return;
    }
    if (state.runningPromise) {
      scheduleNextTick();
      return;
    }
    if (isInteractiveBusy(cfg)) {
      scheduleNextTick();
      return;
    }
    try {
      await runSlice();
    } catch (error) {
      log.warn("memory jobs auto slice failed", {
        agentId,
        error: asErrorMessage(error),
      });
      scheduleNextTick();
    }
  };

  return {
    agentId,

    noteGatewayRequest() {
      state.lastGatewayRequestSeq += 1;
      state.lastGatewayRequestAtMs = now();
      return state.lastGatewayRequestSeq;
    },

    getStatus() {
      return collectStatus();
    },

    async runOnce(params) {
      const result = await runSlice(params?.allowedRequestSeq);
      return {
        ok: true,
        run: {
          status: result.status,
          startedAtMs: result.startedAtMs,
          endedAtMs: result.endedAtMs,
          ...(result.preemptedJob ? { preemptedJob: result.preemptedJob } : {}),
          workDoneCounts: result.workDoneCounts,
        },
        status: collectStatus(params?.allowedRequestSeq),
      };
    },

    async cancel() {
      const wasRunning = Boolean(state.runningPromise);
      state.cancelRequested = wasRunning;
      if (state.runningPromise) {
        await state.runningPromise.catch(() => {});
      }
      state.cancelRequested = false;
      return {
        ok: true,
        cancelled: wasRunning,
        status: collectStatus(),
      };
    },

    ensureStarted() {
      refreshFlags();
      if (state.timer) {
        return;
      }
      scheduleNextTick();
    },

    dispose() {
      clearTimeout(state.timer);
      state.timer = undefined;
    },
  };
}

export function setMemoryJobsRuntimeTestDeps(deps: RuntimeDeps): void {
  const registry = getRegistry();
  registry.controllers.clear();
  registry.deps = deps;
}

export function resetMemoryJobsRuntimeForTest(): void {
  const registry = getRegistry();
  for (const controller of registry.controllers.values()) {
    controller.dispose();
  }
  registry.controllers.clear();
  registry.deps = {};
}

export function getMemoryJobsController(agentId: string): MemoryJobsController {
  const registry = getRegistry();
  const existing = registry.controllers.get(agentId);
  if (existing) {
    existing.ensureStarted();
    return existing;
  }
  const controller = createMemoryJobsController(agentId, registry.deps);
  controller.ensureStarted();
  registry.controllers.set(agentId, controller);
  return controller;
}

export function primeMemoryJobsRuntime(): void {
  const cfg = (getRegistry().deps.loadConfig ?? loadConfig)();
  const agentId = resolveDefaultAgentId(cfg);
  getMemoryJobsController(agentId).ensureStarted();
}

export function resolveMemoryJobsAgentId(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const cfg = (getRegistry().deps.loadConfig ?? loadConfig)();
  return resolveDefaultAgentId(cfg);
}
