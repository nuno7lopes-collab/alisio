import type { DatabaseSync } from "node:sqlite";
import { CancellationToken } from "./cancellation.js";
import { createGaiaSleepWriteFacade, type GaiaSleepWriteFacade } from "./gaia.js";
import { runConsolidateSlice } from "./jobs/consolidate.js";
import { runDedupSlice } from "./jobs/dedup.js";
import { runHealthSlice, buildHealthJobId } from "./jobs/health.js";
import { openSqliteDatabase } from "./sqlite.js";
import { SqliteMemoryJobStore } from "./store.js";
import type {
  HealthDashboard,
  MemoryJobKind,
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

export class MemorySleepScheduler {
  readonly db: DatabaseSync;
  readonly store: SqliteMemoryJobStore;
  readonly gaia: GaiaSleepWriteFacade;
  readonly options: Required<
    Pick<
      SleepSchedulerOptions,
      "profileId" | "workspaceScope" | "workspaceDir" | "autoMergeConfirmed"
    >
  > &
    SleepSchedulerOptions;

  constructor(options: SleepSchedulerOptions) {
    const clock = options.clock ?? createClock();
    this.db = openSqliteDatabase(options.dbPath);
    this.store = new SqliteMemoryJobStore(this.db, clock);
    this.gaia = createGaiaSleepWriteFacade({
      db: this.db,
      actorId: options.gaiaActorId,
    });
    this.gaia.ensureReady();
    this.options = {
      ...options,
      profileId: options.profileId,
      workspaceScope: options.workspaceScope,
      workspaceDir: options.workspaceDir,
      autoMergeConfirmed: options.autoMergeConfirmed === true,
      clock,
    };
  }

  runOnce(): SleepRunResult {
    const startedAtMs = this.options.clock!.now();
    if (this.options.featureFlags?.enabled === false) {
      return {
        status: "disabled",
        startedAtMs,
        endedAtMs: this.options.clock!.now(),
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
        endedAtMs: this.options.clock!.now(),
        workDoneCounts: {},
        telemetry: this.store.readTelemetry(this.options.profileId),
        jobRecords: this.store.listJobRecords(this.options.profileId),
      };
    }

    this.store.incrementTelemetry(this.options.profileId, "sleep_runs");

    const token = new CancellationToken();
    const maxWallTimeMs = this.options.featureFlags?.maxWallTimeMs ?? DEFAULT_MAX_WALL_TIME_MS;
    const runDeadlineMs = startedAtMs + maxWallTimeMs;
    const sliceMs = this.options.sliceMs ?? DEFAULT_SLICE_MS;
    const workDoneCounts: Record<string, number> = {};
    let preemptedJob: MemoryJobKind | undefined;
    let status: SleepRunResult["status"] = "completed";
    let healthDashboard: HealthDashboard | undefined;

    const jobOrder: MemoryJobKind[] = ["consolidate", "dedup", "health"];
    const pendingJobs = new Set(jobOrder);

    while (pendingJobs.size > 0 && this.options.clock!.now() < runDeadlineMs) {
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

        const sliceDeadlineMs = Math.min(runDeadlineMs, this.options.clock!.now() + sliceMs);
        const result =
          kind === "consolidate"
            ? runConsolidateSlice({
                store: this.store,
                gaia: this.gaia,
                profileId: this.options.profileId,
                workspaceScope: this.options.workspaceScope,
                workspaceDir: this.options.workspaceDir,
                sliceDeadlineMs,
                token,
                shouldPreempt: () => Boolean(this.options.activityMonitor?.isSessionActive()),
              })
            : kind === "dedup"
              ? runDedupSlice({
                  store: this.store,
                  gaia: this.gaia,
                  profileId: this.options.profileId,
                  workspaceScope: this.options.workspaceScope,
                  workspaceDir: this.options.workspaceDir,
                  sliceDeadlineMs,
                  token,
                  autoMergeConfirmed: this.options.autoMergeConfirmed,
                  shouldPreempt: () => Boolean(this.options.activityMonitor?.isSessionActive()),
                })
              : runHealthSlice({
                  store: this.store,
                  gaia: this.gaia,
                  profileId: this.options.profileId,
                  workspaceScope: this.options.workspaceScope,
                  workspaceDir: this.options.workspaceDir,
                  sliceDeadlineMs,
                  token,
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
          status = this.options.clock!.now() >= runDeadlineMs ? "budget-exhausted" : status;
        }
      }

      if (status === "preempted") {
        break;
      }
      if (this.options.clock!.now() >= runDeadlineMs && pendingJobs.size > 0) {
        status = "budget-exhausted";
        break;
      }
    }

    if (!healthDashboard) {
      healthDashboard =
        this.gaia.readDashboard<HealthDashboard>(buildHealthJobId(this.options.workspaceScope)) ??
        this.store.readReport<HealthDashboard>(buildHealthJobId(this.options.workspaceScope));
    }

    return {
      status,
      startedAtMs,
      endedAtMs: this.options.clock!.now(),
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

export function createMemorySleepScheduler(options: SleepSchedulerOptions): MemorySleepScheduler {
  return new MemorySleepScheduler(options);
}
