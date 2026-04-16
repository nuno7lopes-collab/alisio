import type { DatabaseSync } from "node:sqlite";
import { CancellationToken } from "./cancellation.js";
import {
  createGaiaSleepWriteFacade,
  resolveGaiaSleepStatus,
  type GaiaSleepWriteFacade,
} from "./gaia.js";
import { runConsolidateSlice } from "./jobs/consolidate.js";
import { runDedupSlice } from "./jobs/dedup.js";
import { runHealthSlice, buildHealthJobId } from "./jobs/health.js";
import { runLongTermSlice } from "./jobs/long-term.js";
import { openSqliteDatabase } from "./sqlite.js";
import { SqliteMemoryJobStore } from "./store.js";
import type {
  HealthDashboard,
  MemoryJobKind,
  SleepClock,
  SleepRunResult,
  SleepSchedulerOptions,
} from "./types.js";

const DEFAULT_SLICE_MS = 250;
const DEFAULT_MAX_WALL_TIME_MS = 2_500;

function createClock() {
  return {
    now: () => Date.now(),
  };
}

function mergeCounts(target: Record<string, number>, next: Record<string, number>): void {
  for (const [key, value] of Object.entries(next)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

type ResolvedSleepStatus = ReturnType<typeof resolveGaiaSleepStatus>;

type SleepSchedulerDependencies = {
  openDatabase?: (dbPath: string) => DatabaseSync;
  createGaia?: (params: Parameters<typeof createGaiaSleepWriteFacade>[0]) => GaiaSleepWriteFacade;
  resolveStatus?: (runtime: SleepSchedulerOptions["runtime"]) => ResolvedSleepStatus;
};

type MemorySleepSchedulerOptions = SleepSchedulerOptions & {
  dependencies?: SleepSchedulerDependencies;
};

export class MemorySleepScheduler {
  readonly db: DatabaseSync;
  readonly store: SqliteMemoryJobStore;
  readonly gaia: GaiaSleepWriteFacade;
  readonly options: MemorySleepSchedulerOptions & {
    profileId: string;
    workspaceScope: string;
    workspaceDir: string;
    autoMergeConfirmed: boolean;
    clock: SleepClock;
  };

  constructor(options: MemorySleepSchedulerOptions) {
    const clock = options.clock ?? createClock();
    const runtimeStatus = (options.dependencies?.resolveStatus ?? resolveGaiaSleepStatus)(
      options.runtime,
    );
    this.db = (options.dependencies?.openDatabase ?? openSqliteDatabase)(runtimeStatus.path);
    this.store = new SqliteMemoryJobStore(this.db, clock, runtimeStatus.replica?.stateDir);
    this.gaia = (options.dependencies?.createGaia ?? createGaiaSleepWriteFacade)({
      ...options.runtime,
      db: this.db,
    });
    this.options = {
      ...options,
      profileId: runtimeStatus.profileId,
      workspaceScope: runtimeStatus.workspaceScope,
      workspaceDir: runtimeStatus.workspaceDir,
      autoMergeConfirmed: options.autoMergeConfirmed === true,
      clock,
    };
  }

  async runOnce(): Promise<SleepRunResult> {
    const startedAtMs = this.options.clock.now();
    if (this.options.featureFlags?.enabled === false) {
      return {
        status: "disabled",
        startedAtMs,
        endedAtMs: this.options.clock.now(),
        workDoneCounts: {},
        telemetry: this.store.readTelemetry(this.options.profileId),
        jobRecords: this.store.listJobRecords(this.options.profileId),
      };
    }

    if (this.options.activityMonitor?.isSessionActive()) {
      this.store.incrementTelemetry(this.options.profileId, "sleep_preemptions");
      return {
        status: "skipped-active",
        startedAtMs,
        endedAtMs: this.options.clock.now(),
        workDoneCounts: {},
        telemetry: this.store.readTelemetry(this.options.profileId),
        jobRecords: this.store.listJobRecords(this.options.profileId),
      };
    }

    await this.gaia.ensureReady();
    this.store.incrementTelemetry(this.options.profileId, "sleep_runs");

    const token = new CancellationToken();
    const maxWallTimeMs = this.options.featureFlags?.maxWallTimeMs ?? DEFAULT_MAX_WALL_TIME_MS;
    const runDeadlineMs = startedAtMs + maxWallTimeMs;
    const sliceMs = this.options.sliceMs ?? DEFAULT_SLICE_MS;
    const workDoneCounts: Record<string, number> = {};
    let preemptedJob: MemoryJobKind | undefined;
    let status: SleepRunResult["status"] = "completed";
    let healthDashboard: HealthDashboard | undefined;

    const jobOrder: MemoryJobKind[] = ["consolidate", "dedup", "long-term", "health"];
    const pendingJobs = new Set(jobOrder);

    while (pendingJobs.size > 0 && this.options.clock.now() < runDeadlineMs) {
      for (const kind of jobOrder) {
        if (!pendingJobs.has(kind)) {
          continue;
        }
        if (this.options.activityMonitor?.isSessionActive()) {
          token.cancel("active-session");
          preemptedJob = kind;
          status = "preempted";
          this.store.incrementTelemetry(this.options.profileId, "sleep_preemptions");
          break;
        }

        const sliceDeadlineMs = Math.min(runDeadlineMs, this.options.clock.now() + sliceMs);
        const result =
          kind === "consolidate"
            ? await runConsolidateSlice({
                store: this.store,
                gaia: this.gaia,
                profileId: this.options.profileId,
                workspaceScope: this.options.workspaceScope,
                workspaceDir: this.options.workspaceDir,
                sliceDeadlineMs,
                token,
                clock: this.options.clock,
                shouldPreempt: () => Boolean(this.options.activityMonitor?.isSessionActive()),
              })
            : kind === "dedup"
              ? await runDedupSlice({
                  store: this.store,
                  gaia: this.gaia,
                  profileId: this.options.profileId,
                  workspaceScope: this.options.workspaceScope,
                  workspaceDir: this.options.workspaceDir,
                  sliceDeadlineMs,
                  token,
                  clock: this.options.clock,
                  autoMergeConfirmed: this.options.autoMergeConfirmed,
                  shouldPreempt: () => Boolean(this.options.activityMonitor?.isSessionActive()),
                })
              : kind === "long-term"
                ? await runLongTermSlice({
                    store: this.store,
                    gaia: this.gaia,
                    profileId: this.options.profileId,
                    workspaceScope: this.options.workspaceScope,
                    workspaceDir: this.options.workspaceDir,
                    sliceDeadlineMs,
                    token,
                    clock: this.options.clock,
                    shouldPreempt: () => Boolean(this.options.activityMonitor?.isSessionActive()),
                  })
              : await runHealthSlice({
                  store: this.store,
                  gaia: this.gaia,
                  profileId: this.options.profileId,
                  workspaceScope: this.options.workspaceScope,
                  workspaceDir: this.options.workspaceDir,
                  sliceDeadlineMs,
                  token,
                  clock: this.options.clock,
                  shouldPreempt: () => Boolean(this.options.activityMonitor?.isSessionActive()),
                });

        mergeCounts(workDoneCounts, result.workDoneCounts);
        if (result.healthDashboard) {
          healthDashboard = result.healthDashboard;
        }
        if (result.status === "completed") {
          pendingJobs.delete(kind);
        } else if (result.status === "preempted") {
          preemptedJob = kind;
          status = "preempted";
          this.store.incrementTelemetry(this.options.profileId, "sleep_preemptions");
          pendingJobs.clear();
          break;
        } else {
          status = this.options.clock.now() >= runDeadlineMs ? "budget-exhausted" : status;
        }
      }

      if (status === "preempted") {
        break;
      }
      if (this.options.clock.now() >= runDeadlineMs && pendingJobs.size > 0) {
        status = "budget-exhausted";
        break;
      }
    }

    if (!healthDashboard) {
      healthDashboard = this.gaia.readDashboard<HealthDashboard>(
        buildHealthJobId(this.options.workspaceScope),
      );
    }

    return {
      status,
      startedAtMs,
      endedAtMs: this.options.clock.now(),
      ...(preemptedJob ? { preemptedJob } : {}),
      workDoneCounts,
      telemetry: this.store.readTelemetry(this.options.profileId),
      jobRecords: this.store.listJobRecords(this.options.profileId),
      ...(healthDashboard ? { healthDashboard } : {}),
    };
  }

  close(): void {
    this.db.close();
  }
}

export function createMemorySleepScheduler(
  options: MemorySleepSchedulerOptions,
): MemorySleepScheduler {
  return new MemorySleepScheduler(options);
}
