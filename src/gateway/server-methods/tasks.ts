import { loadConfig } from "../../config/config.js";
import {
  attachTaskProposalLaunch,
  listTaskProposalViews,
  resolveTaskProposalDecision,
  summarizeTaskProposals,
  upsertTaskProposal,
} from "../../tasks/task-proposals.js";
import {
  listTaskAuditFindings,
  summarizeTaskAuditFindings,
} from "../../tasks/task-registry.audit.js";
import { cancelTaskById, updateTaskNotifyPolicyById } from "../../tasks/task-registry.js";
import {
  previewTaskRegistryMaintenance,
  reconcileInspectableTasks,
  reconcileTaskLookupToken,
  getInspectableTaskRegistrySummary,
} from "../../tasks/task-registry.maintenance.js";
import { summarizeTaskRecords } from "../../tasks/task-registry.summary.js";
import type {
  TaskNotifyPolicy,
  TaskRecord,
  TaskRuntime,
  TaskStatus,
} from "../../tasks/task-registry.types.js";
import {
  ErrorCodes,
  errorShape,
  validateTasksProposalAttachLaunchParams,
  validateTasksProposalResolveParams,
  validateTasksProposalUpsertParams,
  validateTasksCancelParams,
  validateTasksNotifyParams,
  validateTasksOverviewParams,
  type TasksOverviewResult,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

function normalizeComparableText(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function matchesTaskQuery(task: TaskRecord, query: string): boolean {
  const haystack = [
    task.taskId,
    task.runtime,
    task.status,
    task.deliveryStatus,
    task.notifyPolicy,
    task.sourceId,
    task.requesterSessionKey,
    task.childSessionKey,
    task.parentTaskId,
    task.agentId,
    task.runId,
    task.label,
    task.task,
    task.error,
    task.progressSummary,
    task.terminalSummary,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeComparableText(value));
  return haystack.some((value) => value.includes(query));
}

function filterTasks(params: {
  tasks: TaskRecord[];
  runtime?: TaskRuntime | "all";
  status?: TaskStatus | "all";
  query?: string;
}): TaskRecord[] {
  const runtime = params.runtime && params.runtime !== "all" ? params.runtime : null;
  const status = params.status && params.status !== "all" ? params.status : null;
  const query = normalizeComparableText(params.query);
  return params.tasks.filter((task) => {
    if (runtime && task.runtime !== runtime) {
      return false;
    }
    if (status && task.status !== status) {
      return false;
    }
    if (query && !matchesTaskQuery(task, query)) {
      return false;
    }
    return true;
  });
}

export const tasksHandlers: GatewayRequestHandlers = {
  "tasks.overview": async ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksOverviewParams, "tasks.overview", respond)) {
      return;
    }

    const runtime =
      typeof params.runtime === "string" && params.runtime.trim().length > 0
        ? params.runtime
        : null;
    const status =
      typeof params.status === "string" && params.status.trim().length > 0 ? params.status : null;
    const query = typeof params.query === "string" ? params.query.trim() : "";
    const offset =
      typeof params.offset === "number" && Number.isFinite(params.offset) ? params.offset : 0;
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit) ? params.limit : 50;

    const tasks = reconcileInspectableTasks();
    const proposals = listTaskProposalViews();
    const filteredTasks = filterTasks({
      tasks,
      runtime: runtime as TaskRuntime | "all" | null | undefined,
      status: status as TaskStatus | "all" | null | undefined,
      query,
    });
    const pagedTasks = filteredTasks.slice(offset, offset + limit);
    const auditFindings = listTaskAuditFindings({ tasks });
    const findings = auditFindings.slice(0, 8);
    const result: TasksOverviewResult = {
      summary: getInspectableTaskRegistrySummary(),
      filteredSummary: summarizeTaskRecords(filteredTasks),
      proposalSummary: summarizeTaskProposals(proposals),
      audit: summarizeTaskAuditFindings(auditFindings),
      findings,
      maintenance: previewTaskRegistryMaintenance(),
      // The inbox stays canonical across tabs and chat cards. Task filters/search only
      // affect the task ledger view; proposals remain complete so the UI never drifts
      // into showing a saved proposal as a draft because of a previous tasks filter.
      proposals,
      tasks: pagedTasks,
      total: filteredTasks.length,
      limit,
      offset,
      nextOffset:
        offset + pagedTasks.length < filteredTasks.length ? offset + pagedTasks.length : null,
      hasMore: offset + pagedTasks.length < filteredTasks.length,
      runtime: runtime as TaskRuntime | "all" | null,
      status: status as TaskStatus | "all" | null,
      query: query || null,
    };
    respond(true, result, undefined);
  },
  "tasks.proposal.upsert": async ({ params, respond, context, client }) => {
    if (
      !assertValidParams(
        params,
        validateTasksProposalUpsertParams,
        "tasks.proposal.upsert",
        respond,
      )
    ) {
      return;
    }
    const proposal = upsertTaskProposal({
      clientKey: params.clientKey,
      requesterSessionKey: params.requesterSessionKey,
      sourceMessageId: params.sourceMessageId,
      kind: params.kind,
      title: params.title,
      summary: params.summary,
      rationale: params.rationale,
      acceptance: params.acceptance,
      launchPrompt: params.launchPrompt,
      agentId: params.agentId,
      createdBy: params.createdBy,
    });
    context.broadcast("tasks.proposal.changed", { proposal }, { dropIfSlow: true });
    context.logGateway.info("tasks: proposal upserted", {
      proposalId: proposal.proposalId,
      clientKey: proposal.clientKey,
      requesterSessionKey: proposal.requesterSessionKey,
      actor: client?.connect?.client?.displayName ?? client?.connect?.client?.id ?? null,
    });
    respond(true, { proposal }, undefined);
  },
  "tasks.proposal.resolve": async ({ params, respond, context, client }) => {
    if (
      !assertValidParams(
        params,
        validateTasksProposalResolveParams,
        "tasks.proposal.resolve",
        respond,
      )
    ) {
      return;
    }
    try {
      const proposal = resolveTaskProposalDecision({
        proposalId: params.proposalId,
        decision: params.decision,
        resolvedBy: client?.connect?.client?.displayName ?? client?.connect?.client?.id ?? null,
      });
      context.broadcast("tasks.proposal.changed", { proposal }, { dropIfSlow: true });
      respond(true, { proposal }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "tasks.proposal.attachLaunch": async ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateTasksProposalAttachLaunchParams,
        "tasks.proposal.attachLaunch",
        respond,
      )
    ) {
      return;
    }
    try {
      const proposal = attachTaskProposalLaunch({
        proposalId: params.proposalId,
        runId: params.runId,
        sessionKey: params.sessionKey,
      });
      context.broadcast("tasks.proposal.changed", { proposal }, { dropIfSlow: true });
      respond(true, { proposal }, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "tasks.cancel": async ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksCancelParams, "tasks.cancel", respond)) {
      return;
    }
    const task = reconcileTaskLookupToken(params.lookup);
    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Task not found: ${params.lookup}`),
      );
      return;
    }
    respond(
      true,
      await cancelTaskById({
        cfg: loadConfig(),
        taskId: task.taskId,
      }),
      undefined,
    );
  },
  "tasks.notify": async ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksNotifyParams, "tasks.notify", respond)) {
      return;
    }
    const task = reconcileTaskLookupToken(params.lookup);
    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Task not found: ${params.lookup}`),
      );
      return;
    }
    const updated = updateTaskNotifyPolicyById({
      taskId: task.taskId,
      notifyPolicy: params.notify as TaskNotifyPolicy,
    });
    if (!updated) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Task not found: ${params.lookup}`),
      );
      return;
    }
    respond(true, { task: updated }, undefined);
  },
};
