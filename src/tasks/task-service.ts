import { randomUUID } from "node:crypto";
import {
  getCanonicalTaskByIdFromSqlite,
  getTaskApprovalByIdFromSqlite,
  getTaskAssignmentByIdFromSqlite,
  getTaskExecutionByIdFromSqlite,
  getTaskExecutionByRunIdFromSqlite,
  insertTaskEventToSqlite,
  listChildCanonicalTasksFromSqlite,
  listCanonicalTasksFromSqlite,
  listTaskApprovalsFromSqlite,
  listTaskAssignmentsFromSqlite,
  listTaskDependenciesFromSqlite,
  listTaskExecutionsBySessionKeyFromSqlite,
  listTaskEventsFromSqlite,
  listTaskExecutionsFromSqlite,
  upsertCanonicalTaskToSqlite,
  upsertTaskApprovalToSqlite,
  upsertTaskAssignmentToSqlite,
  upsertTaskExecutionToSqlite,
  withTaskRegistrySqliteWriteTransaction,
} from "./task-registry.store.sqlite.js";
import type {
  Task,
  TaskApproval,
  TaskAssignment,
  TaskEvent,
  TaskExecution,
} from "./task-service.types.js";

const DEFAULT_LEASE_MS = 5 * 60_000;
const MAX_TITLE_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 800;
const MAX_DESCRIPTION_LENGTH = 8_000;
const MAX_ACCEPTANCE_ITEMS = 12;
const MAX_ACCEPTANCE_ITEM_LENGTH = 240;

function trimToUndefined(value: string | null | undefined, maxLength?: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }
  if (typeof maxLength === "number" && maxLength > 0) {
    return normalized.slice(0, maxLength);
  }
  return normalized;
}

function normalizeAcceptance(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => trimToUndefined(value, MAX_ACCEPTANCE_ITEM_LENGTH))
    .filter((value): value is string => Boolean(value))
    .slice(0, MAX_ACCEPTANCE_ITEMS);
}

function isTaskTerminalStatus(status: Task["status"]) {
  return status === "completed" || status === "cancelled" || status === "failed";
}

function isExecutionTerminalStatus(status: TaskExecution["status"]) {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "cancelled" ||
    status === "lost"
  );
}

function loadTaskOrThrow(taskId: string): Task {
  const task = getCanonicalTaskByIdFromSqlite(taskId.trim());
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task;
}

function loadExecutionOrThrow(executionId: string): TaskExecution {
  const execution = getTaskExecutionByIdFromSqlite(executionId.trim());
  if (!execution) {
    throw new Error(`Task execution not found: ${executionId}`);
  }
  return execution;
}

function loadExecutionByRunIdOrThrow(runId: string): TaskExecution {
  const execution = getTaskExecutionByRunIdFromSqlite(runId.trim());
  if (!execution) {
    throw new Error(`Task execution not found for runId: ${runId}`);
  }
  return execution;
}

function loadApprovalOrThrow(approvalId: string): TaskApproval {
  const approval = getTaskApprovalByIdFromSqlite(approvalId.trim());
  if (!approval) {
    throw new Error(`Task approval not found: ${approvalId}`);
  }
  return approval;
}

function pickBetterExecutionKind(
  current: TaskExecution["kind"],
  next: TaskExecution["kind"],
): TaskExecution["kind"] {
  if (current === next) {
    return current;
  }
  if (current === "orchestrator_session" || current === "cli") {
    return next;
  }
  return current;
}

function pickSessionTask(task: Task | null, execution: TaskExecution) {
  if (!task) {
    return null;
  }
  if (task.activeExecutionId === execution.executionId) {
    return { task, priority: 0 };
  }
  if (task.latestExecutionId === execution.executionId && !isTaskTerminalStatus(task.status)) {
    return { task, priority: 1 };
  }
  if (!isTaskTerminalStatus(task.status)) {
    return { task, priority: 2 };
  }
  return { task, priority: 3 };
}

function findTaskForSessionKeyInternal(sessionKey: string): Task | null {
  const normalizedSessionKey = trimToUndefined(sessionKey, 240);
  if (!normalizedSessionKey) {
    return null;
  }
  const executions = listTaskExecutionsBySessionKeyFromSqlite(normalizedSessionKey);
  let best: {
    task: Task;
    priority: number;
  } | null = null;
  for (const execution of executions) {
    const candidate = pickSessionTask(getCanonicalTaskByIdFromSqlite(execution.taskId), execution);
    if (!candidate) {
      continue;
    }
    if (
      !best ||
      candidate.priority < best.priority ||
      (candidate.priority === best.priority && candidate.task.updatedAt > best.task.updatedAt)
    ) {
      best = candidate;
      if (best.priority === 0) {
        break;
      }
    }
  }
  return best?.task ?? null;
}

function recordTaskEvent(
  params: Omit<TaskEvent, "eventId" | "createdAt"> & { createdAt?: number },
) {
  const event: TaskEvent = {
    eventId: randomUUID(),
    taskId: params.taskId,
    ...(params.executionId ? { executionId: params.executionId } : {}),
    ...(params.assignmentId ? { assignmentId: params.assignmentId } : {}),
    ...(params.approvalId ? { approvalId: params.approvalId } : {}),
    kind: params.kind,
    ...(params.actor ? { actor: params.actor } : {}),
    ...(params.summary ? { summary: params.summary } : {}),
    ...(params.dataJson ? { dataJson: params.dataJson } : {}),
    createdAt: params.createdAt ?? Date.now(),
  };
  insertTaskEventToSqlite(event);
  return event;
}

