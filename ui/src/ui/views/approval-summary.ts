import { t } from "../../i18n/index.ts";
import type {
  ExecApprovalAuditEntry,
  ExecApprovalRequest,
  ExecApprovalRequestPayload,
} from "../controllers/exec-approval.ts";
import { resolveAgentIdDisplayLabel } from "./agent-display.ts";
import { resolveSessionDisplayName } from "./session-display.ts";

export type ApprovalSummaryIdentity = {
  assistantName: string;
  assistantAgentId: string | null;
};

export type ApprovalSummaryRow = {
  label: string;
  value: string;
  tone?: "code" | "text";
};

export function resolveApprovalTargetLabel(request: ExecApprovalRequestPayload): string {
  if (request.host === "sandbox") {
    return t("alisio.security.queue.targets.sandbox");
  }
  if (request.host === "node") {
    return request.nodeId
      ? t("alisio.security.queue.targets.nodeWithId", { value: request.nodeId })
      : t("alisio.security.queue.targets.node");
  }
  if (request.host === "gateway") {
    return t("alisio.security.queue.targets.gateway");
  }
  if (typeof request.host === "string" && request.host.trim()) {
    return request.host.trim();
  }
  return t("alisio.security.queue.targets.runtime");
}

export function resolveApprovalAccessLabel(request: ExecApprovalRequestPayload): string {
  if (request.security === "full") {
    return t("alisio.security.queue.access.full");
  }
  if (request.security === "allowlist") {
    return t("alisio.security.queue.access.allowlist");
  }
  if (request.security === "deny") {
    return t("alisio.security.queue.access.deny");
  }
  return t("alisio.security.queue.access.configured");
}

export function resolveApprovalAskLabel(ask?: string | null): string {
  if (ask === "always") {
    return t("alisio.connections.execApprovals.askOptions.always");
  }
  if (ask === "off") {
    return t("alisio.connections.execApprovals.askOptions.off");
  }
  if (ask === "on-miss") {
    return t("alisio.connections.execApprovals.askOptions.onMiss");
  }
  return t("alisio.security.queue.review.configured");
}

export function resolveApprovalCommandText(request: ExecApprovalRequestPayload): string {
  const preview = request.commandPreview?.trim() ?? "";
  return preview || request.command;
}

export function resolveApprovalEffectText(entry: ExecApprovalRequest): string {
  if (entry.kind === "plugin") {
    return t("alisio.security.queue.effects.plugin");
  }
  return t("alisio.security.queue.effects.exec", {
    target: resolveApprovalTargetLabel(entry.request),
    access: resolveApprovalAccessLabel(entry.request),
  });
}

export function resolveApprovalDecisionLabel(decision?: string | null): string {
  if (decision === "allow-always") {
    return t("alisio.security.queue.allowAlways");
  }
  if (decision === "allow-once") {
    return t("alisio.security.queue.allowOnce");
  }
  if (decision === "deny") {
    return t("alisio.security.queue.deny");
  }
  return t("common.na");
}

export function resolveApprovalAuditEffectText(entry: ExecApprovalAuditEntry): string {
  if (entry.kind === "plugin") {
    return t("alisio.security.audit.effects.plugin", {
      title: entry.title,
    });
  }
  return t("alisio.security.audit.effects.exec", {
    target: resolveApprovalTargetLabel(entry.request),
    access: resolveApprovalAccessLabel(entry.request),
  });
}

function pushRow(
  rows: ApprovalSummaryRow[],
  label: string,
  value: string | null | undefined,
  tone: "code" | "text" = "text",
) {
  const normalized = value?.trim();
  if (!normalized) {
    return;
  }
  rows.push({ label, value: normalized, tone });
}

export function resolveApprovalSummaryRows(
  entry: ExecApprovalRequest,
  identity: ApprovalSummaryIdentity,
): ApprovalSummaryRow[] {
  const rows: ApprovalSummaryRow[] = [];
  const agentLabel = resolveAgentIdDisplayLabel(entry.request.agentId, identity);
  const sessionLabel = resolveSessionDisplayName(
    entry.request.sessionKey ?? "",
    undefined,
    identity,
  );

  if (entry.kind === "plugin") {
    pushRow(
      rows,
      t("alisio.security.queue.labels.review"),
      t("alisio.security.queue.review.human"),
    );
    pushRow(rows, t("alisio.security.queue.labels.tool"), entry.pluginToolName, "code");
    pushRow(rows, t("alisio.security.queue.labels.plugin"), entry.pluginId, "code");
  } else {
    pushRow(
      rows,
      t("alisio.security.queue.labels.runsOn"),
      resolveApprovalTargetLabel(entry.request),
    );
    pushRow(
      rows,
      t("alisio.security.queue.labels.guardrails"),
      resolveApprovalAccessLabel(entry.request),
    );
    pushRow(
      rows,
      t("alisio.security.queue.labels.review"),
      resolveApprovalAskLabel(entry.request.ask),
    );
    pushRow(rows, t("alisio.security.queue.labels.cwd"), entry.request.cwd, "code");
    pushRow(
      rows,
      t("alisio.security.queue.labels.resolvedPath"),
      entry.request.resolvedPath,
      "code",
    );
    pushRow(rows, t("alisio.security.queue.labels.env"), entry.request.envKeys?.join(", "), "code");
  }

  pushRow(rows, t("alisio.security.queue.labels.agent"), agentLabel);
  pushRow(rows, t("alisio.security.queue.labels.session"), sessionLabel);
  return rows;
}

export function resolveApprovalAuditRows(
  entry: ExecApprovalAuditEntry,
  identity: ApprovalSummaryIdentity,
): ApprovalSummaryRow[] {
  const rows: ApprovalSummaryRow[] = [];
  const agentLabel = resolveAgentIdDisplayLabel(entry.request.agentId, identity);
  const sessionLabel = resolveSessionDisplayName(
    entry.request.sessionKey ?? "",
    undefined,
    identity,
  );

  if (entry.kind === "plugin") {
    pushRow(
      rows,
      t("alisio.security.queue.labels.review"),
      t("alisio.security.queue.review.human"),
    );
  } else {
    pushRow(
      rows,
      t("alisio.security.queue.labels.runsOn"),
      resolveApprovalTargetLabel(entry.request),
    );
    pushRow(
      rows,
      t("alisio.security.queue.labels.guardrails"),
      resolveApprovalAccessLabel(entry.request),
    );
    pushRow(
      rows,
      t("alisio.security.queue.labels.review"),
      resolveApprovalAskLabel(entry.request.ask),
    );
  }
  pushRow(rows, t("alisio.security.queue.labels.agent"), agentLabel);
  pushRow(rows, t("alisio.security.queue.labels.session"), sessionLabel);
  pushRow(rows, t("alisio.security.queue.labels.tool"), entry.pluginToolName, "code");
  pushRow(rows, t("alisio.security.queue.labels.plugin"), entry.pluginId, "code");
  return rows;
}
