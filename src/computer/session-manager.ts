import { createHash, randomUUID } from "node:crypto";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  createDefaultComputerPolicy,
  evaluateComputerActionPolicy,
  isSensitiveComputerAction,
  mergeComputerPolicy,
} from "./policy-engine.js";
import { resolveComputerCapabilityMatrix, resolveComputerTarget } from "./runtime-profile.js";
import { computerSessionArbiter } from "./session-arbiter.js";
import type {
  ComputerApprovalMode,
  ComputerApprovalRequest,
  ComputerBackendKind,
  ComputerCapabilityDescriptor,
  ComputerExecutedActionResult,
  ComputerObservationContext,
  ComputerObservation,
  ComputerPolicyReasonCode,
  ComputerPermissionState,
  ComputerReplayAction,
  ComputerReplayFrameMetadata,
  ComputerReplayFrame,
  ComputerReplayStep,
  ComputerRuntimeState,
  ComputerSessionBufferState,
  ComputerSessionExport,
  ComputerSessionExportFrame,
  ComputerSessionLogEvent,
  ComputerSessionLogEventCode,
  ComputerSessionBlockingState,
  ComputerSafetyEvent,
  ComputerSessionPolicy,
  ComputerSessionReplay,
  ComputerSessionSafety,
  ComputerSessionState,
  ComputerSessionStatus,
  ComputerSessionStep,
  ComputerStepKind,
  ComputerStepPhase,
  ComputerStepStatus,
  ComputerStructuredAction,
  ComputerSessionTarget,
  ComputerTimelineEventCode,
  ComputerTimelineEntry,
} from "./types.js";

const COMPUTER_TIMELINE_LIMIT = 80;
const COMPUTER_EVENT_LOG_LIMIT = 160;
const COMPUTER_SAFETY_EVENT_LIMIT = 12;
const COMPUTER_SAFETY_DEDUP_MS = 5_000;
const COMPUTER_REPLAY_FRAME_LIMIT = 24;
const COMPUTER_REPLAY_STEP_LIMIT = 24;
const computerPolicyLog = createSubsystemLogger("computer/policy");
const computerRuntimeLog = createSubsystemLogger("computer/runtime");

type ApprovalDecision = "allow-once" | "allow-session" | "deny";

type EnsureSessionParams = {
  sessionKey: string;
  backend?: ComputerBackendKind;
  mode?: ComputerApprovalMode;
  nodeId?: string;
  permissions?: Partial<ComputerPermissionState>;
  policy?: Partial<ComputerSessionPolicy>;
};

type InternalApprovalState = {
  request: ComputerApprovalRequest;
  appIdentity?: string;
  resolve: (decision: ApprovalDecision) => void;
};

type InternalComputerSessionState = Omit<ComputerSessionState, "eventLog" | "buffers"> & {
  eventCounter: number;
  eventLog: ComputerSessionLogEvent[];
  buffers: ComputerSessionBufferState;
  pendingApproval?: InternalApprovalState;
};

type StepLink = Pick<
  ComputerSessionStep,
  | "id"
  | "sequence"
  | "toolCallId"
  | "runId"
  | "responseId"
  | "phase"
  | "sourceFrameId"
  | "resultFrameId"
>;

function cloneTimelineEntry(entry: ComputerTimelineEntry): ComputerTimelineEntry {
  return { ...entry };
}

function cloneFrame(
  frame: ComputerObservation["frame"] | null | undefined,
): ComputerObservation["frame"] | null {
  if (!frame) {
    return null;
  }
  return {
    ...frame,
    cursor: frame.cursor ? { ...frame.cursor } : null,
  };
}

function cloneObservationContext(
  context: ComputerObservationContext | null | undefined,
): ComputerObservationContext | null {
  if (!context) {
    return null;
  }
  return {
    ...context,
    display: { ...context.display },
    activeApp: context.activeApp ? { ...context.activeApp } : null,
    activeWindow: context.activeWindow ? { ...context.activeWindow } : null,
  };
}

function cloneStep(step: ComputerSessionStep | null | undefined): ComputerSessionStep | null {
  if (!step) {
    return null;
  }
  return { ...step };
}

function cloneRuntimeState(
  runtime: ComputerRuntimeState | null | undefined,
): ComputerRuntimeState | null {
  if (!runtime) {
    return null;
  }
  return {
    ...runtime,
    activeSession: runtime.activeSession ? { ...runtime.activeSession } : undefined,
    lastError: runtime.lastError ? { ...runtime.lastError } : runtime.lastError ?? null,
  };
}

function clonePolicy(
  policy: ComputerSessionPolicy | null | undefined,
): ComputerSessionPolicy {
  const current = policy ?? createDefaultComputerPolicy();
  return {
    allow: {
      apps: [...current.allow.apps],
      paths: [...current.allow.paths],
      hosts: [...current.allow.hosts],
      actions: [...current.allow.actions],
      surfaces: [...current.allow.surfaces],
    },
    deny: {
      apps: [...current.deny.apps],
      paths: [...current.deny.paths],
      hosts: [...current.deny.hosts],
      actions: [...current.deny.actions],
      surfaces: [...current.deny.surfaces],
    },
    sensitive: {
      apps: [...current.sensitive.apps],
      paths: [...current.sensitive.paths],
      hosts: [...current.sensitive.hosts],
      actions: [...current.sensitive.actions],
      surfaces: [...current.sensitive.surfaces],
    },
    commandLikeActions: [...current.commandLikeActions],
    lastDecision: current.lastDecision ? { ...current.lastDecision } : null,
  };
}

function cloneCapabilities(
  capabilities: readonly ComputerCapabilityDescriptor[] | null | undefined,
): ComputerCapabilityDescriptor[] {
  return (capabilities ?? []).map((entry) => ({ ...entry }));
}

function cloneTarget(target: ComputerSessionTarget | null | undefined): ComputerSessionTarget {
  if (target) {
    return { ...target };
  }
  return resolveComputerTarget({
    backend: "local-mac",
    sessionKey: "main",
  });
}

function cloneBlockingState(
  blocking: ComputerSessionBlockingState | null | undefined,
): ComputerSessionBlockingState | null {
  if (!blocking) {
    return null;
  }
  return { ...blocking };
}

function cloneSafetyEvent(event: ComputerSafetyEvent): ComputerSafetyEvent {
  return { ...event };
}

function cloneSafetyState(
  safety: ComputerSessionSafety | null | undefined,
): ComputerSessionSafety {
  return {
    level: safety?.level ?? "normal",
    lastEvent: safety?.lastEvent ? cloneSafetyEvent(safety.lastEvent) : null,
    recentEvents: (safety?.recentEvents ?? []).map(cloneSafetyEvent),
  };
}

function cloneReplayAction(action: ComputerReplayAction | null | undefined): ComputerReplayAction | null {
  if (!action) {
    return null;
  }
  return {
    ...action,
    target: action.target ? { ...action.target } : undefined,
    destination: action.destination ? { ...action.destination } : undefined,
    scrollDelta: action.scrollDelta ? { ...action.scrollDelta } : undefined,
  };
}

function cloneReplayFrameMetadata(
  metadata: ComputerReplayFrameMetadata | null | undefined,
): ComputerReplayFrameMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
  return {
    ...metadata,
    transform: { ...metadata.transform },
    display: { ...metadata.display },
    activeApp: metadata.activeApp ? { ...metadata.activeApp } : null,
    activeWindow: metadata.activeWindow ? { ...metadata.activeWindow } : null,
  };
}

function cloneReplayFrame(frame: ComputerReplayFrame): ComputerReplayFrame {
  return {
    ...frame,
    observation: {
      frame: cloneFrame(frame.observation.frame)!,
      context: cloneObservationContext(frame.observation.context)!,
    },
    ...(frame.metadata ? { metadata: cloneReplayFrameMetadata(frame.metadata) } : {}),
  };
}

