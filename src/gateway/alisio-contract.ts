import type {
  AlisioAccountState,
  AlisioBootstrapSnapshot,
  AlisioBootstrapSummary,
} from "../infra/alisio-store.js";
import {
  buildAccountDeviceBinding,
  buildAlisioDataResidencyContract,
  resolveCanonicalAccountScope,
} from "../shared/alisio-account-scope.js";

function resolveCurrentDevice(account: AlisioAccountState) {
  return account.devices.find((device) => device.current) ?? account.devices[0];
}

export function resolveAlisioCanonicalAccountScope(account: AlisioAccountState) {
  return resolveCanonicalAccountScope({
    authenticated: account.session.state === "signed_in",
    userId: account.profile.userId,
    email: account.profile.email,
  });
}

export function canonicalizeAlisioAccountResult(account: AlisioAccountState) {
  const canonical = resolveAlisioCanonicalAccountScope(account);
  const currentDevice = resolveCurrentDevice(account);
  const deviceBinding = buildAccountDeviceBinding({
    authenticated: canonical.authenticated,
    accountId: canonical.accountId,
    deviceId: currentDevice?.id,
    label: currentDevice?.label,
    platform: currentDevice?.platform,
    current: currentDevice?.current ?? true,
  });
  const runtimeContract = buildAlisioDataResidencyContract();

  return {
    ...(canonical.accountId ? { accountId: canonical.accountId } : {}),
    scopeRoot: canonical.scopeRoot,
    canonical,
    profile: {
      ...account.profile,
      ...(canonical.accountId ? { accountId: canonical.accountId } : {}),
    },
    preferences: account.preferences,
    session: {
      ...account.session,
      authRequired: true,
      authenticated: canonical.authenticated,
      ...(canonical.accountId ? { accountId: canonical.accountId } : {}),
    },
    devices: account.devices.map((device) => ({
      ...device,
      runtime: "local" as const,
      binding:
        canonical.authenticated && canonical.accountId
          ? ("account_bound" as const)
          : ("auth_required" as const),
      ...(canonical.accountId ? { accountId: canonical.accountId } : {}),
    })),
    cloud: account.cloud,
    deviceBinding,
    runtimeContract,
  };
}

export function canonicalizeAlisioBootstrapResult(params: {
  summary: AlisioBootstrapSummary;
  snapshot: AlisioBootstrapSnapshot;
  wizard: { running: boolean; sessionId: string | null };
  models: { total: number; defaultProvider: string; providers: string[] };
}) {
  const account = canonicalizeAlisioAccountResult(params.snapshot.account);
  return {
    ...params.summary,
    ...(account.accountId ? { accountId: account.accountId } : {}),
    scopeRoot: account.scopeRoot,
    authRequired: true,
    deviceBinding: account.deviceBinding,
    runtimeContract: account.runtimeContract,
    account,
    ai: params.snapshot.ai,
    organization: params.snapshot.organization,
    connectors: params.snapshot.connectors,
    wizard: params.wizard,
    models: params.models,
  };
}

export function isAlisioAccountAuthenticated(account: AlisioAccountState): boolean {
  return resolveAlisioCanonicalAccountScope(account).authenticated;
}
