import type {
  AlisioSecurityPolicyApplyProfileResult,
  AlisioSecurityPolicySnapshot,
} from "../../../../src/gateway/protocol/index.ts";
import {
  applySecurityAccessModeToConfigFormObject,
  applySecurityAccessModeToExecApprovalsFile,
  type ConfigExecDefaults,
  FULL_ACCESS_CONFIG_DEFAULTS,
  type SecurityAccessDiagnostics,
  type SecurityAccessMode,
  RECOMMENDED_CONFIG_DEFAULTS,
  resolveConfiguredExecDefaults,
  resolveSecurityAccessDiagnostics,
  resolveSecurityAccessMode,
} from "../../../../src/shared/security-policy.ts";
import type { ConfigSnapshot } from "../types.ts";
import type { ConfigState } from "./config.ts";
import { loadConfig } from "./config.ts";
import { serializeConfigForm } from "./config/form-utils.ts";
import {
  addExecApproval,
  addExecApprovalAuditEntry,
  parseApprovalAuditEntry,
  parseExecApprovalRequested,
  parsePluginApprovalRequested,
  type ExecApprovalAuditEntry,
  type ExecApprovalRequest,
} from "./exec-approval.ts";
import type {
  ExecApprovalsFile,
  ExecApprovalsSnapshot,
  ExecApprovalsState,
} from "./exec-approvals.ts";
import { loadExecApprovals } from "./exec-approvals.ts";

export {
  type ConfigExecDefaults,
  FULL_ACCESS_CONFIG_DEFAULTS,
  type SecurityAccessDiagnostics,
  type SecurityAccessMode,
  RECOMMENDED_CONFIG_DEFAULTS,
  resolveConfiguredExecDefaults,
  resolveSecurityAccessDiagnostics,
  resolveSecurityAccessMode,
};

export type GatewayAccessModeState = {
  client: ConfigState["client"];
  connected: boolean;
  configSnapshot: ConfigSnapshot | null;
  configForm: Record<string, unknown> | null;
  configFormDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: ExecApprovalsFile | null;
  execApprovalsDirty: boolean;
  execApprovalsTarget?: "gateway" | "node";
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalAuditTrail: ExecApprovalAuditEntry[];
  securityAccessDiagnostics: SecurityAccessDiagnostics | null;
  lastError: string | null;
  gatewayAccessModeLoading: boolean;
  gatewayAccessModeBusy: boolean;
  gatewayAccessMode: SecurityAccessMode | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function applySecurityPolicySnapshot(
  state: GatewayAccessModeState,
  snapshot: AlisioSecurityPolicySnapshot,
) {
  state.gatewayAccessMode = snapshot.diagnostics.mode;
  state.securityAccessDiagnostics = snapshot.diagnostics;

  let nextQueue: ExecApprovalRequest[] = [];
  for (const item of snapshot.pending.items) {
    if (!isRecord(item)) {
      continue;
    }
    const parsed =
      item.kind === "plugin"
        ? parsePluginApprovalRequested(item)
        : item.kind === "exec"
          ? parseExecApprovalRequested(item)
          : null;
    if (!parsed) {
      continue;
    }
    nextQueue = addExecApproval(nextQueue, parsed);
  }
  state.execApprovalQueue = nextQueue;

  let nextAudit: ExecApprovalAuditEntry[] = [];
  for (const item of snapshot.audit.items) {
    if (!isRecord(item)) {
      continue;
    }
    const kind = item.kind === "plugin" ? "plugin" : item.kind === "exec" ? "exec" : null;
    if (!kind) {
      continue;
    }
    const parsed = parseApprovalAuditEntry(kind, item);
    if (!parsed) {
      continue;
    }
    nextAudit = addExecApprovalAuditEntry(nextAudit, parsed, 20);
  }
  state.execApprovalAuditTrail = nextAudit;
}

export async function loadGatewayAccessMode(state: GatewayAccessModeState) {
  if (!state.client || !state.connected || state.gatewayAccessModeLoading) {
    return;
  }
  state.gatewayAccessModeLoading = true;
  state.lastError = null;
  try {
    const snapshot = await state.client.request<AlisioSecurityPolicySnapshot>(
      "alisio.security.policy.get",
      {},
    );
    applySecurityPolicySnapshot(state, snapshot);
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.gatewayAccessModeLoading = false;
  }
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
    const result = await state.client.request<AlisioSecurityPolicyApplyProfileResult>(
      "alisio.security.policy.applyProfile",
      { profile: mode },
    );
    applySecurityPolicySnapshot(state, result.snapshot);

    if (result.changed) {
      await loadConfig(state);
      if (state.execApprovalsTarget === "gateway") {
        await loadExecApprovals(state, { kind: "gateway" });
      }
    }

    if (state.configFormDirty && state.configForm) {
      const nextConfigForm = applySecurityAccessModeToConfigFormObject(state.configForm, mode);
      state.configForm = nextConfigForm;
      if (state.configFormMode === "form") {
        state.configRaw = serializeConfigForm(nextConfigForm);
      }
    }

    if (
      state.execApprovalsTarget === "gateway" &&
      state.execApprovalsDirty &&
      state.execApprovalsForm
    ) {
      state.execApprovalsForm = applySecurityAccessModeToExecApprovalsFile(
        state.execApprovalsForm,
        mode,
      ) as ExecApprovalsFile;
    }

    state.gatewayAccessMode = mode;
    state.securityAccessDiagnostics = result.snapshot.diagnostics;
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.gatewayAccessModeBusy = false;
  }
}
