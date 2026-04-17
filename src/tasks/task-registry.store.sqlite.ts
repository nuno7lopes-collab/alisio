import { chmodSync, existsSync, mkdirSync } from "node:fs";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import type { DeliveryContext } from "../utils/delivery-context.js";
import type { TaskProposalRecord } from "./task-proposals.types.js";
import { resolveTaskRegistryDir, resolveTaskRegistrySqlitePath } from "./task-registry.paths.js";
import type { TaskRegistryStoreSnapshot } from "./task-registry.store.js";
import type { TaskDeliveryState, TaskRecord } from "./task-registry.types.js";
import type {
  Task,
  TaskApproval,
  TaskAssignment,
  TaskDependency,
  TaskEvent,
  TaskExecution,
  TaskExecutionStep,
} from "./task-service.types.js";

type TaskRegistryRow = {
  task_id: string;
  runtime: TaskRecord["runtime"];
  source_id: string | null;
  requester_session_key: string;
  child_session_key: string | null;
  parent_task_id: string | null;
  agent_id: string | null;
  run_id: string | null;
  label: string | null;
  task: string;
  status: TaskRecord["status"];
  delivery_status: TaskRecord["deliveryStatus"];
  notify_policy: TaskRecord["notifyPolicy"];
  created_at: number | bigint;
  started_at: number | bigint | null;
  ended_at: number | bigint | null;
  last_event_at: number | bigint | null;
  cleanup_after: number | bigint | null;
  error: string | null;
  progress_summary: string | null;
  terminal_summary: string | null;
  terminal_outcome: TaskRecord["terminalOutcome"] | null;
};

type TaskDeliveryStateRow = {
  task_id: string;
  requester_origin_json: string | null;
  last_notified_event_at: number | bigint | null;
};

type TaskProposalRow = {
  proposal_id: string;
  client_key: string;
  requester_session_key: string;
  source_message_id: string | null;
  kind: TaskProposalRecord["kind"];
  title: string;
  summary: string | null;
  rationale: string | null;
  acceptance_json: string | null;
  launch_prompt: string | null;
  agent_id: string | null;
  created_by: TaskProposalRecord["createdBy"];
  decision: TaskProposalRecord["decision"];
  created_at: number | bigint;
  updated_at: number | bigint;
  resolved_at: number | bigint | null;
  resolved_by: string | null;
  launched_task_id: string | null;
  launched_run_id: string | null;
  launched_session_key: string | null;
  launched_at: number | bigint | null;
};

type CanonicalTaskRow = {
  task_id: string;
  root_task_id: string;
  parent_task_id: string | null;
  proposal_id: string | null;
  kind: Task["kind"];
  title: string;
  summary: string | null;
  description: string | null;
  acceptance_json: string | null;
  requester_session_key: string | null;
  requested_by: string | null;
  owner_agent_id: string | null;
  orchestrator_session_key: string | null;
  status: Task["status"];
  blocked_reason: string | null;
  active_execution_id: string | null;
  latest_execution_id: string | null;
  latest_approval_id: string | null;
  created_at: number | bigint;
  updated_at: number | bigint;
  started_at: number | bigint | null;
  ended_at: number | bigint | null;
};

type TaskExecutionRow = {
  execution_id: string;
  task_id: string;
  kind: TaskExecution["kind"];
  attempt: number | bigint;
  source_id: string | null;
  run_id: string | null;
  session_key: string | null;
  agent_id: string | null;
  label: string | null;
  status: TaskExecution["status"];
  summary: string | null;
  error: string | null;
  terminal_outcome: TaskExecution["terminalOutcome"] | null;
  cancellation_reason: string | null;
  created_at: number | bigint;
  started_at: number | bigint | null;
  ended_at: number | bigint | null;
};

type TaskAssignmentRow = {
  assignment_id: string;
  task_id: string;
  agent_id: string;
  session_key: string | null;
  claimed_by: string | null;
  status: TaskAssignment["status"];
  claimed_at: number | bigint;
  lease_expires_at: number | bigint;
  released_at: number | bigint | null;
};

type TaskApprovalRow = {
  approval_id: string;
  task_id: string;
  status: TaskApproval["status"];
  requested_at: number | bigint;
  requested_by: string | null;
  decided_at: number | bigint | null;
  decided_by: string | null;
  note: string | null;
};

type TaskEventRow = {
  event_id: string;
  task_id: string;
  execution_id: string | null;
  assignment_id: string | null;
  approval_id: string | null;
  kind: TaskEvent["kind"];
  actor: string | null;
  summary: string | null;
  data_json: string | null;
  created_at: number | bigint;
};

type TaskExecutionStepRow = {
  step_id: string;
  task_id: string;
  execution_id: string | null;
  kind: TaskExecutionStep["kind"];
  status: TaskExecutionStep["status"];
  actor: string | null;
  tool: string | null;
  summary: string | null;
  data_json: string | null;
  created_at: number | bigint;
};

type TaskDependencyRow = {
  dependency_id: string;
  task_id: string;
  depends_on_task_id: string;
  kind: TaskDependency["kind"];
  created_at: number | bigint;
};

type TaskRegistryStatements = {
  selectAll: StatementSync;
  selectAllDeliveryStates: StatementSync;
  selectAllProposals: StatementSync;
  selectProposalById: StatementSync;
  selectProposalByClientKey: StatementSync;
  selectAllCanonicalTasks: StatementSync;
  selectCanonicalTaskById: StatementSync;
  selectCanonicalTasksByParentId: StatementSync;
  upsertCanonicalTask: StatementSync;
  selectExecutionById: StatementSync;
  selectExecutionByRunId: StatementSync;
  selectExecutionsByTaskId: StatementSync;
  selectExecutionsBySessionKey: StatementSync;
  upsertTaskExecution: StatementSync;
  selectAssignmentById: StatementSync;
  selectAssignmentsByTaskId: StatementSync;
  upsertTaskAssignment: StatementSync;
  selectApprovalById: StatementSync;
  selectApprovalsByTaskId: StatementSync;
  upsertTaskApproval: StatementSync;
  selectEventsByTaskId: StatementSync;
  insertTaskEvent: StatementSync;
  selectStepsByTaskId: StatementSync;
  insertTaskExecutionStep: StatementSync;
  selectDependenciesByTaskId: StatementSync;
  upsertTaskDependency: StatementSync;
  upsertRow: StatementSync;
  replaceDeliveryState: StatementSync;
  upsertProposal: StatementSync;
  deleteRow: StatementSync;
  deleteDeliveryState: StatementSync;
  clearRows: StatementSync;
  clearDeliveryStates: StatementSync;
};

type TaskRegistryDatabase = {
  db: DatabaseSync;
  path: string;
  statements: TaskRegistryStatements;
};

let cachedDatabase: TaskRegistryDatabase | null = null;
const TASK_REGISTRY_DIR_MODE = 0o700;
const TASK_REGISTRY_FILE_MODE = 0o600;
const TASK_REGISTRY_SIDEcar_SUFFIXES = ["", "-shm", "-wal"] as const;

