import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskProposalView } from "../../tasks/task-proposals.types.js";
import type { TaskRecord } from "../../tasks/task-registry.types.js";
import type {
  Task,
  TaskApproval,
  TaskAssignment,
  TaskEvent,
  TaskExecution,
} from "../../tasks/task-service.types.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  loadConfigMock: vi.fn(() => ({ gateway: { mode: "local" } })),
  listTaskAuditFindingsMock: vi.fn(),
  summarizeTaskAuditFindingsMock: vi.fn(),
  cancelTaskByIdMock: vi.fn(),
  updateTaskNotifyPolicyByIdMock: vi.fn(),
  previewTaskRegistryMaintenanceMock: vi.fn(),
  reconcileInspectableTasksMock: vi.fn(),
  reconcileTaskLookupTokenMock: vi.fn(),
  getInspectableTaskRegistrySummaryMock: vi.fn(),
  summarizeTaskRecordsMock: vi.fn(),
  listTaskProposalViewsMock: vi.fn(),
  summarizeTaskProposalsMock: vi.fn(),
  upsertTaskProposalMock: vi.fn(),
  getTaskProposalViewByIdMock: vi.fn(),
  resolveTaskProposalDecisionMock: vi.fn(),
  attachTaskProposalLaunchMock: vi.fn(),
  createTaskMock: vi.fn(),
  updateTaskMock: vi.fn(),
  getTaskMock: vi.fn(),
  getTaskBundleMock: vi.fn(),
  getTaskExecutionByRunIdMock: vi.fn(),
  listTasksMock: vi.fn(),
  findTaskForSessionKeyMock: vi.fn(),
  markTaskExecutionRunningByRunIdMock: vi.fn(),
  bindTaskExecutionRunMock: vi.fn(),
  cancelTaskTreeMock: vi.fn(),
  claimTaskMock: vi.fn(),
  releaseTaskMock: vi.fn(),
  spawnChildTaskMock: vi.fn(),
  startTaskExecutionMock: vi.fn(),
  endTaskExecutionMock: vi.fn(),
  cancelTaskExecutionMock: vi.fn(),
  requestTaskApprovalMock: vi.fn(),
  decideTaskApprovalMock: vi.fn(),
  createGatewaySessionEntryMock: vi.fn(),
  sendGatewaySessionMessageMock: vi.fn(),
  loadSessionEntryMock: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfigMock,
}));

vi.mock("../../tasks/task-registry.audit.js", () => ({
  listTaskAuditFindings: mocks.listTaskAuditFindingsMock,
  summarizeTaskAuditFindings: mocks.summarizeTaskAuditFindingsMock,
}));

vi.mock("../../tasks/task-registry.js", () => ({
  cancelTaskById: mocks.cancelTaskByIdMock,
  updateTaskNotifyPolicyById: mocks.updateTaskNotifyPolicyByIdMock,
}));

vi.mock("../../tasks/task-registry.maintenance.js", () => ({
  previewTaskRegistryMaintenance: mocks.previewTaskRegistryMaintenanceMock,
  reconcileInspectableTasks: mocks.reconcileInspectableTasksMock,
  reconcileTaskLookupToken: mocks.reconcileTaskLookupTokenMock,
  getInspectableTaskRegistrySummary: mocks.getInspectableTaskRegistrySummaryMock,
}));

vi.mock("../../tasks/task-registry.summary.js", () => ({
  summarizeTaskRecords: mocks.summarizeTaskRecordsMock,
}));

vi.mock("../../tasks/task-proposals.js", () => ({
  getTaskProposalViewById: mocks.getTaskProposalViewByIdMock,
  listTaskProposalViews: mocks.listTaskProposalViewsMock,
  summarizeTaskProposals: mocks.summarizeTaskProposalsMock,
  upsertTaskProposal: mocks.upsertTaskProposalMock,
  resolveTaskProposalDecision: mocks.resolveTaskProposalDecisionMock,
  attachTaskProposalLaunch: mocks.attachTaskProposalLaunchMock,
}));

vi.mock("../../tasks/task-service.js", () => ({
  bindTaskExecutionRun: mocks.bindTaskExecutionRunMock,
  cancelTaskTree: mocks.cancelTaskTreeMock,
  createTask: mocks.createTaskMock,
  claimTask: mocks.claimTaskMock,
  cancelTaskExecution: mocks.cancelTaskExecutionMock,
  decideTaskApproval: mocks.decideTaskApprovalMock,
  endTaskExecution: mocks.endTaskExecutionMock,
  findTaskForSessionKey: mocks.findTaskForSessionKeyMock,
  getTask: mocks.getTaskMock,
  getTaskBundle: mocks.getTaskBundleMock,
  getTaskExecutionByRunId: mocks.getTaskExecutionByRunIdMock,
  listTasks: mocks.listTasksMock,
  markTaskExecutionRunningByRunId: mocks.markTaskExecutionRunningByRunIdMock,
  releaseTask: mocks.releaseTaskMock,
  requestTaskApproval: mocks.requestTaskApprovalMock,
  spawnChildTask: mocks.spawnChildTaskMock,
  startTaskExecution: mocks.startTaskExecutionMock,
  updateTask: mocks.updateTaskMock,
}));

