import { computerSessionManager } from "../../computer/session-manager.js";
import type { ComputerApprovalMode, ComputerPermissionState } from "../../computer/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function resolveSessionKey(params: Record<string, unknown>): string {
  const raw = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
  return raw || "main";
}

function resolveApprovalMode(value: unknown): ComputerApprovalMode | null {
  if (value === "observe-only" || value === "control-approved-apps" || value === "elevated-watch") {
    return value;
  }
  return null;
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

export const computerHandlers: GatewayRequestHandlers = {
  "computer.session.get": async ({ params, respond }) => {
    const sessionKey = resolveSessionKey(params);
    respond(true, {
      sessionKey,
      session: computerSessionManager.getSession(sessionKey),
    });
  },

  "computer.session.update": async ({ params, respond }) => {
    const sessionKey = resolveSessionKey(params);
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
    let session =
      computerSessionManager.getSession(sessionKey) ??
      computerSessionManager.ensureSession({
        sessionKey,
        ...(mode ? { mode } : {}),
      });
    if (mode) {
      session = computerSessionManager.setMode(sessionKey, mode);
    }
    if (permissions) {
      session = computerSessionManager.setPermissions(sessionKey, permissions);
    }
    switch (command) {
      case "":
        break;
      case "pause":
        session = computerSessionManager.pause(sessionKey);
        break;
      case "resume":
        session = computerSessionManager.resume(sessionKey);
        break;
      case "stop":
        session = computerSessionManager.stop(sessionKey);
        break;
      default:
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid command"));
        return;
    }
    respond(true, { sessionKey, session });
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
