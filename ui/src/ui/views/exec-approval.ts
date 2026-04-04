import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import type {
  ExecApprovalRequest,
  ExecApprovalRequestPayload,
} from "../controllers/exec-approval.ts";
import { resolveAgentIdDisplayLabel } from "./agent-display.ts";
import { resolveSessionDisplayName } from "./session-display.ts";

export function formatApprovalRemaining(ms: number): string {
  const remaining = Math.max(0, ms);
  const totalSeconds = Math.floor(remaining / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function renderMetaRow(label: string, value?: string | null) {
  if (!value) {
    return nothing;
  }
  return html`<div class="exec-approval-meta-row"><span>${label}</span><span>${value}</span></div>`;
}

type ApprovalPromptIdentity = Pick<AppViewState, "assistantName" | "assistantAgentId">;

function renderExecBody(request: ExecApprovalRequestPayload, identity: ApprovalPromptIdentity) {
  const agentLabel = resolveAgentIdDisplayLabel(request.agentId, identity);
  const sessionLabel = resolveSessionDisplayName(request.sessionKey ?? "", undefined, identity);
  return html`
    <div class="exec-approval-command mono">${request.command}</div>
    <div class="exec-approval-meta">
      ${renderMetaRow("Host", request.host)} ${renderMetaRow("Agent", agentLabel)}
      ${renderMetaRow("Session", sessionLabel)} ${renderMetaRow("CWD", request.cwd)}
      ${renderMetaRow("Resolved", request.resolvedPath)}
      ${renderMetaRow("Security", request.security)} ${renderMetaRow("Ask", request.ask)}
    </div>
  `;
}

function renderPluginBody(active: ExecApprovalRequest, identity: ApprovalPromptIdentity) {
  const agentLabel = resolveAgentIdDisplayLabel(active.request.agentId, identity);
  const sessionLabel = resolveSessionDisplayName(
    active.request.sessionKey ?? "",
    undefined,
    identity,
  );
  return html`
    ${active.pluginDescription
      ? html`<pre class="exec-approval-command mono" style="white-space:pre-wrap">
${active.pluginDescription}</pre
        >`
      : nothing}
    <div class="exec-approval-meta">
      ${renderMetaRow("Severity", active.pluginSeverity)}
      ${renderMetaRow("Plugin", active.pluginId)} ${renderMetaRow("Agent", agentLabel)}
      ${renderMetaRow("Session", sessionLabel)}
    </div>
  `;
}

export function renderExecApprovalPrompt(state: AppViewState) {
  const active = state.execApprovalQueue[0];
  if (!active) {
    return nothing;
  }
  const request = active.request;
  const remainingMs = active.expiresAtMs - Date.now();
  const remaining =
    remainingMs > 0
      ? t("alisio.security.queue.expiresIn", { value: formatApprovalRemaining(remainingMs) })
      : t("alisio.security.queue.expired");
  const queueCount = state.execApprovalQueue.length;
  const isPlugin = active.kind === "plugin";
  const title = isPlugin
    ? (active.pluginTitle ?? t("alisio.security.queue.pluginApproval"))
    : t("alisio.security.queue.execApproval");
  return html`
    <div class="exec-approval-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">${title}</div>
            <div class="exec-approval-sub">${remaining}</div>
          </div>
          ${queueCount > 1
            ? html`<div class="exec-approval-queue">
                ${t("alisio.security.queue.pendingCount", { count: String(queueCount) })}
              </div>`
            : nothing}
        </div>
        ${isPlugin ? renderPluginBody(active, state) : renderExecBody(request, state)}
        ${state.execApprovalError
          ? html`<div class="exec-approval-error">${state.execApprovalError}</div>`
          : nothing}
        <div class="exec-approval-actions">
          <button
            class="btn primary"
            ?disabled=${state.execApprovalBusy}
            @click=${() => state.handleExecApprovalDecision("allow-once")}
          >
            ${t("alisio.security.queue.allowOnce")}
          </button>
          <button
            class="btn"
            ?disabled=${state.execApprovalBusy}
            @click=${() => state.handleExecApprovalDecision("allow-always")}
          >
            ${t("alisio.security.queue.allowAlways")}
          </button>
          <button
            class="btn danger"
            ?disabled=${state.execApprovalBusy}
            @click=${() => state.handleExecApprovalDecision("deny")}
          >
            ${t("alisio.security.queue.deny")}
          </button>
        </div>
      </div>
    </div>
  `;
}
