import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import {
  getBrowserPaneAvailableSurfaces,
  resolveBrowserPaneSurface,
  type BrowserPaneBrowserState,
  type BrowserPaneSurfaceKind,
  type BrowserPaneToolOutputState,
} from "../controllers/browser-pane.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import type {
  ComputerReplayAction,
  ComputerReplayFrame,
  ComputerReplayStep,
  ComputerSessionLogEvent,
  ComputerSessionState,
  ComputerTimelineEntry,
} from "../types.ts";
import {
  nativeShellPermissionDescription,
  nativeShellPermissionLabel,
} from "./native-shell-permissions.ts";

const chatText = (key: string) => t(`alisio.chat.${key}`);

export type BrowserPaneProps = {
  browser?: BrowserPaneBrowserState | null;
  computer?: ComputerSessionState | null;
  computerLoading?: boolean;
  computerError?: string | null;
  toolOutput?: BrowserPaneToolOutputState | null;
  selectedSurface?: BrowserPaneSurfaceKind;
  selectedComputerReplayStepId?: string | null;
  computerStepDetailsOpen?: boolean;
  onSelectSurface?: (surface: BrowserPaneSurfaceKind) => void;
  onSelectComputerReplayStep?: (stepId: string | null) => void;
  onToggleComputerStepDetails?: (open: boolean) => void;
  onComputerSessionCommand?: (command: "start" | "pause" | "resume" | "stop") => void;
  onComputerSessionApproval?: (decision: "allow-once" | "allow-session" | "deny") => void;
  onRequestComputerPermission?: (permission: "accessibility" | "screenRecording") => void;
  onOpenComputerSession?: (sessionKey: string) => void;
  onClose?: () => void;
  onViewRawText?: () => void;
  embedded?: boolean;
};

type DerivedComputerWorkspace = {
  replaySteps: ComputerReplayStep[];
  selectedStep: ComputerReplayStep | null;
  selectedFrame: ComputerReplayFrame | null;
  diffBaseFrame: ComputerReplayFrame | null;
  selectedAction: ComputerReplayAction | null;
  selectedTimeline: ComputerTimelineEntry[];
  selectedEvents: ComputerSessionLogEvent[];
  selectedErrors: ComputerSessionLogEvent[];
  frameAgeMs: number | null;
  lastActionSummary: string | null;
  replayPartial: boolean;
  selectedFrameMissing: boolean;
};

function getBrowserPaneLabel(kind: BrowserPaneSurfaceKind): string {
  switch (kind) {
    case "preview":
      return chatText("browserPane.surfaces.preview");
    case "computer":
      return chatText("browserPane.surfaces.computer");
    case "tool_output":
      return chatText("browserPane.surfaces.tool_output");
  }
}

function formatComputerStatus(status: ComputerSessionState["status"]): string {
  return chatText(`browserPane.computer.status.${status}`);
}

function formatComputerMode(mode: ComputerSessionState["mode"]): string {
  return chatText(`browserPane.computer.modes.${mode}`);
}

function formatComputerSafetyLevel(
  level: NonNullable<ComputerSessionState["safety"]>["level"],
): string {
  return chatText(`browserPane.computer.safetyLevel.${level}`);
}

function formatComputerPolicyDecision(
  decision: NonNullable<ComputerTimelineEntry["policyDecision"]>,
): string {
  return chatText(`browserPane.computer.policyDecision.${decision}`);
}

function formatComputerStepLabel(sequence: number): string {
  return chatText("browserPane.computer.stepLabel").replace("{step}", `${sequence}`);
}

function formatComputerStepPhase(phase: NonNullable<ComputerTimelineEntry["stepPhase"]>): string {
  return chatText(`browserPane.computer.stepPhase.${phase}`);
}

function formatComputerStepStatus(status: ComputerReplayStep["status"]): string {
  return chatText(`browserPane.computer.stepStatus.${status}`);
}

function formatComputerRuntimeState(
  state: NonNullable<NonNullable<ComputerSessionState["runtime"]>["connectionState"]>,
): string {
  return chatText(`browserPane.computer.runtimeState.${state}`);
}

function formatComputerCapability(
  kind: ComputerSessionState["capabilities"][number]["kind"],
): string {
  return chatText(`browserPane.computer.capability.${kind}`);
}

function formatComputerBlocking(
  kind: NonNullable<ComputerSessionState["blocking"]>["kind"],
): string {
  return chatText(`browserPane.computer.blocking.${kind}`);
}

function formatComputerTimelineEvent(
  eventCode: NonNullable<ComputerTimelineEntry["eventCode"]>,
): string {
  return chatText(`browserPane.computer.timelineEvent.${eventCode}`);
}

function formatComputerLogEvent(code: ComputerSessionLogEvent["code"]): string {
  return code.replaceAll("_", " ");
}

function formatTimelineTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return "—";
  }
  if (ms < 1_000) {
    return `${Math.round(ms)} ms`;
  }
  if (ms < 10_000) {
    return `${(ms / 1_000).toFixed(1)} s`;
  }
  return `${Math.round(ms / 1_000)} s`;
}

