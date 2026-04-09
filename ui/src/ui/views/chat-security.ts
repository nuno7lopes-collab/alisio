import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import type { ExecApprovalAuditEntry, ExecApprovalRequest } from "../controllers/exec-approval.ts";
import { sortExecApprovalQueue } from "../controllers/exec-approval.ts";
import type {
  SecurityAccessDiagnostics,
  SecurityAccessMode,
} from "../controllers/security-access.ts";
import { formatRelativeTimestamp } from "../format.ts";
import type { NativeShellState } from "../types.ts";
import {
  resolveApprovalAccessLabel,
  resolveApprovalAuditEffectText,
  resolveApprovalAskLabel,
  resolveApprovalAuditRows,
  resolveApprovalCommandText,
  resolveApprovalDecisionLabel,
  resolveApprovalEffectText,
  resolveApprovalSummaryRows,
} from "./approval-summary.ts";
import { formatApprovalRemaining } from "./exec-approval.ts";
import {
  nativeShellPermissionLabel,
  NATIVE_SHELL_PERMISSION_ORDER,
} from "./native-shell-permissions.ts";

type ApprovalDecision = "allow-once" | "allow-always" | "deny";

export type ChatSecurityConsoleProps = {
  assistantName: string;
  assistantAgentId: string | null;
  accessMode?: SecurityAccessMode | null;
  accessModeLoading?: boolean;
  accessModeBusy?: boolean;
  securityDiagnostics?: SecurityAccessDiagnostics | null;
  connected: boolean;
  approvalQueue: ExecApprovalRequest[];
  approvalAuditTrail: ExecApprovalAuditEntry[];
  approvalBusy?: boolean;
  nativeShellLoading?: boolean;
  nativeShellError?: string | null;
  nativeShellState?: NativeShellState | null;
  onApplyAccessMode?: (mode: Exclude<SecurityAccessMode, "custom">) => void;
  onResolveApproval?: (entry: ExecApprovalRequest, decision: ApprovalDecision) => void;
  onOpenAdvancedSecurity?: () => void;
  onOpenNativeSettings?: () => void;
};

function accessModeLabel(mode: SecurityAccessMode) {
  if (mode === "full-access") {
    return t("alisio.security.access.fullAccess.label");
  }
  if (mode === "recommended") {
    return t("alisio.security.access.recommended.label");
  }
  return t("alisio.security.access.custom.label");
}

function accessModeDescription(mode: SecurityAccessMode) {
  if (mode === "recommended") {
    return t("alisio.security.access.recommended.description");
  }
  if (mode === "full-access") {
    return t("alisio.security.access.fullAccess.description");
  }
  return t("alisio.security.access.customBody");
}

function resolveGuardrailLabel(security?: string | null) {
  return resolveApprovalAccessLabel({
    command: "policy",
    security,
  });
}

function renderMetaItem(label: string, value: string | number) {
  return html`<span class="pill alisio-security-meta-item">${label}: ${value}</span>`;
}

function renderApprovalMeta(
  label: string,
  value: string | null | undefined,
  opts: { tone?: "code" | "text" } = {},
) {
  if (!value) {
    return nothing;
  }
  const tone = opts.tone ?? "text";
  return html`
    <div class="exec-approval-meta-row">
      <span>${label}</span>
      <span class="exec-approval-meta-row__value exec-approval-meta-row__value--${tone}">
        ${value}
      </span>
    </div>
  `;
}

function summarizeNativeShellAccess(state: NativeShellState | null | undefined) {
  if (!state) {
    return null;
  }
  const missing = NATIVE_SHELL_PERMISSION_ORDER.filter(
    (permission) => !state.permissions[permission],
  );
  return {
    total: NATIVE_SHELL_PERMISSION_ORDER.length,
    granted: NATIVE_SHELL_PERMISSION_ORDER.length - missing.length,
    missingLabels: missing.map((permission) => nativeShellPermissionLabel(permission)),
  };
}

function formatMissingPermissions(labels: string[]) {
  const visible = labels.slice(0, 2);
  if (labels.length <= 2) {
    return visible.join(", ");
  }
  return `${visible.join(", ")} +${labels.length - visible.length}`;
}

