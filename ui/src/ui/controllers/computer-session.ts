import { GatewayRequestError } from "../gateway.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  resolveComputerCapabilityMatrix,
  resolveComputerTarget,
} from "../../../../src/computer/runtime-profile.js";
import type {
  ComputerActionType,
  ComputerApprovalMode,
  ComputerApprovalRequest,
  ComputerCapabilityDescriptor,
  ComputerCapabilityKind,
  ComputerFrame,
  ComputerObservationContext,
  ComputerPolicyDecision,
  ComputerPermissionState,
  ComputerPolicyReasonCode,
  ComputerReplayAction,
  ComputerReplayFrame,
  ComputerReplayStep,
  ComputerSafetyEvent,
  ComputerSafetyEventType,
  ComputerSessionBufferState,
  ComputerSessionExport,
  ComputerSessionExportFrame,
  ComputerSessionLogEvent,
  ComputerSessionBlockingState,
  ComputerSessionState,
  ComputerSessionStatus,
  ComputerSessionStep,
  ComputerSessionTarget,
  ComputerTimelineEventCode,
  ComputerStepPhase,
  ComputerStepStatus,
  ComputerTimelineEntry,
} from "../types.ts";

type ComputerSessionEvent = {
  sessionKey: string;
  session: ComputerSessionState;
};

type ComputerSessionHost = {
  client: Pick<GatewayBrowserClient, "request"> | null;
  connected: boolean;
  sessionKey: string;
  computerSessionLoading?: boolean;
  computerSessionError?: string | null;
  setComputerSession: (sessionKey: string, session: ComputerSessionState | null) => void;
};

type ComputerSessionCommand = "start" | "pause" | "resume" | "stop";
type ComputerApprovalDecision = "allow-once" | "allow-session" | "deny";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readSessionStatus(value: unknown): ComputerSessionStatus | null {
  switch (value) {
    case "idle":
    case "observing":
    case "running":
    case "paused":
    case "awaiting-approval":
    case "error":
    case "stopped":
      return value;
    default:
      return null;
  }
}

function readApprovalMode(value: unknown): ComputerApprovalMode | null {
  switch (value) {
    case "observe_only":
    case "observe-only":
      return "observe_only";
    case "approved_apps_only":
    case "control-approved-apps":
      return "approved_apps_only";
    case "foreground_supervised":
      return "foreground_supervised";
    case "elevated_watch_mode":
    case "elevated-watch":
      return "elevated_watch_mode";
    default:
      return null;
  }
}

function readActionType(value: unknown): ComputerActionType | null {
  switch (value) {
    case "move":
    case "click":
    case "double_click":
    case "right_click":
    case "drag":
    case "scroll":
    case "type":
    case "keypress":
    case "wait":
    case "screenshot":
    case "focus_app":
    case "open_url":
    case "reveal_path":
    case "open_path":
    case "open_app":
    case "app_focus":
      return value;
    default:
      return null;
  }
}

function readStepPhase(value: unknown): ComputerStepPhase | null {
  switch (value) {
    case "observe":
    case "observe-before-action":
    case "awaiting-approval":
    case "action":
    case "observe-after-action":
      return value;
    default:
      return null;
  }
}

function readStepStatus(value: unknown): ComputerStepStatus | null {
  switch (value) {
    case "running":
    case "awaiting-approval":
    case "completed":
    case "error":
    case "cancelled":
      return value;
    default:
      return null;
  }
}

function readRuntimeConnectionState(value: unknown) {
  switch (value) {
    case "idle":
    case "starting":
    case "running":
    case "interrupted":
    case "invalidated":
    case "disabled":
      return value;
    default:
      return null;
  }
}

function readRuntimeSessionState(value: unknown) {
  switch (value) {
    case "running":
    case "paused":
    case "stopped":
      return value;
    default:
      return null;
  }
}

function readRuntimeErrorCode(value: unknown) {
  switch (value) {
    case "PERMISSION_MISSING":
    case "HELPER_UNAVAILABLE":
    case "CAPTURE_FAILED":
    case "ACTION_REJECTED":
    case "CONNECTION_INTERRUPTED":
    case "CONNECTION_INVALIDATED":
    case "PROTOCOL_VERSION_MISMATCH":
    case "INVALID_REQUEST":
      return value;
    default:
      return null;
  }
}

function readCapabilityKind(value: unknown): ComputerCapabilityKind | null {
  switch (value) {
    case "observe_only":
    case "foreground_control":
    case "background_safe_control":
    case "future_virtualized_control":
      return value;
    default:
      return null;
  }
}

function readTimelineEventCode(value: unknown): ComputerTimelineEventCode | null {
  switch (value) {
    case "session_arbitrated":
    case "session_blocked":
    case "focus_required":
    case "runtime_busy":
    case "concurrency_denied":
    case "mode_exposed":
    case "mode_hidden":
      return value;
    default:
      return null;
  }
}

function readSessionLogEventCode(value: unknown) {
  switch (value) {
    case "frame_captured":
    case "action_requested":
    case "action_validated":
    case "action_executed":
    case "action_failed":
    case "approval_requested":
    case "approval_decided":
    case "safety_raised":
    case "state_transition":
    case "session_paused":
    case "session_resumed":
    case "session_stopped":
    case "session_blocked":
    case "session_arbitrated":
    case "focus_required":
      return value;
    default:
      return null;
  }
}

function readSessionTarget(value: unknown): ComputerSessionTarget | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const label = readString(value.label);
  const kind =
    value.kind === "local-mac-host" ||
    value.kind === "remote-node-target" ||
    value.kind === "ssh-mac-host"
      ? value.kind
      : null;
  const globalInput = readBoolean(value.globalInput);
  const allowsConcurrentObserve = readBoolean(value.allowsConcurrentObserve);
  if (!id || !label || !kind || globalInput === null || allowsConcurrentObserve === null) {
    return null;
  }
  return {
    id,
    label,
    kind,
    ...(readString(value.nodeId) ? { nodeId: readString(value.nodeId)! } : {}),
    ...(readString(value.displayId) ? { displayId: readString(value.displayId)! } : {}),
    globalInput,
    allowsConcurrentObserve,
  };
}

function readCapabilityDescriptor(value: unknown): ComputerCapabilityDescriptor | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = readCapabilityKind(value.kind);
  const available = readBoolean(value.available);
  const exposure = value.exposure === "exposed" || value.exposure === "hidden" ? value.exposure : null;
  const reason = readString(value.reason);
  if (!kind || available === null || !exposure || !reason) {
    return null;
  }
  return {
    kind,
    available,
    exposure,
    reason,
  };
}

