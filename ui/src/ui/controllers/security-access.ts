import type { ConfigSnapshot } from "../types.ts";
import type { ConfigState } from "./config.ts";
import { loadConfig } from "./config.ts";
import { cloneConfigObject, serializeConfigForm } from "./config/form-utils.ts";
import {
  type ExecApprovalAccessMode,
  type ExecApprovalsResolvedDefaults,
  type ExecAsk,
  type ExecSecurity,
  EXEC_APPROVALS_FULL_ACCESS_DEFAULTS,
  EXEC_APPROVALS_RECOMMENDED_DEFAULTS,
  resolveExecApprovalAccessMode,
  resolveExecApprovalsDefaults,
} from "./exec-approvals-policy.ts";
import type {
  ExecApprovalsFile,
  ExecApprovalsSnapshot,
  ExecApprovalsState,
} from "./exec-approvals.ts";
import { applyExecApprovalsSnapshot, loadExecApprovals } from "./exec-approvals.ts";

export type ConfigExecDefaults = {
  security: ExecSecurity;
  ask: ExecAsk;
};

export type SecurityAccessMode = ExecApprovalAccessMode;

export const FULL_ACCESS_CONFIG_DEFAULTS: ConfigExecDefaults = {
  security: "full",
  ask: "off",
};

export const RECOMMENDED_CONFIG_DEFAULTS: ConfigExecDefaults = {
  security: EXEC_APPROVALS_RECOMMENDED_DEFAULTS.security,
  ask: EXEC_APPROVALS_RECOMMENDED_DEFAULTS.ask,
};

export type GatewayAccessModeState = {
  client: ConfigState["client"];
  connected: boolean;
  configSnapshot: ConfigSnapshot | null;
  configForm: Record<string, unknown> | null;
  configFormDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: import("./exec-approvals.ts").ExecApprovalsFile | null;
  execApprovalsDirty: boolean;
  execApprovalsTarget?: "gateway" | "node";
  lastError: string | null;
  gatewayAccessModeLoading: boolean;
  gatewayAccessModeBusy: boolean;
  gatewayAccessMode: SecurityAccessMode | null;
};

function normalizeSecurity(value: unknown): ExecSecurity {
  return value === "deny" || value === "allowlist" || value === "full"
    ? value
    : RECOMMENDED_CONFIG_DEFAULTS.security;
}