function normalizeNumber(value: number | bigint | null): number | undefined {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return typeof value === "number" ? value : undefined;
}

function serializeJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function parseJsonValue<T>(raw: string | null): T | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function rowToTaskRecord(row: TaskRegistryRow): TaskRecord {
  const startedAt = normalizeNumber(row.started_at);
  const endedAt = normalizeNumber(row.ended_at);
  const lastEventAt = normalizeNumber(row.last_event_at);
  const cleanupAfter = normalizeNumber(row.cleanup_after);
  return {
    taskId: row.task_id,
    runtime: row.runtime,
    ...(row.source_id ? { sourceId: row.source_id } : {}),
    requesterSessionKey: row.requester_session_key,
    ...(row.child_session_key ? { childSessionKey: row.child_session_key } : {}),
    ...(row.parent_task_id ? { parentTaskId: row.parent_task_id } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.label ? { label: row.label } : {}),
    task: row.task,
    status: row.status,
    deliveryStatus: row.delivery_status,
    notifyPolicy: row.notify_policy,
    createdAt: normalizeNumber(row.created_at) ?? 0,
    ...(startedAt != null ? { startedAt } : {}),
    ...(endedAt != null ? { endedAt } : {}),
    ...(lastEventAt != null ? { lastEventAt } : {}),
    ...(cleanupAfter != null ? { cleanupAfter } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.progress_summary ? { progressSummary: row.progress_summary } : {}),
    ...(row.terminal_summary ? { terminalSummary: row.terminal_summary } : {}),
    ...(row.terminal_outcome ? { terminalOutcome: row.terminal_outcome } : {}),
  };
}

function rowToTaskDeliveryState(row: TaskDeliveryStateRow): TaskDeliveryState {
  const requesterOrigin = parseJsonValue<DeliveryContext>(row.requester_origin_json);
  const lastNotifiedEventAt = normalizeNumber(row.last_notified_event_at);
  return {
    taskId: row.task_id,
    ...(requesterOrigin ? { requesterOrigin } : {}),
    ...(lastNotifiedEventAt != null ? { lastNotifiedEventAt } : {}),
  };
}

function rowToTaskProposalRecord(row: TaskProposalRow): TaskProposalRecord {
  const resolvedAt = normalizeNumber(row.resolved_at);
  const launchedAt = normalizeNumber(row.launched_at);
  return {
    proposalId: row.proposal_id,
    clientKey: row.client_key,
    requesterSessionKey: row.requester_session_key,
    ...(row.source_message_id ? { sourceMessageId: row.source_message_id } : {}),
    kind: row.kind,
    title: row.title,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.rationale ? { rationale: row.rationale } : {}),
    acceptance: parseJsonValue<string[]>(row.acceptance_json) ?? [],
    ...(row.launch_prompt ? { launchPrompt: row.launch_prompt } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    createdBy: row.created_by,
    decision: row.decision,
    createdAt: normalizeNumber(row.created_at) ?? 0,
    updatedAt: normalizeNumber(row.updated_at) ?? 0,
    ...(resolvedAt != null ? { resolvedAt } : {}),
    ...(row.resolved_by ? { resolvedBy: row.resolved_by } : {}),
    ...(row.launched_task_id ? { launchedTaskId: row.launched_task_id } : {}),
    ...(row.launched_run_id ? { launchedRunId: row.launched_run_id } : {}),
    ...(row.launched_session_key ? { launchedSessionKey: row.launched_session_key } : {}),
    ...(launchedAt != null ? { launchedAt } : {}),
  };
}

function bindTaskRecord(record: TaskRecord) {
  return {
    task_id: record.taskId,
    runtime: record.runtime,
    source_id: record.sourceId ?? null,
    requester_session_key: record.requesterSessionKey,
    child_session_key: record.childSessionKey ?? null,
    parent_task_id: record.parentTaskId ?? null,
    agent_id: record.agentId ?? null,
    run_id: record.runId ?? null,
    label: record.label ?? null,
    task: record.task,
    status: record.status,
    delivery_status: record.deliveryStatus,
    notify_policy: record.notifyPolicy,
    created_at: record.createdAt,
    started_at: record.startedAt ?? null,
    ended_at: record.endedAt ?? null,
    last_event_at: record.lastEventAt ?? null,
    cleanup_after: record.cleanupAfter ?? null,
    error: record.error ?? null,
    progress_summary: record.progressSummary ?? null,
    terminal_summary: record.terminalSummary ?? null,
    terminal_outcome: record.terminalOutcome ?? null,
  };
}

function bindTaskDeliveryState(state: TaskDeliveryState) {
  return {
    task_id: state.taskId,
    requester_origin_json: serializeJson(state.requesterOrigin),
    last_notified_event_at: state.lastNotifiedEventAt ?? null,
  };
}

function bindTaskProposalRecord(record: TaskProposalRecord) {
  return {
    proposal_id: record.proposalId,
    client_key: record.clientKey,
    requester_session_key: record.requesterSessionKey,
    source_message_id: record.sourceMessageId ?? null,
    kind: record.kind,
    title: record.title,
    summary: record.summary ?? null,
    rationale: record.rationale ?? null,
    acceptance_json: serializeJson(record.acceptance),
    launch_prompt: record.launchPrompt ?? null,
    agent_id: record.agentId ?? null,
    created_by: record.createdBy,
    decision: record.decision,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    resolved_at: record.resolvedAt ?? null,
    resolved_by: record.resolvedBy ?? null,
    launched_task_id: record.launchedTaskId ?? null,
    launched_run_id: record.launchedRunId ?? null,
    launched_session_key: record.launchedSessionKey ?? null,
    launched_at: record.launchedAt ?? null,
  };
}

function rowToCanonicalTask(row: CanonicalTaskRow): Task {
  const startedAt = normalizeNumber(row.started_at);
  const endedAt = normalizeNumber(row.ended_at);
  return {
    taskId: row.task_id,
    rootTaskId: row.root_task_id,
    ...(row.parent_task_id ? { parentTaskId: row.parent_task_id } : {}),
    ...(row.proposal_id ? { proposalId: row.proposal_id } : {}),
    kind: row.kind,
    title: row.title,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.description ? { description: row.description } : {}),
    acceptance: parseJsonValue<string[]>(row.acceptance_json) ?? [],
    ...(row.requester_session_key ? { requesterSessionKey: row.requester_session_key } : {}),
    ...(row.requested_by ? { requestedBy: row.requested_by } : {}),
    ...(row.owner_agent_id ? { ownerAgentId: row.owner_agent_id } : {}),
    ...(row.orchestrator_session_key
      ? { orchestratorSessionKey: row.orchestrator_session_key }
      : {}),
    status: row.status,
    ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}),
    ...(row.active_execution_id ? { activeExecutionId: row.active_execution_id } : {}),
    ...(row.latest_execution_id ? { latestExecutionId: row.latest_execution_id } : {}),
    ...(row.latest_approval_id ? { latestApprovalId: row.latest_approval_id } : {}),
    createdAt: normalizeNumber(row.created_at) ?? 0,
    updatedAt: normalizeNumber(row.updated_at) ?? 0,
    ...(startedAt != null ? { startedAt } : {}),
    ...(endedAt != null ? { endedAt } : {}),
  };
}

