import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveAccountScopedAgentWorkspaceDir } from "../agents/workspace.js";
import type { AlisioConfig } from "../config/config.js";
import { getAlisioAccountState, type AlisioAccountState } from "../infra/alisio-store.js";
import {
  buildAccountDeviceBinding,
  buildAlisioDataResidencyContract,
} from "../shared/alisio-account-scope.js";
import { resolveAlisioCanonicalAccountScope } from "./alisio-contract.js";

export const ALISIO_APP_AUTH_REQUIRED_MESSAGE =
  "Alisio account sign-in required before using the app.";

function resolveCurrentDevice(account: AlisioAccountState) {
  return account.devices.find((device) => device.current) ?? account.devices[0];
}

export type AlisioGatewayAccountContext = {
  account: AlisioAccountState;
  canonical: ReturnType<typeof resolveAlisioCanonicalAccountScope>;
  currentDevice: ReturnType<typeof resolveCurrentDevice>;
  deviceBinding: ReturnType<typeof buildAccountDeviceBinding>;
  runtimeContract: ReturnType<typeof buildAlisioDataResidencyContract>;
};

export function buildAlisioGatewayAccountContext(
  account: AlisioAccountState,
): AlisioGatewayAccountContext {
  const canonical = resolveAlisioCanonicalAccountScope(account);
  const currentDevice = resolveCurrentDevice(account);
  return {
    account,
    canonical,
    currentDevice,
    deviceBinding: buildAccountDeviceBinding({
      authenticated: canonical.authenticated,
      accountId: canonical.accountId,
      deviceId: currentDevice?.id,
      label: currentDevice?.label,
      platform: currentDevice?.platform,
      current: currentDevice?.current ?? true,
    }),
    runtimeContract: buildAlisioDataResidencyContract(),
  };
}

export async function loadAlisioGatewayAccountContext(): Promise<AlisioGatewayAccountContext> {
  return buildAlisioGatewayAccountContext(await getAlisioAccountState());
}

export function buildGatewayPersonalContextScope(context: AlisioGatewayAccountContext): {
  accountId: string;
  deviceId?: string;
  deviceLabel?: string;
  devicePlatform?: string;
} {
  if (!context.canonical.accountId) {
    throw new Error("Authenticated app context requires canonical accountId");
  }
  return {
    accountId: context.canonical.accountId,
    ...(context.currentDevice?.id ? { deviceId: context.currentDevice.id } : {}),
    ...(context.currentDevice?.label ? { deviceLabel: context.currentDevice.label } : {}),
    ...(context.currentDevice?.platform ? { devicePlatform: context.currentDevice.platform } : {}),
  };
}

export function resolveAccountScopedWorkspaceForAgent(params: {
  cfg: AlisioConfig;
  agentId: string;
  accountId?: string | null;
}): string {
  return resolveAccountScopedAgentWorkspaceDir(
    resolveAgentWorkspaceDir(params.cfg, params.agentId),
    params.accountId,
  );
}

export function applyAccountScopedWorkspaceOverride(params: {
  cfg: AlisioConfig;
  agentId: string;
  accountId?: string | null;
}): AlisioConfig {
  const scopedWorkspace = resolveAccountScopedWorkspaceForAgent(params);
  const defaultAgentId = resolveDefaultAgentId(params.cfg);
  const nextList = params.cfg.agents?.list?.map((entry) =>
    entry.id === params.agentId ? { ...entry, workspace: scopedWorkspace } : entry,
  );

  return {
    ...params.cfg,
    agents: {
      ...params.cfg.agents,
      ...(params.agentId === defaultAgentId
        ? {
            defaults: {
              ...params.cfg.agents?.defaults,
              workspace: scopedWorkspace,
            },
          }
        : {}),
      ...(nextList ? { list: nextList } : {}),
    },
  };
}
