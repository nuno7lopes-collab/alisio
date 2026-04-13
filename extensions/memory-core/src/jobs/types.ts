import type {
  HealthDashboard,
  MemoryJobRecord,
  MemorySleepScheduler,
  MemoryJobKind,
  SleepRunResult,
  SleepRunStatus,
  SleepTelemetrySnapshot,
} from "../../../../packages/memory-jobs/src/index.js";

export type MemoryJobsRuntimeState = "disabled" | "idle" | "waiting" | "running" | "cancelling";

export type MemoryJobsFeatureFlags = {
  enabled: boolean;
  autoSleepEnabled: boolean;
  maxSliceMs: number;
  idleWindowMs: number;
  pollIntervalMs: number;
};

export type MemoryJobsRuntimeSnapshot = {
  state: MemoryJobsRuntimeState;
  running: boolean;
  cancelRequested: boolean;
  activeSession: boolean;
  recentGatewayRequest: boolean;
  idle: boolean;
  lastStartedAtMs?: number;
  lastEndedAtMs?: number;
  lastStatus?: SleepRunStatus;
  lastPreemptedJob?: MemoryJobKind;
  lastError?: string;
  lastHealthDashboard?: HealthDashboard;
  sliceCount: number;
  totalSliceMs: number;
};

export type MemoryJobsStatusSnapshot = {
  agentId: string;
  profileId: string;
  workspaceScope: string;
  workspaceDir: string;
  backend: "builtin" | "qmd";
  flags: MemoryJobsFeatureFlags;
  gatewayActivity: {
    lastRequestAtMs?: number;
    lastRequestSeq: number;
  };
  runtime: MemoryJobsRuntimeSnapshot;
  telemetry: SleepTelemetrySnapshot;
  jobs: MemoryJobRecord[];
};

export type MemoryJobsRunOnceResult = {
  ok: true;
  run: {
    status: SleepRunResult["status"];
    startedAtMs: number;
    endedAtMs: number;
    preemptedJob?: MemoryJobKind;
    workDoneCounts: Record<string, number>;
  };
  status: MemoryJobsStatusSnapshot;
};

export type MemoryJobsCancelResult = {
  ok: true;
  cancelled: boolean;
  status: MemoryJobsStatusSnapshot;
};

export type SleepSchedulerFactory = (
  params: ConstructorParameters<typeof MemorySleepScheduler>[0],
) => Pick<MemorySleepScheduler, "close" | "runOnce" | "store" | "options">;
