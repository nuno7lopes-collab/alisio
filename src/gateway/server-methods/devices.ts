import { clearAlisioModelProviderSnapshotCache } from "../../infra/alisio-model-snapshot.js";
import {
  AlisioAccountValidationError,
  approveAlisioSharingRequest,
  getAlisioAccountState,
  getAlisioSharingState,
  rejectAlisioSharingRequest,
  requestAlisioSharingAccess,
  revokeAlisioSharingGrant,
  setAlisioSharingPolicy,
} from "../../infra/alisio-store.js";
import {
  approveDevicePairing,
  getPairedDevice,
  listDevicePairing,
  removePairedDevice,
  type DeviceAuthToken,
  type RotateDeviceTokenDenyReason,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
  summarizeDeviceTokens,
} from "../../infra/device-pairing.js";
import { normalizeDeviceAuthScopes } from "../../shared/device-auth.js";
import { resolveMissingRequestedScope } from "../../shared/operator-scope-compat.js";
import { createKnownNodeCatalog, listKnownNodes } from "../node-catalog.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateDevicePairApproveParams,
  validateDevicePairListParams,
  validateDevicePairRemoveParams,
  validateDevicePairRejectParams,
  validateDevicesListParams,
  validateDevicesListResult,
  validateDevicesPolicySetParams,
  validateDevicesPolicySetResult,
  validateDevicesShareApproveParams,
  validateDevicesShareApproveResult,
  validateDevicesShareRequestParams,
  validateDevicesShareRequestResult,
  validateDevicesShareRevokeParams,
  validateDevicesShareRevokeResult,
  validateDeviceTokenRevokeParams,
  validateDeviceTokenRotateParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const DEVICE_TOKEN_ROTATION_DENIED_MESSAGE = "device token rotation denied";

function redactPairedDevice(
  device: { tokens?: Record<string, DeviceAuthToken> } & Record<string, unknown>,
) {
  const { tokens, approvedScopes: _approvedScopes, ...rest } = device;
  return {
    ...rest,
    tokens: summarizeDeviceTokens(tokens),
  };
}

function logDeviceTokenRotationDenied(params: {
  log: { warn: (message: string) => void };
  deviceId: string;
  role: string;
  reason: RotateDeviceTokenDenyReason | "caller-missing-scope" | "unknown-device-or-role";
  scope?: string | null;
}) {
  const suffix = params.scope ? ` scope=${params.scope}` : "";
  params.log.warn(
    `device token rotation denied device=${params.deviceId} role=${params.role} reason=${params.reason}${suffix}`,
  );
}

async function loadSharingStateForContext(
  context: Parameters<GatewayRequestHandlers[string]>[0]["context"],
) {
  const account = await getAlisioAccountState();
  const currentDevice = account.devices.find((device) => device.current) ?? account.devices[0];
  const pairing = await listDevicePairing();
  const catalog = createKnownNodeCatalog({
    pairedDevices: pairing.paired,
    connectedNodes: context.nodeRegistry.listConnected(),
  });
  const knownNodes = listKnownNodes(catalog);
  return await getAlisioSharingState({
    targets: [
      ...(currentDevice
        ? [
            {
              targetId: currentDevice.id,
              computerId: currentDevice.id,
              computerLabel: currentDevice.label,
              label: currentDevice.label,
              platform: currentDevice.platform,
              sourceKind: "current" as const,
              connected: true,
              current: true,
            },
          ]
        : []),
      ...knownNodes.map((node) => ({
        targetId: node.nodeId,
        computerId: node.computerId ?? node.nodeId,
        computerLabel: node.computerLabel ?? node.displayName ?? node.nodeId,
        label: node.displayName ?? node.nodeId,
        platform: node.platform,
        sourceKind: "node" as const,
        connected: node.connected === true,
        current: false,
      })),
    ],
  });
}

function respondFromIdempotencyCache(params: {
  context: Parameters<GatewayRequestHandlers[string]>[0]["context"];
  key: string;
  respond: Parameters<GatewayRequestHandlers[string]>[0]["respond"];
}) {
  const cached = params.context.dedupe.get(params.key);
  if (!cached) {
    return false;
  }
  params.respond(cached.ok, cached.payload, cached.error, { cached: true });
  return true;
}

function rememberIdempotencyResult(params: {
  context: Parameters<GatewayRequestHandlers[string]>[0]["context"];
  key: string;
  ok: boolean;
  payload?: unknown;
  error?: ReturnType<typeof errorShape>;
}) {
  params.context.dedupe.set(params.key, {
    ts: Date.now(),
    ok: params.ok,
    ...(params.payload !== undefined ? { payload: params.payload } : {}),
    ...(params.error ? { error: params.error } : {}),
  });
}

