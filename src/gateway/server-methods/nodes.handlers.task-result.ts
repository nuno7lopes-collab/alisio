import { ErrorCodes, errorShape, validateNodeTaskResultParams } from "../protocol/index.js";
import { respondInvalidParams } from "./nodes.helpers.js";
import type { GatewayRequestHandler } from "./types.js";

function normalizeNodeTaskResultParams(params: unknown): unknown {
  if (!params || typeof params !== "object") {
    return params;
  }
  const raw = params as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...raw };
  if (normalized.payloadJSON === null) {
    delete normalized.payloadJSON;
  } else if (normalized.payloadJSON !== undefined && typeof normalized.payloadJSON !== "string") {
    if (normalized.payload === undefined) {
      normalized.payload = normalized.payloadJSON;
    }
    delete normalized.payloadJSON;
  }
  if (normalized.error === null) {
    delete normalized.error;
  }
  return normalized;
}

export const handleNodeTaskResult: GatewayRequestHandler = async ({
  params,
  respond,
  context,
  client,
}) => {
  const normalizedParams = normalizeNodeTaskResultParams(params);
  if (!validateNodeTaskResultParams(normalizedParams)) {
    respondInvalidParams({
      respond,
      method: "node.task.result",
      validator: validateNodeTaskResultParams,
    });
    return;
  }
  const p = normalizedParams as {
    taskId: string;
    nodeId: string;
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string | null;
    error?: { code?: string; message?: string } | null;
  };
  const callerNodeId = client?.connect?.device?.id ?? client?.connect?.client?.id;
  if (callerNodeId && callerNodeId !== p.nodeId) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "nodeId mismatch"));
    return;
  }

  const ok = context.nodeRegistry.handleTaskResult({
    taskId: p.taskId,
    nodeId: p.nodeId,
    ok: p.ok,
    payload: p.payload,
    payloadJSON: p.payloadJSON ?? null,
    error: p.error ?? null,
  });
  if (!ok) {
    context.logGateway.debug(`late task result ignored: id=${p.taskId} node=${p.nodeId}`);
    respond(true, { ok: true, ignored: true }, undefined);
    return;
  }

  respond(true, { ok: true }, undefined);
};
