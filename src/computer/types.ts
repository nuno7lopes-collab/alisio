export type ComputerBackendKind = "local-mac" | "web" | "windows-local" | "remote-node" | "ssh-mac";

export type ComputerCapabilityKind = "observe_only" | "foreground_control";

export type ComputerCapabilityReasonCode =
  | "local_mac_observe_supported"
  | "local_mac_foreground_control_supported"
  | "web_runtime_unavailable"
  | "windows_local_runtime_unavailable"
  | "remote_node_runtime_unavailable"
  | "ssh_mac_runtime_unavailable";

export type ComputerCapabilityExposure = "exposed" | "hidden";

export type ComputerSessionTargetKind =
  | "local-mac-host"
  | "web-session"
  | "windows-local-host"
  | "remote-node-target"
  | "ssh-mac-host";

export type ComputerSessionTargetPlatform = "macos" | "windows" | "web" | "unknown";

export type ComputerSessionStatus =
  | "idle"
  | "observing"
  | "running"
  | "paused"
  | "blocked_on_focus"
  | "blocked_on_approval"
  | "blocked_on_runtime"
  | "blocked_on_permissions"
  | "blocked_on_restart_required"
  | "error"
  | "stopped";

export type ComputerApprovalMode =
  | "observe_only"
  | "approved_apps_only"
  | "foreground_supervised"
  | "elevated_watch_mode";

export type ComputerKeyModifier = "command" | "shift" | "option" | "control";

export type ComputerOrientation = "landscape" | "portrait";

export type ComputerCoordinateSpace = "display-pixel" | "rendered-pane";

export type ComputerActionType =
  | "move"
  | "click"
  | "double_click"
  | "right_click"
  | "drag"
  | "scroll"
  | "type"
  | "keypress"
  | "wait"
  | "screenshot"
  | "focus_app"
  | "open_url"
  | "reveal_path"
  | "open_path"
  | "open_app";

export type ComputerStepKind = "observe" | "action";

export type ComputerStepPhase =
  | "observe"
  | "observe-before-action"
  | "awaiting-approval"
  | "action"
  | "observe-after-action";

export type ComputerStepStatus =
  | "running"
  | "awaiting-approval"
  | "completed"
  | "error"
  | "cancelled";

export type ComputerRuntimeConnectionState =
  | "idle"
  | "starting"
  | "running"
  | "interrupted"
  | "invalidated"
  | "disabled";

export type ComputerRuntimeSessionState = "running" | "paused" | "stopped";

export type ComputerRuntimeErrorCode =
  | "PERMISSION_MISSING"
  | "HELPER_UNAVAILABLE"
  | "CAPTURE_FAILED"
  | "ACTION_REJECTED"
  | "CONNECTION_INTERRUPTED"
  | "CONNECTION_INVALIDATED"
  | "PROTOCOL_VERSION_MISMATCH"
  | "INVALID_REQUEST";

export type ComputerActionFailureCategory =
  | "validation"
  | "stale-frame"
  | "invalid-target"
  | "permission-missing"
  | "cancelled"
  | "execution-failed"
  | "action-rejected";

export type ComputerPolicyDecision = "allow" | "require_once" | "require_session" | "deny";

export type ComputerSessionBlockReasonCode =
  | "focus_required"
  | "approval_required"
  | "runtime_unavailable"
  | "runtime_busy"
  | "concurrency_denied"
  | "observation_permission_missing"
  | "control_permission_missing"
  | "observation_restart_required"
  | "control_restart_required";

export type ComputerSessionBlockingKind =
  | "blocked_on_focus"
  | "blocked_on_approval"
  | "blocked_on_runtime"
  | "blocked_on_permissions"
  | "blocked_on_restart_required";

export type ComputerSessionOpenTrigger =
  | "open_computer"
  | "open_approval"
  | "open_permissions"
  | "open_restart_required";

export type ComputerTimelineEventCode =
  | "session_arbitrated"
  | "session_blocked"
  | "focus_required"
  | "blocked_on_permissions"
  | "blocked_on_restart_required"
  | "runtime_unavailable"
  | "runtime_busy"
  | "concurrency_denied"
  | "capability_exposed"
  | "capability_hidden"
  | "lazy_open_requested";