function cloneReplayStep(step: ComputerReplayStep): ComputerReplayStep {
  return {
    ...step,
    action: cloneReplayAction(step.action),
  };
}

function cloneReplayState(replay: ComputerSessionReplay | null | undefined): ComputerSessionReplay {
  return {
    frames: (replay?.frames ?? []).map(cloneReplayFrame),
    steps: (replay?.steps ?? []).map(cloneReplayStep),
    actionCount: replay?.actionCount ?? 0,
    safetyEventsCount: replay?.safetyEventsCount ?? 0,
  };
}

function cloneSessionLogEvent(event: ComputerSessionLogEvent): ComputerSessionLogEvent {
  return { ...event };
}

function cloneBufferState(
  buffers: ComputerSessionBufferState | null | undefined,
): ComputerSessionBufferState {
  return {
    eventLimit: buffers?.eventLimit ?? COMPUTER_EVENT_LOG_LIMIT,
    replayFrameLimit: buffers?.replayFrameLimit ?? COMPUTER_REPLAY_FRAME_LIMIT,
    replayStepLimit: buffers?.replayStepLimit ?? COMPUTER_REPLAY_STEP_LIMIT,
    timelineLimit: buffers?.timelineLimit ?? COMPUTER_TIMELINE_LIMIT,
    eventLogTruncated: buffers?.eventLogTruncated ?? false,
    replayFramesTruncated: buffers?.replayFramesTruncated ?? false,
    replayStepsTruncated: buffers?.replayStepsTruncated ?? false,
    timelineTruncated: buffers?.timelineTruncated ?? false,
  };
}

function cloneState(state: InternalComputerSessionState): ComputerSessionState {
  return {
    sessionKey: state.sessionKey,
    backend: state.backend,
    status: state.status,
    mode: state.mode,
    nodeId: state.nodeId,
    target: cloneTarget(state.target),
    capabilities: cloneCapabilities(state.capabilities),
    approvedApps: [...state.approvedApps],
    policy: clonePolicy(state.policy),
    safety: cloneSafetyState(state.safety),
    replay: cloneReplayState(state.replay),
    blocking: cloneBlockingState(state.blocking),
    permissions: { ...state.permissions },
    runtime: cloneRuntimeState(state.runtime),
    context: cloneObservationContext(state.context),
    frame: cloneFrame(state.frame),
    stepCounter: state.stepCounter,
    activeStep: cloneStep(state.activeStep),
    lastCompletedStep: cloneStep(state.lastCompletedStep),
    timeline: state.timeline.map(cloneTimelineEntry),
    eventLog: state.eventLog.map(cloneSessionLogEvent),
    buffers: cloneBufferState(state.buffers),
    awaitingApproval: state.awaitingApproval
      ? {
          ...state.awaitingApproval,
          safetyEvents: state.awaitingApproval.safetyEvents.map(cloneSafetyEvent),
        }
      : null,
    lastError: state.lastError ?? null,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
  };
}

function nowStateTimestamp(): number {
  return Date.now();
}

function createTimelineEntry(
  kind: ComputerTimelineEntry["kind"],
  summary: string,
  patch: Omit<Partial<ComputerTimelineEntry>, "id" | "kind" | "summary" | "at"> = {},
): ComputerTimelineEntry {
  return {
    id: randomUUID(),
    at: nowStateTimestamp(),
    kind,
    summary,
    ...patch,
  };
}

function createSessionStep(params: {
  sequence: number;
  toolCallId: string;
  runId?: string | null;
  responseId?: string | null;
  kind: ComputerStepKind;
  phase: ComputerStepPhase;
  status: ComputerStepStatus;
  summary: string;
  actionType?: ComputerStructuredAction["type"];
}): ComputerSessionStep {
  const ts = nowStateTimestamp();
  return {
    id: randomUUID(),
    sequence: params.sequence,
    toolCallId: params.toolCallId,
    ...(params.runId !== undefined ? { runId: params.runId } : {}),
    ...(params.responseId !== undefined ? { responseId: params.responseId } : {}),
    kind: params.kind,
    phase: params.phase,
    status: params.status,
    summary: params.summary,
    actionType: params.actionType,
    sourceFrameId: undefined,
    resultFrameId: undefined,
    startedAt: ts,
    updatedAt: ts,
  };
}

function createInitialState(params: EnsureSessionParams): InternalComputerSessionState {
  const ts = nowStateTimestamp();
  const policy = mergeComputerPolicy(createDefaultComputerPolicy(), params.policy ?? {});
  const target = resolveComputerTarget({
    backend: params.backend ?? "local-mac",
    sessionKey: params.sessionKey,
    nodeId: params.nodeId,
  });
  return {
    sessionKey: params.sessionKey,
    backend: params.backend ?? "local-mac",
    status: "idle",
    mode: params.mode ?? "approved_apps_only",
    nodeId: params.nodeId,
    target,
    capabilities: resolveComputerCapabilityMatrix(params.backend ?? "local-mac"),
    approvedApps: [],
    policy,
    safety: {
      level: "normal",
      lastEvent: null,
      recentEvents: [],
    },
    replay: {
      frames: [],
      steps: [],
      actionCount: 0,
      safetyEventsCount: 0,
    },
    blocking: null,
    permissions: {
      accessibility: params.permissions?.accessibility ?? false,
      screenRecording: params.permissions?.screenRecording ?? false,
    },
    runtime: null,
    context: null,
    frame: null,
    stepCounter: 0,
    activeStep: null,
    lastCompletedStep: null,
    timeline: [],
    eventLog: [],
    buffers: {
      eventLimit: COMPUTER_EVENT_LOG_LIMIT,
      replayFrameLimit: COMPUTER_REPLAY_FRAME_LIMIT,
      replayStepLimit: COMPUTER_REPLAY_STEP_LIMIT,
      timelineLimit: COMPUTER_TIMELINE_LIMIT,
      eventLogTruncated: false,
      replayFramesTruncated: false,
      replayStepsTruncated: false,
      timelineTruncated: false,
    },
    awaitingApproval: null,
    lastError: null,
    eventCounter: 0,
    startedAt: ts,
    updatedAt: ts,
  };
}

function summarizeAction(action: ComputerStructuredAction): string {
  switch (action.type) {
    case "move":
      return `move @ (${Math.round(action.x ?? 0)}, ${Math.round(action.y ?? 0)})`;
    case "click":
    case "double_click":
    case "right_click":
      return `${action.type.replaceAll("_", " ")} @ (${Math.round(action.x ?? 0)}, ${Math.round(action.y ?? 0)})`;
    case "drag":
      return `drag (${Math.round(action.x ?? 0)}, ${Math.round(action.y ?? 0)}) -> (${Math.round(action.toX ?? 0)}, ${Math.round(action.toY ?? 0)})`;
    case "scroll":
      return `scroll (${Math.round(action.deltaX ?? 0)}, ${Math.round(action.deltaY ?? 0)})`;
    case "type":
      return `type ${JSON.stringify(action.text ?? "")}`;
    case "keypress":
      return `keypress ${[...(action.modifiers ?? []), action.key ?? ""].filter(Boolean).join("+")}`;
    case "wait":
      return `wait ${Math.round(action.delayMs ?? 0)}ms`;
    case "screenshot":
      return "capture screenshot";
    case "focus_app":
      return `focus app ${action.app ?? ""}`;
    case "open_url":
      return `open url ${action.url ?? ""}`;
    case "reveal_path":
      return `reveal path ${action.path ?? ""}`;
    case "open_path":
      return `open path ${action.path ?? ""}`;
    case "open_app":
      return `open app ${action.app ?? ""}`;
    case "app_focus":
      return `focus app ${action.app ?? ""}`;
  }
}

function toReplayTextPreview(value: string | null | undefined, limit = 120): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

