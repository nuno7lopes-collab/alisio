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
import { cancelTaskById, updateTaskNotifyPolicyById } from "../../tasks/task-registry.js";
import {
  reconcileTaskLookupToken,
} from "../../tasks/task-registry.maintenance.js";
import { filterVisibleCanonicalTaskBundles, isVisibleCanonicalTaskBundle } from "../../tasks/canonical-task-visibility.js";
import type {
  TaskNotifyPolicy,
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
  validateTasksDetailParams,
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
  type TasksDetailResult,
  type TasksOverviewResult,
} from "../protocol/index.js";
import { loadSessionEntry } from "../session-utils.js";
import { createGatewaySessionEntry, sendGatewaySessionMessage } from "./sessions.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

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

function buildTaskOrchestratorSystemPrompt(task: {
  taskId: string;
  title: string;
  summary?: string;
  acceptance: string[];
}) {
  const lines = [
    "This session is the canonical orchestrator for an approved task launched from the Tasks UI.",
    `Canonical task: ${task.taskId} (${task.title})`,
    "Start execution immediately unless there is a real blocker, missing dependency, or safety constraint.",
    "Keep the main thread focused on orchestration and use sessions_spawn for bounded parallel subtasks when that reduces latency or keeps ownership clear.",
    "Do not drift into unrelated repo cleanup. Stay anchored to the approved task scope.",
    "Before you finish, verify the acceptance criteria, integrate subagent results, and report any remaining blockers precisely.",
  ];
  if (task.summary?.trim()) {
    lines.push("", `Task summary: ${task.summary.trim()}`);
  }
  if (task.acceptance.length > 0) {
    lines.push("", "Acceptance criteria to verify before completion:");
    for (const item of task.acceptance) {
      const normalized = item.trim();
      if (normalized) {
        lines.push(`- ${normalized}`);
      }
    }
  }
  return lines.join("\n");
}

type CanonicalTask = NonNullable<ReturnType<typeof getTask>>;
type CanonicalTaskBundle = NonNullable<ReturnType<typeof getTaskBundle>>;
type CanonicalTaskExecution = CanonicalTaskBundle["executions"][number];

function resolveProposalLaunchResult(params: {
  proposal: {
    launchedRunId?: string;
    launchedSessionKey?: string;
  };
  task: NonNullable<ReturnType<typeof getTask>>;
}) {
  const bundle = getTaskBundle(params.task.taskId);
  const execution =
    (params.proposal.launchedRunId?.trim()
      ? getTaskExecutionByRunId(params.proposal.launchedRunId)
      : null) ??
    bundle?.executions.find(
      (candidate) => candidate.executionId === params.task.activeExecutionId,
    ) ??
    bundle?.executions.find(
      (candidate) => candidate.executionId === params.task.latestExecutionId,
    ) ??
    bundle?.executions.at(-1) ??
    null;
  const sessionKey =
    params.proposal.launchedSessionKey?.trim() ||
    execution?.sessionKey?.trim() ||
    params.task.orchestratorSessionKey?.trim() ||
    "";
  const runId = params.proposal.launchedRunId?.trim() || execution?.runId?.trim() || "";
  if (!execution || !sessionKey || !runId) {
    return null;
  }
  return {
    task: params.task,
    execution,
    sessionKey,
    runId,
  };
}

