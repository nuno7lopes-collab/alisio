import { loadConfig } from "../../config/config.js";
import { getAlisioSharingTargetAccessIndex } from "../../infra/alisio-store.js";
import { listDevicePairing } from "../../infra/device-pairing.js";
import {
  approveNodePairing,
  listNodePairing,
  rejectNodePairing,
  renamePairedNode,
  requestNodePairing,
  verifyNodeToken,
} from "../../infra/node-pairing.js";
import {
  buildCanvasScopedHostUrl,
  CANVAS_CAPABILITY_TTL_MS,
  mintCanvasCapabilityToken,
} from "../canvas-capability.js";
import { createKnownNodeCatalog, getKnownNode, listKnownNodes } from "../node-catalog.js";
import { isNodeCommandAllowed, resolveNodeCommandAllowlist } from "../node-command-policy.js";
import { sanitizeNodeInvokeParamsForForwarding } from "../node-invoke-sanitize.js";
import {
  ErrorCodes,
  errorShape,
  validateNodeDescribeParams,
  validateNodeEventParams,
  validateNodeInvokeParams,
  validateNodeListParams,
  validateNodePairApproveParams,
  validateNodePairListParams,
  validateNodePairRejectParams,
  validateNodePairRequestParams,
  validateNodePairVerifyParams,
  validateNodeRenameParams,
  validateNodeTaskEventParams,
  validateNodeTaskStartParams,
} from "../protocol/index.js";
import { handleNodeInvokeResult } from "./nodes.handlers.invoke-result.js";
import { handleNodeTaskResult } from "./nodes.handlers.task-result.js";
import {
  respondInvalidParams,
  respondUnavailableOnNodeInvokeError,
  respondUnavailableOnThrow,
  safeParseJson,
} from "./nodes.helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

const NODE_LIST_CACHE_TTL_MS = 60_000;
let cachedVisibleNodeList:
  | {
      expiresAtMs: number;
      payload: { ts: number; nodes: ReturnType<typeof listKnownNodes> };
    }
  | undefined;
let inflightVisibleNodeList:
  | Promise<{ ts: number; nodes: ReturnType<typeof listKnownNodes> }>
  | undefined;

type NodeSharingTarget = {
  targetId: string;
  computerId?: string;
  computerLabel?: string;
  label: string;
  platform?: string;
  sourceKind: "node";
  connected: boolean;
  current: false;
};

function clearVisibleNodeListCache() {
  cachedVisibleNodeList = undefined;
  inflightVisibleNodeList = undefined;
}

function buildDegradedNodeAccessIndex(targets: readonly NodeSharingTarget[]) {
  const timestamp = new Date().toISOString();
  return Object.fromEntries(
    targets.map((target) => [
      target.targetId,
      {
        ...target,
        ownerKey: "user:degraded-runtime",
        ownerScope: "user" as const,
        ownerLabel: "Current user",
        registeredAt: timestamp,
        updatedAt: timestamp,
        deviceAccess: "owner" as const,
        modelAccess: "owner" as const,
        execAccess: "owner" as const,
      },
    ]),
  );
}

async function loadNodeSharingAccessIndex(targets: readonly NodeSharingTarget[]) {
  if (targets.length === 0) {
    return {};
  }
  try {
    return await getAlisioSharingTargetAccessIndex({ targets: [...targets] });
  } catch {
    // Paired-node visibility should degrade locally when optional cloud sharing
    // state is stale instead of pushing the whole control UI into reconnecting.
    return buildDegradedNodeAccessIndex(targets);
  }
}

async function loadVisibleNodeList(
  context: Parameters<NonNullable<GatewayRequestHandlers["node.list"]>>[0]["context"],
) {
  const now = Date.now();
  if (cachedVisibleNodeList && cachedVisibleNodeList.expiresAtMs > now) {
    return cachedVisibleNodeList.payload;
  }
  if (cachedVisibleNodeList) {
    // Node inventory is auxiliary UI state. Once we have a usable snapshot,
    // serve it immediately and refresh in the background instead of letting a
    // slow sharing/index probe push the whole control UI into reconnecting.
    inflightVisibleNodeList ??= (async () => {
      const payload = await refreshVisibleNodeList(context);
      return payload;
    })().finally(() => {
      inflightVisibleNodeList = undefined;
    });
    void inflightVisibleNodeList.catch(() => undefined);
    return cachedVisibleNodeList.payload;
  }
  if (inflightVisibleNodeList) {
    return await inflightVisibleNodeList;
  }
  inflightVisibleNodeList = (async () => {
    const payload = await refreshVisibleNodeList(context);
    return payload;
  })().finally(() => {
    inflightVisibleNodeList = undefined;
  });
  return await inflightVisibleNodeList;
}

