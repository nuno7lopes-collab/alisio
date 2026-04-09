import type { ExecApprovalDecision } from "../../infra/exec-approvals.js";
import type { PluginApprovalRequestPayload } from "../../infra/plugin-approvals.js";
import {
  validateApprovalAuditGetParams,
  validateApprovalPendingGetParams,
} from "../protocol/index.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

type GatewayLogger = {
  info?: (message: string) => void;
};

type ExecApprovalAuditRequest = {
  command: string;
  commandPreview?: string | null;
  envKeys?: string[] | null;
  host?: string | null;
  nodeId?: string | null;
  security?: string | null;
  ask?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
  cwd?: string | null;
  resolvedPath?: string | null;
};

export type ApprovalAuditTrailEntry =
  | {
      kind: "exec";
      id: string;
      decision: ExecApprovalDecision;
      resolvedBy?: string | null;
      ts: number;
      request: ExecApprovalAuditRequest;
    }
  | {
      kind: "plugin";
      id: string;
      decision: ExecApprovalDecision;
      resolvedBy?: string | null;
      ts: number;
      request: PluginApprovalRequestPayload;
    };

export type ApprovalAuditTrailSnapshot = {
  items: ApprovalAuditTrailEntry[];
};

export type ApprovalPendingEntry =
  | {
      kind: "exec";
      id: string;
      createdAtMs: number;
      expiresAtMs: number;
      request: ExecApprovalAuditRequest;
    }
  | {
      kind: "plugin";
      id: string;
      createdAtMs: number;
      expiresAtMs: number;
      request: PluginApprovalRequestPayload;
    };

export type ApprovalPendingSnapshot = {
  items: ApprovalPendingEntry[];
};

const APPROVAL_AUDIT_TRAIL_LIMIT = 20;
const approvalAuditTrail: ApprovalAuditTrailEntry[] = [];

function cloneAuditValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return value;
}

function addApprovalAuditTrailEntry(entry: ApprovalAuditTrailEntry) {
  const next = approvalAuditTrail.filter((item) => item.id !== entry.id);
  next.unshift(entry);
  approvalAuditTrail.splice(
    0,
    approvalAuditTrail.length,
    ...next.slice(0, APPROVAL_AUDIT_TRAIL_LIMIT),
  );
}

export function listApprovalAuditTrail(): ApprovalAuditTrailEntry[] {
  return approvalAuditTrail.map((entry) => cloneAuditValue(entry));
}

export function listPendingApprovalSnapshot(
  context: Pick<GatewayRequestContext, "execApprovalManager" | "pluginApprovalManager">,
): ApprovalPendingSnapshot {
  const execItems =
    context.execApprovalManager?.listPendingSnapshots().map((record) => ({
      kind: "exec" as const,
      id: record.id,
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
      request: normalizeExecApprovalAuditRequest(record.request),
    })) ?? [];
  const pluginItems =
    context.pluginApprovalManager?.listPendingSnapshots().map((record) => ({
      kind: "plugin" as const,
      id: record.id,
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
      request: cloneAuditValue(record.request),
    })) ?? [];
  return { items: [...execItems, ...pluginItems] };
}

export function __resetApprovalAuditTrailForTest() {
  approvalAuditTrail.length = 0;
}

function appendPart(parts: string[], key: string, value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return;
  }
  parts.push(`${key}=${JSON.stringify(normalized)}`);
}

function normalizeExecApprovalAuditRequest(
  request: Partial<ExecApprovalAuditRequest> | null | undefined,
): ExecApprovalAuditRequest {
  return {
    command:
      typeof request?.command === "string" && request.command.trim()
        ? request.command.trim()
        : "[unknown]",
    commandPreview: typeof request?.commandPreview === "string" ? request.commandPreview : null,
    envKeys: Array.isArray(request?.envKeys) ? request.envKeys : null,
    host: typeof request?.host === "string" ? request.host : null,
    nodeId: typeof request?.nodeId === "string" ? request.nodeId : null,
    security: typeof request?.security === "string" ? request.security : null,
    ask: typeof request?.ask === "string" ? request.ask : null,
    agentId: typeof request?.agentId === "string" ? request.agentId : null,
    sessionKey: typeof request?.sessionKey === "string" ? request.sessionKey : null,
    cwd: typeof request?.cwd === "string" ? request.cwd : null,
    resolvedPath: typeof request?.resolvedPath === "string" ? request.resolvedPath : null,
  };
}