function formatFrameAge(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  if (ms < 1_000) {
    return `${Math.max(0, Math.round(ms))} ms`;
  }
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
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
  const stepLabel =
    entry.stepSequence !== undefined ? formatComputerStepLabel(entry.stepSequence) : null;
  const phaseLabel = entry.stepPhase ? formatComputerStepPhase(entry.stepPhase) : null;
  const policyDecision = entry.policyDecision
    ? formatComputerPolicyDecision(entry.policyDecision)
    : null;
  const eventLabel = entry.eventCode ? formatComputerTimelineEvent(entry.eventCode) : null;
  return html`
    <div class="computer-pane__timeline-entry computer-pane__timeline-entry--${entry.kind}">
      <div class="computer-pane__timeline-copy">
        <div class="computer-pane__timeline-summary">${entry.summary}</div>
        ${stepLabel || phaseLabel || policyDecision
          ? html`
              <div class="computer-pane__timeline-tags">
                ${stepLabel
                  ? html`<span class="computer-pane__tag computer-pane__tag--step"
                      >${stepLabel}</span
                    >`
                  : null}
                ${phaseLabel ? html`<span class="computer-pane__tag">${phaseLabel}</span>` : null}
                ${policyDecision
                  ? html`<span class="computer-pane__tag">${policyDecision}</span>`
                  : null}
                ${eventLabel ? html`<span class="computer-pane__tag">${eventLabel}</span>` : null}
              </div>
            `
          : null}
      </div>
      <div class="computer-pane__timeline-meta">
        <span>${formatTimelineTimestamp(entry.at)}</span>
        ${entry.status ? html`<span>${formatComputerStatus(entry.status)}</span>` : null}
      </div>
    </div>
  `;
}

function buildReplayFrameMap(session: ComputerSessionState): Map<string, ComputerReplayFrame> {
  return new Map(session.replay.frames.map((entry) => [entry.frameId, entry]));
}

function buildLiveReplayFrame(session: ComputerSessionState): ComputerReplayFrame | null {
  if (!session.frame || !session.context) {
    return null;
  }
  return {
    frameId: session.frame.id,
    capturedAt: session.frame.capturedAt,
    stepId: session.activeStep?.id ?? session.lastCompletedStep?.id,
    stepSequence: session.activeStep?.sequence ?? session.lastCompletedStep?.sequence,
    stepPhase: session.activeStep?.phase ?? session.lastCompletedStep?.phase,
    observation: {
      frame: session.frame,
      context: session.context,
    },
  };
}

function resolvePreviousReplayFrame(
  session: ComputerSessionState,
  currentFrameId: string | null | undefined,
): ComputerReplayFrame | null {
  if (!currentFrameId) {
    return null;
  }
  const frames = session.replay.frames;
  const currentIndex = frames.findIndex((entry) => entry.frameId === currentFrameId);
  if (currentIndex > 0) {
    return frames[currentIndex - 1] ?? null;
  }
  return null;
}

function deriveComputerWorkspace(
  session: ComputerSessionState,
  selectedStepId: string | null | undefined,
): DerivedComputerWorkspace {
  const frameMap = buildReplayFrameMap(session);
  const eventLog = (session.eventLog ?? []).toSorted(
    (left, right) => left.ordinal - right.ordinal || left.at - right.at,
  );
  const replaySteps = session.replay.steps.toSorted(
    (left, right) => left.sequence - right.sequence,
  );
  const selectedStep =
    (selectedStepId ? replaySteps.find((step) => step.id === selectedStepId) : null) ??
    replaySteps.at(-1) ??
    null;
  const liveFrame = buildLiveReplayFrame(session);
  const selectedReplayFrame =
    (selectedStep?.resultFrameId ? frameMap.get(selectedStep.resultFrameId) : null) ??
    (selectedStep?.sourceFrameId ? frameMap.get(selectedStep.sourceFrameId) : null) ??
    null;
  const selectedFrame = selectedReplayFrame ?? liveFrame;
  const diffBaseFrame =
    (selectedStep?.sourceFrameId ? frameMap.get(selectedStep.sourceFrameId) : null) ??
    resolvePreviousReplayFrame(session, selectedFrame?.frameId);
  const selectedTimeline = selectedStep
    ? session.timeline.filter(
        (entry) =>
          entry.stepId === selectedStep.id ||
          entry.stepSequence === selectedStep.sequence ||
          entry.toolCallId === selectedStep.toolCallId,
      )
    : [];
  const selectedEvents = selectedStep
    ? eventLog.filter(
        (entry) =>
          entry.stepId === selectedStep.id ||
          entry.stepSequence === selectedStep.sequence ||
          entry.toolCallId === selectedStep.toolCallId,
      )
    : [];
  const selectedErrors = selectedEvents.filter(
    (entry) =>
      entry.code === "action_failed" ||
      (entry.code === "state_transition" && entry.status === "error"),
  );
  const lastActionSummary =
    replaySteps.toReversed().find((step) => Boolean(step.action?.summary))?.action?.summary ?? null;
  return {
    replaySteps,
    selectedStep,
    selectedFrame,
    diffBaseFrame:
      diffBaseFrame && diffBaseFrame.frameId !== selectedFrame?.frameId ? diffBaseFrame : null,
    selectedAction: selectedStep?.action ?? null,
    selectedTimeline,
    selectedEvents,
    selectedErrors,
    frameAgeMs: selectedFrame ? Math.max(0, Date.now() - selectedFrame.capturedAt) : null,
    lastActionSummary,
    replayPartial: Boolean(
      session.buffers?.eventLogTruncated ||
      session.buffers?.replayFramesTruncated ||
      session.buffers?.replayStepsTruncated ||
      session.buffers?.timelineTruncated,
    ),
    selectedFrameMissing: Boolean(
      selectedStep &&
      (selectedStep.resultFrameId || selectedStep.sourceFrameId) &&
      !selectedReplayFrame,
    ),
  };
}

