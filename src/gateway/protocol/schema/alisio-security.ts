import { Type } from "@sinclair/typebox";
import { ApprovalAuditSnapshotSchema, ApprovalPendingSnapshotSchema } from "./approval-audit.js";

const ExecSecuritySchema = Type.Union([
  Type.Literal("deny"),
  Type.Literal("allowlist"),
  Type.Literal("full"),
]);

const ExecAskSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("on-miss"),
  Type.Literal("always"),
]);

export const AlisioSecurityAccessModeSchema = Type.Union([
  Type.Literal("recommended"),
  Type.Literal("full-access"),
  Type.Literal("custom"),
]);

export const AlisioSecurityAccessProfileSchema = Type.Union([
  Type.Literal("recommended"),
  Type.Literal("full-access"),
]);

export const AlisioSecurityConfigDefaultsSchema = Type.Object(
  {
    security: ExecSecuritySchema,
    ask: ExecAskSchema,
  },
  { additionalProperties: false },
);

export const AlisioSecurityApprovalDefaultsSchema = Type.Object(
  {
    security: ExecSecuritySchema,
    ask: ExecAskSchema,
    askFallback: ExecSecuritySchema,
    autoAllowSkills: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AlisioSecurityPolicyDiagnosticsSchema = Type.Object(
  {
    mode: AlisioSecurityAccessModeSchema,
    effectivePromptAsk: ExecAskSchema,
    configDefaults: AlisioSecurityConfigDefaultsSchema,
    approvalDefaults: AlisioSecurityApprovalDefaultsSchema,
    configOverrideAgentCount: Type.Integer({ minimum: 0 }),
    approvalOverrideAgentCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const AlisioSecurityPolicyConfigSourceSchema = Type.Object(
  {
    path: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    exists: Type.Boolean(),
    hash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
);

export const AlisioSecurityPolicyApprovalsSourceSchema = Type.Object(
  {
    path: Type.String(),
    exists: Type.Boolean(),
    hash: Type.String(),
  },
  { additionalProperties: false },
);

export const AlisioSecurityPolicyGetParamsSchema = Type.Object({}, { additionalProperties: false });

export const AlisioSecurityPolicySnapshotSchema = Type.Object(
  {
    target: Type.Literal("gateway"),
    diagnostics: AlisioSecurityPolicyDiagnosticsSchema,
    configSource: AlisioSecurityPolicyConfigSourceSchema,
    approvalsSource: AlisioSecurityPolicyApprovalsSourceSchema,
    pending: ApprovalPendingSnapshotSchema,
    audit: ApprovalAuditSnapshotSchema,
  },
  { additionalProperties: false },
);

export const AlisioSecurityPolicyApplyProfileParamsSchema = Type.Object(
  {
    profile: AlisioSecurityAccessProfileSchema,
  },
  { additionalProperties: false },
);

export const AlisioSecurityPolicyApplyProfileResultSchema = Type.Object(
  {
    changed: Type.Boolean(),
    snapshot: AlisioSecurityPolicySnapshotSchema,
  },
  { additionalProperties: false },
);
