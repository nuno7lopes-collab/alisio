import { t } from "../../i18n/index.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  CanonicalTaskSummary,
  Task,
  TaskApproval,
  TaskAssignment,
  TaskDependency,
  TaskEvent,
  TaskExecution,
  TaskExecutionStep,
  TasksDetailResult,
  TaskProposalDecision,
  TaskProposalDraft,
  TaskProposalRecord,
  TaskProposalSummary,
  TaskRuntime,
  TasksOverviewResult,
  TaskStatus,
} from "../types.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

export type TaskRuntimeFilter = "all" | TaskRuntime | "orchestrator_session";
export type TaskStatusFilter = "all" | TaskStatus;

export type TasksState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  tasksLoading: boolean;
  tasksBusy: boolean;
  tasksError: string | null;
  tasksOverview: TasksOverviewResult | null;
  tasksDetailLoading: boolean;
  tasksDetail: TasksDetailResult | null;
  tasksSelectedId: string | null;
  tasksQuery: string;
  tasksRuntimeFilter: TaskRuntimeFilter;
  tasksStatusFilter: TaskStatusFilter;
  tasksLimit: number;
  assistantAgentId?: string | null;
};

type TrackedTaskDetailRequest = {
  taskId: string;
  token: symbol;
};

const taskDetailRequests = new WeakMap<TasksState, TrackedTaskDetailRequest>();

function taskErrorMessage(
  kind: "load" | "cancel" | "save" | "approve" | "reject" | "launch",
): string {
  switch (kind) {
    case "cancel":
      return t("tasksView.errors.cancel");
    case "save":
      return t("tasksView.errors.saveProposal");
    case "approve":
      return t("tasksView.errors.approveProposal");
    case "reject":
      return t("tasksView.errors.rejectProposal");
    case "launch":
      return t("tasksView.errors.launchProposal");
    case "load":
    default:
      return t("tasksView.errors.load");
  }
}

function normalizeCanonicalTask(entry: unknown): Task | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const task = entry as Partial<Task>;
  if (
    typeof task.taskId !== "string" ||
    typeof task.rootTaskId !== "string" ||
    typeof task.title !== "string"
  ) {
    return null;
  }
  if (task.kind !== "task" && task.kind !== "project") {
    return null;
  }
  if (
    task.status !== "draft" &&
    task.status !== "pending_approval" &&
    task.status !== "ready" &&
    task.status !== "in_progress" &&
    task.status !== "blocked" &&
    task.status !== "awaiting_review" &&
    task.status !== "completed" &&
    task.status !== "cancelled" &&
    task.status !== "failed"
  ) {
    return null;
  }
  return {
    ...(task as Task),
    acceptance: Array.isArray(task.acceptance)
      ? task.acceptance.filter((value): value is string => typeof value === "string")
      : [],
  };
}

function normalizeTaskExecution(entry: unknown): TaskExecution | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const execution = entry as Partial<TaskExecution>;
  if (
    typeof execution.executionId !== "string" ||
    typeof execution.taskId !== "string" ||
    typeof execution.attempt !== "number"
  ) {
    return null;
  }
  if (
    execution.kind !== "subagent" &&
    execution.kind !== "acp" &&
    execution.kind !== "cron" &&
    execution.kind !== "cli" &&
    execution.kind !== "orchestrator_session"
  ) {
    return null;
  }
  if (
    execution.status !== "queued" &&
    execution.status !== "running" &&
    execution.status !== "succeeded" &&
    execution.status !== "failed" &&
    execution.status !== "timed_out" &&
    execution.status !== "cancelled" &&
    execution.status !== "lost"
  ) {
    return null;
  }
  return execution as TaskExecution;
}

function normalizeTaskAssignment(entry: unknown): TaskAssignment | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const assignment = entry as Partial<TaskAssignment>;
  if (
    typeof assignment.assignmentId !== "string" ||
    typeof assignment.taskId !== "string" ||
    typeof assignment.agentId !== "string"
  ) {
    return null;
  }
  if (
    assignment.status !== "active" &&
    assignment.status !== "released" &&
    assignment.status !== "expired"
  ) {
    return null;
  }
  return assignment as TaskAssignment;
}

function normalizeTaskApproval(entry: unknown): TaskApproval | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const approval = entry as Partial<TaskApproval>;
  if (typeof approval.approvalId !== "string" || typeof approval.taskId !== "string") {
    return null;
  }
  if (
    approval.status !== "pending" &&
    approval.status !== "approved" &&
    approval.status !== "rejected" &&
    approval.status !== "cancelled"
  ) {
    return null;
  }
  return approval as TaskApproval;
}

