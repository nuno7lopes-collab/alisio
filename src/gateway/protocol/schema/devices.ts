import { Type } from "@sinclair/typebox";
import { AlisioSharingStateSchema } from "./alisio.js";
import { NonEmptyString } from "./primitives.js";

export const DevicePairListParamsSchema = Type.Object({}, { additionalProperties: false });

export const DevicePairApproveParamsSchema = Type.Object(
  { requestId: NonEmptyString },
  { additionalProperties: false },
);

export const DevicePairRejectParamsSchema = Type.Object(
  { requestId: NonEmptyString },
  { additionalProperties: false },
);

export const DevicePairRemoveParamsSchema = Type.Object(
  { deviceId: NonEmptyString },
  { additionalProperties: false },
);

export const DeviceTokenRotateParamsSchema = Type.Object(
  {
    deviceId: NonEmptyString,
    role: NonEmptyString,
    scopes: Type.Optional(Type.Array(NonEmptyString)),
  },
  { additionalProperties: false },
);

export const DeviceTokenRevokeParamsSchema = Type.Object(
  {
    deviceId: NonEmptyString,
    role: NonEmptyString,
  },
  { additionalProperties: false },
);

const DeviceShareScopeSchema = Type.Union([
  Type.Literal("read-only"),
  Type.Literal("model-use"),
  Type.Literal("exec"),
]);

const DeviceShareDecisionSchema = Type.Union([Type.Literal("approved"), Type.Literal("denied")]);

export const DevicesListParamsSchema = Type.Object({}, { additionalProperties: false });

export const DevicesListResultSchema = AlisioSharingStateSchema;

export const DevicesShareRequestParamsSchema = Type.Object(
  {
    targetId: NonEmptyString,
    scopes: Type.Optional(Type.Array(DeviceShareScopeSchema)),
    idempotencyKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const DevicesShareRequestResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    requestId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const DevicesShareApproveParamsSchema = Type.Object(
  {
    requestId: NonEmptyString,
    decision: Type.Optional(DeviceShareDecisionSchema),
    idempotencyKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const DevicesShareApproveResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    requestId: NonEmptyString,
    status: DeviceShareDecisionSchema,
    approvalId: Type.Optional(NonEmptyString),
    grantId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const DevicesShareRevokeParamsSchema = Type.Object(
  {
    approvalId: NonEmptyString,
    idempotencyKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const DevicesShareRevokeResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    approvalId: NonEmptyString,
    grantId: NonEmptyString,
    targetId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const DevicesPolicySetParamsSchema = Type.Object(
  {
    allowExternalUse: Type.Boolean(),
    idempotencyKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const DevicesPolicySetResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    allowExternalUse: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const DevicePairRequestedEventSchema = Type.Object(
  {
    requestId: NonEmptyString,
    deviceId: NonEmptyString,
    publicKey: NonEmptyString,
    displayName: Type.Optional(NonEmptyString),
    platform: Type.Optional(NonEmptyString),
    deviceFamily: Type.Optional(NonEmptyString),
    clientId: Type.Optional(NonEmptyString),
    clientMode: Type.Optional(NonEmptyString),
    role: Type.Optional(NonEmptyString),
    roles: Type.Optional(Type.Array(NonEmptyString)),
    scopes: Type.Optional(Type.Array(NonEmptyString)),
    remoteIp: Type.Optional(NonEmptyString),
    silent: Type.Optional(Type.Boolean()),
    isRepair: Type.Optional(Type.Boolean()),
    ts: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const DevicePairResolvedEventSchema = Type.Object(
  {
    requestId: NonEmptyString,
    deviceId: NonEmptyString,
    decision: NonEmptyString,
    ts: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