function bindCanonicalTask(task: Task) {
  return {
    task_id: task.taskId,
    root_task_id: task.rootTaskId,
    parent_task_id: task.parentTaskId ?? null,
    proposal_id: task.proposalId ?? null,
    kind: task.kind,
    title: task.title,
    summary: task.summary ?? null,
    description: task.description ?? null,
    acceptance_json: serializeJson(task.acceptance),
    requester_session_key: task.requesterSessionKey ?? null,
    requested_by: task.requestedBy ?? null,
    owner_agent_id: task.ownerAgentId ?? null,
    orchestrator_session_key: task.orchestratorSessionKey ?? null,
    status: task.status,
    blocked_reason: task.blockedReason ?? null,
    active_execution_id: task.activeExecutionId ?? null,
    latest_execution_id: task.latestExecutionId ?? null,
    latest_approval_id: task.latestApprovalId ?? null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    started_at: task.startedAt ?? null,
    ended_at: task.endedAt ?? null,
  };
}

function rowToTaskExecution(row: TaskExecutionRow): TaskExecution {
  const startedAt = normalizeNumber(row.started_at);
  const endedAt = normalizeNumber(row.ended_at);
  return {
    executionId: row.execution_id,
    taskId: row.task_id,
    kind: row.kind,
    attempt: normalizeNumber(row.attempt) ?? 0,
    ...(row.source_id ? { sourceId: row.source_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.label ? { label: row.label } : {}),
    status: row.status,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.terminal_outcome ? { terminalOutcome: row.terminal_outcome } : {}),
    ...(row.cancellation_reason ? { cancellationReason: row.cancellation_reason } : {}),
    createdAt: normalizeNumber(row.created_at) ?? 0,
    ...(startedAt != null ? { startedAt } : {}),
    ...(endedAt != null ? { endedAt } : {}),
  };
}

function bindTaskExecution(execution: TaskExecution) {
  return {
    execution_id: execution.executionId,
    task_id: execution.taskId,
    kind: execution.kind,
    attempt: execution.attempt,
    source_id: execution.sourceId ?? null,
    run_id: execution.runId ?? null,
    session_key: execution.sessionKey ?? null,
    agent_id: execution.agentId ?? null,
    label: execution.label ?? null,
    status: execution.status,
    summary: execution.summary ?? null,
    error: execution.error ?? null,
    terminal_outcome: execution.terminalOutcome ?? null,
    cancellation_reason: execution.cancellationReason ?? null,
    created_at: execution.createdAt,
    started_at: execution.startedAt ?? null,
    ended_at: execution.endedAt ?? null,
  };
}

function rowToTaskAssignment(row: TaskAssignmentRow): TaskAssignment {
  const releasedAt = normalizeNumber(row.released_at);
  return {
    assignmentId: row.assignment_id,
    taskId: row.task_id,
    agentId: row.agent_id,
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    ...(row.claimed_by ? { claimedBy: row.claimed_by } : {}),
    status: row.status,
    claimedAt: normalizeNumber(row.claimed_at) ?? 0,
    leaseExpiresAt: normalizeNumber(row.lease_expires_at) ?? 0,
    ...(releasedAt != null ? { releasedAt } : {}),
  };
}

function bindTaskAssignment(assignment: TaskAssignment) {
  return {
    assignment_id: assignment.assignmentId,
    task_id: assignment.taskId,
    agent_id: assignment.agentId,
    session_key: assignment.sessionKey ?? null,
    claimed_by: assignment.claimedBy ?? null,
    status: assignment.status,
    claimed_at: assignment.claimedAt,
    lease_expires_at: assignment.leaseExpiresAt,
    released_at: assignment.releasedAt ?? null,
  };
}