function createReplayActionFromStructuredAction(
  action: ComputerStructuredAction,
  summary = summarizeAction(action),
): ComputerReplayAction {
  const base: ComputerReplayAction = {
    actionId: action.id,
    type: action.type,
    summary,
    coordinateSpace: action.coordinateSpace,
    referenceWidth: action.transform?.sourceWidth ?? action.frame?.pixelWidth ?? undefined,
    referenceHeight: action.transform?.sourceHeight ?? action.frame?.pixelHeight ?? undefined,
  };
  switch (action.type) {
    case "move":
    case "click":
    case "double_click":
    case "right_click":
      return {
        ...base,
        target:
          action.x !== undefined && action.y !== undefined
            ? { x: action.x, y: action.y }
            : undefined,
      };
    case "drag":
      return {
        ...base,
        target:
          action.x !== undefined && action.y !== undefined
            ? { x: action.x, y: action.y }
            : undefined,
        destination:
          action.toX !== undefined && action.toY !== undefined
            ? { x: action.toX, y: action.toY }
            : undefined,
      };
    case "scroll":
      return {
        ...base,
        scrollDelta: {
          x: action.deltaX ?? 0,
          y: action.deltaY ?? 0,
        },
      };
    case "type":
      return {
        ...base,
        textPreview: toReplayTextPreview(action.text),
      };
    case "keypress":
      return {
        ...base,
        keyCombo: [...(action.modifiers ?? []), action.key ?? ""].filter(Boolean).join("+"),
      };
    case "wait":
      return {
        ...base,
        delayMs: action.delayMs,
      };
    case "focus_app":
    case "open_app":
    case "app_focus":
      return {
        ...base,
        app: action.app,
      };
    case "open_url":
      return {
        ...base,
        url: action.url,
      };
    case "reveal_path":
    case "open_path":
      return {
        ...base,
        path: action.path,
      };
    case "screenshot":
      return base;
  }
}

function computeDataUrlSizeBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  if (!base64) {
    return 0;
  }
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function computeFrameHash(dataUrl: string): string {
  return createHash("sha256").update(dataUrl).digest("hex").slice(0, 16);
}

function inferPermissionPatchFromError(error: string): Partial<ComputerPermissionState> | null {
  if (/PERMISSION_MISSING:\s*accessibility/i.test(error)) {
    return { accessibility: false };
  }
  if (/PERMISSION_MISSING:\s*screenRecording/i.test(error)) {
    return { screenRecording: false };
  }
  return null;
}

function logPolicyEvent(
  event:
    | "approval_requested"
    | "approval_decided"
    | "safety_raised"
    | "policy_denied"
    | "policy_escalated"
    | "policy_mode_changed",
  meta: Record<string, unknown>,
) {
  computerPolicyLog.info(`computer policy ${event}`, { event, ...meta });
}

function logRuntimeEvent(
  event:
    | "session_arbitrated"
    | "session_blocked"
    | "focus_required"
    | "runtime_busy"
    | "concurrency_denied"
    | "mode_exposed"
    | "mode_hidden",
  meta: Record<string, unknown>,
) {
  computerRuntimeLog.info(`computer runtime ${event}`, { event, ...meta });
}

export class ComputerSessionManager {
  private readonly sessions = new Map<string, InternalComputerSessionState>();

  ensureSession(params: EnsureSessionParams): ComputerSessionState {
    const existing = this.sessions.get(params.sessionKey);
    if (existing) {
      const previousCapabilities = cloneCapabilities(existing.capabilities);
      if (params.nodeId?.trim()) {
        existing.nodeId = params.nodeId.trim();
      }
      if (params.backend) {
        existing.backend = params.backend;
      }
      if (params.mode) {
        existing.mode = params.mode;
      }
      if (params.permissions) {
        existing.permissions = {
          ...existing.permissions,
          ...params.permissions,
        };
      }
      if (params.policy) {
        existing.policy = mergeComputerPolicy(existing.policy, params.policy);
      }
      this.refreshSessionProfile(existing);
      this.logCapabilityExposureChanges(existing, previousCapabilities);
      existing.updatedAt = nowStateTimestamp();
      return cloneState(existing);
    }
    const created = createInitialState(params);
    this.logCapabilityExposureChanges(created, []);
    this.sessions.set(params.sessionKey, created);
    return cloneState(created);
  }

  getSession(sessionKey: string): ComputerSessionState | null {
    const state = this.sessions.get(sessionKey);
    return state ? cloneState(state) : null;
  }

