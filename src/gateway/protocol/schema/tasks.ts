import { Static, Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const TaskRuntimeSchema = Type.Union([
  Type.Literal("subagent"),
  Type.Literal("acp"),
  Type.Literal("cli"),
  Type.Literal("cron"),
]);

export const TaskStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("timed_out"),
  Type.Literal("cancelled"),
  Type.Literal("lost"),
]);

export const TaskDeliveryStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("delivered"),
  Type.Literal("session_queued"),
  Type.Literal("failed"),
  Type.Literal("parent_missing"),
  Type.Literal("not_applicable"),
]);

export const TaskNotifyPolicySchema = Type.Union([
  Type.Literal("done_only"),
  Type.Literal("state_changes"),
  Type.Literal("silent"),
]);

export const TaskTerminalOutcomeSchema = Type.Union([
  Type.Literal("succeeded"),
  Type.Literal("blocked"),
]);

export const TaskProposalKindSchema = Type.Union([Type.Literal("task"), Type.Literal("project")]);

export const TaskProposalDecisionSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
]);

export const TaskProposalCreatedBySchema = Type.Union([
  Type.Literal("assistant"),
  Type.Literal("user"),
]);

export const TaskStatusCountsSchema = Type.Object(
  {
    queued: Type.Integer({ minimum: 0 }),
    running: Type.Integer({ minimum: 0 }),
    succeeded: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
    timed_out: Type.Integer({ minimum: 0 }),
    cancelled: Type.Integer({ minimum: 0 }),
    lost: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const TaskRuntimeCountsSchema = Type.Object(
  {
    subagent: Type.Integer({ minimum: 0 }),
    acp: Type.Integer({ minimum: 0 }),
    cli: Type.Integer({ minimum: 0 }),
    cron: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const TaskRegistrySummarySchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    active: Type.Integer({ minimum: 0 }),
    terminal: Type.Integer({ minimum: 0 }),
    failures: Type.Integer({ minimum: 0 }),
    byStatus: TaskStatusCountsSchema,
    byRuntime: TaskRuntimeCountsSchema,
  },
  { additionalProperties: false },
);

export const TaskProposalSummarySchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    pending: Type.Integer({ minimum: 0 }),
    approved: Type.Integer({ minimum: 0 }),
    rejected: Type.Integer({ minimum: 0 }),
    launched: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const TaskRecordSchema = Type.Object(
  {
    taskId: NonEmptyString,
    runtime: TaskRuntimeSchema,
    sourceId: Type.Optional(Type.String()),
    requesterSessionKey: NonEmptyString,
    childSessionKey: Type.Optional(Type.String()),
    parentTaskId: Type.Optional(Type.String()),
    agentId: Type.Optional(Type.String()),
    runId: Type.Optional(Type.String()),
    label: Type.Optional(Type.String()),
    task: NonEmptyString,
    status: TaskStatusSchema,
    deliveryStatus: TaskDeliveryStatusSchema,
    notifyPolicy: TaskNotifyPolicySchema,
    createdAt: Type.Integer({ minimum: 0 }),
    startedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    endedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastEventAt: Type.Optional(Type.Integer({ minimum: 0 })),
    cleanupAfter: Type.Optional(Type.Integer({ minimum: 0 })),
    error: Type.Optional(Type.String()),
    progressSummary: Type.Optional(Type.String()),
    terminalSummary: Type.Optional(Type.String()),
    terminalOutcome: Type.Optional(TaskTerminalOutcomeSchema),
  },
  { additionalProperties: false },
);

export const TaskProposalRecordSchema = Type.Object(
  {
    proposalId: NonEmptyString,
    clientKey: NonEmptyString,
    requesterSessionKey: NonEmptyString,
    sourceMessageId: Type.Optional(Type.String()),
    kind: TaskProposalKindSchema,
    title: NonEmptyString,
    summary: Type.Optional(Type.String()),
    rationale: Type.Optional(Type.String()),
    acceptance: Type.Array(NonEmptyString),
    launchPrompt: Type.Optional(Type.String()),
    agentId: Type.Optional(Type.String()),
    createdBy: TaskProposalCreatedBySchema,
    decision: TaskProposalDecisionSchema,
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
    resolvedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    resolvedBy: Type.Optional(Type.String()),
    launchedTaskId: Type.Optional(Type.String()),
    launchedRunId: Type.Optional(Type.String()),
    launchedSessionKey: Type.Optional(Type.String()),
    launchedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    linkedTask: Type.Optional(TaskRecordSchema),
  },
  { additionalProperties: false },
);

export const TaskAuditSeveritySchema = Type.Union([Type.Literal("warn"), Type.Literal("error")]);

export const TaskAuditCodeSchema = Type.Union([
  Type.Literal("stale_queued"),
  Type.Literal("stale_running"),
  Type.Literal("lost"),
  Type.Literal("delivery_failed"),
  Type.Literal("missing_cleanup"),
  Type.Literal("inconsistent_timestamps"),
]);

export const TaskAuditFindingSchema = Type.Object(
  {
    severity: TaskAuditSeveritySchema,
    code: TaskAuditCodeSchema,
    task: TaskRecordSchema,
    ageMs: Type.Optional(Type.Integer({ minimum: 0 })),
    detail: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TaskAuditCodeCountsSchema = Type.Object(
  {
    stale_queued: Type.Integer({ minimum: 0 }),
    stale_running: Type.Integer({ minimum: 0 }),
    lost: Type.Integer({ minimum: 0 }),
    delivery_failed: Type.Integer({ minimum: 0 }),
    missing_cleanup: Type.Integer({ minimum: 0 }),
    inconsistent_timestamps: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const TaskAuditSummarySchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    warnings: Type.Integer({ minimum: 0 }),
    errors: Type.Integer({ minimum: 0 }),
    byCode: TaskAuditCodeCountsSchema,
  },
  { additionalProperties: false },
);

export const TaskMaintenanceSummarySchema = Type.Object(
  {
    reconciled: Type.Integer({ minimum: 0 }),
    cleanupStamped: Type.Integer({ minimum: 0 }),
    pruned: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const CanonicalTaskSummarySchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    roots: Type.Integer({ minimum: 0 }),
    draft: Type.Integer({ minimum: 0 }),
    pendingApproval: Type.Integer({ minimum: 0 }),
    ready: Type.Integer({ minimum: 0 }),
    inProgress: Type.Integer({ minimum: 0 }),
    blocked: Type.Integer({ minimum: 0 }),
    awaitingReview: Type.Integer({ minimum: 0 }),
    completed: Type.Integer({ minimum: 0 }),
    cancelled: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const TaskRuntimeFilterSchema = Type.Union([TaskRuntimeSchema, Type.Literal("all")]);
const TaskStatusFilterSchema = Type.Union([TaskStatusSchema, Type.Literal("all")]);

export const TasksOverviewParamsSchema = Type.Object(
  {
    runtime: Type.Optional(TaskRuntimeFilterSchema),
    status: Type.Optional(TaskStatusFilterSchema),
    query: Type.Optional(Type.String({ maxLength: 200 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const TasksCancelParamsSchema = Type.Object(
  {
    lookup: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TasksNotifyParamsSchema = Type.Object(
  {
    lookup: NonEmptyString,
    notify: TaskNotifyPolicySchema,
  },
  { additionalProperties: false },
);

export const TasksNotifyResultSchema = Type.Object(
  {
    task: TaskRecordSchema,
  },
  { additionalProperties: false },
);

export const TasksProposalUpsertParamsSchema = Type.Object(
  {
    clientKey: NonEmptyString,
    requesterSessionKey: NonEmptyString,
    sourceMessageId: Type.Optional(Type.String({ maxLength: 240 })),
    kind: Type.Optional(TaskProposalKindSchema),
    title: NonEmptyString,
    summary: Type.Optional(Type.String({ maxLength: 800 })),
    rationale: Type.Optional(Type.String({ maxLength: 1600 })),
    acceptance: Type.Optional(Type.Array(Type.String({ maxLength: 240 }), { maxItems: 12 })),
    launchPrompt: Type.Optional(Type.String({ maxLength: 8000 })),
    agentId: Type.Optional(Type.String({ maxLength: 120 })),
    createdBy: Type.Optional(TaskProposalCreatedBySchema),
  },
  { additionalProperties: false },
);

export const TasksProposalUpsertResultSchema = Type.Object(
  {
    proposal: TaskProposalRecordSchema,
  },
  { additionalProperties: false },
);

export const TasksProposalResolveParamsSchema = Type.Object(
  {
    proposalId: NonEmptyString,
    decision: Type.Union([Type.Literal("approved"), Type.Literal("rejected")]),
  },
  { additionalProperties: false },
);

export const TasksProposalResolveResultSchema = Type.Object(
  {
    proposal: TaskProposalRecordSchema,
  },
  { additionalProperties: false },
);

export const TasksProposalAttachLaunchParamsSchema = Type.Object(
  {
    proposalId: NonEmptyString,
    taskId: NonEmptyString,
    runId: Type.Optional(Type.String({ maxLength: 240 })),
    sessionKey: Type.Optional(Type.String({ maxLength: 240 })),
  },
  { additionalProperties: false },
);

export const TasksProposalAttachLaunchResultSchema = Type.Object(
  {
    proposal: TaskProposalRecordSchema,
  },
  { additionalProperties: false },
);

export const TasksLaunchFromProposalParamsSchema = Type.Object(
  {
    proposalId: NonEmptyString,
    agentId: Type.Optional(Type.String({ maxLength: 120 })),
  },
  { additionalProperties: false },
);

export const CanonicalTaskStatusSchema = Type.Union([
  Type.Literal("draft"),
  Type.Literal("pending_approval"),
  Type.Literal("ready"),
  Type.Literal("in_progress"),
  Type.Literal("blocked"),
  Type.Literal("awaiting_review"),
  Type.Literal("completed"),
  Type.Literal("cancelled"),
  Type.Literal("failed"),
]);

export const TaskExecutionKindSchema = Type.Union([
  Type.Literal("subagent"),
  Type.Literal("acp"),
  Type.Literal("cron"),
  Type.Literal("cli"),
  Type.Literal("orchestrator_session"),
]);

export const TaskExecutionStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("timed_out"),
  Type.Literal("cancelled"),
  Type.Literal("lost"),
]);

export const TaskExecutionStepKindSchema = Type.Union([
  Type.Literal("execution_started"),
  Type.Literal("execution_running"),
  Type.Literal("execution_finished"),
  Type.Literal("execution_cancelled"),
  Type.Literal("approval_requested"),
  Type.Literal("approval_decided"),
  Type.Literal("assignment_claimed"),
  Type.Literal("assignment_released"),
  Type.Literal("child_task_spawned"),
  Type.Literal("command_started"),
  Type.Literal("command_finished"),
  Type.Literal("file_read"),
  Type.Literal("file_written"),
  Type.Literal("search_performed"),
  Type.Literal("browser_navigated"),
  Type.Literal("browser_snapshot"),
  Type.Literal("tool_called"),
  Type.Literal("tool_result"),
]);

export const TaskExecutionStepStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("info"),
]);

export const TaskAssignmentStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("released"),
  Type.Literal("expired"),
]);

export const TaskApprovalStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
  Type.Literal("cancelled"),
]);

export const TaskEventKindV2Schema = Type.Union([
  Type.Literal("created"),
  Type.Literal("updated"),
  Type.Literal("claimed"),
  Type.Literal("released"),
  Type.Literal("child_spawned"),
  Type.Literal("approval_requested"),
  Type.Literal("approval_decided"),
  Type.Literal("execution_started"),
  Type.Literal("execution_ended"),
  Type.Literal("execution_cancelled"),
]);

export const TaskDependencyKindSchema = Type.Literal("blocks");

export const TaskSchema = Type.Object(
  {
    taskId: NonEmptyString,
    rootTaskId: NonEmptyString,
    parentTaskId: Type.Optional(Type.String()),
    proposalId: Type.Optional(Type.String()),
    kind: TaskProposalKindSchema,
    title: NonEmptyString,
    summary: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    acceptance: Type.Array(NonEmptyString),
    requesterSessionKey: Type.Optional(Type.String()),
    requestedBy: Type.Optional(Type.String()),
    ownerAgentId: Type.Optional(Type.String()),
    orchestratorSessionKey: Type.Optional(Type.String()),
    status: CanonicalTaskStatusSchema,
    blockedReason: Type.Optional(Type.String()),
    activeExecutionId: Type.Optional(Type.String()),
    latestExecutionId: Type.Optional(Type.String()),
    latestApprovalId: Type.Optional(Type.String()),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
    startedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    endedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const TaskExecutionSchema = Type.Object(
  {
    executionId: NonEmptyString,
    taskId: NonEmptyString,
    kind: TaskExecutionKindSchema,
    attempt: Type.Integer({ minimum: 1 }),
    sourceId: Type.Optional(Type.String()),
    runId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    agentId: Type.Optional(Type.String()),
    label: Type.Optional(Type.String()),
    status: TaskExecutionStatusSchema,
    summary: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    terminalOutcome: Type.Optional(TaskTerminalOutcomeSchema),
    cancellationReason: Type.Optional(Type.String()),
    createdAt: Type.Integer({ minimum: 0 }),
    startedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    endedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const TaskAssignmentSchema = Type.Object(
  {
    assignmentId: NonEmptyString,
    taskId: NonEmptyString,
    agentId: NonEmptyString,
    sessionKey: Type.Optional(Type.String()),
    claimedBy: Type.Optional(Type.String()),
    status: TaskAssignmentStatusSchema,
    claimedAt: Type.Integer({ minimum: 0 }),
    leaseExpiresAt: Type.Integer({ minimum: 0 }),
    releasedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const TaskExecutionStepSchema = Type.Object(
  {
    stepId: NonEmptyString,
    taskId: NonEmptyString,
    executionId: Type.Optional(Type.String()),
    kind: TaskExecutionStepKindSchema,
    status: TaskExecutionStepStatusSchema,
    actor: Type.Optional(Type.String()),
    tool: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    dataJson: Type.Optional(Type.String()),
    createdAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const TaskApprovalSchema = Type.Object(
  {
    approvalId: NonEmptyString,
    taskId: NonEmptyString,
    status: TaskApprovalStatusSchema,
    requestedAt: Type.Integer({ minimum: 0 }),
    requestedBy: Type.Optional(Type.String()),
    decidedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    decidedBy: Type.Optional(Type.String()),
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TaskEventSchema = Type.Object(
  {
    eventId: NonEmptyString,
    taskId: NonEmptyString,
    executionId: Type.Optional(Type.String()),
    assignmentId: Type.Optional(Type.String()),
    approvalId: Type.Optional(Type.String()),
    kind: TaskEventKindV2Schema,
    actor: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    dataJson: Type.Optional(Type.String()),
    createdAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const TaskDependencySchema = Type.Object(
  {
    dependencyId: NonEmptyString,
    taskId: NonEmptyString,
    dependsOnTaskId: NonEmptyString,
    kind: TaskDependencyKindSchema,
    createdAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const TasksOverviewResultSchema = Type.Object(
  {
    canonicalSummary: CanonicalTaskSummarySchema,
    proposalSummary: TaskProposalSummarySchema,
    proposals: Type.Array(TaskProposalRecordSchema),
    canonicalTasks: Type.Array(TaskSchema),
    total: Type.Integer({ minimum: 0 }),
    limit: Type.Integer({ minimum: 1 }),
    offset: Type.Integer({ minimum: 0 }),
    nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    hasMore: Type.Boolean(),
    runtime: Type.Union([TaskRuntimeFilterSchema, Type.Null()]),
    status: Type.Union([TaskStatusFilterSchema, Type.Null()]),
    query: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const TasksDetailParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TasksDetailResultSchema = Type.Object(
  {
    task: TaskSchema,
    proposal: Type.Optional(TaskProposalRecordSchema),
    children: Type.Array(TaskSchema),
    executions: Type.Array(TaskExecutionSchema),
    assignments: Type.Array(TaskAssignmentSchema),
    approvals: Type.Array(TaskApprovalSchema),
    events: Type.Array(TaskEventSchema),
    steps: Type.Array(TaskExecutionStepSchema),
    dependencies: Type.Array(TaskDependencySchema),
  },
  { additionalProperties: false },
);

export const TasksCancelResultSchema = Type.Object(
  {
    found: Type.Boolean(),
    cancelled: Type.Boolean(),
    reason: Type.Optional(Type.String()),
    task: Type.Optional(TaskRecordSchema),
    canonicalTask: Type.Optional(TaskSchema),
  },
  { additionalProperties: false },
);

export const TasksLaunchFromProposalResultSchema = Type.Object(
  {
    proposal: TaskProposalRecordSchema,
    task: TaskSchema,
    execution: TaskExecutionSchema,
    sessionKey: NonEmptyString,
    runId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TasksCreateParamsSchema = Type.Object(
  {
    kind: Type.Optional(TaskProposalKindSchema),
    title: NonEmptyString,
    summary: Type.Optional(Type.String({ maxLength: 800 })),
    description: Type.Optional(Type.String({ maxLength: 8000 })),
    acceptance: Type.Optional(Type.Array(Type.String({ maxLength: 240 }), { maxItems: 12 })),
    requesterSessionKey: Type.Optional(Type.String({ maxLength: 240 })),
    requestedBy: Type.Optional(Type.String({ maxLength: 160 })),
    ownerAgentId: Type.Optional(Type.String({ maxLength: 120 })),
    orchestratorSessionKey: Type.Optional(Type.String({ maxLength: 240 })),
    parentTaskId: Type.Optional(Type.String({ maxLength: 160 })),
    proposalId: Type.Optional(Type.String({ maxLength: 160 })),
    status: Type.Optional(CanonicalTaskStatusSchema),
  },
  { additionalProperties: false },
);

export const TasksCreateResultSchema = Type.Object(
  {
    task: TaskSchema,
  },
  { additionalProperties: false },
);

export const TasksUpdateParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
    title: Type.Optional(Type.String({ maxLength: 200 })),
    summary: Type.Optional(Type.String({ maxLength: 800 })),
    description: Type.Optional(Type.String({ maxLength: 8000 })),
    acceptance: Type.Optional(Type.Array(Type.String({ maxLength: 240 }), { maxItems: 12 })),
    ownerAgentId: Type.Optional(Type.String({ maxLength: 120 })),
    orchestratorSessionKey: Type.Optional(Type.String({ maxLength: 240 })),
    status: Type.Optional(CanonicalTaskStatusSchema),
    blockedReason: Type.Optional(Type.String({ maxLength: 800 })),
  },
  { additionalProperties: false },
);

export const TasksUpdateResultSchema = Type.Object(
  {
    task: TaskSchema,
  },
  { additionalProperties: false },
);

export const TasksClaimParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
    agentId: NonEmptyString,
    sessionKey: Type.Optional(Type.String({ maxLength: 240 })),
    claimedBy: Type.Optional(Type.String({ maxLength: 160 })),
    leaseMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 24 * 60 * 60_000 })),
  },
  { additionalProperties: false },
);

export const TasksClaimResultSchema = Type.Object(
  {
    task: TaskSchema,
    assignment: TaskAssignmentSchema,
  },
  { additionalProperties: false },
);

export const TasksReleaseParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
    assignmentId: Type.Optional(Type.String({ maxLength: 160 })),
    agentId: Type.Optional(Type.String({ maxLength: 120 })),
    releasedBy: Type.Optional(Type.String({ maxLength: 160 })),
  },
  { additionalProperties: false },
);

export const TasksReleaseResultSchema = Type.Object(
  {
    task: TaskSchema,
    assignment: TaskAssignmentSchema,
  },
  { additionalProperties: false },
);

export const TasksSpawnChildParamsSchema = Type.Object(
  {
    parentTaskId: NonEmptyString,
    kind: Type.Optional(TaskProposalKindSchema),
    title: NonEmptyString,
    summary: Type.Optional(Type.String({ maxLength: 800 })),
    description: Type.Optional(Type.String({ maxLength: 8000 })),
    acceptance: Type.Optional(Type.Array(Type.String({ maxLength: 240 }), { maxItems: 12 })),
    requesterSessionKey: Type.Optional(Type.String({ maxLength: 240 })),
    requestedBy: Type.Optional(Type.String({ maxLength: 160 })),
    ownerAgentId: Type.Optional(Type.String({ maxLength: 120 })),
    orchestratorSessionKey: Type.Optional(Type.String({ maxLength: 240 })),
    status: Type.Optional(CanonicalTaskStatusSchema),
    startExecution: Type.Optional(Type.Boolean()),
    executionKind: Type.Optional(TaskExecutionKindSchema),
    executionSourceId: Type.Optional(Type.String({ maxLength: 240 })),
    executionRunId: Type.Optional(Type.String({ maxLength: 240 })),
    executionSessionKey: Type.Optional(Type.String({ maxLength: 240 })),
    executionAgentId: Type.Optional(Type.String({ maxLength: 120 })),
    executionLabel: Type.Optional(Type.String({ maxLength: 200 })),
    executionSummary: Type.Optional(Type.String({ maxLength: 800 })),
    executionStatus: Type.Optional(Type.Union([Type.Literal("queued"), Type.Literal("running")])),
  },
  { additionalProperties: false },
);

export const TasksSpawnChildResultSchema = Type.Object(
  {
    task: TaskSchema,
    execution: Type.Optional(TaskExecutionSchema),
  },
  { additionalProperties: false },
);

export const TasksExecutionStartParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
    kind: TaskExecutionKindSchema,
    sourceId: Type.Optional(Type.String({ maxLength: 240 })),
    runId: Type.Optional(Type.String({ maxLength: 240 })),
    sessionKey: Type.Optional(Type.String({ maxLength: 240 })),
    agentId: Type.Optional(Type.String({ maxLength: 120 })),
    label: Type.Optional(Type.String({ maxLength: 200 })),
    summary: Type.Optional(Type.String({ maxLength: 800 })),
    status: Type.Optional(Type.Union([Type.Literal("queued"), Type.Literal("running")])),
  },
  { additionalProperties: false },
);

export const TasksExecutionStartResultSchema = Type.Object(
  {
    task: TaskSchema,
    execution: TaskExecutionSchema,
  },
  { additionalProperties: false },
);

export const TasksExecutionEndParamsSchema = Type.Object(
  {
    executionId: NonEmptyString,
    status: Type.Union([
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("timed_out"),
      Type.Literal("lost"),
    ]),
    summary: Type.Optional(Type.String({ maxLength: 800 })),
    error: Type.Optional(Type.String({ maxLength: 800 })),
    terminalOutcome: Type.Optional(TaskTerminalOutcomeSchema),
    endedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const TasksExecutionEndResultSchema = Type.Object(
  {
    task: TaskSchema,
    execution: TaskExecutionSchema,
  },
  { additionalProperties: false },
);

export const TasksExecutionCancelParamsSchema = Type.Object(
  {
    executionId: NonEmptyString,
    reason: Type.Optional(Type.String({ maxLength: 800 })),
    endedAt: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const TasksExecutionCancelResultSchema = Type.Object(
  {
    task: TaskSchema,
    execution: TaskExecutionSchema,
  },
  { additionalProperties: false },
);

export const TasksApprovalRequestParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
    requestedBy: Type.Optional(Type.String({ maxLength: 160 })),
    note: Type.Optional(Type.String({ maxLength: 800 })),
  },
  { additionalProperties: false },
);

export const TasksApprovalRequestResultSchema = Type.Object(
  {
    task: TaskSchema,
    approval: TaskApprovalSchema,
  },
  { additionalProperties: false },
);

export const TasksApprovalDecideParamsSchema = Type.Object(
  {
    approvalId: NonEmptyString,
    decision: Type.Union([
      Type.Literal("approved"),
      Type.Literal("rejected"),
      Type.Literal("cancelled"),
    ]),
    decidedBy: Type.Optional(Type.String({ maxLength: 160 })),
    note: Type.Optional(Type.String({ maxLength: 800 })),
  },
  { additionalProperties: false },
);

export const TasksApprovalDecideResultSchema = Type.Object(
  {
    task: TaskSchema,
    approval: TaskApprovalSchema,
  },
  { additionalProperties: false },
);

export type TaskRuntime = Static<typeof TaskRuntimeSchema>;
export type TaskStatus = Static<typeof TaskStatusSchema>;
export type TaskDeliveryStatus = Static<typeof TaskDeliveryStatusSchema>;
export type TaskNotifyPolicy = Static<typeof TaskNotifyPolicySchema>;
export type TaskTerminalOutcome = Static<typeof TaskTerminalOutcomeSchema>;
export type TaskProposalKind = Static<typeof TaskProposalKindSchema>;
export type TaskProposalDecision = Static<typeof TaskProposalDecisionSchema>;
export type TaskProposalCreatedBy = Static<typeof TaskProposalCreatedBySchema>;
export type TaskStatusCounts = Static<typeof TaskStatusCountsSchema>;
export type TaskRuntimeCounts = Static<typeof TaskRuntimeCountsSchema>;
export type TaskRegistrySummary = Static<typeof TaskRegistrySummarySchema>;
export type TaskProposalSummary = Static<typeof TaskProposalSummarySchema>;
export type TaskRecord = Static<typeof TaskRecordSchema>;
export type TaskProposalRecord = Static<typeof TaskProposalRecordSchema>;
export type TaskAuditSeverity = Static<typeof TaskAuditSeveritySchema>;
export type TaskAuditCode = Static<typeof TaskAuditCodeSchema>;
export type TaskAuditFinding = Static<typeof TaskAuditFindingSchema>;
export type TaskAuditSummary = Static<typeof TaskAuditSummarySchema>;
export type TaskMaintenanceSummary = Static<typeof TaskMaintenanceSummarySchema>;
export type CanonicalTaskSummary = Static<typeof CanonicalTaskSummarySchema>;
export type TasksOverviewParams = Static<typeof TasksOverviewParamsSchema>;
export type TasksOverviewResult = Static<typeof TasksOverviewResultSchema>;
export type TasksDetailParams = Static<typeof TasksDetailParamsSchema>;
export type TasksDetailResult = Static<typeof TasksDetailResultSchema>;
export type TasksCancelParams = Static<typeof TasksCancelParamsSchema>;
export type TasksCancelResult = Static<typeof TasksCancelResultSchema>;
export type TasksNotifyParams = Static<typeof TasksNotifyParamsSchema>;
export type TasksNotifyResult = Static<typeof TasksNotifyResultSchema>;
export type TasksProposalUpsertParams = Static<typeof TasksProposalUpsertParamsSchema>;
export type TasksProposalUpsertResult = Static<typeof TasksProposalUpsertResultSchema>;
export type TasksProposalResolveParams = Static<typeof TasksProposalResolveParamsSchema>;
export type TasksProposalResolveResult = Static<typeof TasksProposalResolveResultSchema>;
export type TasksProposalAttachLaunchParams = Static<typeof TasksProposalAttachLaunchParamsSchema>;
export type TasksProposalAttachLaunchResult = Static<typeof TasksProposalAttachLaunchResultSchema>;
export type TasksLaunchFromProposalParams = Static<typeof TasksLaunchFromProposalParamsSchema>;
export type TasksLaunchFromProposalResult = Static<typeof TasksLaunchFromProposalResultSchema>;
export type CanonicalTaskStatus = Static<typeof CanonicalTaskStatusSchema>;
export type TaskExecutionKind = Static<typeof TaskExecutionKindSchema>;
export type TaskExecutionStatus = Static<typeof TaskExecutionStatusSchema>;
export type TaskExecutionStepKind = Static<typeof TaskExecutionStepKindSchema>;
export type TaskExecutionStepStatus = Static<typeof TaskExecutionStepStatusSchema>;
export type TaskAssignmentStatus = Static<typeof TaskAssignmentStatusSchema>;
export type TaskApprovalStatus = Static<typeof TaskApprovalStatusSchema>;
export type TaskEventKindV2 = Static<typeof TaskEventKindV2Schema>;
export type TaskDependencyKind = Static<typeof TaskDependencyKindSchema>;
export type Task = Static<typeof TaskSchema>;
export type TaskExecution = Static<typeof TaskExecutionSchema>;
export type TaskExecutionStep = Static<typeof TaskExecutionStepSchema>;
export type TaskAssignment = Static<typeof TaskAssignmentSchema>;
export type TaskApproval = Static<typeof TaskApprovalSchema>;
export type TaskEvent = Static<typeof TaskEventSchema>;
export type TaskDependency = Static<typeof TaskDependencySchema>;
export type TasksCreateParams = Static<typeof TasksCreateParamsSchema>;
export type TasksCreateResult = Static<typeof TasksCreateResultSchema>;
export type TasksUpdateParams = Static<typeof TasksUpdateParamsSchema>;
export type TasksUpdateResult = Static<typeof TasksUpdateResultSchema>;
export type TasksClaimParams = Static<typeof TasksClaimParamsSchema>;
export type TasksClaimResult = Static<typeof TasksClaimResultSchema>;
export type TasksReleaseParams = Static<typeof TasksReleaseParamsSchema>;
export type TasksReleaseResult = Static<typeof TasksReleaseResultSchema>;
export type TasksSpawnChildParams = Static<typeof TasksSpawnChildParamsSchema>;
export type TasksSpawnChildResult = Static<typeof TasksSpawnChildResultSchema>;
export type TasksExecutionStartParams = Static<typeof TasksExecutionStartParamsSchema>;
export type TasksExecutionStartResult = Static<typeof TasksExecutionStartResultSchema>;
export type TasksExecutionEndParams = Static<typeof TasksExecutionEndParamsSchema>;
export type TasksExecutionEndResult = Static<typeof TasksExecutionEndResultSchema>;
export type TasksExecutionCancelParams = Static<typeof TasksExecutionCancelParamsSchema>;
export type TasksExecutionCancelResult = Static<typeof TasksExecutionCancelResultSchema>;
export type TasksApprovalRequestParams = Static<typeof TasksApprovalRequestParamsSchema>;
export type TasksApprovalRequestResult = Static<typeof TasksApprovalRequestResultSchema>;
export type TasksApprovalDecideParams = Static<typeof TasksApprovalDecideParamsSchema>;
export type TasksApprovalDecideResult = Static<typeof TasksApprovalDecideResultSchema>;
