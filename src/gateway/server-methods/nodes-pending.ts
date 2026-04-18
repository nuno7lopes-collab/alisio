import {
  drainNodePendingWork,
  enqueueNodePendingWork,
  type NodePendingWorkPriority,
  type NodePendingWorkType,
} from "../node-pending-work.js";
import {
  ErrorCodes,
  errorShape,
  validateNodePendingDrainParams,
  validateNodePendingEnqueueParams,
} from "../protocol/index.js";
import { respondInvalidParams, respondUnavailableOnThrow } from "./nodes.helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function resolveClientNodeId(
  client: { connect?: { device?: { id?: string }; client?: { id?: string } } } | null,
): string | null {
  const nodeId = client?.connect?.device?.id ?? client?.connect?.client?.id ?? "";
  const trimmed = nodeId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const nodePendingHandlers: GatewayRequestHandlers = {
  "node.pending.drain": async ({ params, respond, client }) => {
    if (!validateNodePendingDrainParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.pending.drain",
        validator: validateNodePendingDrainParams,
      });
      return;
    }
    const nodeId = resolveClientNodeId(client);
    if (!nodeId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "node.pending.drain requires a connected device identity",
        ),
      );
      return;
    }
    const p = params as { maxItems?: number };
    const drained = drainNodePendingWork(nodeId, {
      maxItems: p.maxItems,
      includeDefaultStatus: true,
    });
    respond(true, { nodeId, ...drained }, undefined);
  },
  "node.pending.enqueue": async ({ params, respond }) => {
    if (!validateNodePendingEnqueueParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.pending.enqueue",
        validator: validateNodePendingEnqueueParams,
      });
      return;
    }
    const p = params as {
      nodeId: string;
      type: NodePendingWorkType;
      priority?: NodePendingWorkPriority;
      expiresInMs?: number;
      wake?: boolean;
    };
    await respondUnavailableOnThrow(respond, async () => {
      const queued = enqueueNodePendingWork({
        nodeId: p.nodeId,
        type: p.type,
        priority: p.priority,
        expiresInMs: p.expiresInMs,
      });
      respond(
        true,
        {
          nodeId: p.nodeId,
          revision: queued.revision,
          queued: queued.item,
          wakeTriggered: false,
        },
        undefined,
      );
    });
  },
};