function readBlockingState(value: unknown): ComputerSessionBlockingState | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind =
    value.kind === "blocked_on_focus" ||
    value.kind === "blocked_on_approval" ||
    value.kind === "blocked_on_runtime"
      ? value.kind
      : null;
  const reasonCode =
    value.reasonCode === "focus_required" ||
    value.reasonCode === "approval_required" ||
    value.reasonCode === "runtime_busy" ||
    value.reasonCode === "concurrency_denied"
      ? value.reasonCode
      : null;
  const summary = readString(value.summary);
  const at = readNumber(value.at);
  const actionType = readActionType(value.actionType) ?? undefined;
  const foregroundControlRequired = readBoolean(value.foregroundControlRequired);
  if (!kind || !reasonCode || !summary || at === null) {
    return null;
  }
  return {
    kind,
    reasonCode,
    summary,
    at,
    ...(readString(value.targetId) ? { targetId: readString(value.targetId)! } : {}),
    ...(readString(value.ownerSessionKey)
      ? { ownerSessionKey: readString(value.ownerSessionKey)! }
      : {}),
    ...(foregroundControlRequired !== null
      ? { foregroundControlRequired }
      : {}),
    ...(actionType ? { actionType } : {}),
  };
}

function readPolicyDecision(value: unknown): ComputerPolicyDecision | null {
  switch (value) {
    case "allow":
    case "require_once":
    case "require_session":
    case "deny":
      return value;
    default:
      return null;
  }
}

function readPolicyReasonCode(value: unknown): ComputerPolicyReasonCode | null {
  switch (value) {
    case "session_stopped":
    case "session_paused":
    case "approval_pending":
    case "observe_only_block":
    case "blocked_action":
    case "blocked_app":
    case "blocked_path":
    case "blocked_host":
    case "unapproved_app":
    case "foreground_supervision":
    case "elevated_watch_mode":
    case "sensitive_surface":
    case "auth_context":
    case "prod_terminal":
    case "payment_or_credentials_surface":
    case "malicious_instruction_suspected":
    case "scope_escape_attempt":
    case "untrusted_external_content":
      return value;
    default:
      return null;
  }
}

function readSafetyEventType(value: unknown): ComputerSafetyEventType | null {
  switch (value) {
    case "malicious_instruction_suspected":
    case "sensitive_surface":
    case "scope_escape_attempt":
    case "auth_context_detected":
    case "prod_terminal_detected":
    case "payment_or_credentials_surface":
    case "untrusted_external_content":
      return value;
    default:
      return null;
  }
}

function readPermissionState(value: unknown): ComputerPermissionState | null {
  if (!isRecord(value)) {
    return null;
  }
  const accessibility = readBoolean(value.accessibility);
  const screenRecording = readBoolean(value.screenRecording);
  if (accessibility === null || screenRecording === null) {
    return null;
  }
  return { accessibility, screenRecording };
}

