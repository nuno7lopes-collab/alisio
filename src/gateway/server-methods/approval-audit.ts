import type { ExecApprovalDecision } from "../../infra/exec-approvals.js";
import type { PluginApprovalRequestPayload } from "../../infra/plugin-approvals.js";
import { validateExecApprovalsGetParams } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

type GatewayLogger = {
  info?: (message: string) => void;
};

type ExecApprovalAuditRequest = {
  command?: string | null;
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
  const parts = buildExecApprovalAuditParts(params.request);
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
  const parts = buildExecApprovalAuditParts(params.request ?? {});
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
    request: cloneAuditValue(params.request ?? {}),
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
    if (!assertValidParams(params, validateExecApprovalsGetParams, "approval.audit.get", respond)) {
      return;
    }
    respond(true, { items: listApprovalAuditTrail() }, undefined);
  },
};
