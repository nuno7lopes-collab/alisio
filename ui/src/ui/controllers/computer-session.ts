import { GatewayRequestError } from "../gateway.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  ComputerActionType,
  ComputerApprovalMode,
  ComputerApprovalRequest,
  ComputerFrame,
  ComputerObservationContext,
  ComputerPermissionState,
  ComputerSessionState,
  ComputerSessionStatus,
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

type ComputerSessionCommand = "pause" | "resume" | "stop";
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
    case "observe-only":
    case "control-approved-apps":
    case "elevated-watch":
      return value;
    default:
      return null;
  }
}

function readActionType(value: unknown): ComputerActionType | null {
  switch (value) {
    case "click":
    case "double_click":
    case "right_click":
    case "drag":
    case "scroll":
    case "type":
    case "keypress":
    case "wait":
    case "open_url":
    case "reveal_path":
    case "open_path":
    case "app_focus":
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

function readFrame(value: unknown): ComputerFrame | null {
  if (!isRecord(value)) {
    return null;
  }
  const dataUrl = readString(value.dataUrl);
  const mimeType = readString(value.mimeType);
  const width = readNumber(value.width);
  const height = readNumber(value.height);
  const capturedAt = readNumber(value.capturedAt);
  if (!dataUrl || !mimeType || width === null || height === null || capturedAt === null) {
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
    dataUrl,
    mimeType,
    width,
    height,
    capturedAt,
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
  const capturedAt = readNumber(value.capturedAt);
  if (width === null || height === null || scale === null || capturedAt === null) {
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
    },
    ...(activeApp ? { activeApp } : {}),
    ...(activeWindow ? { activeWindow } : {}),
    ...(readString(value.errorState) ? { errorState: readString(value.errorState) } : {}),
    capturedAt,
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
    value.kind === "error"
      ? value.kind
      : null;
  const summary = readString(value.summary);
  if (!id || at === null || !kind || !summary) {
    return null;
  }
  const status = readSessionStatus(value.status) ?? undefined;
  const actionType = readActionType(value.actionType) ?? undefined;
  return {
    id,
    at,
    kind,
    summary,
    ...(status ? { status } : {}),
    ...(actionType ? { actionType } : {}),
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
  const sensitive = readBoolean(value.sensitive);
  if (!id || createdAt === null || !actionType || !actionSummary || !reason || sensitive === null) {
    return null;
  }
  return {
    id,
    createdAt,
    actionType,
    actionSummary,
    reason,
    sensitive,
    ...(readString(value.appName) ? { appName: readString(value.appName)! } : {}),
    ...(readString(value.appBundleId) ? { appBundleId: readString(value.appBundleId)! } : {}),
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
  const permissions = readPermissionState(value.permissions);
  const timeline = Array.isArray(value.timeline)
    ? value.timeline
        .map((entry) => readTimelineEntry(entry))
        .filter((entry): entry is ComputerTimelineEntry => Boolean(entry))
    : null;
  const startedAt = readNumber(value.startedAt);
  const updatedAt = readNumber(value.updatedAt);
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
    approvedApps: Array.isArray(value.approvedApps)
      ? value.approvedApps
          .map((entry) => readString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    permissions,
    ...(readObservationContext(value.context)
      ? { context: readObservationContext(value.context)! }
      : {}),
    ...(readFrame(value.frame) ? { frame: readFrame(value.frame)! } : {}),
    timeline,
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