function rowToTaskApproval(row: TaskApprovalRow): TaskApproval {
  const decidedAt = normalizeNumber(row.decided_at);
  return {
    approvalId: row.approval_id,
    taskId: row.task_id,
    status: row.status,
    requestedAt: normalizeNumber(row.requested_at) ?? 0,
    ...(row.requested_by ? { requestedBy: row.requested_by } : {}),
    ...(decidedAt != null ? { decidedAt } : {}),
    ...(row.decided_by ? { decidedBy: row.decided_by } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}

function bindTaskApproval(approval: TaskApproval) {
  return {
    approval_id: approval.approvalId,
    task_id: approval.taskId,
    status: approval.status,
    requested_at: approval.requestedAt,
    requested_by: approval.requestedBy ?? null,
    decided_at: approval.decidedAt ?? null,
    decided_by: approval.decidedBy ?? null,
    note: approval.note ?? null,
  };
}

function rowToTaskEvent(row: TaskEventRow): TaskEvent {
  return {
    eventId: row.event_id,
    taskId: row.task_id,
    ...(row.execution_id ? { executionId: row.execution_id } : {}),
    ...(row.assignment_id ? { assignmentId: row.assignment_id } : {}),
    ...(row.approval_id ? { approvalId: row.approval_id } : {}),
    kind: row.kind,
    ...(row.actor ? { actor: row.actor } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.data_json ? { dataJson: row.data_json } : {}),
    createdAt: normalizeNumber(row.created_at) ?? 0,
  };
}

function bindTaskEvent(event: TaskEvent) {
  return {
    event_id: event.eventId,
    task_id: event.taskId,
    execution_id: event.executionId ?? null,
    assignment_id: event.assignmentId ?? null,
    approval_id: event.approvalId ?? null,
    kind: event.kind,
    actor: event.actor ?? null,
    summary: event.summary ?? null,
    data_json: event.dataJson ?? null,
    created_at: event.createdAt,
  };
}

function rowToTaskExecutionStep(row: TaskExecutionStepRow): TaskExecutionStep {
  return {
    stepId: row.step_id,
    taskId: row.task_id,
    ...(row.execution_id ? { executionId: row.execution_id } : {}),
    kind: row.kind,
    status: row.status,
    ...(row.actor ? { actor: row.actor } : {}),
    ...(row.tool ? { tool: row.tool } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.data_json ? { dataJson: row.data_json } : {}),
    createdAt: normalizeNumber(row.created_at) ?? 0,
  };
}

function bindTaskExecutionStep(step: TaskExecutionStep) {
  return {
    step_id: step.stepId,
    task_id: step.taskId,
    execution_id: step.executionId ?? null,
    kind: step.kind,
    status: step.status,
    actor: step.actor ?? null,
    tool: step.tool ?? null,
    summary: step.summary ?? null,
    data_json: step.dataJson ?? null,
    created_at: step.createdAt,
  };
}

function rowToTaskDependency(row: TaskDependencyRow): TaskDependency {
  return {
    dependencyId: row.dependency_id,
    taskId: row.task_id,
    dependsOnTaskId: row.depends_on_task_id,
    kind: row.kind,
    createdAt: normalizeNumber(row.created_at) ?? 0,
  };
}

function bindTaskDependency(dependency: TaskDependency) {
  return {
    dependency_id: dependency.dependencyId,
    task_id: dependency.taskId,
    depends_on_task_id: dependency.dependsOnTaskId,
    kind: dependency.kind,
    created_at: dependency.createdAt,
  };
}

function createStatements(db: DatabaseSync): TaskRegistryStatements {
  return {
    selectAll: db.prepare(`
      SELECT
        task_id,
        runtime,
        source_id,
        requester_session_key,
        child_session_key,
        parent_task_id,
        agent_id,
        run_id,
        label,
        task,
        status,
        delivery_status,
        notify_policy,
        created_at,
        started_at,
        ended_at,
        last_event_at,
        cleanup_after,
        error,
        progress_summary,
        terminal_summary,
        terminal_outcome
      FROM task_runs
      ORDER BY created_at ASC, task_id ASC
    `),
    selectAllDeliveryStates: db.prepare(`
      SELECT
        task_id,
        requester_origin_json,
        last_notified_event_at
      FROM task_delivery_state
      ORDER BY task_id ASC
    `),
    selectAllProposals: db.prepare(`
      SELECT
        proposal_id,
        client_key,
        requester_session_key,
        source_message_id,
        kind,
        title,
        summary,
        rationale,
        acceptance_json,
        launch_prompt,
        agent_id,
        created_by,
        decision,
        created_at,
        updated_at,
        resolved_at,
        resolved_by,
        launched_task_id,
        launched_run_id,
        launched_session_key,
        launched_at
      FROM task_proposals
      ORDER BY updated_at DESC, created_at DESC, proposal_id DESC
    `),
    selectProposalById: db.prepare(`
      SELECT
        proposal_id,
        client_key,
        requester_session_key,
        source_message_id,
        kind,
        title,
        summary,
        rationale,
        acceptance_json,
        launch_prompt,
        agent_id,
        created_by,
        decision,
        created_at,
        updated_at,
        resolved_at,
        resolved_by,
        launched_task_id,
        launched_run_id,
        launched_session_key,
        launched_at
      FROM task_proposals
      WHERE proposal_id = ?
      LIMIT 1
    `),
    selectProposalByClientKey: db.prepare(`
      SELECT
        proposal_id,
        client_key,
        requester_session_key,
        source_message_id,
        kind,
        title,
        summary,
        rationale,
        acceptance_json,
        launch_prompt,
        agent_id,
        created_by,
        decision,
        created_at,
        updated_at,
        resolved_at,
        resolved_by,
        launched_task_id,
        launched_run_id,
        launched_session_key,
        launched_at
      FROM task_proposals
      WHERE requester_session_key = ? AND client_key = ?
      LIMIT 1
    `),
    selectAllCanonicalTasks: db.prepare(`
      SELECT
        task_id,
        root_task_id,
        parent_task_id,
        proposal_id,
        kind,
        title,
        summary,
        description,
        acceptance_json,
        requester_session_key,
        requested_by,
        owner_agent_id,
        orchestrator_session_key,
        status,
        blocked_reason,
        active_execution_id,
        latest_execution_id,
        latest_approval_id,
        created_at,
        updated_at,
        started_at,
        ended_at
      FROM tasks
      ORDER BY created_at ASC, task_id ASC
    `),
    selectCanonicalTaskById: db.prepare(`
      SELECT
        task_id,
        root_task_id,
        parent_task_id,
        proposal_id,
        kind,
        title,
        summary,
        description,
        acceptance_json,
        requester_session_key,
        requested_by,
        owner_agent_id,
        orchestrator_session_key,
        status,
        blocked_reason,
        active_execution_id,
        latest_execution_id,
        latest_approval_id,
        created_at,
        updated_at,
        started_at,
        ended_at
      FROM tasks
      WHERE task_id = ?
      LIMIT 1
    `),
    selectCanonicalTasksByParentId: db.prepare(`
      SELECT
        task_id,
        root_task_id,
        parent_task_id,
        proposal_id,
        kind,
        title,
        summary,
        description,
        acceptance_json,
        requester_session_key,
        requested_by,
        owner_agent_id,
        orchestrator_session_key,
        status,
        blocked_reason,
        active_execution_id,
        latest_execution_id,
        latest_approval_id,
        created_at,
        updated_at,
        started_at,
        ended_at
      FROM tasks
      WHERE parent_task_id = ?
      ORDER BY created_at ASC, task_id ASC
    `),
    upsertCanonicalTask: db.prepare(`
      INSERT INTO tasks (
        task_id,
        root_task_id,
        parent_task_id,
        proposal_id,
        kind,
        title,
        summary,
        description,
        acceptance_json,
        requester_session_key,
        requested_by,
        owner_agent_id,
        orchestrator_session_key,
        status,
        blocked_reason,
        active_execution_id,
        latest_execution_id,
        latest_approval_id,
        created_at,
        updated_at,
        started_at,
        ended_at
      ) VALUES (
        @task_id,
        @root_task_id,
        @parent_task_id,
        @proposal_id,
        @kind,
        @title,
        @summary,
        @description,
        @acceptance_json,
        @requester_session_key,
        @requested_by,
        @owner_agent_id,
        @orchestrator_session_key,
        @status,
        @blocked_reason,
        @active_execution_id,
        @latest_execution_id,
        @latest_approval_id,
        @created_at,
        @updated_at,
        @started_at,
        @ended_at
      )
      ON CONFLICT(task_id) DO UPDATE SET
        root_task_id = excluded.root_task_id,
        parent_task_id = excluded.parent_task_id,
        proposal_id = excluded.proposal_id,
        kind = excluded.kind,
        title = excluded.title,
        summary = excluded.summary,
        description = excluded.description,
        acceptance_json = excluded.acceptance_json,
        requester_session_key = excluded.requester_session_key,
        requested_by = excluded.requested_by,
        owner_agent_id = excluded.owner_agent_id,
        orchestrator_session_key = excluded.orchestrator_session_key,
        status = excluded.status,
        blocked_reason = excluded.blocked_reason,
        active_execution_id = excluded.active_execution_id,
        latest_execution_id = excluded.latest_execution_id,
        latest_approval_id = excluded.latest_approval_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at
    `),
    selectExecutionById: db.prepare(`
      SELECT
        execution_id,
        task_id,
        kind,
        attempt,
        source_id,
        run_id,
        session_key,
        agent_id,
        label,
        status,
        summary,
        error,
        terminal_outcome,
        cancellation_reason,
        created_at,
        started_at,
        ended_at
      FROM task_executions
      WHERE execution_id = ?
      LIMIT 1
    `),
    selectExecutionByRunId: db.prepare(`
      SELECT
        execution_id,
        task_id,
        kind,
        attempt,
        source_id,
        run_id,
        session_key,
        agent_id,
        label,
        status,
        summary,
        error,
        terminal_outcome,
        cancellation_reason,
        created_at,
        started_at,
        ended_at
      FROM task_executions
      WHERE run_id = ?
      ORDER BY created_at DESC, execution_id DESC
      LIMIT 1
    `),
    selectExecutionsByTaskId: db.prepare(`
      SELECT
        execution_id,
        task_id,
        kind,
        attempt,
        source_id,
        run_id,
        session_key,
        agent_id,
        label,
        status,
        summary,
        error,
        terminal_outcome,
        cancellation_reason,
        created_at,
        started_at,
        ended_at
      FROM task_executions
      WHERE task_id = ?
      ORDER BY attempt ASC, created_at ASC, execution_id ASC
    `),
    selectExecutionsBySessionKey: db.prepare(`
      SELECT
        execution_id,
        task_id,
        kind,
        attempt,
        source_id,
        run_id,
        session_key,
        agent_id,
        label,
        status,
        summary,
        error,
        terminal_outcome,
        cancellation_reason,
        created_at,
        started_at,
        ended_at
      FROM task_executions
      WHERE session_key = ?
      ORDER BY
        CASE WHEN ended_at IS NULL THEN 0 ELSE 1 END ASC,
        COALESCE(started_at, created_at) DESC,
        created_at DESC,
        execution_id DESC
    `),
    upsertTaskExecution: db.prepare(`
      INSERT INTO task_executions (
        execution_id,
        task_id,
        kind,
        attempt,
        source_id,
        run_id,
        session_key,
        agent_id,
        label,
        status,
        summary,
        error,
        terminal_outcome,
        cancellation_reason,
        created_at,
        started_at,
        ended_at
      ) VALUES (
        @execution_id,
        @task_id,
        @kind,
        @attempt,
        @source_id,
        @run_id,
        @session_key,
        @agent_id,
        @label,
        @status,
        @summary,
        @error,
        @terminal_outcome,
        @cancellation_reason,
        @created_at,
        @started_at,
        @ended_at
      )
      ON CONFLICT(execution_id) DO UPDATE SET
        task_id = excluded.task_id,
        kind = excluded.kind,
        attempt = excluded.attempt,
        source_id = excluded.source_id,
        run_id = excluded.run_id,
        session_key = excluded.session_key,
        agent_id = excluded.agent_id,
        label = excluded.label,
        status = excluded.status,
        summary = excluded.summary,
        error = excluded.error,
        terminal_outcome = excluded.terminal_outcome,
        cancellation_reason = excluded.cancellation_reason,
        created_at = excluded.created_at,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at
    `),
    selectAssignmentById: db.prepare(`
      SELECT
        assignment_id,
        task_id,
        agent_id,
        session_key,
        claimed_by,
        status,
        claimed_at,
        lease_expires_at,
        released_at
      FROM task_assignments
      WHERE assignment_id = ?
      LIMIT 1
    `),
    selectAssignmentsByTaskId: db.prepare(`
      SELECT
        assignment_id,
        task_id,
        agent_id,
        session_key,
        claimed_by,
        status,
        claimed_at,
        lease_expires_at,
        released_at
      FROM task_assignments
      WHERE task_id = ?
      ORDER BY claimed_at DESC, assignment_id DESC
    `),
    upsertTaskAssignment: db.prepare(`
      INSERT INTO task_assignments (
        assignment_id,
        task_id,
        agent_id,
        session_key,
        claimed_by,
        status,
        claimed_at,
        lease_expires_at,
        released_at
      ) VALUES (
        @assignment_id,
        @task_id,
        @agent_id,
        @session_key,
        @claimed_by,
        @status,
        @claimed_at,
        @lease_expires_at,
        @released_at
      )
      ON CONFLICT(assignment_id) DO UPDATE SET
        task_id = excluded.task_id,
        agent_id = excluded.agent_id,
        session_key = excluded.session_key,
        claimed_by = excluded.claimed_by,
        status = excluded.status,
        claimed_at = excluded.claimed_at,
        lease_expires_at = excluded.lease_expires_at,
        released_at = excluded.released_at
    `),
    selectApprovalById: db.prepare(`
      SELECT
        approval_id,
        task_id,
        status,
        requested_at,
        requested_by,
        decided_at,
        decided_by,
        note
      FROM task_approvals
      WHERE approval_id = ?
      LIMIT 1
    `),
    selectApprovalsByTaskId: db.prepare(`
      SELECT
        approval_id,
        task_id,
        status,
        requested_at,
        requested_by,
        decided_at,
        decided_by,
        note
      FROM task_approvals
      WHERE task_id = ?
      ORDER BY requested_at DESC, approval_id DESC
    `),
    upsertTaskApproval: db.prepare(`
      INSERT INTO task_approvals (
        approval_id,
        task_id,
        status,
        requested_at,
        requested_by,
        decided_at,
        decided_by,
        note
      ) VALUES (
        @approval_id,
        @task_id,
        @status,
        @requested_at,
        @requested_by,
        @decided_at,
        @decided_by,
        @note
      )
      ON CONFLICT(approval_id) DO UPDATE SET
        task_id = excluded.task_id,
        status = excluded.status,
        requested_at = excluded.requested_at,
        requested_by = excluded.requested_by,
        decided_at = excluded.decided_at,
        decided_by = excluded.decided_by,
        note = excluded.note
    `),
    selectEventsByTaskId: db.prepare(`
      SELECT
        event_id,
        task_id,
        execution_id,
        assignment_id,
        approval_id,
        kind,
        actor,
        summary,
        data_json,
        created_at
      FROM task_events
      WHERE task_id = ?
      ORDER BY created_at ASC, event_id ASC
    `),
    insertTaskEvent: db.prepare(`
      INSERT INTO task_events (
        event_id,
        task_id,
        execution_id,
        assignment_id,
        approval_id,
        kind,
        actor,
        summary,
        data_json,
        created_at
      ) VALUES (
        @event_id,
        @task_id,
        @execution_id,
        @assignment_id,
        @approval_id,
        @kind,
        @actor,
        @summary,
        @data_json,
        @created_at
      )
      ON CONFLICT(event_id) DO UPDATE SET
        task_id = excluded.task_id,
        execution_id = excluded.execution_id,
        assignment_id = excluded.assignment_id,
        approval_id = excluded.approval_id,
        kind = excluded.kind,
        actor = excluded.actor,
        summary = excluded.summary,
        data_json = excluded.data_json,
        created_at = excluded.created_at
    `),
    selectStepsByTaskId: db.prepare(`
      SELECT
        step_id,
        task_id,
        execution_id,
        kind,
        status,
        actor,
        tool,
        summary,
        data_json,
        created_at
      FROM task_execution_steps
      WHERE task_id = ?
      ORDER BY created_at ASC, step_id ASC
    `),
    insertTaskExecutionStep: db.prepare(`
      INSERT INTO task_execution_steps (
        step_id,
        task_id,
        execution_id,
        kind,
        status,
        actor,
        tool,
        summary,
        data_json,
        created_at
      ) VALUES (
        @step_id,
        @task_id,
        @execution_id,
        @kind,
        @status,
        @actor,
        @tool,
        @summary,
        @data_json,
        @created_at
      )
      ON CONFLICT(step_id) DO UPDATE SET
        task_id = excluded.task_id,
        execution_id = excluded.execution_id,
        kind = excluded.kind,
        status = excluded.status,
        actor = excluded.actor,
        tool = excluded.tool,
        summary = excluded.summary,
        data_json = excluded.data_json,
        created_at = excluded.created_at
    `),
    selectDependenciesByTaskId: db.prepare(`
      SELECT
        dependency_id,
        task_id,
        depends_on_task_id,
        kind,
        created_at
      FROM task_dependencies
      WHERE task_id = ?
      ORDER BY created_at ASC, dependency_id ASC
    `),
    upsertTaskDependency: db.prepare(`
      INSERT INTO task_dependencies (
        dependency_id,
        task_id,
        depends_on_task_id,
        kind,
        created_at
      ) VALUES (
        @dependency_id,
        @task_id,
        @depends_on_task_id,
        @kind,
        @created_at
      )
      ON CONFLICT(dependency_id) DO UPDATE SET
        task_id = excluded.task_id,
        depends_on_task_id = excluded.depends_on_task_id,
        kind = excluded.kind,
        created_at = excluded.created_at
    `),
    upsertRow: db.prepare(`
      INSERT INTO task_runs (
        task_id,
        runtime,
        source_id,
        requester_session_key,
        child_session_key,
        parent_task_id,
        agent_id,
        run_id,
        label,
        task,
        status,
        delivery_status,
        notify_policy,
        created_at,
        started_at,
        ended_at,
        last_event_at,
        cleanup_after,
        error,
        progress_summary,
        terminal_summary,
        terminal_outcome
      ) VALUES (
        @task_id,
        @runtime,
        @source_id,
        @requester_session_key,
        @child_session_key,
        @parent_task_id,
        @agent_id,
        @run_id,
        @label,
        @task,
        @status,
        @delivery_status,
        @notify_policy,
        @created_at,
        @started_at,
        @ended_at,
        @last_event_at,
        @cleanup_after,
        @error,
        @progress_summary,
        @terminal_summary,
        @terminal_outcome
      )
      ON CONFLICT(task_id) DO UPDATE SET
        runtime = excluded.runtime,
        source_id = excluded.source_id,
        requester_session_key = excluded.requester_session_key,
        child_session_key = excluded.child_session_key,
        parent_task_id = excluded.parent_task_id,
        agent_id = excluded.agent_id,
        run_id = excluded.run_id,
        label = excluded.label,
        task = excluded.task,
        status = excluded.status,
        delivery_status = excluded.delivery_status,
        notify_policy = excluded.notify_policy,
        created_at = excluded.created_at,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        last_event_at = excluded.last_event_at,
        cleanup_after = excluded.cleanup_after,
        error = excluded.error,
        progress_summary = excluded.progress_summary,
        terminal_summary = excluded.terminal_summary,
        terminal_outcome = excluded.terminal_outcome
    `),
    replaceDeliveryState: db.prepare(`
      INSERT OR REPLACE INTO task_delivery_state (
        task_id,
        requester_origin_json,
        last_notified_event_at
      ) VALUES (
        @task_id,
        @requester_origin_json,
        @last_notified_event_at
      )
    `),
    upsertProposal: db.prepare(`
      INSERT INTO task_proposals (
        proposal_id,
        client_key,
        requester_session_key,
        source_message_id,
        kind,
        title,
        summary,
        rationale,
        acceptance_json,
        launch_prompt,
        agent_id,
        created_by,
        decision,
        created_at,
        updated_at,
        resolved_at,
        resolved_by,
        launched_task_id,
        launched_run_id,
        launched_session_key,
        launched_at
      ) VALUES (
        @proposal_id,
        @client_key,
        @requester_session_key,
        @source_message_id,
        @kind,
        @title,
        @summary,
        @rationale,
        @acceptance_json,
        @launch_prompt,
        @agent_id,
        @created_by,
        @decision,
        @created_at,
        @updated_at,
        @resolved_at,
        @resolved_by,
        @launched_task_id,
        @launched_run_id,
        @launched_session_key,
        @launched_at
      )
      ON CONFLICT(proposal_id) DO UPDATE SET
        client_key = excluded.client_key,
        requester_session_key = excluded.requester_session_key,
        source_message_id = excluded.source_message_id,
        kind = excluded.kind,
        title = excluded.title,
        summary = excluded.summary,
        rationale = excluded.rationale,
        acceptance_json = excluded.acceptance_json,
        launch_prompt = excluded.launch_prompt,
        agent_id = excluded.agent_id,
        created_by = excluded.created_by,
        decision = excluded.decision,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        resolved_at = excluded.resolved_at,
        resolved_by = excluded.resolved_by,
        launched_task_id = excluded.launched_task_id,
        launched_run_id = excluded.launched_run_id,
        launched_session_key = excluded.launched_session_key,
        launched_at = excluded.launched_at
    `),
    deleteRow: db.prepare(`DELETE FROM task_runs WHERE task_id = ?`),
    deleteDeliveryState: db.prepare(`DELETE FROM task_delivery_state WHERE task_id = ?`),
    clearRows: db.prepare(`DELETE FROM task_runs`),
    clearDeliveryStates: db.prepare(`DELETE FROM task_delivery_state`),
  };
}

function ensureSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      root_task_id TEXT NOT NULL,
      parent_task_id TEXT,
      proposal_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      description TEXT,
      acceptance_json TEXT,
      requester_session_key TEXT,
      requested_by TEXT,
      owner_agent_id TEXT,
      orchestrator_session_key TEXT,
      status TEXT NOT NULL,
      blocked_reason TEXT,
      active_execution_id TEXT,
      latest_execution_id TEXT,
      latest_approval_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_executions (
      execution_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      source_id TEXT,
      run_id TEXT,
      session_key TEXT,
      agent_id TEXT,
      label TEXT,
      status TEXT NOT NULL,
      summary TEXT,
      error TEXT,
      terminal_outcome TEXT,
      cancellation_reason TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_assignments (
      assignment_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_key TEXT,
      claimed_by TEXT,
      status TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      lease_expires_at INTEGER NOT NULL,
      released_at INTEGER
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_approvals (
      approval_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_at INTEGER NOT NULL,
      requested_by TEXT,
      decided_at INTEGER,
      decided_by TEXT,
      note TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_events (
      event_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      execution_id TEXT,
      assignment_id TEXT,
      approval_id TEXT,
      kind TEXT NOT NULL,
      actor TEXT,
      summary TEXT,
      data_json TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_execution_steps (
      step_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      execution_id TEXT,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      actor TEXT,
      tool TEXT,
      summary TEXT,
      data_json TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      dependency_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_runs (
      task_id TEXT PRIMARY KEY,
      runtime TEXT NOT NULL,
      source_id TEXT,
      requester_session_key TEXT NOT NULL,
      child_session_key TEXT,
      parent_task_id TEXT,
      agent_id TEXT,
      run_id TEXT,
      label TEXT,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      delivery_status TEXT NOT NULL,
      notify_policy TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      last_event_at INTEGER,
      cleanup_after INTEGER,
      error TEXT,
      progress_summary TEXT,
      terminal_summary TEXT,
      terminal_outcome TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_delivery_state (
      task_id TEXT PRIMARY KEY,
      requester_origin_json TEXT,
      last_notified_event_at INTEGER
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_proposals (
      proposal_id TEXT PRIMARY KEY,
      client_key TEXT NOT NULL,
      requester_session_key TEXT NOT NULL,
      source_message_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      rationale TEXT,
      acceptance_json TEXT,
      launch_prompt TEXT,
      agent_id TEXT,
      created_by TEXT NOT NULL,
      decision TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resolved_at INTEGER,
      resolved_by TEXT,
      launched_task_id TEXT,
      launched_run_id TEXT,
      launched_session_key TEXT,
      launched_at INTEGER
    );
  `);
  const proposalColumns = db.prepare(`PRAGMA table_info(task_proposals)`).all() as Array<{
    name?: string | null;
  }>;
  const proposalColumnNames = new Set(
    proposalColumns
      .map((column) => (typeof column.name === "string" ? column.name : ""))
      .filter((name) => name.length > 0),
  );
  if (!proposalColumnNames.has("launched_task_id")) {
    db.exec(`ALTER TABLE task_proposals ADD COLUMN launched_task_id TEXT;`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_run_id ON task_runs(run_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_runtime_status ON task_runs(runtime, status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_cleanup_after ON task_runs(cleanup_after);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_runs_last_event_at ON task_runs(last_event_at);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_runs_child_session_key ON task_runs(child_session_key);`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_root_task_id ON tasks(root_task_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_owner_agent_id ON tasks(owner_agent_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_proposal_id ON tasks(proposal_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_executions_task_id ON task_executions(task_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_executions_run_id ON task_executions(run_id);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_executions_session_key ON task_executions(session_key);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_executions_task_attempt ON task_executions(task_id, attempt);`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_assignments_task_id ON task_assignments(task_id);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_assignments_task_status ON task_assignments(task_id, status);`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_approvals_task_id ON task_approvals(task_id);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_approvals_task_status ON task_approvals(task_id, status);`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_execution_steps_task_id ON task_execution_steps(task_id);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_execution_steps_execution_id ON task_execution_steps(execution_id);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_id ON task_dependencies(task_id);`,
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_task_proposals_session_client ON task_proposals(requester_session_key, client_key);`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_proposals_decision ON task_proposals(decision);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_proposals_updated_at ON task_proposals(updated_at DESC);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_proposals_launched_task_id ON task_proposals(launched_task_id);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_task_proposals_launched_run_id ON task_proposals(launched_run_id);`,
  );
}

function ensureTaskRegistryPermissions(pathname: string) {
  const dir = resolveTaskRegistryDir(process.env);
  mkdirSync(dir, { recursive: true, mode: TASK_REGISTRY_DIR_MODE });
  chmodSync(dir, TASK_REGISTRY_DIR_MODE);
  for (const suffix of TASK_REGISTRY_SIDEcar_SUFFIXES) {
    const candidate = `${pathname}${suffix}`;
    if (!existsSync(candidate)) {
      continue;
    }
    chmodSync(candidate, TASK_REGISTRY_FILE_MODE);
  }
}

function openTaskRegistryDatabase(): TaskRegistryDatabase {
  const pathname = resolveTaskRegistrySqlitePath(process.env);
  if (cachedDatabase && cachedDatabase.path === pathname) {
    return cachedDatabase;
  }
  if (cachedDatabase) {
    cachedDatabase.db.close();
    cachedDatabase = null;
  }
  ensureTaskRegistryPermissions(pathname);
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(pathname);
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA synchronous = NORMAL;`);
  db.exec(`PRAGMA busy_timeout = 5000;`);
  ensureSchema(db);
  ensureTaskRegistryPermissions(pathname);
  cachedDatabase = {
    db,
    path: pathname,
    statements: createStatements(db),
  };
  return cachedDatabase;
}

function withWriteTransaction(write: (statements: TaskRegistryStatements) => void) {
  const { db, path, statements } = openTaskRegistryDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    write(statements);
    db.exec("COMMIT");
    ensureTaskRegistryPermissions(path);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function withTaskRegistrySqliteWriteTransaction<T>(write: () => T): T {
  const { db, path } = openTaskRegistryDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = write();
    db.exec("COMMIT");
    ensureTaskRegistryPermissions(path);
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function loadTaskRegistryStateFromSqlite(): TaskRegistryStoreSnapshot {
  const { statements } = openTaskRegistryDatabase();
  const taskRows = statements.selectAll.all() as TaskRegistryRow[];
  const deliveryRows = statements.selectAllDeliveryStates.all() as TaskDeliveryStateRow[];
  return {
    tasks: new Map(taskRows.map((row) => [row.task_id, rowToTaskRecord(row)])),
    deliveryStates: new Map(deliveryRows.map((row) => [row.task_id, rowToTaskDeliveryState(row)])),
  };
}

export function saveTaskRegistryStateToSqlite(snapshot: TaskRegistryStoreSnapshot) {
  withWriteTransaction((statements) => {
    statements.clearDeliveryStates.run();
    statements.clearRows.run();
    for (const task of snapshot.tasks.values()) {
      statements.upsertRow.run(bindTaskRecord(task));
    }
    for (const state of snapshot.deliveryStates.values()) {
      statements.replaceDeliveryState.run(bindTaskDeliveryState(state));
    }
  });
}

export function upsertTaskRegistryRecordToSqlite(task: TaskRecord) {
  const store = openTaskRegistryDatabase();
  store.statements.upsertRow.run(bindTaskRecord(task));
  ensureTaskRegistryPermissions(store.path);
}

export function deleteTaskRegistryRecordFromSqlite(taskId: string) {
  const store = openTaskRegistryDatabase();
  store.statements.deleteRow.run(taskId);
  store.statements.deleteDeliveryState.run(taskId);
  ensureTaskRegistryPermissions(store.path);
}

export function upsertTaskDeliveryStateToSqlite(state: TaskDeliveryState) {
  const store = openTaskRegistryDatabase();
  store.statements.replaceDeliveryState.run(bindTaskDeliveryState(state));
  ensureTaskRegistryPermissions(store.path);
}

export function listTaskProposalRecordsFromSqlite(): TaskProposalRecord[] {
  const { statements } = openTaskRegistryDatabase();
  const proposalRows = statements.selectAllProposals.all() as TaskProposalRow[];
  return proposalRows.map((row) => rowToTaskProposalRecord(row));
}

export function getTaskProposalRecordByIdFromSqlite(
  taskProposalId: string,
): TaskProposalRecord | null {
  const { statements } = openTaskRegistryDatabase();
  const row = statements.selectProposalById.get(taskProposalId) as TaskProposalRow | undefined;
  return row ? rowToTaskProposalRecord(row) : null;
}

export function getTaskProposalRecordByClientKeyFromSqlite(params: {
  requesterSessionKey: string;
  clientKey: string;
}): TaskProposalRecord | null {
  const { statements } = openTaskRegistryDatabase();
  const row = statements.selectProposalByClientKey.get(
    params.requesterSessionKey,
    params.clientKey,
  ) as TaskProposalRow | undefined;
  return row ? rowToTaskProposalRecord(row) : null;
}

export function upsertTaskProposalRecordToSqlite(record: TaskProposalRecord) {
  const store = openTaskRegistryDatabase();
  store.statements.upsertProposal.run(bindTaskProposalRecord(record));
  ensureTaskRegistryPermissions(store.path);
}

export function listCanonicalTasksFromSqlite(): Task[] {
  const { statements } = openTaskRegistryDatabase();
  const rows = statements.selectAllCanonicalTasks.all() as CanonicalTaskRow[];
  return rows.map((row) => rowToCanonicalTask(row));
}

export function getCanonicalTaskByIdFromSqlite(taskId: string): Task | null {
  const { statements } = openTaskRegistryDatabase();
  const row = statements.selectCanonicalTaskById.get(taskId) as CanonicalTaskRow | undefined;
  return row ? rowToCanonicalTask(row) : null;
}

export function listChildCanonicalTasksFromSqlite(parentTaskId: string): Task[] {
  const { statements } = openTaskRegistryDatabase();
  const rows = statements.selectCanonicalTasksByParentId.all(parentTaskId) as CanonicalTaskRow[];
  return rows.map((row) => rowToCanonicalTask(row));
}

export function upsertCanonicalTaskToSqlite(task: Task) {
  const store = openTaskRegistryDatabase();
  store.statements.upsertCanonicalTask.run(bindCanonicalTask(task));
  ensureTaskRegistryPermissions(store.path);
}

export function getTaskExecutionByIdFromSqlite(executionId: string): TaskExecution | null {
  const { statements } = openTaskRegistryDatabase();
  const row = statements.selectExecutionById.get(executionId) as TaskExecutionRow | undefined;
  return row ? rowToTaskExecution(row) : null;
}

export function getTaskExecutionByRunIdFromSqlite(runId: string): TaskExecution | null {
  const { statements } = openTaskRegistryDatabase();
  const row = statements.selectExecutionByRunId.get(runId) as TaskExecutionRow | undefined;
  return row ? rowToTaskExecution(row) : null;
}

export function listTaskExecutionsFromSqlite(taskId: string): TaskExecution[] {
  const { statements } = openTaskRegistryDatabase();
  const rows = statements.selectExecutionsByTaskId.all(taskId) as TaskExecutionRow[];
  return rows.map((row) => rowToTaskExecution(row));
}

export function listTaskExecutionsBySessionKeyFromSqlite(sessionKey: string): TaskExecution[] {
  const { statements } = openTaskRegistryDatabase();
  const rows = statements.selectExecutionsBySessionKey.all(sessionKey) as TaskExecutionRow[];
  return rows.map((row) => rowToTaskExecution(row));
}

export function upsertTaskExecutionToSqlite(execution: TaskExecution) {
  const store = openTaskRegistryDatabase();
  store.statements.upsertTaskExecution.run(bindTaskExecution(execution));
  ensureTaskRegistryPermissions(store.path);
}

export function getTaskAssignmentByIdFromSqlite(assignmentId: string): TaskAssignment | null {
  const { statements } = openTaskRegistryDatabase();
  const row = statements.selectAssignmentById.get(assignmentId) as TaskAssignmentRow | undefined;
  return row ? rowToTaskAssignment(row) : null;
}

export function listTaskAssignmentsFromSqlite(taskId: string): TaskAssignment[] {
  const { statements } = openTaskRegistryDatabase();
  const rows = statements.selectAssignmentsByTaskId.all(taskId) as TaskAssignmentRow[];
  return rows.map((row) => rowToTaskAssignment(row));
}

export function upsertTaskAssignmentToSqlite(assignment: TaskAssignment) {
  const store = openTaskRegistryDatabase();
  store.statements.upsertTaskAssignment.run(bindTaskAssignment(assignment));
  ensureTaskRegistryPermissions(store.path);
}

export function getTaskApprovalByIdFromSqlite(approvalId: string): TaskApproval | null {
  const { statements } = openTaskRegistryDatabase();
  const row = statements.selectApprovalById.get(approvalId) as TaskApprovalRow | undefined;
  return row ? rowToTaskApproval(row) : null;
}

export function listTaskApprovalsFromSqlite(taskId: string): TaskApproval[] {
  const { statements } = openTaskRegistryDatabase();
  const rows = statements.selectApprovalsByTaskId.all(taskId) as TaskApprovalRow[];
  return rows.map((row) => rowToTaskApproval(row));
}

export function upsertTaskApprovalToSqlite(approval: TaskApproval) {
  const store = openTaskRegistryDatabase();
  store.statements.upsertTaskApproval.run(bindTaskApproval(approval));
  ensureTaskRegistryPermissions(store.path);
}

export function listTaskEventsFromSqlite(taskId: string): TaskEvent[] {
  const { statements } = openTaskRegistryDatabase();
  const rows = statements.selectEventsByTaskId.all(taskId) as TaskEventRow[];
  return rows.map((row) => rowToTaskEvent(row));
}

export function insertTaskEventToSqlite(event: TaskEvent) {
  const store = openTaskRegistryDatabase();
  store.statements.insertTaskEvent.run(bindTaskEvent(event));
  ensureTaskRegistryPermissions(store.path);
}

export function listTaskExecutionStepsFromSqlite(taskId: string): TaskExecutionStep[] {
  const { statements } = openTaskRegistryDatabase();
  const rows = statements.selectStepsByTaskId.all(taskId) as TaskExecutionStepRow[];
  return rows.map((row) => rowToTaskExecutionStep(row));
}

export function insertTaskExecutionStepToSqlite(step: TaskExecutionStep) {
  const store = openTaskRegistryDatabase();
  store.statements.insertTaskExecutionStep.run(bindTaskExecutionStep(step));
  ensureTaskRegistryPermissions(store.path);
}

export function listTaskDependenciesFromSqlite(taskId: string): TaskDependency[] {
  const { statements } = openTaskRegistryDatabase();
  const rows = statements.selectDependenciesByTaskId.all(taskId) as TaskDependencyRow[];
  return rows.map((row) => rowToTaskDependency(row));
}

export function upsertTaskDependencyToSqlite(dependency: TaskDependency) {
  const store = openTaskRegistryDatabase();
  store.statements.upsertTaskDependency.run(bindTaskDependency(dependency));
  ensureTaskRegistryPermissions(store.path);
}

export function deleteTaskDeliveryStateFromSqlite(taskId: string) {
  const store = openTaskRegistryDatabase();
  store.statements.deleteDeliveryState.run(taskId);
  ensureTaskRegistryPermissions(store.path);
}

export function closeTaskRegistrySqliteStore() {
  if (!cachedDatabase) {
    return;
  }
  cachedDatabase.db.close();
  cachedDatabase = null;
}