export type ComputerSessionLogEventCode =
  | "frame_captured"
  | "action_requested"
  | "action_validated"
  | "action_executed"
  | "action_failed"
  | "approval_requested"
  | "approval_decided"
  | "safety_raised"
  | "state_transition"
  | "session_paused"
  | "session_resumed"
  | "session_stopped"
  | "session_blocked"
  | "session_arbitrated"
  | "focus_required"
  | "capability_exposed"
  | "capability_hidden"
  | "lazy_open_requested";

export type ComputerPolicyReasonCode =
  | "session_stopped"
  | "session_paused"
  | "approval_pending"
  | "observe_only_block"
  | "blocked_action"
  | "blocked_app"
  | "blocked_path"
  | "blocked_host"
  | "unapproved_app"
  | "foreground_supervision"
  | "elevated_watch_mode"
  | "sensitive_surface"
  | "auth_context"
  | "prod_terminal"
  | "payment_or_credentials_surface"
  | "malicious_instruction_suspected"
  | "scope_escape_attempt"
  | "untrusted_external_content";

export type ComputerReasonCode =
  | ComputerPolicyReasonCode
  | ComputerSessionBlockReasonCode
  | ComputerCapabilityReasonCode;

export type ComputerSafetyEventType =
  | "malicious_instruction_suspected"
  | "sensitive_surface"
  | "scope_escape_attempt"
  | "auth_context_detected"
  | "prod_terminal_detected"
  | "payment_or_credentials_surface"
  | "untrusted_external_content";

export type ComputerSafetyLevel = "normal" | "elevated" | "watch";

export type ComputerTargetPoint = {
  x: number;
  y: number;
};

export type ComputerActionFrameRef = {
  frameId: string;
  displayId?: string;
  capturedAt: number;
  maxAgeMs: number;
  sourceSpace: ComputerCoordinateSpace;
  pixelWidth: number;
  pixelHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  scaleFactor: number;
  orientation: ComputerOrientation;
};

export type ComputerCoordinateTransform = {
  sourceSpace: ComputerCoordinateSpace;
  sourceWidth: number;
  sourceHeight: number;
  renderedWidth?: number;
  renderedHeight?: number;
  downscaleFactorX?: number;
  downscaleFactorY?: number;
};

export type ComputerStructuredAction = {
  id?: string;
  type: ComputerActionType;
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  deltaX?: number;
  deltaY?: number;
  text?: string;
  key?: string;
  modifiers?: ComputerKeyModifier[];
  url?: string;
  path?: string;
  app?: string;
  delayMs?: number;
  coordinateSpace?: ComputerCoordinateSpace;
  frame?: ComputerActionFrameRef | null;
  transform?: ComputerCoordinateTransform | null;
};

export type ComputerCursorState = {
  x: number;
  y: number;
  visible: boolean;
};

export type ComputerFrame = {
  id: string;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  scaleFactor: number;
  orientation: ComputerOrientation;
  displayId?: string;
  sourceSpace: ComputerCoordinateSpace;
  capturedAt: number;
  maxAgeMs: number;
  staleAt: number;
  cursor?: ComputerCursorState | null;
};

export type ComputerAppContext = {
  name?: string;
  bundleId?: string;
  processId?: number;
};

export type ComputerWindowContext = {
  title?: string;
};

export type ComputerDisplayContext = {
  id?: string;
  width: number;
  height: number;
  scale: number;
  logicalWidth: number;
  logicalHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  orientation: ComputerOrientation;
};

export type ComputerObservationContext = {
  display: ComputerDisplayContext;
  activeApp?: ComputerAppContext | null;
  activeWindow?: ComputerWindowContext | null;
  errorState?: string | null;
  capturedAt: number;
};

export type ComputerObservation = {
  frame: ComputerFrame;
  context: ComputerObservationContext;
};

export type ComputerExecutedActionResult = {
  id: string;
  actionId?: string;
  type: ComputerActionType;
  success: boolean;
  elapsedMs: number;
  retryCount: number;
  summary: string;
  failureCategory?: ComputerActionFailureCategory;
  sourceFrameId?: string;
  resultFrameId?: string;
};

