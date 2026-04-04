import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { ExecApprovalRequest } from "../controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "../controllers/exec-approvals.ts";
import {
  resolveConfiguredExecDefaults,
  type SecurityAccessMode,
} from "../controllers/security-access.ts";
import { resolveAgentIdDisplayLabel } from "./agent-display.ts";
import { formatApprovalRemaining } from "./exec-approval.ts";
import { renderExecApprovals, resolveExecApprovalsState } from "./nodes-exec-approvals.ts";
import { resolveSessionDisplayName } from "./session-display.ts";

type ExecAsk = "off" | "on-miss" | "always";
type ApprovalDecision = "allow-once" | "allow-always" | "deny";

export type SecurityProps = {
  assistantName: string;
  assistantAgentId: string | null;
  loading: boolean;
  nodes: Array<Record<string, unknown>>;
  configSnapshot?: { config?: Record<string, unknown> | null } | null;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  configFormMode: "form" | "raw";
  execApprovalsLoading: boolean;
  execApprovalsSaving: boolean;
  execApprovalsDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: ExecApprovalsFile | null;
  execApprovalsSelectedAgent: string | null;
  execApprovalsTarget: "gateway" | "node";
  execApprovalsTargetNodeId: string | null;
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalBusy: boolean;
  execApprovalError: string | null;
  gatewayAccessModeLoading: boolean;
  gatewayAccessModeBusy: boolean;
  gatewayAccessMode: SecurityAccessMode | null;
  onRefresh: () => void;
  onLoadExecApprovals: () => void;
  onExecApprovalsTargetChange: (kind: "gateway" | "node", nodeId: string | null) => void;
  onExecApprovalsSelectAgent: (agentId: string) => void;
  onExecApprovalsPatch: (path: Array<string | number>, value: unknown) => void;
  onExecApprovalsRemove: (path: Array<string | number>) => void;
  onSaveExecApprovals: () => void;
  onResolveApproval: (entry: ExecApprovalRequest, decision: ApprovalDecision) => void;
  onApplyAccessMode: (mode: Exclude<SecurityAccessMode, "custom">) => void;
};

export function supportsRuntimeAccessModeTarget(target: "gateway" | "node"): boolean {
  return target === "gateway";
}

function resolveTargetLabel(props: SecurityProps) {
  if (props.execApprovalsTarget !== "node") {
    return t("alisio.security.targets.gateway");
  }
  return props.execApprovalsTargetNodeId?.trim() || t("alisio.security.targets.node");
}

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

function promptModeLabel(ask: ExecAsk) {
  if (ask === "always") {
    return t("alisio.connections.execApprovals.askOptions.always");
  }
  if (ask === "off") {
    return t("alisio.connections.execApprovals.askOptions.off");
  }
  return t("alisio.connections.execApprovals.askOptions.onMiss");
}

