import type { ErrorObject } from "ajv";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { respondInvalidParams } from "./nodes.helpers.js";
import type { GatewayRequestContext, GatewayRequestHandler } from "./types.js";

type ValidatorFn = ((value: unknown) => boolean) & {
  errors?: ErrorObject[] | null;
};

type BaseNodeResultParams = {
  nodeId: string;
  ok: boolean;
  payload?: unknown;
  payloadJSON?: string | null;
  error?: { code?: string; message?: string } | null;
};

type NodeResultHandlerConfig<TParams extends BaseNodeResultParams> = {
  method: string;
  validator: ValidatorFn;
  resultKind: string;
  getId: (params: TParams) => string;
  handleResult: (context: GatewayRequestContext, params: TParams) => boolean;
};

export function normalizeNodeResultParams(params: unknown): unknown {
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

export function createNodeResultHandler<TParams extends BaseNodeResultParams>(
  config: NodeResultHandlerConfig<TParams>,
): GatewayRequestHandler {
  return async ({ params, respond, context, client }) => {
    const normalizedParams = normalizeNodeResultParams(params);
    if (!config.validator(normalizedParams)) {
      respondInvalidParams({
        respond,
        method: config.method,
        validator: config.validator,
      });
      return;
    }

    const parsedParams = normalizedParams as TParams;
    const callerNodeId = client?.connect?.device?.id ?? client?.connect?.client?.id;
    if (callerNodeId && callerNodeId !== parsedParams.nodeId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "nodeId mismatch"));
      return;
    }

    const ok = config.handleResult(context, parsedParams);
    if (!ok) {
      context.logGateway.debug(
        `late ${config.resultKind} ignored: id=${config.getId(parsedParams)} node=${parsedParams.nodeId}`,
      );
      respond(true, { ok: true, ignored: true }, undefined);
      return;
    }

    respond(true, { ok: true }, undefined);
  };
}
