import { Type } from "@sinclair/typebox";
import {
  PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH,
  PLUGIN_APPROVAL_TITLE_MAX_LENGTH,
} from "../../../infra/plugin-approvals.js";
import { NonEmptyString } from "./primitives.js";

export const ApprovalAuditDecisionSchema = Type.String({
  enum: ["allow-once", "allow-always", "deny"],
});

export const ApprovalAuditGetParamsSchema = Type.Object({}, { additionalProperties: false });
export const ApprovalPendingGetParamsSchema = Type.Object({}, { additionalProperties: false });

export const ApprovalAuditExecRequestSchema = Type.Object(
  {
    command: NonEmptyString,
    commandPreview: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    envKeys: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
    host: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    nodeId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    security: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    ask: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    agentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sessionKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    cwd: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    resolvedPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
);

export const ApprovalAuditPluginRequestSchema = Type.Object(
  {
    pluginId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    title: Type.String({ minLength: 1, maxLength: PLUGIN_APPROVAL_TITLE_MAX_LENGTH }),
    description: Type.String({ minLength: 1, maxLength: PLUGIN_APPROVAL_DESCRIPTION_MAX_LENGTH }),
    severity: Type.Optional(
      Type.Union([Type.String({ enum: ["info", "warning", "critical"] }), Type.Null()]),
    ),
    toolName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    toolCallId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    agentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    sessionKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceChannel: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceTo: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceAccountId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    turnSourceThreadId: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Null()])),
  },
  { additionalProperties: false },
);

export const ApprovalAuditExecEntrySchema = Type.Object(
  {
    kind: Type.Literal("exec"),
    id: NonEmptyString,
    decision: ApprovalAuditDecisionSchema,
    resolvedBy: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    ts: Type.Integer({ minimum: 1 }),
    request: ApprovalAuditExecRequestSchema,
  },
  { additionalProperties: false },
);

export const ApprovalAuditPluginEntrySchema = Type.Object(
  {
    kind: Type.Literal("plugin"),
    id: NonEmptyString,
    decision: ApprovalAuditDecisionSchema,
    resolvedBy: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    ts: Type.Integer({ minimum: 1 }),
    request: ApprovalAuditPluginRequestSchema,
  },
  { additionalProperties: false },
);

export const ApprovalAuditEntrySchema = Type.Union([
  ApprovalAuditExecEntrySchema,
  ApprovalAuditPluginEntrySchema,
]);

export const ApprovalAuditSnapshotSchema = Type.Object(
  {
    items: Type.Array(ApprovalAuditEntrySchema),
  },
  { additionalProperties: false },
);

export const ApprovalPendingExecEntrySchema = Type.Object(
  {
    kind: Type.Literal("exec"),
    id: NonEmptyString,
    createdAtMs: Type.Integer({ minimum: 1 }),
    expiresAtMs: Type.Integer({ minimum: 1 }),
    request: ApprovalAuditExecRequestSchema,
  },
  { additionalProperties: false },
);

export const ApprovalPendingPluginEntrySchema = Type.Object(
  {
    kind: Type.Literal("plugin"),
    id: NonEmptyString,
    createdAtMs: Type.Integer({ minimum: 1 }),
    expiresAtMs: Type.Integer({ minimum: 1 }),
    request: ApprovalAuditPluginRequestSchema,
  },
  { additionalProperties: false },
);

export const ApprovalPendingEntrySchema = Type.Union([
  ApprovalPendingExecEntrySchema,
  ApprovalPendingPluginEntrySchema,
]);

export const ApprovalPendingSnapshotSchema = Type.Object(
  {
    items: Type.Array(ApprovalPendingEntrySchema),
  },
  { additionalProperties: false },
);