function cancelPendingApprovalsForTask(params: {
  taskId: string;
  actor?: string;
  note?: string;
  cancelledAt: number;
}) {
  for (const approval of listTaskApprovalsFromSqlite(params.taskId)) {
    if (approval.status !== "pending") {
      continue;
    }
    const nextApproval: TaskApproval = {
      ...approval,
      status: "cancelled",
      decidedAt: params.cancelledAt,
      ...(params.actor ? { decidedBy: params.actor } : {}),
      ...(params.note ? { note: params.note } : approval.note ? { note: approval.note } : {}),
    };
    upsertTaskApprovalToSqlite(nextApproval);
    recordTaskEvent({
      taskId: params.taskId,
      approvalId: approval.approvalId,
      kind: "approval_decided",
      actor: params.actor,
      summary: nextApproval.note ?? "Approval cancelled",
      createdAt: params.cancelledAt,
    });
  }
}

function releaseAssignmentsForTask(params: { taskId: string; actor?: string; releasedAt: number }) {
  for (const assignment of listTaskAssignmentsFromSqlite(params.taskId)) {
    if (assignment.status !== "active" || assignment.releasedAt != null) {
      continue;
    }
    const nextAssignment: TaskAssignment = {
      ...assignment,
      status: "released",
      releasedAt: params.releasedAt,
    };
    upsertTaskAssignmentToSqlite(nextAssignment);
    recordTaskEvent({
      taskId: params.taskId,
      assignmentId: assignment.assignmentId,
      kind: "released",
      actor: params.actor,
      summary: "Assignment released",
      createdAt: params.releasedAt,
    });
  }
}

function expireStaleAssignments(taskId: string, now: number): TaskAssignment[] {
  const assignments = listTaskAssignmentsFromSqlite(taskId);
  const next = assignments.map((assignment) => {
    if (
      assignment.status === "active" &&
      assignment.releasedAt == null &&
      assignment.leaseExpiresAt <= now
    ) {
      const expired: TaskAssignment = {
        ...assignment,
        status: "expired",
        releasedAt: now,
      };
      upsertTaskAssignmentToSqlite(expired);
      return expired;
    }
    return assignment;
  });
  return next;
}

function listActiveAssignments(taskId: string, now: number): TaskAssignment[] {
  return expireStaleAssignments(taskId, now).filter(
    (assignment) =>
      assignment.status === "active" &&
      assignment.releasedAt == null &&
      assignment.leaseExpiresAt > now,
  );
}

function normalizeTaskForStatus(task: Task, status: Task["status"], now: number): Task {
  const next: Task = {
    ...task,
    status,
    updatedAt: now,
  };
  if (status === "in_progress" && typeof next.startedAt !== "number") {
    next.startedAt = now;
  }
  if (isTaskTerminalStatus(status)) {
    next.endedAt = now;
  } else {
    next.endedAt = undefined;
  }
  return next;
}

function buildTaskPatch(
  task: Task,
  params: {
    title?: string;
    summary?: string | null;
    description?: string | null;
    acceptance?: string[] | null;
    ownerAgentId?: string | null;
    orchestratorSessionKey?: string | null;
    status?: Task["status"];
    blockedReason?: string | null;
  },
) {
  const now = Date.now();
  const next: Task = {
    ...task,
    ...(params.title !== undefined
      ? { title: trimToUndefined(params.title, MAX_TITLE_LENGTH) ?? task.title }
      : {}),
    ...(params.summary !== undefined
      ? { summary: trimToUndefined(params.summary, MAX_SUMMARY_LENGTH) }
      : {}),
    ...(params.description !== undefined
      ? { description: trimToUndefined(params.description, MAX_DESCRIPTION_LENGTH) }
      : {}),
    ...(params.acceptance !== undefined
      ? { acceptance: normalizeAcceptance(params.acceptance) }
      : {}),
    ...(params.ownerAgentId !== undefined
      ? { ownerAgentId: trimToUndefined(params.ownerAgentId, 120) }
      : {}),
    ...(params.orchestratorSessionKey !== undefined
      ? { orchestratorSessionKey: trimToUndefined(params.orchestratorSessionKey, 240) }
      : {}),
    ...(params.blockedReason !== undefined
      ? { blockedReason: trimToUndefined(params.blockedReason, MAX_SUMMARY_LENGTH) }
      : {}),
    updatedAt: now,
  };
  return params.status ? normalizeTaskForStatus(next, params.status, now) : next;
}

function createTaskInternal(params: {
  kind?: Task["kind"];
  title: string;
  summary?: string | null;
  description?: string | null;
  acceptance?: string[] | null;
  requesterSessionKey?: string | null;
  requestedBy?: string | null;
  ownerAgentId?: string | null;
  orchestratorSessionKey?: string | null;
  parentTaskId?: string | null;
  proposalId?: string | null;
  status?: Task["status"];
}) {
  const now = Date.now();
  const parentTaskId = trimToUndefined(params.parentTaskId);
  const parent = parentTaskId ? loadTaskOrThrow(parentTaskId) : null;
  const taskId = randomUUID();
  const status = params.status ?? "draft";
  const task: Task = {
    taskId,
    rootTaskId: parent?.rootTaskId ?? taskId,
    ...(parentTaskId ? { parentTaskId } : {}),
    ...(trimToUndefined(params.proposalId, 160)
      ? { proposalId: trimToUndefined(params.proposalId, 160) }
      : {}),
    kind: params.kind === "project" ? "project" : "task",
    title: trimToUndefined(params.title, MAX_TITLE_LENGTH) ?? "Untitled task",
    ...(trimToUndefined(params.summary, MAX_SUMMARY_LENGTH)
      ? { summary: trimToUndefined(params.summary, MAX_SUMMARY_LENGTH) }
      : {}),
    ...(trimToUndefined(params.description, MAX_DESCRIPTION_LENGTH)
      ? { description: trimToUndefined(params.description, MAX_DESCRIPTION_LENGTH) }
      : {}),
    acceptance: normalizeAcceptance(params.acceptance),
    ...(trimToUndefined(params.requesterSessionKey, 240)
      ? { requesterSessionKey: trimToUndefined(params.requesterSessionKey, 240) }
      : {}),
    ...(trimToUndefined(params.requestedBy, 160)
      ? { requestedBy: trimToUndefined(params.requestedBy, 160) }
      : {}),
    ...(trimToUndefined(params.ownerAgentId, 120)
      ? { ownerAgentId: trimToUndefined(params.ownerAgentId, 120) }
      : {}),
    ...(trimToUndefined(params.orchestratorSessionKey, 240)
      ? { orchestratorSessionKey: trimToUndefined(params.orchestratorSessionKey, 240) }
      : {}),
    status,
    createdAt: now,
    updatedAt: now,
  };
  upsertCanonicalTaskToSqlite(normalizeTaskForStatus(task, status, now));
  recordTaskEvent({
    taskId,
    kind: "created",
    actor: task.requestedBy,
    summary: task.title,
    createdAt: now,
  });
  return loadTaskOrThrow(taskId);
}