async function refreshVisibleNodeList(
  context: Parameters<NonNullable<GatewayRequestHandlers["node.list"]>>[0]["context"],
) {
  const list = await listDevicePairing();
  const catalog = createKnownNodeCatalog({
    pairedDevices: list.paired,
    connectedNodes: context.nodeRegistry.listConnected(),
  });
  const nodes = listKnownNodes(catalog);
  const accessIndex = await loadNodeSharingAccessIndex(
    nodes.map((node) => ({
      targetId: node.nodeId,
      computerId: node.computerId,
      computerLabel: node.computerLabel,
      label: node.displayName ?? node.nodeId,
      platform: node.platform,
      sourceKind: "node" as const,
      connected: node.connected === true,
      current: false as const,
    })),
  );
  const visibleNodes = nodes.filter((node) => {
    const access = accessIndex[node.nodeId];
    return access?.execAccess === "owner" || access?.execAccess === "shared";
  });
  const payload = {
    ts: Date.now(),
    nodes: visibleNodes,
  };
  cachedVisibleNodeList = {
    expiresAtMs: Date.now() + NODE_LIST_CACHE_TTL_MS,
    payload,
  };
  return payload;
}

function findNodeCapability(
  nodeSession:
    | {
        capabilities?: Array<{
          id?: string;
          requiresCommands?: string[];
        }>;
      }
    | undefined,
  capabilityId: string,
) {
  const trimmedCapabilityId = capabilityId.trim();
  if (!trimmedCapabilityId) {
    return null;
  }
  return (
    nodeSession?.capabilities?.find(
      (capability) => capability.id?.trim() === trimmedCapabilityId,
    ) ?? null
  );
}

function isSharedNodeMutatingCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return (
    normalized.startsWith("model.manage.") ||
    normalized.startsWith("model.install.") ||
    normalized.startsWith("model.uninstall.") ||
    normalized.startsWith("model.update.") ||
    normalized.startsWith("model.server.start.") ||
    normalized.startsWith("runtime.server.start.")
  );
}

function isSharedNodeMutatingCapability(capabilityId: string): boolean {
  const normalized = capabilityId.trim().toLowerCase();
  return (
    normalized.startsWith("model.manage.") ||
    normalized.startsWith("model.server.start.") ||
    normalized.startsWith("runtime.server.start.")
  );
}

function prepareNodeTaskInput(params: {
  nodeId: string;
  capabilityId: string;
  rawInput: unknown;
  client: Parameters<typeof sanitizeNodeInvokeParamsForForwarding>[0]["client"];
  execApprovalManager: Parameters<
    typeof sanitizeNodeInvokeParamsForForwarding
  >[0]["execApprovalManager"];
}) {
  if (params.capabilityId === "exec.shell.v1") {
    const forwarded = sanitizeNodeInvokeParamsForForwarding({
      nodeId: params.nodeId,
      command: "system.run",
      rawParams: params.rawInput,
      client: params.client,
      execApprovalManager: params.execApprovalManager,
    });
    if (!forwarded.ok) {
      return {
        ok: false as const,
        message: forwarded.message,
        details: forwarded.details ?? null,
      };
    }
    return {
      ok: true as const,
      input: forwarded.params,
    };
  }
  return {
    ok: true as const,
    input: params.rawInput,
  };
}

async function resolveKnownNodeSharingAccess(params: {
  nodeId: string;
  context: Pick<Parameters<GatewayRequestHandlers[string]>[0]["context"], "nodeRegistry">;
}) {
  const list = await listDevicePairing();
  const catalog = createKnownNodeCatalog({
    pairedDevices: list.paired,
    connectedNodes: params.context.nodeRegistry.listConnected(),
  });
  const node = getKnownNode(catalog, params.nodeId);
  if (!node) {
    return null;
  }
  const accessIndex = await loadNodeSharingAccessIndex([
    {
      targetId: node.nodeId,
      computerId: node.computerId,
      computerLabel: node.computerLabel,
      label: node.displayName ?? node.nodeId,
      platform: node.platform,
      sourceKind: "node",
      connected: node.connected === true,
      current: false,
    },
  ]);
  return {
    node,
    access: accessIndex[node.nodeId] ?? null,
  };
}

