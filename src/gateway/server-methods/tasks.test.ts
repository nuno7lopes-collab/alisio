import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskProposalView } from "../../tasks/task-proposals.types.js";
import type { TaskRecord } from "../../tasks/task-registry.types.js";
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
  resolveTaskProposalDecisionMock: vi.fn(),
  attachTaskProposalLaunchMock: vi.fn(),
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
  listTaskProposalViews: mocks.listTaskProposalViewsMock,
  summarizeTaskProposals: mocks.summarizeTaskProposalsMock,
  upsertTaskProposal: mocks.upsertTaskProposalMock,
  resolveTaskProposalDecision: mocks.resolveTaskProposalDecisionMock,
  attachTaskProposalLaunch: mocks.attachTaskProposalLaunchMock,
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

  it("attaches a launched run to a task proposal and broadcasts the change", async () => {
    const proposal = createProposal({
      decision: "approved",
      launchedRunId: "run-1",
      launchedSessionKey: "agent:main:dashboard:1",
      launchedAt: 3_000,
    });
    mocks.attachTaskProposalLaunchMock.mockReturnValue(proposal);
    const opts = createOptions("tasks.proposal.attachLaunch", {
      proposalId: proposal.proposalId,
      runId: "run-1",
      sessionKey: "agent:main:dashboard:1",
    });

    await tasksHandlers["tasks.proposal.attachLaunch"](opts);

    expect(mocks.attachTaskProposalLaunchMock).toHaveBeenCalledWith({
      proposalId: proposal.proposalId,
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
