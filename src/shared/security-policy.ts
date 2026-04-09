export type ExecSecurity = "deny" | "allowlist" | "full";
export type ExecAsk = "off" | "on-miss" | "always";

export type SecurityAccessMode = "recommended" | "full-access" | "custom";
export type SecurityAccessProfile = Exclude<SecurityAccessMode, "custom">;

export type ConfigExecDefaults = {
  security: ExecSecurity;
  ask: ExecAsk;
};

export type SecurityExecApprovalsDefaults = {
  security?: string;
  ask?: string;
  askFallback?: string;
  autoAllowSkills?: boolean;
};

export type SecurityExecApprovalsAllowlistEntry = {
  id?: string;
  pattern: string;
  lastUsedAt?: number;
  lastUsedCommand?: string;
  lastResolvedPath?: string;
};

export type SecurityExecApprovalsAgent = SecurityExecApprovalsDefaults & {
  allowlist?: SecurityExecApprovalsAllowlistEntry[];
};

export type SecurityExecApprovalsFile = {
  version?: number;
  socket?: { path?: string; token?: string };
  defaults?: SecurityExecApprovalsDefaults;
  agents?: Record<string, SecurityExecApprovalsAgent>;
};

export type ExecApprovalsResolvedDefaults = {
  security: ExecSecurity;
  ask: ExecAsk;
  askFallback: ExecSecurity;
  autoAllowSkills: boolean;
};

export type SecurityAccessDiagnostics = {
  mode: SecurityAccessMode;
  effectivePromptAsk: ExecAsk;
  configDefaults: ConfigExecDefaults;
  approvalDefaults: ExecApprovalsResolvedDefaults;
  configOverrideAgentCount: number;
  approvalOverrideAgentCount: number;
};

export const DEFAULT_GATEWAY_EXEC_SECURITY: ExecSecurity = "allowlist";
export const DEFAULT_GATEWAY_EXEC_ASK: ExecAsk = "on-miss";
export const DEFAULT_EXEC_ASK_FALLBACK: ExecSecurity = "deny";
export const DEFAULT_EXEC_AUTO_ALLOW_SKILLS = false;

export const FULL_ACCESS_CONFIG_DEFAULTS: ConfigExecDefaults = {
  security: "full",
  ask: "off",
};

