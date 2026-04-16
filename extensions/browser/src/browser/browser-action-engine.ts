import type {
  BrowserActionExecutionSummary,
  BrowserActionRecoveryCode,
} from "./browser-action.types.js";
import { BrowserSessionLeaseConflictError } from "./browser-session-lease.js";
import type { BrowserSessionSupervisor } from "./browser-session.types.js";

export function classifyBrowserActionRecoveryCode(err: unknown): BrowserActionRecoveryCode {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (message.includes("already controlled by")) {
    return "lease-conflict";
  }
  if (message.includes("frame has been detached")) {
    return "detached-frame";
  }
  if (message.includes("execution context was destroyed") || message.includes("navigation")) {
    return "navigation-swap";
  }
  if (
    message.includes("aria-ref=") ||
    message.includes("waiting for locator") ||
    message.includes("strict mode violation") ||
    message.includes("unknown ref")
  ) {
    return "stale-dom";
  }
  if (
    message.includes("another element would receive the click") ||
    message.includes("intercepts pointer events") ||
    message.includes("element is outside of the viewport")
  ) {
    return "overlay";
  }
  if (message.includes("closed the connection") || message.includes("session closed")) {
    return "browser-disconnect";
  }
  if (
    message.includes("browser has been closed") ||
    message.includes("target page, context or browser has been closed")
  ) {
    return "browser-crash";
  }
  return "corrupted-state";
}

export function browserActionRequiresLease(kind: string): boolean {
  return kind !== "wait";
}

export type ManagedBrowserActionExecutionParams<T> = {
  supervisor: BrowserSessionSupervisor;
  sessionKey?: string;
  owner?: string;
  kind: string;
  targetId?: string | null;
  execute: (reportExecution: (summary: BrowserActionExecutionSummary) => void) => Promise<T>;
};

export async function executeManagedBrowserAction<T>(
  params: ManagedBrowserActionExecutionParams<T>,
): Promise<{ result: T; action: BrowserActionExecutionSummary | null }> {
  const sessionKey = params.sessionKey?.trim();
  const owner = params.owner?.trim();
  if (sessionKey && owner && browserActionRequiresLease(params.kind)) {
    params.supervisor.ensureSessionLease({
      sessionKey,
      owner,
    });
  }

  let summary: BrowserActionExecutionSummary | null = null;
  const reportExecution = (nextSummary: BrowserActionExecutionSummary) => {
    summary = { ...nextSummary };
  };

  try {
    const result = await params.execute(reportExecution);
    if (!summary) {
      summary = { layer: "semantic" };
    }
    if (sessionKey && summary) {
      params.supervisor.recordSessionAction({
        sessionKey,
        kind: params.kind,
        layer: summary.layer,
        targetId: params.targetId ?? null,
        recovered: summary.recovered === true,
        recoveryCode: summary.recoveryCode ?? null,
        reusedAuth: summary.reusedAuth === true,
        blindFilled: summary.blindFilled === true,
      });
      if (summary.recovered && summary.recoveryCode) {
        params.supervisor.recordSessionRecovery({
          sessionKey,
          code: summary.recoveryCode,
          targetId: params.targetId ?? null,
          recovered: true,
        });
      }
    }
    return { result, action: summary };
  } catch (err) {
    if (sessionKey) {
      params.supervisor.recordSessionRecovery({
        sessionKey,
        code:
          err instanceof BrowserSessionLeaseConflictError
            ? "lease-conflict"
            : classifyBrowserActionRecoveryCode(err),
        targetId: params.targetId ?? null,
        recovered: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}