function ensureTaskReadyForProposalLaunch(params: {
  task: CanonicalTask;
  proposal: {
    createdBy: "assistant" | "user";
    requesterSessionKey: string;
    summary?: string;
    rationale?: string;
    title: string;
  };
  actor: string | null;
}) {
  let task = params.task;
  if (task.status !== "draft" && task.status !== "pending_approval" && task.status !== "blocked") {
    return task;
  }
  const requestedBy =
    params.proposal.createdBy === "user" ? params.proposal.requesterSessionKey : "assistant";
  const note = params.proposal.summary ?? params.proposal.rationale ?? params.proposal.title;
  let approval =
    task.latestApprovalId && task.status === "pending_approval"
      ? (getTaskBundle(task.taskId)?.approvals.find(
          (candidate) =>
            candidate.approvalId === task.latestApprovalId && candidate.status === "pending",
        ) ?? null)
      : null;
  if (!approval) {
    approval = requestTaskApproval({
      taskId: task.taskId,
      requestedBy,
      note,
    }).approval;
  }
  task = decideTaskApproval({
    approvalId: approval.approvalId,
    decision: "approved",
    decidedBy: params.actor ?? "control-ui",
    note: params.proposal.rationale ?? params.proposal.summary,
  }).task;
  return task;
}

function resolveRecoverableProposalLaunchState(task: CanonicalTask): {
  resumableExecution: CanonicalTaskExecution | null;
  reusableSession: {
    sessionKey: string;
    storePath: string;
    entry: NonNullable<ReturnType<typeof loadSessionEntry>["entry"]>;
  } | null;
} {
  const bundle = getTaskBundle(task.taskId);
  const executionCandidates: CanonicalTaskExecution[] = [];
  if (bundle && task.activeExecutionId) {
    const active = bundle.executions.find(
      (candidate) => candidate.executionId === task.activeExecutionId,
    );
    if (active) {
      executionCandidates.push(active);
    }
  }
  if (bundle && task.latestExecutionId && task.latestExecutionId !== task.activeExecutionId) {
    const latest = bundle.executions.find(
      (candidate) => candidate.executionId === task.latestExecutionId,
    );
    if (latest) {
      executionCandidates.push(latest);
    }
  }
  if (bundle) {
    for (let index = bundle.executions.length - 1; index >= 0; index -= 1) {
      const execution = bundle.executions[index];
      if (
        execution &&
        !executionCandidates.some((candidate) => candidate.executionId === execution.executionId)
      ) {
        executionCandidates.push(execution);
      }
    }
  }
  const resumableExecution =
    executionCandidates.find(
      (candidate) => candidate.status === "queued" && !candidate.runId?.trim(),
    ) ?? null;
  const rawSessionKey =
    task.orchestratorSessionKey?.trim() ||
    resumableExecution?.sessionKey?.trim() ||
    executionCandidates.find((candidate) => candidate.sessionKey?.trim())?.sessionKey?.trim() ||
    "";
  if (!rawSessionKey) {
    return {
      resumableExecution,
      reusableSession: null,
    };
  }
  const loaded = loadSessionEntry(rawSessionKey);
  if (!loaded.entry?.sessionId) {
    return {
      resumableExecution,
      reusableSession: null,
    };
  }
  return {
    resumableExecution,
    reusableSession: {
      sessionKey: loaded.canonicalKey,
      storePath: loaded.storePath,
      entry: loaded.entry,
    },
  };
}

