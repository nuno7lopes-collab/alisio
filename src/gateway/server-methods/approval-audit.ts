import type { ExecApprovalDecision } from "../../infra/exec-approvals.js";
import type { PluginApprovalRequestPayload } from "../../infra/plugin-approvals.js";

type GatewayLogger = {
  info?: (message: string) => void;
};

type ExecApprovalAuditRequest = {
  command?: string | null;
  host?: string | null;
  nodeId?: string | null;
  security?: string | null;
  ask?: string | null;
  agentId?: string | null;
  sessionKey?: string | null;
};

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
