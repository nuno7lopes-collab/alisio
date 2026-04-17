import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import {
  getBrowserPaneAvailableSurfaces,
  resolveBrowserPaneSurface,
  type BrowserPaneMarkdownState,
  type BrowserPaneObserver,
  type BrowserPaneSurfaceKind,
} from "../controllers/browser-pane.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import type { ComputerSessionState, ComputerTimelineEntry } from "../types.ts";
import {
  nativeShellPermissionDescription,
  nativeShellPermissionLabel,
} from "./native-shell-permissions.ts";

const chatText = (key: string) => t(`alisio.chat.${key}`);

export type BrowserPaneProps = {
  observer?: BrowserPaneObserver | null;
  computer?: ComputerSessionState | null;
  computerLoading?: boolean;
  computerError?: string | null;
  markdown?: BrowserPaneMarkdownState | null;
  selectedSurface?: BrowserPaneSurfaceKind;
  onSelectSurface?: (surface: BrowserPaneSurfaceKind) => void;
  onComputerSessionCommand?: (command: "pause" | "resume" | "stop") => void;
  onComputerSessionApproval?: (decision: "allow-once" | "allow-session" | "deny") => void;
  onRequestComputerPermission?: (permission: "accessibility" | "screenRecording") => void;
  onClose?: () => void;
  onViewRawText?: () => void;
  embedded?: boolean;
};

function getBrowserPaneLabel(kind: BrowserPaneSurfaceKind): string {
  switch (kind) {
    case "observer":
      return chatText("browserPane.surfaces.observer");
    case "computer":
      return chatText("browserPane.surfaces.computer");
    case "markdown":
      return chatText("browserPane.surfaces.markdown");
  }
}

function formatComputerStatus(status: ComputerSessionState["status"]): string {
  return chatText(`browserPane.computer.status.${status}`);
}

function formatComputerMode(mode: ComputerSessionState["mode"]): string {
  return chatText(`browserPane.computer.modes.${mode}`);
}

function formatTimelineTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function renderComputerPermissionCallout(
  permission: "accessibility" | "screenRecording",
  onRequestPermission?: BrowserPaneProps["onRequestComputerPermission"],
) {
  return html`
    <div class="callout warning computer-pane__callout">
      <strong>${nativeShellPermissionLabel(permission)}</strong>
      <span>${nativeShellPermissionDescription(permission)}</span>
      ${onRequestPermission
        ? html`
            <div class="computer-pane__callout-actions">
              <button
                class="btn btn--sm"
                type="button"
                @click=${() => onRequestPermission(permission)}
              >
                ${chatText("browserPane.computer.requestPermission")}
              </button>
            </div>
          `
        : null}
    </div>
  `;
}

function renderComputerTimelineEntry(entry: ComputerTimelineEntry) {
  return html`
    <div class="computer-pane__timeline-entry computer-pane__timeline-entry--${entry.kind}">
      <div class="computer-pane__timeline-summary">${entry.summary}</div>
      <div class="computer-pane__timeline-meta">
        <span>${formatTimelineTimestamp(entry.at)}</span>
        ${entry.status ? html`<span>${formatComputerStatus(entry.status)}</span>` : null}
      </div>
    </div>
  `;
}