export type ComputerActionResult = {
  ok: boolean;
  summary: string;
  results: ComputerExecutedActionResult[];
  observation?: ComputerObservation;
};

export type ComputerCapabilityDescriptor = {
  kind: ComputerCapabilityKind;
  available: boolean;
  exposure: ComputerCapabilityExposure;
  reasonCode: ComputerCapabilityReasonCode;
  reason: string;
};

export type ComputerSessionTarget = {
  id: string;
  label: string;
  kind: ComputerSessionTargetKind;
  platform: ComputerSessionTargetPlatform;
  nodeId?: string;
  displayId?: string;
  globalInput: boolean;
  allowsConcurrentObserve: boolean;
};

export type ComputerSessionBlockingState = {
  kind: ComputerSessionBlockingKind;
  reasonCode: ComputerSessionBlockReasonCode;
  summary: string;
  at: number;
  targetId?: string;
  ownerSessionKey?: string;
  foregroundControlRequired?: boolean;
  actionType?: ComputerActionType;
  openTrigger?: ComputerSessionOpenTrigger;
};

export type ComputerReplayAction = {
  actionId?: string;
  type: ComputerActionType;
  summary: string;
  coordinateSpace?: ComputerCoordinateSpace;
  referenceWidth?: number;
  referenceHeight?: number;
  target?: ComputerTargetPoint;
  destination?: ComputerTargetPoint;
  scrollDelta?: ComputerTargetPoint;
  textPreview?: string;
  keyCombo?: string;
  app?: string;
  url?: string;
  path?: string;
  delayMs?: number;
};

export type ComputerReplayFrameMetadata = {
  frameHash: string;
  sizeBytes: number;
  captureLatencyMs: number;
  stale: boolean;
  stalenessMs: number;
  transform: ComputerCoordinateTransform;
  display: ComputerDisplayContext;
  activeApp?: ComputerAppContext | null;
  activeWindow?: ComputerWindowContext | null;
};

export type ComputerReplayFrame = {
  frameId: string;
  capturedAt: number;
  stepId?: string;
  stepSequence?: number;
  stepPhase?: ComputerStepPhase;
  observation: ComputerObservation;
  metadata?: ComputerReplayFrameMetadata;
};

export type ComputerTimelineEntry = {
  id: string;
  at: number;
  kind: "status" | "observation" | "action" | "approval" | "error" | "safety";
  summary: string;
  eventCode?: ComputerTimelineEventCode;
  status?: ComputerSessionStatus;
  actionType?: ComputerActionType;
  stepId?: string;
  stepSequence?: number;
  toolCallId?: string;
  runId?: string | null;
  responseId?: string | null;
  stepPhase?: ComputerStepPhase;
  actionId?: string;
  actionResultId?: string;
  nativeActionId?: string;
  sourceFrameId?: string;
  resultFrameId?: string;
  success?: boolean;
  elapsedMs?: number;
  retryCount?: number;
  failureCategory?: ComputerActionFailureCategory;
  policyDecision?: ComputerPolicyDecision;
  reasonCode?: ComputerReasonCode;
  capability?: ComputerCapabilityKind;
  openTrigger?: ComputerSessionOpenTrigger;
  safetyEventType?: ComputerSafetyEventType;
  heuristic?: boolean;
};

export type ComputerReplayStep = {
  id: string;
  sequence: number;
  toolCallId: string;
  runId?: string | null;
  responseId?: string | null;
  kind: ComputerStepKind;
  phase: ComputerStepPhase;
  status: ComputerStepStatus;
  summary: string;
  actionType?: ComputerActionType;
  sourceFrameId?: string;
  resultFrameId?: string;
  startedAt: number;
  updatedAt: number;
  totalElapsedMs?: number;
  lastActionElapsedMs?: number;
  actionCount: number;
  approvalCount: number;
  safetyEventsCount: number;
  action?: ComputerReplayAction | null;
};

export type ComputerSessionStep = {
  id: string;
  sequence: number;
  toolCallId: string;
  runId?: string | null;
  responseId?: string | null;
  kind: ComputerStepKind;
  phase: ComputerStepPhase;
  status: ComputerStepStatus;
  summary: string;
  actionType?: ComputerActionType;
  sourceFrameId?: string;
  resultFrameId?: string;
  startedAt: number;
  updatedAt: number;
};

