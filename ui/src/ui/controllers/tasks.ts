import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  TaskNotifyPolicy,
  TaskProposalDecision,
  TaskProposalDraft,
  TaskProposalRecord,
  TaskProposalSummary,
  TaskRecord,
  TaskRuntime,
  TasksOverviewResult,
  TaskStatus,
} from "../types.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

export type TaskRuntimeFilter = "all" | TaskRuntime;
export type TaskStatusFilter = "all" | TaskStatus;

export type TasksState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  tasksLoading: boolean;
  tasksBusy: boolean;
  tasksError: string | null;
  tasksOverview: TasksOverviewResult | null;
  tasksSelectedId: string | null;
  tasksQuery: string;
  tasksRuntimeFilter: TaskRuntimeFilter;
  tasksStatusFilter: TaskStatusFilter;
  tasksLimit: number;
  assistantAgentId?: string | null;
};

function normalizeTaskRecord(entry: unknown): TaskRecord | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const record = entry as Partial<TaskRecord>;
  if (typeof record.taskId !== "string" || typeof record.task !== "string") {
    return null;
  }
  if (
    record.runtime !== "subagent" &&
    record.runtime !== "acp" &&
    record.runtime !== "cli" &&
    record.runtime !== "cron"
  ) {
    return null;
  }
  if (
    record.status !== "queued" &&
    record.status !== "running" &&
    record.status !== "succeeded" &&
    record.status !== "failed" &&
    record.status !== "timed_out" &&
    record.status !== "cancelled" &&
    record.status !== "lost"
  ) {
    return null;
  }
  if (
    record.deliveryStatus !== "pending" &&
    record.deliveryStatus !== "delivered" &&
    record.deliveryStatus !== "session_queued" &&
    record.deliveryStatus !== "failed" &&
    record.deliveryStatus !== "parent_missing" &&
    record.deliveryStatus !== "not_applicable"
  ) {
    return null;
  }
  if (
    record.notifyPolicy !== "done_only" &&
    record.notifyPolicy !== "state_changes" &&
    record.notifyPolicy !== "silent"
  ) {
    return null;
  }
  return record as TaskRecord;
}

function normalizeTasksOverviewResult(raw: unknown): TasksOverviewResult | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Partial<TasksOverviewResult>;
  if (!Array.isArray(value.tasks) || !value.summary || !value.filteredSummary || !value.audit) {
    return null;
  }
  const tasks = value.tasks
    .map(normalizeTaskRecord)
    .filter((entry): entry is TaskRecord => Boolean(entry));
  const proposals = (Array.isArray(value.proposals) ? value.proposals : [])
    .map(normalizeTaskProposalRecord)
    .filter((entry): entry is TaskProposalRecord => Boolean(entry));
  return {
    ...(value as TasksOverviewResult),
    proposalSummary: normalizeTaskProposalSummary(value.proposalSummary),
    proposals,
    tasks,
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
  const linkedTask = normalizeTaskRecord(record.linkedTask);
  return {
    ...(record as TaskProposalRecord),
    acceptance: Array.isArray(record.acceptance)
      ? record.acceptance.filter((value): value is string => typeof value === "string")
      : [],
    ...(linkedTask ? { linkedTask } : {}),
  };
}

function syncSelectedTask(state: TasksState) {
  const tasks = state.tasksOverview?.tasks ?? [];
  if (tasks.length === 0) {
    state.tasksSelectedId = null;
    return;
  }
  if (state.tasksSelectedId && tasks.some((task) => task.taskId === state.tasksSelectedId)) {
    return;
  }
  state.tasksSelectedId = tasks[0]?.taskId ?? null;
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
    syncSelectedTask(state);
  } catch (error) {
    if (isMissingOperatorReadScopeError(error)) {
      state.tasksOverview = null;
      state.tasksError = formatMissingOperatorReadScopeMessage("background tasks");
      state.tasksSelectedId = null;
    } else {
      state.tasksError = String(error);
    }
  } finally {
    state.tasksLoading = false;
  }
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
  } catch (error) {
    state.tasksError = `Task cancel failed: ${String(error)}`;
  } finally {
    state.tasksBusy = false;
  }
}