function normalizeAsk(value: unknown): ExecAsk {
  return value === "off" || value === "always" || value === "on-miss"
    ? value
    : RECOMMENDED_CONFIG_DEFAULTS.ask;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
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

function hasConfiguredExecScopedOverrides(configForm: Record<string, unknown> | null): boolean {
  return resolveConfigAgentEntries(configForm).some((entry) => {
    const exec = resolveAgentExecConfig(entry);
    return exec ? hasOwn(exec, "security") || hasOwn(exec, "ask") : false;
  });
}

function hasExecApprovalScopedOverrides(form: ExecApprovalsFile | null): boolean {
  const agents = isRecord(form?.agents) ? form.agents : null;
  return Object.values(agents ?? {}).some(
    (agent) =>
      isRecord(agent) &&
      (hasOwn(agent, "security") ||
        hasOwn(agent, "ask") ||
        hasOwn(agent, "askFallback") ||
        hasOwn(agent, "autoAllowSkills")),
  );
}

function buildGatewayAccessModeConfigPatch(
  configForm: Record<string, unknown> | null,
  mode: Exclude<SecurityAccessMode, "custom">,
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

function applyAccessModeToConfigFormObject(
  configForm: Record<string, unknown> | null,
  mode: Exclude<SecurityAccessMode, "custom">,
): Record<string, unknown> {
  const { configPatch } = resolveAccessModePatch(mode);
  const next = cloneConfigObject(configForm ?? {});
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

function applyAccessModeToExecApprovalsFile(
  file: ExecApprovalsFile | null,
  mode: Exclude<SecurityAccessMode, "custom">,
): ExecApprovalsFile {
  const { approvalDefaults } = resolveAccessModePatch(mode);
  const nextFile = cloneConfigObject(file ?? {});
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
    nextFile.agents = nextAgents as ExecApprovalsFile["agents"];
  } else {
    delete nextFile.agents;
  }
  return nextFile;
}

export function resolveConfiguredExecDefaults(
  configForm: Record<string, unknown> | null,
): ConfigExecDefaults {
  const tools = isRecord(configForm?.tools) ? configForm.tools : null;
  const exec = isRecord(tools?.exec) ? tools.exec : null;
  return {
    security: normalizeSecurity(exec?.security),
    ask: normalizeAsk(exec?.ask),
  };
}

export function resolveSecurityAccessMode(params: {
  configForm: Record<string, unknown> | null;
  execApprovalsForm: import("./exec-approvals.ts").ExecApprovalsFile | null;
}): SecurityAccessMode {
  const configDefaults = resolveConfiguredExecDefaults(params.configForm);
  const approvalDefaults = resolveExecApprovalsDefaults(params.execApprovalsForm);
  const policyMode = resolveExecApprovalAccessMode(approvalDefaults);
  const hasConfigOverrides = hasConfiguredExecScopedOverrides(params.configForm);
  const hasApprovalOverrides = hasExecApprovalScopedOverrides(params.execApprovalsForm);

  if (
    !hasConfigOverrides &&
    !hasApprovalOverrides &&
    configDefaults.security === RECOMMENDED_CONFIG_DEFAULTS.security &&
    configDefaults.ask === RECOMMENDED_CONFIG_DEFAULTS.ask &&
    policyMode === "recommended"
  ) {
    return "recommended";
  }
  if (
    !hasConfigOverrides &&
    !hasApprovalOverrides &&
    configDefaults.security === FULL_ACCESS_CONFIG_DEFAULTS.security &&
    configDefaults.ask === FULL_ACCESS_CONFIG_DEFAULTS.ask &&
    policyMode === "full-access"
  ) {
    return "full-access";
  }
  return "custom";
}

function syncGatewayAccessMode(
  state: GatewayAccessModeState,
  params: {
    config: Record<string, unknown> | null;
    execApprovals: ExecApprovalsFile | null;
  },
) {
  state.gatewayAccessMode = resolveSecurityAccessMode({
    configForm: params.config,
    execApprovalsForm: params.execApprovals,
  });
}

async function fetchGatewayConfigSnapshot(
  state: GatewayAccessModeState,
): Promise<ConfigSnapshot | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  return await state.client.request<ConfigSnapshot>("config.get", {});
}

async function fetchGatewayExecApprovalsSnapshot(
  state: GatewayAccessModeState,
): Promise<ExecApprovalsSnapshot | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  return await state.client.request<ExecApprovalsSnapshot>("exec.approvals.get", {});
}

export async function loadGatewayAccessMode(state: GatewayAccessModeState) {
  if (!state.client || !state.connected || state.gatewayAccessModeLoading) {
    return;
  }
  state.gatewayAccessModeLoading = true;
  state.lastError = null;
  try {
    const [configSnapshot, approvalsSnapshot] = await Promise.all([
      fetchGatewayConfigSnapshot(state),
      fetchGatewayExecApprovalsSnapshot(state),
    ]);
    if (configSnapshot) {
      state.configSnapshot = configSnapshot;
    }
    syncGatewayAccessMode(state, {
      config: configSnapshot?.config ?? null,
      execApprovals: approvalsSnapshot?.file ?? null,
    });
    if (state.execApprovalsTarget === "gateway" && !state.execApprovalsDirty && approvalsSnapshot) {
      state.execApprovalsSnapshot = approvalsSnapshot;
      state.execApprovalsForm = cloneConfigObject(approvalsSnapshot.file ?? {});
    }
  } finally {
    state.gatewayAccessModeLoading = false;
  }
}

