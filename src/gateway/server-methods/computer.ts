import { normalizeComputerApprovalMode } from "../../computer/policy-engine.js";
import { computerSessionManager } from "../../computer/session-manager.js";
import type {
  ComputerActionType,
  ComputerApprovalMode,
  ComputerBackendKind,
  ComputerPermissionState,
  ComputerRuntimeConnectionState,
  ComputerRuntimeErrorCode,
  ComputerRuntimeSessionState,
  ComputerRuntimeState,
  ComputerSessionPolicyPatch,
} from "../../computer/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { safeParseJson } from "./nodes.helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function resolveSessionKey(params: Record<string, unknown>): string {
  const raw = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
  return raw || "main";
}

function resolveApprovalMode(value: unknown): ComputerApprovalMode | null {
  return normalizeComputerApprovalMode(value);
}

function readBackendKind(value: unknown): ComputerBackendKind | null {
  switch (value) {
    case "local-mac":
    case "web":
    case "windows-local":
    case "remote-node":
    case "ssh-mac":
      return value;
    default:
      return null;
  }
}

function resolvePermissionPatch(value: unknown): Partial<ComputerPermissionState> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const patch: Partial<ComputerPermissionState> = {};
  if (typeof record.accessibility === "boolean") {
    patch.accessibility = record.accessibility;
  }
  if (typeof record.screenRecording === "boolean") {
    patch.screenRecording = record.screenRecording;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
      return value;
    default:
      return null;
  }
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return items;
}

function readActionArray(value: unknown): ComputerActionType[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value
    .map((entry) => readActionType(entry))
    .filter((entry): entry is ComputerActionType => Boolean(entry));
  return items;
}