function reparentTask(task: Task, parentTaskId: string, now: number): Task {
  if (task.taskId === parentTaskId) {
    return task;
  }
  const parent = loadTaskOrThrow(parentTaskId);
  if (task.parentTaskId === parent.taskId && task.rootTaskId === parent.rootTaskId) {
    return task;
  }
  return {
    ...task,
    parentTaskId: parent.taskId,
    rootTaskId: parent.rootTaskId,
    updatedAt: now,
  };
}

function startTaskExecutionInternal(params: {
  taskId: string;
  kind: TaskExecution["kind"];
  sourceId?: string | null;
  runId?: string | null;
  sessionKey?: string | null;
  agentId?: string | null;
  label?: string | null;
  summary?: string | null;
  status?: Extract<TaskExecution["status"], "queued" | "running">;
}) {
  const now = Date.now();
  const task = loadTaskOrThrow(params.taskId);
  if (task.status === "pending_approval") {
    throw new Error("Task is waiting for approval.");
  }
  const executions = listTaskExecutionsFromSqlite(task.taskId);
  const attempt = executions.reduce((max, execution) => Math.max(max, execution.attempt), 0) + 1;
  const executionId = randomUUID();
  const status = params.status ?? "running";
  const execution: TaskExecution = {
    executionId,
    taskId: task.taskId,
    kind: params.kind,
    attempt,
    ...(trimToUndefined(params.sourceId, 240)
      ? { sourceId: trimToUndefined(params.sourceId, 240) }
      : {}),
    ...(trimToUndefined(params.runId, 240) ? { runId: trimToUndefined(params.runId, 240) } : {}),
    ...(trimToUndefined(params.sessionKey, 240)
      ? { sessionKey: trimToUndefined(params.sessionKey, 240) }
      : {}),
    ...(trimToUndefined(params.agentId, 120)
      ? { agentId: trimToUndefined(params.agentId, 120) }
      : {}),
    ...(trimToUndefined(params.label, MAX_TITLE_LENGTH)
      ? { label: trimToUndefined(params.label, MAX_TITLE_LENGTH) }
      : {}),
    status,
    ...(trimToUndefined(params.summary, MAX_SUMMARY_LENGTH)
      ? { summary: trimToUndefined(params.summary, MAX_SUMMARY_LENGTH) }
      : {}),
    createdAt: now,
    ...(status === "running" ? { startedAt: now } : {}),
  };
  upsertTaskExecutionToSqlite(execution);
  const nextTask = normalizeTaskForStatus(
    {
      ...task,
      activeExecutionId: executionId,
      latestExecutionId: executionId,
    },
    status === "queued" ? "ready" : "in_progress",
    now,
  );
  upsertCanonicalTaskToSqlite(nextTask);
  recordTaskEvent({
    taskId: task.taskId,
    executionId,
    kind: "execution_started",
    actor: execution.agentId,
    summary: execution.label ?? execution.kind,
    createdAt: now,
  });
  return {
    task: loadTaskOrThrow(task.taskId),
    execution: loadExecutionOrThrow(executionId),
  };
}

function markTaskExecutionRunningInternal(params: {
  executionId: string;
  summary?: string | null;
  startedAt?: number;
}) {
  const startedAt = typeof params.startedAt === "number" ? params.startedAt : Date.now();
  const execution = loadExecutionOrThrow(params.executionId);
  const task = loadTaskOrThrow(execution.taskId);
  if (isExecutionTerminalStatus(execution.status)) {
    return {
      task,
      execution,
    };
  }
  const nextExecution: TaskExecution = {
    ...execution,
    status: "running",
    ...(trimToUndefined(params.summary, MAX_SUMMARY_LENGTH)
      ? { summary: trimToUndefined(params.summary, MAX_SUMMARY_LENGTH) }
      : execution.summary
        ? { summary: execution.summary }
        : {}),
    startedAt: execution.startedAt ?? startedAt,
  };
  upsertTaskExecutionToSqlite(nextExecution);
  const nextTask = normalizeTaskForStatus(
    {
      ...task,
      activeExecutionId: execution.executionId,
      latestExecutionId: execution.executionId,
    },
    "in_progress",
    startedAt,
  );
  upsertCanonicalTaskToSqlite(nextTask);
  return {
    task: loadTaskOrThrow(task.taskId),
    execution: loadExecutionOrThrow(execution.executionId),
  };
}

