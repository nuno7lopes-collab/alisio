import { t } from "../../i18n/index.ts";
import type {
  ExecApprovalAuditEntry,
  ExecApprovalRequest,
  ExecApprovalRequestPayload,
} from "../controllers/exec-approval.ts";

export function resolveApprovalTargetLabel(request: ExecApprovalRequestPayload): string {
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