function resolvePolicyScopePatch(
  value: unknown,
): NonNullable<ComputerSessionPolicyPatch["allow"]> | null {
  if (!isRecord(value)) {
    return null;
  }
  const patch: NonNullable<ComputerSessionPolicyPatch["allow"]> = {};
  const apps = readStringArray(value.apps);
  if (apps) {
    patch.apps = apps;
  }
  const paths = readStringArray(value.paths);
  if (paths) {
    patch.paths = paths;
  }
  const hosts = readStringArray(value.hosts);
  if (hosts) {
    patch.hosts = hosts;
  }
  const actions = readActionArray(value.actions);
  if (actions) {
    patch.actions = actions;
  }
  const surfaces = readStringArray(value.surfaces);
  if (surfaces) {
    patch.surfaces = surfaces;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function resolvePolicyPatch(value: unknown): ComputerSessionPolicyPatch | null {
  if (!isRecord(value)) {
    return null;
  }
  const patch: ComputerSessionPolicyPatch = {};
  const allow = resolvePolicyScopePatch(value.allow);
  if (allow) {
    patch.allow = allow;
  }
  const deny = resolvePolicyScopePatch(value.deny);
  if (deny) {
    patch.deny = deny;
  }
  const sensitive = resolvePolicyScopePatch(value.sensitive);
  if (sensitive) {
    patch.sensitive = sensitive;
  }
  const commandLikeActions = readActionArray(value.commandLikeActions);
  if (commandLikeActions) {
    patch.commandLikeActions = commandLikeActions;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function readRuntimeConnectionState(value: unknown): ComputerRuntimeConnectionState | null {
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

function readRuntimeSessionState(value: unknown): ComputerRuntimeSessionState | null {
  switch (value) {
    case "running":
    case "paused":
    case "stopped":
      return value;
    default:
      return null;
  }
}

function readRuntimeErrorCode(value: unknown): ComputerRuntimeErrorCode | null {
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

function resolveNodeInvokeErrorMessage(error: unknown): string {
  if (!isRecord(error)) {
    return "computer helper unavailable";
  }
  return readString(error.message) ?? "computer helper unavailable";
}

function createUnavailableRuntime(message: string): ComputerRuntimeState {
  const trimmed = message.trim() || "computer helper unavailable";
  const disabled = /command not declared|command not allowlisted/i.test(trimmed);
  return {
    connectionState: disabled ? "disabled" : "invalidated",
    launchCount: 0,
    lastError: {
      code: "HELPER_UNAVAILABLE",
      message: trimmed,
      retryable: !disabled,
    },
  };
}

function readRuntimeError(
  value: unknown,
): NonNullable<ComputerRuntimeState["lastError"]> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const code = readRuntimeErrorCode(value.code);
  const message = readString(value.message);
  const retryable = readBoolean(value.retryable);
  if (!code || !message || retryable === null) {
    return undefined;
  }
  return {
    code,
    message,
    retryable,
    ...(readString(value.permission) ? { permission: readString(value.permission)! } : {}),
  };
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
  return {
    accessibility,
    screenRecording,
    observation: screenRecording ? "granted" : "missing",
    control: accessibility ? "granted" : "missing",
  };
}

function readRuntimeState(value: unknown): ComputerRuntimeState | null {
  if (!isRecord(value)) {
    return null;
  }
  const connectionState = readRuntimeConnectionState(value.connectionState);
  const launchCount = readNumber(value.launchCount);
  const helper = isRecord(value.helper) ? value.helper : null;
  if (!connectionState || launchCount === null) {
    return null;
  }

  const activeSession =
    helper && isRecord(helper.activeSession)
      ? (() => {
          const sessionKey = readString(helper.activeSession.sessionId);
          const state = readRuntimeSessionState(helper.activeSession.state);
          const updatedAt = readNumber(helper.activeSession.updatedAt);
          if (!sessionKey || !state || updatedAt === null) {
            return undefined;
          }
          return { sessionKey, state, updatedAt };
        })()
      : undefined;

  const lastError = readRuntimeError(value.lastError) ?? readRuntimeError(helper?.lastError);

  return {
    connectionState,
    launchCount,
    ...(readNumber(helper?.protocolVersion) !== null
      ? { helperProtocolVersion: readNumber(helper?.protocolVersion)! }
      : {}),
    ...(readString(helper?.helperVersion)
      ? { helperVersion: readString(helper?.helperVersion)! }
      : {}),
    ...(readNumber(helper?.processId) !== null
      ? { helperProcessId: readNumber(helper?.processId)! }
      : {}),
    ...(activeSession ? { activeSession } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

function readHelperSessionPayload(value: unknown): {
  sessionKey: string;
  state: ComputerRuntimeSessionState;
  permissions: ComputerPermissionState;
  runtime: ComputerRuntimeState;
} | null {
  if (!isRecord(value)) {
    return null;
  }
  const sessionKey = readString(value.sessionId);
  const state = readRuntimeSessionState(value.state);
  const permissions = readPermissionState(value.permissions);
  const runtime = readRuntimeState(value.health);
  if (!sessionKey || !state || !permissions || !runtime) {
    return null;
  }
  return { sessionKey, state, permissions, runtime };
}

function resolveNodeId(
  params: Record<string, unknown>,
  session: ReturnType<typeof computerSessionManager.getSession>,
): string | null {
  const requested = readString(params.nodeId);
  if (requested) {
    return requested;
  }
  const current = session?.nodeId?.trim();
  return current || null;
}

function ensureComputerSession(params: {
  sessionKey: string;
  backend?: ComputerBackendKind | null;
  nodeId?: string | null;
  mode?: ComputerApprovalMode | null;
  permissions?: Partial<ComputerPermissionState> | null;
}) {
  return computerSessionManager.ensureSession({
    sessionKey: params.sessionKey,
    ...(params.backend ? { backend: params.backend } : {}),
    ...(params.nodeId ? { nodeId: params.nodeId } : {}),
    ...(params.mode ? { mode: params.mode } : {}),
    ...(params.permissions ? { permissions: params.permissions } : {}),
  });
}

function applyRuntimeState(params: {
  sessionKey: string;
  backend?: ComputerBackendKind | null;
  nodeId?: string | null;
  runtime: ComputerRuntimeState;
  permissions?: ComputerPermissionState | null;
}) {
  ensureComputerSession({
    sessionKey: params.sessionKey,
    backend: params.backend,
    nodeId: params.nodeId,
    permissions: params.permissions ?? undefined,
  });
  if (params.permissions) {
    computerSessionManager.setPermissions(params.sessionKey, params.permissions);
  }
  return computerSessionManager.setRuntime(params.sessionKey, params.runtime);
}

async function refreshRuntimeState(params: {
  sessionKey: string;
  backend?: ComputerBackendKind | null;
  nodeId: string;
  context: Parameters<GatewayRequestHandlers["computer.session.get"]>[0]["context"];
}) {
  const [healthRes, permissionsRes] = await Promise.all([
    params.context.nodeRegistry.invoke({
      nodeId: params.nodeId,
      command: "computer.health",
      params: { sessionId: params.sessionKey },
    }),
    params.context.nodeRegistry.invoke({
      nodeId: params.nodeId,
      command: "computer.permissions",
      params: {},
    }),
  ]);

  const runtime = healthRes.ok
    ? (readRuntimeState(
        healthRes.payloadJSON ? safeParseJson(healthRes.payloadJSON) : healthRes.payload,
      ) ?? createUnavailableRuntime("invalid computer.health payload"))
    : createUnavailableRuntime(resolveNodeInvokeErrorMessage(healthRes.error));
  const permissions = permissionsRes.ok
    ? readPermissionState(
        permissionsRes.payloadJSON
          ? safeParseJson(permissionsRes.payloadJSON)
          : permissionsRes.payload,
      )
    : null;

  return applyRuntimeState({
    sessionKey: params.sessionKey,
    backend: params.backend,
    nodeId: params.nodeId,
    runtime,
    permissions,
  });
}

export const computerHandlers: GatewayRequestHandlers = {
  "computer.session.get": async ({ params, respond, context }) => {
    const sessionKey = resolveSessionKey(params);
    const requestedBackend = params.backend === undefined ? null : readBackendKind(params.backend);
    if (params.backend !== undefined && !requestedBackend) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid computer backend"));
      return;
    }
    const existingSession = computerSessionManager.getSession(sessionKey);
    const backend = requestedBackend ?? existingSession?.backend ?? "local-mac";
    const session =
      existingSession ??
      ensureComputerSession({
        sessionKey,
        backend,
        nodeId: readString(params.nodeId),
      });
    const nodeId = resolveNodeId(params, session);
    if (!nodeId || backend !== "local-mac") {
      respond(true, {
        sessionKey,
        session,
      });
      return;
    }
    const synced = await refreshRuntimeState({
      sessionKey,
      backend,
      nodeId,
      context,
    });
    respond(true, { sessionKey, session: synced });
  },

  "computer.session.update": async ({ params, respond, context }) => {
    const sessionKey = resolveSessionKey(params);
    const requestedBackend = params.backend === undefined ? null : readBackendKind(params.backend);
    if (params.backend !== undefined && !requestedBackend) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid computer backend"));
      return;
    }
    const mode = params.mode === undefined ? null : resolveApprovalMode(params.mode);
    if (params.mode !== undefined && !mode) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid computer mode"));
      return;
    }
    const command = typeof params.command === "string" ? params.command.trim().toLowerCase() : "";
    const permissions =
      params.permissions === undefined ? null : resolvePermissionPatch(params.permissions);
    if (params.permissions !== undefined && !permissions) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid permissions patch"),
      );
      return;
    }
    const policy = params.policy === undefined ? null : resolvePolicyPatch(params.policy);
    if (params.policy !== undefined && !policy) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid computer policy"));
      return;
    }
    let session = ensureComputerSession({
      sessionKey,
      backend: requestedBackend,
      nodeId: readString(params.nodeId),
      mode,
    });
    const backend = requestedBackend ?? session.backend;
    if (mode) {
      session = computerSessionManager.setMode(sessionKey, mode);
    }
    if (permissions) {
      session = computerSessionManager.setPermissions(sessionKey, permissions);
    }
    if (policy) {
      session = computerSessionManager.setPolicy(sessionKey, policy);
    }
    const nodeId = resolveNodeId(params, session);
    if (
      command &&
      backend !== "local-mac" &&
      (command === "start" || command === "pause" || command === "resume" || command === "stop")
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `computer runtime is unavailable for backend ${backend}`,
        ),
      );
      return;
    }
    switch (command) {
      case "":
        break;
      case "start": {
        if (!nodeId) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "computer session is not bound to a node"),
          );
          return;
        }
        const res = await context.nodeRegistry.invoke({
          nodeId,
          command: "computer.session.start",
          params: { sessionId: sessionKey },
        });
        if (!res.ok) {
          const message = resolveNodeInvokeErrorMessage(res.error);
          session = applyRuntimeState({
            sessionKey,
            backend,
            nodeId,
            runtime: createUnavailableRuntime(message),
          });
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
          return;
        }
        const payload = readHelperSessionPayload(
          res.payloadJSON ? safeParseJson(res.payloadJSON) : res.payload,
        );
        if (!payload) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.UNAVAILABLE, "invalid computer session payload"),
          );
          return;
        }
        session = computerSessionManager.setPermissions(sessionKey, payload.permissions);
        session = computerSessionManager.setRuntime(sessionKey, payload.runtime);
        session = computerSessionManager.setStatus(sessionKey, "idle", "session started");
        break;
      }
      case "pause":
        if (!nodeId) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "computer session is not bound to a node"),
          );
          return;
        }
        {
          const res = await context.nodeRegistry.invoke({
            nodeId,
            command: "computer.session.pause",
            params: { sessionId: sessionKey },
          });
          if (!res.ok) {
            const message = resolveNodeInvokeErrorMessage(res.error);
            session = applyRuntimeState({
              sessionKey,
              backend,
              nodeId,
              runtime: createUnavailableRuntime(message),
            });
            respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
            return;
          }
          const payload = readHelperSessionPayload(
            res.payloadJSON ? safeParseJson(res.payloadJSON) : res.payload,
          );
          if (!payload) {
            respond(
              false,
              undefined,
              errorShape(ErrorCodes.UNAVAILABLE, "invalid computer session payload"),
            );
            return;
          }
          session = computerSessionManager.setPermissions(sessionKey, payload.permissions);
          session = computerSessionManager.setRuntime(sessionKey, payload.runtime);
          session = computerSessionManager.pause(sessionKey);
        }
        break;
      case "resume":
        if (!nodeId) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "computer session is not bound to a node"),
          );
          return;
        }
        {
          const res = await context.nodeRegistry.invoke({
            nodeId,
            command: "computer.session.resume",
            params: { sessionId: sessionKey },
          });
          if (!res.ok) {
            const message = resolveNodeInvokeErrorMessage(res.error);
            session = applyRuntimeState({
              sessionKey,
              backend,
              nodeId,
              runtime: createUnavailableRuntime(message),
            });
            respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
            return;
          }
          const payload = readHelperSessionPayload(
            res.payloadJSON ? safeParseJson(res.payloadJSON) : res.payload,
          );
          if (!payload) {
            respond(
              false,
              undefined,
              errorShape(ErrorCodes.UNAVAILABLE, "invalid computer session payload"),
            );
            return;
          }
          session = computerSessionManager.setPermissions(sessionKey, payload.permissions);
          session = computerSessionManager.setRuntime(sessionKey, payload.runtime);
          session = computerSessionManager.resume(sessionKey);
        }
        break;
      case "stop":
        if (!nodeId) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "computer session is not bound to a node"),
          );
          return;
        }
        {
          const res = await context.nodeRegistry.invoke({
            nodeId,
            command: "computer.session.stop",
            params: { sessionId: sessionKey },
          });
          if (!res.ok) {
            const message = resolveNodeInvokeErrorMessage(res.error);
            session = applyRuntimeState({
              sessionKey,
              backend,
              nodeId,
              runtime: createUnavailableRuntime(message),
            });
            respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
            return;
          }
          const payload = readHelperSessionPayload(
            res.payloadJSON ? safeParseJson(res.payloadJSON) : res.payload,
          );
          if (!payload) {
            respond(
              false,
              undefined,
              errorShape(ErrorCodes.UNAVAILABLE, "invalid computer session payload"),
            );
            return;
          }
          session = computerSessionManager.setPermissions(sessionKey, payload.permissions);
          session = computerSessionManager.setRuntime(sessionKey, payload.runtime);
          session = computerSessionManager.stop(sessionKey);
        }
        break;
      default:
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid command"));
        return;
    }
    respond(true, { sessionKey, session });
  },

  "computer.session.export": async ({ params, respond }) => {
    const sessionKey = resolveSessionKey(params);
    try {
      const sessionExport = computerSessionManager.exportSession(sessionKey);
      respond(true, { sessionKey, sessionExport });
      return;
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },

  "computer.session.approve": async ({ params, respond }) => {
    const sessionKey = resolveSessionKey(params);
    const requestId = typeof params.requestId === "string" ? params.requestId.trim() : "";
    const decision =
      typeof params.decision === "string" ? params.decision.trim().toLowerCase() : "";
    if (!requestId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "requestId required"));
      return;
    }
    if (decision !== "allow-once" && decision !== "allow-session" && decision !== "deny") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid decision"));
      return;
    }
    try {
      const session = computerSessionManager.resolveApproval({
        sessionKey,
        requestId,
        decision,
      });
      respond(true, { sessionKey, session });
      return;
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
};
