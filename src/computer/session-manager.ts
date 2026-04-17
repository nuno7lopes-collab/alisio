import { randomUUID } from "node:crypto";
import type {
  ComputerApprovalMode,
  ComputerApprovalRequest,
  ComputerBackendKind,
  ComputerObservation,
  ComputerObservationContext,
  ComputerPermissionState,
  ComputerSessionState,
  ComputerSessionStatus,
  ComputerStructuredAction,
  ComputerTimelineEntry,
} from "./types.js";

const COMPUTER_TIMELINE_LIMIT = 80;

type ApprovalDecision = "allow-once" | "allow-session" | "deny";

type EnsureSessionParams = {
  sessionKey: string;
  backend?: ComputerBackendKind;
  mode?: ComputerApprovalMode;
  nodeId?: string;
  permissions?: Partial<ComputerPermissionState>;
};

type InternalApprovalState = {
  request: ComputerApprovalRequest;
  appIdentity?: string;
  resolve: (decision: ApprovalDecision) => void;
};

type InternalComputerSessionState = ComputerSessionState & {
  pendingApproval?: InternalApprovalState;
};

function cloneTimelineEntry(entry: ComputerTimelineEntry): ComputerTimelineEntry {
  return { ...entry };
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

function cloneState(state: InternalComputerSessionState): ComputerSessionState {
  return {
    sessionKey: state.sessionKey,
    backend: state.backend,
    status: state.status,
    mode: state.mode,
    nodeId: state.nodeId,
    approvedApps: [...state.approvedApps],
    permissions: { ...state.permissions },
    context: cloneObservationContext(state.context),
    frame: state.frame ? { ...state.frame } : null,
    timeline: state.timeline.map(cloneTimelineEntry),
    awaitingApproval: state.awaitingApproval ? { ...state.awaitingApproval } : null,
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

function createInitialState(params: EnsureSessionParams): InternalComputerSessionState {
  const ts = nowStateTimestamp();
  return {
    sessionKey: params.sessionKey,
    backend: params.backend ?? "local-mac",
    status: "idle",
    mode: params.mode ?? "control-approved-apps",
    nodeId: params.nodeId,
    approvedApps: [],
    permissions: {
      accessibility: params.permissions?.accessibility ?? false,
      screenRecording: params.permissions?.screenRecording ?? false,
    },
    context: null,
    frame: null,
    timeline: [],
    awaitingApproval: null,
    lastError: null,
    startedAt: ts,
    updatedAt: ts,
  };
}

function isSensitiveAction(action: ComputerStructuredAction): boolean {
  switch (action.type) {
    case "open_url":
    case "reveal_path":
    case "open_path":
    case "app_focus":
    case "drag":
      return true;
    case "keypress":
      return (action.modifiers?.length ?? 0) > 0;
    case "type":
      return Boolean(action.text?.trim());
    default:
      return false;
  }
}

function summarizeAction(action: ComputerStructuredAction): string {
  switch (action.type) {
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
    case "open_url":
      return `open url ${action.url ?? ""}`;
    case "reveal_path":
      return `reveal path ${action.path ?? ""}`;
    case "open_path":
      return `open path ${action.path ?? ""}`;
    case "app_focus":
      return `focus app ${action.app ?? ""}`;
  }
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

export class ComputerSessionManager {
  private readonly sessions = new Map<string, InternalComputerSessionState>();

  ensureSession(params: EnsureSessionParams): ComputerSessionState {
    const existing = this.sessions.get(params.sessionKey);
    if (existing) {
      if (params.nodeId?.trim()) {
        existing.nodeId = params.nodeId.trim();
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
      existing.updatedAt = nowStateTimestamp();
      return cloneState(existing);
    }
    const created = createInitialState(params);
    this.sessions.set(params.sessionKey, created);
    return cloneState(created);
  }

  getSession(sessionKey: string): ComputerSessionState | null {
    const state = this.sessions.get(sessionKey);
    return state ? cloneState(state) : null;
  }

  setMode(sessionKey: string, mode: ComputerApprovalMode): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.mode = mode;
    state.status = state.status === "stopped" ? state.status : "idle";
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.nextTimeline(
      state.timeline,
      createTimelineEntry("status", `mode -> ${mode}`, {
        status: state.status,
      }),
    );
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

  setStatus(
    sessionKey: string,
    status: ComputerSessionStatus,
    summary?: string,
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.status = status;
    state.updatedAt = nowStateTimestamp();
    if (summary) {
      state.timeline = this.nextTimeline(
        state.timeline,
        createTimelineEntry("status", summary, { status }),
      );
    }
    return cloneState(state);
  }

  recordObservation(
    sessionKey: string,
    observation: ComputerObservation,
    summary = "frame captured",
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.frame = { ...observation.frame };
    state.context = cloneObservationContext(observation.context);
    state.lastError = null;
    if (state.status !== "awaiting-approval" && state.status !== "paused") {
      state.status = "observing";
    }
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.nextTimeline(
      state.timeline,
      createTimelineEntry("observation", summary, { status: state.status }),
    );
    return cloneState(state);
  }

  recordAction(
    sessionKey: string,
    action: ComputerStructuredAction,
    summary = summarizeAction(action),
  ): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.status = "running";
    state.lastError = null;
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.nextTimeline(
      state.timeline,
      createTimelineEntry("action", summary, {
        status: "running",
        actionType: action.type,
      }),
    );
    return cloneState(state);
  }

  recordError(sessionKey: string, error: string): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.status = "error";
    state.lastError = error;
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
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.nextTimeline(
      state.timeline,
      createTimelineEntry("error", error, { status: "error" }),
    );
    return cloneState(state);
  }

  pause(sessionKey: string): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.status = "paused";
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.nextTimeline(
      state.timeline,
      createTimelineEntry("status", "session paused", { status: "paused" }),
    );
    return cloneState(state);
  }

  resume(sessionKey: string): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.status = "idle";
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.nextTimeline(
      state.timeline,
      createTimelineEntry("status", "session resumed", { status: "idle" }),
    );
    return cloneState(state);
  }

  stop(sessionKey: string): ComputerSessionState {
    const state = this.requireSession(sessionKey);
    state.status = "stopped";
    state.updatedAt = nowStateTimestamp();
    state.awaitingApproval = null;
    if (state.pendingApproval) {
      state.pendingApproval.resolve("deny");
      state.pendingApproval = undefined;
    }
    state.timeline = this.nextTimeline(
      state.timeline,
      createTimelineEntry("status", "session stopped", { status: "stopped" }),
    );
    return cloneState(state);
  }

  async requestApproval(params: {
    sessionKey: string;
    action: ComputerStructuredAction;
    reason: string;
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
      sensitive: isSensitiveAction(params.action),
      appName: params.context?.activeApp?.name ?? undefined,
      appBundleId: params.context?.activeApp?.bundleId ?? undefined,
    };
    state.awaitingApproval = request;
    state.status = "awaiting-approval";
    state.updatedAt = nowStateTimestamp();
    state.timeline = this.nextTimeline(
      state.timeline,
      createTimelineEntry("approval", `${request.actionSummary} awaiting approval`, {
        status: "awaiting-approval",
        actionType: request.actionType,
      }),
    );
    return await new Promise<ApprovalDecision>((resolve) => {
      state.pendingApproval = {
        request,
        appIdentity: params.appIdentity,
        resolve: (decision) => {
          if (decision === "allow-session" && params.appIdentity) {
            if (!state.approvedApps.includes(params.appIdentity)) {
              state.approvedApps.push(params.appIdentity);
            }
          }
          state.awaitingApproval = null;
          state.pendingApproval = undefined;
          state.status = decision === "deny" ? "paused" : "running";
          state.updatedAt = nowStateTimestamp();
          state.timeline = this.nextTimeline(
            state.timeline,
            createTimelineEntry(
              "approval",
              `${request.actionSummary} ${decision === "deny" ? "denied" : "approved"}`,
              {
                status: state.status,
                actionType: request.actionType,
              },
            ),
          );
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
    const state = this.requireSession(params.sessionKey);
    if (state.status === "stopped") {
      return { required: true, reason: "session stopped" };
    }
    if (state.mode === "observe-only") {
      return params.action.type === "wait"
        ? { required: false }
        : { required: true, reason: "observe-only mode blocks control actions" };
    }

    const activeAppIdentity =
      params.targetAppIdentity?.trim() ||
      params.context?.activeApp?.bundleId?.trim() ||
      params.context?.activeApp?.name?.trim() ||
      "";
    const isApproved = activeAppIdentity
      ? this.isAppApproved(params.sessionKey, activeAppIdentity)
      : false;

    if (state.mode === "control-approved-apps") {
      if (params.action.type === "wait" || params.action.type === "scroll") {
        return { required: false };
      }
      if (isApproved) {
        return { required: false, appIdentity: activeAppIdentity };
      }
      return {
        required: true,
        reason: activeAppIdentity
          ? `action targets unapproved app ${activeAppIdentity}`
          : "action targets an unapproved app",
        appIdentity: activeAppIdentity || undefined,
      };
    }

    if (isSensitiveAction(params.action)) {
      return {
        required: true,
        reason: "sensitive action requires explicit approval in elevated-watch mode",
        appIdentity: activeAppIdentity || undefined,
      };
    }

    return { required: false, appIdentity: activeAppIdentity || undefined };
  }

  private requireSession(sessionKey: string): InternalComputerSessionState {
    const state = this.sessions.get(sessionKey);
    if (!state) {
      throw new Error(`Computer session not found: ${sessionKey}`);
    }
    return state;
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
}

export const computerSessionManager = new ComputerSessionManager();