function renderComputerSurface(props: BrowserPaneProps, session: ComputerSessionState) {
  const frame = session.frame ?? null;
  const context = session.context ?? null;
  const cursor = frame?.cursor ?? null;
  const awaitingApproval = session.awaitingApproval ?? null;
  const timeline = session.timeline.slice(-12).toReversed();
  const canPause = session.status !== "paused" && session.status !== "stopped";
  const canResume = session.status === "paused";
  const missingAccessibility = !session.permissions.accessibility;
  const missingScreenRecording = !session.permissions.screenRecording;
  const frameCursorX = frame?.width ? ((cursor?.x ?? 0) / frame.width) * 100 : 0;
  const frameCursorY = frame?.height ? ((cursor?.y ?? 0) / frame.height) * 100 : 0;

  return html`
    <div class="computer-pane">
      <div class="computer-pane__summary">
        <div class="computer-pane__summary-copy">
          <div class="computer-pane__status-row">
            <span class="computer-pane__status computer-pane__status--${session.status}">
              ${formatComputerStatus(session.status)}
            </span>
            <span class="computer-pane__mode">${formatComputerMode(session.mode)}</span>
          </div>
          <div class="computer-pane__context">
            ${context?.activeApp?.name ?? chatText("browserPane.computer.desktop")}
            ${context?.activeWindow?.title
              ? html`<span class="computer-pane__context-window"
                  >${context.activeWindow.title}</span
                >`
              : null}
          </div>
        </div>
        <div class="computer-pane__actions">
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${!props.onComputerSessionCommand || !canPause}
            @click=${() => props.onComputerSessionCommand?.("pause")}
          >
            ${chatText("browserPane.computer.pause")}
          </button>
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${!props.onComputerSessionCommand || !canResume}
            @click=${() => props.onComputerSessionCommand?.("resume")}
          >
            ${chatText("browserPane.computer.resume")}
          </button>
          <button
            class="btn btn--sm danger"
            type="button"
            ?disabled=${!props.onComputerSessionCommand}
            @click=${() => props.onComputerSessionCommand?.("stop")}
          >
            ${chatText("browserPane.computer.stop")}
          </button>
        </div>
      </div>

      ${props.computerError ? html`<div class="callout danger">${props.computerError}</div>` : null}
      ${session.lastError ? html`<div class="callout danger">${session.lastError}</div>` : null}
      ${missingScreenRecording
        ? renderComputerPermissionCallout("screenRecording", props.onRequestComputerPermission)
        : null}
      ${missingAccessibility
        ? renderComputerPermissionCallout("accessibility", props.onRequestComputerPermission)
        : null}
      ${awaitingApproval
        ? html`
            <div class="callout warning computer-pane__approval">
              <strong>${chatText("browserPane.computer.awaitingApproval")}</strong>
              <span>${awaitingApproval.actionSummary}</span>
              <span>${awaitingApproval.reason}</span>
              <div class="computer-pane__callout-actions">
                <button
                  class="btn btn--sm"
                  type="button"
                  ?disabled=${!props.onComputerSessionApproval}
                  @click=${() => props.onComputerSessionApproval?.("allow-once")}
                >
                  ${chatText("browserPane.computer.approveOnce")}
                </button>
                <button
                  class="btn btn--sm"
                  type="button"
                  ?disabled=${!props.onComputerSessionApproval}
                  @click=${() => props.onComputerSessionApproval?.("allow-session")}
                >
                  ${chatText("browserPane.computer.approveSession")}
                </button>
                <button
                  class="btn btn--sm"
                  type="button"
                  ?disabled=${!props.onComputerSessionApproval}
                  @click=${() => props.onComputerSessionApproval?.("deny")}
                >
                  ${chatText("browserPane.computer.deny")}
                </button>
              </div>
            </div>
          `
        : null}

      <div class="computer-pane__frame-card">
        ${frame
          ? html`
              <div class="computer-pane__frame">
                <img
                  class="computer-pane__frame-image"
                  alt=${chatText("browserPane.computer.frameAlt")}
                  src=${frame.dataUrl}
                />
                ${cursor?.visible
                  ? html`
                      <div
                        class="computer-pane__cursor"
                        style=${`left:${frameCursorX}%;top:${frameCursorY}%;`}
                      ></div>
                    `
                  : null}
              </div>
            `
          : props.computerLoading
            ? html`<div class="muted browser-pane__empty">
                ${chatText("browserPane.computer.loading")}
              </div>`
            : html`<div class="muted browser-pane__empty">
                ${chatText("browserPane.computer.noFrame")}
              </div>`}
      </div>

      <div class="computer-pane__meta-grid">
        <div>
          <span class="computer-pane__meta-label"
            >${chatText("browserPane.computer.targetApp")}</span
          >
          <span>${context?.activeApp?.name ?? chatText("browserPane.computer.unknown")}</span>
        </div>
        <div>
          <span class="computer-pane__meta-label">${chatText("browserPane.computer.display")}</span>
          <span>
            ${context
              ? `${Math.round(context.display.width)} × ${Math.round(context.display.height)} @ ${context.display.scale}x`
              : chatText("browserPane.computer.unknown")}
          </span>
        </div>
      </div>

      <div class="computer-pane__timeline">
        <div class="computer-pane__timeline-title">
          ${chatText("browserPane.computer.timeline")}
        </div>
        ${timeline.length > 0
          ? timeline.map((entry) => renderComputerTimelineEntry(entry))
          : html`<div class="muted browser-pane__empty">
              ${chatText("browserPane.computer.noTimeline")}
            </div>`}
      </div>
    </div>
  `;
}