function renderSummaryCard(params: {
  title: string;
  value: string;
  detail: string[];
  actionLabel?: string;
  onAction?: () => void;
}) {
  return html`
    <article class="alisio-chat__security-summary-card">
      <div class="alisio-chat__security-summary-card__head">
        <span class="alisio-chat__security-summary-card__title">${params.title}</span>
        ${params.actionLabel && params.onAction
          ? html`
              <button class="btn btn--sm" type="button" @click=${params.onAction}>
                ${params.actionLabel}
              </button>
            `
          : nothing}
      </div>
      <strong class="alisio-chat__security-summary-card__value">${params.value}</strong>
      <div class="alisio-chat__security-summary-card__detail">
        ${params.detail.map((line) => html`<span>${line}</span>`)}
      </div>
    </article>
  `;
}

function renderPendingApproval(
  entry: ExecApprovalRequest,
  props: ChatSecurityConsoleProps,
  nowMs: number,
) {
  const expiresIn = Math.max(0, entry.expiresAtMs - nowMs);
  const title =
    entry.kind === "plugin"
      ? (entry.pluginTitle ?? t("alisio.security.queue.pluginApproval"))
      : resolveApprovalCommandText(entry.request);
  const effectText = resolveApprovalEffectText(entry);
  const rows = resolveApprovalSummaryRows(entry, {
    assistantName: props.assistantName,
    assistantAgentId: props.assistantAgentId,
  });
  const commandText =
    entry.kind === "plugin"
      ? (entry.pluginDescription ?? entry.pluginTitle ?? t("alisio.security.queue.pluginApproval"))
      : resolveApprovalCommandText(entry.request);
  const actionsDisabled =
    !props.onResolveApproval ||
    props.approvalBusy ||
    props.accessModeBusy ||
    props.accessModeLoading;

  return html`
    <article class="exec-approval-card alisio-security-queue-item alisio-chat__security-queue-item">
      <div class="exec-approval-header">
        <div>
          <div class="exec-approval-title">${title}</div>
          <div class="exec-approval-sub">${effectText}</div>
        </div>
        <span class="pill">
          ${t("alisio.security.queue.expiresIn", { value: formatApprovalRemaining(expiresIn) })}
        </span>
      </div>
      ${entry.kind === "plugin" && entry.pluginDescription
        ? html`
            <pre class="exec-approval-command mono" style="white-space: pre-wrap;">
${entry.pluginDescription}</pre
            >
          `
        : html`<div class="exec-approval-command mono">${commandText}</div>`}
      ${entry.kind === "exec" && entry.request.commandPreview
        ? html`
            <div class="exec-approval-sub">
              ${t("alisio.security.queue.previewExact", { value: entry.request.command })}
            </div>
          `
        : nothing}
      ${entry.kind === "plugin" && entry.pluginToolName
        ? html`
            <div class="exec-approval-sub">
              ${t("alisio.security.queue.previewTool", { value: entry.pluginToolName })}
            </div>
          `
        : nothing}
      <div class="exec-approval-meta">
        ${renderApprovalMeta(t("alisio.security.queue.labels.type"), entry.kind)}
        ${rows.map((row) => renderApprovalMeta(row.label, row.value, { tone: row.tone }))}
      </div>
      <div class="exec-approval-actions">
        <button
          class="btn primary"
          ?disabled=${actionsDisabled}
          @click=${() => props.onResolveApproval?.(entry, "allow-once")}
        >
          ${t("alisio.security.queue.allowOnce")}
        </button>
        <button
          class="btn"
          ?disabled=${actionsDisabled}
          @click=${() => props.onResolveApproval?.(entry, "allow-always")}
        >
          ${t("alisio.security.queue.allowAlways")}
        </button>
        <button
          class="btn danger"
          ?disabled=${actionsDisabled}
          @click=${() => props.onResolveApproval?.(entry, "deny")}
        >
          ${t("alisio.security.queue.deny")}
        </button>
      </div>
    </article>
  `;
}