function renderComputerLogEntry(entry: ComputerSessionLogEvent) {
  return html`
    <div class="computer-pane__event-entry">
      <div class="computer-pane__timeline-copy">
        <div class="computer-pane__timeline-summary">${entry.summary}</div>
        <div class="computer-pane__timeline-tags">
          <span class="computer-pane__tag">${formatComputerLogEvent(entry.code)}</span>
          ${entry.stepSequence !== undefined
            ? html`<span class="computer-pane__tag computer-pane__tag--step"
                >${formatComputerStepLabel(entry.stepSequence)}</span
              >`
            : nothing}
          ${entry.stepPhase
            ? html`<span class="computer-pane__tag"
                >${formatComputerStepPhase(entry.stepPhase)}</span
              >`
            : nothing}
          ${entry.actionType
            ? html`<span class="computer-pane__tag">${entry.actionType}</span>`
            : nothing}
          ${entry.failureCategory
            ? html`<span class="computer-pane__tag">${entry.failureCategory}</span>`
            : nothing}
        </div>
      </div>
      <div class="computer-pane__timeline-meta">
        <span>${formatTimelineTimestamp(entry.at)}</span>
      </div>
    </div>
  `;
}

function resolveNormalizedPoint(
  action: ComputerReplayAction | null,
  key: "target" | "destination",
): { x: number; y: number } | null {
  const point = action?.[key];
  const width = action?.referenceWidth ?? null;
  const height = action?.referenceHeight ?? null;
  if (!point || !width || !height || width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: Math.max(0, Math.min(100, (point.x / width) * 100)),
    y: Math.max(0, Math.min(100, (point.y / height) * 100)),
  };
}

function renderComputerActionOverlay(action: ComputerReplayAction | null) {
  const target = resolveNormalizedPoint(action, "target");
  const destination = resolveNormalizedPoint(action, "destination");
  if (!action || (!target && !destination)) {
    return nothing;
  }
  return html`
    <svg class="computer-pane__action-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
      ${target && destination
        ? html`
            <line
              class="computer-pane__action-path"
              x1=${target.x}
              y1=${target.y}
              x2=${destination.x}
              y2=${destination.y}
            ></line>
          `
        : nothing}
      ${target
        ? html`
            <circle
              class="computer-pane__action-point"
              cx=${target.x}
              cy=${target.y}
              r="2.2"
            ></circle>
          `
        : nothing}
      ${destination
        ? html`
            <circle
              class="computer-pane__action-destination"
              cx=${destination.x}
              cy=${destination.y}
              r="2.6"
            ></circle>
          `
        : nothing}
    </svg>
  `;
}

function renderComputerFrameStage(params: {
  loading?: boolean;
  workspace: DerivedComputerWorkspace;
}) {
  const selectedObservation = params.workspace.selectedFrame?.observation ?? null;
  const frame = selectedObservation?.frame ?? null;
  const context = selectedObservation?.context ?? null;
  const cursor = frame?.cursor ?? null;
  const diffBase = params.workspace.diffBaseFrame?.observation.frame ?? null;
  const frameCursorX = frame?.width ? ((cursor?.x ?? 0) / frame.width) * 100 : 0;
  const frameCursorY = frame?.height ? ((cursor?.y ?? 0) / frame.height) * 100 : 0;
  if (!frame) {
    return params.loading
      ? html`<div class="muted browser-pane__empty">
          ${chatText("browserPane.computer.loading")}
        </div>`
      : html`<div class="muted browser-pane__empty">
          ${chatText("browserPane.computer.noFrame")}
        </div>`;
  }
  return html`
    <div class="computer-pane__stage">
      <div class="computer-pane__frame-card">
        <div class="computer-pane__frame-toolbar">
          <div class="computer-pane__frame-badges">
            <span class="computer-pane__tag computer-pane__tag--surface">Computer</span>
            <span class="computer-pane__tag"
              >${context?.activeApp?.name ?? chatText("browserPane.computer.desktop")}</span
            >
            ${context?.activeWindow?.title
              ? html`<span class="computer-pane__tag">${context.activeWindow.title}</span>`
              : nothing}
            ${context?.display.id
              ? html`<span class="computer-pane__tag">${context.display.id}</span>`
              : nothing}
          </div>
          <div class="computer-pane__frame-meta">
            <span
              >${chatText("browserPane.computer.frameAge")}:
              ${formatFrameAge(params.workspace.frameAgeMs)}</span
            >
          </div>
        </div>
        <div class="computer-pane__frame">
          <img
            class="computer-pane__frame-image"
            alt=${chatText("browserPane.computer.frameAlt")}
            src=${frame.dataUrl}
          />
          ${diffBase
            ? html`
                <div class="computer-pane__diff-layer" aria-hidden="true">
                  <img class="computer-pane__diff-base" alt="" src=${diffBase.dataUrl} />
                  <img class="computer-pane__diff-current" alt="" src=${frame.dataUrl} />
                </div>
              `
            : nothing}
          ${renderComputerActionOverlay(params.workspace.selectedAction)}
          ${cursor?.visible
            ? html`
                <div
                  class="computer-pane__cursor"
                  style=${`left:${frameCursorX}%;top:${frameCursorY}%;`}
                ></div>
              `
            : nothing}
        </div>
        <div class="computer-pane__frame-footer">
          <span
            >${Math.round(frame.logicalWidth)} × ${Math.round(frame.logicalHeight)} logical</span
          >
          <span>${Math.round(frame.pixelWidth)} × ${Math.round(frame.pixelHeight)} px</span>
          <span>${frame.scaleFactor}x</span>
          <span>${frame.orientation}</span>
          ${params.workspace.selectedFrame?.metadata
            ? html`
                <span>${params.workspace.selectedFrame.metadata.frameHash}</span>
                <span>
                  ${chatText("browserPane.computer.captureLatency")}:
                  ${formatDuration(params.workspace.selectedFrame.metadata.captureLatencyMs)}
                </span>
                <span>
                  ${params.workspace.selectedFrame.metadata.stale
                    ? chatText("browserPane.computer.frameStale")
                    : chatText("browserPane.computer.frameFresh")}
                </span>
              `
            : nothing}
        </div>
      </div>
    </div>
  `;
}

