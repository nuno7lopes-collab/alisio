export type ComputerBackendKind = "local-mac" | "remote-node" | "ssh-mac";

export type ComputerSessionStatus =
  | "idle"
  | "observing"
  | "running"
  | "paused"
  | "awaiting-approval"
  | "error"
  | "stopped";

export type ComputerApprovalMode = "observe-only" | "control-approved-apps" | "elevated-watch";

export type ComputerKeyModifier = "command" | "shift" | "option" | "control";

export type ComputerActionType =
  | "click"
  | "double_click"
  | "right_click"
  | "drag"
  | "scroll"
  | "type"
  | "keypress"
  | "wait"
  | "open_url"
  | "reveal_path"
  | "open_path"
  | "app_focus";

export type ComputerTargetPoint = {
  x: number;
  y: number;
};

export type ComputerStructuredAction = {
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
};

export type ComputerCursorState = {
  x: number;
  y: number;
  visible: boolean;
};

export type ComputerFrame = {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  capturedAt: number;
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

export type ComputerActionResult = {
  ok: boolean;
  summary: string;
  observation?: ComputerObservation;
};

export type ComputerTimelineEntry = {
  id: string;
  at: number;
  kind: "status" | "observation" | "action" | "approval" | "error";
  summary: string;
  status?: ComputerSessionStatus;
  actionType?: ComputerActionType;
};

export type ComputerApprovalRequest = {
  id: string;
  createdAt: number;
  actionType: ComputerActionType;
  actionSummary: string;
  reason: string;
  sensitive: boolean;
  appName?: string;
  appBundleId?: string;
};

export type ComputerPermissionState = {
  accessibility: boolean;
  screenRecording: boolean;
};

export type ComputerSessionState = {
  sessionKey: string;
  backend: ComputerBackendKind;
  status: ComputerSessionStatus;
  mode: ComputerApprovalMode;
  nodeId?: string;
  approvedApps: string[];
  permissions: ComputerPermissionState;
  context?: ComputerObservationContext | null;
  frame?: ComputerFrame | null;
  timeline: ComputerTimelineEntry[];
  awaitingApproval?: ComputerApprovalRequest | null;
  lastError?: string | null;
  startedAt: number;
  updatedAt: number;
};

export interface ComputerEnvironment {
  readonly backend: ComputerBackendKind;
  observe(signal?: AbortSignal): Promise<ComputerObservation>;
  act(action: ComputerStructuredAction, signal?: AbortSignal): Promise<ComputerActionResult>;
}
