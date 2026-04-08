import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import {
  sortExecApprovalQueue,
  type ExecApprovalAuditEntry,
  type ExecApprovalRequest,
} from "../controllers/exec-approval.ts";
import {
  resolveEffectiveExecAsk,
  resolveExecApprovalsDefaults,
} from "../controllers/exec-approvals-policy.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "../controllers/exec-approvals.ts";
import {
  resolveConfiguredExecDefaults,
  resolveSecurityAccessDiagnostics,
  type SecurityAccessMode,
} from "../controllers/security-access.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { resolveAgentIdDisplayLabel } from "./agent-display.ts";
import {
  resolveApprovalAccessLabel,
  resolveApprovalAskLabel,
  resolveApprovalAuditEffectText,
  resolveApprovalDecisionLabel,
  resolveApprovalEffectText,
} from "./approval-summary.ts";
import { formatApprovalRemaining } from "./exec-approval.ts";
import { renderExecApprovals, resolveExecApprovalsState } from "./nodes-exec-approvals.ts";
import { resolveNodeTargets } from "./nodes-shared.ts";
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
  execApprovalAuditTrail: ExecApprovalAuditEntry[];
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
  const nodeId = props.execApprovalsTargetNodeId?.trim() || "";
  if (!nodeId) {
    return t("alisio.security.targets.node");
  }
  return (
    resolveNodeTargets(props.nodes, ["system.execApprovals.get", "system.execApprovals.set"]).find(
      (node) => node.id === nodeId,
    )?.label ?? nodeId
  );
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

function accessModeTitle(mode: Exclude<SecurityAccessMode, "custom">) {
  if (mode === "recommended") {
    return t("alisio.security.access.recommended.title");
  }
  return t("alisio.security.access.fullAccess.title");
}

function accessModeBadge(mode: Exclude<SecurityAccessMode, "custom">) {
  if (mode === "recommended") {
    return t("alisio.security.access.recommended.badge");
  }
  return t("alisio.security.access.fullAccess.badge");
}