function endTaskExecutionInternal(params: {
  executionId: string;
  status: Extract<TaskExecution["status"], "succeeded" | "failed" | "timed_out" | "lost">;
  summary?: string | null;
  error?: string | null;
  terminalOutcome?: TaskExecution["terminalOutcome"] | null;
  endedAt?: number;
}) {
  const endedAt = typeof params.endedAt === "number" ? params.endedAt : Date.now();
  const execution = loadExecutionOrThrow(params.executionId);
  const task = loadTaskOrThrow(execution.taskId);
  const nextExecution: TaskExecution = {
    ...execution,
    status: params.status,
    ...(trimToUndefined(params.summary, MAX_SUMMARY_LENGTH)
      ? { summary: trimToUndefined(params.summary, MAX_SUMMARY_LENGTH) }
      : execution.summary
        ? { summary: execution.summary }
        : {}),
    ...(trimToUndefined(params.error, MAX_SUMMARY_LENGTH)
      ? { error: trimToUndefined(params.error, MAX_SUMMARY_LENGTH) }
      : execution.error
        ? { error: execution.error }
        : {}),
    ...(params.terminalOutcome ? { terminalOutcome: params.terminalOutcome } : {}),
    endedAt,
  };
  upsertTaskExecutionToSqlite(nextExecution);
  let nextTask: Task = {
    ...task,
    activeExecutionId:
      task.activeExecutionId === execution.executionId ? undefined : task.activeExecutionId,
    latestExecutionId: execution.executionId,
    updatedAt: endedAt,
  };
  if (params.status === "succeeded") {
    nextTask = normalizeTaskForStatus(
      {
        ...nextTask,
        ...(params.terminalOutcome === "blocked"
          ? {
              blockedReason:
                trimToUndefined(params.summary, MAX_SUMMARY_LENGTH) ??
                trimToUndefined(params.error, MAX_SUMMARY_LENGTH),
            }
          : {}),
      },
      params.terminalOutcome === "blocked" ? "blocked" : "completed",
      endedAt,
    );
  } else {
    nextTask = normalizeTaskForStatus(
      {
        ...nextTask,
        blockedReason:
          params.status === "failed"
            ? undefined
            : (trimToUndefined(params.error, MAX_SUMMARY_LENGTH) ??
              trimToUndefined(params.summary, MAX_SUMMARY_LENGTH) ??
              `Execution ${params.status}`),
      },
      params.status === "failed" ? "failed" : "blocked",
      endedAt,
    );
  }
  upsertCanonicalTaskToSqlite(nextTask);
  recordTaskEvent({
    taskId: task.taskId,
    executionId: execution.executionId,
    kind: "execution_ended",
    actor: execution.agentId,
    summary: nextExecution.summary ?? nextExecution.error ?? nextExecution.status,
    createdAt: endedAt,
  });
  return {
    task: loadTaskOrThrow(task.taskId),
    execution: loadExecutionOrThrow(execution.executionId),
  };
}

function cancelTaskExecutionInternal(params: {
  executionId: string;
  reason?: string | null;
  endedAt?: number;
}) {
  const endedAt = typeof params.endedAt === "number" ? params.endedAt : Date.now();
  const execution = loadExecutionOrThrow(params.executionId);
  const task = loadTaskOrThrow(execution.taskId);
  const nextExecution: TaskExecution = {
    ...execution,
    status: "cancelled",
    ...(trimToUndefined(params.reason, MAX_SUMMARY_LENGTH)
      ? { cancellationReason: trimToUndefined(params.reason, MAX_SUMMARY_LENGTH) }
      : {}),
    endedAt,
  };
  upsertTaskExecutionToSqlite(nextExecution);
  const nextTask = normalizeTaskForStatus(
    {
      ...task,
      activeExecutionId:
        task.activeExecutionId === execution.executionId ? undefined : task.activeExecutionId,
      latestExecutionId: execution.executionId,
    },
    "cancelled",
    endedAt,
  );
  upsertCanonicalTaskToSqlite(nextTask);
  recordTaskEvent({
    taskId: task.taskId,
    executionId: execution.executionId,
    kind: "execution_cancelled",
    actor: execution.agentId,
    summary: nextExecution.cancellationReason ?? "Execution cancelled",
    createdAt: endedAt,
  });
  return {
    task: loadTaskOrThrow(task.taskId),
    execution: loadExecutionOrThrow(execution.executionId),
  };
}

function requestTaskApprovalInternal(params: {
  taskId: string;
  requestedBy?: string | null;
  note?: string | null;
}) {
  const now = Date.now();
  const task = loadTaskOrThrow(params.taskId);
  const approvalId = randomUUID();
  const approval: TaskApproval = {
    approvalId,
    taskId: task.taskId,
    status: "pending",
    requestedAt: now,
    ...(trimToUndefined(params.requestedBy, 160)
      ? { requestedBy: trimToUndefined(params.requestedBy, 160) }
      : {}),
    ...(trimToUndefined(params.note, MAX_SUMMARY_LENGTH)
      ? { note: trimToUndefined(params.note, MAX_SUMMARY_LENGTH) }
      : {}),
  };
  upsertTaskApprovalToSqlite(approval);
  const nextTask = normalizeTaskForStatus(
    {
      ...task,
      latestApprovalId: approvalId,
    },
    "pending_approval",
    now,
  );
  upsertCanonicalTaskToSqlite(nextTask);
  recordTaskEvent({
    taskId: task.taskId,
    approvalId,
    kind: "approval_requested",
    actor: approval.requestedBy,
    summary: approval.note ?? task.title,
    createdAt: now,
  });
  return {
    task: loadTaskOrThrow(task.taskId),
    approval: loadApprovalOrThrow(approvalId),
  };
}

function decideTaskApprovalInternal(params: {
  approvalId: string;
  decision: Extract<TaskApproval["status"], "approved" | "rejected" | "cancelled">;
  decidedBy?: string | null;
  note?: string | null;
}) {
  const now = Date.now();
  const approval = loadApprovalOrThrow(params.approvalId);
  const task = loadTaskOrThrow(approval.taskId);
  if (approval.status !== "pending") {
    throw new Error(`Approval is already ${approval.status}.`);
  }
  const nextApproval: TaskApproval = {
    ...approval,
    status: params.decision,
    decidedAt: now,
    ...(trimToUndefined(params.decidedBy, 160)
      ? { decidedBy: trimToUndefined(params.decidedBy, 160) }
      : {}),
    ...(trimToUndefined(params.note, MAX_SUMMARY_LENGTH)
      ? { note: trimToUndefined(params.note, MAX_SUMMARY_LENGTH) }
      : approval.note
        ? { note: approval.note }
        : {}),
  };
  upsertTaskApprovalToSqlite(nextApproval);
  const status: Task["status"] =
    params.decision === "approved"
      ? task.activeExecutionId
        ? "in_progress"
        : "ready"
      : params.decision === "cancelled"
        ? "draft"
        : "blocked";
  const nextTask = normalizeTaskForStatus(
    {
      ...task,
      latestApprovalId: approval.approvalId,
      blockedReason:
        params.decision === "rejected"
          ? (trimToUndefined(params.note, MAX_SUMMARY_LENGTH) ??
            trimToUndefined(approval.note, MAX_SUMMARY_LENGTH) ??
            "Approval rejected")
          : undefined,
    },
    status,
    now,
  );
  upsertCanonicalTaskToSqlite(nextTask);
  recordTaskEvent({
    taskId: task.taskId,
    approvalId: approval.approvalId,
    kind: "approval_decided",
    actor: nextApproval.decidedBy,
    summary: nextApproval.note ?? nextApproval.status,
    createdAt: now,
  });
  return {
    task: loadTaskOrThrow(task.taskId),
    approval: loadApprovalOrThrow(approval.approvalId),
  };
}