vi.mock("./sessions.js", () => ({
  createGatewaySessionEntry: mocks.createGatewaySessionEntryMock,
  sendGatewaySessionMessage: mocks.sendGatewaySessionMessageMock,
}));

vi.mock("../session-utils.js", () => ({
  loadSessionEntry: mocks.loadSessionEntryMock,
}));

import { tasksHandlers } from "./tasks.js";

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    taskId: "task-1",
    runtime: "subagent",
    requesterSessionKey: "main",
    task: "Inspect background task state",
    status: "running",
    deliveryStatus: "pending",
    notifyPolicy: "done_only",
    createdAt: 1_000,
    lastEventAt: 2_000,
    ...overrides,
  };
}

function createOptions(
  method: string,
  params: Record<string, unknown>,
  overrides?: Partial<GatewayRequestHandlerOptions>,
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {
      deps: {} as GatewayRequestHandlerOptions["context"]["deps"],
      cron: {} as GatewayRequestHandlerOptions["context"]["cron"],
      cronStorePath: "",
      loadGatewayModelCatalog: vi.fn(),
      getHealthCache: vi.fn(),
      refreshHealthSnapshot: vi.fn(),
      logHealth: { error: vi.fn() },
      logGateway: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
      incrementPresenceVersion: vi.fn(),
      getHealthVersion: vi.fn(),
      broadcast: vi.fn(),
      broadcastToConnIds: vi.fn(),
      nodeSendToSession: vi.fn(),
      nodeSendToAllSubscribed: vi.fn(),
      nodeSubscribe: vi.fn(),
      nodeUnsubscribe: vi.fn(),
      nodeUnsubscribeAll: vi.fn(),
      hasConnectedMobileNode: vi.fn(),
      nodeRegistry: {} as GatewayRequestHandlerOptions["context"]["nodeRegistry"],
      agentRunSeq: new Map(),
      chatAbortControllers: new Map(),
      chatAbortedRuns: new Map(),
      chatRunBuffers: new Map(),
      chatDeltaSentAt: new Map(),
      chatDeltaLastBroadcastLen: new Map(),
      addChatRun: vi.fn(),
      removeChatRun: vi.fn(),
      subscribeSessionEvents: vi.fn(),
      unsubscribeSessionEvents: vi.fn(),
      subscribeSessionMessageEvents: vi.fn(),
      unsubscribeSessionMessageEvents: vi.fn(),
      unsubscribeAllSessionEvents: vi.fn(),
      getSessionEventSubscriberConnIds: vi.fn(() => new Set()),
      registerToolEventRecipient: vi.fn(),
      dedupe: new Map(),
      wizardSessions: new Map(),
      channelWizardSessions: new Map(),
      findRunningWizard: vi.fn(),
      getRunningChannelWizard: vi.fn(),
      purgeWizardSession: vi.fn(),
      purgeChannelWizardSession: vi.fn(),
      rememberChannelWizardSession: vi.fn(),
      getRuntimeSnapshot: vi.fn(),
      startChannel: vi.fn(),
      stopChannel: vi.fn(),
      markChannelLoggedOut: vi.fn(),
      wizardRunner: vi.fn(),
      channelWizardRunner: vi.fn(),
      broadcastVoiceWakeChanged: vi.fn(),
    },
    ...overrides,
  } as unknown as GatewayRequestHandlerOptions;
}