export function renderBrowserPane(props: BrowserPaneProps) {
  const available = getBrowserPaneAvailableSurfaces({
    observer: props.observer ?? null,
    computer: props.computer ?? null,
    markdown: props.markdown ?? null,
  });
  const surface = resolveBrowserPaneSurface({
    preferredSurface: props.selectedSurface ?? "observer",
    observer: props.observer ?? null,
    computer: props.computer ?? null,
    markdown: props.markdown ?? null,
  });
  const selectedSurface = surface?.kind ?? null;
  const title =
    selectedSurface && available.length <= 1
      ? getBrowserPaneLabel(selectedSurface)
      : chatText("browserPane.title");

  return html`
    <div class="browser-pane browser-pane__panel">
      <div class="browser-pane__header">
        <div class="browser-pane__header-main">
          <div class="browser-pane__title">${title}</div>
          ${available.length > 1 && props.onSelectSurface
            ? html`
                <div
                  class="browser-pane__switch"
                  role="tablist"
                  aria-label=${chatText("browserPane.surfacePicker")}
                >
                  ${available.map((kind) => {
                    const active = selectedSurface === kind;
                    return html`
                      <button
                        class="btn btn--sm browser-pane__switch-button ${active
                          ? "browser-pane__switch-button--active"
                          : ""}"
                        type="button"
                        role="tab"
                        aria-selected=${active ? "true" : "false"}
                        @click=${() => props.onSelectSurface?.(kind)}
                      >
                        ${getBrowserPaneLabel(kind)}
                      </button>
                    `;
                  })}
                </div>
              `
            : null}
        </div>
        ${props.embedded || !props.onClose
          ? null
          : html`
              <button
                @click=${props.onClose}
                class="btn browser-pane__close"
                title=${chatText("browserPane.close")}
                aria-label=${chatText("browserPane.close")}
              >
                ${icons.x}
              </button>
            `}
      </div>
      <div
        class="browser-pane__content ${surface?.kind === "observer"
          ? "browser-pane__content--observer"
          : surface?.kind === "computer"
            ? "browser-pane__content--computer"
            : ""}"
      >
        ${surface?.kind === "observer"
          ? html`
              <iframe
                class="browser-pane__iframe"
                title=${surface.observer.label ?? chatText("browserPane.observerTitle")}
                src=${surface.observer.url}
                referrerpolicy="no-referrer"
              ></iframe>
            `
          : surface?.kind === "computer"
            ? renderComputerSurface(props, surface.session)
            : surface?.kind === "markdown"
              ? surface.error
                ? html`
                    <div class="callout danger">${surface.error}</div>
                    ${props.onViewRawText
                      ? html`
                          <button
                            @click=${props.onViewRawText}
                            class="btn browser-pane__raw-action"
                          >
                            ${chatText("browserPane.viewRawText")}
                          </button>
                        `
                      : null}
                  `
                : surface.content
                  ? html`<div class="sidebar-markdown">
                      ${unsafeHTML(toSanitizedMarkdownHtml(surface.content))}
                    </div>`
                  : html`<div class="muted browser-pane__empty">
                      ${chatText("browserPane.noContent")}
                    </div>`
              : html`<div class="muted browser-pane__empty">
                  ${chatText("browserPane.unavailable")}
                </div>`}
      </div>
    </div>
  `;
}