export function createTask(params: Parameters<typeof createTaskInternal>[0]) {
  return withTaskRegistrySqliteWriteTransaction(() => createTaskInternal(params));
}

export function createTaskWithExecution(params: {
  kind?: Task["kind"];
  title: string;
  summary?: string | null;
  description?: string | null;
  acceptance?: string[] | null;
  requesterSessionKey?: string | null;
  requestedBy?: string | null;
  ownerAgentId?: string | null;
  orchestratorSessionKey?: string | null;
  parentTaskId?: string | null;
  parentSessionKey?: string | null;
  proposalId?: string | null;
  status?: Task["status"];
  executionKind: TaskExecution["kind"];
  executionSourceId?: string | null;
  executionRunId?: string | null;
  executionSessionKey?: string | null;
  executionAgentId?: string | null;
  executionLabel?: string | null;
  executionSummary?: string | null;
  executionStatus?: Extract<TaskExecution["status"], "queued" | "running">;
}) {
  return withTaskRegistrySqliteWriteTransaction(() => {
    const runId = trimToUndefined(params.executionRunId, 240);
    const now = Date.now();
    const resolvedParentTaskId =
      trimToUndefined(params.parentTaskId, 160) ??
      (trimToUndefined(params.parentSessionKey, 240)
        ? findTaskForSessionKeyInternal(trimToUndefined(params.parentSessionKey, 240) as string)
            ?.taskId
        : undefined);
    const existingExecution = runId ? getTaskExecutionByRunIdFromSqlite(runId) : null;
    if (existingExecution) {
      const existingTask = loadTaskOrThrow(existingExecution.taskId);
      const nextTaskBase =
        resolvedParentTaskId && !existingTask.parentTaskId
          ? reparentTask(existingTask, resolvedParentTaskId, now)
          : {
              ...existingTask,
              updatedAt: now,
            };
      const nextTask: Task = {
        ...nextTaskBase,
        ...(nextTaskBase.proposalId
          ? {}
          : trimToUndefined(params.proposalId, 160)
            ? { proposalId: trimToUndefined(params.proposalId, 160) }
            : {}),
        ...(nextTaskBase.requesterSessionKey
          ? {}
          : trimToUndefined(params.requesterSessionKey, 240)
            ? { requesterSessionKey: trimToUndefined(params.requesterSessionKey, 240) }
            : {}),
        ...(nextTaskBase.requestedBy
          ? {}
          : trimToUndefined(params.requestedBy, 160)
            ? { requestedBy: trimToUndefined(params.requestedBy, 160) }
            : {}),
        ...(trimToUndefined(params.ownerAgentId, 120)
          ? { ownerAgentId: trimToUndefined(params.ownerAgentId, 120) }
          : {}),
        ...(nextTaskBase.orchestratorSessionKey
          ? {}
          : trimToUndefined(params.orchestratorSessionKey, 240)
            ? { orchestratorSessionKey: trimToUndefined(params.orchestratorSessionKey, 240) }
            : {}),
        ...(nextTaskBase.summary
          ? {}
          : trimToUndefined(params.summary, MAX_SUMMARY_LENGTH)
            ? { summary: trimToUndefined(params.summary, MAX_SUMMARY_LENGTH) }
            : {}),
        ...(nextTaskBase.description
          ? {}
          : trimToUndefined(params.description, MAX_DESCRIPTION_LENGTH)
            ? { description: trimToUndefined(params.description, MAX_DESCRIPTION_LENGTH) }
            : {}),
      };
      let nextExecution: TaskExecution = {
        ...existingExecution,
        kind: pickBetterExecutionKind(existingExecution.kind, params.executionKind),
        ...(existingExecution.sourceId
          ? {}
          : trimToUndefined(params.executionSourceId, 240)
            ? { sourceId: trimToUndefined(params.executionSourceId, 240) }
            : {}),
        ...(existingExecution.sessionKey
          ? {}
          : trimToUndefined(params.executionSessionKey, 240)
            ? { sessionKey: trimToUndefined(params.executionSessionKey, 240) }
            : {}),
        ...(trimToUndefined(params.executionAgentId, 120)
          ? { agentId: trimToUndefined(params.executionAgentId, 120) }
          : existingExecution.agentId
            ? { agentId: existingExecution.agentId }
            : {}),
        ...(trimToUndefined(params.executionLabel, MAX_TITLE_LENGTH)
          ? { label: trimToUndefined(params.executionLabel, MAX_TITLE_LENGTH) }
          : existingExecution.label
            ? { label: existingExecution.label }
            : {}),
        ...(trimToUndefined(params.executionSummary, MAX_SUMMARY_LENGTH)
          ? { summary: trimToUndefined(params.executionSummary, MAX_SUMMARY_LENGTH) }
          : existingExecution.summary
            ? { summary: existingExecution.summary }
            : {}),
      };
      let persistedTask = nextTask;
      if (
        !isExecutionTerminalStatus(existingExecution.status) &&
        params.executionStatus === "running" &&
        existingExecution.status !== "running"
      ) {
        nextExecution = {
          ...nextExecution,
          status: "running",
          startedAt: existingExecution.startedAt ?? now,
        };
        persistedTask = normalizeTaskForStatus(
          {
            ...nextTask,
            activeExecutionId: existingExecution.executionId,
            latestExecutionId: existingExecution.executionId,
          },
          "in_progress",
          now,
        );
        recordTaskEvent({
          taskId: existingTask.taskId,
          executionId: existingExecution.executionId,
          kind: "execution_started",
          actor: nextExecution.agentId,
          summary: nextExecution.label ?? nextExecution.kind,
          createdAt: now,
        });
      }
      upsertCanonicalTaskToSqlite(persistedTask);
      upsertTaskExecutionToSqlite(nextExecution);
      return {
        task: loadTaskOrThrow(existingTask.taskId),
        execution: loadExecutionOrThrow(existingExecution.executionId),
      };
    }
    const task = createTaskInternal({
      kind: params.kind,
      title: params.title,
      summary: params.summary,
      description: params.description,
      acceptance: params.acceptance,
      requesterSessionKey: params.requesterSessionKey,
      requestedBy: params.requestedBy,
      ownerAgentId: params.ownerAgentId,
      orchestratorSessionKey: params.orchestratorSessionKey,
      parentTaskId: resolvedParentTaskId,
      proposalId: params.proposalId,
      status: params.status,
    });
    const started = startTaskExecutionInternal({
      taskId: task.taskId,
      kind: params.executionKind,
      sourceId: params.executionSourceId,
      runId,
      sessionKey: params.executionSessionKey,
      agentId: params.executionAgentId,
      label: params.executionLabel,
      summary: params.executionSummary,
      status: params.executionStatus,
    });
    return {
      task: started.task,
      execution: started.execution,
    };
  });
}