function renderSecuritySummaryChip(value: string | number, label: string) {
  return html`
    <div class="alisio-security-summary-chip">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderApprovalMeta(label: string, value: string | null | undefined) {
  if (!value) {
    return nothing;
  }
  return html`
    <div class="exec-approval-meta-row">
      <span>${label}</span>
      <span>${value}</span>
    </div>
  `;
}

function renderPendingApproval(entry: ExecApprovalRequest, props: SecurityProps, nowMs: number) {
  const expiresIn = Math.max(0, entry.expiresAtMs - nowMs);
  const title =
    entry.kind === "plugin"
      ? (entry.pluginTitle ?? t("alisio.security.queue.pluginApproval"))
      : entry.request.command;
  const agentLabel = resolveAgentIdDisplayLabel(entry.request.agentId, {
    assistantName: props.assistantName,
    assistantAgentId: props.assistantAgentId,
  });
  const sessionLabel = resolveSessionDisplayName(entry.request.sessionKey ?? "", undefined, {
    assistantName: props.assistantName,
    assistantAgentId: props.assistantAgentId,
  });

  return html`
    <article class="exec-approval-card alisio-security-queue-item">
      <div class="exec-approval-header">
        <div>
          <div class="exec-approval-title">${title}</div>
          <div class="exec-approval-sub">
            ${entry.kind === "plugin"
              ? t("alisio.security.queue.pluginSubtitle")
              : t("alisio.security.queue.execSubtitle")}
          </div>
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
        : html`<div class="exec-approval-command mono">${entry.request.command}</div>`}
      <div class="exec-approval-meta">
        ${renderApprovalMeta(t("alisio.security.queue.labels.type"), entry.kind)}
        ${renderApprovalMeta(t("alisio.connections.execApprovals.host"), entry.request.host)}
        ${renderApprovalMeta(t("alisio.security.queue.labels.plugin"), entry.pluginId)}
        ${renderApprovalMeta(t("alisio.security.queue.labels.agent"), agentLabel)}
        ${renderApprovalMeta(t("alisio.security.queue.labels.session"), sessionLabel)}
        ${renderApprovalMeta(t("alisio.security.queue.labels.cwd"), entry.request.cwd)}
        ${renderApprovalMeta(
          t("alisio.connections.execApprovals.security"),
          entry.request.security,
        )}
        ${renderApprovalMeta(t("alisio.connections.execApprovals.ask"), entry.request.ask)}
      </div>
      <div class="exec-approval-actions">
        <button
          class="btn primary"
          ?disabled=${props.execApprovalBusy}
          @click=${() => props.onResolveApproval(entry, "allow-once")}
        >
          ${t("alisio.security.queue.allowOnce")}
        </button>
        <button
          class="btn"
          ?disabled=${props.execApprovalBusy}
          @click=${() => props.onResolveApproval(entry, "allow-always")}
        >
          ${t("alisio.security.queue.allowAlways")}
        </button>
        <button
          class="btn danger"
          ?disabled=${props.execApprovalBusy}
          @click=${() => props.onResolveApproval(entry, "deny")}
        >
          ${t("alisio.security.queue.deny")}
        </button>
      </div>
    </article>
  `;
}

function renderApprovalQueue(props: SecurityProps, nowMs: number) {
  const queue = [...props.execApprovalQueue].toSorted(
    (left, right) => left.expiresAtMs - right.expiresAtMs,
  );
  return html`
    <section class="card alisio-security-panel">
      <div class="alisio-security-panel__head">
        <div>
          <div class="card-title">${t("alisio.security.queue.title")}</div>
          <div class="card-sub">${t("alisio.security.queue.subtitle")}</div>
        </div>
        ${queue.length > 0
          ? html`<span class="pill">
              ${t("alisio.security.queue.pendingCount", { count: String(queue.length) })}
            </span>`
          : nothing}
      </div>
      ${props.execApprovalError
        ? html`<div class="callout danger">${props.execApprovalError}</div>`
        : nothing}
      ${queue.length === 0
        ? html`
            <div class="alisio-security-empty">
              <strong>${t("alisio.security.queue.emptyTitle")}</strong>
              <span>${t("alisio.security.queue.emptyBody")}</span>
            </div>
          `
        : html`
            <div class="alisio-security-approval-list">
              ${queue.map((entry) => renderPendingApproval(entry, props, nowMs))}
            </div>
          `}
    </section>
  `;
}

function resolveAccessModeBlockMessage(props: SecurityProps): string | null {
  if (props.configDirty && props.configFormMode === "raw") {
    return t("alisio.security.access.lockedByRawConfig");
  }
  if (supportsRuntimeAccessModeTarget(props.execApprovalsTarget) && props.execApprovalsDirty) {
    return t("alisio.security.access.lockedByExecApprovals");
  }
  return null;
}

function renderAccessModePanel(props: SecurityProps) {
  if (!supportsRuntimeAccessModeTarget(props.execApprovalsTarget)) {
    return html`
      <div class="alisio-security-access">
        <div>
          <div class="card-title">${t("alisio.security.access.title")}</div>
          <div class="card-sub">${t("alisio.security.access.subtitle")}</div>
        </div>
        <span class="pill">${t("alisio.security.access.gatewayOnlyShort")}</span>
        <div class="callout warn">
          <strong>${t("alisio.security.access.gatewayOnlyTitle")}</strong>
          <div>${t("alisio.security.access.gatewayOnlyBody")}</div>
        </div>
      </div>
    `;
  }

  const mode = props.gatewayAccessMode;
  const ready = mode !== null && !props.gatewayAccessModeLoading;
  const blockedMessage = resolveAccessModeBlockMessage(props);
  const busy = props.gatewayAccessModeBusy || props.gatewayAccessModeLoading;
  const disabled = busy || Boolean(blockedMessage);

  return html`
    <div class="alisio-security-access">
      <div>
        <div class="card-title">${t("alisio.security.access.title")}</div>
        <div class="card-sub">${t("alisio.security.access.subtitle")}</div>
      </div>
      ${!ready
        ? html`
            <div class="alisio-security-empty">
              <strong>${t("alisio.security.access.loadTitle")}</strong>
              <span>${t("alisio.security.access.loadBody")}</span>
            </div>
          `
        : html`
            <div class="alisio-security-access__strip">
              <button
                type="button"
                data-security-mode="recommended"
                class="alisio-chat__access-pill ${mode === "recommended" ? "is-active" : ""}"
                ?disabled=${disabled || mode === "recommended"}
                aria-pressed=${mode === "recommended"}
                @click=${() => props.onApplyAccessMode("recommended")}
              >
                <span>${t("alisio.security.access.recommended.title")}</span>
              </button>
              <button
                type="button"
                data-security-mode="full-access"
                class="alisio-chat__access-pill ${mode === "full-access" ? "is-active" : ""}"
                ?disabled=${disabled || mode === "full-access"}
                aria-pressed=${mode === "full-access"}
                @click=${() => props.onApplyAccessMode("full-access")}
              >
                <span>${t("alisio.security.access.fullAccess.label")}</span>
              </button>
              ${mode === "custom"
                ? html`<span class="pill">${t("alisio.security.access.custom.label")}</span>`
                : nothing}
            </div>
            ${blockedMessage ? html`<div class="callout warn">${blockedMessage}</div>` : nothing}
            <div class="alisio-security-access__note">${accessModeDescription(mode)}</div>
          `}
    </div>
  `;
}

export function renderSecurity(props: SecurityProps) {
  const approvalsState = resolveExecApprovalsState(props);
  const mode = supportsRuntimeAccessModeTarget(props.execApprovalsTarget)
    ? props.gatewayAccessMode
    : null;
  const gatewayDefaults = resolveConfiguredExecDefaults(props.configSnapshot?.config ?? null);
  const promptAsk =
    props.execApprovalsTarget === "node" ? approvalsState.defaults.ask : gatewayDefaults.ask;
  const nowMs = Date.now();

  return html`
    <section class="alisio-page alisio-security-page">
      <div class="card alisio-connections-hero alisio-security-hero alisio-security-shell">
        <div class="alisio-connections-hero__head">
          <div>
            <div class="card-title">${t("alisio.security.title")}</div>
            <div class="card-sub">${t("alisio.security.subtitle")}</div>
          </div>
          <button
            class="btn"
            ?disabled=${props.loading || props.execApprovalsLoading}
            @click=${props.onRefresh}
          >
            ${props.loading || props.execApprovalsLoading
              ? t("alisio.security.refreshing")
              : t("alisio.security.refreshAll")}
          </button>
        </div>

        <div class="alisio-security-summary">
          ${renderSecuritySummaryChip(
            mode ? accessModeLabel(mode) : t("alisio.security.access.gatewayOnlyShort"),
            t("alisio.security.stats.mode"),
          )}
          ${renderSecuritySummaryChip(
            props.execApprovalQueue.length,
            t("alisio.security.stats.pending"),
          )}
          ${renderSecuritySummaryChip(resolveTargetLabel(props), t("alisio.security.stats.target"))}
          ${renderSecuritySummaryChip(
            promptModeLabel(promptAsk),
            t("alisio.security.stats.prompt"),
          )}
        </div>

        ${renderAccessModePanel(props)}
      </div>

      <div class="alisio-connections-stack">
        ${renderApprovalQueue(props, nowMs)} ${renderExecApprovals(approvalsState)}
      </div>
    </section>
  `;
}