function renderComputerMetricCard(label: string, value: string, hint?: string | null) {
  return html`
    <div class="computer-pane__metric-card">
      <span class="computer-pane__meta-label">${label}</span>
      <strong>${value}</strong>
      ${hint ? html`<span class="computer-pane__metric-hint">${hint}</span>` : nothing}
    </div>
  `;
}

function renderComputerPermissionStatus(
  permission: "screenRecording" | "accessibility",
  granted: boolean | null,
  onRequestPermission?: BrowserPaneProps["onRequestComputerPermission"],
) {
  const isGranted = granted === true;
  return html`
    <div class="computer-pane__permission-card">
      <div class="computer-pane__permission-head">
        <strong>${nativeShellPermissionLabel(permission)}</strong>
        <span
          class="computer-pane__permission-status ${isGranted
            ? "computer-pane__permission-status--ok"
            : "computer-pane__permission-status--missing"}"
        >
          ${isGranted
            ? chatText("browserPane.computer.permissionGranted")
            : chatText("browserPane.computer.permissionMissing")}
        </span>
      </div>
      <span>${nativeShellPermissionDescription(permission)}</span>
      ${!isGranted && onRequestPermission
        ? html`
            <button
              class="btn btn--sm"
              type="button"
              @click=${() => onRequestPermission(permission)}
            >
              ${chatText("browserPane.computer.requestPermission")}
            </button>
          `
        : nothing}
    </div>
  `;
}

function renderComputerReplayControls(
  props: BrowserPaneProps,
  workspace: DerivedComputerWorkspace,
) {
  if (workspace.replaySteps.length === 0) {
    return html`<div class="muted browser-pane__empty">
      ${chatText("browserPane.computer.noTimeline")}
    </div>`;
  }
  const selectedIndex = workspace.selectedStep
    ? Math.max(
        0,
        workspace.replaySteps.findIndex((step) => step.id === workspace.selectedStep?.id),
      )
    : workspace.replaySteps.length - 1;
  return html`
    <div class="computer-pane__replay-toolbar">
      <div class="computer-pane__replay-copy">
        <div class="computer-pane__timeline-title">${chatText("browserPane.computer.replay")}</div>
        <span>${chatText("browserPane.computer.scrubberLabel")}</span>
      </div>
      <div class="computer-pane__replay-actions">
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${!props.onSelectComputerReplayStep}
          @click=${() => props.onSelectComputerReplayStep?.(null)}
        >
          ${chatText("browserPane.computer.live")}
        </button>
        <button
          class="btn btn--sm"
          type="button"
          @click=${() =>
            props.onToggleComputerStepDetails?.(!(props.computerStepDetailsOpen ?? true))}
        >
          ${(props.computerStepDetailsOpen ?? true)
            ? chatText("browserPane.computer.hideDetails")
            : chatText("browserPane.computer.showDetails")}
        </button>
      </div>
    </div>
    <input
      class="computer-pane__scrubber"
      type="range"
      min="0"
      max=${String(Math.max(0, workspace.replaySteps.length - 1))}
      .value=${String(selectedIndex)}
      @input=${(event: Event) => {
        const target = event.currentTarget as HTMLInputElement;
        const index = Number.parseInt(target.value, 10);
        const step = workspace.replaySteps.at(index) ?? null;
        props.onSelectComputerReplayStep?.(step?.id ?? null);
      }}
    />
  `;
}

function renderComputerReplayStepList(
  props: BrowserPaneProps,
  workspace: DerivedComputerWorkspace,
) {
  return html`
    <div class="computer-pane__step-list">
      ${workspace.replaySteps.map((step) => {
        const selected = step.id === workspace.selectedStep?.id;
        return html`
          <button
            class="computer-pane__step-card ${selected ? "computer-pane__step-card--selected" : ""}"
            type="button"
            @click=${() => props.onSelectComputerReplayStep?.(step.id)}
          >
            <div class="computer-pane__step-card-head">
              <span class="computer-pane__tag computer-pane__tag--step"
                >${formatComputerStepLabel(step.sequence)}</span
              >
              <span class="computer-pane__tag">${formatComputerStepPhase(step.phase)}</span>
              <span class="computer-pane__tag">${formatComputerStepStatus(step.status)}</span>
            </div>
            <strong>${step.summary}</strong>
            <div class="computer-pane__step-card-meta">
              <span>${formatDuration(step.totalElapsedMs)}</span>
              <span>${chatText("browserPane.computer.actionCount")}: ${step.actionCount}</span>
              <span
                >${chatText("browserPane.computer.safetyEvents")}: ${step.safetyEventsCount}</span
              >
            </div>
          </button>
        `;
      })}
    </div>
  `;
}

