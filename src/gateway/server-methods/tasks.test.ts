import { beforeEach, describe, expect, it, vi } from "vitest";
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
        runtime: "subagent",
        status: "running",
        query: "background",
        tasks: [matchingTask],
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
});
