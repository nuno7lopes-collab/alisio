import type { ExecApprovalDecision } from "../../infra/exec-approvals.js";
import type { ExecApprovalManager, ExecApprovalRecord } from "../exec-approval-manager.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { RespondFn } from "./types.js";

export const APPROVAL_NOT_FOUND_DETAILS = {
  reason: ErrorCodes.APPROVAL_NOT_FOUND,
} as const;

export function parseApprovalId(params: { id?: string }, respond: RespondFn): string | null {
  const id = typeof params.id === "string" ? params.id.trim() : "";
  if (!id) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
    return null;
  }
  return id;
}

export function parseApprovalDecision(
  rawDecision: string,
  respond: RespondFn,
): ExecApprovalDecision | null {
  const decision = rawDecision as ExecApprovalDecision;
  if (decision !== "allow-once" && decision !== "allow-always" && decision !== "deny") {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid decision"));
    return null;
  }
  return decision;
}

export async function waitForApprovalDecision(
  manager: ExecApprovalManager<unknown>,
  id: string,
  respond: RespondFn,
): Promise<void> {
  const decisionPromise = manager.awaitDecision(id);
  if (!decisionPromise) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "approval expired or not found"),
    );
    return;
  }
  const snapshot = manager.getSnapshot(id);
  const decision = await decisionPromise;
  respond(
    true,
    {
      id,
      decision,
      createdAtMs: snapshot?.createdAtMs,
      expiresAtMs: snapshot?.expiresAtMs,
    },
    undefined,
  );
}

export function resolvePendingApprovalIdOrRespond(
  manager: ExecApprovalManager<unknown>,
  id: string,
  respond: RespondFn,
  opts?: {
    onAmbiguous?: (ids: string[], respond: RespondFn) => void;
  },
): string | null {
  const resolvedId = manager.lookupPendingId(id);
  if (resolvedId.kind === "none") {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id", {
        details: APPROVAL_NOT_FOUND_DETAILS,
      }),
    );
    return null;
  }
  if (resolvedId.kind === "ambiguous") {
    if (opts?.onAmbiguous) {
      opts.onAmbiguous(resolvedId.ids, respond);
      return null;
    }
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id", {
        details: APPROVAL_NOT_FOUND_DETAILS,
      }),
    );
    return null;
  }
  return resolvedId.id;
}

export function getPendingApprovalSnapshotOrRespond<TRequest>(
  manager: ExecApprovalManager<TRequest>,
  approvalId: string,
  respond: RespondFn,
  opts?: { requireUnresolved?: boolean },
): ExecApprovalRecord<TRequest> | null {
  const snapshot = manager.getSnapshot(approvalId);
  if (!snapshot) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id", {
        details: APPROVAL_NOT_FOUND_DETAILS,
      }),
    );
    return null;
  }
  if (opts?.requireUnresolved && snapshot.resolvedAtMs !== undefined) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "unknown or expired approval id", {
        details: APPROVAL_NOT_FOUND_DETAILS,
      }),
    );
    return null;
  }
  return snapshot;
}