function accessModeChecklist(mode: Exclude<SecurityAccessMode, "custom">): string[] {
  if (mode === "recommended") {
    return [
      t("alisio.security.access.recommended.points.allowlist"),
      t("alisio.security.access.recommended.points.prompts"),
      t("alisio.security.access.recommended.points.failClosed"),
    ];
  }
  return [
    t("alisio.security.access.fullAccess.points.host"),
    t("alisio.security.access.fullAccess.points.prompts"),
    t("alisio.security.access.fullAccess.points.scope"),
  ];
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

function renderSecurityMetaItem(label: string, value: string | number) {
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

function renderPendingApproval(entry: ExecApprovalRequest, props: SecurityProps, nowMs: number) {
  const expiresIn = Math.max(0, entry.expiresAtMs - nowMs);
  const title =
    entry.kind === "plugin"
      ? (entry.pluginTitle ?? t("alisio.security.queue.pluginApproval"))
      : entry.request.command;
  const effectText = resolveApprovalEffectText(entry);
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
        : html`<div class="exec-approval-command mono">${entry.request.command}</div>`}
      <div class="exec-approval-meta">
        ${renderApprovalMeta(t("alisio.security.queue.labels.type"), entry.kind)}
        ${renderApprovalMeta(
          t("alisio.security.queue.labels.access"),
          resolveApprovalAccessLabel(entry.request),
        )}
        ${renderApprovalMeta(
          t("alisio.security.queue.labels.review"),
          resolveApprovalAskLabel(entry.request.ask),
        )}
        ${renderApprovalMeta(t("alisio.connections.execApprovals.host"), entry.request.host)}
        ${renderApprovalMeta(t("alisio.security.queue.labels.plugin"), entry.pluginId, {
          tone: "code",
        })}
        ${renderApprovalMeta(t("alisio.security.queue.labels.agent"), agentLabel)}
        ${renderApprovalMeta(t("alisio.security.queue.labels.session"), sessionLabel)}
        ${renderApprovalMeta(t("alisio.security.queue.labels.cwd"), entry.request.cwd, {
          tone: "code",
        })}
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

function renderAuditEntry(entry: ExecApprovalAuditEntry) {
  return html`
    <article class="exec-approval-card alisio-security-queue-item">
      <div class="exec-approval-header">
        <div>
          <div class="exec-approval-title">${entry.title}</div>
          <div class="exec-approval-sub">${resolveApprovalAuditEffectText(entry)}</div>
        </div>
        <span class="pill">${resolveApprovalDecisionLabel(entry.decision)}</span>
      </div>
      <div class="exec-approval-meta">
        ${renderApprovalMeta(
          t("alisio.security.audit.labels.when"),
          formatRelativeTimestamp(entry.ts, { dateFallback: true }),
        )}
        ${renderApprovalMeta(
          t("alisio.security.audit.labels.resolvedBy"),
          entry.resolvedBy ?? t("alisio.security.audit.systemActor"),
        )}
        ${renderApprovalMeta(
          t("alisio.security.queue.labels.access"),
          resolveApprovalAccessLabel(entry.request),
        )}
        ${renderApprovalMeta(
          t("alisio.security.queue.labels.review"),
          resolveApprovalAskLabel(entry.request.ask),
        )}
        ${renderApprovalMeta(t("alisio.security.queue.labels.plugin"), entry.pluginId, {
          tone: "code",
        })}
      </div>
    </article>
  `;
}

function renderAuditTrail(entries: ExecApprovalAuditEntry[]) {
  return html`
    <section class="card alisio-security-panel">
      <div class="alisio-security-panel__head">
        <div>
          <div class="card-title">${t("alisio.security.audit.title")}</div>
          <div class="card-sub">${t("alisio.security.audit.subtitle")}</div>
        </div>
      </div>
      ${entries.length === 0
        ? html`
            <div class="alisio-security-empty">
              <strong>${t("alisio.security.audit.emptyTitle")}</strong>
              <span>${t("alisio.security.audit.emptyBody")}</span>
            </div>
          `
        : html`
            <div class="alisio-security-approval-list">
              ${entries.map((entry) => renderAuditEntry(entry))}
            </div>
          `}
    </section>
  `;
}

function renderApprovalQueue(props: SecurityProps, nowMs: number) {
  const queue = sortExecApprovalQueue(props.execApprovalQueue);
  return html`
    <section class="card alisio-security-panel">
      <div class="alisio-security-panel__head">
        <div class="card-title">${t("alisio.security.queue.title")}</div>
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

function renderAccessModeCard(
  props: SecurityProps,
  mode: Exclude<SecurityAccessMode, "custom">,
  disabled: boolean,
) {
  const active = props.gatewayAccessMode === mode;
  return html`
    <button
      type="button"
      data-security-mode=${mode}
      class="alisio-security-mode-card ${active ? "is-active" : ""}"
      ?disabled=${disabled || active}
      aria-pressed=${active}
      @click=${() => props.onApplyAccessMode(mode)}
    >
      <span class="alisio-security-mode-card__head">
        <span>
          <span class="alisio-security-mode-card__label">
            ${mode === "recommended"
              ? t("alisio.security.access.recommended.label")
              : t("alisio.security.access.fullAccess.label")}
          </span>
          <span class="alisio-security-mode-card__title">${accessModeTitle(mode)}</span>
        </span>
        <span class="pill">${accessModeBadge(mode)}</span>
      </span>
      <span class="alisio-security-mode-card__body">${accessModeDescription(mode)}</span>
      <span class="alisio-security-mode-card__list">
        ${accessModeChecklist(mode).map(
          (line) => html`<span class="alisio-security-mode-card__list-item">${line}</span>`,
        )}
      </span>
    </button>
  `;
}

function renderSecureDefaultsChecklist() {
  return html`
    <section class="card alisio-security-panel">
      <div class="alisio-security-panel__head">
        <div>
          <div class="card-title">${t("alisio.security.defaults.title")}</div>
          <div class="card-sub">${t("alisio.security.defaults.subtitle")}</div>
        </div>
      </div>
      <ul class="alisio-security-checklist">
        <li>${t("alisio.security.defaults.items.review")}</li>
        <li>${t("alisio.security.defaults.items.overrides")}</li>
        <li>${t("alisio.security.defaults.items.repeat")}</li>
      </ul>
    </section>
  `;
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
  const appliedDiagnostics = resolveSecurityAccessDiagnostics({
    configForm: props.configSnapshot?.config ?? null,
    execApprovalsForm: props.execApprovalsSnapshot?.file ?? null,
  });

  return html`
    <div class="alisio-security-access">
      <div class="card-title">${t("alisio.security.access.title")}</div>
      ${!ready
        ? html`
            <div class="alisio-security-empty">
              <strong>${t("alisio.security.access.loadTitle")}</strong>
              <span>${t("alisio.security.access.loadBody")}</span>
            </div>
          `
        : html`
            <div class="alisio-security-mode-grid">
              ${renderAccessModeCard(props, "recommended", disabled)}
              ${renderAccessModeCard(props, "full-access", disabled)}
              ${mode === "custom"
                ? html`
                    <div class="alisio-security-mode-card is-custom">
                      <div class="alisio-security-mode-card__head">
                        <div>
                          <div class="alisio-security-mode-card__label">
                            ${t("alisio.security.access.custom.label")}
                          </div>
                          <div class="alisio-security-mode-card__title">
                            ${t("alisio.security.access.custom.title")}
                          </div>
                        </div>
                        <span class="pill">${t("alisio.security.access.custom.badge")}</span>
                      </div>
                      <div class="alisio-security-mode-card__body">
                        ${t("alisio.security.access.customBody")}
                      </div>
                      <ul class="alisio-security-mode-card__list">
                        ${appliedDiagnostics.configOverrideAgentCount > 0
                          ? html`<li>
                              ${t("alisio.security.access.custom.points.configOverrides", {
                                count: String(appliedDiagnostics.configOverrideAgentCount),
                              })}
                            </li>`
                          : nothing}
                        ${appliedDiagnostics.approvalOverrideAgentCount > 0
                          ? html`<li>
                              ${t("alisio.security.access.custom.points.approvalOverrides", {
                                count: String(appliedDiagnostics.approvalOverrideAgentCount),
                              })}
                            </li>`
                          : nothing}
                        <li>${t("alisio.security.access.custom.points.reset")}</li>
                      </ul>
                    </div>
                  `
                : nothing}
            </div>
            ${blockedMessage ? html`<div class="callout warn">${blockedMessage}</div>` : nothing}
            <div class="alisio-security-access__note">
              ${mode === "custom"
                ? t("alisio.security.access.customFooter", {
                    config: String(appliedDiagnostics.configOverrideAgentCount),
                    approvals: String(appliedDiagnostics.approvalOverrideAgentCount),
                  })
                : t("alisio.security.access.modeFooter")}
            </div>
          `}
    </div>
  `;
}

function resolveSecurityPromptAsk(
  props: SecurityProps,
  approvalsSnapshot: ExecApprovalsSnapshot | null,
  approvalsForm: ExecApprovalsFile | null,
  gatewayDefaultsAsk: ExecAsk,
): ExecAsk {
  const approvalsDefaults = resolveExecApprovalsDefaults(approvalsSnapshot?.file ?? approvalsForm);
  if (props.execApprovalsTarget === "node") {
    return approvalsDefaults.ask;
  }
  return resolveEffectiveExecAsk(gatewayDefaultsAsk, approvalsDefaults.ask);
}

export function renderSecurity(props: SecurityProps) {
  const approvalQueue = sortExecApprovalQueue(props.execApprovalQueue);
  const approvalsState = resolveExecApprovalsState(props);
  const mode = supportsRuntimeAccessModeTarget(props.execApprovalsTarget)
    ? props.gatewayAccessMode
    : null;
  const gatewayDefaults = resolveConfiguredExecDefaults(props.configSnapshot?.config ?? null);
  const promptAsk = resolveSecurityPromptAsk(
    props,
    props.execApprovalsSnapshot,
    props.execApprovalsForm,
    gatewayDefaults.ask,
  );
  const nowMs = Date.now();

  return html`
    <section class="alisio-page alisio-security-page">
      <div class="card alisio-connections-hero alisio-security-hero alisio-security-shell">
        <div class="alisio-connections-hero__head">
          <div>
            <div class="card-title">${t("alisio.security.title")}</div>
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

        <div class="alisio-security-meta">
          ${renderSecurityMetaItem(
            t("alisio.security.stats.mode"),
            mode ? accessModeLabel(mode) : t("alisio.security.access.gatewayOnlyShort"),
          )}
          ${renderSecurityMetaItem(t("alisio.security.stats.pending"), approvalQueue.length)}
          ${renderSecurityMetaItem(t("alisio.security.stats.target"), resolveTargetLabel(props))}
          ${renderSecurityMetaItem(t("alisio.security.stats.prompt"), promptModeLabel(promptAsk))}
        </div>

        ${renderAccessModePanel(props)}
      </div>

      <div class="alisio-connections-stack">
        ${renderApprovalQueue({ ...props, execApprovalQueue: approvalQueue }, nowMs)}
        ${renderAuditTrail(props.execApprovalAuditTrail)} ${renderExecApprovals(approvalsState)}
        ${renderSecureDefaultsChecklist()}
      </div>
    </section>
  `;
}
