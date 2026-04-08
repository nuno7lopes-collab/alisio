import type { ExecApprovalsFile } from "./exec-approvals.ts";

export type ExecSecurity = "deny" | "allowlist" | "full";
export type ExecAsk = "off" | "on-miss" | "always";

export type ExecApprovalsResolvedDefaults = {
  security: ExecSecurity;
  ask: ExecAsk;
  askFallback: ExecSecurity;
  autoAllowSkills: boolean;
};

export type ExecApprovalAccessMode = "recommended" | "full-access" | "custom";

export const DEFAULT_GATEWAY_EXEC_SECURITY: ExecSecurity = "allowlist";
export const DEFAULT_GATEWAY_EXEC_ASK: ExecAsk = "on-miss";
export const DEFAULT_EXEC_ASK_FALLBACK: ExecSecurity = "deny";
export const DEFAULT_EXEC_AUTO_ALLOW_SKILLS = false;

export const EXEC_APPROVALS_RECOMMENDED_DEFAULTS: ExecApprovalsResolvedDefaults = {
  security: DEFAULT_GATEWAY_EXEC_SECURITY,
  ask: DEFAULT_GATEWAY_EXEC_ASK,
  askFallback: DEFAULT_EXEC_ASK_FALLBACK,
  autoAllowSkills: DEFAULT_EXEC_AUTO_ALLOW_SKILLS,
};

export const EXEC_APPROVALS_FULL_ACCESS_DEFAULTS: ExecApprovalsResolvedDefaults = {
  security: "full",
  ask: "off",
  askFallback: "full",
  autoAllowSkills: DEFAULT_EXEC_AUTO_ALLOW_SKILLS,
};

export function normalizeExecApprovalsSecurity(value?: string): ExecSecurity {
  if (value === "allowlist" || value === "full" || value === "deny") {
    return value;
  }
  return DEFAULT_GATEWAY_EXEC_SECURITY;
}

export function normalizeExecApprovalsAsk(value?: string): ExecAsk {
  if (value === "always" || value === "off" || value === "on-miss") {
    return value;
  }
  return DEFAULT_GATEWAY_EXEC_ASK;
}

export function resolveExecApprovalsDefaults(
  form: ExecApprovalsFile | null,
): ExecApprovalsResolvedDefaults {
  const defaults = form?.defaults ?? {};
  return {
    security: normalizeExecApprovalsSecurity(defaults.security),
    ask: normalizeExecApprovalsAsk(defaults.ask),
    askFallback: normalizeExecApprovalsSecurity(defaults.askFallback ?? DEFAULT_EXEC_ASK_FALLBACK),
    autoAllowSkills: Boolean(defaults.autoAllowSkills ?? DEFAULT_EXEC_AUTO_ALLOW_SKILLS),
  };
}

export function resolveExecApprovalAccessMode(
  defaults: ExecApprovalsResolvedDefaults,
): ExecApprovalAccessMode {
  if (
    defaults.security === EXEC_APPROVALS_RECOMMENDED_DEFAULTS.security &&
    defaults.ask === EXEC_APPROVALS_RECOMMENDED_DEFAULTS.ask &&
    defaults.askFallback === EXEC_APPROVALS_RECOMMENDED_DEFAULTS.askFallback &&
    defaults.autoAllowSkills === EXEC_APPROVALS_RECOMMENDED_DEFAULTS.autoAllowSkills
  ) {
    return "recommended";
  }
  if (
    defaults.security === EXEC_APPROVALS_FULL_ACCESS_DEFAULTS.security &&
    defaults.ask === EXEC_APPROVALS_FULL_ACCESS_DEFAULTS.ask &&
    defaults.askFallback === EXEC_APPROVALS_FULL_ACCESS_DEFAULTS.askFallback
  ) {
    return "full-access";
  }
  return "custom";
}

// Keep this aligned with the runtime host-ask merge logic.
export function resolveEffectiveExecAsk(toolAsk: ExecAsk, approvalsAsk: ExecAsk): ExecAsk {
  if (approvalsAsk === "off") {
    return "off";
  }
  const order: Record<ExecAsk, number> = { off: 0, "on-miss": 1, always: 2 };
  return order[toolAsk] >= order[approvalsAsk] ? toolAsk : approvalsAsk;
}