async function launchProposalTaskExecution(params: {
  req: GatewayRequestHandlers["tasks.launchFromProposal"] extends (
    args: infer T,
  ) => Promise<unknown>
    ? T["req"]
    : never;
  context: GatewayRequestHandlers["tasks.launchFromProposal"] extends (
    args: infer T,
  ) => Promise<unknown>
    ? T["context"]
    : never;
  client: GatewayRequestHandlers["tasks.launchFromProposal"] extends (
    args: infer T,
  ) => Promise<unknown>
    ? T["client"]
    : never;
  isWebchatConnect: GatewayRequestHandlers["tasks.launchFromProposal"] extends (
    args: infer T,
  ) => Promise<unknown>
    ? T["isWebchatConnect"]
    : never;
  proposal: {
    proposalId: string;
    title: string;
    summary?: string;
    rationale?: string;
    acceptance: string[];
    launchPrompt?: string;
    requesterSessionKey: string;
    createdBy: "assistant" | "user";
    agentId?: string;
    resolvedBy?: string | null;
  };
  task: CanonicalTask;
  actor: string | null;
  preferredOwnerAgentId?: string;
}) {
  const prompt = params.proposal.launchPrompt?.trim() || buildFallbackLaunchPrompt(params.proposal);
  let task = ensureTaskReadyForProposalLaunch({
    task: params.task,
    proposal: params.proposal,
    actor: params.actor,
  });
  const orchestratorSystemPrompt = buildTaskOrchestratorSystemPrompt({
    taskId: task.taskId,
    title: params.proposal.title,
    summary: params.proposal.summary,
    acceptance: params.proposal.acceptance,
  });
  const recovery = resolveRecoverableProposalLaunchState(task);
  const reusableSession =
    recovery.reusableSession &&
    (!params.preferredOwnerAgentId ||
      resolveAgentIdFromSessionKey(recovery.reusableSession.sessionKey) ===
        params.preferredOwnerAgentId)
      ? recovery.reusableSession
      : null;
  let sessionKey = reusableSession?.sessionKey ?? "";
  let storePath = reusableSession?.storePath ?? "";
  let entry = reusableSession?.entry ?? null;
  if (!reusableSession) {
    const createdSession = await createGatewaySessionEntry({
      context: params.context,
      agentId: params.preferredOwnerAgentId,
      label: params.proposal.title,
      extraSystemPrompt: orchestratorSystemPrompt,
      parentSessionKey: params.proposal.requesterSessionKey,
      conversationMode: "task",
    });
    sessionKey = createdSession.key;
    storePath = createdSession.storePath;
    entry = createdSession.entry;
  }
  const ownerAgentId =
    resolveAgentIdFromSessionKey(sessionKey) ??
    params.preferredOwnerAgentId ??
    task.ownerAgentId ??
    undefined;
  if (task.orchestratorSessionKey !== sessionKey || task.ownerAgentId !== ownerAgentId) {
    task = updateTask({
      taskId: task.taskId,
      ownerAgentId,
      orchestratorSessionKey: sessionKey,
    });
  }
  const execution =
    (reusableSession ? recovery.resumableExecution : null) ??
    startTaskExecution({
      taskId: task.taskId,
      kind: "orchestrator_session",
      sessionKey,
      agentId: ownerAgentId,
      label: params.proposal.title,
      summary: prompt,
      status: "queued",
    }).execution;

  let sendResult;
  try {
    sendResult = await sendGatewaySessionMessage({
      req: params.req,
      context: params.context,
      client: params.client,
      isWebchatConnect: params.isWebchatConnect,
      sessionKey,
      storePath,
      entry,
      message: prompt,
      extraSystemPrompt: reusableSession ? orchestratorSystemPrompt : undefined,
    });
  } catch (error) {
    endTaskExecution({
      executionId: execution.executionId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const runId =
    typeof sendResult.payload?.runId === "string" ? sendResult.payload.runId.trim() : "";
  if (!runId) {
    endTaskExecution({
      executionId: execution.executionId,
      status: "failed",
      error: "Task proposal launch did not start an agent run.",
    });
    throw new Error("Task proposal launch did not start an agent run.");
  }

  bindTaskExecutionRun({
    executionId: execution.executionId,
    runId,
    sourceId: runId,
    sessionKey,
    agentId: ownerAgentId,
    label: params.proposal.title,
    summary: prompt,
    kind: "orchestrator_session",
  });
  if (sendResult.runStarted) {
    markTaskExecutionRunningByRunId({
      runId,
      summary: prompt,
    });
  }

  const proposal = attachTaskProposalLaunch({
    proposalId: params.proposal.proposalId,
    taskId: task.taskId,
    runId,
    sessionKey,
  });
  const launchedTask = getTask(task.taskId);
  const launchedExecution = getTaskExecutionByRunId(runId);
  if (!launchedTask || !launchedExecution) {
    throw new Error("Canonical task launch state could not be reloaded.");
  }
  return {
    proposal,
    task: launchedTask,
    execution: launchedExecution,
    sessionKey,
    runId,
  };
}

function buildCanonicalTaskSummary(tasks: CanonicalTask[]) {
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
  if (exactTask && isVisibleCanonicalTaskBundle(getTaskBundle(exactTask.taskId) ?? { task: exactTask, executions: [], events: [] })) {
    return exactTask;
  }
  const execution = getTaskExecutionByRunId(normalizedLookup);
  if (execution) {
    const executionTask = getTask(execution.taskId);
    if (
      executionTask &&
      isVisibleCanonicalTaskBundle(
        getTaskBundle(executionTask.taskId) ?? {
          task: executionTask,
          executions: [],
          events: [],
        },
      )
    ) {
      return executionTask;
    }
  }
  const sessionTask = findTaskForSessionKey(normalizedLookup);
  if (
    sessionTask &&
    isVisibleCanonicalTaskBundle(
      getTaskBundle(sessionTask.taskId) ?? {
        task: sessionTask,
        executions: [],
        events: [],
      },
    )
  ) {
    return sessionTask;
  }
  return null;
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
    const canonicalBundles = filterVisibleCanonicalTaskBundles(
      listTasks()
      .map((task) => getTaskBundle(task.taskId))
      .filter((bundle): bundle is NonNullable<ReturnType<typeof getTaskBundle>> => Boolean(bundle)),
    );
    const canonicalTasks = canonicalBundles.map((bundle) => bundle.task);
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
      canonicalSteps: canonicalBundles.flatMap((bundle) => bundle.steps),
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
      const proposalId = proposal.proposalId;

      const attachedTaskId = proposal.launchedTaskId?.trim() || "";
      const attachedTask = attachedTaskId ? getTask(attachedTaskId) : null;
      if (attachedTaskId && !attachedTask) {
        throw new Error(
          `Task proposal launch references missing canonical task: ${attachedTaskId}`,
        );
      }
      const existingTask =
        attachedTask ??
        listTasks().find((candidate) => candidate.proposalId === proposalId) ??
        null;
      if (existingTask) {
        const existingLaunch = resolveProposalLaunchResult({
          proposal,
          task: existingTask,
        });
        if (existingLaunch) {
          if (
            proposal.launchedTaskId !== existingTask.taskId ||
            proposal.launchedRunId !== existingLaunch.runId ||
            proposal.launchedSessionKey !== existingLaunch.sessionKey
          ) {
            proposal = attachTaskProposalLaunch({
              proposalId: proposal.proposalId,
              taskId: existingTask.taskId,
              runId: existingLaunch.runId,
              sessionKey: existingLaunch.sessionKey,
            });
            context.broadcast("tasks.proposal.changed", { proposal }, { dropIfSlow: true });
          }
          respond(true, { proposal, ...existingLaunch }, undefined);
          return;
        }
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
      const task =
        existingTask ??
        createTask({
          kind: proposal.kind,
          title: proposal.title,
          summary: proposal.summary,
          description: proposal.launchPrompt?.trim() || buildFallbackLaunchPrompt(proposal),
          acceptance: proposal.acceptance,
          requesterSessionKey: proposal.requesterSessionKey,
          requestedBy:
            proposal.createdBy === "user"
              ? proposal.requesterSessionKey
              : (actor ?? "assistant.proposal"),
          ownerAgentId: requestedOwnerAgentId,
          proposalId: proposal.proposalId,
        });
      const launched = await launchProposalTaskExecution({
        req,
        context,
        client,
        isWebchatConnect,
        proposal,
        task,
        actor,
        preferredOwnerAgentId: requestedOwnerAgentId,
      });
      proposal = launched.proposal;
      context.broadcast("tasks.proposal.changed", { proposal }, { dropIfSlow: true });
      respond(true, launched, undefined);
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