function normalizeTaskEvent(entry: unknown): TaskEvent | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const event = entry as Partial<TaskEvent>;
  if (typeof event.eventId !== "string" || typeof event.taskId !== "string") {
    return null;
  }
  return event as TaskEvent;
}

function normalizeTaskExecutionStep(entry: unknown): TaskExecutionStep | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const step = entry as Partial<TaskExecutionStep>;
  if (
    typeof step.stepId !== "string" ||
    typeof step.taskId !== "string" ||
    typeof step.createdAt !== "number"
  ) {
    return null;
  }
  return step as TaskExecutionStep;
}

function normalizeTaskDependency(entry: unknown): TaskDependency | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const dependency = entry as Partial<TaskDependency>;
  if (
    typeof dependency.dependencyId !== "string" ||
    typeof dependency.taskId !== "string" ||
    typeof dependency.dependsOnTaskId !== "string" ||
    dependency.kind !== "blocks"
  ) {
    return null;
  }
  return dependency as TaskDependency;
}

function normalizeCanonicalTaskSummary(raw: unknown): CanonicalTaskSummary {
  const summary = raw as Partial<CanonicalTaskSummary> | null | undefined;
  return {
    total: typeof summary?.total === "number" ? summary.total : 0,
    roots: typeof summary?.roots === "number" ? summary.roots : 0,
    draft: typeof summary?.draft === "number" ? summary.draft : 0,
    pendingApproval: typeof summary?.pendingApproval === "number" ? summary.pendingApproval : 0,
    ready: typeof summary?.ready === "number" ? summary.ready : 0,
    inProgress: typeof summary?.inProgress === "number" ? summary.inProgress : 0,
    blocked: typeof summary?.blocked === "number" ? summary.blocked : 0,
    awaitingReview: typeof summary?.awaitingReview === "number" ? summary.awaitingReview : 0,
    completed: typeof summary?.completed === "number" ? summary.completed : 0,
    cancelled: typeof summary?.cancelled === "number" ? summary.cancelled : 0,
    failed: typeof summary?.failed === "number" ? summary.failed : 0,
  };
}

function normalizeTasksOverviewResult(raw: unknown): TasksOverviewResult | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<TasksOverviewResult>;
  if (typeof value.total !== "number" || typeof value.limit !== "number") {
    return null;
  }
  const proposals = (Array.isArray(value.proposals) ? value.proposals : [])
    .map(normalizeTaskProposalRecord)
    .filter((entry): entry is TaskProposalRecord => Boolean(entry));
  const canonicalTasks = (Array.isArray(value.canonicalTasks) ? value.canonicalTasks : [])
    .map(normalizeCanonicalTask)
    .filter((entry): entry is Task => Boolean(entry));
  const canonicalExecutions = (
    Array.isArray(value.canonicalExecutions) ? value.canonicalExecutions : []
  )
    .map(normalizeTaskExecution)
    .filter((entry): entry is TaskExecution => Boolean(entry));
  return {
    ...(value as TasksOverviewResult),
    canonicalSummary: normalizeCanonicalTaskSummary(value.canonicalSummary),
    proposalSummary: normalizeTaskProposalSummary(value.proposalSummary),
    proposals,
    canonicalTasks,
    canonicalExecutions,
  };
}

function normalizeTaskDetailResult(raw: unknown): TasksDetailResult | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<TasksDetailResult>;
  const task = normalizeCanonicalTask(value.task);
  if (!task) {
    return null;
  }
  const proposal = value.proposal ? normalizeTaskProposalRecord(value.proposal) : null;
  const children = (Array.isArray(value.children) ? value.children : [])
    .map(normalizeCanonicalTask)
    .filter((entry): entry is Task => Boolean(entry));
  const childExecutions = (Array.isArray(value.childExecutions) ? value.childExecutions : [])
    .map(normalizeTaskExecution)
    .filter((entry): entry is TaskExecution => Boolean(entry));
  const executions = (Array.isArray(value.executions) ? value.executions : [])
    .map(normalizeTaskExecution)
    .filter((entry): entry is TaskExecution => Boolean(entry));
  const assignments = (Array.isArray(value.assignments) ? value.assignments : [])
    .map(normalizeTaskAssignment)
    .filter((entry): entry is TaskAssignment => Boolean(entry));
  const approvals = (Array.isArray(value.approvals) ? value.approvals : [])
    .map(normalizeTaskApproval)
    .filter((entry): entry is TaskApproval => Boolean(entry));
  const events = (Array.isArray(value.events) ? value.events : [])
    .map(normalizeTaskEvent)
    .filter((entry): entry is TaskEvent => Boolean(entry));
  const steps = (Array.isArray(value.steps) ? value.steps : [])
    .map(normalizeTaskExecutionStep)
    .filter((entry): entry is TaskExecutionStep => Boolean(entry));
  const dependencies = (Array.isArray(value.dependencies) ? value.dependencies : [])
    .map(normalizeTaskDependency)
    .filter((entry): entry is TaskDependency => Boolean(entry));
  return {
    task,
    ...(proposal ? { proposal } : {}),
    children,
    childExecutions,
    executions,
    assignments,
    approvals,
    events,
    steps,
    dependencies,
  };
}

