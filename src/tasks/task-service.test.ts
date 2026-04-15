import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeTaskRegistrySqliteStore } from "./task-registry.store.sqlite.js";
import {
  bindTaskExecutionRun,
  cancelTaskTree,
  createTaskWithExecution,
  createTask,
  decideTaskApproval,
  endTaskExecution,
  endTaskExecutionByRunId,
  findTaskForSessionKey,
  getTask,
  getTaskExecutionByRunId,
  getTaskBundle,
  markTaskExecutionRunningByRunId,
  requestTaskApproval,
  spawnChildTask,
  startTaskExecution,
} from "./task-service.js";

const ORIGINAL_STATE_DIR = process.env.ALISIO_STATE_DIR;

function resetSqliteState() {
  closeTaskRegistrySqliteStore();
  if (ORIGINAL_STATE_DIR === undefined) {
    delete process.env.ALISIO_STATE_DIR;
  } else {
    process.env.ALISIO_STATE_DIR = ORIGINAL_STATE_DIR;
  }
}

describe("task-service", () => {
  afterEach(() => {
    resetSqliteState();
  });

  it("creates, approves, starts, and completes a canonical task", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "alisio-task-service-"));
    process.env.ALISIO_STATE_DIR = stateDir;

    const task = createTask({
      title: "Ship task-first model",
      requestedBy: "nuno",
    });
    const requested = requestTaskApproval({
      taskId: task.taskId,
      requestedBy: "nuno",
      note: "review architecture",
    });
    const approved = decideTaskApproval({
      approvalId: requested.approval.approvalId,
      decision: "approved",
      decidedBy: "owner",
    });
    const started = startTaskExecution({
      taskId: task.taskId,
      kind: "subagent",
      runId: "run-1",
      agentId: "main",
    });
    const completed = endTaskExecution({
      executionId: started.execution.executionId,
      status: "succeeded",
      summary: "done",
    });

    expect(task.status).toBe("draft");
    expect(requested.task.status).toBe("pending_approval");
    expect(approved.task.status).toBe("ready");
    expect(started.task.status).toBe("in_progress");
    expect(started.execution.taskId).toBe(task.taskId);
    expect(completed.task.status).toBe("completed");
    expect(completed.execution.status).toBe("succeeded");

    rmSync(stateDir, { recursive: true, force: true });
  });

  it("spawns child tasks with executions linked by taskId", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "alisio-task-service-"));
    process.env.ALISIO_STATE_DIR = stateDir;

    const root = createTask({
      title: "Root orchestration task",
      orchestratorSessionKey: "agent:main:main",
    });
    const child = spawnChildTask({
      parentTaskId: root.taskId,
      title: "Research sub-problem",
      startExecution: true,
      executionKind: "subagent",
      executionRunId: "run-child-1",
      executionAgentId: "main",
    });

    expect(child.task.parentTaskId).toBe(root.taskId);
    expect(child.task.rootTaskId).toBe(root.taskId);
    expect(child.execution?.taskId).toBe(child.task.taskId);
    expect(getTaskBundle(root.taskId)?.children).toEqual([
      expect.objectContaining({ taskId: child.task.taskId }),
    ]);

    rmSync(stateDir, { recursive: true, force: true });
  });

  it("creates retry attempts on the same task without recreating it", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "alisio-task-service-"));
    process.env.ALISIO_STATE_DIR = stateDir;

    const task = createTask({ title: "Retryable task" });
    const first = startTaskExecution({
      taskId: task.taskId,
      kind: "subagent",
      runId: "run-retry-1",
    });
    endTaskExecution({
      executionId: first.execution.executionId,
      status: "failed",
      error: "boom",
    });
    const second = startTaskExecution({
      taskId: task.taskId,
      kind: "subagent",
      runId: "run-retry-2",
    });

    expect(second.execution.attempt).toBe(2);
    expect(second.task.taskId).toBe(task.taskId);

    rmSync(stateDir, { recursive: true, force: true });
  });

  it("rebuilds canonical tasks and executions after reopening sqlite", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "alisio-task-service-"));
    process.env.ALISIO_STATE_DIR = stateDir;

    const task = createTask({ title: "Persisted task" });
    const started = startTaskExecution({
      taskId: task.taskId,
      kind: "cli",
      runId: "run-persisted",
    });

    closeTaskRegistrySqliteStore();

    const restored = getTask(task.taskId);
    const bundle = getTaskBundle(task.taskId);

    expect(restored).toMatchObject({
      taskId: task.taskId,
      activeExecutionId: started.execution.executionId,
      status: "in_progress",
    });
    expect(bundle?.executions).toEqual([
      expect.objectContaining({
        executionId: started.execution.executionId,
        taskId: task.taskId,
      }),
    ]);

    rmSync(stateDir, { recursive: true, force: true });
  });

  it("reuses and enriches an existing execution by runId", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "alisio-task-service-"));
    process.env.ALISIO_STATE_DIR = stateDir;

    const parent = createTaskWithExecution({
      title: "Parent task",
      requesterSessionKey: "agent:main:main",
      orchestratorSessionKey: "agent:main:main",
      executionKind: "orchestrator_session",
      executionRunId: "run-parent",
      executionSessionKey: "agent:main:main",
    });
    const provisional = createTaskWithExecution({
      title: "Provisional child",
      requesterSessionKey: "agent:main:subagent:child",
      orchestratorSessionKey: "agent:main:subagent:child",
      executionKind: "orchestrator_session",
      executionRunId: "run-shared",
      executionSessionKey: "agent:main:subagent:child",
    });
    const child = createTaskWithExecution({
      title: "Spawned child",
      requesterSessionKey: "agent:main:main",
      orchestratorSessionKey: "agent:main:subagent:child",
      parentSessionKey: "agent:main:main",
      ownerAgentId: "main",
      executionKind: "subagent",
      executionRunId: "run-shared",
      executionSessionKey: "agent:main:subagent:child",
      executionAgentId: "main",
    });

    expect(child.task.taskId).toBe(provisional.task.taskId);
    expect(child.task.parentTaskId).toBe(parent.task.taskId);
    expect(child.execution.kind).toBe("subagent");
    expect(child.execution.sessionKey).toBe("agent:main:subagent:child");

    rmSync(stateDir, { recursive: true, force: true });
  });

  it("resolves active parent tasks by execution session key", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "alisio-task-service-"));
    process.env.ALISIO_STATE_DIR = stateDir;

    const root = createTaskWithExecution({
      title: "Controller",
      requesterSessionKey: "agent:main:main",
      orchestratorSessionKey: "agent:main:main",
      executionKind: "orchestrator_session",
      executionRunId: "run-root",
      executionSessionKey: "agent:main:main",
    });
    const child = createTaskWithExecution({
      title: "Leaf",
      requesterSessionKey: "agent:main:main",
      parentSessionKey: "agent:main:main",
      orchestratorSessionKey: "agent:main:subagent:leaf",
      executionKind: "subagent",
      executionRunId: "run-leaf",
      executionSessionKey: "agent:main:subagent:leaf",
    });

    expect(child.task.parentTaskId).toBe(root.task.taskId);
    expect(findTaskForSessionKey("agent:main:main")?.taskId).toBe(root.task.taskId);
    expect(findTaskForSessionKey("agent:main:subagent:leaf")?.taskId).toBe(child.task.taskId);

    rmSync(stateDir, { recursive: true, force: true });
  });

  it("updates queued executions to running and completes them by runId", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "alisio-task-service-"));
    process.env.ALISIO_STATE_DIR = stateDir;

    createTaskWithExecution({
      title: "ACP child",
      requesterSessionKey: "agent:main:main",
      parentSessionKey: "agent:main:main",
      orchestratorSessionKey: "agent:main:acp:child",
      executionKind: "acp",
      executionRunId: "run-acp",
      executionSessionKey: "agent:main:acp:child",
      executionStatus: "queued",
    });

    const running = markTaskExecutionRunningByRunId({
      runId: "run-acp",
      summary: "working",
    });
    const completed = endTaskExecutionByRunId({
      runId: "run-acp",
      status: "succeeded",
      summary: "done",
    });

    expect(running.task.status).toBe("in_progress");
    expect(getTaskExecutionByRunId("run-acp")?.status).toBe("succeeded");
    expect(completed.task.status).toBe("completed");

    rmSync(stateDir, { recursive: true, force: true });
  });

  it("binds queued placeholder executions to a later run id without creating a second task", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "alisio-task-service-"));
    process.env.ALISIO_STATE_DIR = stateDir;

    const task = createTask({ title: "Proposal launch task" });
    const approval = requestTaskApproval({
      taskId: task.taskId,
      requestedBy: "nuno",
    });
    decideTaskApproval({
      approvalId: approval.approval.approvalId,
      decision: "approved",
      decidedBy: "nuno",
    });
    const queued = startTaskExecution({
      taskId: task.taskId,
      kind: "orchestrator_session",
      sessionKey: "agent:main:task:1",
      status: "queued",
    });
    bindTaskExecutionRun({
      executionId: queued.execution.executionId,
      runId: "run-launch-1",
      sessionKey: "agent:main:task:1",
      label: "Proposal launch task",
    });
    const enriched = createTaskWithExecution({
      title: "Proposal launch task",
      executionKind: "orchestrator_session",
      executionRunId: "run-launch-1",
      executionSessionKey: "agent:main:task:1",
      executionStatus: "running",
      executionLabel: "Proposal launch task",
    });

    expect(enriched.task.taskId).toBe(task.taskId);
    expect(enriched.execution.executionId).toBe(queued.execution.executionId);
    expect(enriched.execution.status).toBe("running");

    rmSync(stateDir, { recursive: true, force: true });
  });

  it("cancels root tasks recursively and cascades to child executions", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "alisio-task-service-"));
    process.env.ALISIO_STATE_DIR = stateDir;

    const root = createTask({ title: "Root task" });
    const rootApproval = requestTaskApproval({ taskId: root.taskId });
    decideTaskApproval({
      approvalId: rootApproval.approval.approvalId,
      decision: "approved",
    });
    const rootExecution = startTaskExecution({
      taskId: root.taskId,
      kind: "orchestrator_session",
      runId: "run-root-cancel",
    });
    const child = spawnChildTask({
      parentTaskId: root.taskId,
      title: "Child task",
      startExecution: true,
      executionKind: "subagent",
      executionRunId: "run-child-cancel",
      executionStatus: "running",
    });

    const cancelledRoot = cancelTaskTree({
      taskId: root.taskId,
      reason: "operator requested cancel",
    });
    const rootBundle = getTaskBundle(root.taskId);
    const childBundle = getTaskBundle(child.task.taskId);

    expect(cancelledRoot.status).toBe("cancelled");
    expect(
      rootBundle?.executions.find(
        (execution) => execution.executionId === rootExecution.execution.executionId,
      )?.status,
    ).toBe("cancelled");
    expect(childBundle?.task.status).toBe("cancelled");
    expect(childBundle?.executions[0]?.status).toBe("cancelled");

    rmSync(stateDir, { recursive: true, force: true });
  });

  it("rejects execution starts without an existing task", () => {
    const stateDir = mkdtempSync(path.join(os.tmpdir(), "alisio-task-service-"));
    process.env.ALISIO_STATE_DIR = stateDir;

    expect(() =>
      startTaskExecution({
        taskId: "missing-task",
        kind: "subagent",
      }),
    ).toThrow("Task not found: missing-task");

    rmSync(stateDir, { recursive: true, force: true });
  });
});