function createProposal(overrides: Partial<TaskProposalView> = {}): TaskProposalView {
  return {
    proposalId: "proposal-1",
    clientKey: "msg:assistant:1:0",
    requesterSessionKey: "agent:main:main",
    sourceMessageId: "message-1",
    kind: "task",
    title: "Ship task inbox",
    summary: "Add task inbox governance on top of the task ledger.",
    rationale: "Lets the agent propose work without mutating the execution ledger.",
    acceptance: ["Inbox visible in Tasks tab", "Chat cards can approve and launch"],
    launchPrompt: "Implement the inbox flow and keep the existing task ledger intact.",
    agentId: "main",
    createdBy: "assistant",
    decision: "pending",
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function createCanonicalTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: "canonical-task-1",
    rootTaskId: "canonical-task-1",
    kind: "task",
    title: "Canonical task",
    acceptance: [],
    status: "draft",
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function createAssignment(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    assignmentId: "assignment-1",
    taskId: "canonical-task-1",
    agentId: "main",
    status: "active",
    claimedAt: 1_100,
    leaseExpiresAt: 2_100,
    ...overrides,
  };
}

function createExecution(overrides: Partial<TaskExecution> = {}): TaskExecution {
  return {
    executionId: "execution-1",
    taskId: "canonical-task-1",
    kind: "subagent",
    attempt: 1,
    status: "running",
    createdAt: 1_200,
    startedAt: 1_200,
    ...overrides,
  };
}

function createApproval(overrides: Partial<TaskApproval> = {}): TaskApproval {
  return {
    approvalId: "approval-1",
    taskId: "canonical-task-1",
    status: "pending",
    requestedAt: 1_300,
    ...overrides,
  };
}

function createEvent(overrides: Partial<TaskEvent> = {}): TaskEvent {
  return {
    eventId: "event-1",
    taskId: "canonical-task-1",
    kind: "created",
    createdAt: 1_000,
    ...overrides,
  };
}

describe("tasksHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInspectableTaskRegistrySummaryMock.mockReturnValue({
      total: 2,
      active: 2,
      terminal: 0,
      failures: 0,
      byStatus: {
        queued: 0,
        running: 2,
        succeeded: 0,
        failed: 0,
        timed_out: 0,
        cancelled: 0,
        lost: 0,
      },
      byRuntime: {
        subagent: 2,
        acp: 0,
        cli: 0,
        cron: 0,
      },
    });
    mocks.summarizeTaskRecordsMock.mockReturnValue({
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
    });
    mocks.listTaskAuditFindingsMock.mockReturnValue([]);
    mocks.summarizeTaskAuditFindingsMock.mockReturnValue({
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
    });
    mocks.previewTaskRegistryMaintenanceMock.mockReturnValue({
      reconciled: 0,
      cleanupStamped: 0,
      pruned: 0,
    });
    mocks.listTaskProposalViewsMock.mockReturnValue([]);
    mocks.summarizeTaskProposalsMock.mockReturnValue({
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      launched: 0,
    });
    mocks.getTaskProposalViewByIdMock.mockReturnValue(null);
    mocks.listTasksMock.mockReturnValue([]);
    mocks.getTaskBundleMock.mockReturnValue(null);
    mocks.getTaskMock.mockReturnValue(null);
    mocks.getTaskExecutionByRunIdMock.mockReturnValue(null);
    mocks.findTaskForSessionKeyMock.mockReturnValue(null);
    mocks.createTaskMock.mockReturnValue(createCanonicalTask());
    mocks.updateTaskMock.mockReturnValue(createCanonicalTask({ status: "ready" }));
    mocks.bindTaskExecutionRunMock.mockImplementation(
      ({ executionId, runId }: { executionId: string; runId: string }) => ({
        task: createCanonicalTask({ taskId: "canonical-task-1" }),
        execution: createExecution({ executionId, runId }),
      }),
    );
    mocks.cancelTaskTreeMock.mockReturnValue(createCanonicalTask({ status: "cancelled" }));
    mocks.claimTaskMock.mockReturnValue({
      task: createCanonicalTask({ ownerAgentId: "main" }),
      assignment: createAssignment(),
    });
    mocks.releaseTaskMock.mockReturnValue({
      task: createCanonicalTask(),
      assignment: createAssignment({ status: "released", releasedAt: 1_500 }),
    });
    mocks.spawnChildTaskMock.mockReturnValue({
      task: createCanonicalTask({
        taskId: "child-task-1",
        rootTaskId: "canonical-task-1",
        parentTaskId: "canonical-task-1",
      }),
      execution: undefined,
    });
    mocks.startTaskExecutionMock.mockReturnValue({
      task: createCanonicalTask({ status: "in_progress", activeExecutionId: "execution-1" }),
      execution: createExecution(),
    });
    mocks.endTaskExecutionMock.mockReturnValue({
      task: createCanonicalTask({ status: "completed", latestExecutionId: "execution-1" }),
      execution: createExecution({ status: "succeeded", endedAt: 1_400 }),
    });
    mocks.cancelTaskExecutionMock.mockReturnValue({
      task: createCanonicalTask({ status: "cancelled", latestExecutionId: "execution-1" }),
      execution: createExecution({ status: "cancelled", endedAt: 1_450 }),
    });
    mocks.requestTaskApprovalMock.mockReturnValue({
      task: createCanonicalTask({ status: "pending_approval", latestApprovalId: "approval-1" }),
      approval: createApproval(),
    });
    mocks.decideTaskApprovalMock.mockReturnValue({
      task: createCanonicalTask({ status: "ready", latestApprovalId: "approval-1" }),
      approval: createApproval({ status: "approved", decidedAt: 1_350 }),
    });
    mocks.markTaskExecutionRunningByRunIdMock.mockReturnValue({
      task: createCanonicalTask({ status: "in_progress", activeExecutionId: "execution-1" }),
      execution: createExecution({ status: "running" }),
    });
    mocks.createGatewaySessionEntryMock.mockResolvedValue({
      key: "agent:main:task:1",
      storePath: "/tmp/session-store",
      entry: {
        sessionId: "session-1",
        sessionFile: "/tmp/session-file",
      },
    });
    mocks.sendGatewaySessionMessageMock.mockResolvedValue({
      payload: { runId: "run-task-1" },
      runStarted: true,
    });
    mocks.loadSessionEntryMock.mockReturnValue({
      canonicalKey: "agent:main:task:1",
      storePath: "/tmp/session-store",
      entry: {
        sessionId: "session-1",
        sessionFile: "/tmp/session-file",
      },
    });
  });

  it("filters and paginates the task overview", async () => {
    const matchingTask = createTask({
      taskId: "task-running",
      runtime: "subagent",
      task: "Inspect background task state",
      status: "running",
    });
    const nonMatchingTask = createTask({
      taskId: "task-failed",
      runtime: "cron",
      task: "Cron follow-up",
      status: "failed",
    });
    mocks.reconcileInspectableTasksMock.mockReturnValue([matchingTask, nonMatchingTask]);
    const opts = createOptions("tasks.overview", {
      runtime: "subagent",
      status: "running",
      query: "background",
      limit: 1,
      offset: 0,
    });

    await tasksHandlers["tasks.overview"](opts);

    expect(mocks.summarizeTaskRecordsMock).toHaveBeenCalledWith([matchingTask]);
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        total: 1,
        limit: 1,
        offset: 0,
        hasMore: false,
        proposalSummary: {
          total: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          launched: 0,
        },
        proposals: [],
        runtime: "subagent",
        status: "running",
        query: "background",
        tasks: [matchingTask],
        canonicalSteps: [],
      }),
      undefined,
    );
  });

  it("keeps task proposals complete in the overview even when tasks are filtered", async () => {
    const matchingProposal = createProposal({
      title: "Background research task",
      summary: "Track the research flow for the chat.",
    });
    const nonMatchingProposal = createProposal({
      proposalId: "proposal-2",
      clientKey: "msg:assistant:2:0",
      title: "Marketing backlog",
      summary: "Something unrelated",
    });
    mocks.reconcileInspectableTasksMock.mockReturnValue([]);
    mocks.listTaskProposalViewsMock.mockReturnValue([matchingProposal, nonMatchingProposal]);
    mocks.summarizeTaskProposalsMock.mockReturnValue({
      total: 2,
      pending: 2,
      approved: 0,
      rejected: 0,
      launched: 0,
    });
    const opts = createOptions("tasks.overview", {
      query: "research",
      limit: 10,
      offset: 0,
    });

    await tasksHandlers["tasks.overview"](opts);

    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        proposals: [matchingProposal, nonMatchingProposal],
        proposalSummary: expect.objectContaining({ total: 2, pending: 2 }),
      }),
      undefined,
    );
  });

  it("hides legacy gateway-promoted canonical tasks from the structured tasks surface", async () => {
    const legacyTask = createCanonicalTask({
      taskId: "legacy-task-1",
      rootTaskId: "legacy-task-1",
      title: "Usa o browser",
      status: "completed",
    });
    const visibleTask = createCanonicalTask({
      taskId: "visible-task-1",
      rootTaskId: "visible-task-1",
      title: "Implementar fluxo de aprovacoes",
      requesterSessionKey: "agent:main:main",
      status: "in_progress",
    });
    mocks.reconcileInspectableTasksMock.mockReturnValue([]);
    mocks.listTasksMock.mockReturnValue([legacyTask, visibleTask]);
    mocks.getTaskBundleMock.mockImplementation((taskId: string) => {
      if (taskId === legacyTask.taskId) {
        return {
          task: legacyTask,
          children: [],
          executions: [createExecution({ taskId, kind: "cli", status: "succeeded" })],
          assignments: [],
          approvals: [],
          events: [createEvent({ taskId, actor: "gateway.agent", summary: legacyTask.title })],
          steps: [],
          dependencies: [],
        };
      }
      if (taskId === visibleTask.taskId) {
        return {
          task: visibleTask,
          children: [],
          executions: [
            createExecution({
              executionId: "execution-visible-1",
              taskId,
              kind: "orchestrator_session",
              status: "running",
              sessionKey: "agent:main:task:1",
            }),
          ],
          assignments: [],
          approvals: [],
          events: [createEvent({ eventId: "event-visible-1", taskId, actor: "nuno" })],
          steps: [],
          dependencies: [],
        };
      }
      return null;
    });
    const opts = createOptions("tasks.overview", {});

    await tasksHandlers["tasks.overview"](opts);

    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        canonicalTasks: [visibleTask],
        canonicalSummary: expect.objectContaining({
          total: 1,
          inProgress: 1,
          completed: 0,
        }),
        canonicalExecutions: [
          expect.objectContaining({
            taskId: "visible-task-1",
            kind: "orchestrator_session",
          }),
        ],
      }),
      undefined,
    );
  });

  it("creates canonical tasks through the v2 handler", async () => {
    const opts = createOptions("tasks.create", {
      title: "Ship canonical task model",
      requestedBy: "nuno",
    });

    await tasksHandlers["tasks.create"](opts);

    expect(mocks.createTaskMock).toHaveBeenCalledWith({
      title: "Ship canonical task model",
      requestedBy: "nuno",
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      { task: expect.objectContaining({ taskId: "canonical-task-1" }) },
      undefined,
    );
  });

  it("claims canonical tasks through the v2 handler", async () => {
    const opts = createOptions("tasks.claim", {
      taskId: "canonical-task-1",
      agentId: "main",
      leaseMs: 60_000,
    });

    await tasksHandlers["tasks.claim"](opts);

    expect(mocks.claimTaskMock).toHaveBeenCalledWith({
      taskId: "canonical-task-1",
      agentId: "main",
      leaseMs: 60_000,
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        assignment: expect.objectContaining({ assignmentId: "assignment-1" }),
      }),
      undefined,
    );
  });

  it("starts canonical executions through the v2 handler", async () => {
    const opts = createOptions("tasks.execution.start", {
      taskId: "canonical-task-1",
      kind: "subagent",
      runId: "run-1",
    });

    await tasksHandlers["tasks.execution.start"](opts);

    expect(mocks.startTaskExecutionMock).toHaveBeenCalledWith({
      taskId: "canonical-task-1",
      kind: "subagent",
      runId: "run-1",
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        execution: expect.objectContaining({ executionId: "execution-1" }),
      }),
      undefined,
    );
  });

  it("requests task approvals through the v2 handler", async () => {
    const opts = createOptions("tasks.approval.request", {
      taskId: "canonical-task-1",
      requestedBy: "nuno",
      note: "precisa de aprovação",
    });

    await tasksHandlers["tasks.approval.request"](opts);

    expect(mocks.requestTaskApprovalMock).toHaveBeenCalledWith({
      taskId: "canonical-task-1",
      requestedBy: "nuno",
      note: "precisa de aprovação",
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        approval: expect.objectContaining({ approvalId: "approval-1" }),
      }),
      undefined,
    );
  });

  it("cancels a task with the current gateway config", async () => {
    const task = createTask({ taskId: "task-cancel" });
    const cancelResult = { found: true, cancelled: true, task };
    mocks.reconcileTaskLookupTokenMock.mockReturnValue(task);
    mocks.cancelTaskByIdMock.mockResolvedValue(cancelResult);
    const opts = createOptions("tasks.cancel", { lookup: "task-cancel" });

    await tasksHandlers["tasks.cancel"](opts);

    expect(mocks.loadConfigMock).toHaveBeenCalledTimes(1);
    expect(mocks.cancelTaskByIdMock).toHaveBeenCalledWith({
      cfg: { gateway: { mode: "local" } },
      taskId: "task-cancel",
    });
    expect(opts.respond).toHaveBeenCalledWith(true, cancelResult, undefined);
  });

  it("cancels canonical tasks before falling back to the legacy task ledger", async () => {
    mocks.getTaskMock.mockReturnValue(createCanonicalTask({ taskId: "canonical-task-1" }));
    mocks.getTaskBundleMock.mockReturnValue({
      task: createCanonicalTask({ taskId: "canonical-task-1" }),
      children: [],
      executions: [],
      assignments: [],
      approvals: [],
      events: [],
      steps: [],
      dependencies: [],
    });
    mocks.cancelTaskTreeMock.mockReturnValue(
      createCanonicalTask({ taskId: "canonical-task-1", status: "cancelled" }),
    );
    const opts = createOptions("tasks.cancel", { lookup: "canonical-task-1" });

    await tasksHandlers["tasks.cancel"](opts);

    expect(mocks.cancelTaskTreeMock).toHaveBeenCalledWith({
      taskId: "canonical-task-1",
      reason: "Cancelled via tasks.cancel (canonical-task-1)",
    });
    expect(mocks.cancelTaskByIdMock).not.toHaveBeenCalled();
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        found: true,
        cancelled: true,
        canonicalTask: expect.objectContaining({ taskId: "canonical-task-1" }),
      }),
      undefined,
    );
  });

  it("does not expose hidden legacy canonical tasks through the canonical cancel path", async () => {
    const legacyTask = createCanonicalTask({
      taskId: "legacy-task-1",
      rootTaskId: "legacy-task-1",
      title: "Usa o browser",
      status: "completed",
    });
    mocks.getTaskMock.mockReturnValue(legacyTask);
    mocks.getTaskBundleMock.mockReturnValue({
      task: legacyTask,
      children: [],
      executions: [createExecution({ taskId: legacyTask.taskId, kind: "cli", status: "succeeded" })],
      assignments: [],
      approvals: [],
      events: [createEvent({ taskId: legacyTask.taskId, actor: "gateway.agent" })],
      steps: [],
      dependencies: [],
    });
    mocks.reconcileTaskLookupTokenMock.mockReturnValue(null);
    const opts = createOptions("tasks.cancel", { lookup: "legacy-task-1" });

    await tasksHandlers["tasks.cancel"](opts);

    expect(mocks.cancelTaskTreeMock).not.toHaveBeenCalled();
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "Task not found: legacy-task-1",
      }),
    );
  });

  it("updates the notify policy for the resolved task", async () => {
    const task = createTask({ taskId: "task-notify" });
    const updatedTask = createTask({
      taskId: "task-notify",
      notifyPolicy: "silent",
    });
    mocks.reconcileTaskLookupTokenMock.mockReturnValue(task);
    mocks.updateTaskNotifyPolicyByIdMock.mockReturnValue(updatedTask);
    const opts = createOptions("tasks.notify", {
      lookup: "task-notify",
      notify: "silent",
    });

    await tasksHandlers["tasks.notify"](opts);

    expect(mocks.updateTaskNotifyPolicyByIdMock).toHaveBeenCalledWith({
      taskId: "task-notify",
      notifyPolicy: "silent",
    });
    expect(opts.respond).toHaveBeenCalledWith(true, { task: updatedTask }, undefined);
  });

  it("returns an invalid request error when the lookup is missing", async () => {
    mocks.reconcileTaskLookupTokenMock.mockReturnValue(undefined);
    const opts = createOptions("tasks.cancel", { lookup: "missing-task" });

    await tasksHandlers["tasks.cancel"](opts);

    expect(mocks.cancelTaskByIdMock).not.toHaveBeenCalled();
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "Task not found: missing-task",
      }),
    );
  });

  it("upserts a task proposal and broadcasts the change", async () => {
    const proposal = createProposal();
    mocks.upsertTaskProposalMock.mockReturnValue(proposal);
    const opts = createOptions("tasks.proposal.upsert", {
      clientKey: proposal.clientKey,
      requesterSessionKey: proposal.requesterSessionKey,
      sourceMessageId: proposal.sourceMessageId,
      kind: proposal.kind,
      title: proposal.title,
      summary: proposal.summary,
      rationale: proposal.rationale,
      acceptance: proposal.acceptance,
      launchPrompt: proposal.launchPrompt,
      agentId: proposal.agentId,
      createdBy: proposal.createdBy,
    });

    await tasksHandlers["tasks.proposal.upsert"](opts);

    expect(mocks.upsertTaskProposalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientKey: proposal.clientKey,
        requesterSessionKey: proposal.requesterSessionKey,
        title: proposal.title,
      }),
    );
    expect(opts.context.broadcast).toHaveBeenCalledWith(
      "tasks.proposal.changed",
      { proposal },
      { dropIfSlow: true },
    );
    expect(opts.respond).toHaveBeenCalledWith(true, { proposal }, undefined);
  });

  it("resolves a task proposal decision and broadcasts the change", async () => {
    const proposal = createProposal({
      decision: "approved",
      resolvedAt: 2_000,
      resolvedBy: "control-ui",
    });
    mocks.resolveTaskProposalDecisionMock.mockReturnValue(proposal);
    const opts = createOptions("tasks.proposal.resolve", {
      proposalId: proposal.proposalId,
      decision: "approved",
    });

    await tasksHandlers["tasks.proposal.resolve"](opts);

    expect(mocks.resolveTaskProposalDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: proposal.proposalId,
        decision: "approved",
      }),
    );
    expect(opts.context.broadcast).toHaveBeenCalledWith(
      "tasks.proposal.changed",
      { proposal },
      { dropIfSlow: true },
    );
    expect(opts.respond).toHaveBeenCalledWith(true, { proposal }, undefined);
  });

  it("launches proposals through the task-first flow", async () => {
    const pendingProposal = createProposal({
      decision: "pending",
      summary: "Launch the canonical task flow",
      acceptance: ["Task exists first", "Execution binds to task"],
      launchPrompt: "Implement the task-first launch flow.",
    });
    const approvedProposal = createProposal({
      decision: "approved",
      resolvedAt: 1_250,
      resolvedBy: "control-ui",
      summary: pendingProposal.summary,
      acceptance: pendingProposal.acceptance,
      launchPrompt: pendingProposal.launchPrompt,
    });
    const launchedProposal = createProposal({
      decision: "approved",
      resolvedAt: 1_250,
      resolvedBy: "control-ui",
      launchedTaskId: "canonical-task-1",
      launchedRunId: "run-task-1",
      launchedSessionKey: "agent:main:task:1",
      launchedAt: 1_400,
      summary: pendingProposal.summary,
      acceptance: pendingProposal.acceptance,
      launchPrompt: pendingProposal.launchPrompt,
    });
    mocks.getTaskProposalViewByIdMock.mockReturnValue(pendingProposal);
    mocks.resolveTaskProposalDecisionMock.mockReturnValue(approvedProposal);
    mocks.createTaskMock.mockReturnValue(
      createCanonicalTask({
        taskId: "canonical-task-1",
        proposalId: pendingProposal.proposalId,
      }),
    );
    mocks.updateTaskMock.mockReturnValue(
      createCanonicalTask({
        taskId: "canonical-task-1",
        proposalId: pendingProposal.proposalId,
        ownerAgentId: "main",
        orchestratorSessionKey: "agent:main:task:1",
        status: "ready",
      }),
    );
    mocks.startTaskExecutionMock.mockReturnValue({
      task: createCanonicalTask({
        taskId: "canonical-task-1",
        status: "ready",
        activeExecutionId: "execution-1",
      }),
      execution: createExecution({
        executionId: "execution-1",
        taskId: "canonical-task-1",
        kind: "orchestrator_session",
        status: "queued",
        sessionKey: "agent:main:task:1",
      }),
    });
    mocks.attachTaskProposalLaunchMock.mockReturnValue(launchedProposal);
    mocks.getTaskMock.mockReturnValue(
      createCanonicalTask({
        taskId: "canonical-task-1",
        proposalId: pendingProposal.proposalId,
        ownerAgentId: "main",
        orchestratorSessionKey: "agent:main:task:1",
        status: "in_progress",
      }),
    );
    mocks.getTaskExecutionByRunIdMock.mockReturnValue(
      createExecution({
        executionId: "execution-1",
        taskId: "canonical-task-1",
        kind: "orchestrator_session",
        status: "running",
        runId: "run-task-1",
        sessionKey: "agent:main:task:1",
      }),
    );
    const opts = createOptions(
      "tasks.launchFromProposal",
      {
        proposalId: pendingProposal.proposalId,
        agentId: "main",
      },
      {
        client: {
          connect: {
            client: {
              id: "control-ui",
              displayName: "Control UI",
            },
          },
        } as GatewayRequestHandlerOptions["client"],
      },
    );

    await tasksHandlers["tasks.launchFromProposal"](opts);

    expect(mocks.resolveTaskProposalDecisionMock).toHaveBeenCalledWith({
      proposalId: pendingProposal.proposalId,
      decision: "approved",
      resolvedBy: "Control UI",
    });
    expect(mocks.createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: pendingProposal.title,
        proposalId: pendingProposal.proposalId,
      }),
    );
    expect(mocks.createGatewaySessionEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        label: pendingProposal.title,
        extraSystemPrompt: expect.stringContaining(
          "This session is the canonical orchestrator for an approved task launched from the Tasks UI.",
        ),
        parentSessionKey: pendingProposal.requesterSessionKey,
        conversationMode: "task",
      }),
    );
    expect(mocks.createGatewaySessionEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extraSystemPrompt: expect.stringContaining(
          "use sessions_spawn for bounded parallel subtasks",
        ),
      }),
    );
    expect(mocks.createGatewaySessionEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extraSystemPrompt: expect.stringContaining("Task exists first"),
      }),
    );
    expect(mocks.sendGatewaySessionMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:task:1",
        message: pendingProposal.launchPrompt,
      }),
    );
    expect(mocks.attachTaskProposalLaunchMock).toHaveBeenCalledWith({
      proposalId: pendingProposal.proposalId,
      taskId: "canonical-task-1",
      runId: "run-task-1",
      sessionKey: "agent:main:task:1",
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        proposal: launchedProposal,
        task: expect.objectContaining({ taskId: "canonical-task-1" }),
        execution: expect.objectContaining({ runId: "run-task-1" }),
        sessionKey: "agent:main:task:1",
        runId: "run-task-1",
      }),
      undefined,
    );
  });

  it("reuses an existing canonical task for the same proposal instead of launching a duplicate", async () => {
    const proposal = createProposal({
      decision: "approved",
      resolvedAt: 1_250,
      resolvedBy: "control-ui",
    });
    const existingTask = createCanonicalTask({
      taskId: "canonical-task-1",
      proposalId: proposal.proposalId,
      orchestratorSessionKey: "agent:main:task:1",
      latestExecutionId: "execution-1",
      status: "in_progress",
    });
    const existingExecution = createExecution({
      executionId: "execution-1",
      taskId: existingTask.taskId,
      kind: "orchestrator_session",
      status: "running",
      runId: "run-task-1",
      sessionKey: "agent:main:task:1",
    });
    const attachedProposal = createProposal({
      decision: "approved",
      resolvedAt: 1_250,
      resolvedBy: "control-ui",
      launchedTaskId: existingTask.taskId,
      launchedRunId: "run-task-1",
      launchedSessionKey: "agent:main:task:1",
      launchedAt: 1_400,
    });
    mocks.getTaskProposalViewByIdMock.mockReturnValue(proposal);
    mocks.listTasksMock.mockReturnValue([existingTask]);
    mocks.getTaskBundleMock.mockReturnValue({
      task: existingTask,
      children: [],
      executions: [existingExecution],
      assignments: [],
      approvals: [],
      events: [],
      steps: [],
      dependencies: [],
    });
    mocks.attachTaskProposalLaunchMock.mockReturnValue(attachedProposal);
    const opts = createOptions("tasks.launchFromProposal", {
      proposalId: proposal.proposalId,
      agentId: "main",
    });

    await tasksHandlers["tasks.launchFromProposal"](opts);

    expect(mocks.createTaskMock).not.toHaveBeenCalled();
    expect(mocks.createGatewaySessionEntryMock).not.toHaveBeenCalled();
    expect(mocks.sendGatewaySessionMessageMock).not.toHaveBeenCalled();
    expect(mocks.attachTaskProposalLaunchMock).toHaveBeenCalledWith({
      proposalId: proposal.proposalId,
      taskId: existingTask.taskId,
      runId: "run-task-1",
      sessionKey: "agent:main:task:1",
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        proposal: attachedProposal,
        task: existingTask,
        execution: existingExecution,
        sessionKey: "agent:main:task:1",
        runId: "run-task-1",
      }),
      undefined,
    );
  });

  it("resumes an incomplete launch on the existing canonical task without creating a duplicate", async () => {
    const proposal = createProposal({
      decision: "approved",
      resolvedAt: 1_250,
      resolvedBy: "control-ui",
    });
    const existingTask = createCanonicalTask({
      taskId: "canonical-task-1",
      proposalId: proposal.proposalId,
      ownerAgentId: "main",
      orchestratorSessionKey: "agent:main:task:1",
      activeExecutionId: "execution-1",
      latestExecutionId: "execution-1",
      status: "ready",
    });
    const queuedExecution = createExecution({
      executionId: "execution-1",
      taskId: existingTask.taskId,
      kind: "orchestrator_session",
      status: "queued",
      sessionKey: "agent:main:task:1",
    });
    const attachedProposal = createProposal({
      decision: "approved",
      resolvedAt: 1_250,
      resolvedBy: "control-ui",
      launchedTaskId: existingTask.taskId,
      launchedRunId: "run-task-1",
      launchedSessionKey: "agent:main:task:1",
      launchedAt: 1_400,
    });
    mocks.getTaskProposalViewByIdMock.mockReturnValue(proposal);
    mocks.listTasksMock.mockReturnValue([existingTask]);
    mocks.getTaskBundleMock.mockReturnValue({
      task: existingTask,
      children: [],
      executions: [queuedExecution],
      assignments: [],
      approvals: [],
      events: [],
      steps: [],
      dependencies: [],
    });
    mocks.attachTaskProposalLaunchMock.mockReturnValue(attachedProposal);
    mocks.getTaskMock.mockReturnValue(
      createCanonicalTask({
        taskId: existingTask.taskId,
        proposalId: proposal.proposalId,
        ownerAgentId: "main",
        orchestratorSessionKey: "agent:main:task:1",
        activeExecutionId: "execution-1",
        latestExecutionId: "execution-1",
        status: "in_progress",
      }),
    );
    mocks.getTaskExecutionByRunIdMock.mockImplementation((runId: string) =>
      runId === "run-task-1"
        ? createExecution({
            executionId: "execution-1",
            taskId: existingTask.taskId,
            kind: "orchestrator_session",
            status: "running",
            runId: "run-task-1",
            sessionKey: "agent:main:task:1",
          })
        : null,
    );
    const opts = createOptions("tasks.launchFromProposal", {
      proposalId: proposal.proposalId,
      agentId: "main",
    });

    await tasksHandlers["tasks.launchFromProposal"](opts);

    expect(mocks.createTaskMock).not.toHaveBeenCalled();
    expect(mocks.createGatewaySessionEntryMock).not.toHaveBeenCalled();
    expect(mocks.startTaskExecutionMock).not.toHaveBeenCalled();
    expect(mocks.sendGatewaySessionMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:task:1",
        message: proposal.launchPrompt,
        extraSystemPrompt: expect.stringContaining(
          "This session is the canonical orchestrator for an approved task launched from the Tasks UI.",
        ),
      }),
    );
    expect(mocks.bindTaskExecutionRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "execution-1",
        runId: "run-task-1",
        sessionKey: "agent:main:task:1",
        kind: "orchestrator_session",
      }),
    );
    expect(mocks.attachTaskProposalLaunchMock).toHaveBeenCalledWith({
      proposalId: proposal.proposalId,
      taskId: existingTask.taskId,
      runId: "run-task-1",
      sessionKey: "agent:main:task:1",
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        proposal: attachedProposal,
        task: expect.objectContaining({ taskId: existingTask.taskId }),
        execution: expect.objectContaining({ runId: "run-task-1" }),
        sessionKey: "agent:main:task:1",
        runId: "run-task-1",
      }),
      undefined,
    );
  });

  it("attaches a launched run to a task proposal and broadcasts the change", async () => {
    const proposal = createProposal({
      decision: "approved",
      launchedTaskId: "canonical-task-1",
      launchedRunId: "run-1",
      launchedSessionKey: "agent:main:dashboard:1",
      launchedAt: 3_000,
    });
    mocks.attachTaskProposalLaunchMock.mockReturnValue(proposal);
    const opts = createOptions("tasks.proposal.attachLaunch", {
      proposalId: proposal.proposalId,
      taskId: "canonical-task-1",
      runId: "run-1",
      sessionKey: "agent:main:dashboard:1",
    });

    await tasksHandlers["tasks.proposal.attachLaunch"](opts);

    expect(mocks.attachTaskProposalLaunchMock).toHaveBeenCalledWith({
      proposalId: proposal.proposalId,
      taskId: "canonical-task-1",
      runId: "run-1",
      sessionKey: "agent:main:dashboard:1",
    });
    expect(opts.context.broadcast).toHaveBeenCalledWith(
      "tasks.proposal.changed",
      { proposal },
      { dropIfSlow: true },
    );
    expect(opts.respond).toHaveBeenCalledWith(true, { proposal }, undefined);
  });
});