export const RECOMMENDED_CONFIG_DEFAULTS: ConfigExecDefaults = {
  security: DEFAULT_GATEWAY_EXEC_SECURITY,
  ask: DEFAULT_GATEWAY_EXEC_ASK,
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cloneObject<T>(value: T): T {
  return structuredClone(value);
}

export function normalizeExecApprovalsSecurity(value?: string | null): ExecSecurity {
  if (value === "allowlist" || value === "full" || value === "deny") {
    return value;
  }
  return DEFAULT_GATEWAY_EXEC_SECURITY;
}

export function normalizeExecApprovalsAsk(value?: string | null): ExecAsk {
  if (value === "always" || value === "off" || value === "on-miss") {
    return value;
  }
  return DEFAULT_GATEWAY_EXEC_ASK;
}

export function resolveExecApprovalsDefaults(
  form: SecurityExecApprovalsFile | null,
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
): SecurityAccessMode {
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

function normalizeConfiguredSecurity(value: unknown): ExecSecurity {
  return typeof value === "string"
    ? normalizeExecApprovalsSecurity(value)
    : RECOMMENDED_CONFIG_DEFAULTS.security;
}

function normalizeConfiguredAsk(value: unknown): ExecAsk {
  return typeof value === "string"
    ? normalizeExecApprovalsAsk(value)
    : RECOMMENDED_CONFIG_DEFAULTS.ask;
}

function resolveConfigAgentEntries(
  configForm: Record<string, unknown> | null,
): Record<string, unknown>[] {
  const agents = isRecord(configForm?.agents) ? configForm.agents : null;
  const list = Array.isArray(agents?.list) ? agents.list : [];
  return list.filter(isRecord);
}

function resolveAgentExecConfig(entry: Record<string, unknown>): Record<string, unknown> | null {
  const tools = isRecord(entry.tools) ? entry.tools : null;
  return isRecord(tools?.exec) ? tools.exec : null;
}

export function countConfiguredExecScopedOverrides(
  configForm: Record<string, unknown> | null,
): number {
  return resolveConfigAgentEntries(configForm).reduce((count, entry) => {
    const exec = resolveAgentExecConfig(entry);
    return exec && (hasOwn(exec, "security") || hasOwn(exec, "ask")) ? count + 1 : count;
  }, 0);
}

export function countExecApprovalScopedOverrides(form: SecurityExecApprovalsFile | null): number {
  const agents = isRecord(form?.agents) ? form.agents : null;
  return Object.values(agents ?? {}).reduce((count, agent) => {
    if (
      isRecord(agent) &&
      (hasOwn(agent, "security") ||
        hasOwn(agent, "ask") ||
        hasOwn(agent, "askFallback") ||
        hasOwn(agent, "autoAllowSkills"))
    ) {
      return count + 1;
    }
    return count;
  }, 0);
}

export function resolveConfiguredExecDefaults(
  configForm: Record<string, unknown> | null,
): ConfigExecDefaults {
  const tools = isRecord(configForm?.tools) ? configForm.tools : null;
  const exec = isRecord(tools?.exec) ? tools.exec : null;
  return {
    security: normalizeConfiguredSecurity(exec?.security),
    ask: normalizeConfiguredAsk(exec?.ask),
  };
}

export function resolveSecurityAccessDiagnostics(params: {
  configForm: Record<string, unknown> | null;
  execApprovalsForm: SecurityExecApprovalsFile | null;
}): SecurityAccessDiagnostics {
  const configDefaults = resolveConfiguredExecDefaults(params.configForm);
  const approvalDefaults = resolveExecApprovalsDefaults(params.execApprovalsForm);
  const policyMode = resolveExecApprovalAccessMode(approvalDefaults);
  const configOverrideAgentCount = countConfiguredExecScopedOverrides(params.configForm);
  const approvalOverrideAgentCount = countExecApprovalScopedOverrides(params.execApprovalsForm);
  const hasConfigOverrides = configOverrideAgentCount > 0;
  const hasApprovalOverrides = approvalOverrideAgentCount > 0;
  let mode: SecurityAccessMode = "custom";

  if (
    !hasConfigOverrides &&
    !hasApprovalOverrides &&
    configDefaults.security === RECOMMENDED_CONFIG_DEFAULTS.security &&
    configDefaults.ask === RECOMMENDED_CONFIG_DEFAULTS.ask &&
    policyMode === "recommended"
  ) {
    mode = "recommended";
  } else if (
    !hasConfigOverrides &&
    !hasApprovalOverrides &&
    configDefaults.security === FULL_ACCESS_CONFIG_DEFAULTS.security &&
    configDefaults.ask === FULL_ACCESS_CONFIG_DEFAULTS.ask &&
    policyMode === "full-access"
  ) {
    mode = "full-access";
  }

  return {
    mode,
    effectivePromptAsk: resolveEffectiveExecAsk(configDefaults.ask, approvalDefaults.ask),
    configDefaults,
    approvalDefaults,
    configOverrideAgentCount,
    approvalOverrideAgentCount,
  };
}

export function resolveSecurityAccessMode(params: {
  configForm: Record<string, unknown> | null;
  execApprovalsForm: SecurityExecApprovalsFile | null;
}): SecurityAccessMode {
  return resolveSecurityAccessDiagnostics(params).mode;
}

function resolveAccessModePatch(mode: SecurityAccessProfile): {
  configPatch: ConfigExecDefaults;
  approvalDefaults: ExecApprovalsResolvedDefaults;
} {
  if (mode === "full-access") {
    return {
      configPatch: FULL_ACCESS_CONFIG_DEFAULTS,
      approvalDefaults: EXEC_APPROVALS_FULL_ACCESS_DEFAULTS,
    };
  }
  return {
    configPatch: RECOMMENDED_CONFIG_DEFAULTS,
    approvalDefaults: EXEC_APPROVALS_RECOMMENDED_DEFAULTS,
  };
}

export function buildSecurityAccessModeConfigPatch(
  configForm: Record<string, unknown> | null,
  mode: SecurityAccessProfile,
): Record<string, unknown> {
  const { configPatch } = resolveAccessModePatch(mode);
  const agentPatches: Array<{ id: string; tools: Record<string, unknown> | null }> = [];
  for (const entry of resolveConfigAgentEntries(configForm)) {
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!id) {
      continue;
    }
    const tools = isRecord(entry.tools) ? entry.tools : null;
    const exec = isRecord(tools?.exec) ? tools.exec : null;
    if (!exec) {
      continue;
    }
    const hasSecurityOverride = hasOwn(exec, "security");
    const hasAskOverride = hasOwn(exec, "ask");
    if (!hasSecurityOverride && !hasAskOverride) {
      continue;
    }

    const remainingExecKeys = Object.keys(exec).filter(
      (key) => key !== "security" && key !== "ask",
    );
    const remainingToolKeys = Object.keys(tools ?? {}).filter((key) => key !== "exec");
    if (remainingExecKeys.length === 0) {
      if (remainingToolKeys.length === 0) {
        agentPatches.push({ id, tools: null });
        continue;
      }
      agentPatches.push({ id, tools: { exec: null } });
      continue;
    }

    const execPatch: Record<string, unknown> = {};
    if (hasSecurityOverride) {
      execPatch.security = null;
    }
    if (hasAskOverride) {
      execPatch.ask = null;
    }
    agentPatches.push({ id, tools: { exec: execPatch } });
  }

  const patch: Record<string, unknown> = { tools: { exec: configPatch } };
  if (agentPatches.length > 0) {
    patch.agents = { list: agentPatches };
  }
  return patch;
}

export function applySecurityAccessModeToConfigFormObject(
  configForm: Record<string, unknown> | null,
  mode: SecurityAccessProfile,
): Record<string, unknown> {
  const { configPatch } = resolveAccessModePatch(mode);
  const next = cloneObject(configForm ?? {});
  const tools = isRecord(next.tools)
    ? next.tools
    : ((next.tools = {}), next.tools as Record<string, unknown>);
  const exec = isRecord(tools.exec) ? tools.exec : {};
  exec.security = configPatch.security;
  exec.ask = configPatch.ask;
  tools.exec = exec;

  const agents = isRecord(next.agents) ? next.agents : null;
  const list = Array.isArray(agents?.list) ? agents.list : null;
  if (!list) {
    return next;
  }
  for (const entry of list) {
    if (!isRecord(entry)) {
      continue;
    }
    const entryTools = isRecord(entry.tools) ? entry.tools : null;
    const entryExec = isRecord(entryTools?.exec) ? entryTools.exec : null;
    if (!entryExec) {
      continue;
    }
    delete entryExec.security;
    delete entryExec.ask;
    if (Object.keys(entryExec).length === 0 && entryTools) {
      delete entryTools.exec;
    }
    if (entryTools && Object.keys(entryTools).length === 0) {
      delete entry.tools;
    }
  }
  return next;
}

export function applySecurityAccessModeToExecApprovalsFile(
  file: SecurityExecApprovalsFile | null,
  mode: SecurityAccessProfile,
): SecurityExecApprovalsFile {
  const { approvalDefaults } = resolveAccessModePatch(mode);
  const nextFile = cloneObject(file ?? {});
  const defaults = isRecord(nextFile.defaults) ? nextFile.defaults : {};
  defaults.security = approvalDefaults.security;
  defaults.ask = approvalDefaults.ask;
  defaults.askFallback = approvalDefaults.askFallback;
  defaults.autoAllowSkills = approvalDefaults.autoAllowSkills;
  nextFile.defaults = defaults;

  const agents = isRecord(nextFile.agents) ? nextFile.agents : null;
  if (!agents) {
    return nextFile;
  }
  const nextAgents: Record<string, unknown> = {};
  for (const [key, rawAgent] of Object.entries(agents)) {
    if (!isRecord(rawAgent)) {
      continue;
    }
    delete rawAgent.security;
    delete rawAgent.ask;
    delete rawAgent.askFallback;
    delete rawAgent.autoAllowSkills;
    if (Array.isArray(rawAgent.allowlist) && rawAgent.allowlist.length === 0) {
      delete rawAgent.allowlist;
    }
    if (Object.keys(rawAgent).length === 0) {
      continue;
    }
    nextAgents[key] = rawAgent;
  }
  if (Object.keys(nextAgents).length > 0) {
    nextFile.agents = nextAgents as SecurityExecApprovalsFile["agents"];
  } else {
    delete nextFile.agents;
  }
  return nextFile;
}

export function matchesSecurityAccessModeTargets(params: {
  config: Record<string, unknown> | null;
  execApprovals: SecurityExecApprovalsFile | null;
  mode: SecurityAccessProfile;
}): boolean {
  const { configPatch, approvalDefaults } = resolveAccessModePatch(params.mode);
  const configDefaults = resolveConfiguredExecDefaults(params.config);
  const resolvedApprovals = resolveExecApprovalsDefaults(params.execApprovals);
  return (
    countConfiguredExecScopedOverrides(params.config) === 0 &&
    countExecApprovalScopedOverrides(params.execApprovals) === 0 &&
    configDefaults.security === configPatch.security &&
    configDefaults.ask === configPatch.ask &&
    resolvedApprovals.security === approvalDefaults.security &&
    resolvedApprovals.ask === approvalDefaults.ask &&
    resolvedApprovals.askFallback === approvalDefaults.askFallback &&
    resolvedApprovals.autoAllowSkills === approvalDefaults.autoAllowSkills
  );
}