function normalizeTaskProposalSummary(raw: unknown): TaskProposalSummary {
  const value = raw as Partial<TaskProposalSummary> | null | undefined;
  return {
    total: typeof value?.total === "number" ? value.total : 0,
    pending: typeof value?.pending === "number" ? value.pending : 0,
    approved: typeof value?.approved === "number" ? value.approved : 0,
    rejected: typeof value?.rejected === "number" ? value.rejected : 0,
    launched: typeof value?.launched === "number" ? value.launched : 0,
  };
}

function normalizeTaskProposalRecord(entry: unknown): TaskProposalRecord | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Partial<TaskProposalRecord>;
  if (
    typeof record.proposalId !== "string" ||
    typeof record.clientKey !== "string" ||
    typeof record.requesterSessionKey !== "string" ||
    typeof record.title !== "string"
  ) {
    return null;
  }
  if (record.kind !== "task" && record.kind !== "project") {
    return null;
  }
  if (
    record.createdBy !== "assistant" &&
    record.createdBy !== "user" &&
    record.createdBy !== undefined
  ) {
    return null;
  }
  if (
    record.decision !== "pending" &&
    record.decision !== "approved" &&
    record.decision !== "rejected"
  ) {
    return null;
  }
  return {
    ...(record as TaskProposalRecord),
    acceptance: Array.isArray(record.acceptance)
      ? record.acceptance.filter((value): value is string => typeof value === "string")
      : [],
  };
}

function syncSelectedTask(state: TasksState): boolean {
  const tasks = state.tasksOverview?.canonicalTasks ?? [];
  if (tasks.length === 0) {
    const changed = state.tasksSelectedId !== null || state.tasksDetail !== null;
    state.tasksSelectedId = null;
    state.tasksDetail = null;
    state.tasksDetailLoading = false;
    return changed;
  }
  if (state.tasksSelectedId && tasks.some((task) => task.taskId === state.tasksSelectedId)) {
    return false;
  }
  state.tasksSelectedId = tasks[0]?.taskId ?? null;
  return true;
}

function beginTaskDetailRequest(
  state: TasksState,
  taskId: string,
): TrackedTaskDetailRequest | null {
  if (!state.client || !state.connected || !taskId.trim()) {
    return null;
  }
  const request = {
    taskId,
    token: Symbol("tasks-detail-request"),
  } satisfies TrackedTaskDetailRequest;
  taskDetailRequests.set(state, request);
  return request;
}

function isTaskDetailRequestCurrent(state: TasksState, request: TrackedTaskDetailRequest): boolean {
  return taskDetailRequests.get(state)?.token === request.token;
}

function finishTaskDetailRequest(state: TasksState, request: TrackedTaskDetailRequest): void {
  if (taskDetailRequests.get(state)?.token === request.token) {
    taskDetailRequests.delete(state);
  }
}

function shouldRefreshTaskDetail(
  state: TasksState,
  task: Task,
  selectionChanged: boolean,
  opts?: { quiet?: boolean },
): boolean {
  if (!state.tasksDetail || state.tasksDetail.task.taskId !== task.taskId) {
    return true;
  }
  if (selectionChanged || !opts?.quiet) {
    return true;
  }
  if (state.tasksDetailLoading) {
    return false;
  }
  const current = state.tasksDetail.task;
  return (
    current.updatedAt !== task.updatedAt ||
    current.status !== task.status ||
    current.activeExecutionId !== task.activeExecutionId ||
    current.latestExecutionId !== task.latestExecutionId ||
    current.parentTaskId !== task.parentTaskId
  );
}