  markSessionArbitrated(params: {
    sessionKey: string;
    summary: string;
    eventCode?: Extract<ComputerTimelineEventCode, "session_arbitrated" | "focus_required">;
  }): ComputerSessionState {
    const state = this.requireSession(params.sessionKey);
    state.blocking = null;
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("status", params.summary, {
        status: state.status,
        eventCode: params.eventCode ?? "session_arbitrated",
        ...this.stepLink(state.activeStep ?? state.lastCompletedStep),
      }),
    );
    this.appendEventLog(state, params.eventCode === "focus_required" ? "focus_required" : "session_arbitrated", params.summary, {
      status: state.status,
      ...this.stepEventLink(state.activeStep ?? state.lastCompletedStep),
    });
    logRuntimeEvent(params.eventCode ?? "session_arbitrated", {
      sessionKey: params.sessionKey,
      targetId: state.target.id,
      status: state.status,
    });
    return cloneState(state);
  }

  setBlocking(
    sessionKey: string,
    blocking: ComputerSessionBlockingState | null,
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.blocking = cloneBlockingState(blocking);
    state.updatedAt = nowStateTimestamp();
    if (blocking) {
      const blockingEventCode =
        blocking.reasonCode === "focus_required"
          ? "focus_required"
          : blocking.reasonCode === "runtime_busy"
            ? "session_blocked"
            : blocking.reasonCode === "concurrency_denied"
              ? "session_blocked"
              : "session_blocked";
      state.timeline = this.pushTimeline(
        state,
        createTimelineEntry("status", blocking.summary, {
          status: state.status,
          eventCode:
            blocking.reasonCode === "focus_required"
              ? "focus_required"
              : blocking.reasonCode === "runtime_busy"
                ? "runtime_busy"
                : blocking.reasonCode === "concurrency_denied"
                  ? "concurrency_denied"
                  : "session_blocked",
          actionType: blocking.actionType,
          ...this.stepLink(state.activeStep ?? state.lastCompletedStep),
        }),
      );
      this.appendEventLog(state, blockingEventCode, blocking.summary, {
        status: state.status,
        actionType: blocking.actionType,
        ...this.stepEventLink(state.activeStep ?? state.lastCompletedStep),
      });
      logRuntimeEvent(
        blocking.reasonCode === "focus_required"
          ? "focus_required"
          : blocking.reasonCode === "runtime_busy"
            ? "runtime_busy"
            : blocking.reasonCode === "concurrency_denied"
              ? "concurrency_denied"
              : "session_blocked",
        {
          sessionKey,
          targetId: blocking.targetId ?? state.target.id,
          summary: blocking.summary,
          ownerSessionKey: blocking.ownerSessionKey,
          actionType: blocking.actionType,
        },
      );
    }
    return cloneState(state);
  }

  setMode(sessionKey: string, mode: ComputerApprovalMode): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    const previousMode = state.mode;
    state.mode = mode;
    state.status = state.status === "stopped" ? state.status : "idle";
    state.blocking = null;
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("status", `mode -> ${mode}`, {
        status: state.status,
      }),
    );
    this.appendEventLog(state, "state_transition", `mode -> ${mode}`, {
      status: state.status,
      ...this.stepEventLink(state.activeStep ?? state.lastCompletedStep),
    });
    if (previousMode !== mode) {
      logPolicyEvent("policy_mode_changed", {
        sessionKey,
        previousMode,
        mode,
      });
    }
    return cloneState(state);
  }

  setPolicy(
    sessionKey: string,
    policy: Partial<ComputerSessionPolicy>,
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.policy = mergeComputerPolicy(state.policy, policy);
    state.updatedAt = nowStateTimestamp();
    return cloneState(state);
  }

  setPermissions(
    sessionKey: string,
    permissions: Partial<ComputerPermissionState>,
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.permissions = { ...state.permissions, ...permissions };
    state.updatedAt = nowStateTimestamp();
    return cloneState(state);
  }

  setRuntime(sessionKey: string, runtime: ComputerRuntimeState | null): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.runtime = cloneRuntimeState(runtime);
    if (state.runtime?.connectionState === "running" && state.blocking?.kind === "blocked_on_runtime") {
      state.blocking = null;
    }
    state.updatedAt = nowStateTimestamp();
    return cloneState(state);
  }

  setStatus(
    sessionKey: string,
    status: ComputerSessionStatus,
    summary?: string,
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.status = status;
    state.updatedAt = nowStateTimestamp();
    if (summary) {
      state.timeline = this.pushTimeline(
        state,
        createTimelineEntry("status", summary, {
          status,
          ...this.stepLink(state.activeStep),
        }),
      );
      this.appendEventLog(state, "state_transition", summary, {
        status,
        ...this.stepEventLink(state.activeStep),
      });
    }
    return cloneState(state);
  }

  startStep(params: {
    sessionKey: string;
    toolCallId: string;
    runId?: string | null;
    responseId?: string | null;
    kind: ComputerStepKind;
    phase: ComputerStepPhase;
    summary: string;
    actionType?: ComputerStructuredAction["type"];
  }): ComputerSessionState {
    const state = this.requireSession(params.sessionKey);
    if (state.activeStep) {
      throw new Error(
        `computer session already has an active step (${state.activeStep.sequence}:${state.activeStep.phase})`,
      );
    }
    state.blocking = null;
    state.stepCounter += 1;
    state.activeStep = createSessionStep({
      sequence: state.stepCounter,
      toolCallId: params.toolCallId,
      runId: params.runId,
      responseId: params.responseId,
      kind: params.kind,
      phase: params.phase,
      status: params.phase === "awaiting-approval" ? "awaiting-approval" : "running",
      summary: params.summary,
      actionType: params.actionType,
    });
    this.syncReplayStepFromSessionStep(state, state.activeStep);
    state.updatedAt = nowStateTimestamp();
    return cloneState(state);
  }

  recordObservation(
    sessionKey: string,
    observation: ComputerObservation,
    summary = "frame captured",
    options?: {
      phase?: ComputerStepPhase;
      stepSummary?: string;
    },
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    this.maybeAdvanceActiveStep(state, {
      phase: options?.phase,
      summary: options?.stepSummary,
      status: "running",
    });
    state.frame = cloneFrame(observation.frame);
    state.context = cloneObservationContext(observation.context);
    if (state.activeStep && options?.phase === "observe-before-action") {
      state.activeStep.sourceFrameId = observation.frame.id;
    }
    if (state.activeStep && options?.phase === "observe-after-action") {
      state.activeStep.resultFrameId = observation.frame.id;
    }
    if (state.activeStep && options?.phase === "observe") {
      state.activeStep.resultFrameId = observation.frame.id;
    }
    this.appendReplayFrame(state, observation, state.activeStep, options?.phase);
    this.syncReplayStepFromSessionStep(state, state.activeStep);
    this.refreshTargetDisplay(state, observation.context.display.id);
    state.lastError = null;
    if (state.blocking?.kind !== "blocked_on_approval") {
      state.blocking = null;
    }
    if (state.status !== "awaiting-approval" && state.status !== "paused") {
      state.status = "observing";
    }
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("observation", summary, {
        status: state.status,
        ...this.stepLink(state.activeStep),
        resultFrameId:
          options?.phase === "observe-after-action" ? observation.frame.id : undefined,
        sourceFrameId:
          options?.phase === "observe-before-action" ? observation.frame.id : undefined,
      }),
    );
    this.appendEventLog(state, "frame_captured", summary, {
      status: state.status,
      ...this.stepEventLink(state.activeStep),
      sourceFrameId:
        options?.phase === "observe-before-action" ? observation.frame.id : undefined,
      resultFrameId:
        options?.phase === "observe-after-action" || options?.phase === "observe"
          ? observation.frame.id
          : undefined,
    });
    return cloneState(state);
  }

  recordActionRequested(
    sessionKey: string,
    action: ComputerStructuredAction,
    summary = summarizeAction(action),
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    this.appendEventLog(state, "action_requested", summary, {
      status: state.status,
      actionType: action.type,
      actionId: action.id,
      sourceFrameId: action.frame?.frameId,
      ...this.stepEventLink(state.activeStep),
    });
    return cloneState(state);
  }

  recordAction(
    sessionKey: string,
    action: ComputerStructuredAction,
    summary = summarizeAction(action),
    options?: {
      actionId?: string;
      sourceFrameId?: string;
    },
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    this.maybeAdvanceActiveStep(state, {
      phase: "action",
      summary,
      status: "running",
    });
    if (state.activeStep && options?.sourceFrameId) {
      state.activeStep.sourceFrameId = options.sourceFrameId;
    }
    state.replay.actionCount += 1;
    this.syncReplayStepFromSessionStep(state, state.activeStep, {
      actionCount:
        (state.replay.steps.find((entry) => entry.id === state.activeStep?.id)?.actionCount ?? 0) + 1,
      action: createReplayActionFromStructuredAction(action, summary),
    });
    state.blocking = null;
    state.status = "running";
    state.lastError = null;
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("action", summary, {
        status: "running",
        actionType: action.type,
        ...this.stepLink(state.activeStep),
        actionId: options?.actionId,
        sourceFrameId: options?.sourceFrameId,
      }),
    );
    return cloneState(state);
  }

  recordActionResult(
    sessionKey: string,
    result: ComputerExecutedActionResult,
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    if (state.activeStep && result.resultFrameId) {
      state.activeStep.resultFrameId = result.resultFrameId;
    }
    this.syncReplayStepFromSessionStep(state, state.activeStep, {
      lastActionElapsedMs: result.elapsedMs,
      totalElapsedMs: state.activeStep
        ? Math.max(0, state.activeStep.updatedAt - state.activeStep.startedAt) + result.elapsedMs
        : result.elapsedMs,
    });
    state.updatedAt = nowStateTimestamp();
    state.blocking = null;
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("action", result.summary, {
        status: result.success ? "running" : "error",
        actionType: result.type,
        ...this.stepLink(state.activeStep),
        actionId: result.actionId,
        actionResultId: result.id,
        nativeActionId: result.id,
        sourceFrameId: result.sourceFrameId,
        resultFrameId: result.resultFrameId,
        success: result.success,
        elapsedMs: result.elapsedMs,
        retryCount: result.retryCount,
        failureCategory: result.failureCategory,
      }),
    );
    this.appendEventLog(
      state,
      result.success ? "action_executed" : "action_failed",
      result.summary,
      {
        status: result.success ? "running" : "error",
        actionType: result.type,
        actionId: result.actionId,
        nativeActionId: result.id,
        sourceFrameId: result.sourceFrameId,
        resultFrameId: result.resultFrameId,
        success: result.success,
        elapsedMs: result.elapsedMs,
        retryCount: result.retryCount,
        failureCategory: result.failureCategory,
        ...this.stepEventLink(state.activeStep),
      },
    );
    return cloneState(state);
  }

  evaluateActionPolicy(params: {
    sessionKey: string;
    action: ComputerStructuredAction;
    context?: ComputerObservationContext | null;
    targetAppIdentity?: string | null;
  }): { session: ComputerSessionState; evaluation: ReturnType<typeof evaluateComputerActionPolicy> } {
    const state = this.requireSession(params.sessionKey);
    const evaluation = evaluateComputerActionPolicy({
      mode: state.mode,
      status: state.status,
      pendingApproval: Boolean(state.awaitingApproval),
      policy: state.policy,
      approvedApps: state.approvedApps,
      action: params.action,
      context: params.context,
      targetAppIdentity: params.targetAppIdentity,
    });
    const ts = nowStateTimestamp();
    state.policy.lastDecision = {
      at: ts,
      actionType: params.action.type,
      decision: evaluation.decision,
      reasonCode: evaluation.reasonCode,
      reason: evaluation.reason,
      ...(evaluation.appIdentity ? { appIdentity: evaluation.appIdentity } : {}),
    };
    state.safety.level = evaluation.safetyLevel;
    for (const event of evaluation.safetyEvents) {
      this.appendSafetyEvent(state, event, params.action.type);
    }
    if (evaluation.escalatedMode && evaluation.escalatedMode !== state.mode) {
      const previousMode = state.mode;
      state.mode = evaluation.escalatedMode;
      state.timeline = this.pushTimeline(
        state,
        createTimelineEntry("status", `mode -> ${state.mode}`, {
          status: state.status,
          policyDecision: evaluation.decision,
          reasonCode: evaluation.reasonCode,
          actionType: params.action.type,
          ...this.stepLink(state.activeStep),
        }),
      );
      logPolicyEvent("policy_escalated", {
        sessionKey: params.sessionKey,
        previousMode,
        mode: state.mode,
        actionType: params.action.type,
        reasonCode: evaluation.reasonCode,
      });
      logPolicyEvent("policy_mode_changed", {
        sessionKey: params.sessionKey,
        previousMode,
        mode: state.mode,
      });
    }
    this.appendEventLog(state, "action_validated", evaluation.reason, {
      status: state.status,
      actionType: params.action.type,
      actionId: params.action.id,
      sourceFrameId: params.action.frame?.frameId,
      policyDecision: evaluation.decision,
      reasonCode: evaluation.reasonCode,
      ...this.stepEventLink(state.activeStep),
    });
    state.updatedAt = ts;
    return {
      session: cloneState(state),
      evaluation,
    };
  }

  recordPolicyDenied(
    sessionKey: string,
    params: {
      action: ComputerStructuredAction;
      reason: string;
      reasonCode: ComputerPolicyReasonCode;
      appIdentity?: string;
    },
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    const nextStatus: ComputerSessionStatus =
      params.reasonCode === "session_stopped"
        ? "stopped"
        : params.reasonCode === "approval_pending"
          ? "awaiting-approval"
          : params.reasonCode === "session_paused"
            ? "paused"
            : "paused";
    state.status = nextStatus;
    state.lastError = null;
    state.blocking = {
      kind:
        params.reasonCode === "approval_pending"
          ? "blocked_on_approval"
          : params.reasonCode === "session_paused"
            ? "blocked_on_runtime"
            : "blocked_on_runtime",
      reasonCode:
        params.reasonCode === "approval_pending" ? "approval_required" : "runtime_busy",
      summary: params.reason,
      at: nowStateTimestamp(),
      targetId: state.target.id,
      actionType: params.action.type,
    };
    if (state.activeStep) {
      state.activeStep.status = "cancelled";
      state.activeStep.summary = params.reason;
      state.activeStep.updatedAt = nowStateTimestamp();
      this.syncReplayStepFromSessionStep(state, state.activeStep);
      state.lastCompletedStep = cloneStep(state.activeStep);
      state.activeStep = null;
    }
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("safety", params.reason, {
        status: state.status,
        actionType: params.action.type,
        policyDecision: "deny",
        reasonCode: params.reasonCode,
        ...this.stepLink(state.lastCompletedStep),
      }),
    );
    this.appendEventLog(state, "session_blocked", params.reason, {
      status: state.status,
      actionType: params.action.type,
      reasonCode: params.reasonCode,
      actionId: params.action.id,
      sourceFrameId: params.action.frame?.frameId,
      ...this.stepEventLink(state.lastCompletedStep),
    });
    logPolicyEvent("policy_denied", {
      sessionKey,
      actionType: params.action.type,
      reasonCode: params.reasonCode,
      reason: params.reason,
      ...(params.appIdentity ? { appIdentity: params.appIdentity } : {}),
    });
    return cloneState(state);
  }

  recordError(sessionKey: string, error: string): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    const failedStep = state.activeStep ?? state.lastCompletedStep;
    state.status = "error";
    state.lastError = error;
    state.blocking = null;
    const permissionPatch = inferPermissionPatchFromError(error);
    if (permissionPatch) {
      state.permissions = {
        ...state.permissions,
        ...permissionPatch,
      };
    }
    state.awaitingApproval = null;
    if (state.pendingApproval) {
      state.pendingApproval.resolve("deny");
      state.pendingApproval = undefined;
    }
    if (state.activeStep) {
      state.activeStep.status = "error";
      state.activeStep.summary = error;
      state.activeStep.updatedAt = nowStateTimestamp();
      this.syncReplayStepFromSessionStep(state, state.activeStep);
      state.lastCompletedStep = cloneStep(state.activeStep);
      state.activeStep = null;
    }
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("error", error, {
        status: "error",
        ...this.stepLink(state.lastCompletedStep),
      }),
    );
    this.appendEventLog(
      state,
      failedStep?.actionType ? "action_failed" : "state_transition",
      error,
      {
        status: "error",
        actionType: failedStep?.actionType,
        failureCategory: "execution-failed",
        ...this.stepEventLink(failedStep),
      },
    );
    return cloneState(state);
  }

  completeStep(
    sessionKey: string,
    summary?: string,
    phase?: ComputerStepPhase,
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    const step = state.activeStep;
    if (!step) {
      return cloneState(state);
    }
    if (phase) {
      step.phase = phase;
    }
    if (summary) {
      step.summary = summary;
    }
    step.status = "completed";
    step.updatedAt = nowStateTimestamp();
    this.syncReplayStepFromSessionStep(state, step);
    state.lastCompletedStep = cloneStep(step);
    state.activeStep = null;
    state.blocking = null;
    state.updatedAt = step.updatedAt;
    return cloneState(state);
  }

  cancelStep(sessionKey: string, summary: string, phase?: ComputerStepPhase): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    const step = state.activeStep;
    if (!step) {
      return cloneState(state);
    }
    if (phase) {
      step.phase = phase;
    }
    step.summary = summary;
    step.status = "cancelled";
    step.updatedAt = nowStateTimestamp();
    this.syncReplayStepFromSessionStep(state, step);
    state.lastCompletedStep = cloneStep(step);
    state.activeStep = null;
    state.blocking = null;
    state.updatedAt = step.updatedAt;
    return cloneState(state);
  }

  pause(sessionKey: string): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    computerSessionArbiter.abortSession(sessionKey, "computer session paused");
    state.status = "paused";
    state.blocking = {
      kind: "blocked_on_runtime",
      reasonCode: "runtime_busy",
      summary: "session paused",
      at: nowStateTimestamp(),
      targetId: state.target.id,
    };
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("status", "session paused", {
        status: "paused",
        ...this.stepLink(state.activeStep),
      }),
    );
    this.appendEventLog(state, "session_paused", "session paused", {
      status: "paused",
      ...this.stepEventLink(state.activeStep ?? state.lastCompletedStep),
    });
    return cloneState(state);
  }

  resume(sessionKey: string): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.status = "idle";
    state.blocking = null;
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("status", "session resumed", {
        status: "idle",
        ...this.stepLink(state.activeStep),
      }),
    );
    this.appendEventLog(state, "session_resumed", "session resumed", {
      status: "idle",
      ...this.stepEventLink(state.activeStep ?? state.lastCompletedStep),
    });
    return cloneState(state);
  }

  stop(sessionKey: string): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    computerSessionArbiter.abortSession(sessionKey, "computer session stopped");
    state.status = "stopped";
    state.updatedAt = nowStateTimestamp();
    state.awaitingApproval = null;
    state.blocking = null;
    if (state.pendingApproval) {
      state.pendingApproval.resolve("deny");
      state.pendingApproval = undefined;
    }
    if (state.activeStep) {
      state.activeStep.status = "cancelled";
      state.activeStep.summary = "session stopped";
      state.activeStep.updatedAt = nowStateTimestamp();
      this.syncReplayStepFromSessionStep(state, state.activeStep);
      state.lastCompletedStep = cloneStep(state.activeStep);
      state.activeStep = null;
    }
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("status", "session stopped", {
        status: "stopped",
        ...this.stepLink(state.lastCompletedStep),
      }),
    );
    this.appendEventLog(state, "session_stopped", "session stopped", {
      status: "stopped",
      ...this.stepEventLink(state.lastCompletedStep),
    });
    return cloneState(state);
  }

  async requestApproval(params: {
    sessionKey: string;
    action: ComputerStructuredAction;
    reason: string;
    reasonCode: ComputerPolicyReasonCode;
    policyDecision: "require_once" | "require_session";
    safetyEvents: ComputerSafetyEvent[];
    context?: ComputerObservationContext | null;
    appIdentity?: string;
  }): Promise<ApprovalDecision> {
    const state = this.requireSession(params.sessionKey);
    const request: ComputerApprovalRequest = {
      id: randomUUID(),
      createdAt: nowStateTimestamp(),
      actionType: params.action.type,
      actionSummary: summarizeAction(params.action),
      reason: params.reason,
      reasonCode: params.reasonCode,
      policyDecision: params.policyDecision,
      sensitive: isSensitiveComputerAction(params.action, state.policy),
      safetyEvents: params.safetyEvents.map(cloneSafetyEvent),
      appName: params.context?.activeApp?.name ?? undefined,
      appBundleId: params.context?.activeApp?.bundleId ?? undefined,
      stepId: state.activeStep?.id,
      stepSequence: state.activeStep?.sequence,
      toolCallId: state.activeStep?.toolCallId,
      runId: state.activeStep?.runId,
      responseId: state.activeStep?.responseId,
    };
    this.maybeAdvanceActiveStep(state, {
      phase: "awaiting-approval",
      summary: request.actionSummary,
      status: "awaiting-approval",
    });
    this.syncReplayStepFromSessionStep(state, state.activeStep, {
      approvalCount:
        (state.replay.steps.find((entry) => entry.id === state.activeStep?.id)?.approvalCount ?? 0) + 1,
    });
    state.blocking = {
      kind: "blocked_on_approval",
      reasonCode: "approval_required",
      summary: request.reason,
      at: request.createdAt,
      targetId: state.target.id,
      foregroundControlRequired: true,
      actionType: request.actionType,
    };
    state.awaitingApproval = request;
    state.status = "awaiting-approval";
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("approval", `${request.actionSummary} awaiting approval`, {
        status: "awaiting-approval",
        actionType: request.actionType,
        policyDecision: request.policyDecision,
        reasonCode: request.reasonCode,
        ...this.stepLink(state.activeStep),
      }),
    );
    this.appendEventLog(state, "approval_requested", `${request.actionSummary} awaiting approval`, {
      status: "awaiting-approval",
      actionType: request.actionType,
      policyDecision: request.policyDecision,
      reasonCode: request.reasonCode,
      ...this.stepEventLink(state.activeStep),
    });
    logPolicyEvent("approval_requested", {
      sessionKey: params.sessionKey,
      actionType: request.actionType,
      policyDecision: request.policyDecision,
      reasonCode: request.reasonCode,
      reason: request.reason,
      safetyEvents: request.safetyEvents.map((event) => event.type),
      ...(params.appIdentity ? { appIdentity: params.appIdentity } : {}),
    });
    return await new Promise<ApprovalDecision>((resolve) => {
      state.pendingApproval = {
        request,
        appIdentity: params.appIdentity,
        resolve: (decision) => {
          if (
            decision === "allow-session" &&
            request.policyDecision === "require_session" &&
            params.appIdentity
          ) {
            if (!state.approvedApps.includes(params.appIdentity)) {
              state.approvedApps.push(params.appIdentity);
            }
          }
          state.awaitingApproval = null;
          state.pendingApproval = undefined;
          state.blocking = null;
          state.status = decision === "deny" ? "paused" : "running";
          if (state.activeStep) {
            state.activeStep.updatedAt = nowStateTimestamp();
            if (decision === "deny") {
              state.activeStep.status = "cancelled";
              state.activeStep.summary = `${request.actionSummary} denied`;
              this.syncReplayStepFromSessionStep(state, state.activeStep);
              state.lastCompletedStep = cloneStep(state.activeStep);
              state.activeStep = null;
            } else {
              state.activeStep.status = "running";
              state.activeStep.phase = "action";
              this.syncReplayStepFromSessionStep(state, state.activeStep);
            }
          }
          state.updatedAt = nowStateTimestamp();
          state.timeline = this.pushTimeline(
            state,
            createTimelineEntry(
              "approval",
              `${request.actionSummary} ${decision === "deny" ? "denied" : "approved"}`,
              {
                status: state.status,
                actionType: request.actionType,
                policyDecision: request.policyDecision,
                reasonCode: request.reasonCode,
                ...this.stepLink(state.activeStep ?? state.lastCompletedStep),
              },
            ),
          );
          this.appendEventLog(
            state,
            "approval_decided",
            `${request.actionSummary} ${decision === "deny" ? "denied" : "approved"}`,
            {
              status: state.status,
              actionType: request.actionType,
              policyDecision: request.policyDecision,
              reasonCode: request.reasonCode,
              ...this.stepEventLink(state.activeStep ?? state.lastCompletedStep),
            },
          );
          logPolicyEvent("approval_decided", {
            sessionKey: params.sessionKey,
            actionType: request.actionType,
            decision,
            policyDecision: request.policyDecision,
            reasonCode: request.reasonCode,
            ...(params.appIdentity ? { appIdentity: params.appIdentity } : {}),
          });
          resolve(decision);
        },
      };
    });
  }

  resolveApproval(params: {
    sessionKey: string;
    requestId: string;
    decision: ApprovalDecision;
  }): ComputerSessionState {
    const state = this.requireSession(params.sessionKey);
    const pending = state.pendingApproval;
    if (!pending || pending.request.id !== params.requestId) {
      throw new Error("Computer approval request not found");
    }
    pending.resolve(params.decision);
    return cloneState(state);
  }

  isAppApproved(sessionKey: string, appIdentity: string | null | undefined): boolean {
    const trimmed = appIdentity?.trim();
    if (!trimmed) {
      return false;
    }
    const state = this.requireSession(sessionKey);
    return state.approvedApps.includes(trimmed);
  }

  shouldRequireApproval(params: {
    sessionKey: string;
    action: ComputerStructuredAction;
    context?: ComputerObservationContext | null;
    targetAppIdentity?: string | null;
  }): { required: boolean; reason?: string; appIdentity?: string } {
    const { evaluation } = this.evaluateActionPolicy(params);
    return {
      required: evaluation.decision === "require_once" || evaluation.decision === "require_session",
      ...(evaluation.reason ? { reason: evaluation.reason } : {}),
      ...(evaluation.appIdentity ? { appIdentity: evaluation.appIdentity } : {}),
    };
  }

  exportSession(sessionKey: string): ComputerSessionExport {
    const state = this.requireSession(sessionKey);
    const eventLog = state.eventLog.map(cloneSessionLogEvent);
    const approvalHistory = eventLog.filter(
      (entry) => entry.code === "approval_requested" || entry.code === "approval_decided",
    );
    const lastErrors = eventLog
      .filter((entry) => entry.code === "action_failed" || (entry.code === "state_transition" && entry.status === "error"))
      .slice(-12);
    const replayFrames = state.replay.frames.map((entry) => this.toExportFrame(entry));
    const replayPartial =
      state.buffers.eventLogTruncated ||
      state.buffers.replayFramesTruncated ||
      state.buffers.replayStepsTruncated ||
      state.buffers.timelineTruncated;
    return {
      exportedAt: nowStateTimestamp(),
      sessionKey: state.sessionKey,
      summary: {
        backend: state.backend,
        status: state.status,
        mode: state.mode,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        target: cloneTarget(state.target),
        permissions: { ...state.permissions },
        capabilities: cloneCapabilities(state.capabilities),
        actionCount: state.replay.actionCount,
        safetyEventsCount: state.replay.safetyEventsCount,
        approvalCount: approvalHistory.filter((entry) => entry.code === "approval_requested").length,
        eventCount: eventLog.length,
        ...(state.lastError !== undefined ? { lastError: state.lastError } : {}),
        activeApp: state.context?.activeApp ? { ...state.context.activeApp } : null,
        activeWindow: state.context?.activeWindow ? { ...state.context.activeWindow } : null,
        display: state.context?.display ? { ...state.context.display } : null,
        replayPartial,
        correlationCoverage: {
          hasRunId: eventLog.some((entry) => typeof entry.runId === "string" && entry.runId.length > 0),
          hasResponseId: eventLog.some(
            (entry) => typeof entry.responseId === "string" && entry.responseId.length > 0,
          ),
          hasToolCallId: eventLog.some(
            (entry) => typeof entry.toolCallId === "string" && entry.toolCallId.length > 0,
          ),
          hasStepId: eventLog.some((entry) => typeof entry.stepId === "string" && entry.stepId.length > 0),
          hasActionId: eventLog.some(
            (entry) => typeof entry.actionId === "string" && entry.actionId.length > 0,
          ),
          hasNativeActionId: eventLog.some(
            (entry) => typeof entry.nativeActionId === "string" && entry.nativeActionId.length > 0,
          ),
        },
      },
      buffers: cloneBufferState(state.buffers),
      eventLog,
      lastErrors,
      approvalHistory,
      safetyHistory: state.safety.recentEvents.map(cloneSafetyEvent),
      timeline: state.timeline.map(cloneTimelineEntry),
      replay: {
        partial: replayPartial,
        steps: state.replay.steps.map(cloneReplayStep),
        frames: replayFrames,
      },
    };
  }

  private upsertReplayStep(
    state: InternalComputerSessionState,
    step: ComputerSessionStep,
    patch?: Partial<ComputerReplayStep>,
  ): ComputerReplayStep {
    const existingIndex = state.replay.steps.findIndex((entry) => entry.id === step.id);
    const existing = existingIndex >= 0 ? state.replay.steps[existingIndex] : null;
    const next: ComputerReplayStep = {
      id: step.id,
      sequence: step.sequence,
      toolCallId: step.toolCallId,
      ...(step.runId !== undefined ? { runId: step.runId } : {}),
      ...(step.responseId !== undefined ? { responseId: step.responseId } : {}),
      kind: step.kind,
      phase: step.phase,
      status: step.status,
      summary: step.summary,
      actionType: step.actionType,
      sourceFrameId: step.sourceFrameId,
      resultFrameId: step.resultFrameId,
      startedAt: step.startedAt,
      updatedAt: step.updatedAt,
      totalElapsedMs: Math.max(0, step.updatedAt - step.startedAt),
      lastActionElapsedMs: existing?.lastActionElapsedMs,
      actionCount: existing?.actionCount ?? 0,
      approvalCount: existing?.approvalCount ?? 0,
      safetyEventsCount: existing?.safetyEventsCount ?? 0,
      ...patch,
      action: patch?.action !== undefined ? cloneReplayAction(patch.action) : cloneReplayAction(existing?.action),
    };
    if (existingIndex >= 0) {
      state.replay.steps.splice(existingIndex, 1, next);
    } else {
      const appended = [...state.replay.steps, next];
      if (appended.length > COMPUTER_REPLAY_STEP_LIMIT) {
        state.buffers.replayStepsTruncated = true;
      }
      state.replay.steps = appended.slice(-COMPUTER_REPLAY_STEP_LIMIT);
    }
    return next;
  }

  private syncReplayStepFromSessionStep(
    state: InternalComputerSessionState,
    step: ComputerSessionStep | null | undefined,
    patch?: Partial<ComputerReplayStep>,
  ): ComputerReplayStep | null {
    if (!step) {
      return null;
    }
    return this.upsertReplayStep(state, step, patch);
  }

  private appendReplayFrame(
    state: InternalComputerSessionState,
    observation: ComputerObservation,
    step: ComputerSessionStep | null | undefined,
    phase?: ComputerStepPhase,
  ) {
    const recordedAt = nowStateTimestamp();
    const entry: ComputerReplayFrame = {
      frameId: observation.frame.id,
      capturedAt: observation.frame.capturedAt,
      observation: {
        frame: cloneFrame(observation.frame)!,
        context: cloneObservationContext(observation.context)!,
      },
      metadata: {
        frameHash: computeFrameHash(observation.frame.dataUrl),
        sizeBytes: computeDataUrlSizeBytes(observation.frame.dataUrl),
        captureLatencyMs: Math.max(0, recordedAt - observation.frame.capturedAt),
        stale: recordedAt > observation.frame.staleAt,
        stalenessMs: Math.max(0, recordedAt - observation.frame.capturedAt),
        transform: {
          sourceSpace: observation.frame.sourceSpace,
          sourceWidth: observation.frame.pixelWidth,
          sourceHeight: observation.frame.pixelHeight,
        },
        display: { ...observation.context.display },
        activeApp: observation.context.activeApp ? { ...observation.context.activeApp } : null,
        activeWindow: observation.context.activeWindow ? { ...observation.context.activeWindow } : null,
      },
      ...(step?.id ? { stepId: step.id } : {}),
      ...(step?.sequence !== undefined ? { stepSequence: step.sequence } : {}),
      ...(phase ? { stepPhase: phase } : {}),
    };
    const nextFrames = [
      ...state.replay.frames.filter((frame) => frame.frameId !== entry.frameId),
      entry,
    ];
    if (nextFrames.length > COMPUTER_REPLAY_FRAME_LIMIT) {
      state.buffers.replayFramesTruncated = true;
    }
    state.replay.frames = nextFrames.slice(-COMPUTER_REPLAY_FRAME_LIMIT);
  }

  private appendSafetyEvent(
    state: InternalComputerSessionState,
    event: ComputerSafetyEvent,
    actionType: ComputerStructuredAction["type"],
  ) {
    const lastMatching = state.safety.recentEvents.find(
      (entry) =>
        entry.type === event.type &&
        entry.reasonCode === event.reasonCode &&
        entry.summary === event.summary,
    );
    if (lastMatching && event.at - lastMatching.at < COMPUTER_SAFETY_DEDUP_MS) {
      state.safety.lastEvent = cloneSafetyEvent(lastMatching);
      return;
    }
    state.safety.lastEvent = cloneSafetyEvent(event);
    state.safety.recentEvents = [
      ...state.safety.recentEvents.filter(
        (entry) => !(entry.type === event.type && entry.reasonCode === event.reasonCode && entry.summary === event.summary),
      ),
      cloneSafetyEvent(event),
    ].slice(-COMPUTER_SAFETY_EVENT_LIMIT);
    state.replay.safetyEventsCount += 1;
    this.syncReplayStepFromSessionStep(state, state.activeStep, {
      safetyEventsCount:
        (state.replay.steps.find((entry) => entry.id === state.activeStep?.id)?.safetyEventsCount ?? 0) + 1,
    });
    state.timeline = this.pushTimeline(
      state,
      createTimelineEntry("safety", event.summary, {
        status: state.status,
        actionType,
        safetyEventType: event.type,
        reasonCode: event.reasonCode,
        heuristic: event.heuristic,
        ...this.stepLink(state.activeStep),
      }),
    );
    this.appendEventLog(state, "safety_raised", event.summary, {
      status: state.status,
      actionType,
      reasonCode: event.reasonCode,
      safetyEventType: event.type,
      heuristic: event.heuristic,
      ...this.stepEventLink(state.activeStep),
    });
    logPolicyEvent("safety_raised", {
      sessionKey: state.sessionKey,
      actionType,
      safetyEventType: event.type,
      reasonCode: event.reasonCode,
      heuristic: event.heuristic,
      ...(event.appBundleId ? { appBundleId: event.appBundleId } : {}),
      ...(event.windowTitle ? { windowTitle: event.windowTitle } : {}),
      ...(event.host ? { host: event.host } : {}),
      ...(event.path ? { path: event.path } : {}),
    });
  }

  private refreshSessionProfile(state: InternalComputerSessionState) {
    state.target = resolveComputerTarget({
      backend: state.backend,
      sessionKey: state.sessionKey,
      nodeId: state.nodeId,
      displayId: state.target.displayId,
    });
    state.capabilities = resolveComputerCapabilityMatrix(state.backend);
  }

  private refreshTargetDisplay(
    state: InternalComputerSessionState,
    displayId: string | null | undefined,
  ) {
    const normalizedDisplayId = displayId?.trim() || undefined;
    state.target = resolveComputerTarget({
      backend: state.backend,
      sessionKey: state.sessionKey,
      nodeId: state.nodeId,
      displayId: normalizedDisplayId ?? state.target.displayId,
    });
  }

  private logCapabilityExposureChanges(
    state: InternalComputerSessionState,
    previous: readonly ComputerCapabilityDescriptor[],
  ) {
    for (const capability of state.capabilities) {
      const before = previous.find((entry) => entry.kind === capability.kind);
      if (
        before?.available === capability.available &&
        before?.exposure === capability.exposure &&
        before?.reason === capability.reason
      ) {
        continue;
      }
      const event = capability.exposure === "exposed" && capability.available ? "mode_exposed" : "mode_hidden";
      state.timeline = this.pushTimeline(
        state,
        createTimelineEntry("status", capability.reason, {
          status: state.status,
          eventCode: event,
        }),
      );
      logRuntimeEvent(event, {
        sessionKey: state.sessionKey,
        backend: state.backend,
        capability: capability.kind,
        reason: capability.reason,
      });
    }
  }

  private requireSession(sessionKey: string): InternalComputerSessionState {
    const state = this.sessions.get(sessionKey);
    if (!state) {
      throw new Error(`Computer session not found: ${sessionKey}`);
    }
    return state;
  }

  private pushTimeline(
    state: InternalComputerSessionState,
    next: ComputerTimelineEntry,
  ): ComputerTimelineEntry[] {
    if (state.timeline.length >= COMPUTER_TIMELINE_LIMIT) {
      state.buffers.timelineTruncated = true;
    }
    return this.nextTimeline(state.timeline, next);
  }

  private nextTimeline(
    current: ComputerTimelineEntry[],
    next: ComputerTimelineEntry,
  ): ComputerTimelineEntry[] {
    const merged = [...current, next];
    if (merged.length <= COMPUTER_TIMELINE_LIMIT) {
      return merged;
    }
    return merged.slice(merged.length - COMPUTER_TIMELINE_LIMIT);
  }

  private appendEventLog(
    state: InternalComputerSessionState,
    code: ComputerSessionLogEventCode,
    summary: string,
    patch: Omit<
      Partial<ComputerSessionLogEvent>,
      "id" | "ordinal" | "at" | "code" | "summary" | "sessionId"
    > = {},
  ) {
    state.eventCounter += 1;
    const entry: ComputerSessionLogEvent = {
      id: randomUUID(),
      ordinal: state.eventCounter,
      at: nowStateTimestamp(),
      code,
      summary,
      sessionId: state.sessionKey,
      ...patch,
    };
    if (state.eventLog.length >= COMPUTER_EVENT_LOG_LIMIT) {
      state.buffers.eventLogTruncated = true;
    }
    state.eventLog = [...state.eventLog, entry].slice(-COMPUTER_EVENT_LOG_LIMIT);
  }

  private maybeAdvanceActiveStep(
    state: InternalComputerSessionState,
    params: {
      phase?: ComputerStepPhase;
      status?: ComputerStepStatus;
      summary?: string;
    },
  ) {
    const step = state.activeStep;
    if (!step) {
      return;
    }
    if (params.phase) {
      step.phase = params.phase;
    }
    if (params.status) {
      step.status = params.status;
    }
    if (params.summary) {
      step.summary = params.summary;
    }
    step.updatedAt = nowStateTimestamp();
    this.syncReplayStepFromSessionStep(state, step);
  }

  private stepLink(step: StepLink | null | undefined): Partial<ComputerTimelineEntry> {
    if (!step) {
      return {};
    }
    return {
      stepId: step.id,
      stepSequence: step.sequence,
      toolCallId: step.toolCallId,
      runId: "runId" in step ? step.runId : undefined,
      responseId: "responseId" in step ? step.responseId : undefined,
      stepPhase: step.phase,
      sourceFrameId: step.sourceFrameId,
      resultFrameId: step.resultFrameId,
    };
  }

  private stepEventLink(
    step: StepLink | null | undefined,
  ): Omit<
    Partial<ComputerSessionLogEvent>,
    "id" | "ordinal" | "at" | "code" | "summary" | "sessionId"
  > {
    if (!step) {
      return {};
    }
    return {
      stepId: step.id,
      stepSequence: step.sequence,
      toolCallId: step.toolCallId,
      runId: step.runId,
      responseId: step.responseId,
      stepPhase: step.phase,
      sourceFrameId: step.sourceFrameId,
      resultFrameId: step.resultFrameId,
    };
  }

  private toExportFrame(entry: ComputerReplayFrame): ComputerSessionExportFrame {
    const frame = entry.observation.frame;
    const metadata =
      entry.metadata ??
      ({
        frameHash: computeFrameHash(frame.dataUrl),
        sizeBytes: computeDataUrlSizeBytes(frame.dataUrl),
        captureLatencyMs: Math.max(0, nowStateTimestamp() - frame.capturedAt),
        stale: nowStateTimestamp() > frame.staleAt,
        stalenessMs: Math.max(0, nowStateTimestamp() - frame.capturedAt),
        transform: {
          sourceSpace: frame.sourceSpace,
          sourceWidth: frame.pixelWidth,
          sourceHeight: frame.pixelHeight,
        },
        display: { ...entry.observation.context.display },
        activeApp: entry.observation.context.activeApp ? { ...entry.observation.context.activeApp } : null,
        activeWindow: entry.observation.context.activeWindow ? { ...entry.observation.context.activeWindow } : null,
      } satisfies ComputerReplayFrameMetadata);
    return {
      frameId: entry.frameId,
      frameHash: metadata.frameHash,
      capturedAt: entry.capturedAt,
      ...(entry.stepId ? { stepId: entry.stepId } : {}),
      ...(entry.stepSequence !== undefined ? { stepSequence: entry.stepSequence } : {}),
      ...(entry.stepPhase ? { stepPhase: entry.stepPhase } : {}),
      ...(frame.displayId ? { displayId: frame.displayId } : {}),
      sourceSpace: frame.sourceSpace,
      width: frame.width,
      height: frame.height,
      pixelWidth: frame.pixelWidth,
      pixelHeight: frame.pixelHeight,
      logicalWidth: frame.logicalWidth,
      logicalHeight: frame.logicalHeight,
      scaleFactor: frame.scaleFactor,
      orientation: frame.orientation,
      maxAgeMs: frame.maxAgeMs,
      captureLatencyMs: metadata.captureLatencyMs,
      stale: metadata.stale,
      stalenessMs: metadata.stalenessMs,
      sizeBytes: metadata.sizeBytes,
      display: { ...metadata.display },
      activeApp: metadata.activeApp ? { ...metadata.activeApp } : null,
      activeWindow: metadata.activeWindow ? { ...metadata.activeWindow } : null,
      redacted: true,
    };
  }
}

export const computerSessionManager = new ComputerSessionManager();