function buildExecApprovalAuditParts(request: ExecApprovalAuditRequest): string[] {
  const parts: string[] = [];
  appendPart(parts, "host", request.host);
  appendPart(parts, "nodeId", request.nodeId);
  appendPart(parts, "security", request.security);
  appendPart(parts, "ask", request.ask);
  appendPart(parts, "agent", request.agentId);
  appendPart(parts, "session", request.sessionKey);
  appendPart(parts, "cwd", request.cwd);
  appendPart(parts, "resolvedPath", request.resolvedPath);
  appendPart(parts, "commandPreview", request.commandPreview);
  if (Array.isArray(request.envKeys) && request.envKeys.length > 0) {
    parts.push(`envKeys=${JSON.stringify(request.envKeys.join(","))}`);
  }
  appendPart(parts, "command", request.command);
  return parts;
}

export function logExecApprovalRequested(
  logGateway: GatewayLogger | null | undefined,
  params: { id: string; request: ExecApprovalAuditRequest },
) {
  const parts = buildExecApprovalAuditParts(normalizeExecApprovalAuditRequest(params.request));
  logGateway?.info?.(`approval audit kind=exec phase=requested id=${params.id} ${parts.join(" ")}`);
}

export function logExecApprovalResolved(
  logGateway: GatewayLogger | null | undefined,
  params: {
    id: string;
    request: ExecApprovalAuditRequest | null | undefined;
    decision: ExecApprovalDecision;
    resolvedBy?: string | null;
  },
) {
  const parts = buildExecApprovalAuditParts(normalizeExecApprovalAuditRequest(params.request));
  appendPart(parts, "resolvedBy", params.resolvedBy);
  logGateway?.info?.(
    `approval audit kind=exec phase=resolved id=${params.id} decision=${params.decision} ${parts.join(" ")}`,
  );
}

export function rememberExecApprovalResolved(params: {
  id: string;
  request: ExecApprovalAuditRequest | null | undefined;
  decision: ExecApprovalDecision;
  resolvedBy?: string | null;
  ts: number;
}) {
  addApprovalAuditTrailEntry({
    kind: "exec",
    id: params.id,
    decision: params.decision,
    resolvedBy: params.resolvedBy ?? null,
    ts: params.ts,
    request: normalizeExecApprovalAuditRequest(params.request),
  });
}

export function logPluginApprovalRequested(
  logGateway: GatewayLogger | null | undefined,
  params: { id: string; request: PluginApprovalRequestPayload },
) {
  const parts: string[] = [];
  appendPart(parts, "pluginId", params.request.pluginId);
  appendPart(parts, "severity", params.request.severity);
  appendPart(parts, "toolName", params.request.toolName);
  appendPart(parts, "agent", params.request.agentId);
  appendPart(parts, "session", params.request.sessionKey);
  appendPart(parts, "title", params.request.title);
  logGateway?.info?.(
    `approval audit kind=plugin phase=requested id=${params.id} ${parts.join(" ")}`,
  );
}

export function logPluginApprovalResolved(
  logGateway: GatewayLogger | null | undefined,
  params: {
    id: string;
    request: PluginApprovalRequestPayload | null | undefined;
    decision: ExecApprovalDecision;
    resolvedBy?: string | null;
  },
) {
  const request: Partial<PluginApprovalRequestPayload> = params.request ?? {};
  const parts: string[] = [];
  appendPart(parts, "pluginId", request.pluginId);
  appendPart(parts, "severity", request.severity);
  appendPart(parts, "toolName", request.toolName);
  appendPart(parts, "agent", request.agentId);
  appendPart(parts, "session", request.sessionKey);
  appendPart(parts, "title", request.title);
  appendPart(parts, "resolvedBy", params.resolvedBy);
  logGateway?.info?.(
    `approval audit kind=plugin phase=resolved id=${params.id} decision=${params.decision} ${parts.join(" ")}`,
  );
}

export function rememberPluginApprovalResolved(params: {
  id: string;
  request: PluginApprovalRequestPayload | null | undefined;
  decision: ExecApprovalDecision;
  resolvedBy?: string | null;
  ts: number;
}) {
  addApprovalAuditTrailEntry({
    kind: "plugin",
    id: params.id,
    decision: params.decision,
    resolvedBy: params.resolvedBy ?? null,
    ts: params.ts,
    request: cloneAuditValue(params.request ?? { title: "", description: "" }),
  });
}

export const approvalAuditHandlers: GatewayRequestHandlers = {
  "approval.audit.get": ({ params, respond }) => {
    if (!assertValidParams(params, validateApprovalAuditGetParams, "approval.audit.get", respond)) {
      return;
    }
    respond(true, { items: listApprovalAuditTrail() }, undefined);
  },
  "approval.pending.get": ({ params, respond, context }) => {
    if (
      !assertValidParams(params, validateApprovalPendingGetParams, "approval.pending.get", respond)
    ) {
      return;
    }
    respond(true, listPendingApprovalSnapshot(context), undefined);
  },
};
