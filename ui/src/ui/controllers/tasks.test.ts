import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  Task,
  TaskProposalDraft,
  TaskProposalRecord,
  TaskRecord,
  TasksOverviewResult,
} from "../types.ts";
import {
  launchTaskProposal,
  loadTasksOverview,
  resolveTaskProposal,
  type TasksState,
} from "./tasks.ts";

function createTask(taskId: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId,
    runtime: "subagent",
    requesterSessionKey: "main",
    task: "Implement task workflow",
    status: "running",
    deliveryStatus: "pending",
    notifyPolicy: "done_only",
    createdAt: 1,
    ...overrides,
  };
}

function createCanonicalTask(taskId: string, overrides: Partial<Task> = {}): Task {
  return {
    taskId,
    rootTaskId: taskId,
    kind: "task",
    title: "Implement canonical task workflow",
    acceptance: [],
    status: "draft",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createProposal(
  proposalId: string,
  overrides: Partial<TaskProposalRecord> = {},
): TaskProposalRecord {
  return {
    proposalId,
    clientKey: "msg:assistant-1:0",
    requesterSessionKey: "main",
    kind: "task",
    title: "Implement task workflow",
    acceptance: [],
    createdBy: "assistant",
    decision: "pending",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createOverview(overrides: Partial<TasksOverviewResult> = {}): TasksOverviewResult {
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
      total: 0,
      roots: 0,
      draft: 0,
      pendingApproval: 0,
      ready: 0,
      inProgress: 0,
      blocked: 0,
      awaitingReview: 0,
      completed: 0,
      cancelled: 0,
      failed: 0,
    },
    proposalSummary: {
      total: 0,
      pending: 0,
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
    proposals: [],
    tasks: [],
    canonicalTasks: [],
    canonicalExecutions: [],
    canonicalAssignments: [],
    canonicalApprovals: [],
    canonicalEvents: [],
    canonicalDependencies: [],
    total: 0,
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

function createState(
  request: ReturnType<typeof vi.fn> = vi.fn(),
  overrides: Partial<TasksState> = {},
): TasksState {
  return {
    client: { request } as unknown as GatewayBrowserClient,
    connected: true,
    tasksLoading: false,
    tasksBusy: false,
    tasksError: null,
    tasksOverview: null,
    tasksSelectedId: null,
    tasksQuery: "",
    tasksRuntimeFilter: "all",
    tasksStatusFilter: "all",
    tasksLimit: 50,
    assistantAgentId: "main-agent",
    ...overrides,
  };
}

describe("tasks controller", () => {
  it("normalizes proposals and proposal summary when loading the tasks overview", async () => {
    const request = vi.fn().mockResolvedValue(
      createOverview({
        proposalSummary: {
          total: 2,
          pending: 1,
          approved: 1,
          rejected: 0,
          launched: 0,
        },
        proposals: [
          createProposal("proposal-1", {
            acceptance: ["Tasks tab exists", "Chat cards launch work"],
            launchedTaskId: "linked-task",
          }),
        ],
        canonicalSummary: {
          total: 1,
          roots: 1,
          draft: 1,
          pendingApproval: 0,
          ready: 0,
          inProgress: 0,
          blocked: 0,
          awaitingReview: 0,
          completed: 0,
          cancelled: 0,
          failed: 0,
        },
        canonicalTasks: [createCanonicalTask("task-1")],
        tasks: [createTask("legacy-task-1")],
        total: 1,
      }),
    );
    const state = createState(request);

    await loadTasksOverview(state);

    expect(request).toHaveBeenCalledWith("tasks.overview", {
      runtime: "all",
      status: "all",
      query: undefined,
      limit: 50,
      offset: 0,
    });
    expect(state.tasksOverview?.proposalSummary.pending).toBe(1);
    expect(state.tasksOverview?.proposals[0]?.proposalId).toBe("proposal-1");
    expect(state.tasksOverview?.proposals[0]?.acceptance).toEqual([
      "Tasks tab exists",
      "Chat cards launch work",
    ]);
    expect(state.tasksOverview?.proposals[0]?.launchedTaskId).toBe("linked-task");
    expect(state.tasksSelectedId).toBe("task-1");
  });

  it("keeps the tasks view compatible with gateways that do not send proposal fields yet", async () => {
    const request = vi.fn().mockResolvedValue({
      summary: createOverview().summary,
      filteredSummary: createOverview().filteredSummary,
      audit: createOverview().audit,
      findings: [],
      maintenance: createOverview().maintenance,
      tasks: [createTask("task-1")],
      canonicalSummary: createOverview().canonicalSummary,
      canonicalTasks: [],
      canonicalExecutions: [],
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
    });
    const state = createState(request);

    await loadTasksOverview(state);

    expect(state.tasksError).toBeNull();
    expect(state.tasksOverview?.proposals).toEqual([]);
    expect(state.tasksOverview?.proposalSummary).toEqual({
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      launched: 0,
    });
    expect(state.tasksOverview?.canonicalTasks).toEqual([]);
  });

  it("upserts then resolves a missing proposal before refreshing the overview", async () => {
    const draft: TaskProposalDraft = {
      clientKey: "msg:assistant-1:0",
      requesterSessionKey: "main",
      kind: "task",
      title: "Implement task workflow",
      summary: "Add approvals and launch flow",
      acceptance: ["Approve from chat", "Launch child session"],
      launchPrompt: "Implement the task approval workflow.",
      createdBy: "assistant",
    };
    const pending = createProposal("proposal-1", {
      summary: draft.summary,
      acceptance: draft.acceptance,
      launchPrompt: draft.launchPrompt,
    });
    const approved = createProposal("proposal-1", {
      decision: "approved",
      summary: draft.summary,
      acceptance: draft.acceptance,
      launchPrompt: draft.launchPrompt,
    });
    const request = vi.fn(async (method: string) => {
      if (method === "tasks.proposal.upsert") {
        return { proposal: pending };
      }
      if (method === "tasks.proposal.resolve") {
        return { proposal: approved };
      }
      if (method === "tasks.overview") {
        return createOverview({
          proposalSummary: {
            total: 1,
            pending: 0,
            approved: 1,
            rejected: 0,
            launched: 0,
          },
          proposals: [approved],
        });
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const state = createState(request);

    const result = await resolveTaskProposal(state, draft, "approved");

    expect(result?.decision).toBe("approved");
    expect(request).toHaveBeenNthCalledWith(1, "tasks.proposal.upsert", {
      clientKey: draft.clientKey,
      requesterSessionKey: draft.requesterSessionKey,
      sourceMessageId: undefined,
      kind: draft.kind,
      title: draft.title,
      summary: draft.summary,
      rationale: undefined,
      acceptance: draft.acceptance,
      launchPrompt: draft.launchPrompt,
      agentId: undefined,
      createdBy: draft.createdBy,
    });
    expect(request).toHaveBeenNthCalledWith(2, "tasks.proposal.resolve", {
      proposalId: "proposal-1",
      decision: "approved",
    });
    expect(state.tasksOverview?.proposals[0]?.decision).toBe("approved");
    expect(state.tasksBusy).toBe(false);
    expect(state.tasksError).toBeNull();
  });

  it("launches an approved child session from a proposal and links the run back to the inbox", async () => {
    const draft: TaskProposalDraft = {
      clientKey: "msg:assistant-1:0",
      requesterSessionKey: "main",
      kind: "project",
      title: "Ship task inbox",
      summary: "Expose inbox and launch actions",
      acceptance: ["Inbox exists", "Approved proposals launch"],
      launchPrompt: "Implement the task inbox and proposal launch flow.",
      createdBy: "assistant",
    };
    const pending = createProposal("proposal-1", {
      kind: "project",
      title: draft.title,
      summary: draft.summary,
      acceptance: draft.acceptance,
      launchPrompt: draft.launchPrompt,
    });
    createProposal("proposal-1", {
      kind: "project",
      title: draft.title,
      decision: "approved",
      summary: draft.summary,
      acceptance: draft.acceptance,
      launchPrompt: draft.launchPrompt,
    });
    const launched = createProposal("proposal-1", {
      kind: "project",
      title: draft.title,
      decision: "approved",
      summary: draft.summary,
      acceptance: draft.acceptance,
      launchPrompt: draft.launchPrompt,
      launchedTaskId: "canonical-task-1",
      launchedRunId: "run-task-1",
      launchedSessionKey: "agent:main:task:1",
      launchedAt: 10,
    });
    const request = vi.fn(async (method: string) => {
      if (method === "tasks.proposal.upsert") {
        return { proposal: pending };
      }
      if (method === "tasks.launchFromProposal") {
        return {
          proposal: launched,
          sessionKey: "agent:main:task:1",
          runId: "run-task-1",
        };
      }
      if (method === "tasks.overview") {
        return createOverview({
          proposalSummary: {
            total: 1,
            pending: 0,
            approved: 1,
            rejected: 0,
            launched: 1,
          },
          proposals: [launched],
        });
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const state = createState(request, {
      assistantAgentId: "assistant-main",
    });

    const result = await launchTaskProposal(state, draft);

    expect(result).toEqual({
      proposal: launched,
      sessionKey: "agent:main:task:1",
      runId: "run-task-1",
    });
    expect(request).toHaveBeenNthCalledWith(2, "tasks.launchFromProposal", {
      proposalId: "proposal-1",
      agentId: "assistant-main",
    });
    expect(state.tasksOverview?.proposalSummary.launched).toBe(1);
    expect(state.tasksBusy).toBe(false);
    expect(state.tasksError).toBeNull();
  });
});
