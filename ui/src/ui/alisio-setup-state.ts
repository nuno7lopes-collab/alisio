import type { AlisioBootstrapState, AlisioBootstrapStep, AlisioHttpBootstrap } from "./types.ts";

type BootstrapLike = Pick<AlisioBootstrapState, "connectionRequired" | "startupState" | "nextStep">;
type StartupBootstrapLike = Pick<
  AlisioHttpBootstrap,
  "connectionRequired" | "startupState" | "nextStep"
>;

function normalizeSetupStep(value: string | null | undefined): AlisioBootstrapStep | null {
  switch ((value ?? "").trim()) {
    case "gateway":
    case "runtime":
    case "account":
    case "organization":
    case "connectors":
    case "permissions":
    case "ready":
      return value as AlisioBootstrapStep;
    default:
      return null;
  }
}

export function isPostReadySetupStep(step: AlisioBootstrapStep | null | undefined): boolean {
  return step === "organization" || step === "connectors" || step === "permissions";
}

export function alisioBootstrapBlocksChatAccess(bootstrap: BootstrapLike | null | undefined) {
  if (!bootstrap) {
    return false;
  }
  return Boolean(bootstrap.connectionRequired || bootstrap.startupState !== "ready");
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
  if (!params.connected) {
    return "gateway";
  }
  if (!params.bootstrap) {
    return "gateway";
  }
  if (
    params.bootstrap.connectionRequired ||
    params.bootstrap.startupState === "signed_out" ||
    params.bootstrap.startupState === "needs_profile"
  ) {
    return "account";
  }
  if (params.bootstrap.startupState === "needs_ai") {
    return "runtime";
  }
  const nextStep = normalizeSetupStep(params.bootstrap.nextStep);
  return nextStep && nextStep !== "ready" ? nextStep : "runtime";
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
  if (startupState === "signed_out" || startupState === "needs_profile") {
    return "account";
  }
  if (startupState === "needs_ai") {
    return params.connected ? "runtime" : "gateway";
  }
  if (!params.connected) {
    return "gateway";
  }
  if (startupState === "ready") {
    return "ready";
  }
  const requestedStep = normalizeSetupStep(params.requestedStep);
  const bootstrapStep = normalizeSetupStep(
    params.bootstrap?.nextStep ?? params.startupBootstrap?.nextStep,
  );
  if (requestedStep && requestedStep !== "ready") {
    return requestedStep;
  }
  if (bootstrapStep && bootstrapStep !== "ready") {
    return bootstrapStep;
  }
  return "ready";
}