export function updateTask(params: {
  taskId: string;
  title?: string;
  summary?: string | null;
  description?: string | null;
  acceptance?: string[] | null;
  ownerAgentId?: string | null;
  orchestratorSessionKey?: string | null;
  status?: Task["status"];
  blockedReason?: string | null;
}) {
  return withTaskRegistrySqliteWriteTransaction(() => {
    const task = loadTaskOrThrow(params.taskId);
    const nextTask = buildTaskPatch(task, params);
    upsertCanonicalTaskToSqlite(nextTask);
    recordTaskEvent({
      taskId: task.taskId,
      kind: "updated",
      summary: nextTask.title,
      createdAt: nextTask.updatedAt,
    });
    return loadTaskOrThrow(task.taskId);
  });
}

export function claimTask(params: {
  taskId: string;
  agentId: string;
  sessionKey?: string | null;
  claimedBy?: string | null;
  leaseMs?: number;
}) {
  return withTaskRegistrySqliteWriteTransaction(() => {
    const now = Date.now();
    const task = loadTaskOrThrow(params.taskId);
    const agentId = trimToUndefined(params.agentId, 120);
    if (!agentId) {
      throw new Error("Task claim requires agentId.");
    }
    const leaseMs =
      typeof params.leaseMs === "number" && Number.isFinite(params.leaseMs) && params.leaseMs > 0
        ? Math.floor(params.leaseMs)
        : DEFAULT_LEASE_MS;
    const activeAssignments = listActiveAssignments(task.taskId, now);
    const foreignAssignment = activeAssignments.find(
      (assignment) => assignment.agentId !== agentId,
    );
    if (foreignAssignment) {
      throw new Error(`Task already claimed by ${foreignAssignment.agentId}.`);
    }
    const sessionKey = trimToUndefined(params.sessionKey, 240);
    const existing =
      activeAssignments.find(
        (assignment) => assignment.agentId === agentId && assignment.sessionKey === sessionKey,
      ) ?? activeAssignments.find((assignment) => assignment.agentId === agentId);
    const assignment: TaskAssignment = existing
      ? {
          ...existing,
          leaseExpiresAt: now + leaseMs,
          ...(trimToUndefined(params.claimedBy, 160)
            ? { claimedBy: trimToUndefined(params.claimedBy, 160) }
            : {}),
        }
      : {
          assignmentId: randomUUID(),
          taskId: task.taskId,
          agentId,
          ...(sessionKey ? { sessionKey } : {}),
          ...(trimToUndefined(params.claimedBy, 160)
            ? { claimedBy: trimToUndefined(params.claimedBy, 160) }
            : {}),
          status: "active",
          claimedAt: now,
          leaseExpiresAt: now + leaseMs,
        };
    upsertTaskAssignmentToSqlite(assignment);
    const nextTask: Task = {
      ...task,
      ownerAgentId: agentId,
      updatedAt: now,
    };
    upsertCanonicalTaskToSqlite(nextTask);
    recordTaskEvent({
      taskId: task.taskId,
      assignmentId: assignment.assignmentId,
      kind: "claimed",
      actor: assignment.claimedBy ?? assignment.agentId,
      summary: assignment.agentId,
      createdAt: now,
    });
    return {
      task: loadTaskOrThrow(task.taskId),
      assignment: getTaskAssignmentByIdFromSqlite(assignment.assignmentId) as TaskAssignment,
    };
  });
}

export function releaseTask(params: {
  taskId: string;
  assignmentId?: string | null;
  agentId?: string | null;
  releasedBy?: string | null;
}) {
  return withTaskRegistrySqliteWriteTransaction(() => {
    const now = Date.now();
    const task = loadTaskOrThrow(params.taskId);
    const activeAssignments = listActiveAssignments(task.taskId, now);
    const assignmentId = trimToUndefined(params.assignmentId, 160);
    const agentId = trimToUndefined(params.agentId, 120);
    if (!assignmentId && !agentId) {
      throw new Error("Task release requires assignmentId or agentId.");
    }
    const current =
      (assignmentId
        ? activeAssignments.find((assignment) => assignment.assignmentId === assignmentId)
        : undefined) ??
      (agentId
        ? activeAssignments.find((assignment) => assignment.agentId === agentId)
        : undefined);
    if (!current) {
      throw new Error("Active task assignment not found.");
    }
    const released: TaskAssignment = {
      ...current,
      status: "released",
      releasedAt: now,
    };
    upsertTaskAssignmentToSqlite(released);
    const remaining = listActiveAssignments(task.taskId, now).filter(
      (assignment) => assignment.assignmentId !== released.assignmentId,
    );
    const nextTask: Task = {
      ...task,
      ownerAgentId: remaining[0]?.agentId,
      updatedAt: now,
    };
    upsertCanonicalTaskToSqlite(nextTask);
    recordTaskEvent({
      taskId: task.taskId,
      assignmentId: released.assignmentId,
      kind: "released",
      actor: trimToUndefined(params.releasedBy, 160) ?? released.agentId,
      summary: released.agentId,
      createdAt: now,
    });
    return {
      task: loadTaskOrThrow(task.taskId),
      assignment: getTaskAssignmentByIdFromSqlite(released.assignmentId) as TaskAssignment,
    };
  });
}

