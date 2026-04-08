import type { GatewayBrowserClient } from "../gateway.ts";

export type ExecApprovalRequestPayload = {
  command: string;
  commandPreview?: string | null;
  envKeys?: string[] | null;
  cwd?: string | null;
  host?: string | null;
  nodeId?: string | null;
  security?: string | null;
  ask?: string | null;
  agentId?: string | null;
  resolvedPath?: string | null;
  sessionKey?: string | null;
};

export type ExecApprovalRequest = {
  id: string;
  kind: "exec" | "plugin";
  request: ExecApprovalRequestPayload;
  pluginTitle?: string;
  pluginDescription?: string | null;
  pluginSeverity?: string | null;
  pluginId?: string | null;
  pluginToolName?: string | null;
  createdAtMs: number;
  expiresAtMs: number;
};

export type ExecApprovalResolved = {
  id: string;
  decision?: string | null;
  resolvedBy?: string | null;
  ts?: number | null;
  request?: ExecApprovalRequestPayload | null;
};

export type ExecApprovalAuditEntry = {
  id: string;
  kind: "exec" | "plugin";
  title: string;
  summary: string;
  decision: string;
  resolvedBy?: string | null;
  ts: number;
  request: ExecApprovalRequestPayload;
  pluginId?: string | null;
  pluginSeverity?: string | null;
  pluginToolName?: string | null;
};

export type ApprovalAuditTrailState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  execApprovalAuditTrail: ExecApprovalAuditEntry[];
  lastError: string | null;
};

type ApprovalAuditTrailSnapshot = {
  items?: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseExecApprovalRequestPayload(request: unknown): ExecApprovalRequestPayload | null {
  if (!isRecord(request)) {
    return null;
  }
  const command = typeof request.command === "string" ? request.command.trim() : "";
  if (!command) {
    return null;
  }
  return {
    command,
    commandPreview: typeof request.commandPreview === "string" ? request.commandPreview : null,
    envKeys: Array.isArray(request.envKeys)
      ? request.envKeys.filter((value): value is string => typeof value === "string")
      : null,
    cwd: typeof request.cwd === "string" ? request.cwd : null,
    host: typeof request.host === "string" ? request.host : null,
    nodeId: typeof request.nodeId === "string" ? request.nodeId : null,
    security: typeof request.security === "string" ? request.security : null,
    ask: typeof request.ask === "string" ? request.ask : null,
    agentId: typeof request.agentId === "string" ? request.agentId : null,
    resolvedPath: typeof request.resolvedPath === "string" ? request.resolvedPath : null,
    sessionKey: typeof request.sessionKey === "string" ? request.sessionKey : null,
  };
}

function parsePluginApprovalRequestDetails(request: unknown): {
  request: ExecApprovalRequestPayload;
  title: string;
  description: string | null;
  severity: string | null;
  pluginId: string | null;
  toolName: string | null;
} | null {
  if (!isRecord(request)) {
    return null;
  }
  const title = typeof request.title === "string" ? request.title.trim() : "";
  if (!title) {
    return null;
  }
  return {
    request: {
      command: title,
      agentId: typeof request.agentId === "string" ? request.agentId : null,
      sessionKey: typeof request.sessionKey === "string" ? request.sessionKey : null,
    },
    title,
    description: typeof request.description === "string" ? request.description : null,
    severity: typeof request.severity === "string" ? request.severity : null,
    pluginId: typeof request.pluginId === "string" ? request.pluginId : null,
    toolName: typeof request.toolName === "string" ? request.toolName : null,
  };
}

export function parseExecApprovalRequested(payload: unknown): ExecApprovalRequest | null {
  if (!isRecord(payload)) {
    return null;
  }
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const request = payload.request;
  if (!id) {
    return null;
  }
  const parsedRequest = parseExecApprovalRequestPayload(request);
  if (!parsedRequest) {
    return null;
  }
  const createdAtMs = typeof payload.createdAtMs === "number" ? payload.createdAtMs : 0;
  const expiresAtMs = typeof payload.expiresAtMs === "number" ? payload.expiresAtMs : 0;
  if (!createdAtMs || !expiresAtMs) {
    return null;
  }
  return {
    id,
    kind: "exec",
    request: parsedRequest,
    createdAtMs,
    expiresAtMs,
  };
}

export function parseExecApprovalResolved(payload: unknown): ExecApprovalResolved | null {
  if (!isRecord(payload)) {
    return null;
  }
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) {
    return null;
  }
  return {
    id,
    decision: typeof payload.decision === "string" ? payload.decision : null,
    resolvedBy: typeof payload.resolvedBy === "string" ? payload.resolvedBy : null,
    ts: typeof payload.ts === "number" ? payload.ts : null,
    request: parseExecApprovalRequestPayload(payload.request),
  };
}