export async function loadTaskDetail(
  state: TasksState,
  taskId: string,
  opts?: { quiet?: boolean; optional?: boolean },
): Promise<void> {
  const resolvedTaskId = taskId.trim();
  if (!state.client || !state.connected || !resolvedTaskId) {
    state.tasksDetail = null;
    state.tasksDetailLoading = false;
    return;
  }
  const trackedRequest = beginTaskDetailRequest(state, resolvedTaskId);
  if (!trackedRequest) {
    state.tasksDetailLoading = false;
    return;
  }
  if (!opts?.quiet) {
    state.tasksDetailLoading = true;
  }
  try {
    const result = await state.client.request<TasksDetailResult>("tasks.detail", {
      taskId: resolvedTaskId,
    });
    const normalized = normalizeTaskDetailResult(result);
    if (!normalized || normalized.task.taskId !== resolvedTaskId) {
      throw new Error("Invalid task detail response.");
    }
    if (!isTaskDetailRequestCurrent(state, trackedRequest)) {
      return;
    }
    state.tasksDetail = normalized;
    state.tasksError = null;
  } catch (error) {
    if (!isTaskDetailRequestCurrent(state, trackedRequest)) {
      return;
    }
    state.tasksDetail = null;
    if (opts?.optional) {
      return;
    }
    if (isMissingOperatorReadScopeError(error)) {
      state.tasksOverview = null;
      state.tasksSelectedId = null;
      state.tasksError = formatMissingOperatorReadScopeMessage("background tasks");
    } else {
      state.tasksError = taskErrorMessage("load");
    }
  } finally {
    finishTaskDetailRequest(state, trackedRequest);
    if (!taskDetailRequests.has(state)) {
      state.tasksDetailLoading = false;
    }
  }
}

export async function loadTasksOverview(
  state: TasksState,
  opts?: { quiet?: boolean },
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (!opts?.quiet) {
    state.tasksLoading = true;
  }
  try {
    const result = await state.client.request<TasksOverviewResult>("tasks.overview", {
      runtime: state.tasksRuntimeFilter,
      status: state.tasksStatusFilter,
      query: state.tasksQuery.trim() || undefined,
      limit: state.tasksLimit,
      offset: 0,
    });
    const normalized = normalizeTasksOverviewResult(result);
    if (!normalized) {
      throw new Error("Invalid tasks overview response.");
    }
    state.tasksOverview = normalized;
    state.tasksError = null;
    const selectionChanged = syncSelectedTask(state);
    const selectedTask = state.tasksSelectedId
      ? (normalized.canonicalTasks.find((task) => task.taskId === state.tasksSelectedId) ?? null)
      : null;
    if (selectedTask && shouldRefreshTaskDetail(state, selectedTask, selectionChanged, opts)) {
      void loadTaskDetail(state, selectedTask.taskId, {
        quiet: opts?.quiet && !selectionChanged,
        optional: true,
      });
    }
  } catch (error) {
    if (isMissingOperatorReadScopeError(error)) {
      state.tasksOverview = null;
      state.tasksDetail = null;
      state.tasksDetailLoading = false;
      state.tasksError = formatMissingOperatorReadScopeMessage("background tasks");
      state.tasksSelectedId = null;
    } else {
      state.tasksError = taskErrorMessage("load");
    }
  } finally {
    state.tasksLoading = false;
  }
}

export async function selectTask(state: TasksState, taskId: string): Promise<void> {
  if (state.tasksSelectedId === taskId && state.tasksDetail?.task.taskId === taskId) {
    return;
  }
  state.tasksSelectedId = taskId;
  await loadTaskDetail(state, taskId, { quiet: true });
}

export async function cancelTask(state: TasksState, lookup: string): Promise<void> {
  if (!state.client || !state.connected || state.tasksBusy) {
    return;
  }
  state.tasksBusy = true;
  state.tasksError = null;
  try {
    await state.client.request("tasks.cancel", { lookup });
    await loadTasksOverview(state, { quiet: true });
  } catch {
    state.tasksError = taskErrorMessage("cancel");
  } finally {
    state.tasksBusy = false;
  }
}

async function upsertRemoteTaskProposal(
  state: TasksState,
  proposal: TaskProposalDraft,
): Promise<TaskProposalRecord> {
  if (!state.client || !state.connected) {
    throw new Error("Gateway is not connected.");
  }
  const result = await state.client.request<{ proposal: TaskProposalRecord }>(
    "tasks.proposal.upsert",
    {
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
    },
  );
  const normalized = normalizeTaskProposalRecord(result?.proposal);
  if (!normalized) {
    throw new Error("Invalid task proposal response.");
  }
  return normalized;
}

