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

export const TasksOverviewResultSchema = Type.Object(
  {
    summary: TaskRegistrySummarySchema,
    filteredSummary: TaskRegistrySummarySchema,
    audit: TaskAuditSummarySchema,
    findings: Type.Array(TaskAuditFindingSchema),
    maintenance: TaskMaintenanceSummarySchema,
    tasks: Type.Array(TaskRecordSchema),
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

export const TasksCancelParamsSchema = Type.Object(
  {
    lookup: NonEmptyString,
  },
  { additionalProperties: false },
);

export const TasksCancelResultSchema = Type.Object(
  {
    found: Type.Boolean(),
    cancelled: Type.Boolean(),
    reason: Type.Optional(Type.String()),
    task: Type.Optional(TaskRecordSchema),
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

export type TaskRuntime = Static<typeof TaskRuntimeSchema>;
export type TaskStatus = Static<typeof TaskStatusSchema>;
export type TaskDeliveryStatus = Static<typeof TaskDeliveryStatusSchema>;
export type TaskNotifyPolicy = Static<typeof TaskNotifyPolicySchema>;
export type TaskTerminalOutcome = Static<typeof TaskTerminalOutcomeSchema>;
export type TaskStatusCounts = Static<typeof TaskStatusCountsSchema>;
export type TaskRuntimeCounts = Static<typeof TaskRuntimeCountsSchema>;
export type TaskRegistrySummary = Static<typeof TaskRegistrySummarySchema>;
export type TaskRecord = Static<typeof TaskRecordSchema>;
export type TaskAuditSeverity = Static<typeof TaskAuditSeveritySchema>;
export type TaskAuditCode = Static<typeof TaskAuditCodeSchema>;
export type TaskAuditFinding = Static<typeof TaskAuditFindingSchema>;
export type TaskAuditSummary = Static<typeof TaskAuditSummarySchema>;
export type TaskMaintenanceSummary = Static<typeof TaskMaintenanceSummarySchema>;
export type TasksOverviewParams = Static<typeof TasksOverviewParamsSchema>;
export type TasksOverviewResult = Static<typeof TasksOverviewResultSchema>;
export type TasksCancelParams = Static<typeof TasksCancelParamsSchema>;
export type TasksCancelResult = Static<typeof TasksCancelResultSchema>;
export type TasksNotifyParams = Static<typeof TasksNotifyParamsSchema>;
export type TasksNotifyResult = Static<typeof TasksNotifyResultSchema>;
