/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import type {
  Task,
  TaskExecution,
  TaskProposalRecord,
  TaskRecord,
  TasksOverviewResult,
} from "../types.ts";
import { renderTasks, type TasksViewProps } from "./tasks.ts";

function createCanonicalTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: "canonical-task-1",
    rootTaskId: "canonical-task-1",
    kind: "task",
    title: "Ship the tasks tab",
    acceptance: ["Tasks view is usable"],
    status: "in_progress",
    requesterSessionKey: "main",
    orchestratorSessionKey: "task-session",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function createExecution(overrides: Partial<TaskExecution> = {}): TaskExecution {
  return {
    executionId: "execution-1",
    taskId: "canonical-task-1",
    kind: "subagent",
    attempt: 1,
    runId: "run-1",
    sessionKey: "task-session",
    status: "running",
    createdAt: 1,
    startedAt: 2,
    ...overrides,
  };
}

function createLegacyTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId: "legacy-task-1",
    runtime: "subagent",
    requesterSessionKey: "main",
    childSessionKey: "task-session",
    runId: "run-1",
    task: "Ship the tasks tab",
    status: "running",
    deliveryStatus: "pending",
    notifyPolicy: "state_changes",
    createdAt: 1,
    ...overrides,
  };
}

function createOverview(overrides: Partial<TasksOverviewResult> = {}): TasksOverviewResult {
  const canonicalTask = createCanonicalTask();
  return {
    summary: {
      total: 1,
      active: 1,
      terminal: 0,
      failures: 0,
      byStatus: {
        queued: 0,
        running: 1,
        succeeded: 0,
        failed: 0,
        timed_out: 0,
        cancelled: 0,
        lost: 0,
      },
      byRuntime: {
        subagent: 1,
        acp: 0,
        cli: 0,
        cron: 0,
      },
    },
    filteredSummary: {
      total: 1,
      active: 1,
      terminal: 0,
      failures: 0,
      byStatus: {
        queued: 0,
        running: 1,
        succeeded: 0,
        failed: 0,
        timed_out: 0,
        cancelled: 0,
        lost: 0,
      },
      byRuntime: {
        subagent: 1,
        acp: 0,
        cli: 0,
        cron: 0,
      },
    },
    canonicalSummary: {
      total: 1,
      roots: 1,
      draft: 0,
      pendingApproval: 0,
      ready: 0,
      inProgress: 1,
      blocked: 0,
      awaitingReview: 0,
      completed: 0,
      cancelled: 0,
      failed: 0,
    },
    proposalSummary: {
      total: 1,
      pending: 1,
      approved: 0,
      rejected: 0,
      launched: 0,
    },
    audit: {
      total: 0,
      warnings: 0,
      errors: 0,
      byCode: {
        stale_queued: 0,
        stale_running: 0,
        lost: 0,
        delivery_failed: 0,
        missing_cleanup: 0,
        inconsistent_timestamps: 0,
      },
    },
    findings: [],
    maintenance: {
      reconciled: 0,
      cleanupStamped: 0,
      pruned: 0,
    },
    proposals: [
      {
        proposalId: "proposal-1",
        clientKey: "msg:assistant-1:0",
        requesterSessionKey: "main",
        kind: "task",
        title: "Ship the tasks tab",
        acceptance: [],
        createdBy: "assistant",
        decision: "pending",
        createdAt: 1,
        updatedAt: 1,
      } satisfies TaskProposalRecord,
    ],
    tasks: [createLegacyTask()],
    canonicalTasks: [canonicalTask],
    canonicalExecutions: [createExecution()],
    canonicalAssignments: [],
    canonicalApprovals: [],
    canonicalEvents: [],
    canonicalDependencies: [],
    total: 1,
    limit: 50,
    offset: 0,
    nextOffset: null,
    hasMore: false,
    runtime: null,
    status: null,
    query: null,
    ...overrides,
  };
}

function createProps(overrides: Partial<TasksViewProps> = {}): TasksViewProps {
  return {
    loading: false,
    busy: false,
    error: null,
    overview: createOverview(),
    selectedId: "canonical-task-1",
    query: "",
    runtimeFilter: "all",
    statusFilter: "all",
    onRefresh: () => undefined,
    onQueryChange: () => undefined,
    onRuntimeFilterChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onSelectTask: () => undefined,
    onCancelTask: () => undefined,
    onResolveProposal: () => undefined,
    onLaunchProposal: () => undefined,
    onOpenRequesterSession: () => undefined,
    onOpenChildSession: () => undefined,
    ...overrides,
  };
}

describe("tasks view", () => {
  it("renders unified skeleton panels on the first load", () => {
    const container = document.createElement("div");
    render(
      renderTasks(
        createProps({
          loading: true,
          overview: null,
          selectedId: null,
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".loading-state__input")).toHaveLength(3);
    expect(container.querySelectorAll(".loading-state__stat-card")).toHaveLength(7);
    expect(container.querySelectorAll(".loading-state__list-item").length).toBeGreaterThan(5);
  });

  it("surfaces the orchestrator runtime in the executor filter", () => {
    const container = document.createElement("div");
    render(renderTasks(createProps()), container);

    const runtimeSelect = container.querySelector(
      ".alisio-tasks__filter select",
    ) as HTMLSelectElement | null;
    expect(runtimeSelect).not.toBeNull();
    expect(runtimeSelect?.textContent).toContain("Orchestrator");
  });

  it("shows a callout when the tasks surface has an error", () => {
    const container = document.createElement("div");
    render(renderTasks(createProps({ error: "Sharing cloud is unavailable." })), container);

    const callout = container.querySelector(".callout.danger");
    expect(callout).not.toBeNull();
    expect(callout?.textContent).toContain("Sharing cloud is unavailable.");
  });

  it("ignores legacy runs when there are no canonical tasks to show", () => {
    const container = document.createElement("div");
    render(
      renderTasks(
        createProps({
          overview: createOverview({
            canonicalTasks: [],
            canonicalExecutions: [],
          }),
          selectedId: "legacy-task-1",
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("Earlier background runs");
    expect(container.textContent).toContain("No tasks match the current filters yet.");
    expect(container.textContent).not.toContain("Open task chat");
  });
});