function resolveAccessModePatch(mode: Exclude<SecurityAccessMode, "custom">): {
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

function matchesGatewayAccessModeTargets(params: {
  config: Record<string, unknown> | null;
  execApprovals: ExecApprovalsFile | null;
  mode: Exclude<SecurityAccessMode, "custom">;
}): boolean {
  const { configPatch, approvalDefaults } = resolveAccessModePatch(params.mode);
  const configDefaults = resolveConfiguredExecDefaults(params.config);
  const resolvedApprovals = resolveExecApprovalsDefaults(params.execApprovals);
  return (
    !hasConfiguredExecScopedOverrides(params.config) &&
    !hasExecApprovalScopedOverrides(params.execApprovals) &&
    configDefaults.security === configPatch.security &&
    configDefaults.ask === configPatch.ask &&
    resolvedApprovals.security === approvalDefaults.security &&
    resolvedApprovals.ask === approvalDefaults.ask &&
    resolvedApprovals.askFallback === approvalDefaults.askFallback &&
    resolvedApprovals.autoAllowSkills === approvalDefaults.autoAllowSkills
  );
}

export async function applyGatewayAccessMode(
  state: GatewayAccessModeState & ConfigState & ExecApprovalsState,
  mode: Exclude<SecurityAccessMode, "custom">,
) {
  if (!state.client || !state.connected || state.gatewayAccessModeBusy) {
    return;
  }
  if (state.configFormDirty && state.configFormMode === "raw") {
    state.lastError = "Save or reload the raw config draft before changing the access mode.";
    return;
  }
  if (state.execApprovalsTarget === "gateway" && state.execApprovalsDirty) {
    state.lastError =
      "Save or reload the Alisio exec approvals draft before changing the access mode.";
    return;
  }
  state.gatewayAccessModeBusy = true;
  state.lastError = null;
  try {
    const [configSnapshot, initialApprovalsSnapshot] = await Promise.all([
      fetchGatewayConfigSnapshot(state),
      fetchGatewayExecApprovalsSnapshot(state),
    ]);
    if (!configSnapshot?.hash) {
      state.lastError = "Config hash missing; reload and retry.";
      return;
    }
    if (
      matchesGatewayAccessModeTargets({
        config: configSnapshot.config ?? null,
        execApprovals: initialApprovalsSnapshot?.file ?? null,
        mode,
      })
    ) {
      state.configSnapshot = configSnapshot;
      if (state.execApprovalsTarget === "gateway" && initialApprovalsSnapshot) {
        applyExecApprovalsSnapshot(state, initialApprovalsSnapshot);
      }
      syncGatewayAccessMode(state, {
        config: configSnapshot.config ?? null,
        execApprovals: initialApprovalsSnapshot?.file ?? null,
      });
      state.gatewayAccessMode = mode;
      return;
    }

    await state.client.request("config.patch", {
      raw: JSON.stringify(buildGatewayAccessModeConfigPatch(configSnapshot.config ?? null, mode)),
      baseHash: configSnapshot.hash,
    });
    await loadConfig(state);

    if (state.configFormDirty && state.configForm) {
      const nextConfigForm = applyAccessModeToConfigFormObject(state.configForm, mode);
      state.configForm = nextConfigForm;
      if (state.configFormMode === "form") {
        state.configRaw = serializeConfigForm(nextConfigForm);
      }
    }

    const approvalsSnapshot = await fetchGatewayExecApprovalsSnapshot(state);
    if (!approvalsSnapshot?.hash) {
      state.lastError = "Exec approvals hash missing; reload and retry.";
      return;
    }
    const nextFile = applyAccessModeToExecApprovalsFile(approvalsSnapshot.file ?? null, mode);

    await state.client.request("exec.approvals.set", {
      file: nextFile,
      baseHash: approvalsSnapshot.hash,
    });
    if (state.execApprovalsTarget === "gateway") {
      await loadExecApprovals(state, { kind: "gateway" });
    }
    const [nextConfigSnapshot, nextApprovalsSnapshot] = await Promise.all([
      fetchGatewayConfigSnapshot(state),
      fetchGatewayExecApprovalsSnapshot(state),
    ]);
    if (nextConfigSnapshot) {
      state.configSnapshot = nextConfigSnapshot;
    }
    if (state.execApprovalsTarget === "gateway" && nextApprovalsSnapshot) {
      applyExecApprovalsSnapshot(state, nextApprovalsSnapshot);
    }
    syncGatewayAccessMode(state, {
      config: nextConfigSnapshot?.config ?? null,
      execApprovals: nextApprovalsSnapshot?.file ?? null,
    });
    state.gatewayAccessMode = mode;
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.gatewayAccessModeBusy = false;
  }
}