function renderComputerStepDetailsDrawer(
  props: BrowserPaneProps,
  workspace: DerivedComputerWorkspace,
) {
  const selectedStep = workspace.selectedStep;
  if (!selectedStep || props.computerStepDetailsOpen === false) {
    return nothing;
  }
  const action = workspace.selectedAction;
  return html`
    <div class="computer-pane__step-drawer">
      <div class="computer-pane__step-drawer-head">
        <div>
          <div class="computer-pane__timeline-title">
            ${chatText("browserPane.computer.stepDetails")}
          </div>
          <strong>${selectedStep.summary}</strong>
        </div>
        <button
          class="btn btn--sm"
          type="button"
          @click=${() => props.onToggleComputerStepDetails?.(false)}
        >
          ${chatText("browserPane.computer.hideDetails")}
        </button>
      </div>
      <div class="computer-pane__details-grid">
        ${renderComputerMetricCard(
          chatText("browserPane.computer.currentStep"),
          formatComputerStepLabel(selectedStep.sequence),
          formatComputerStepPhase(selectedStep.phase),
        )}
        ${renderComputerMetricCard(
          chatText("browserPane.computer.stepLatency"),
          formatDuration(selectedStep.totalElapsedMs),
          selectedStep.lastActionElapsedMs
            ? `${chatText("browserPane.computer.lastActionLatency")} ${formatDuration(selectedStep.lastActionElapsedMs)}`
            : null,
        )}
        ${renderComputerMetricCard(
          chatText("browserPane.computer.actionCount"),
          `${selectedStep.actionCount}`,
          action?.summary ?? null,
        )}
        ${renderComputerMetricCard(
          chatText("browserPane.computer.safetyEvents"),
          `${selectedStep.safetyEventsCount}`,
          `${chatText("browserPane.computer.approvals")}: ${selectedStep.approvalCount}`,
        )}
      </div>
      ${action
        ? html`
            <div class="computer-pane__detail-block">
              <span class="computer-pane__meta-label"
                >${chatText("browserPane.computer.lastAction")}</span
              >
              <strong>${action.summary}</strong>
              <div class="computer-pane__timeline-tags">
                ${action.target
                  ? html`<span class="computer-pane__tag"
                      >${Math.round(action.target.x)}, ${Math.round(action.target.y)}</span
                    >`
                  : nothing}
                ${action.destination
                  ? html`<span class="computer-pane__tag"
                      >${Math.round(action.destination.x)},
                      ${Math.round(action.destination.y)}</span
                    >`
                  : nothing}
                ${action.url
                  ? html`<span class="computer-pane__tag">${action.url}</span>`
                  : nothing}
                ${action.path
                  ? html`<span class="computer-pane__tag">${action.path}</span>`
                  : nothing}
                ${action.app
                  ? html`<span class="computer-pane__tag">${action.app}</span>`
                  : nothing}
                ${action.keyCombo
                  ? html`<span class="computer-pane__tag">${action.keyCombo}</span>`
                  : nothing}
              </div>
              ${action.textPreview
                ? html`<div class="computer-pane__detail-note">${action.textPreview}</div>`
                : nothing}
            </div>
          `
        : nothing}
      ${workspace.replayPartial || workspace.selectedFrameMissing
        ? html`
            <div class="callout info computer-pane__callout">
              <strong>${chatText("browserPane.computer.replayDataPartial")}</strong>
              <span>${chatText("browserPane.computer.replayDataPartialHint")}</span>
              ${workspace.selectedFrameMissing
                ? html`<span>${chatText("browserPane.computer.replayFrameMissing")}</span>`
                : nothing}
            </div>
          `
        : nothing}
      ${workspace.selectedErrors.length > 0
        ? html`
            <div class="computer-pane__detail-block">
              <span class="computer-pane__meta-label">
                ${chatText("browserPane.computer.errorInspector")}
              </span>
              <div class="computer-pane__event-list">
                ${workspace.selectedErrors.map((entry) => renderComputerLogEntry(entry))}
              </div>
            </div>
          `
        : nothing}
      <div class="computer-pane__detail-block">
        <span class="computer-pane__meta-label">${chatText("browserPane.computer.eventLog")}</span>
        <div class="computer-pane__event-list">
          ${workspace.selectedEvents.length > 0
            ? workspace.selectedEvents.map((entry) => renderComputerLogEntry(entry))
            : html`<div class="muted browser-pane__empty">
                ${chatText("browserPane.computer.noEventLog")}
              </div>`}
        </div>
      </div>
      <div class="computer-pane__detail-block">
        <span class="computer-pane__meta-label">${chatText("browserPane.computer.timeline")}</span>
        <div class="computer-pane__timeline">
          ${workspace.selectedTimeline.length > 0
            ? workspace.selectedTimeline.map((entry) => renderComputerTimelineEntry(entry))
            : html`<div class="muted browser-pane__empty">
                ${chatText("browserPane.computer.noTimeline")}
              </div>`}
        </div>
      </div>
    </div>
  `;
}

