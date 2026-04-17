import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  Task,
  TaskExecution,
  TaskProposalDraft,
  TaskProposalRecord,
  TasksDetailResult,
  TasksOverviewResult,
} from "../types.ts";
import {
  launchTaskProposal,
  loadTaskDetail,
  loadTasksOverview,
  resolveTaskProposal,
  selectTask,
  type TasksState,
} from "./tasks.ts";

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

function createExecution(taskId: string, overrides: Partial<TaskExecution> = {}): TaskExecution {
  return {
    executionId: `execution-${taskId}`,
    taskId,
    kind: "orchestrator_session",
    attempt: 1,
    status: "running",
    createdAt: 1,
    startedAt: 1,
    ...overrides,
  };
}

function createDetail(
  taskId = "task-1",
  overrides: Partial<TasksDetailResult> = {},
): TasksDetailResult {
  return {
    task: createCanonicalTask(taskId),
    children: [],
    childExecutions: [],
    executions: [createExecution(taskId)],
    assignments: [],
    approvals: [],
    events: [],
    steps: [],
    dependencies: [],
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
    proposals: [],
    canonicalTasks: [],
    canonicalExecutions: [],
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
    tasksDetailLoading: false,
    tasksDetail: null,
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
        canonicalExecutions: [createExecution("task-1")],
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
      canonicalSummary: createOverview().canonicalSummary,
      canonicalTasks: [],
      canonicalExecutions: [],
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
    expect(state.tasksSelectedId).toBeNull();
  });

  it("loads canonical task detail after selecting a task", async () => {
    const detail = createDetail("task-2");
    const request = vi.fn(async (method: string) => {
      if (method === "tasks.detail") {
        return detail;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const state = createState(request, {
      tasksOverview: createOverview({
        canonicalTasks: [createCanonicalTask("task-1"), createCanonicalTask("task-2")],
        canonicalExecutions: [createExecution("task-1"), createExecution("task-2")],
      }),
      tasksSelectedId: "task-1",
    });

    await selectTask(state, "task-2");

    expect(request).toHaveBeenCalledWith("tasks.detail", { taskId: "task-2" });
    expect(state.tasksSelectedId).toBe("task-2");
    expect(state.tasksDetail?.task.taskId).toBe("task-2");
  });

  it("does not block the tasks overview on the selected task detail fetch", async () => {
    let resolveDetail!: (value: TasksDetailResult) => void;
    const detailPromise = new Promise<TasksDetailResult>((resolve) => {
      resolveDetail = resolve;
    });
    const request = vi.fn((method: string) => {
      if (method === "tasks.overview") {
        return Promise.resolve(
          createOverview({
            canonicalTasks: [createCanonicalTask("task-1")],
            canonicalExecutions: [createExecution("task-1")],
          }),
        );
      }
      if (method === "tasks.detail") {
        return detailPromise;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const state = createState(request);

    await loadTasksOverview(state);

    expect(state.tasksOverview?.canonicalTasks[0]?.taskId).toBe("task-1");
    expect(state.tasksLoading).toBe(false);
    expect(state.tasksDetailLoading).toBe(true);
    expect(state.tasksDetail).toBeNull();

    resolveDetail(createDetail("task-1"));
    await Promise.resolve();
    await Promise.resolve();

    expect(state.tasksDetailLoading).toBe(false);
    expect(state.tasksDetail?.task.taskId).toBe("task-1");
  });

  it("skips reloading task detail during quiet polls when the selected task is unchanged", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "tasks.overview") {
        return createOverview({
          canonicalTasks: [
            createCanonicalTask("task-1", {
              status: "in_progress",
              updatedAt: 42,
              latestExecutionId: "execution-task-1",
            }),
          ],
          canonicalExecutions: [
            createExecution("task-1", {
              executionId: "execution-task-1",
            }),
          ],
        });
      }
      if (method === "tasks.detail") {
        return createDetail("task-1", {
          task: createCanonicalTask("task-1", {
            status: "in_progress",
            updatedAt: 42,
            latestExecutionId: "execution-task-1",
          }),
        });
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const state = createState(request, {
      tasksSelectedId: "task-1",
      tasksDetail: createDetail("task-1", {
        task: createCanonicalTask("task-1", {
          status: "in_progress",
          updatedAt: 42,
          latestExecutionId: "execution-task-1",
        }),
      }),
    });

    await loadTasksOverview(state, { quiet: true });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("tasks.overview", {
      runtime: "all",
      status: "all",
      query: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it("loads task detail directly when requested", async () => {
    const detail = createDetail("task-1", {
      steps: [],
    });
    const request = vi.fn(async (method: string) => {
      if (method === "tasks.detail") {
        return detail;
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const state = createState(request);

    await loadTaskDetail(state, "task-1");

    expect(state.tasksDetailLoading).toBe(false);
    expect(state.tasksDetail?.task.taskId).toBe("task-1");
    expect(state.tasksError).toBeNull();
  });

  it("sends the orchestrator runtime filter through the canonical overview contract", async () => {
    const request = vi.fn().mockResolvedValue(
      createOverview({
        canonicalTasks: [createCanonicalTask("task-1")],
      }),
    );
    const state = createState(request, {
      tasksRuntimeFilter: "orchestrator_session",
    });

    await loadTasksOverview(state);

    expect(request).toHaveBeenCalledWith("tasks.overview", {
      runtime: "orchestrator_session",
      status: "all",
      query: undefined,
      limit: 50,
      offset: 0,
    });
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