export const nodeHandlers: GatewayRequestHandlers = {
  "node.pair.request": async ({ params, respond, context }) => {
    if (!validateNodePairRequestParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.pair.request",
        validator: validateNodePairRequestParams,
      });
      return;
    }
    const p = params as Parameters<typeof requestNodePairing>[0];
    await respondUnavailableOnThrow(respond, async () => {
      const result = await requestNodePairing({
        nodeId: p.nodeId,
        displayName: p.displayName,
        platform: p.platform,
        version: p.version,
        coreVersion: p.coreVersion,
        uiVersion: p.uiVersion,
        deviceFamily: p.deviceFamily,
        modelIdentifier: p.modelIdentifier,
        caps: p.caps,
        commands: p.commands,
        permissions: p.permissions,
        remoteIp: p.remoteIp,
        silent: p.silent,
      });
      clearVisibleNodeListCache();
      if (result.status === "pending" && result.created) {
        context.broadcast("node.pair.requested", result.request, {
          dropIfSlow: true,
        });
      }
      respond(true, result, undefined);
    });
  },
  "node.pair.list": async ({ params, respond }) => {
    if (!validateNodePairListParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.pair.list",
        validator: validateNodePairListParams,
      });
      return;
    }
    await respondUnavailableOnThrow(respond, async () => {
      const list = await listNodePairing();
      respond(true, list, undefined);
    });
  },
  "node.pair.approve": async ({ params, respond, context, client }) => {
    if (!validateNodePairApproveParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.pair.approve",
        validator: validateNodePairApproveParams,
      });
      return;
    }
    const { requestId } = params as { requestId: string };
    // Intentionally fail closed for RPC callers without an explicit scoped session.
    const callerScopes = Array.isArray(client?.connect?.scopes) ? client.connect.scopes : [];
    await respondUnavailableOnThrow(respond, async () => {
      const approved = await approveNodePairing(requestId, { callerScopes });
      if (!approved) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"));
        return;
      }
      if ("status" in approved && approved.status === "forbidden") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `missing scope: ${approved.missingScope}`),
        );
        return;
      }
      if (!("node" in approved)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"));
        return;
      }
      clearVisibleNodeListCache();
      const approvedNode = approved.node;
      context.broadcast(
        "node.pair.resolved",
        {
          requestId,
          nodeId: approvedNode.nodeId,
          decision: "approved",
          ts: Date.now(),
        },
        { dropIfSlow: true },
      );
      respond(true, approved, undefined);
    });
  },
  "node.pair.reject": async ({ params, respond, context }) => {
    if (!validateNodePairRejectParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.pair.reject",
        validator: validateNodePairRejectParams,
      });
      return;
    }
    const { requestId } = params as { requestId: string };
    await respondUnavailableOnThrow(respond, async () => {
      const rejected = await rejectNodePairing(requestId);
      if (!rejected) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"));
        return;
      }
      clearVisibleNodeListCache();
      context.broadcast(
        "node.pair.resolved",
        {
          requestId,
          nodeId: rejected.nodeId,
          decision: "rejected",
          ts: Date.now(),
        },
        { dropIfSlow: true },
      );
      respond(true, rejected, undefined);
    });
  },
  "node.pair.verify": async ({ params, respond }) => {
    if (!validateNodePairVerifyParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.pair.verify",
        validator: validateNodePairVerifyParams,
      });
      return;
    }
    const { nodeId, token } = params as {
      nodeId: string;
      token: string;
    };
    await respondUnavailableOnThrow(respond, async () => {
      const result = await verifyNodeToken(nodeId, token);
      respond(true, result, undefined);
    });
  },
  "node.rename": async ({ params, respond }) => {
    if (!validateNodeRenameParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.rename",
        validator: validateNodeRenameParams,
      });
      return;
    }
    const { nodeId, displayName } = params as {
      nodeId: string;
      displayName: string;
    };
    await respondUnavailableOnThrow(respond, async () => {
      const trimmed = displayName.trim();
      if (!trimmed) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "displayName required"));
        return;
      }
      const updated = await renamePairedNode(nodeId, trimmed);
      if (!updated) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown nodeId"));
        return;
      }
      clearVisibleNodeListCache();
      respond(true, { nodeId: updated.nodeId, displayName: updated.displayName }, undefined);
    });
  },
  "node.list": async ({ params, respond, context }) => {
    if (!validateNodeListParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.list",
        validator: validateNodeListParams,
      });
      return;
    }
    await respondUnavailableOnThrow(respond, async () => {
      respond(true, await loadVisibleNodeList(context), undefined);
    });
  },
  "node.describe": async ({ params, respond, context }) => {
    if (!validateNodeDescribeParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.describe",
        validator: validateNodeDescribeParams,
      });
      return;
    }
    const { nodeId } = params as { nodeId: string };
    const id = String(nodeId ?? "").trim();
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "nodeId required"));
      return;
    }
    await respondUnavailableOnThrow(respond, async () => {
      const list = await listDevicePairing();
      const catalog = createKnownNodeCatalog({
        pairedDevices: list.paired,
        connectedNodes: context.nodeRegistry.listConnected(),
      });
      const node = getKnownNode(catalog, id);
      if (!node) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown nodeId"));
        return;
      }
      const accessIndex = await loadNodeSharingAccessIndex([
        {
          targetId: node.nodeId,
          computerId: node.computerId,
          computerLabel: node.computerLabel,
          label: node.displayName ?? node.nodeId,
          platform: node.platform,
          sourceKind: "node",
          connected: node.connected === true,
          current: false,
        },
      ]);
      const access = accessIndex[node.nodeId];
      if (!access || (access.execAccess !== "owner" && access.execAccess !== "shared")) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown nodeId"));
        return;
      }
      respond(true, { ts: Date.now(), ...node }, undefined);
    });
  },
  "node.canvas.capability.refresh": async ({ params, respond, client }) => {
    if (!validateNodeListParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.canvas.capability.refresh",
        validator: validateNodeListParams,
      });
      return;
    }
    const baseCanvasHostUrl = client?.canvasHostUrl?.trim() ?? "";
    if (!baseCanvasHostUrl) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "canvas host unavailable for this node session"),
      );
      return;
    }

    const canvasCapability = mintCanvasCapabilityToken();
    const canvasCapabilityExpiresAtMs = Date.now() + CANVAS_CAPABILITY_TTL_MS;
    const scopedCanvasHostUrl = buildCanvasScopedHostUrl(baseCanvasHostUrl, canvasCapability);
    if (!scopedCanvasHostUrl) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "failed to mint scoped canvas host URL"),
      );
      return;
    }

    if (client) {
      client.canvasCapability = canvasCapability;
      client.canvasCapabilityExpiresAtMs = canvasCapabilityExpiresAtMs;
    }
    respond(
      true,
      {
        canvasCapability,
        canvasCapabilityExpiresAtMs,
        canvasHostUrl: scopedCanvasHostUrl,
      },
      undefined,
    );
  },
  "node.invoke": async ({ params, respond, context, client }) => {
    if (!validateNodeInvokeParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.invoke",
        validator: validateNodeInvokeParams,
      });
      return;
    }
    const p = params as {
      nodeId: string;
      command: string;
      params?: unknown;
      timeoutMs?: number;
      idempotencyKey: string;
    };
    const nodeId = String(p.nodeId ?? "").trim();
    const command = String(p.command ?? "").trim();
    if (!nodeId || !command) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "nodeId and command required"),
      );
      return;
    }
    if (command === "system.execApprovals.get" || command === "system.execApprovals.set") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "node.invoke does not allow system.execApprovals.*; use exec.approvals.node.*",
          { details: { command } },
        ),
      );
      return;
    }

    await respondUnavailableOnThrow(respond, async () => {
      const sharedAccess = await resolveKnownNodeSharingAccess({ nodeId, context });
      if (
        !sharedAccess ||
        !sharedAccess.access ||
        (sharedAccess.access.execAccess !== "owner" && sharedAccess.access.execAccess !== "shared")
      ) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown nodeId"));
        return;
      }
      if (sharedAccess.access.execAccess === "shared" && isSharedNodeMutatingCommand(command)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "shared devices are read-only", {
            details: { command, nodeId },
          }),
        );
        return;
      }
      let nodeSession = context.nodeRegistry.get(nodeId);
      if (!nodeSession) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "node not connected", {
            details: { code: "NOT_CONNECTED" },
          }),
        );
        return;
      }
      const cfg = loadConfig();
      const allowlist = resolveNodeCommandAllowlist(cfg, nodeSession);
      const allowed = isNodeCommandAllowed({
        command,
        declaredCommands: nodeSession.commands,
        allowlist,
      });
      if (!allowed.ok) {
        const hint = buildNodeCommandRejectionHint(allowed.reason, command, nodeSession);
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, hint, {
            details: { reason: allowed.reason, command },
          }),
        );
        return;
      }
      const forwardedParams = sanitizeNodeInvokeParamsForForwarding({
        nodeId,
        command,
        rawParams: p.params,
        client,
        execApprovalManager: context.execApprovalManager,
      });
      if (!forwardedParams.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, forwardedParams.message, {
            details: forwardedParams.details ?? null,
          }),
        );
        return;
      }
      const res = await context.nodeRegistry.invoke({
        nodeId,
        command,
        params: forwardedParams.params,
        timeoutMs: p.timeoutMs,
        idempotencyKey: p.idempotencyKey,
      });
      if (!res.ok) {
        if (!respondUnavailableOnNodeInvokeError(respond, res)) {
          return;
        }
        return;
      }
      const payload = res.payloadJSON ? safeParseJson(res.payloadJSON) : res.payload;
      respond(
        true,
        {
          ok: true,
          nodeId,
          command,
          payload,
          payloadJSON: res.payloadJSON ?? null,
        },
        undefined,
      );
    });
  },
  "node.invoke.result": handleNodeInvokeResult,
  "node.task.start": async ({ params, respond, context, client, req }) => {
    if (!validateNodeTaskStartParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.task.start",
        validator: validateNodeTaskStartParams,
      });
      return;
    }
    const p = params as {
      nodeId: string;
      capabilityId: string;
      input?: unknown;
      timeoutMs?: number;
      idempotencyKey: string;
    };
    const nodeId = String(p.nodeId ?? "").trim();
    const capabilityId = String(p.capabilityId ?? "").trim();
    if (!nodeId || !capabilityId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "nodeId and capabilityId required"),
      );
      return;
    }

    await respondUnavailableOnThrow(respond, async () => {
      const sharedAccess = await resolveKnownNodeSharingAccess({ nodeId, context });
      if (
        !sharedAccess ||
        !sharedAccess.access ||
        (sharedAccess.access.execAccess !== "owner" && sharedAccess.access.execAccess !== "shared")
      ) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown nodeId"));
        return;
      }
      if (
        sharedAccess.access.execAccess === "shared" &&
        isSharedNodeMutatingCapability(capabilityId)
      ) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "shared devices are read-only", {
            details: { capabilityId, nodeId },
          }),
        );
        return;
      }
      let nodeSession = context.nodeRegistry.get(nodeId);
      if (!nodeSession) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "node not connected", {
            details: { code: "NOT_CONNECTED" },
          }),
        );
        return;
      }

      const capability = findNodeCapability(nodeSession, capabilityId);
      if (!capability) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `node capability not allowed: "${capabilityId}" is not declared by this node`,
          ),
        );
        return;
      }

      const prepared = prepareNodeTaskInput({
        nodeId,
        capabilityId,
        rawInput: p.input,
        client,
        execApprovalManager: context.execApprovalManager,
      });
      if (!prepared.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, prepared.message, {
            details: prepared.details,
          }),
        );
        return;
      }

      const started = context.nodeRegistry.startTask({
        nodeId,
        capabilityId,
        input: prepared.input,
        timeoutMs: p.timeoutMs,
        idempotencyKey: p.idempotencyKey,
        onEvent: (event) => {
          const payload = event.payloadJSON ? safeParseJson(event.payloadJSON) : event.payload;
          context.broadcast(
            "node.task.updated",
            {
              phase: "event",
              nodeId,
              capabilityId,
              taskId: event.taskId,
              kind: event.kind,
              seq: event.seq ?? null,
              payload,
              payloadJSON: event.payloadJSON ?? null,
            },
            { dropIfSlow: true },
          );
        },
      });
      if (!started.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, started.error.message, {
            details: { code: started.error.code },
          }),
        );
        return;
      }

      const accepted = {
        status: "accepted" as const,
        taskId: started.taskId,
        nodeId,
        capabilityId,
        acceptedAt: Date.now(),
      };
      respond(true, accepted, undefined, { taskId: started.taskId, requestId: req.id });

      void started.result
        .then((result) => {
          const payload = result.payloadJSON ? safeParseJson(result.payloadJSON) : result.payload;
          context.broadcast(
            "node.task.updated",
            {
              phase: "result",
              nodeId,
              capabilityId,
              taskId: started.taskId,
              ok: result.ok,
              payload,
              payloadJSON: result.payloadJSON ?? null,
              error: result.error ?? null,
            },
            { dropIfSlow: true },
          );
          if (result.ok) {
            respond(
              true,
              {
                status: "ok" as const,
                taskId: started.taskId,
                nodeId,
                capabilityId,
                payload,
                payloadJSON: result.payloadJSON ?? null,
              },
              undefined,
              { taskId: started.taskId, requestId: req.id },
            );
            return;
          }
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              result.error?.message?.trim() || "node task failed",
              {
                details: {
                  taskId: started.taskId,
                  nodeId,
                  capabilityId,
                  nodeError: result.error ?? null,
                  payloadJSON: result.payloadJSON ?? null,
                },
              },
            ),
            { taskId: started.taskId, requestId: req.id },
          );
        })
        .catch((err) => {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.UNAVAILABLE, String(err), {
              details: {
                taskId: started.taskId,
                nodeId,
                capabilityId,
              },
            }),
            { taskId: started.taskId, requestId: req.id },
          );
        });
    });
  },
  "node.task.result": handleNodeTaskResult,
  "node.task.event": async ({ params, respond, context, client }) => {
    if (!validateNodeTaskEventParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.task.event",
        validator: validateNodeTaskEventParams,
      });
      return;
    }
    const p = params as {
      taskId: string;
      nodeId: string;
      kind: string;
      seq?: number;
      payload?: unknown;
      payloadJSON?: string | null;
    };
    const callerNodeId = client?.connect?.device?.id ?? client?.connect?.client?.id;
    if (callerNodeId && callerNodeId !== p.nodeId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "nodeId mismatch"));
      return;
    }
    const ok = context.nodeRegistry.handleTaskEvent({
      taskId: p.taskId,
      nodeId: p.nodeId,
      kind: p.kind,
      seq: p.seq ?? null,
      payload: p.payload,
      payloadJSON: p.payloadJSON ?? null,
    });
    if (!ok) {
      context.logGateway.debug(`late task event ignored: id=${p.taskId} node=${p.nodeId}`);
      respond(true, { ok: true, ignored: true }, undefined);
      return;
    }
    respond(true, { ok: true }, undefined);
  },
  "node.event": async ({ params, respond, context, client }) => {
    if (!validateNodeEventParams(params)) {
      respondInvalidParams({
        respond,
        method: "node.event",
        validator: validateNodeEventParams,
      });
      return;
    }
    const p = params as { event: string; payload?: unknown; payloadJSON?: string | null };
    const payloadJSON =
      typeof p.payloadJSON === "string"
        ? p.payloadJSON
        : p.payload !== undefined
          ? JSON.stringify(p.payload)
          : null;
    await respondUnavailableOnThrow(respond, async () => {
      const { handleNodeEvent } = await import("../server-node-events.js");
      const nodeId = client?.connect?.device?.id ?? client?.connect?.client?.id ?? "node";
      const nodeContext = {
        deps: context.deps,
        broadcast: context.broadcast,
        nodeSendToSession: context.nodeSendToSession,
        nodeSubscribe: context.nodeSubscribe,
        nodeUnsubscribe: context.nodeUnsubscribe,
        broadcastVoiceWakeChanged: context.broadcastVoiceWakeChanged,
        addChatRun: context.addChatRun,
        removeChatRun: context.removeChatRun,
        chatAbortControllers: context.chatAbortControllers,
        chatAbortedRuns: context.chatAbortedRuns,
        chatRunBuffers: context.chatRunBuffers,
        chatDeltaSentAt: context.chatDeltaSentAt,
        dedupe: context.dedupe,
        agentRunSeq: context.agentRunSeq,
        getHealthCache: context.getHealthCache,
        refreshHealthSnapshot: context.refreshHealthSnapshot,
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
        logGateway: { warn: context.logGateway.warn },
      };
      await handleNodeEvent(nodeContext, nodeId, {
        event: p.event,
        payloadJSON,
      });
      respond(true, { ok: true }, undefined);
    });
  },
};

export const __testing = {
  clearVisibleNodeListCache,
};

function buildNodeCommandRejectionHint(
  reason: string,
  command: string,
  node: { platform?: string } | undefined,
): string {
  const platform = node?.platform ?? "unknown";
  if (reason === "command not declared by node") {
    return `node command not allowed: the node (platform: ${platform}) does not support "${command}"`;
  }
  if (reason === "command not allowlisted") {
    return `node command not allowed: "${command}" is not in the allowlist for platform "${platform}"`;
  }
  if (reason === "node did not declare commands") {
    return `node command not allowed: the node did not declare any supported commands`;
  }
  return `node command not allowed: ${reason}`;
}