export function spawnChildTask(params: {
  parentTaskId: string;
  kind?: Task["kind"];
  title: string;
  summary?: string | null;
  description?: string | null;
  acceptance?: string[] | null;
  requesterSessionKey?: string | null;
  requestedBy?: string | null;
  ownerAgentId?: string | null;
  orchestratorSessionKey?: string | null;
  status?: Task["status"];
  startExecution?: boolean;
  executionKind?: TaskExecution["kind"];
  executionSourceId?: string | null;
  executionRunId?: string | null;
  executionSessionKey?: string | null;
  executionAgentId?: string | null;
  executionLabel?: string | null;
  executionSummary?: string | null;
  executionStatus?: Extract<TaskExecution["status"], "queued" | "running">;
}) {
  return withTaskRegistrySqliteWriteTransaction(() => {
    const parent = loadTaskOrThrow(params.parentTaskId);
    const child = createTaskInternal({
      kind: params.kind,
      title: params.title,
      summary: params.summary,
      description: params.description,
      acceptance: params.acceptance,
      requesterSessionKey: params.requesterSessionKey ?? parent.requesterSessionKey,
      requestedBy: params.requestedBy,
      ownerAgentId: params.ownerAgentId,
      orchestratorSessionKey: params.orchestratorSessionKey ?? parent.orchestratorSessionKey,
      parentTaskId: parent.taskId,
      status: params.status,
    });
    recordTaskEvent({
      taskId: parent.taskId,
      kind: "child_spawned",
      summary: child.title,
      dataJson: JSON.stringify({ childTaskId: child.taskId }),
    });
    if (params.startExecution) {
      const started = startTaskExecutionInternal({
        taskId: child.taskId,
        kind: params.executionKind ?? "subagent",
        sourceId: params.executionSourceId,
        runId: params.executionRunId,
        sessionKey: params.executionSessionKey,
        agentId: params.executionAgentId,
        label: params.executionLabel,
        summary: params.executionSummary,
        status: params.executionStatus,
      });
      return {
        task: child,
        execution: started.execution,
      };
    }
    return {
      task: child,
      execution: undefined,
    };
  });
}

export function startTaskExecution(params: Parameters<typeof startTaskExecutionInternal>[0]) {
  return withTaskRegistrySqliteWriteTransaction(() => startTaskExecutionInternal(params));
}

export function markTaskExecutionRunning(
  params: Parameters<typeof markTaskExecutionRunningInternal>[0],
) {
  return withTaskRegistrySqliteWriteTransaction(() => markTaskExecutionRunningInternal(params));
}

export function markTaskExecutionRunningByRunId(params: {
  runId: string;
  summary?: string | null;
  startedAt?: number;
}) {
  return withTaskRegistrySqliteWriteTransaction(() =>
    markTaskExecutionRunningInternal({
      executionId: loadExecutionByRunIdOrThrow(params.runId).executionId,
      summary: params.summary,
      startedAt: params.startedAt,
    }),
  );
}

export function endTaskExecution(params: Parameters<typeof endTaskExecutionInternal>[0]) {
  return withTaskRegistrySqliteWriteTransaction(() => endTaskExecutionInternal(params));
}

export function endTaskExecutionByRunId(params: {
  runId: string;
  status: Extract<TaskExecution["status"], "succeeded" | "failed" | "timed_out" | "lost">;
  summary?: string | null;
  error?: string | null;
  terminalOutcome?: TaskExecution["terminalOutcome"] | null;
  endedAt?: number;
}) {
  return withTaskRegistrySqliteWriteTransaction(() => {
    const execution = loadExecutionByRunIdOrThrow(params.runId);
    if (isExecutionTerminalStatus(execution.status)) {
      return {
        task: loadTaskOrThrow(execution.taskId),
        execution,
      };
    }
    return endTaskExecutionInternal({
      executionId: execution.executionId,
      status: params.status,
      summary: params.summary,
      error: params.error,
      terminalOutcome: params.terminalOutcome,
      endedAt: params.endedAt,
    });
  });
}

export function cancelTaskExecution(params: Parameters<typeof cancelTaskExecutionInternal>[0]) {
  return withTaskRegistrySqliteWriteTransaction(() => cancelTaskExecutionInternal(params));
}

