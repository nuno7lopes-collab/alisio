import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import type { ExecApprovalAuditEntry, ExecApprovalRequest } from "../controllers/exec-approval.ts";
import { sortExecApprovalQueue } from "../controllers/exec-approval.ts";
import type {
  SecurityAccessDiagnostics,
  SecurityAccessMode,
} from "../controllers/security-access.ts";
import { icons } from "../icons.ts";
import type { NativeShellState } from "../types.ts";
import {
  resolveApprovalAccessLabel,
  resolveApprovalCommandText,
  resolveApprovalEffectText,
  resolveApprovalSummaryRows,
} from "./approval-summary.ts";
import { formatApprovalRemaining } from "./exec-approval.ts";
import {
  buildNativeShellAccessTitle,
  summarizeNativeShellAccess,
} from "./native-shell-access-summary.ts";

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
  onOpenNativeSettings?: () => void;
};

type ChatSecuritySurfaceState = {
  queue: ExecApprovalRequest[];
  currentMode: SecurityAccessMode | null;
  nativeShellSummary: ReturnType<typeof summarizeNativeShellAccess>;
  disabled: boolean;
  busy: boolean;
  nowMs: number;
  currentModeLabel: string;
  currentModeTitle?: string;
  canOpenNativeSettings: boolean;
  computerStatus: {
    label: string;
    title: string;
    tone: "muted" | "warn" | "ready";
  };
  computerStatusAria: string;
  showComputerStatus: boolean;
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

function resolveGuardrailLabel(security?: string | null) {
  return resolveApprovalAccessLabel({
    command: "policy",
    security,
  });
}

function accessModeToneClass(mode: SecurityAccessMode | null): string {
  if (mode === "recommended") {
    return "alisio-chat__access-pill--ready";
  }
  if (mode === "full-access") {
    return "alisio-chat__access-pill--warn";
  }
  if (mode === "custom") {
    return "is-active";
  }
  return "";
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

function canRenderChatSecurityConsole(props: ChatSecurityConsoleProps): boolean {
  return !(
    !props.onApplyAccessMode &&
    !props.onResolveApproval &&
    props.approvalQueue.length === 0 &&
    props.approvalAuditTrail.length === 0
  );
}

function resolveChatSecuritySurfaceState(
  props: ChatSecurityConsoleProps,
): ChatSecuritySurfaceState | null {
  if (!canRenderChatSecurityConsole(props)) {
    return null;
  }

  const queue = sortExecApprovalQueue(props.approvalQueue);
  const currentMode = props.accessMode ?? props.securityDiagnostics?.mode ?? null;
  const nativeShellSummary = summarizeNativeShellAccess(props.nativeShellState);
  const busy = Boolean(props.accessModeBusy || props.accessModeLoading);
  const disabled = !props.connected || busy;
  const nowMs = Date.now();
  const currentModeLabel = currentMode
    ? accessModeLabel(currentMode)
    : t("alisio.chat.access.loading");
  const currentModeTitle = props.securityDiagnostics
    ? [
        t("alisio.chat.access.policyRuntime", {
          value: resolveGuardrailLabel(props.securityDiagnostics.configDefaults.security),
        }),
        t("alisio.chat.access.policyApprovals", {
          value: resolveGuardrailLabel(props.securityDiagnostics.approvalDefaults.security),
        }),
      ].join("\n")
    : undefined;
  const canOpenNativeSettings = Boolean(props.onOpenNativeSettings && nativeShellSummary);
  const computerStatus =
    props.nativeShellLoading && !nativeShellSummary
      ? {
          label: t("alisio.chat.access.loading"),
          title: t("alisio.chat.access.computerLoading"),
          tone: "muted" as const,
        }
      : props.nativeShellError
        ? {
            label: t("alisio.chat.access.computerUnavailableShort"),
            title: props.nativeShellError,
            tone: "warn" as const,
          }
        : nativeShellSummary
          ? {
              label: t("alisio.chat.access.computerGrantedShort", {
                granted: String(nativeShellSummary.granted),
                total: String(nativeShellSummary.total),
              }),
              title: buildNativeShellAccessTitle(nativeShellSummary),
              tone:
                nativeShellSummary.missingLabels.length > 0
                  ? ("warn" as const)
                  : ("ready" as const),
            }
          : {
              label: t("alisio.chat.access.computerUnavailableShort"),
              title: t("alisio.chat.access.computerUnavailable"),
              tone: "muted" as const,
            };
  const computerStatusAria = `${t("alisio.chat.access.computerTitle")}: ${computerStatus.title}`;
  const showComputerStatus =
    props.nativeShellLoading || Boolean(props.nativeShellError || nativeShellSummary);

  return {
    queue,
    currentMode,
    nativeShellSummary,
    disabled,
    busy,
    nowMs,
    currentModeLabel,
    currentModeTitle,
    canOpenNativeSettings,
    computerStatus,
    computerStatusAria,
    showComputerStatus,
  };
}

export function renderChatSecurityAccessStrip(
  props: ChatSecurityConsoleProps,
): TemplateResult | typeof nothing {
  const surface = resolveChatSecuritySurfaceState(props);
  if (!surface) {
    return nothing;
  }

  const selectAccessMode = (event: Event, mode: Exclude<SecurityAccessMode, "custom">) => {
    (event.currentTarget as HTMLElement | null)?.closest("details")?.removeAttribute("open");
    props.onApplyAccessMode?.(mode);
  };

  return html`
    <div class="alisio-chat__access-strip" role="group" aria-label=${t("alisio.chat.access.aria")}>
      ${props.onApplyAccessMode
        ? html`
            <details class="alisio-chat__access-menu">
              <summary
                class="alisio-chat__access-pill ${accessModeToneClass(surface.currentMode)}"
                aria-label=${t("alisio.chat.access.aria")}
                title=${surface.currentModeTitle ?? ""}
              >
                <span class="alisio-chat__access-pill-icon">${icons.shield}</span>
                <span>${surface.currentModeLabel}</span>
              </summary>
              <div class="alisio-chat__access-menu-panel" role="menu">
                <button
                  type="button"
                  class="alisio-chat__access-menu-option"
                  role="menuitemradio"
                  aria-checked=${String(surface.currentMode === "recommended")}
                  ?disabled=${surface.disabled || surface.currentMode === "recommended"}
                  @click=${(event: Event) => selectAccessMode(event, "recommended")}
                >
                  <span class="alisio-chat__access-menu-option__main">
                    <span class="alisio-chat__access-pill-icon">${icons.shield}</span>
                    <span>${t("alisio.security.access.recommended.label")}</span>
                  </span>
                  ${surface.currentMode === "recommended"
                    ? html`
                        <span class="alisio-chat__access-menu-option__check">${icons.check}</span>
                      `
                    : nothing}
                </button>
                <button
                  type="button"
                  class="alisio-chat__access-menu-option"
                  role="menuitemradio"
                  aria-checked=${String(surface.currentMode === "full-access")}
                  ?disabled=${surface.disabled || surface.currentMode === "full-access"}
                  @click=${(event: Event) => selectAccessMode(event, "full-access")}
                >
                  <span class="alisio-chat__access-menu-option__main">
                    <span class="alisio-chat__access-pill-icon">${icons.shield}</span>
                    <span>${t("alisio.security.access.fullAccess.label")}</span>
                  </span>
                  ${surface.currentMode === "full-access"
                    ? html`
                        <span class="alisio-chat__access-menu-option__check">${icons.check}</span>
                      `
                    : nothing}
                </button>
              </div>
            </details>
          `
        : html`
            <span
              class="alisio-chat__access-pill ${accessModeToneClass(surface.currentMode)}"
              title=${surface.currentModeTitle ?? ""}
            >
              <span class="alisio-chat__access-pill-icon">${icons.shield}</span>
              <span>${surface.currentModeLabel}</span>
            </span>
          `}
      ${surface.showComputerStatus
        ? html`
            <button
              type="button"
              class="alisio-chat__access-pill alisio-chat__access-pill--status alisio-chat__access-pill--${surface
                .computerStatus.tone} ${surface.canOpenNativeSettings
                ? "alisio-chat__access-pill--interactive"
                : ""}"
              title=${surface.computerStatus.title}
              aria-label=${surface.computerStatusAria}
              ?disabled=${!surface.canOpenNativeSettings}
              @click=${() => props.onOpenNativeSettings?.()}
            >
              <span class="alisio-chat__access-pill-icon">${icons.monitor}</span>
              <span>${surface.computerStatus.label}</span>
            </button>
          `
        : nothing}
      ${surface.queue.length
        ? html`
            <span
              class="alisio-chat__access-pill alisio-chat__access-pill--status alisio-chat__access-pill--warn"
            >
              ${t("alisio.chat.access.pendingShort", { count: String(surface.queue.length) })}
            </span>
          `
        : nothing}
    </div>
  `;
}

export function renderChatSecurityQueue(
  props: ChatSecurityConsoleProps,
): TemplateResult | typeof nothing {
  const surface = resolveChatSecuritySurfaceState(props);
  if (!surface || surface.queue.length === 0) {
    return nothing;
  }

  return html`
    <div class="alisio-chat__security-section">
      <div class="alisio-security-approval-list">
        ${surface.queue
          .slice(0, 2)
          .map((entry) => renderPendingApproval(entry, props, surface.nowMs))}
      </div>
    </div>
  `;
}

export function renderChatSecurityConsole(
  props: ChatSecurityConsoleProps,
): TemplateResult | typeof nothing {
  if (!canRenderChatSecurityConsole(props)) {
    return nothing;
  }

  return html`
    <section class="alisio-chat__security-console" aria-label=${t("alisio.chat.access.aria")}>
      ${renderChatSecurityAccessStrip(props)} ${renderChatSecurityQueue(props)}
    </section>
  `;
}
