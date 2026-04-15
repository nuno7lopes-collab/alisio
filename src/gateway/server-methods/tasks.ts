import { loadConfig } from "../../config/config.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import {
  attachTaskProposalLaunch,
  getTaskProposalViewById,
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
  bindTaskExecutionRun,
  cancelTaskTree,
  cancelTaskExecution,
  claimTask,
  createTask,
  decideTaskApproval,
  endTaskExecution,
  findTaskForSessionKey,
  getTask,
  getTaskBundle,
  getTaskExecutionByRunId,
  listTasks,
  markTaskExecutionRunningByRunId,
  releaseTask,
  requestTaskApproval,
  spawnChildTask,
  startTaskExecution,
  updateTask,
} from "../../tasks/task-service.js";
import {
  ErrorCodes,
  errorShape,
  validateTasksApprovalDecideParams,
  validateTasksApprovalRequestParams,
  validateTasksCancelParams,
  validateTasksClaimParams,
  validateTasksCreateParams,
  validateTasksExecutionCancelParams,
  validateTasksExecutionEndParams,
  validateTasksExecutionStartParams,
  validateTasksNotifyParams,
  validateTasksOverviewParams,
  validateTasksLaunchFromProposalParams,
  validateTasksProposalAttachLaunchParams,
  validateTasksProposalResolveParams,
  validateTasksProposalUpsertParams,
  validateTasksReleaseParams,
  validateTasksSpawnChildParams,
  validateTasksUpdateParams,
  type TasksOverviewResult,
} from "../protocol/index.js";
import { createGatewaySessionEntry, sendGatewaySessionMessage } from "./sessions.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
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

