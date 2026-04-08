import { resolveExecApprovalInitiatingSurfaceState } from "./exec-approval-surface.js";

export function hasApprovalTurnSourceRoute(params: {
  turnSourceChannel?: string | null;
  turnSourceAccountId?: string | null;
}): boolean {
  if (!params.turnSourceChannel?.trim()) {
    return false;
  }
  try {
    return (
      resolveExecApprovalInitiatingSurfaceState({
        channel: params.turnSourceChannel,
        accountId: params.turnSourceAccountId,
      }).kind === "enabled"
    );
  } catch {
    // Approval routing is a best-effort hint. Fail closed instead of letting a
    // broken config snapshot or channel adapter abort the whole approval flow.
    return false;
  }
}