function broadcastDevicesChanged(params: {
  context: Parameters<GatewayRequestHandlers[string]>[0]["context"];
  reason: "share.request" | "share.approve" | "share.revoke" | "policy.set";
  targetId?: string;
}) {
  params.context.broadcast?.(
    "devices.changed",
    {
      reason: params.reason,
      targetId: params.targetId ?? null,
      ts: Date.now(),
    },
    { dropIfSlow: true },
  );
}

export const deviceHandlers: GatewayRequestHandlers = {
  "device.pair.list": async ({ params, respond }) => {
    if (!validateDevicePairListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.pair.list params: ${formatValidationErrors(
            validateDevicePairListParams.errors,
          )}`,
        ),
      );
      return;
    }
    const list = await listDevicePairing();
    respond(
      true,
      {
        pending: list.pending,
        paired: list.paired.map((device) => redactPairedDevice(device)),
      },
      undefined,
    );
  },
  "devices.list": async ({ params, respond, context }) => {
    if (!validateDevicesListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid devices.list params: ${formatValidationErrors(validateDevicesListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const result = await loadSharingStateForContext(context);
      if (!validateDevicesListResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid devices.list result: ${formatValidationErrors(validateDevicesListResult.errors)}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "devices.share.request": async ({ params, respond, context }) => {
    if (!validateDevicesShareRequestParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid devices.share.request params: ${formatValidationErrors(
            validateDevicesShareRequestParams.errors,
          )}`,
        ),
      );
      return;
    }
    const requestParams = params as {
      targetId: string;
      scopes?: string[];
      idempotencyKey: string;
    };
    const dedupeKey = `devices.share.request:${requestParams.idempotencyKey}`;
    if (respondFromIdempotencyCache({ context, key: dedupeKey, respond })) {
      return;
    }
    try {
      const result = await requestAlisioSharingAccess({
        targetId: requestParams.targetId,
        scopes: requestParams.scopes as never,
      });
      if (!validateDevicesShareRequestResult(result)) {
        const error = errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid devices.share.request result: ${formatValidationErrors(
            validateDevicesShareRequestResult.errors,
          )}`,
        );
        rememberIdempotencyResult({ context, key: dedupeKey, ok: false, error });
        respond(false, undefined, error);
        return;
      }
      rememberIdempotencyResult({ context, key: dedupeKey, ok: true, payload: result });
      broadcastDevicesChanged({
        context,
        reason: "share.request",
        targetId: requestParams.targetId,
      });
      respond(true, result, undefined);
    } catch (err) {
      const error =
        err instanceof AlisioAccountValidationError
          ? errorShape(ErrorCodes.INVALID_REQUEST, err.message)
          : errorShape(ErrorCodes.UNAVAILABLE, String(err));
      rememberIdempotencyResult({ context, key: dedupeKey, ok: false, error });
      respond(false, undefined, error);
    }
  },
  "devices.share.approve": async ({ params, respond, context }) => {
    if (!validateDevicesShareApproveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid devices.share.approve params: ${formatValidationErrors(
            validateDevicesShareApproveParams.errors,
          )}`,
        ),
      );
      return;
    }
    const requestParams = params as {
      requestId: string;
      scopes?: string[];
      decision?: "approved" | "denied";
      idempotencyKey: string;
    };
    const dedupeKey = `devices.share.approve:${requestParams.idempotencyKey}`;
    if (respondFromIdempotencyCache({ context, key: dedupeKey, respond })) {
      return;
    }
    try {
      const payload =
        requestParams.decision === "denied"
          ? (() => {
              return rejectAlisioSharingRequest({
                requestId: requestParams.requestId,
              }).then((rejected) => ({
                ok: true as const,
                requestId: rejected.requestId,
                status: "denied" as const,
              }));
            })()
          : approveAlisioSharingRequest({
              requestId: requestParams.requestId,
              scopes: requestParams.scopes as never,
            }).then((approved) => ({
              ok: true as const,
              requestId: approved.requestId,
              status: "approved" as const,
              grantId: approved.grantId,
            }));
      const result = await payload;
      if (!validateDevicesShareApproveResult(result)) {
        const error = errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid devices.share.approve result: ${formatValidationErrors(
            validateDevicesShareApproveResult.errors,
          )}`,
        );
        rememberIdempotencyResult({ context, key: dedupeKey, ok: false, error });
        respond(false, undefined, error);
        return;
      }
      if (result.status === "approved") {
        clearAlisioModelProviderSnapshotCache();
      }
      rememberIdempotencyResult({ context, key: dedupeKey, ok: true, payload: result });
      broadcastDevicesChanged({
        context,
        reason: "share.approve",
      });
      respond(true, result, undefined);
    } catch (err) {
      const error =
        err instanceof AlisioAccountValidationError
          ? errorShape(ErrorCodes.INVALID_REQUEST, err.message)
          : errorShape(ErrorCodes.UNAVAILABLE, String(err));
      rememberIdempotencyResult({ context, key: dedupeKey, ok: false, error });
      respond(false, undefined, error);
    }
  },
  "devices.share.revoke": async ({ params, respond, context }) => {
    if (!validateDevicesShareRevokeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid devices.share.revoke params: ${formatValidationErrors(
            validateDevicesShareRevokeParams.errors,
          )}`,
        ),
      );
      return;
    }
    const requestParams = params as {
      grantId?: string;
      idempotencyKey: string;
    };
    const grantId = requestParams.grantId?.trim() || "";
    if (!grantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "grantId is required"));
      return;
    }
    const dedupeKey = `devices.share.revoke:${requestParams.idempotencyKey}`;
    if (respondFromIdempotencyCache({ context, key: dedupeKey, respond })) {
      return;
    }
    try {
      const revoked = await revokeAlisioSharingGrant({ grantId });
      const result = {
        ok: true as const,
        grantId: revoked.grantId,
        targetId: revoked.targetId,
      };
      if (!validateDevicesShareRevokeResult(result)) {
        const error = errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid devices.share.revoke result: ${formatValidationErrors(
            validateDevicesShareRevokeResult.errors,
          )}`,
        );
        rememberIdempotencyResult({ context, key: dedupeKey, ok: false, error });
        respond(false, undefined, error);
        return;
      }
      clearAlisioModelProviderSnapshotCache();
      rememberIdempotencyResult({ context, key: dedupeKey, ok: true, payload: result });
      broadcastDevicesChanged({
        context,
        reason: "share.revoke",
        targetId: revoked.targetId,
      });
      respond(true, result, undefined);
    } catch (err) {
      const error =
        err instanceof AlisioAccountValidationError
          ? errorShape(ErrorCodes.INVALID_REQUEST, err.message)
          : errorShape(ErrorCodes.UNAVAILABLE, String(err));
      rememberIdempotencyResult({ context, key: dedupeKey, ok: false, error });
      respond(false, undefined, error);
    }
  },
  "devices.policy.set": async ({ params, respond, context }) => {
    if (!validateDevicesPolicySetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid devices.policy.set params: ${formatValidationErrors(
            validateDevicesPolicySetParams.errors,
          )}`,
        ),
      );
      return;
    }
    const requestParams = params as {
      allowExternalUse?: boolean;
      resourcePolicies?: Record<string, string>;
      idempotencyKey: string;
    };
    const dedupeKey = `devices.policy.set:${requestParams.idempotencyKey}`;
    if (respondFromIdempotencyCache({ context, key: dedupeKey, respond })) {
      return;
    }
    try {
      const result = await setAlisioSharingPolicy({
        ...(requestParams.allowExternalUse !== undefined
          ? { allowExternalUse: requestParams.allowExternalUse }
          : {}),
        ...(requestParams.resourcePolicies
          ? { resourcePolicies: requestParams.resourcePolicies }
          : {}),
      });
      if (!validateDevicesPolicySetResult(result)) {
        const error = errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid devices.policy.set result: ${formatValidationErrors(
            validateDevicesPolicySetResult.errors,
          )}`,
        );
        rememberIdempotencyResult({ context, key: dedupeKey, ok: false, error });
        respond(false, undefined, error);
        return;
      }
      clearAlisioModelProviderSnapshotCache();
      rememberIdempotencyResult({ context, key: dedupeKey, ok: true, payload: result });
      broadcastDevicesChanged({
        context,
        reason: "policy.set",
      });
      respond(true, result, undefined);
    } catch (err) {
      const error =
        err instanceof AlisioAccountValidationError
          ? errorShape(ErrorCodes.INVALID_REQUEST, err.message)
          : errorShape(ErrorCodes.UNAVAILABLE, String(err));
      rememberIdempotencyResult({ context, key: dedupeKey, ok: false, error });
      respond(false, undefined, error);
    }
  },
  "device.pair.approve": async ({ params, respond, context, client }) => {
    if (!validateDevicePairApproveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.pair.approve params: ${formatValidationErrors(
            validateDevicePairApproveParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { requestId } = params as { requestId: string };
    const callerScopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
    const approved = await approveDevicePairing(requestId, { callerScopes });
    if (!approved) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"));
      return;
    }
    if (approved.status === "forbidden") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `missing scope: ${approved.missingScope}`),
      );
      return;
    }
    context.logGateway.info(
      `device pairing approved device=${approved.device.deviceId} role=${approved.device.role ?? "unknown"}`,
    );
    context.broadcast(
      "device.pair.resolved",
      {
        requestId,
        deviceId: approved.device.deviceId,
        decision: "approved",
        ts: Date.now(),
      },
      { dropIfSlow: true },
    );
    respond(true, { requestId, device: redactPairedDevice(approved.device) }, undefined);
  },
  "device.pair.reject": async ({ params, respond, context }) => {
    if (!validateDevicePairRejectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.pair.reject params: ${formatValidationErrors(
            validateDevicePairRejectParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { requestId } = params as { requestId: string };
    const rejected = await rejectDevicePairing(requestId);
    if (!rejected) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"));
      return;
    }
    context.broadcast(
      "device.pair.resolved",
      {
        requestId,
        deviceId: rejected.deviceId,
        decision: "rejected",
        ts: Date.now(),
      },
      { dropIfSlow: true },
    );
    respond(true, rejected, undefined);
  },
  "device.pair.remove": async ({ params, respond, context }) => {
    if (!validateDevicePairRemoveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.pair.remove params: ${formatValidationErrors(
            validateDevicePairRemoveParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { deviceId } = params as { deviceId: string };
    const removed = await removePairedDevice(deviceId);
    if (!removed) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown deviceId"));
      return;
    }
    context.logGateway.info(`device pairing removed device=${removed.deviceId}`);
    respond(true, removed, undefined);
    queueMicrotask(() => {
      context.disconnectClientsForDevice?.(removed.deviceId);
    });
  },
  "device.token.rotate": async ({ params, respond, context, client }) => {
    if (!validateDeviceTokenRotateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.token.rotate params: ${formatValidationErrors(
            validateDeviceTokenRotateParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { deviceId, role, scopes } = params as {
      deviceId: string;
      role: string;
      scopes?: string[];
    };
    const pairedDevice = await getPairedDevice(deviceId);
    if (!pairedDevice) {
      logDeviceTokenRotationDenied({
        log: context.logGateway,
        deviceId,
        role,
        reason: "unknown-device-or-role",
      });
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, DEVICE_TOKEN_ROTATION_DENIED_MESSAGE),
      );
      return;
    }
    const callerScopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
    const requestedScopes = normalizeDeviceAuthScopes(
      scopes ?? pairedDevice.tokens?.[role.trim()]?.scopes ?? pairedDevice.scopes,
    );
    const missingScope = resolveMissingRequestedScope({
      role,
      requestedScopes,
      allowedScopes: callerScopes,
    });
    if (missingScope) {
      logDeviceTokenRotationDenied({
        log: context.logGateway,
        deviceId,
        role,
        reason: "caller-missing-scope",
        scope: missingScope,
      });
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, DEVICE_TOKEN_ROTATION_DENIED_MESSAGE),
      );
      return;
    }
    const rotated = await rotateDeviceToken({ deviceId, role, scopes });
    if (!rotated.ok) {
      logDeviceTokenRotationDenied({
        log: context.logGateway,
        deviceId,
        role,
        reason: rotated.reason,
      });
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, DEVICE_TOKEN_ROTATION_DENIED_MESSAGE),
      );
      return;
    }
    const entry = rotated.entry;
    context.logGateway.info(
      `device token rotated device=${deviceId} role=${entry.role} scopes=${entry.scopes.join(",")}`,
    );
    respond(
      true,
      {
        deviceId,
        role: entry.role,
        token: entry.token,
        scopes: entry.scopes,
        rotatedAtMs: entry.rotatedAtMs ?? entry.createdAtMs,
      },
      undefined,
    );
  },
  "device.token.revoke": async ({ params, respond, context }) => {
    if (!validateDeviceTokenRevokeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid device.token.revoke params: ${formatValidationErrors(
            validateDeviceTokenRevokeParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { deviceId, role } = params as { deviceId: string; role: string };
    const entry = await revokeDeviceToken({ deviceId, role });
    if (!entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown deviceId/role"));
      return;
    }
    const normalizedDeviceId = deviceId.trim();
    context.logGateway.info(`device token revoked device=${normalizedDeviceId} role=${entry.role}`);
    respond(
      true,
      {
        deviceId: normalizedDeviceId,
        role: entry.role,
        revokedAtMs: entry.revokedAtMs ?? Date.now(),
      },
      undefined,
    );
    queueMicrotask(() => {
      context.disconnectClientsForDevice?.(normalizedDeviceId, { role: entry.role });
    });
  },
};