function buildFallbackLaunchPrompt(proposal: {
  kind: "task" | "project";
  title: string;
  summary?: string;
  rationale?: string;
  acceptance: string[];
}): string {
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

function buildCanonicalTaskSummary(tasks: ReturnType<typeof listTasks>) {
  return {
    total: tasks.length,
    roots: tasks.filter((task) => !task.parentTaskId).length,
    draft: tasks.filter((task) => task.status === "draft").length,
    pendingApproval: tasks.filter((task) => task.status === "pending_approval").length,
    ready: tasks.filter((task) => task.status === "ready").length,
    inProgress: tasks.filter((task) => task.status === "in_progress").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
    awaitingReview: tasks.filter((task) => task.status === "awaiting_review").length,
    completed: tasks.filter((task) => task.status === "completed").length,
    cancelled: tasks.filter((task) => task.status === "cancelled").length,
    failed: tasks.filter((task) => task.status === "failed").length,
  };
}

function resolveCanonicalTaskLookup(lookup: string) {
  const normalizedLookup = lookup.trim();
  if (!normalizedLookup) {
    return null;
  }
  const exactTask = getTask(normalizedLookup);
  if (exactTask) {
    return exactTask;
  }
  const execution = getTaskExecutionByRunId(normalizedLookup);
  if (execution) {
    return getTask(execution.taskId);
  }
  return findTaskForSessionKey(normalizedLookup);
}

function resolveProposalActorLabel(
  client: {
    connect?: {
      client?: {
        displayName?: string | null;
        id?: string | null;
      } | null;
    } | null;
  } | null,
) {
  return client?.connect?.client?.displayName ?? client?.connect?.client?.id ?? null;
}

function respondTaskServiceError(respond: RespondFn, error: unknown) {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)),
  );
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
    const canonicalTasks = listTasks();
    const canonicalBundles = canonicalTasks
      .map((task) => getTaskBundle(task.taskId))
      .filter((bundle): bundle is NonNullable<ReturnType<typeof getTaskBundle>> => Boolean(bundle));
    const filteredTasks = filterTasks({
      tasks,
      runtime: runtime as TaskRuntime | "all" | undefined,
      status: status as TaskStatus | "all" | undefined,
      query,
    });
    const pagedTasks = filteredTasks.slice(offset, offset + limit);
    const auditFindings = listTaskAuditFindings({ tasks });
    const findings = auditFindings.slice(0, 8);
    const result: TasksOverviewResult = {
      summary: getInspectableTaskRegistrySummary(),
      filteredSummary: summarizeTaskRecords(filteredTasks),
      canonicalSummary: buildCanonicalTaskSummary(canonicalTasks),
      proposalSummary: summarizeTaskProposals(proposals),
      audit: summarizeTaskAuditFindings(auditFindings),
      findings,
      maintenance: previewTaskRegistryMaintenance(),
      // The inbox stays canonical across tabs and chat cards. Task filters/search only
      // affect the task ledger view; proposals remain complete so the UI never drifts
      // into showing a saved proposal as a draft because of a previous tasks filter.
      proposals: proposals as unknown as TasksOverviewResult["proposals"],
      tasks: pagedTasks,
      canonicalTasks,
      canonicalExecutions: canonicalBundles.flatMap((bundle) => bundle.executions),
      canonicalAssignments: canonicalBundles.flatMap((bundle) => bundle.assignments),
      canonicalApprovals: canonicalBundles.flatMap((bundle) => bundle.approvals),
      canonicalEvents: canonicalBundles.flatMap((bundle) => bundle.events),
      canonicalDependencies: canonicalBundles.flatMap((bundle) => bundle.dependencies),
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
  "tasks.create": async ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksCreateParams, "tasks.create", respond)) {
      return;
    }
    try {
      respond(true, { task: createTask(params) }, undefined);
    } catch (error) {
      respondTaskServiceError(respond, error);
    }
  },
  "tasks.update": async ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksUpdateParams, "tasks.update", respond)) {
      return;
    }
    try {
      respond(true, { task: updateTask(params) }, undefined);
    } catch (error) {
      respondTaskServiceError(respond, error);
    }
  },
  "tasks.claim": async ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksClaimParams, "tasks.claim", respond)) {
      return;
    }
    try {
      respond(true, claimTask(params), undefined);
    } catch (error) {
      respondTaskServiceError(respond, error);
    }
  },
  "tasks.release": async ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksReleaseParams, "tasks.release", respond)) {
      return;
    }
    try {
      respond(true, releaseTask(params), undefined);
    } catch (error) {
      respondTaskServiceError(respond, error);
    }
  },
  "tasks.spawnChild": async ({ params, respond }) => {
    if (!assertValidParams(params, validateTasksSpawnChildParams, "tasks.spawnChild", respond)) {
      return;
    }
    try {
      respond(true, spawnChildTask(params), undefined);
    } catch (error) {
      respondTaskServiceError(respond, error);
    }
  },
  "tasks.execution.start": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateTasksExecutionStartParams,
        "tasks.execution.start",
        respond,
      )
    ) {
      return;
    }
    try {
      respond(true, startTaskExecution(params), undefined);
    } catch (error) {
      respondTaskServiceError(respond, error);
    }
  },
  "tasks.execution.end": async ({ params, respond }) => {
    if (
      !assertValidParams(params, validateTasksExecutionEndParams, "tasks.execution.end", respond)
    ) {
      return;
    }
    try {
      respond(true, endTaskExecution(params), undefined);
    } catch (error) {
      respondTaskServiceError(respond, error);
    }
  },
  "tasks.execution.cancel": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateTasksExecutionCancelParams,
        "tasks.execution.cancel",
        respond,
      )
    ) {
      return;
    }
    try {
      respond(true, cancelTaskExecution(params), undefined);
    } catch (error) {
      respondTaskServiceError(respond, error);
    }
  },
  "tasks.approval.request": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateTasksApprovalRequestParams,
        "tasks.approval.request",
        respond,
      )
    ) {
      return;
    }
    try {
      respond(true, requestTaskApproval(params), undefined);
    } catch (error) {
      respondTaskServiceError(respond, error);
    }
  },
  "tasks.approval.decide": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateTasksApprovalDecideParams,
        "tasks.approval.decide",
        respond,
      )
    ) {
      return;
    }
    try {
      respond(true, decideTaskApproval(params), undefined);
    } catch (error) {
      respondTaskServiceError(respond, error);
    }
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
  "tasks.launchFromProposal": async ({
    req,
    params,
    respond,
    context,
    client,
    isWebchatConnect,
  }) => {
    if (
      !assertValidParams(
        params,
        validateTasksLaunchFromProposalParams,
        "tasks.launchFromProposal",
        respond,
      )
    ) {
      return;
    }
    try {
      let proposal = getTaskProposalViewById(params.proposalId);
      if (!proposal) {
        throw new Error(`Task proposal not found: ${params.proposalId}`);
      }
      if (proposal.decision === "rejected") {
        throw new Error("Cannot launch a rejected task proposal.");
      }

      if (proposal.launchedTaskId?.trim()) {
        const task = getTask(proposal.launchedTaskId);
        const bundle = task ? getTaskBundle(task.taskId) : null;
        const execution =
          (proposal.launchedRunId?.trim()
            ? getTaskExecutionByRunId(proposal.launchedRunId)
            : null) ??
          bundle?.executions.find(
            (candidate) => candidate.executionId === task?.latestExecutionId,
          ) ??
          bundle?.executions.at(-1);
        const sessionKey =
          proposal.launchedSessionKey?.trim() ||
          execution?.sessionKey?.trim() ||
          task?.orchestratorSessionKey?.trim() ||
          "";
        const runId = proposal.launchedRunId?.trim() || execution?.runId?.trim() || "";
        if (!task || !execution || !sessionKey || !runId) {
          throw new Error("Task proposal launch metadata is incomplete.");
        }
        respond(true, { proposal, task, execution, sessionKey, runId }, undefined);
        return;
      }

      const actor = resolveProposalActorLabel(client);
      if (proposal.decision === "pending") {
        proposal = resolveTaskProposalDecision({
          proposalId: proposal.proposalId,
          decision: "approved",
          resolvedBy: actor,
        });
      }

      const requestedOwnerAgentId =
        typeof params.agentId === "string" && params.agentId.trim()
          ? params.agentId.trim()
          : proposal.agentId?.trim() || undefined;
      const prompt = proposal.launchPrompt?.trim() || buildFallbackLaunchPrompt(proposal);
      const task = createTask({
        kind: proposal.kind,
        title: proposal.title,
        summary: proposal.summary,
        description: prompt,
        acceptance: proposal.acceptance,
        requesterSessionKey: proposal.requesterSessionKey,
        requestedBy:
          proposal.createdBy === "user"
            ? proposal.requesterSessionKey
            : (actor ?? "assistant.proposal"),
        ownerAgentId: requestedOwnerAgentId,
        proposalId: proposal.proposalId,
      });
      const approval = requestTaskApproval({
        taskId: task.taskId,
        requestedBy: proposal.createdBy === "user" ? proposal.requesterSessionKey : "assistant",
        note: proposal.summary ?? proposal.rationale ?? proposal.title,
      });
      decideTaskApproval({
        approvalId: approval.approval.approvalId,
        decision: "approved",
        decidedBy: proposal.resolvedBy ?? actor ?? "control-ui",
        note: proposal.rationale ?? proposal.summary,
      });

      const createdSession = await createGatewaySessionEntry({
        context,
        agentId: requestedOwnerAgentId,
        label: proposal.title,
        parentSessionKey: proposal.requesterSessionKey,
        conversationMode: "task",
      });
      const ownerAgentId =
        resolveAgentIdFromSessionKey(createdSession.key) ?? requestedOwnerAgentId ?? undefined;
      const updatedTask = updateTask({
        taskId: task.taskId,
        ownerAgentId,
        orchestratorSessionKey: createdSession.key,
      });
      const started = startTaskExecution({
        taskId: updatedTask.taskId,
        kind: "orchestrator_session",
        sessionKey: createdSession.key,
        agentId: ownerAgentId,
        label: proposal.title,
        summary: prompt,
        status: "queued",
      });

      let sendResult;
      try {
        sendResult = await sendGatewaySessionMessage({
          req,
          context,
          client,
          isWebchatConnect,
          sessionKey: createdSession.key,
          storePath: createdSession.storePath,
          entry: createdSession.entry,
          message: prompt,
        });
      } catch (error) {
        endTaskExecution({
          executionId: started.execution.executionId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      const runId =
        typeof sendResult.payload?.runId === "string" ? sendResult.payload.runId.trim() : "";
      if (!runId) {
        endTaskExecution({
          executionId: started.execution.executionId,
          status: "failed",
          error: "Task proposal launch did not start an agent run.",
        });
        throw new Error("Task proposal launch did not start an agent run.");
      }

      bindTaskExecutionRun({
        executionId: started.execution.executionId,
        runId,
        sourceId: runId,
        sessionKey: createdSession.key,
        agentId: ownerAgentId,
        label: proposal.title,
        summary: prompt,
        kind: "orchestrator_session",
      });
      if (sendResult.runStarted) {
        markTaskExecutionRunningByRunId({
          runId,
          summary: prompt,
        });
      }

      proposal = attachTaskProposalLaunch({
        proposalId: proposal.proposalId,
        taskId: updatedTask.taskId,
        runId,
        sessionKey: createdSession.key,
      });
      const launchedTask = getTask(updatedTask.taskId);
      const launchedExecution = getTaskExecutionByRunId(runId);
      if (!launchedTask || !launchedExecution) {
        throw new Error("Canonical task launch state could not be reloaded.");
      }
      context.broadcast("tasks.proposal.changed", { proposal }, { dropIfSlow: true });
      respond(
        true,
        {
          proposal,
          task: launchedTask,
          execution: launchedExecution,
          sessionKey: createdSession.key,
          runId,
        },
        undefined,
      );
    } catch (error) {
      respondTaskServiceError(respond, error);
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
        taskId: params.taskId,
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
    const canonicalTask = resolveCanonicalTaskLookup(params.lookup);
    if (canonicalTask) {
      try {
        const cancelledTask = cancelTaskTree({
          taskId: canonicalTask.taskId,
          reason: `Cancelled via tasks.cancel (${params.lookup})`,
        });
        respond(
          true,
          {
            found: true,
            cancelled: true,
            canonicalTask: cancelledTask,
          },
          undefined,
        );
      } catch (error) {
        respondTaskServiceError(respond, error);
      }
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