function readRuntimeState(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  const connectionState = readRuntimeConnectionState(value.connectionState);
  const launchCount = readNumber(value.launchCount);
  if (!connectionState || launchCount === null) {
    return null;
  }
  const activeSession = isRecord(value.activeSession)
    ? (() => {
        const sessionKey = readString(value.activeSession.sessionKey);
        const state = readRuntimeSessionState(value.activeSession.state);
        const updatedAt = readNumber(value.activeSession.updatedAt);
        if (!sessionKey || !state || updatedAt === null) {
          return null;
        }
        return { sessionKey, state, updatedAt };
      })()
    : null;
  const lastError = isRecord(value.lastError)
    ? (() => {
        const code = readRuntimeErrorCode(value.lastError.code);
        const message = readString(value.lastError.message);
        const retryable = readBoolean(value.lastError.retryable);
        if (!code || !message || retryable === null) {
          return null;
        }
        return {
          code,
          message,
          retryable,
          ...(readString(value.lastError.permission)
            ? { permission: readString(value.lastError.permission)! }
            : {}),
        };
      })()
    : null;
  return {
    connectionState,
    launchCount,
    ...(readNumber(value.helperProtocolVersion) !== null
      ? { helperProtocolVersion: readNumber(value.helperProtocolVersion)! }
      : {}),
    ...(readString(value.helperVersion) ? { helperVersion: readString(value.helperVersion)! } : {}),
    ...(readNumber(value.helperProcessId) !== null
      ? { helperProcessId: readNumber(value.helperProcessId)! }
      : {}),
    ...(activeSession ? { activeSession } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

function readFrame(value: unknown): ComputerFrame | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const dataUrl = readString(value.dataUrl);
  const mimeType = readString(value.mimeType);
  const width = readNumber(value.width);
  const height = readNumber(value.height);
  const pixelWidth = readNumber(value.pixelWidth);
  const pixelHeight = readNumber(value.pixelHeight);
  const logicalWidth = readNumber(value.logicalWidth);
  const logicalHeight = readNumber(value.logicalHeight);
  const scaleFactor = readNumber(value.scaleFactor);
  const orientation = value.orientation === "landscape" || value.orientation === "portrait"
    ? value.orientation
    : null;
  const sourceSpace =
    value.sourceSpace === "display-pixel" || value.sourceSpace === "rendered-pane"
      ? value.sourceSpace
      : null;
  const capturedAt = readNumber(value.capturedAt);
  const maxAgeMs = readNumber(value.maxAgeMs);
  const staleAt = readNumber(value.staleAt);
  if (
    !id ||
    !dataUrl ||
    !mimeType ||
    width === null ||
    height === null ||
    pixelWidth === null ||
    pixelHeight === null ||
    logicalWidth === null ||
    logicalHeight === null ||
    scaleFactor === null ||
    !orientation ||
    !sourceSpace ||
    capturedAt === null ||
    maxAgeMs === null ||
    staleAt === null
  ) {
    return null;
  }
  const cursor = isRecord(value.cursor)
    ? (() => {
        const x = readNumber(value.cursor.x);
        const y = readNumber(value.cursor.y);
        const visible = readBoolean(value.cursor.visible);
        if (x === null || y === null || visible === null) {
          return null;
        }
        return { x, y, visible };
      })()
    : null;
  return {
    id,
    dataUrl,
    mimeType,
    width,
    height,
    pixelWidth,
    pixelHeight,
    logicalWidth,
    logicalHeight,
    scaleFactor,
    orientation,
    ...(readString(value.displayId) ? { displayId: readString(value.displayId)! } : {}),
    sourceSpace,
    capturedAt,
    maxAgeMs,
    staleAt,
    ...(cursor ? { cursor } : {}),
  };
}

function readObservationContext(value: unknown): ComputerObservationContext | null {
  if (!isRecord(value) || !isRecord(value.display)) {
    return null;
  }
  const width = readNumber(value.display.width);
  const height = readNumber(value.display.height);
  const scale = readNumber(value.display.scale);
  const logicalWidth = readNumber(value.display.logicalWidth);
  const logicalHeight = readNumber(value.display.logicalHeight);
  const pixelWidth = readNumber(value.display.pixelWidth);
  const pixelHeight = readNumber(value.display.pixelHeight);
  const orientation =
    value.display.orientation === "landscape" || value.display.orientation === "portrait"
      ? value.display.orientation
      : null;
  const capturedAt = readNumber(value.capturedAt);
  if (
    width === null ||
    height === null ||
    scale === null ||
    logicalWidth === null ||
    logicalHeight === null ||
    pixelWidth === null ||
    pixelHeight === null ||
    !orientation ||
    capturedAt === null
  ) {
    return null;
  }
  const activeApp = isRecord(value.activeApp)
    ? {
        ...(readString(value.activeApp.name) ? { name: readString(value.activeApp.name)! } : {}),
        ...(readString(value.activeApp.bundleId)
          ? { bundleId: readString(value.activeApp.bundleId)! }
          : {}),
        ...(readNumber(value.activeApp.processId) !== null
          ? { processId: readNumber(value.activeApp.processId)! }
          : {}),
      }
    : null;
  const activeWindowTitle = isRecord(value.activeWindow)
    ? readString(value.activeWindow.title)
    : null;
  const activeWindow = isRecord(value.activeWindow)
    ? activeWindowTitle
      ? { title: activeWindowTitle }
      : {}
    : null;
  return {
    display: {
      ...(readString(value.display.id) ? { id: readString(value.display.id)! } : {}),
      width,
      height,
      scale,
      logicalWidth,
      logicalHeight,
      pixelWidth,
      pixelHeight,
      orientation,
    },
    ...(activeApp ? { activeApp } : {}),
    ...(activeWindow ? { activeWindow } : {}),
    ...(readString(value.errorState) ? { errorState: readString(value.errorState) } : {}),
    capturedAt,
  };
}

function readSafetyEvent(value: unknown): ComputerSafetyEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const at = readNumber(value.at);
  const type = readSafetyEventType(value.type);
  const reasonCode = readPolicyReasonCode(value.reasonCode);
  const summary = readString(value.summary);
  const heuristic = readBoolean(value.heuristic);
  if (!id || at === null || !type || !reasonCode || !summary || heuristic === null) {
    return null;
  }
  const actionType = readActionType(value.actionType) ?? undefined;
  return {
    id,
    at,
    type,
    reasonCode,
    summary,
    heuristic,
    ...(actionType ? { actionType } : {}),
    ...(readString(value.appName) ? { appName: readString(value.appName)! } : {}),
    ...(readString(value.appBundleId) ? { appBundleId: readString(value.appBundleId)! } : {}),
    ...(readString(value.windowTitle) ? { windowTitle: readString(value.windowTitle)! } : {}),
    ...(readString(value.host) ? { host: readString(value.host)! } : {}),
    ...(readString(value.path) ? { path: readString(value.path)! } : {}),
  };
}

function readPolicyScope(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  return {
    apps: Array.isArray(value.apps)
      ? value.apps
          .map((entry) => readString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    paths: Array.isArray(value.paths)
      ? value.paths
          .map((entry) => readString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    hosts: Array.isArray(value.hosts)
      ? value.hosts
          .map((entry) => readString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    actions: Array.isArray(value.actions)
      ? value.actions
          .map((entry) => readActionType(entry))
          .filter((entry): entry is ComputerActionType => Boolean(entry))
      : [],
    surfaces: Array.isArray(value.surfaces)
      ? value.surfaces
          .map((entry) => readString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
  };
}

function readPolicyState(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  const allow = readPolicyScope(value.allow);
  const deny = readPolicyScope(value.deny);
  const sensitive = readPolicyScope(value.sensitive);
  const commandLikeActions = Array.isArray(value.commandLikeActions)
    ? value.commandLikeActions
        .map((entry) => readActionType(entry))
        .filter((entry): entry is ComputerActionType => Boolean(entry))
    : null;
  if (!allow || !deny || !sensitive || !commandLikeActions) {
    return null;
  }
  const lastDecision = isRecord(value.lastDecision)
    ? (() => {
        const at = readNumber(value.lastDecision.at);
        const actionType = readActionType(value.lastDecision.actionType);
        const decision = readPolicyDecision(value.lastDecision.decision);
        const reasonCode = readPolicyReasonCode(value.lastDecision.reasonCode);
        const reason = readString(value.lastDecision.reason);
        if (at === null || !actionType || !decision || !reasonCode || !reason) {
          return null;
        }
        return {
          at,
          actionType,
          decision,
          reasonCode,
          reason,
          ...(readString(value.lastDecision.appIdentity)
            ? { appIdentity: readString(value.lastDecision.appIdentity)! }
            : {}),
        };
      })()
    : null;
  return {
    allow,
    deny,
    sensitive,
    commandLikeActions,
    ...(lastDecision ? { lastDecision } : {}),
  };
}

function readSafetyState(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  const level =
    value.level === "normal" || value.level === "elevated" || value.level === "watch"
      ? value.level
      : null;
  if (!level) {
    return null;
  }
  const recentEvents = Array.isArray(value.recentEvents)
    ? value.recentEvents
        .map((entry) => readSafetyEvent(entry))
        .filter((entry): entry is ComputerSafetyEvent => Boolean(entry))
    : [];
  const lastEvent = readSafetyEvent(value.lastEvent);
  return {
    level,
    ...(lastEvent ? { lastEvent } : {}),
    recentEvents,
  };
}

function readTimelineEntry(value: unknown): ComputerTimelineEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const at = readNumber(value.at);
  const kind =
    value.kind === "status" ||
    value.kind === "observation" ||
    value.kind === "action" ||
    value.kind === "approval" ||
    value.kind === "error" ||
    value.kind === "safety"
      ? value.kind
      : null;
  const summary = readString(value.summary);
  if (!id || at === null || !kind || !summary) {
    return null;
  }
  const status = readSessionStatus(value.status) ?? undefined;
  const eventCode = readTimelineEventCode(value.eventCode) ?? undefined;
  const actionType = readActionType(value.actionType) ?? undefined;
  const stepSequence = readNumber(value.stepSequence) ?? undefined;
  const toolCallId = readString(value.toolCallId) ?? undefined;
  const runId = readString(value.runId);
  const responseId = readString(value.responseId);
  const stepId = readString(value.stepId) ?? undefined;
  const stepPhase = readStepPhase(value.stepPhase) ?? undefined;
  const actionId = readString(value.actionId) ?? undefined;
  const actionResultId = readString(value.actionResultId) ?? undefined;
  const nativeActionId = readString(value.nativeActionId) ?? undefined;
  const sourceFrameId = readString(value.sourceFrameId) ?? undefined;
  const resultFrameId = readString(value.resultFrameId) ?? undefined;
  const success = readBoolean(value.success) ?? undefined;
  const elapsedMs = readNumber(value.elapsedMs) ?? undefined;
  const retryCount = readNumber(value.retryCount) ?? undefined;
  const policyDecision = readPolicyDecision(value.policyDecision) ?? undefined;
  const reasonCode = readPolicyReasonCode(value.reasonCode) ?? undefined;
  const safetyEventType = readSafetyEventType(value.safetyEventType) ?? undefined;
  const heuristic = readBoolean(value.heuristic) ?? undefined;
  const failureCategory =
    value.failureCategory === "validation" ||
    value.failureCategory === "stale-frame" ||
    value.failureCategory === "invalid-target" ||
    value.failureCategory === "permission-missing" ||
    value.failureCategory === "cancelled" ||
    value.failureCategory === "execution-failed" ||
    value.failureCategory === "action-rejected"
      ? value.failureCategory
      : undefined;
  return {
    id,
    at,
    kind,
    summary,
    ...(eventCode ? { eventCode } : {}),
    ...(status ? { status } : {}),
    ...(actionType ? { actionType } : {}),
    ...(stepId ? { stepId } : {}),
    ...(stepSequence !== undefined ? { stepSequence } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(runId !== null ? { runId } : {}),
    ...(responseId !== null ? { responseId } : {}),
    ...(stepPhase ? { stepPhase } : {}),
    ...(actionId ? { actionId } : {}),
    ...(actionResultId ? { actionResultId } : {}),
    ...(nativeActionId ? { nativeActionId } : {}),
    ...(sourceFrameId ? { sourceFrameId } : {}),
    ...(resultFrameId ? { resultFrameId } : {}),
    ...(success !== undefined ? { success } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    ...(retryCount !== undefined ? { retryCount } : {}),
    ...(failureCategory ? { failureCategory } : {}),
    ...(policyDecision ? { policyDecision } : {}),
    ...(reasonCode ? { reasonCode } : {}),
    ...(safetyEventType ? { safetyEventType } : {}),
    ...(heuristic !== undefined ? { heuristic } : {}),
  };
}

function readReplayFrameMetadata(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  const frameHash = readString(value.frameHash);
  const sizeBytes = readNumber(value.sizeBytes);
  const captureLatencyMs = readNumber(value.captureLatencyMs);
  const stale = readBoolean(value.stale);
  const stalenessMs = readNumber(value.stalenessMs);
  const display = readObservationContext({ display: value.display, capturedAt: 0 })?.display ?? null;
  const transform =
    (value.transform &&
    isRecord(value.transform) &&
    (value.transform.sourceSpace === "display-pixel" || value.transform.sourceSpace === "rendered-pane") &&
    readNumber(value.transform.sourceWidth) !== null &&
    readNumber(value.transform.sourceHeight) !== null)
      ? {
          sourceSpace: value.transform.sourceSpace,
          sourceWidth: readNumber(value.transform.sourceWidth)!,
          sourceHeight: readNumber(value.transform.sourceHeight)!,
          ...(readNumber(value.transform.renderedWidth) !== null
            ? { renderedWidth: readNumber(value.transform.renderedWidth)! }
            : {}),
          ...(readNumber(value.transform.renderedHeight) !== null
            ? { renderedHeight: readNumber(value.transform.renderedHeight)! }
            : {}),
          ...(readNumber(value.transform.downscaleFactorX) !== null
            ? { downscaleFactorX: readNumber(value.transform.downscaleFactorX)! }
            : {}),
          ...(readNumber(value.transform.downscaleFactorY) !== null
            ? { downscaleFactorY: readNumber(value.transform.downscaleFactorY)! }
            : {}),
        }
      : null;
  if (
    !frameHash ||
    sizeBytes === null ||
    captureLatencyMs === null ||
    stale === null ||
    stalenessMs === null ||
    !display ||
    !transform
  ) {
    return null;
  }
  const activeApp = isRecord(value.activeApp)
    ? {
        ...(readString(value.activeApp.name) ? { name: readString(value.activeApp.name)! } : {}),
        ...(readString(value.activeApp.bundleId)
          ? { bundleId: readString(value.activeApp.bundleId)! }
          : {}),
        ...(readNumber(value.activeApp.processId) !== null
          ? { processId: readNumber(value.activeApp.processId)! }
          : {}),
      }
    : null;
  const activeWindow = isRecord(value.activeWindow) && readString(value.activeWindow.title)
    ? { title: readString(value.activeWindow.title)! }
    : null;
  return {
    frameHash,
    sizeBytes,
    captureLatencyMs,
    stale,
    stalenessMs,
    transform,
    display,
    ...(activeApp ? { activeApp } : {}),
    ...(activeWindow ? { activeWindow } : {}),
  };
}

function readReplayAction(value: unknown): ComputerReplayAction | null {
  if (!isRecord(value)) {
    return null;
  }
  const type = readActionType(value.type);
  const summary = readString(value.summary);
  if (!type || !summary) {
    return null;
  }
  const coordinateSpace =
    value.coordinateSpace === "display-pixel" || value.coordinateSpace === "rendered-pane"
      ? value.coordinateSpace
      : undefined;
  const readPoint = (candidate: unknown) =>
    isRecord(candidate) &&
    readNumber(candidate.x) !== null &&
    readNumber(candidate.y) !== null
      ? {
          x: readNumber(candidate.x)!,
          y: readNumber(candidate.y)!,
        }
      : undefined;
  return {
    type,
    summary,
    ...(readString(value.actionId) ? { actionId: readString(value.actionId)! } : {}),
    ...(coordinateSpace ? { coordinateSpace } : {}),
    ...(readNumber(value.referenceWidth) !== null
      ? { referenceWidth: readNumber(value.referenceWidth)! }
      : {}),
    ...(readNumber(value.referenceHeight) !== null
      ? { referenceHeight: readNumber(value.referenceHeight)! }
      : {}),
    ...(readPoint(value.target) ? { target: readPoint(value.target)! } : {}),
    ...(readPoint(value.destination) ? { destination: readPoint(value.destination)! } : {}),
    ...(readPoint(value.scrollDelta) ? { scrollDelta: readPoint(value.scrollDelta)! } : {}),
    ...(readString(value.textPreview) ? { textPreview: readString(value.textPreview)! } : {}),
    ...(readString(value.keyCombo) ? { keyCombo: readString(value.keyCombo)! } : {}),
    ...(readString(value.app) ? { app: readString(value.app)! } : {}),
    ...(readString(value.url) ? { url: readString(value.url)! } : {}),
    ...(readString(value.path) ? { path: readString(value.path)! } : {}),
    ...(readNumber(value.delayMs) !== null ? { delayMs: readNumber(value.delayMs)! } : {}),
  };
}

function readReplayFrame(value: unknown): ComputerReplayFrame | null {
  if (!isRecord(value)) {
    return null;
  }
  const frameId = readString(value.frameId);
  const capturedAt = readNumber(value.capturedAt);
  const frame = isRecord(value.observation) ? readFrame(value.observation.frame) : null;
  const context = isRecord(value.observation) ? readObservationContext(value.observation.context) : null;
  const metadata = readReplayFrameMetadata(value.metadata);
  if (!frameId || capturedAt === null || !frame || !context) {
    return null;
  }
  const stepSequence = readNumber(value.stepSequence) ?? undefined;
  const stepPhase = readStepPhase(value.stepPhase) ?? undefined;
  return {
    frameId,
    capturedAt,
    observation: {
      frame,
      context,
    },
    ...(metadata
      ? { metadata }
      : {
          metadata: {
            frameHash: frame.id,
            sizeBytes: 0,
            captureLatencyMs: Math.max(0, Date.now() - capturedAt),
            stale: Date.now() > frame.staleAt,
            stalenessMs: Math.max(0, Date.now() - capturedAt),
            transform: {
              sourceSpace: frame.sourceSpace,
              sourceWidth: frame.pixelWidth,
              sourceHeight: frame.pixelHeight,
            },
            display: { ...context.display },
            ...(context.activeApp ? { activeApp: { ...context.activeApp } } : {}),
            ...(context.activeWindow ? { activeWindow: { ...context.activeWindow } } : {}),
          },
        }),
    ...(readString(value.stepId) ? { stepId: readString(value.stepId)! } : {}),
    ...(stepSequence !== undefined ? { stepSequence } : {}),
    ...(stepPhase ? { stepPhase } : {}),
  };
}

function readReplayStep(value: unknown): ComputerReplayStep | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const sequence = readNumber(value.sequence);
  const toolCallId = readString(value.toolCallId);
  const runId = readString(value.runId);
  const responseId = readString(value.responseId);
  const kind = value.kind === "observe" || value.kind === "action" ? value.kind : null;
  const phase = readStepPhase(value.phase);
  const status = readStepStatus(value.status);
  const summary = readString(value.summary);
  const startedAt = readNumber(value.startedAt);
  const updatedAt = readNumber(value.updatedAt);
  if (
    !id ||
    sequence === null ||
    !toolCallId ||
    !kind ||
    !phase ||
    !status ||
    !summary ||
    startedAt === null ||
    updatedAt === null
  ) {
    return null;
  }
  return {
    id,
    sequence,
    toolCallId,
    ...(runId !== null ? { runId } : {}),
    ...(responseId !== null ? { responseId } : {}),
    kind,
    phase,
    status,
    summary,
    ...(readActionType(value.actionType) ? { actionType: readActionType(value.actionType)! } : {}),
    ...(readString(value.sourceFrameId) ? { sourceFrameId: readString(value.sourceFrameId)! } : {}),
    ...(readString(value.resultFrameId) ? { resultFrameId: readString(value.resultFrameId)! } : {}),
    startedAt,
    updatedAt,
    ...(readNumber(value.totalElapsedMs) !== null
      ? { totalElapsedMs: readNumber(value.totalElapsedMs)! }
      : {}),
    ...(readNumber(value.lastActionElapsedMs) !== null
      ? { lastActionElapsedMs: readNumber(value.lastActionElapsedMs)! }
      : {}),
    actionCount: readNumber(value.actionCount) ?? 0,
    approvalCount: readNumber(value.approvalCount) ?? 0,
    safetyEventsCount: readNumber(value.safetyEventsCount) ?? 0,
    ...(readReplayAction(value.action) ? { action: readReplayAction(value.action)! } : {}),
  };
}

function readReplayState(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }
  const frames = Array.isArray(value.frames)
    ? value.frames
        .map((entry) => readReplayFrame(entry))
        .filter((entry): entry is ComputerReplayFrame => Boolean(entry))
    : [];
  const steps = Array.isArray(value.steps)
    ? value.steps
        .map((entry) => readReplayStep(entry))
        .filter((entry): entry is ComputerReplayStep => Boolean(entry))
    : [];
  const actionCount = readNumber(value.actionCount);
  const safetyEventsCount = readNumber(value.safetyEventsCount);
  if (actionCount === null || safetyEventsCount === null) {
    return null;
  }
  return {
    frames,
    steps,
    actionCount,
    safetyEventsCount,
  };
}

function readSessionLogEvent(value: unknown): ComputerSessionLogEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const ordinal = readNumber(value.ordinal);
  const at = readNumber(value.at);
  const code = readSessionLogEventCode(value.code);
  const summary = readString(value.summary);
  const sessionId = readString(value.sessionId);
  if (!id || ordinal === null || at === null || !code || !summary || !sessionId) {
    return null;
  }
  const status = readSessionStatus(value.status) ?? undefined;
  const actionType = readActionType(value.actionType) ?? undefined;
  const policyDecision = readPolicyDecision(value.policyDecision) ?? undefined;
  const reasonCode = readPolicyReasonCode(value.reasonCode) ?? undefined;
  const safetyEventType = readSafetyEventType(value.safetyEventType) ?? undefined;
  const failureCategory =
    value.failureCategory === "validation" ||
    value.failureCategory === "stale-frame" ||
    value.failureCategory === "invalid-target" ||
    value.failureCategory === "permission-missing" ||
    value.failureCategory === "cancelled" ||
    value.failureCategory === "execution-failed" ||
    value.failureCategory === "action-rejected"
      ? value.failureCategory
      : undefined;
  const success = readBoolean(value.success);
  const heuristic = readBoolean(value.heuristic);
  return {
    id,
    ordinal,
    at,
    code,
    summary,
    sessionId,
    ...(readString(value.runId) !== null ? { runId: readString(value.runId) } : {}),
    ...(readString(value.responseId) !== null ? { responseId: readString(value.responseId) } : {}),
    ...(readString(value.toolCallId) ? { toolCallId: readString(value.toolCallId)! } : {}),
    ...(readString(value.stepId) ? { stepId: readString(value.stepId)! } : {}),
    ...(readNumber(value.stepSequence) !== null
      ? { stepSequence: readNumber(value.stepSequence)! }
      : {}),
    ...(readStepPhase(value.stepPhase) ? { stepPhase: readStepPhase(value.stepPhase)! } : {}),
    ...(status ? { status } : {}),
    ...(actionType ? { actionType } : {}),
    ...(readString(value.actionId) ? { actionId: readString(value.actionId)! } : {}),
    ...(readString(value.nativeActionId)
      ? { nativeActionId: readString(value.nativeActionId)! }
      : {}),
    ...(readString(value.sourceFrameId)
      ? { sourceFrameId: readString(value.sourceFrameId)! }
      : {}),
    ...(readString(value.resultFrameId)
      ? { resultFrameId: readString(value.resultFrameId)! }
      : {}),
    ...(policyDecision ? { policyDecision } : {}),
    ...(reasonCode ? { reasonCode } : {}),
    ...(safetyEventType ? { safetyEventType } : {}),
    ...(success !== null ? { success } : {}),
    ...(readNumber(value.elapsedMs) !== null ? { elapsedMs: readNumber(value.elapsedMs)! } : {}),
    ...(readNumber(value.retryCount) !== null ? { retryCount: readNumber(value.retryCount)! } : {}),
    ...(failureCategory ? { failureCategory } : {}),
    ...(heuristic !== null ? { heuristic } : {}),
  };
}

function readBufferState(value: unknown): ComputerSessionBufferState | null {
  if (!isRecord(value)) {
    return null;
  }
  const eventLimit = readNumber(value.eventLimit);
  const replayFrameLimit = readNumber(value.replayFrameLimit);
  const replayStepLimit = readNumber(value.replayStepLimit);
  const timelineLimit = readNumber(value.timelineLimit);
  const eventLogTruncated = readBoolean(value.eventLogTruncated);
  const replayFramesTruncated = readBoolean(value.replayFramesTruncated);
  const replayStepsTruncated = readBoolean(value.replayStepsTruncated);
  const timelineTruncated = readBoolean(value.timelineTruncated);
  if (
    eventLimit === null ||
    replayFrameLimit === null ||
    replayStepLimit === null ||
    timelineLimit === null ||
    eventLogTruncated === null ||
    replayFramesTruncated === null ||
    replayStepsTruncated === null ||
    timelineTruncated === null
  ) {
    return null;
  }
  return {
    eventLimit,
    replayFrameLimit,
    replayStepLimit,
    timelineLimit,
    eventLogTruncated,
    replayFramesTruncated,
    replayStepsTruncated,
    timelineTruncated,
  };
}

function readSessionExportFrame(value: unknown): ComputerSessionExportFrame | null {
  if (!isRecord(value)) {
    return null;
  }
  const frameId = readString(value.frameId);
  const frameHash = readString(value.frameHash);
  const capturedAt = readNumber(value.capturedAt);
  const sourceSpace =
    value.sourceSpace === "display-pixel" || value.sourceSpace === "rendered-pane"
      ? value.sourceSpace
      : null;
  const width = readNumber(value.width);
  const height = readNumber(value.height);
  const pixelWidth = readNumber(value.pixelWidth);
  const pixelHeight = readNumber(value.pixelHeight);
  const logicalWidth = readNumber(value.logicalWidth);
  const logicalHeight = readNumber(value.logicalHeight);
  const scaleFactor = readNumber(value.scaleFactor);
  const orientation =
    value.orientation === "landscape" || value.orientation === "portrait"
      ? value.orientation
      : null;
  const maxAgeMs = readNumber(value.maxAgeMs);
  const captureLatencyMs = readNumber(value.captureLatencyMs);
  const stale = readBoolean(value.stale);
  const stalenessMs = readNumber(value.stalenessMs);
  const sizeBytes = readNumber(value.sizeBytes);
  const redacted = readBoolean(value.redacted);
  const display = readObservationContext({ display: value.display, capturedAt: 0 })?.display ?? null;
  if (
    !frameId ||
    !frameHash ||
    capturedAt === null ||
    !sourceSpace ||
    width === null ||
    height === null ||
    pixelWidth === null ||
    pixelHeight === null ||
    logicalWidth === null ||
    logicalHeight === null ||
    scaleFactor === null ||
    !orientation ||
    maxAgeMs === null ||
    captureLatencyMs === null ||
    stale === null ||
    stalenessMs === null ||
    sizeBytes === null ||
    redacted === null ||
    !display
  ) {
    return null;
  }
  return {
    frameId,
    frameHash,
    capturedAt,
    ...(readString(value.stepId) ? { stepId: readString(value.stepId)! } : {}),
    ...(readNumber(value.stepSequence) !== null
      ? { stepSequence: readNumber(value.stepSequence)! }
      : {}),
    ...(readStepPhase(value.stepPhase) ? { stepPhase: readStepPhase(value.stepPhase)! } : {}),
    ...(readString(value.displayId) ? { displayId: readString(value.displayId)! } : {}),
    sourceSpace,
    width,
    height,
    pixelWidth,
    pixelHeight,
    logicalWidth,
    logicalHeight,
    scaleFactor,
    orientation,
    maxAgeMs,
    captureLatencyMs,
    stale,
    stalenessMs,
    sizeBytes,
    display,
    ...(isRecord(value.activeApp)
      ? {
          activeApp: {
            ...(readString(value.activeApp.name)
              ? { name: readString(value.activeApp.name)! }
              : {}),
            ...(readString(value.activeApp.bundleId)
              ? { bundleId: readString(value.activeApp.bundleId)! }
              : {}),
            ...(readNumber(value.activeApp.processId) !== null
              ? { processId: readNumber(value.activeApp.processId)! }
              : {}),
          },
        }
      : {}),
    ...(isRecord(value.activeWindow) && readString(value.activeWindow.title)
      ? { activeWindow: { title: readString(value.activeWindow.title)! } }
      : {}),
    redacted,
  };
}

function readComputerSessionExport(value: unknown): ComputerSessionExport | null {
  if (!isRecord(value)) {
    return null;
  }
  const exportedAt = readNumber(value.exportedAt);
  const sessionKey = readString(value.sessionKey);
  const buffers = readBufferState(value.buffers);
  const summaryRecord = isRecord(value.summary) ? value.summary : null;
  if (!summaryRecord || exportedAt === null || !sessionKey || !buffers) {
    return null;
  }
  const backend =
    summaryRecord.backend === "local-mac" ||
    summaryRecord.backend === "remote-node" ||
    summaryRecord.backend === "ssh-mac"
      ? summaryRecord.backend
      : null;
  const status = readSessionStatus(summaryRecord.status);
  const mode = readApprovalMode(summaryRecord.mode);
  const startedAt = readNumber(summaryRecord.startedAt);
  const updatedAt = readNumber(summaryRecord.updatedAt);
  const target = readSessionTarget(summaryRecord.target);
  const permissions = readPermissionState(summaryRecord.permissions);
  const capabilities = Array.isArray(summaryRecord.capabilities)
    ? summaryRecord.capabilities
        .map((entry) => readCapabilityDescriptor(entry))
        .filter((entry): entry is ComputerCapabilityDescriptor => Boolean(entry))
    : [];
  const replay = isRecord(value.replay) ? value.replay : null;
  if (
    !backend ||
    !status ||
    !mode ||
    startedAt === null ||
    updatedAt === null ||
    !target ||
    !permissions ||
    !replay
  ) {
    return null;
  }
  return {
    exportedAt,
    sessionKey,
    summary: {
      backend,
      status,
      mode,
      startedAt,
      updatedAt,
      target,
      permissions,
      capabilities,
      actionCount: readNumber(summaryRecord.actionCount) ?? 0,
      safetyEventsCount: readNumber(summaryRecord.safetyEventsCount) ?? 0,
      approvalCount: readNumber(summaryRecord.approvalCount) ?? 0,
      eventCount: readNumber(summaryRecord.eventCount) ?? 0,
      ...(readString(summaryRecord.lastError) !== null
        ? { lastError: readString(summaryRecord.lastError) }
        : {}),
      ...(isRecord(summaryRecord.activeApp)
        ? {
            activeApp: {
              ...(readString(summaryRecord.activeApp.name)
                ? { name: readString(summaryRecord.activeApp.name)! }
                : {}),
              ...(readString(summaryRecord.activeApp.bundleId)
                ? { bundleId: readString(summaryRecord.activeApp.bundleId)! }
                : {}),
              ...(readNumber(summaryRecord.activeApp.processId) !== null
                ? { processId: readNumber(summaryRecord.activeApp.processId)! }
                : {}),
            },
          }
        : {}),
      ...(isRecord(summaryRecord.activeWindow) && readString(summaryRecord.activeWindow.title)
        ? { activeWindow: { title: readString(summaryRecord.activeWindow.title)! } }
        : {}),
      ...(readObservationContext({ display: summaryRecord.display, capturedAt: 0 })?.display
        ? { display: readObservationContext({ display: summaryRecord.display, capturedAt: 0 })!.display }
        : {}),
      replayPartial: readBoolean(summaryRecord.replayPartial) === true,
      correlationCoverage: isRecord(summaryRecord.correlationCoverage)
        ? {
            hasRunId: readBoolean(summaryRecord.correlationCoverage.hasRunId) === true,
            hasResponseId: readBoolean(summaryRecord.correlationCoverage.hasResponseId) === true,
            hasToolCallId: readBoolean(summaryRecord.correlationCoverage.hasToolCallId) === true,
            hasStepId: readBoolean(summaryRecord.correlationCoverage.hasStepId) === true,
            hasActionId: readBoolean(summaryRecord.correlationCoverage.hasActionId) === true,
            hasNativeActionId: readBoolean(summaryRecord.correlationCoverage.hasNativeActionId) === true,
          }
        : {
            hasRunId: false,
            hasResponseId: false,
            hasToolCallId: false,
            hasStepId: false,
            hasActionId: false,
            hasNativeActionId: false,
          },
    },
    buffers,
    eventLog: Array.isArray(value.eventLog)
      ? value.eventLog
          .map((entry) => readSessionLogEvent(entry))
          .filter((entry): entry is ComputerSessionLogEvent => Boolean(entry))
      : [],
    lastErrors: Array.isArray(value.lastErrors)
      ? value.lastErrors
          .map((entry) => readSessionLogEvent(entry))
          .filter((entry): entry is ComputerSessionLogEvent => Boolean(entry))
      : [],
    approvalHistory: Array.isArray(value.approvalHistory)
      ? value.approvalHistory
          .map((entry) => readSessionLogEvent(entry))
          .filter((entry): entry is ComputerSessionLogEvent => Boolean(entry))
      : [],
    safetyHistory: Array.isArray(value.safetyHistory)
      ? value.safetyHistory
          .map((entry) => readSafetyEvent(entry))
          .filter((entry): entry is ComputerSafetyEvent => Boolean(entry))
      : [],
    timeline: Array.isArray(value.timeline)
      ? value.timeline
          .map((entry) => readTimelineEntry(entry))
          .filter((entry): entry is ComputerTimelineEntry => Boolean(entry))
      : [],
    replay: {
      partial: readBoolean(replay.partial) === true,
      steps: Array.isArray(replay.steps)
        ? replay.steps
            .map((entry) => readReplayStep(entry))
            .filter((entry): entry is ComputerReplayStep => Boolean(entry))
        : [],
      frames: Array.isArray(replay.frames)
        ? replay.frames
            .map((entry) => readSessionExportFrame(entry))
            .filter((entry): entry is ComputerSessionExportFrame => Boolean(entry))
        : [],
    },
  };
}

function readSessionStep(value: unknown): ComputerSessionStep | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const sequence = readNumber(value.sequence);
  const toolCallId = readString(value.toolCallId);
  const runId = readString(value.runId);
  const responseId = readString(value.responseId);
  const kind = value.kind === "observe" || value.kind === "action" ? value.kind : null;
  const phase = readStepPhase(value.phase);
  const status = readStepStatus(value.status);
  const summary = readString(value.summary);
  const startedAt = readNumber(value.startedAt);
  const updatedAt = readNumber(value.updatedAt);
  const actionType = readActionType(value.actionType) ?? undefined;
  const sourceFrameId = readString(value.sourceFrameId) ?? undefined;
  const resultFrameId = readString(value.resultFrameId) ?? undefined;
  if (
    !id ||
    sequence === null ||
    !toolCallId ||
    !kind ||
    !phase ||
    !status ||
    !summary ||
    startedAt === null ||
    updatedAt === null
  ) {
    return null;
  }
  return {
    id,
    sequence,
    toolCallId,
    ...(runId !== null ? { runId } : {}),
    ...(responseId !== null ? { responseId } : {}),
    kind,
    phase,
    status,
    summary,
    ...(actionType ? { actionType } : {}),
    ...(sourceFrameId ? { sourceFrameId } : {}),
    ...(resultFrameId ? { resultFrameId } : {}),
    startedAt,
    updatedAt,
  };
}

function readApprovalRequest(value: unknown): ComputerApprovalRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const createdAt = readNumber(value.createdAt);
  const actionType = readActionType(value.actionType);
  const actionSummary = readString(value.actionSummary);
  const reason = readString(value.reason);
  const reasonCode = readPolicyReasonCode(value.reasonCode);
  const policyDecision = readPolicyDecision(value.policyDecision);
  const sensitive = readBoolean(value.sensitive);
  const safetyEvents = Array.isArray(value.safetyEvents)
    ? value.safetyEvents
        .map((entry) => readSafetyEvent(entry))
        .filter((entry): entry is ComputerSafetyEvent => Boolean(entry))
    : [];
  if (
    !id ||
    createdAt === null ||
    !actionType ||
    !actionSummary ||
    !reason ||
    !reasonCode ||
    (policyDecision !== "require_once" && policyDecision !== "require_session") ||
    sensitive === null
  ) {
    return null;
  }
  return {
    id,
    createdAt,
    actionType,
    actionSummary,
    reason,
    reasonCode,
    policyDecision,
    sensitive,
    safetyEvents,
    ...(readString(value.appName) ? { appName: readString(value.appName)! } : {}),
    ...(readString(value.appBundleId) ? { appBundleId: readString(value.appBundleId)! } : {}),
    ...(readString(value.stepId) ? { stepId: readString(value.stepId)! } : {}),
    ...(readNumber(value.stepSequence) !== null
      ? { stepSequence: readNumber(value.stepSequence)! }
      : {}),
    ...(readString(value.toolCallId) ? { toolCallId: readString(value.toolCallId)! } : {}),
    ...(readString(value.runId) !== null ? { runId: readString(value.runId) } : {}),
    ...(readString(value.responseId) !== null
      ? { responseId: readString(value.responseId) }
      : {}),
  };
}

export function readComputerSessionState(value: unknown): ComputerSessionState | null {
  if (!isRecord(value)) {
    return null;
  }
  const sessionKey = readString(value.sessionKey);
  const backend =
    value.backend === "local-mac" || value.backend === "remote-node" || value.backend === "ssh-mac"
      ? value.backend
      : null;
  const status = readSessionStatus(value.status);
  const mode = readApprovalMode(value.mode);
  const policy = readPolicyState(value.policy) ?? {
    allow: { apps: [], paths: [], hosts: [], actions: [], surfaces: [] },
    deny: { apps: [], paths: [], hosts: [], actions: [], surfaces: [] },
    sensitive: { apps: [], paths: [], hosts: [], actions: [], surfaces: [] },
    commandLikeActions: [],
  };
  const safety = readSafetyState(value.safety) ?? {
    level: "normal" as const,
    recentEvents: [],
  };
  const target = readSessionTarget(value.target);
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities
        .map((entry) => readCapabilityDescriptor(entry))
        .filter((entry): entry is ComputerCapabilityDescriptor => Boolean(entry))
    : [];
  const permissions = readPermissionState(value.permissions);
  const runtime = readRuntimeState(value.runtime);
  const replay = readReplayState(value.replay) ?? {
    frames: [],
    steps: [],
    actionCount: 0,
    safetyEventsCount: 0,
  };
  const eventLog = Array.isArray(value.eventLog)
    ? value.eventLog
        .map((entry) => readSessionLogEvent(entry))
        .filter((entry): entry is ComputerSessionLogEvent => Boolean(entry))
        .sort((left, right) => left.ordinal - right.ordinal || left.at - right.at)
    : [];
  const buffers = readBufferState(value.buffers) ?? {
    eventLimit: 160,
    replayFrameLimit: 24,
    replayStepLimit: 24,
    timelineLimit: 80,
    eventLogTruncated: false,
    replayFramesTruncated: false,
    replayStepsTruncated: false,
    timelineTruncated: false,
  };
  const timeline = Array.isArray(value.timeline)
    ? value.timeline
        .map((entry) => readTimelineEntry(entry))
        .filter((entry): entry is ComputerTimelineEntry => Boolean(entry))
    : null;
  const startedAt = readNumber(value.startedAt);
  const updatedAt = readNumber(value.updatedAt);
  const stepCounter = readNumber(value.stepCounter) ?? 0;
  const activeStep = readSessionStep(value.activeStep);
  const lastCompletedStep = readSessionStep(value.lastCompletedStep);
  const blocking = readBlockingState(value.blocking);
  if (
    !sessionKey ||
    !backend ||
    !status ||
    !mode ||
    !permissions ||
    !timeline ||
    startedAt === null ||
    updatedAt === null
  ) {
    return null;
  }
  return {
    sessionKey,
    backend,
    status,
    mode,
    ...(readString(value.nodeId) ? { nodeId: readString(value.nodeId)! } : {}),
    target:
      target ??
      resolveComputerTarget({
        backend,
        sessionKey,
        nodeId: readString(value.nodeId),
      }),
    capabilities:
      capabilities.length > 0 ? capabilities : resolveComputerCapabilityMatrix(backend),
    approvedApps: Array.isArray(value.approvedApps)
      ? value.approvedApps
          .map((entry) => readString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    policy,
    safety,
    replay,
    ...(blocking ? { blocking } : {}),
    permissions,
    ...(runtime ? { runtime } : {}),
    ...(readObservationContext(value.context)
      ? { context: readObservationContext(value.context)! }
      : {}),
    ...(readFrame(value.frame) ? { frame: readFrame(value.frame)! } : {}),
    stepCounter,
    ...(activeStep ? { activeStep } : {}),
    ...(lastCompletedStep ? { lastCompletedStep } : {}),
    timeline,
    eventLog,
    buffers,
    ...(readApprovalRequest(value.awaitingApproval)
      ? { awaitingApproval: readApprovalRequest(value.awaitingApproval)! }
      : {}),
    ...(readString(value.lastError) ? { lastError: readString(value.lastError)! } : {}),
    startedAt,
    updatedAt,
  };
}

function readToolResultDetails(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  return isRecord(value.details) ? value.details : undefined;
}

export function readComputerSessionEvent(value: unknown): ComputerSessionEvent | null {
  if (!isRecord(value) || value.stream !== "tool") {
    return null;
  }
  const sessionKey = readString(value.sessionKey);
  if (!sessionKey || !isRecord(value.data)) {
    return null;
  }
  const toolName = readString(value.data.name)?.toLowerCase();
  if (toolName !== "computer") {
    return null;
  }
  const details =
    readToolResultDetails(value.data.partialResult) ??
    readToolResultDetails(value.data.result) ??
    (isRecord(value.data.details) ? value.data.details : undefined);
  if (!isRecord(details) || !("computerSession" in details)) {
    return null;
  }
  const session = readComputerSessionState(details.computerSession);
  if (!session) {
    return null;
  }
  return { sessionKey, session };
}

function isUnavailableComputerSessionError(error: unknown): boolean {
  if (error instanceof GatewayRequestError) {
    return error.gatewayCode === "METHOD_NOT_FOUND";
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "number" || typeof error === "boolean" || typeof error === "bigint"
          ? `${error}`
          : "";
  return /unknown method/i.test(message);
}

function normalizeSessionKey(sessionKey: string | null | undefined): string {
  const trimmed = sessionKey?.trim();
  return trimmed || "main";
}

function applyLoadedComputerSession(
  host: ComputerSessionHost,
  sessionKey: string,
  session: ComputerSessionState | null,
) {
  host.setComputerSession(sessionKey, session);
  if (normalizeSessionKey(host.sessionKey) === sessionKey) {
    host.computerSessionError = null;
  }
}

export async function loadComputerSession(
  host: ComputerSessionHost,
  opts?: { sessionKey?: string; quiet?: boolean },
): Promise<ComputerSessionState | null> {
  const sessionKey = normalizeSessionKey(opts?.sessionKey ?? host.sessionKey);
  if (!host.client || !host.connected) {
    host.computerSessionLoading = false;
    return null;
  }
  if (!opts?.quiet) {
    host.computerSessionLoading = true;
  }
  try {
    const response = await host.client.request<{ session?: unknown }>("computer.session.get", {
      sessionKey,
    });
    const session = readComputerSessionState(response?.session);
    applyLoadedComputerSession(host, sessionKey, session);
    return session;
  } catch (error) {
    if (isUnavailableComputerSessionError(error)) {
      applyLoadedComputerSession(host, sessionKey, null);
      return null;
    }
    host.computerSessionError = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    host.computerSessionLoading = false;
  }
}

export async function updateComputerSession(
  host: ComputerSessionHost,
  params: {
    sessionKey?: string;
    command?: ComputerSessionCommand;
    mode?: ComputerApprovalMode;
    permissions?: Partial<ComputerPermissionState>;
  },
): Promise<ComputerSessionState | null> {
  const sessionKey = normalizeSessionKey(params.sessionKey ?? host.sessionKey);
  if (!host.client || !host.connected) {
    host.computerSessionError = "Gateway not connected";
    return null;
  }
  host.computerSessionLoading = true;
  try {
    const response = await host.client.request<{ session?: unknown }>("computer.session.update", {
      sessionKey,
      ...(params.command ? { command: params.command } : {}),
      ...(params.mode ? { mode: params.mode } : {}),
      ...(params.permissions ? { permissions: params.permissions } : {}),
    });
    const session = readComputerSessionState(response?.session);
    applyLoadedComputerSession(host, sessionKey, session);
    return session;
  } catch (error) {
    host.computerSessionError = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    host.computerSessionLoading = false;
  }
}

export async function approveComputerSession(
  host: ComputerSessionHost,
  params: {
    sessionKey?: string;
    requestId: string;
    decision: ComputerApprovalDecision;
  },
): Promise<ComputerSessionState | null> {
  const sessionKey = normalizeSessionKey(params.sessionKey ?? host.sessionKey);
  if (!host.client || !host.connected) {
    host.computerSessionError = "Gateway not connected";
    return null;
  }
  host.computerSessionLoading = true;
  try {
    const response = await host.client.request<{ session?: unknown }>("computer.session.approve", {
      sessionKey,
      requestId: params.requestId,
      decision: params.decision,
    });
    const session = readComputerSessionState(response?.session);
    applyLoadedComputerSession(host, sessionKey, session);
    return session;
  } catch (error) {
    host.computerSessionError = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    host.computerSessionLoading = false;
  }
}

export async function exportComputerSession(
  host: ComputerSessionHost,
  opts?: { sessionKey?: string },
): Promise<ComputerSessionExport | null> {
  const sessionKey = normalizeSessionKey(opts?.sessionKey ?? host.sessionKey);
  if (!host.client || !host.connected) {
    host.computerSessionError = "Gateway not connected";
    return null;
  }
  host.computerSessionLoading = true;
  try {
    const response = await host.client.request<{ sessionExport?: unknown }>("computer.session.export", {
      sessionKey,
    });
    return readComputerSessionExport(response?.sessionExport);
  } catch (error) {
    host.computerSessionError = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    host.computerSessionLoading = false;
  }
}
