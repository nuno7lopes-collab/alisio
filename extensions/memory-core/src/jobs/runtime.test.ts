import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MemoryJobKind,
  MemoryJobRecord,
  SleepRunResult,
} from "../../../../packages/memory-jobs/src/index.js";
import {
  getMemoryJobsController,
  resetMemoryJobsRuntimeForTest,
  setMemoryJobsRuntimeTestDeps,
} from "./runtime.js";

type MutableJobRecord = MemoryJobRecord & {
  kind: MemoryJobKind;
};

function createTestConfig() {
  return {
    session: {
      store: "/tmp/memory-jobs-sessions.json",
    },
    agents: {
      defaults: {},
    },
    memory: {
      jobs: {
        enabled: true,
        maxSliceMs: 75,
        autoSleep: {
          enabled: true,
        },
      },
    },
  };
}

describe("memory jobs runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T10:00:00.000Z"));
  });

  afterEach(() => {
    resetMemoryJobsRuntimeForTest();
    vi.useRealTimers();
  });

  it("preempts on gateway activity and resumes from the persisted cursor", async () => {
    const jobs: MutableJobRecord[] = [
      {
        jobId: "consolidate:scope-main",
        profileId: "local-main",
        kind: "consolidate",
        status: "idle",
        cursorJson: JSON.stringify({ cursor: 0 }),
        updatedAtMs: Date.now(),
      },
    ];
    const emptyCounts: Record<string, number> = {};
    const promotionCounts: Record<string, number> = {
      "sleep_work_done_counts.promotions": 1,
    };
    let releaseFirstRun: (() => void) | undefined;
    let sliceCount = 0;
    let preemptions = 0;

    setMemoryJobsRuntimeTestDeps({
      loadConfig: () => createTestConfig() as never,
      createScheduler: (params) => ({
        options: {
          profileId: "local-main",
          workspaceScope: "scope-main",
          workspaceDir: "/workspace/main",
        } as never,
        store: {
          readTelemetry: () => ({
            counts: {
              sleep_runs: sliceCount,
              sleep_preemptions: preemptions,
            },
          }),
          listJobRecords: () => [...jobs],
        } as never,
        close: vi.fn(),
        runOnce: async (): Promise<SleepRunResult> => {
          const startedAtMs = Date.now();
          if (params.activityMonitor?.isSessionActive()) {
            return {
              status: "skipped-active",
              startedAtMs,
              endedAtMs: Date.now(),
              workDoneCounts: emptyCounts,
              telemetry: { counts: { sleep_runs: sliceCount, sleep_preemptions: preemptions } },
              jobRecords: [...jobs],
            } satisfies SleepRunResult;
          }

          sliceCount += 1;
          if (sliceCount === 1) {
            jobs[0] = {
              ...jobs[0],
              status: "running",
              cursorJson: JSON.stringify({ cursor: 1 }),
              updatedAtMs: Date.now(),
            };
            await new Promise<void>((resolve) => {
              releaseFirstRun = resolve;
            });
            if (params.activityMonitor?.isSessionActive()) {
              preemptions += 1;
              jobs[0] = {
                ...jobs[0],
                status: "paused",
                cursorJson: JSON.stringify({ cursor: 1 }),
                updatedAtMs: Date.now(),
              };
              return {
                status: "preempted",
                startedAtMs,
                endedAtMs: Date.now(),
                preemptedJob: "consolidate",
                workDoneCounts: emptyCounts,
                telemetry: { counts: { sleep_runs: sliceCount, sleep_preemptions: preemptions } },
                jobRecords: [...jobs],
              } satisfies SleepRunResult;
            }
          }

          jobs[0] = {
            ...jobs[0],
            status: "idle",
            cursorJson: JSON.stringify({ cursor: 2 }),
            updatedAtMs: Date.now(),
          };
          return {
            status: "completed",
            startedAtMs,
            endedAtMs: Date.now(),
            workDoneCounts: promotionCounts,
            telemetry: { counts: { sleep_runs: sliceCount, sleep_preemptions: preemptions } },
            jobRecords: [...jobs],
          } satisfies SleepRunResult;
        },
      }),
    });

    const controller = getMemoryJobsController("main");

    await vi.advanceTimersByTimeAsync(300);
    expect(releaseFirstRun).toBeTypeOf("function");

    controller.noteGatewayRequest();
    releaseFirstRun?.();
    await Promise.resolve();
    await Promise.resolve();

    const paused = controller.getStatus();
    expect(paused.runtime.lastStatus).toBe("preempted");
    expect(paused.runtime.lastPreemptedJob).toBe("consolidate");
    expect(paused.jobs[0]?.status).toBe("paused");
    expect(paused.jobs[0]?.cursorJson).toBe(JSON.stringify({ cursor: 1 }));

    await vi.advanceTimersByTimeAsync(1_900);

    const resumed = controller.getStatus();
    expect(resumed.runtime.lastStatus).toBe("completed");
    expect(resumed.jobs[0]?.status).toBe("idle");
    expect(resumed.jobs[0]?.cursorJson).toBe(JSON.stringify({ cursor: 2 }));
    expect(resumed.runtime.sliceCount).toBeGreaterThanOrEqual(2);
    expect(resumed.telemetry.counts.sleep_preemptions).toBe(1);
  });
});