function cancelTaskTreeInternal(params: {
  taskId: string;
  reason?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: number;
}) {
  const cancelledAt = typeof params.cancelledAt === "number" ? params.cancelledAt : Date.now();
  const reason = trimToUndefined(params.reason, MAX_SUMMARY_LENGTH);
  const cancelledBy = trimToUndefined(params.cancelledBy, 160);
  const visited = new Set<string>();

  const cancelTaskRecursively = (taskId: string) => {
    if (visited.has(taskId)) {
      return;
    }
    visited.add(taskId);
    for (const child of listChildCanonicalTasksFromSqlite(taskId)) {
      cancelTaskRecursively(child.taskId);
    }
    const task = loadTaskOrThrow(taskId);
    releaseAssignmentsForTask({
      taskId,
      actor: cancelledBy,
      releasedAt: cancelledAt,
    });
    cancelPendingApprovalsForTask({
      taskId,
      actor: cancelledBy,
      note: reason,
      cancelledAt,
    });
    if (task.activeExecutionId) {
      const activeExecution = loadExecutionOrThrow(task.activeExecutionId);
      if (!isExecutionTerminalStatus(activeExecution.status)) {
        cancelTaskExecutionInternal({
          executionId: activeExecution.executionId,
          reason,
          endedAt: cancelledAt,
        });
        return;
      }
    }
    if (isTaskTerminalStatus(task.status)) {
      return;
    }
    const nextTask = normalizeTaskForStatus(
      {
        ...task,
        activeExecutionId: undefined,
      },
      "cancelled",
      cancelledAt,
    );
    upsertCanonicalTaskToSqlite(nextTask);
    recordTaskEvent({
      taskId,
      kind: "updated",
      actor: cancelledBy,
      summary: reason ?? "Task cancelled",
      createdAt: cancelledAt,
    });
  };

  cancelTaskRecursively(params.taskId);
  return loadTaskOrThrow(params.taskId);
}

export function cancelTaskTree(params: {
  taskId: string;
  reason?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: number;
}) {
  return withTaskRegistrySqliteWriteTransaction(() => cancelTaskTreeInternal(params));
}

export function bindTaskExecutionRun(params: {
  executionId: string;
  runId: string;
  sourceId?: string | null;
  sessionKey?: string | null;
  agentId?: string | null;
  label?: string | null;
  summary?: string | null;
  kind?: TaskExecution["kind"];
}) {
  return withTaskRegistrySqliteWriteTransaction(() => {
    const execution = loadExecutionOrThrow(params.executionId);
    const runId = trimToUndefined(params.runId, 240);
    if (!runId) {
      throw new Error("Task execution run binding requires runId.");
    }
    const conflictingExecution = getTaskExecutionByRunIdFromSqlite(runId);
    if (conflictingExecution && conflictingExecution.executionId !== execution.executionId) {
      throw new Error(`Task execution runId is already linked: ${runId}`);
    }
    if (execution.runId === runId) {
      return {
        task: loadTaskOrThrow(execution.taskId),
        execution,
      };
    }
    const nextExecution: TaskExecution = {
      ...execution,
      ...(params.kind ? { kind: pickBetterExecutionKind(execution.kind, params.kind) } : {}),
      runId,
      ...(trimToUndefined(params.sourceId, 240)
        ? { sourceId: trimToUndefined(params.sourceId, 240) }
        : execution.sourceId
          ? { sourceId: execution.sourceId }
          : {}),
      ...(trimToUndefined(params.sessionKey, 240)
        ? { sessionKey: trimToUndefined(params.sessionKey, 240) }
        : execution.sessionKey
          ? { sessionKey: execution.sessionKey }
          : {}),
      ...(trimToUndefined(params.agentId, 120)
        ? { agentId: trimToUndefined(params.agentId, 120) }
        : execution.agentId
          ? { agentId: execution.agentId }
          : {}),
      ...(trimToUndefined(params.label, MAX_TITLE_LENGTH)
        ? { label: trimToUndefined(params.label, MAX_TITLE_LENGTH) }
        : execution.label
          ? { label: execution.label }
          : {}),
      ...(trimToUndefined(params.summary, MAX_SUMMARY_LENGTH)
        ? { summary: trimToUndefined(params.summary, MAX_SUMMARY_LENGTH) }
        : execution.summary
          ? { summary: execution.summary }
          : {}),
    };
    upsertTaskExecutionToSqlite(nextExecution);
    const task = loadTaskOrThrow(execution.taskId);
    upsertCanonicalTaskToSqlite({
      ...task,
      updatedAt: Date.now(),
      latestExecutionId: execution.executionId,
      activeExecutionId:
        isExecutionTerminalStatus(nextExecution.status) || task.activeExecutionId
          ? task.activeExecutionId
          : execution.executionId,
    });
    return {
      task: loadTaskOrThrow(execution.taskId),
      execution: loadExecutionOrThrow(execution.executionId),
    };
  });
}

export function cancelTaskExecutionByRunId(params: {
  runId: string;
  reason?: string | null;
  endedAt?: number;
}) {
  return withTaskRegistrySqliteWriteTransaction(() => {
    const execution = loadExecutionByRunIdOrThrow(params.runId);
    if (isExecutionTerminalStatus(execution.status)) {
      return {
        task: loadTaskOrThrow(execution.taskId),
        execution,
      };
    }
    return cancelTaskExecutionInternal({
      executionId: execution.executionId,
      reason: params.reason,
      endedAt: params.endedAt,
    });
  });
}

export function requestTaskApproval(params: Parameters<typeof requestTaskApprovalInternal>[0]) {
  return withTaskRegistrySqliteWriteTransaction(() => requestTaskApprovalInternal(params));
}

export function decideTaskApproval(params: Parameters<typeof decideTaskApprovalInternal>[0]) {
  return withTaskRegistrySqliteWriteTransaction(() => decideTaskApprovalInternal(params));
}

export function getTask(taskId: string) {
  return getCanonicalTaskByIdFromSqlite(taskId);
}

export function getTaskExecutionByRunId(runId: string) {
  return getTaskExecutionByRunIdFromSqlite(runId);
}

export function findTaskForSessionKey(sessionKey: string) {
  return findTaskForSessionKeyInternal(sessionKey);
}

export function listTasks() {
  return listCanonicalTasksFromSqlite();
}

export function getTaskBundle(taskId: string) {
  const task = getCanonicalTaskByIdFromSqlite(taskId);
  if (!task) {
    return null;
  }
  return {
    task,
    children: listChildCanonicalTasksFromSqlite(taskId),
    executions: listTaskExecutionsFromSqlite(taskId),
    assignments: listTaskAssignmentsFromSqlite(taskId),
    approvals: listTaskApprovalsFromSqlite(taskId),
    events: listTaskEventsFromSqlite(taskId),
    dependencies: listTaskDependenciesFromSqlite(taskId),
  };
}