function renderAuditEntry(entry: ExecApprovalAuditEntry, props: ChatSecurityConsoleProps) {
  const rows = resolveApprovalAuditRows(entry, {
    assistantName: props.assistantName,
    assistantAgentId: props.assistantAgentId,
  });
  return html`
    <article class="exec-approval-card alisio-security-queue-item alisio-chat__security-queue-item">
      <div class="exec-approval-header">
        <div>
          <div class="exec-approval-title">${entry.title}</div>
          <div class="exec-approval-sub">${resolveApprovalAuditEffectText(entry)}</div>
        </div>
        <span class="pill">${resolveApprovalDecisionLabel(entry.decision)}</span>
      </div>
      <div class="exec-approval-meta">
        ${rows.map((row) => renderApprovalMeta(row.label, row.value, { tone: row.tone }))}
        ${renderApprovalMeta(
          t("alisio.security.audit.labels.when"),
          formatRelativeTimestamp(entry.ts, { dateFallback: true }),
        )}
        ${renderApprovalMeta(
          t("alisio.security.audit.labels.resolvedBy"),
          entry.resolvedBy ?? t("alisio.security.audit.systemActor"),
        )}
      </div>
    </article>
  `;
}

export function renderChatSecurityConsole(
  props: ChatSecurityConsoleProps,
): TemplateResult | typeof nothing {
  if (
    !props.onApplyAccessMode &&
    !props.onResolveApproval &&
    !props.onOpenAdvancedSecurity &&
    props.approvalQueue.length === 0 &&
    props.approvalAuditTrail.length === 0
  ) {
    return nothing;
  }

  const queue = sortExecApprovalQueue(props.approvalQueue);
  const recentAudit = props.approvalAuditTrail.slice(0, 3);
  const currentMode = props.accessMode ?? props.securityDiagnostics?.mode ?? null;
  const modeDescription = currentMode ? accessModeDescription(currentMode) : null;
  const configOverrideCount = props.securityDiagnostics?.configOverrideAgentCount ?? 0;
  const approvalOverrideCount = props.securityDiagnostics?.approvalOverrideAgentCount ?? 0;
  const showCustomNote =
    currentMode === "custom" && (configOverrideCount > 0 || approvalOverrideCount > 0);
  const nativeShellSummary = summarizeNativeShellAccess(props.nativeShellState);
  const busy = Boolean(props.accessModeBusy || props.accessModeLoading);
  const disabled = !props.connected || busy;
  const nowMs = Date.now();
  const policyDetails = props.securityDiagnostics
    ? [
        t("alisio.chat.access.policyRuntime", {
          value: `${resolveGuardrailLabel(props.securityDiagnostics.configDefaults.security)} · ${resolveApprovalAskLabel(
            props.securityDiagnostics.configDefaults.ask,
          )}`,
        }),
        t("alisio.chat.access.policyApprovals", {
          value: `${resolveGuardrailLabel(props.securityDiagnostics.approvalDefaults.security)} · ${resolveApprovalAskLabel(
            props.securityDiagnostics.approvalDefaults.ask,
          )}`,
        }),
        t("alisio.chat.access.policyFallback", {
          value: resolveGuardrailLabel(props.securityDiagnostics.approvalDefaults.askFallback),
        }),
        showCustomNote
          ? t("alisio.security.access.customFooter", {
              config: String(configOverrideCount),
              approvals: String(approvalOverrideCount),
            })
          : t("alisio.chat.access.policyOverridesAligned"),
      ]
    : [t("alisio.chat.access.loading")];
  const computerDetails =
    props.nativeShellLoading && !nativeShellSummary
      ? {
          value: t("alisio.chat.access.computerLoading"),
          detail: [t("alisio.chat.access.computerLoading")],
        }
      : props.nativeShellError
        ? {
            value: t("common.unavailable"),
            detail: [props.nativeShellError],
          }
        : nativeShellSummary
          ? {
              value: t("alisio.chat.access.computerGranted", {
                granted: String(nativeShellSummary.granted),
                total: String(nativeShellSummary.total),
              }),
              detail: [
                nativeShellSummary.missingLabels.length > 0
                  ? t("alisio.chat.access.computerNeedsReview", {
                      value: formatMissingPermissions(nativeShellSummary.missingLabels),
                    })
                  : t("alisio.chat.access.computerAllGranted"),
              ],
            }
          : {
              value: t("common.unavailable"),
              detail: [t("alisio.chat.access.computerUnavailable")],
            };

  return html`
    <section class="alisio-chat__security-console" aria-label=${t("alisio.chat.access.aria")}>
      <div class="alisio-chat__security-head">
        <div class="alisio-chat__security-copy">
          <span class="pill">${t("alisio.security.eyebrow")}</span>
          <strong>${t("alisio.chat.access.title")}</strong>
          <span>${t("alisio.chat.access.subtitle")}</span>
        </div>
      </div>

      <div class="alisio-chat__security-meta">
        ${renderMetaItem(
          t("alisio.security.stats.mode"),
          currentMode ? accessModeLabel(currentMode) : t("alisio.chat.access.loading"),
        )}
        ${renderMetaItem(t("alisio.security.stats.pending"), queue.length)}
      </div>

      <div class="alisio-chat__security-summary-grid">
        ${renderSummaryCard({
          title: t("alisio.chat.access.policyTitle"),
          value: currentMode ? accessModeLabel(currentMode) : t("alisio.chat.access.loading"),
          detail: policyDetails,
          actionLabel: props.onOpenAdvancedSecurity
            ? t("alisio.chat.access.openAdvanced")
            : undefined,
          onAction: props.onOpenAdvancedSecurity,
        })}
        ${renderSummaryCard({
          title: t("alisio.chat.access.computerTitle"),
          value: computerDetails.value,
          detail: computerDetails.detail,
          actionLabel:
            props.onOpenNativeSettings && nativeShellSummary
              ? t("alisio.chat.access.openComputerSettings")
              : undefined,
          onAction: props.onOpenNativeSettings,
        })}
      </div>

      <div
        class="alisio-chat__access-strip"
        role="group"
        aria-label=${t("alisio.chat.access.aria")}
      >
        <button
          type="button"
          class="alisio-chat__access-pill ${currentMode === "recommended" ? "is-active" : ""}"
          ?disabled=${disabled || currentMode === "recommended"}
          @click=${() => props.onApplyAccessMode?.("recommended")}
        >
          <span>${t("alisio.security.access.recommended.label")}</span>
        </button>
        <button
          type="button"
          class="alisio-chat__access-pill ${currentMode === "full-access" ? "is-active" : ""}"
          ?disabled=${disabled || currentMode === "full-access"}
          @click=${() => props.onApplyAccessMode?.("full-access")}
        >
          <span>${t("alisio.security.access.fullAccess.label")}</span>
        </button>
      </div>

      ${modeDescription
        ? html`<div class="alisio-chat__security-note">${modeDescription}</div>`
        : nothing}

      <div class="alisio-chat__security-section">
        <div class="alisio-chat__security-section-title">
          ${t("alisio.security.queue.title")}
          ${queue.length
            ? html`<span class="pill">
                ${t("alisio.security.queue.pendingCount", { count: String(queue.length) })}
              </span>`
            : nothing}
        </div>
        ${queue.length
          ? html`
              <div class="alisio-security-approval-list">
                ${queue.slice(0, 2).map((entry) => renderPendingApproval(entry, props, nowMs))}
              </div>
            `
          : html`
              <div class="alisio-security-empty">
                <strong>${t("alisio.security.queue.emptyTitle")}</strong>
                <span>${t("alisio.security.queue.emptyBody")}</span>
              </div>
            `}
      </div>

      ${recentAudit.length
        ? html`
            <div class="alisio-chat__security-section">
              <div class="alisio-chat__security-section-title">
                ${t("alisio.security.audit.title")}
              </div>
              <div class="alisio-security-approval-list">
                ${recentAudit.map((entry) => renderAuditEntry(entry, props))}
              </div>
            </div>
          `
        : nothing}
    </section>
  `;
}
