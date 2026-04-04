import { randomUUID } from "node:crypto";
import type { NodeCapabilityManifest } from "./protocol/index.js";
import type { GatewayWsClient } from "./server/ws-types.js";

export type NodeSession = {
  nodeId: string;
  connId: string;
  client: GatewayWsClient;
  clientId?: string;
  clientMode?: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  remoteIp?: string;
  caps: string[];
  capabilities: NodeCapabilityManifest[];
  commands: string[];
  permissions?: Record<string, boolean>;
  pathEnv?: string;
  connectedAtMs: number;
};

type PendingInvoke = {
  nodeId: string;
  command: string;
  resolve: (value: NodeInvokeResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type NodeInvokeResult = {
  ok: boolean;
  payload?: unknown;
  payloadJSON?: string | null;
  error?: { code?: string; message?: string } | null;
};

export type NodeTaskEvent = {
  taskId: string;
  nodeId: string;
  kind: string;
  seq?: number | null;
  payload?: unknown;
  payloadJSON?: string | null;
};

export type NodeTaskResult = {
  ok: boolean;
  payload?: unknown;
  payloadJSON?: string | null;
  error?: { code?: string; message?: string } | null;
};

type PendingTask = {
  nodeId: string;
  capabilityId: string;
  resolve: (value: NodeTaskResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onEvent?: (event: NodeTaskEvent) => void;
};

function uniqueSortedStrings(items: readonly string[] | undefined): string[] {
  const values = new Set<string>();
  for (const item of items ?? []) {
    const trimmed = item.trim();
    if (trimmed) {
      values.add(trimmed);
    }
  }
  return [...values].toSorted((left, right) => left.localeCompare(right));
}

function normalizeCapability(
  capability: NodeCapabilityManifest | null | undefined,
): NodeCapabilityManifest | null {
  if (!capability || typeof capability !== "object") {
    return null;
  }
  const id = String(capability.id ?? "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    title: capability.title?.trim() || undefined,
    description: capability.description?.trim() || undefined,
    version: typeof capability.version === "number" ? capability.version : undefined,
    risk:
      capability.risk === "low" || capability.risk === "medium" || capability.risk === "high"
        ? capability.risk
        : undefined,
    streaming: capability.streaming === true,
    interactive: capability.interactive === true,
    supportsCancel: capability.supportsCancel === true,
    supportsResume: capability.supportsResume === true,
    requiresCommands: uniqueSortedStrings(capability.requiresCommands),
    tags: uniqueSortedStrings(capability.tags),
  };
}

function normalizeCapabilities(
  capabilities: NodeCapabilityManifest[] | undefined,
): NodeCapabilityManifest[] {
  const normalized: NodeCapabilityManifest[] = [];
  const seen = new Set<string>();
  for (const capability of capabilities ?? []) {
    const next = normalizeCapability(capability);
    if (!next || seen.has(next.id)) {
      continue;
    }
    seen.add(next.id);
    normalized.push(next);
  }
  return normalized;
}

export class NodeRegistry {
  private nodesById = new Map<string, NodeSession>();
  private nodesByConn = new Map<string, string>();
  private pendingInvokes = new Map<string, PendingInvoke>();
  private pendingTasks = new Map<string, PendingTask>();

  register(client: GatewayWsClient, opts: { remoteIp?: string | undefined }) {
    const connect = client.connect;
    const nodeId = connect.device?.id ?? connect.client.id;
    const caps = Array.isArray(connect.caps) ? connect.caps : [];
    const capabilities = normalizeCapabilities(
      Array.isArray((connect as { capabilities?: NodeCapabilityManifest[] }).capabilities)
        ? ((connect as { capabilities?: NodeCapabilityManifest[] }).capabilities ?? [])
        : undefined,
    );
    const commands = Array.isArray((connect as { commands?: string[] }).commands)
      ? ((connect as { commands?: string[] }).commands ?? [])
      : [];
    const permissions =
      typeof (connect as { permissions?: Record<string, boolean> }).permissions === "object"
        ? ((connect as { permissions?: Record<string, boolean> }).permissions ?? undefined)
        : undefined;
    const pathEnv =
      typeof (connect as { pathEnv?: string }).pathEnv === "string"
        ? (connect as { pathEnv?: string }).pathEnv
        : undefined;
    const session: NodeSession = {
      nodeId,
      connId: client.connId,
      client,
      clientId: connect.client.id,
      clientMode: connect.client.mode,
      displayName: connect.client.displayName,
      platform: connect.client.platform,
      version: connect.client.version,
      coreVersion: (connect as { coreVersion?: string }).coreVersion,
      uiVersion: (connect as { uiVersion?: string }).uiVersion,
      deviceFamily: connect.client.deviceFamily,
      modelIdentifier: connect.client.modelIdentifier,
      remoteIp: opts.remoteIp,
      caps,
      capabilities,
      commands,
      permissions,
      pathEnv,
      connectedAtMs: Date.now(),
    };
    this.nodesById.set(nodeId, session);
    this.nodesByConn.set(client.connId, nodeId);
    return session;
  }

  unregister(connId: string): string | null {
    const nodeId = this.nodesByConn.get(connId);
    if (!nodeId) {
      return null;
    }
    this.nodesByConn.delete(connId);
    this.nodesById.delete(nodeId);
    for (const [id, pending] of this.pendingInvokes.entries()) {
      if (pending.nodeId !== nodeId) {
        continue;
      }
      clearTimeout(pending.timer);
      pending.reject(new Error(`node disconnected (${pending.command})`));
      this.pendingInvokes.delete(id);
    }
    for (const [taskId, pending] of this.pendingTasks.entries()) {
      if (pending.nodeId !== nodeId) {
        continue;
      }
      clearTimeout(pending.timer);
      pending.reject(new Error(`node disconnected (${pending.capabilityId})`));
      this.pendingTasks.delete(taskId);
    }
    return nodeId;
  }

  listConnected(): NodeSession[] {
    return [...this.nodesById.values()];
  }

  get(nodeId: string): NodeSession | undefined {
    return this.nodesById.get(nodeId);
  }

  startTask(params: {
    nodeId: string;
    capabilityId: string;
    input?: unknown;
    timeoutMs?: number;
    idempotencyKey?: string;
    onEvent?: (event: NodeTaskEvent) => void;
  }):
    | { ok: false; error: { code: string; message: string } }
    | { ok: true; taskId: string; result: Promise<NodeTaskResult> } {
    const node = this.nodesById.get(params.nodeId);
    if (!node) {
      return {
        ok: false,
        error: { code: "NOT_CONNECTED", message: "node not connected" },
      };
    }
    const taskId = randomUUID();
    const payload = {
      taskId,
      nodeId: params.nodeId,
      capabilityId: params.capabilityId,
      inputJSON:
        "input" in params && params.input !== undefined ? JSON.stringify(params.input) : null,
      timeoutMs: params.timeoutMs,
      idempotencyKey: params.idempotencyKey,
    };
    const ok = this.sendEventToSession(node, "node.task.request", payload);
    if (!ok) {
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: "failed to send task to node" },
      };
    }
    const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 120_000;
    const result = new Promise<NodeTaskResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTasks.delete(taskId);
        resolve({
          ok: false,
          error: { code: "TIMEOUT", message: "node task timed out" },
        });
      }, timeoutMs);
      this.pendingTasks.set(taskId, {
        nodeId: params.nodeId,
        capabilityId: params.capabilityId,
        resolve,
        reject,
        timer,
        onEvent: params.onEvent,
      });
    });
    return { ok: true, taskId, result };
  }

  async invoke(params: {
    nodeId: string;
    command: string;
    params?: unknown;
    timeoutMs?: number;
    idempotencyKey?: string;
  }): Promise<NodeInvokeResult> {
    const node = this.nodesById.get(params.nodeId);
    if (!node) {
      return {
        ok: false,
        error: { code: "NOT_CONNECTED", message: "node not connected" },
      };
    }
    const requestId = randomUUID();
    const payload = {
      id: requestId,
      nodeId: params.nodeId,
      command: params.command,
      paramsJSON:
        "params" in params && params.params !== undefined ? JSON.stringify(params.params) : null,
      timeoutMs: params.timeoutMs,
      idempotencyKey: params.idempotencyKey,
    };
    const ok = this.sendEventToSession(node, "node.invoke.request", payload);
    if (!ok) {
      return {
        ok: false,
        error: { code: "UNAVAILABLE", message: "failed to send invoke to node" },
      };
    }
    const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 30_000;
    return await new Promise<NodeInvokeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingInvokes.delete(requestId);
        resolve({
          ok: false,
          error: { code: "TIMEOUT", message: "node invoke timed out" },
        });
      }, timeoutMs);
      this.pendingInvokes.set(requestId, {
        nodeId: params.nodeId,
        command: params.command,
        resolve,
        reject,
        timer,
      });
    });
  }

  handleInvokeResult(params: {
    id: string;
    nodeId: string;
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string | null;
    error?: { code?: string; message?: string } | null;
  }): boolean {
    const pending = this.pendingInvokes.get(params.id);
    if (!pending) {
      return false;
    }
    if (pending.nodeId !== params.nodeId) {
      return false;
    }
    clearTimeout(pending.timer);
    this.pendingInvokes.delete(params.id);
    pending.resolve({
      ok: params.ok,
      payload: params.payload,
      payloadJSON: params.payloadJSON ?? null,
      error: params.error ?? null,
    });
    return true;
  }

  handleTaskEvent(params: NodeTaskEvent): boolean {
    const pending = this.pendingTasks.get(params.taskId);
    if (!pending) {
      return false;
    }
    if (pending.nodeId !== params.nodeId) {
      return false;
    }
    pending.onEvent?.({
      taskId: params.taskId,
      nodeId: params.nodeId,
      kind: params.kind,
      seq: params.seq ?? null,
      payload: params.payload,
      payloadJSON: params.payloadJSON ?? null,
    });
    return true;
  }

  handleTaskResult(params: {
    taskId: string;
    nodeId: string;
    ok: boolean;
    payload?: unknown;
    payloadJSON?: string | null;
    error?: { code?: string; message?: string } | null;
  }): boolean {
    const pending = this.pendingTasks.get(params.taskId);
    if (!pending) {
      return false;
    }
    if (pending.nodeId !== params.nodeId) {
      return false;
    }
    clearTimeout(pending.timer);
    this.pendingTasks.delete(params.taskId);
    pending.resolve({
      ok: params.ok,
      payload: params.payload,
      payloadJSON: params.payloadJSON ?? null,
      error: params.error ?? null,
    });
    return true;
  }

  sendEvent(nodeId: string, event: string, payload?: unknown): boolean {
    const node = this.nodesById.get(nodeId);
    if (!node) {
      return false;
    }
    return this.sendEventToSession(node, event, payload);
  }

  private sendEventInternal(node: NodeSession, event: string, payload: unknown): boolean {
    try {
      node.client.socket.send(
        JSON.stringify({
          type: "event",
          event,
          payload,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  private sendEventToSession(node: NodeSession, event: string, payload: unknown): boolean {
    return this.sendEventInternal(node, event, payload);
  }
}
