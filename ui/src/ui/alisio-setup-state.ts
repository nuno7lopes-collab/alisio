import type { AlisioBootstrapState, AlisioBootstrapStep, AlisioHttpBootstrap } from "./types.ts";

type BootstrapLike = Pick<AlisioBootstrapState, "connectionRequired" | "startupState" | "nextStep">;
type StartupBootstrapLike = Pick<
  AlisioHttpBootstrap,
  "connectionRequired" | "startupState" | "nextStep"
>;

export function isPostReadySetupStep(_step: AlisioBootstrapStep | null | undefined): boolean {
  return false;
}

export function alisioBootstrapBlocksChatAccess(bootstrap: BootstrapLike | null | undefined) {
  if (!bootstrap) {
    return false;
  }
  return Boolean(
    bootstrap.connectionRequired ||
    bootstrap.startupState === "signed_out" ||
    bootstrap.startupState === "needs_profile",
  );
}

export function resolveCurrentStartupState(params: {
  bootstrap?: Pick<AlisioBootstrapState, "startupState"> | null;
  startupBootstrap?: Pick<AlisioHttpBootstrap, "startupState"> | null;
}) {
  return params.bootstrap?.startupState ?? params.startupBootstrap?.startupState ?? "signed_out";
}

export function resolveBlockingSetupStep(params: {
  connected: boolean;
  bootstrap: BootstrapLike | null | undefined;
}): AlisioBootstrapStep {
  if (!params.connected || !params.bootstrap) {
    return "account";
  }
  if (
    params.bootstrap.connectionRequired ||
    params.bootstrap.startupState === "signed_out" ||
    params.bootstrap.startupState === "needs_profile"
  ) {
    return "account";
  }
  return "ready";
}

export function resolveDisplayedSetupStep(params: {
  connected: boolean;
  requestedStep: AlisioBootstrapStep | null | undefined;
  bootstrap: BootstrapLike | null | undefined;
  startupBootstrap: StartupBootstrapLike | null | undefined;
}): AlisioBootstrapStep {
  const startupState = resolveCurrentStartupState({
    bootstrap: params.bootstrap,
    startupBootstrap: params.startupBootstrap,
  });
  if (!params.connected) {
    return "account";
  }
  if (startupState === "signed_out" || startupState === "needs_profile") {
    return "account";
  }
  return "ready";
}