function renderComputerSurface(props: BrowserPaneProps, session: ComputerSessionState) {
  const fallbackTarget = {
    id: `computer-session:${session.sessionKey}`,
    label: chatText("browserPane.computer.desktop"),
    kind: "local-mac-host" as const,
    globalInput: true,
    allowsConcurrentObserve: true,
    ...(session.nodeId ? { nodeId: session.nodeId } : {}),
  };
  const target = session.target ?? fallbackTarget;
  const capabilities = session.capabilities ?? [];
  const replay = session.replay ?? {
    frames: [],
    steps: [],
    actionCount: 0,
    safetyEventsCount: 0,
  };
  const eventLog = session.eventLog ?? [];
  const buffers = session.buffers ?? {
    eventLimit: 160,
    replayFrameLimit: 24,
    replayStepLimit: 24,
    timelineLimit: 80,
    eventLogTruncated: false,
    replayFramesTruncated: false,
    replayStepsTruncated: false,
    timelineTruncated: false,
  };
  const normalizedSession = {
    ...session,
    replay,
    eventLog,
    buffers,
  } satisfies ComputerSessionState;
  const awaitingApproval = session.awaitingApproval ?? null;
  const approvalSafetyEvents = awaitingApproval?.safetyEvents ?? [];
  const activeStep = session.activeStep ?? null;
  const lastCompletedStep = session.lastCompletedStep ?? null;
  const runtime = session.runtime ?? null;
  const blocking = session.blocking ?? null;
  const safety = session.safety ?? {
    level: "normal",
    lastEvent: null,
    recentEvents: [],
  };
  const canStart =
    session.status === "stopped" || session.status === "idle" || session.status === "error";
  const canPause = session.status !== "paused" && session.status !== "stopped";
  const canResume = session.status === "paused";
  const missingAccessibility = !session.permissions.accessibility;
  const missingScreenRecording = !session.permissions.screenRecording;
  const workspace = deriveComputerWorkspace(normalizedSession, props.selectedComputerReplayStepId);
  const selectedObservation = workspace.selectedFrame?.observation ?? null;
  const context = selectedObservation?.context ?? session.context ?? null;
  const activeRuntimeSession = runtime?.activeSession ?? null;
  const activeSessionIsCurrent = activeRuntimeSession?.sessionKey === session.sessionKey;
  const backgroundSessionKey =
    activeRuntimeSession && activeRuntimeSession.sessionKey !== session.sessionKey
      ? activeRuntimeSession.sessionKey
      : null;
  const foregroundControl = capabilities.some(
    (entry) =>
      entry.kind === "foreground_control" && entry.available && entry.exposure === "exposed",
  );
  const observeOnlyOnly =
    capabilities.some(
      (entry) => entry.kind === "observe_only" && entry.available && entry.exposure === "exposed",
    ) &&
    !capabilities.some(
      (entry) =>
        entry.kind === "foreground_control" && entry.available && entry.exposure === "exposed",
    );
  const selectedStepLatency =
    workspace.selectedStep?.totalElapsedMs ??
    (lastCompletedStep
      ? Math.max(0, lastCompletedStep.updatedAt - lastCompletedStep.startedAt)
      : null);

  return html`
    <div class="computer-pane">
      <div class="computer-pane__hero">
        <div class="computer-pane__summary">
          <div class="computer-pane__summary-copy">
            <div class="computer-pane__status-row">
              <span class="computer-pane__status computer-pane__status--${session.status}">
                ${formatComputerStatus(session.status)}
              </span>
              <span class="computer-pane__mode">${formatComputerMode(session.mode)}</span>
              ${runtime
                ? html`
                    <span class="computer-pane__tag"
                      >${formatComputerRuntimeState(runtime.connectionState)}</span
                    >
                  `
                : nothing}
              ${activeSessionIsCurrent
                ? html`
                    <span class="computer-pane__tag computer-pane__tag--surface"
                      >${chatText("browserPane.computer.activeSession")}</span
                    >
                  `
                : backgroundSessionKey
                  ? html`
                      <span class="computer-pane__tag"
                        >${chatText("browserPane.computer.backgroundSession")}</span
                      >
                    `
                  : nothing}
              ${foregroundControl
                ? html`
                    <span class="computer-pane__tag"
                      >${formatComputerCapability("foreground_control")}</span
                    >
                  `
                : observeOnlyOnly
                  ? html`<span class="computer-pane__tag"
                      >${formatComputerCapability("observe_only")}</span
                    >`
                  : nothing}
            </div>
            <div class="computer-pane__context">
              ${context?.activeApp?.name ?? chatText("browserPane.computer.desktop")}
              ${context?.activeWindow?.title
                ? html`<span class="computer-pane__context-window"
                    >${context.activeWindow.title}</span
                  >`
                : nothing}
            </div>
            <div class="computer-pane__step-summary">
              ${activeStep
                ? html`
                    <span class="computer-pane__tag computer-pane__tag--step"
                      >${formatComputerStepLabel(activeStep.sequence)}</span
                    >
                    <span class="computer-pane__tag"
                      >${formatComputerStepPhase(activeStep.phase)}</span
                    >
                    <span class="computer-pane__step-text">${activeStep.summary}</span>
                  `
                : lastCompletedStep
                  ? html`
                      <span class="computer-pane__tag computer-pane__tag--step"
                        >${formatComputerStepLabel(lastCompletedStep.sequence)}</span
                      >
                      <span class="computer-pane__tag"
                        >${formatComputerStepPhase(lastCompletedStep.phase)}</span
                      >
                      <span class="computer-pane__step-text">${lastCompletedStep.summary}</span>
                    `
                  : nothing}
            </div>
          </div>
          <div class="computer-pane__actions">
            ${backgroundSessionKey && props.onOpenComputerSession
              ? html`
                  <button
                    class="btn btn--sm"
                    type="button"
                    @click=${() => props.onOpenComputerSession?.(backgroundSessionKey)}
                  >
                    ${chatText("browserPane.computer.switchActiveSession")}
                  </button>
                `
              : nothing}
            <button
              class="btn btn--sm"
              type="button"
              ?disabled=${!props.onComputerSessionCommand || !canStart}
              @click=${() => props.onComputerSessionCommand?.("start")}
            >
              ${chatText("browserPane.computer.start")}
            </button>
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

        <div class="computer-pane__meta-grid computer-pane__meta-grid--metrics">
          ${renderComputerMetricCard(
            chatText("browserPane.computer.stepLatency"),
            formatDuration(selectedStepLatency),
            null,
          )}
          ${renderComputerMetricCard(
            chatText("browserPane.computer.lastAction"),
            workspace.lastActionSummary ?? "—",
            null,
          )}
          ${renderComputerMetricCard(
            chatText("browserPane.computer.frameAge"),
            formatFrameAge(workspace.frameAgeMs),
            null,
          )}
          ${renderComputerMetricCard(
            chatText("browserPane.computer.actionCount"),
            `${replay.actionCount}`,
            null,
          )}
          ${renderComputerMetricCard(
            chatText("browserPane.computer.safetyEvents"),
            `${replay.safetyEventsCount}`,
            null,
          )}
        </div>
      </div>

      ${props.computerError
        ? html`<div class="callout danger">${props.computerError}</div>`
        : nothing}
      ${session.lastError ? html`<div class="callout danger">${session.lastError}</div>` : nothing}
      ${runtime && runtime.connectionState !== "running"
        ? html`
            <div
              class="callout ${runtime.connectionState === "starting"
                ? "warning"
                : "danger"} computer-pane__callout"
            >
              <strong>${chatText("browserPane.computer.helperState")}</strong>
              <span>${formatComputerRuntimeState(runtime.connectionState)}</span>
              ${runtime.lastError?.message
                ? html`<span>${runtime.lastError.message}</span>`
                : nothing}
            </div>
          `
        : nothing}
      ${blocking && blocking.kind !== "blocked_on_approval"
        ? html`
            <div class="callout warning computer-pane__callout">
              <strong>${formatComputerBlocking(blocking.kind)}</strong>
              <span>${blocking.summary}</span>
              ${blocking.ownerSessionKey
                ? html`
                    <span>
                      ${chatText("browserPane.computer.controlOwner")}: ${blocking.ownerSessionKey}
                    </span>
                  `
                : nothing}
              ${backgroundSessionKey && props.onOpenComputerSession
                ? html`
                    <div class="computer-pane__callout-actions">
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => props.onOpenComputerSession?.(backgroundSessionKey)}
                      >
                        ${chatText("browserPane.computer.switchActiveSession")}
                      </button>
                    </div>
                  `
                : nothing}
            </div>
          `
        : nothing}
      ${foregroundControl && blocking?.kind !== "blocked_on_focus"
        ? html`
            <div class="callout info computer-pane__callout">
              <strong>${formatComputerCapability("foreground_control")}</strong>
              <span>${chatText("browserPane.computer.foregroundControlHint")}</span>
            </div>
          `
        : nothing}
      ${safety.lastEvent || safety.level !== "normal"
        ? html`
            <div
              class="callout ${safety.level === "watch"
                ? "warning"
                : "info"} computer-pane__callout"
            >
              <strong>${chatText("browserPane.computer.safetyBanner")}</strong>
              <span>${formatComputerSafetyLevel(safety.level)}</span>
              ${safety.lastEvent ? html`<span>${safety.lastEvent.summary}</span>` : nothing}
            </div>
          `
        : nothing}
      ${workspace.replayPartial
        ? html`
            <div class="callout info computer-pane__callout">
              <strong>${chatText("browserPane.computer.replayDataPartial")}</strong>
              <span>${chatText("browserPane.computer.replayDataPartialHint")}</span>
            </div>
          `
        : nothing}
      ${missingScreenRecording
        ? renderComputerPermissionCallout("screenRecording", props.onRequestComputerPermission)
        : nothing}
      ${missingAccessibility
        ? renderComputerPermissionCallout("accessibility", props.onRequestComputerPermission)
        : nothing}
      ${awaitingApproval
        ? html`
            <div class="callout warning computer-pane__approval">
              <strong>${chatText("browserPane.computer.awaitingApproval")}</strong>
              <span>${awaitingApproval.actionSummary}</span>
              ${awaitingApproval.policyDecision
                ? html`<span
                    >${formatComputerPolicyDecision(awaitingApproval.policyDecision)}</span
                  >`
                : nothing}
              <span>${awaitingApproval.reason}</span>
              ${approvalSafetyEvents.length > 0
                ? html`
                    <div class="computer-pane__timeline-tags">
                      ${approvalSafetyEvents.map(
                        (event) => html`<span class="computer-pane__tag">${event.type}</span>`,
                      )}
                    </div>
                  `
                : nothing}
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
        : nothing}

      <div class="computer-pane__workspace">
        <div class="computer-pane__workspace-main">
          ${renderComputerFrameStage({
            loading: props.computerLoading,
            workspace,
          })}
          <div class="computer-pane__meta-grid">
            ${renderComputerMetricCard(
              chatText("browserPane.computer.targetSession"),
              activeRuntimeSession?.sessionKey ?? session.sessionKey,
              target.label,
            )}
            ${renderComputerMetricCard(
              chatText("browserPane.computer.targetApp"),
              context?.activeApp?.name ?? chatText("browserPane.computer.unknown"),
              context?.activeApp?.bundleId ?? null,
            )}
            ${renderComputerMetricCard(
              chatText("browserPane.computer.window"),
              context?.activeWindow?.title ?? chatText("browserPane.computer.none"),
              null,
            )}
            ${renderComputerMetricCard(
              chatText("browserPane.computer.display"),
              context
                ? `${context.display.id ? `${context.display.id} · ` : ""}${Math.round(context.display.logicalWidth)} × ${Math.round(context.display.logicalHeight)}`
                : chatText("browserPane.computer.unknown"),
              context
                ? `${Math.round(context.display.pixelWidth)} × ${Math.round(context.display.pixelHeight)} px @ ${context.display.scale}x`
                : null,
            )}
            ${renderComputerMetricCard(
              chatText("browserPane.computer.helperProcess"),
              runtime?.helperProcessId
                ? `pid ${runtime.helperProcessId}`
                : chatText("browserPane.computer.none"),
              runtime?.helperVersion ?? null,
            )}
          </div>
          <div class="computer-pane__permission-grid">
            ${renderComputerPermissionStatus(
              "screenRecording",
              session.permissions.screenRecording,
              props.onRequestComputerPermission,
            )}
            ${renderComputerPermissionStatus(
              "accessibility",
              session.permissions.accessibility,
              props.onRequestComputerPermission,
            )}
          </div>
        </div>

        <div class="computer-pane__workspace-side">
          ${renderComputerReplayControls(props, workspace)}
          ${renderComputerReplayStepList(props, workspace)}
          ${renderComputerStepDetailsDrawer(props, workspace)}
        </div>
      </div>
    </div>
  `;
}

function renderPreviewSurface(preview: BrowserPaneBrowserState) {
  return html`
    <div class="workspace-pane__surface workspace-pane__surface--preview">
      <div class="workspace-pane__surface-hero">
        <div>
          <div class="browser-pane__title">${preview.title ?? getBrowserPaneLabel("preview")}</div>
          ${preview.subtitle
            ? html`<div class="computer-pane__step-text">${preview.subtitle}</div>`
            : nothing}
        </div>
        ${preview.status
          ? html`<span class="computer-pane__tag">${preview.status}</span>`
          : nothing}
      </div>
      ${preview.screenshotUrl
        ? html`
            <div class="computer-pane__frame-card">
              <div class="computer-pane__frame">
                <img class="computer-pane__frame-image" alt="" src=${preview.screenshotUrl} />
              </div>
            </div>
          `
        : html`<div class="muted browser-pane__empty">${chatText("browserPane.noContent")}</div>`}
      ${preview.url ? html`<div class="computer-pane__detail-note">${preview.url}</div>` : nothing}
    </div>
  `;
}

function renderToolOutputSurface(props: BrowserPaneProps, toolOutput: BrowserPaneToolOutputState) {
  return html`
    <div class="workspace-pane__surface workspace-pane__surface--tool-output">
      ${toolOutput.error
        ? html`
            <div class="callout danger">${toolOutput.error}</div>
            ${props.onViewRawText
              ? html`
                  <button @click=${props.onViewRawText} class="btn browser-pane__raw-action">
                    ${chatText("browserPane.viewRawText")}
                  </button>
                `
              : nothing}
          `
        : toolOutput.content
          ? html`<div class="sidebar-markdown">
              ${unsafeHTML(toSanitizedMarkdownHtml(toolOutput.content))}
            </div>`
          : html`<div class="muted browser-pane__empty">${chatText("browserPane.noContent")}</div>`}
    </div>
  `;
}

export function renderBrowserPane(props: BrowserPaneProps) {
  const available = getBrowserPaneAvailableSurfaces({
    browser: props.browser ?? null,
    computer: props.computer ?? null,
    toolOutput: props.toolOutput ?? null,
  });
  const surface = resolveBrowserPaneSurface({
    preferredSurface: props.selectedSurface ?? "tool_output",
    browser: props.browser ?? null,
    computer: props.computer ?? null,
    toolOutput: props.toolOutput ?? null,
  });
  const selectedSurface = surface?.kind ?? null;
  const title =
    selectedSurface && available.length <= 1
      ? getBrowserPaneLabel(selectedSurface)
      : chatText("browserPane.title");

  return html`
    <div class="browser-pane workspace-pane browser-pane__panel">
      <div class="browser-pane__header workspace-pane__header">
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
            : nothing}
        </div>
        ${props.embedded || !props.onClose
          ? nothing
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
        class="browser-pane__content ${surface?.kind === "computer"
          ? "browser-pane__content--computer"
          : ""}"
      >
        ${surface?.kind === "computer"
          ? renderComputerSurface(props, surface.session)
          : surface?.kind === "preview"
            ? renderPreviewSurface(surface.preview)
            : surface?.kind === "tool_output"
              ? renderToolOutputSurface(props, surface)
              : html`<div class="muted browser-pane__empty">
                  ${chatText("browserPane.unavailable")}
                </div>`}
      </div>
    </div>
  `;
}
