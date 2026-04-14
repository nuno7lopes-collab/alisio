import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  TaskNotifyPolicy,
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
  return {
    ...(value as TasksOverviewResult),
    tasks,
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
