import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import type { ExecApprovalRequest } from "../controllers/exec-approval.ts";
import { sortExecApprovalQueue } from "../controllers/exec-approval.ts";
import {
  resolveApprovalCommandText,
  resolveApprovalEffectText,
  resolveApprovalSummaryRows,
} from "./approval-summary.ts";

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

function renderMetaRow(
  label: string,
  value?: string | null,
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

type ApprovalPromptIdentity = Pick<AppViewState, "assistantName" | "assistantAgentId">;

function renderSummaryRows(active: ExecApprovalRequest, identity: ApprovalPromptIdentity) {
  const rows = resolveApprovalSummaryRows(active, identity);
  return html`
    <div class="exec-approval-meta">
      ${rows.map((row) => renderMetaRow(row.label, row.value, { tone: row.tone }))}
    </div>
  `;
}

function renderApprovalBody(active: ExecApprovalRequest, identity: ApprovalPromptIdentity) {
  const commandText =
    active.kind === "plugin"
      ? (active.pluginDescription ??
        active.pluginTitle ??
        t("alisio.security.queue.pluginApproval"))
      : resolveApprovalCommandText(active.request);
  return html`
    <pre class="exec-approval-command mono" style="white-space:pre-wrap">${commandText}</pre>
    ${active.kind === "plugin" && active.pluginDescription
      ? nothing
      : active.kind === "exec" && active.request.commandPreview
        ? html`
            <div class="exec-approval-sub">
              ${t("alisio.security.queue.previewExact", { value: active.request.command })}
            </div>
          `
        : nothing}
    ${active.kind === "plugin" && active.pluginToolName
      ? html`<div class="exec-approval-sub">
          ${t("alisio.security.queue.previewTool", { value: active.pluginToolName })}
        </div>`
      : nothing}
    ${renderSummaryRows(active, identity)}
  `;
}

export function renderExecApprovalPrompt(state: AppViewState) {
  const queue = sortExecApprovalQueue(state.execApprovalQueue);
  const active = queue[0];
  if (!active) {
    return nothing;
  }
  const remainingMs = active.expiresAtMs - Date.now();
  const remaining =
    remainingMs > 0
      ? t("alisio.security.queue.expiresIn", { value: formatApprovalRemaining(remainingMs) })
      : t("alisio.security.queue.expired");
  const queueCount = queue.length;
  const isPlugin = active.kind === "plugin";
  const title = isPlugin
    ? (active.pluginTitle ?? t("alisio.security.queue.pluginApproval"))
    : t("alisio.security.queue.execApproval");
  const effectText = resolveApprovalEffectText(active);
  return html`
    <div class="exec-approval-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">${title}</div>
            <div class="exec-approval-sub">${effectText}</div>
            <div class="exec-approval-sub">${remaining}</div>
          </div>
          ${queueCount > 1
            ? html`<div class="exec-approval-queue">
                ${t("alisio.security.queue.pendingCount", { count: String(queueCount) })}
              </div>`
            : nothing}
        </div>
        ${renderApprovalBody(active, state)}
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