async function resolveRemoteTaskProposalDecision(
  state: TasksState,
  proposalId: string,
  decision: Exclude<TaskProposalDecision, "pending">,
): Promise<TaskProposalRecord> {
  if (!state.client || !state.connected) {
    throw new Error("Gateway is not connected.");
  }
  const result = await state.client.request<{ proposal: TaskProposalRecord }>(
    "tasks.proposal.resolve",
    {
      proposalId,
      decision,
    },
  );
  const normalized = normalizeTaskProposalRecord(result?.proposal);
  if (!normalized) {
    throw new Error("Invalid task proposal decision response.");
  }
  return normalized;
}

export function findTaskProposalByClientKey(
  state: Pick<TasksState, "tasksOverview">,
  requesterSessionKey: string,
  clientKey: string,
): TaskProposalRecord | null {
  return (
    state.tasksOverview?.proposals.find(
      (proposal) =>
        proposal.requesterSessionKey === requesterSessionKey && proposal.clientKey === clientKey,
    ) ?? null
  );
}

export async function saveTaskProposal(
  state: TasksState,
  proposal: TaskProposalDraft,
): Promise<TaskProposalRecord | null> {
  if (!state.client || !state.connected || state.tasksBusy) {
    return null;
  }
  state.tasksBusy = true;
  state.tasksError = null;
  try {
    const record = await upsertRemoteTaskProposal(state, proposal);
    await loadTasksOverview(state, { quiet: true });
    return record;
  } catch {
    state.tasksError = taskErrorMessage("save");
    return null;
  } finally {
    state.tasksBusy = false;
  }
}

export async function resolveTaskProposal(
  state: TasksState,
  proposal: TaskProposalDraft | TaskProposalRecord,
  decision: Exclude<TaskProposalDecision, "pending">,
): Promise<TaskProposalRecord | null> {
  if (!state.client || !state.connected || state.tasksBusy) {
    return null;
  }
  state.tasksBusy = true;
  state.tasksError = null;
  try {
    const existing =
      findTaskProposalByClientKey(state, proposal.requesterSessionKey, proposal.clientKey) ??
      (await upsertRemoteTaskProposal(state, proposal));
    const record = await resolveRemoteTaskProposalDecision(state, existing.proposalId, decision);
    await loadTasksOverview(state, { quiet: true });
    return record;
  } catch {
    state.tasksError = taskErrorMessage(decision === "approved" ? "approve" : "reject");
    return null;
  } finally {
    state.tasksBusy = false;
  }
}

export async function launchTaskProposal(
  state: TasksState,
  proposal: TaskProposalDraft | TaskProposalRecord,
): Promise<{ proposal: TaskProposalRecord; sessionKey: string; runId: string } | null> {
  if (!state.client || !state.connected || state.tasksBusy) {
    return null;
  }
  state.tasksBusy = true;
  state.tasksError = null;
  try {
    const existing =
      "proposalId" in proposal
        ? proposal
        : (findTaskProposalByClientKey(state, proposal.requesterSessionKey, proposal.clientKey) ??
          (await upsertRemoteTaskProposal(state, proposal)));
    if (!existing) {
      throw new Error("Task proposal could not be prepared for launch.");
    }
    const launchResult = await state.client.request<{
      proposal?: TaskProposalRecord;
      sessionKey?: string;
      runId?: string;
    }>("tasks.launchFromProposal", {
      proposalId: existing.proposalId,
      agentId: existing.agentId ?? state.assistantAgentId ?? undefined,
    });
    const sessionKey =
      typeof launchResult?.sessionKey === "string" ? launchResult.sessionKey.trim() : "";
    const runId = typeof launchResult?.runId === "string" ? launchResult.runId.trim() : "";
    if (!sessionKey || !runId) {
      throw new Error("Task proposal launch did not start an agent run.");
    }
    const attached = normalizeTaskProposalRecord(launchResult?.proposal);
    if (!attached) {
      throw new Error("Invalid task proposal launch response.");
    }
    await loadTasksOverview(state, { quiet: true });
    return { proposal: attached, sessionKey, runId };
  } catch {
    state.tasksError = taskErrorMessage("launch");
    return null;
  } finally {
    state.tasksBusy = false;
  }
}