export function parsePluginApprovalRequested(payload: unknown): ExecApprovalRequest | null {
  if (!isRecord(payload)) {
    return null;
  }
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) {
    return null;
  }
  const createdAtMs = typeof payload.createdAtMs === "number" ? payload.createdAtMs : 0;
  const expiresAtMs = typeof payload.expiresAtMs === "number" ? payload.expiresAtMs : 0;
  if (!createdAtMs || !expiresAtMs) {
    return null;
  }
  const details = parsePluginApprovalRequestDetails(payload.request);
  if (!details) {
    return null;
  }

  return {
    id,
    kind: "plugin",
    request: details.request,
    pluginTitle: details.title,
    pluginDescription: details.description,
    pluginSeverity: details.severity,
    pluginId: details.pluginId,
    pluginToolName: details.toolName,
    createdAtMs,
    expiresAtMs,
  };
}

export function parseApprovalAuditEntry(
  kind: "exec" | "plugin",
  payload: unknown,
): ExecApprovalAuditEntry | null {
  if (!isRecord(payload)) {
    return null;
  }
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const decision = typeof payload.decision === "string" ? payload.decision.trim() : "";
  const ts = typeof payload.ts === "number" ? payload.ts : 0;
  if (!id || !decision || !ts) {
    return null;
  }
  if (kind === "plugin") {
    const details = parsePluginApprovalRequestDetails(payload.request);
    if (!details) {
      return null;
    }
    return {
      id,
      kind,
      title: details.title,
      summary: details.description ?? details.title,
      decision,
      resolvedBy: typeof payload.resolvedBy === "string" ? payload.resolvedBy : null,
      ts,
      request: details.request,
      pluginId: details.pluginId,
      pluginSeverity: details.severity,
      pluginToolName: details.toolName,
    };
  }
  const request = parseExecApprovalRequestPayload(payload.request);
  if (!request) {
    return null;
  }
  return {
    id,
    kind,
    title: request.command,
    summary: request.command,
    decision,
    resolvedBy: typeof payload.resolvedBy === "string" ? payload.resolvedBy : null,
    ts,
    request,
  };
}

export function addExecApprovalAuditEntry(
  entries: ExecApprovalAuditEntry[],
  entry: ExecApprovalAuditEntry,
  limit = 20,
): ExecApprovalAuditEntry[] {
  const next = entries.filter((item) => item.id !== entry.id);
  next.unshift(entry);
  return next.slice(0, limit);
}

export function pruneExecApprovalQueue(queue: ExecApprovalRequest[]): ExecApprovalRequest[] {
  const now = Date.now();
  return sortExecApprovalQueue(queue.filter((entry) => entry.expiresAtMs > now));
}

function compareExecApprovalQueueEntries(
  left: ExecApprovalRequest,
  right: ExecApprovalRequest,
): number {
  const leftExpirySecond = Math.floor(left.expiresAtMs / 1000);
  const rightExpirySecond = Math.floor(right.expiresAtMs / 1000);
  // Back-to-back approvals usually share the same server TTL. Comparing raw
  // millisecond expiries makes the queue order jitter based on delivery timing,
  // so treat expiries within the same second as equal and show the newest first.
  if (leftExpirySecond !== rightExpirySecond) {
    return left.expiresAtMs - right.expiresAtMs;
  }
  return right.createdAtMs - left.createdAtMs;
}

export function sortExecApprovalQueue(queue: ExecApprovalRequest[]): ExecApprovalRequest[] {
  return queue.toSorted(compareExecApprovalQueueEntries);
}

export function addExecApproval(
  queue: ExecApprovalRequest[],
  entry: ExecApprovalRequest,
): ExecApprovalRequest[] {
  const next = pruneExecApprovalQueue(queue).filter((item) => item.id !== entry.id);
  next.push(entry);
  return sortExecApprovalQueue(next);
}

export function removeExecApproval(
  queue: ExecApprovalRequest[],
  id: string,
): ExecApprovalRequest[] {
  return pruneExecApprovalQueue(queue).filter((entry) => entry.id !== id);
}

export async function loadApprovalAuditTrail(state: ApprovalAuditTrailState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const snapshot = await state.client.request<ApprovalAuditTrailSnapshot>(
      "approval.audit.get",
      {},
    );
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    let next: ExecApprovalAuditEntry[] = [];
    for (const item of items) {
      if (!isRecord(item)) {
        continue;
      }
      const kind = item.kind === "plugin" ? "plugin" : item.kind === "exec" ? "exec" : null;
      if (!kind) {
        continue;
      }
      const parsed = parseApprovalAuditEntry(kind, item);
      if (!parsed) {
        continue;
      }
      next = addExecApprovalAuditEntry(next, parsed, 20);
    }
    state.execApprovalAuditTrail = next;
  } catch (err) {
    state.lastError = String(err);
  }
}
