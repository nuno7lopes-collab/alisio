import type { GatewayRequestHandlerOptions } from "alisio/plugin-sdk/core";
import { getMemoryJobsController, resolveMemoryJobsAgentId } from "./runtime.js";

export { primeMemoryJobsRuntime } from "./runtime.js";

type GatewayHandler = (opts: GatewayRequestHandlerOptions) => Promise<void> | void;

function respondGatewayError(
  respond: GatewayRequestHandlerOptions["respond"],
  code: string,
  message: string,
) {
  respond(false, undefined, { code, message });
}

function resolveAgentId(params: GatewayRequestHandlerOptions["params"]): string | null {
  const agentId = resolveMemoryJobsAgentId(params.agentId);
  return agentId.trim() ? agentId : null;
}

export function withMemoryJobsGatewayActivity(handler: GatewayHandler): GatewayHandler {
  return async (opts) => {
    const agentId = resolveMemoryJobsAgentId(opts.params.agentId);
    getMemoryJobsController(agentId).noteGatewayRequest();
    await handler(opts);
  };
}

export async function handleMemoryJobsStatusGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const agentId = resolveAgentId(params);
  if (!agentId) {
    respondGatewayError(respond, "INVALID_REQUEST", "memory.jobs.status requires agentId");
    return;
  }
  const controller = getMemoryJobsController(agentId);
  controller.noteGatewayRequest();
  try {
    respond(true, controller.getStatus(), undefined);
  } catch (error) {
    respondGatewayError(
      respond,
      "UNAVAILABLE",
      `memory.jobs.status failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function handleMemoryJobsRunOnceGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const agentId = resolveAgentId(params);
  if (!agentId) {
    respondGatewayError(respond, "INVALID_REQUEST", "memory.jobs.runOnce requires agentId");
    return;
  }
  const controller = getMemoryJobsController(agentId);
  const allowedRequestSeq = controller.noteGatewayRequest();
  try {
    respond(true, await controller.runOnce({ allowedRequestSeq }), undefined);
  } catch (error) {
    respondGatewayError(
      respond,
      "UNAVAILABLE",
      `memory.jobs.runOnce failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function handleMemoryJobsCancelGatewayRequest({
  params,
  respond,
}: GatewayRequestHandlerOptions) {
  const agentId = resolveAgentId(params);
  if (!agentId) {
    respondGatewayError(respond, "INVALID_REQUEST", "memory.jobs.cancel requires agentId");
    return;
  }
  const controller = getMemoryJobsController(agentId);
  controller.noteGatewayRequest();
  try {
    respond(true, await controller.cancel(), undefined);
  } catch (error) {
    respondGatewayError(
      respond,
      "UNAVAILABLE",
      `memory.jobs.cancel failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