export async function updateTaskNotifyPolicy(
  state: TasksState,
  lookup: string,
  notify: TaskNotifyPolicy,
): Promise<void> {
  if (!state.client || !state.connected || state.tasksBusy) {
    return;
  }
  state.tasksBusy = true;
  state.tasksError = null;
  try {
    await state.client.request("tasks.notify", { lookup, notify });
    await loadTasksOverview(state, { quiet: true });
  } catch (error) {
    state.tasksError = `Task notify policy update failed: ${String(error)}`;
  } finally {
    state.tasksBusy = false;
  }
}

function buildFallbackLaunchPrompt(proposal: TaskProposalDraft | TaskProposalRecord): string {
  const lines = [`Please complete this approved ${proposal.kind}: ${proposal.title}`];
  if (proposal.summary?.trim()) {
    lines.push("", `Summary: ${proposal.summary.trim()}`);
  }
  if (proposal.rationale?.trim()) {
    lines.push("", `Why it matters: ${proposal.rationale.trim()}`);
  }
  if (proposal.acceptance.length > 0) {
    lines.push("", "Acceptance criteria:");
    for (const item of proposal.acceptance) {
      const normalized = item.trim();
      if (normalized) {
        lines.push(`- ${normalized}`);
      }
    }
  }
  return lines.join("\n");
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
  } catch (error) {
    state.tasksError = `Task proposal save failed: ${String(error)}`;
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
  } catch (error) {
    state.tasksError = `Task proposal ${decision} failed: ${String(error)}`;
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
    let existing: TaskProposalRecord | null;
    if ("proposalId" in proposal) {
      existing = proposal;
    } else {
      existing = findTaskProposalByClientKey(
        state,
        proposal.requesterSessionKey,
        proposal.clientKey,
      );
      if (!existing) {
        existing = await upsertRemoteTaskProposal(state, proposal);
      }
      if (existing.decision === "pending") {
        existing = await resolveRemoteTaskProposalDecision(state, existing.proposalId, "approved");
      }
    }

    if (!existing) {
      throw new Error("Task proposal could not be prepared for launch.");
    }
    if (existing.decision !== "approved") {
      throw new Error("Task proposal must be approved before launch.");
    }
    if (existing.launchedRunId?.trim()) {
      throw new Error("Task proposal is already linked to a launched run.");
    }

    const prompt = existing.launchPrompt?.trim() || buildFallbackLaunchPrompt(existing);
    const createResult = await state.client.request<{ key?: string; runId?: string | null }>(
      "sessions.create",
      {
        agentId: existing.agentId ?? state.assistantAgentId ?? undefined,
        label: existing.title,
        parentSessionKey: existing.requesterSessionKey,
        task: prompt,
      },
    );
    const sessionKey = typeof createResult?.key === "string" ? createResult.key.trim() : "";
    const runId = typeof createResult?.runId === "string" ? createResult.runId.trim() : "";
    if (!sessionKey || !runId) {
      throw new Error("Task proposal launch did not start an agent run.");
    }

    const attachResult = await state.client.request<{ proposal: TaskProposalRecord }>(
      "tasks.proposal.attachLaunch",
      {
        proposalId: existing.proposalId,
        runId,
        sessionKey,
      },
    );
    const attached = normalizeTaskProposalRecord(attachResult?.proposal);
    if (!attached) {
      throw new Error("Invalid task proposal launch response.");
    }
    await loadTasksOverview(state, { quiet: true });
    return { proposal: attached, sessionKey, runId };
  } catch (error) {
    state.tasksError = `Task proposal launch failed: ${String(error)}`;
    return null;
  } finally {
    state.tasksBusy = false;
  }
}