export type ComputerApprovalRequest = {
  id: string;
  createdAt: number;
  actionType: ComputerActionType;
  actionSummary: string;
  reason: string;
  reasonCode: ComputerPolicyReasonCode;
  policyDecision: Extract<ComputerPolicyDecision, "require_once" | "require_session">;
  sensitive: boolean;
  safetyEvents: ComputerSafetyEvent[];
  appName?: string;
  appBundleId?: string;
  stepId?: string;
  stepSequence?: number;
  toolCallId?: string;
  runId?: string | null;
  responseId?: string | null;
};

export type ComputerPolicyRuleScope = {
  apps: string[];
  paths: string[];
  hosts: string[];
  actions: ComputerActionType[];
  surfaces: string[];
};

export type ComputerPolicyDecisionRecord = {
  at: number;
  actionType: ComputerActionType;
  decision: ComputerPolicyDecision;
  reasonCode: ComputerPolicyReasonCode;
  reason: string;
  appIdentity?: string;
};

export type ComputerSessionPolicy = {
  allow: ComputerPolicyRuleScope;
  deny: ComputerPolicyRuleScope;
  sensitive: ComputerPolicyRuleScope;
  commandLikeActions: ComputerActionType[];
  lastDecision?: ComputerPolicyDecisionRecord | null;
};

export type ComputerSessionPolicyPatch = {
  allow?: Partial<ComputerPolicyRuleScope>;
  deny?: Partial<ComputerPolicyRuleScope>;
  sensitive?: Partial<ComputerPolicyRuleScope>;
  commandLikeActions?: ComputerActionType[];
  lastDecision?: ComputerPolicyDecisionRecord | null;
};

export type ComputerSafetyEvent = {
  id: string;
  at: number;
  type: ComputerSafetyEventType;
  reasonCode: ComputerPolicyReasonCode;
  summary: string;
  heuristic: boolean;
  actionType?: ComputerActionType;
  appName?: string;
  appBundleId?: string;
  windowTitle?: string;
  host?: string;
  path?: string;
};

export type ComputerSessionSafety = {
  level: ComputerSafetyLevel;
  lastEvent?: ComputerSafetyEvent | null;
  recentEvents: ComputerSafetyEvent[];
};

export type ComputerSessionLogEvent = {
  id: string;
  ordinal: number;
  at: number;
  code: ComputerSessionLogEventCode;
  summary: string;
  sessionId: string;
  runId?: string | null;
  responseId?: string | null;
  toolCallId?: string;
  stepId?: string;
  stepSequence?: number;
  stepPhase?: ComputerStepPhase;
  status?: ComputerSessionStatus;
  actionType?: ComputerActionType;
  actionId?: string;
  nativeActionId?: string;
  sourceFrameId?: string;
  resultFrameId?: string;
  policyDecision?: ComputerPolicyDecision;
  reasonCode?: ComputerReasonCode;
  capability?: ComputerCapabilityKind;
  openTrigger?: ComputerSessionOpenTrigger;
  safetyEventType?: ComputerSafetyEventType;
  success?: boolean;
  elapsedMs?: number;
  retryCount?: number;
  failureCategory?: ComputerActionFailureCategory;
  heuristic?: boolean;
};

export type ComputerSessionBufferState = {
  eventLimit: number;
  replayFrameLimit: number;
  replayStepLimit: number;
  timelineLimit: number;
  eventLogTruncated: boolean;
  replayFramesTruncated: boolean;
  replayStepsTruncated: boolean;
  timelineTruncated: boolean;
};

export type ComputerSessionReplay = {
  frames: ComputerReplayFrame[];
  steps: ComputerReplayStep[];
  actionCount: number;
  safetyEventsCount: number;
};

export type ComputerPermissionAccessState =
  | "unknown"
  | "granted"
  | "missing"
  | "restart_required"
  | "not_supported";

export type ComputerPermissionState = {
  accessibility: boolean | null;
  screenRecording: boolean | null;
  observation: ComputerPermissionAccessState;
  control: ComputerPermissionAccessState;
};

export type ComputerRuntimeErrorState = {
  code: ComputerRuntimeErrorCode;
  message: string;
  retryable: boolean;
  permission?: string;
};

export type ComputerRuntimeState = {
  connectionState: ComputerRuntimeConnectionState;
  launchCount: number;
  helperProtocolVersion?: number;
  helperVersion?: string;
  helperProcessId?: number;
  activeSession?: {
    sessionKey: string;
    state: ComputerRuntimeSessionState;
    updatedAt: number;
  };
  lastError?: ComputerRuntimeErrorState | null;
};

export type ComputerSessionState = {
  sessionKey: string;
  backend: ComputerBackendKind;
  status: ComputerSessionStatus;
  mode: ComputerApprovalMode;
  nodeId?: string;
  target: ComputerSessionTarget;
  capabilities: ComputerCapabilityDescriptor[];
  approvedApps: string[];
  policy: ComputerSessionPolicy;
  safety: ComputerSessionSafety;
  replay: ComputerSessionReplay;
  blocking?: ComputerSessionBlockingState | null;
  permissions: ComputerPermissionState;
  runtime?: ComputerRuntimeState | null;
  context?: ComputerObservationContext | null;
  frame?: ComputerFrame | null;
  stepCounter: number;
  activeStep?: ComputerSessionStep | null;
  lastCompletedStep?: ComputerSessionStep | null;
  timeline: ComputerTimelineEntry[];
  eventLog?: ComputerSessionLogEvent[];
  buffers?: ComputerSessionBufferState;
  awaitingApproval?: ComputerApprovalRequest | null;
  lastError?: string | null;
  startedAt: number;
  updatedAt: number;
};

export type ComputerSessionExportFrame = {
  frameId: string;
  frameHash: string;
  capturedAt: number;
  stepId?: string;
  stepSequence?: number;
  stepPhase?: ComputerStepPhase;
  displayId?: string;
  sourceSpace: ComputerCoordinateSpace;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  logicalWidth: number;
  logicalHeight: number;
  scaleFactor: number;
  orientation: ComputerOrientation;
  maxAgeMs: number;
  captureLatencyMs: number;
  stale: boolean;
  stalenessMs: number;
  sizeBytes: number;
  display: ComputerDisplayContext;
  activeApp?: ComputerAppContext | null;
  activeWindow?: ComputerWindowContext | null;
  redacted: boolean;
};

export type ComputerSessionExport = {
  exportedAt: number;
  sessionKey: string;
  summary: {
    backend: ComputerBackendKind;
    status: ComputerSessionStatus;
    mode: ComputerApprovalMode;
    startedAt: number;
    updatedAt: number;
    target: ComputerSessionTarget;
    blocking?: ComputerSessionBlockingState | null;
    permissions: ComputerPermissionState;
    capabilities: ComputerCapabilityDescriptor[];
    runtime?: ComputerRuntimeState | null;
    actionCount: number;
    safetyEventsCount: number;
    approvalCount: number;
    eventCount: number;
    lastError?: string | null;
    activeApp?: ComputerAppContext | null;
    activeWindow?: ComputerWindowContext | null;
    display?: ComputerDisplayContext | null;
    replayPartial: boolean;
    correlationCoverage: {
      hasRunId: boolean;
      hasResponseId: boolean;
      hasToolCallId: boolean;
      hasStepId: boolean;
      hasActionId: boolean;
      hasNativeActionId: boolean;
    };
  };
  buffers: ComputerSessionBufferState;
  eventLog: ComputerSessionLogEvent[];
  lastErrors: ComputerSessionLogEvent[];
  approvalHistory: ComputerSessionLogEvent[];
  safetyHistory: ComputerSafetyEvent[];
  timeline: ComputerTimelineEntry[];
  replay: {
    partial: boolean;
    steps: ComputerReplayStep[];
    frames: ComputerSessionExportFrame[];
  };
};

export interface ComputerEnvironment {
  readonly backend: ComputerBackendKind;
  observe(signal?: AbortSignal): Promise<ComputerObservation>;
  act(action: ComputerStructuredAction, signal?: AbortSignal): Promise<ComputerActionResult>;
}
