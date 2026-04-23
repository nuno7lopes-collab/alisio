import { AlisioAccountCloudError } from "../../infra/alisio-account-cloud.js";
import { AlisioAiError } from "../../infra/alisio-ai.js";
import { startAlisioDeveloperRebuild } from "../../infra/alisio-dev-rebuild.js";
import {
  installAlisioLocalModel,
  uninstallAlisioLocalModel,
} from "../../infra/alisio-local-llama-runtime.js";
import {
  clearAlisioModelProviderSnapshotCache,
  loadAlisioModelProviderSnapshot,
} from "../../infra/alisio-model-snapshot.js";
import { loadAlisioProviderOverview } from "../../infra/alisio-provider-overview.js";
import { loadAlisioRuntimeSetupStateWithTimeout } from "../../infra/alisio-runtime.js";
import {
  beginAlisioAccountEmailAuth,
  completeAlisioAccountEmailLinkAuth,
  completeAlisioAccountGoogleAuthFromCallback,
  beginAlisioAccountGoogleAuth,
  AlisioAccountValidationError,
  beginAlisioConnectorSetup,
  beginAlisioAiConnect,
  changeAlisioAccountEmail,
  completeAlisioAiConnect,
  disconnectAlisioAi,
  getAlisioDoctorSummary,
  getAlisioAccountState,
  getAlisioAiState,
  getAlisioOrganizationState,
  listAlisioConnectorAuthorizations,
  listAlisioConnectorDefinitions,
  loadStoredAlisioBootstrapState,
  refreshAlisioAiLimits,
  renameAlisioAiProfile,
  requestAlisioAccountRecoveryEmail,
  revokeAlisioConnectorAuthorization,
  selectAlisioAiProfile,
  setAlisioOrganizationState,
  signInAlisioAccount,
  signOutAlisioAccount,
  signUpAlisioAccount,
  updateAlisioAccountPassword,
  updateAlisioAccountProfile,
  verifyAlisioAccountEmailAuth,
} from "../../infra/alisio-store.js";
import { clearDeviceBootstrapTokens } from "../../infra/device-bootstrap.js";
import { revokeDeviceToken } from "../../infra/device-pairing.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import {
  ALISIO_LOCAL_MODEL_BACKEND,
  findAlisioLocalModelCatalogEntry,
} from "../../shared/alisio-local-models.js";
import { loadAlisioGatewayAccountContext } from "../alisio-account-context.js";
import {
  canonicalizeAlisioAccountResult,
  canonicalizeAlisioBootstrapResult,
  isAlisioAccountAuthenticated,
} from "../alisio-contract.js";
import { GATEWAY_EVENT_ALISIO_MODELS_OPERATION } from "../events.js";
import {
  ErrorCodes,
  errorShape,
  validateAlisioAccountResult,
  formatValidationErrors,
  validateAlisioAccountEmailChangeParams,
  validateAlisioAccountEmailChangeResult,
  validateAlisioAccountGetParams,
  validateAlisioAccountEmailAuthBeginParams,
  validateAlisioAccountEmailAuthBeginResult,
  validateAlisioAccountEmailLinkAuthCompleteParams,
  validateAlisioAccountEmailAuthVerifyParams,
  validateAlisioAccountGoogleAuthBeginParams,
  validateAlisioAccountGoogleAuthBeginResult,
  validateAlisioAccountGoogleAuthCompleteParams,
  validateAlisioAccountPasswordUpdateParams,
  validateAlisioAccountPasswordUpdateResult,
  validateAlisioAccountRecoveryEmailParams,
  validateAlisioAccountRecoveryEmailResult,
  validateAlisioAccountPasswordResetParams,
  validateAlisioAccountPasswordResetResult,
  validateAlisioAccountCompleteProfileParams,
  validateAlisioAccountSignInParams,
  validateAlisioAccountSignOutParams,
  validateAlisioAccountSignUpParams,
  validateAlisioAccountUpdateParams,
  validateAlisioAiBeginConnectParams,
  validateAlisioAiBeginConnectResult,
  validateAlisioAiCompleteConnectParams,
  validateAlisioAiDisconnectParams,
  validateAlisioAiGetParams,
  validateAlisioAiRenameProfileParams,
  validateAlisioAiRefreshLimitsParams,
  validateAlisioAiSelectProfileParams,
  validateAlisioAiState,
  validateAlisioBootstrapGetParams,
  validateAlisioModelsGetParams,
  validateAlisioModelsInstallParams,
  validateAlisioModelsInstallResult,
  validateAlisioModelsUninstallParams,
  validateAlisioModelsUninstallResult,
  type AlisioModelsResult,
  type AlisioProvidersResult,
  validateAlisioModelsResult,
  validateAlisioBootstrapResult,
  validateAlisioConnectorsBeginParams,
  validateAlisioConnectorsBeginResult,
  validateAlisioConnectorsCatalogResult,
  validateAlisioConnectorsCatalogParams,
  validateAlisioConnectorsListResult,
  validateAlisioConnectorsListParams,
  validateAlisioConnectorsRevokeResult,
  validateAlisioConnectorsRevokeParams,
  validateAlisioDoctorSummaryParams,
  validateAlisioDoctorSummaryResult,
  validateAlisioProvidersGetParams,
  validateAlisioProvidersResult,
  validateAlisioAppRebuildParams,
  validateAlisioAppRebuildResult,
  validateAlisioRuntimeRestartParams,
  validateAlisioRuntimeRestartResult,
  validateAlisioOrganizationGetParams,
  validateAlisioOrganizationSetParams,
} from "../protocol/index.js";
import { resolveGatewayCronRuntimeScope } from "../server-cron.js";
import { formatError } from "../server-utils.js";
import type { GatewayRequestContext, GatewayRequestHandlers, RespondFn } from "./types.js";

type LocalModelOperationEvent = {
  targetId: string;
  modelId: string;
  action: "install" | "uninstall";
  phase: "started" | "running" | "completed" | "failed";
  percent?: number;
  downloadedSize?: number;
  totalSize?: number;
  message?: string;
};

async function syncCronRuntimeScopeToAccount(context: GatewayRequestContext) {
  try {
    const accountContext = await loadAlisioGatewayAccountContext();
    const runtimeScope = resolveGatewayCronRuntimeScope({
      configuredStorePath: context.cron.getConfiguredStorePath(),
      configuredCronEnabled: context.cron.getConfiguredCronEnabled(),
      accountId: accountContext.canonical.authenticated
        ? accountContext.canonical.accountId
        : undefined,
    });
    await context.cron.setRuntimeScope(runtimeScope);
  } catch (err) {
    context.logGateway.warn(
      `cron: failed to sync account scope after auth change: ${formatError(err)}`,
    );
  }
}

type RuntimeSetupState = Awaited<ReturnType<typeof loadAlisioRuntimeSetupStateWithTimeout>>;
type StoredBootstrapState = Awaited<ReturnType<typeof loadStoredAlisioBootstrapState>>;
type BootstrapShellState = {
  wizardSessionId: string | null;
  runtimeSetup: RuntimeSetupState;
  stored: StoredBootstrapState;
};

const ALISIO_BOOTSTRAP_SHELL_CACHE_TTL_MS = 3_000;
let cachedBootstrapShellState:
  | {
      expiresAtMs: number;
      key: {
        findRunningWizard: GatewayRequestContext["findRunningWizard"];
        loadGatewayModelCatalog: GatewayRequestContext["loadGatewayModelCatalog"];
        nodeRegistry: GatewayRequestContext["nodeRegistry"];
      };
      value: BootstrapShellState;
    }
  | undefined;
let inflightBootstrapShellState: Promise<BootstrapShellState> | undefined;

function safeParseJson(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function refreshBootstrapShellState(
  context: Pick<
    GatewayRequestContext,
    "findRunningWizard" | "loadGatewayModelCatalog" | "nodeRegistry"
  >,
): Promise<BootstrapShellState> {
  const wizardSessionId = context.findRunningWizard();
  const runtimeSetup = await loadAlisioRuntimeSetupStateWithTimeout({
    ...context,
    includeDynamicCatalog: false,
  });
  const stored = await loadStoredAlisioBootstrapState({
    wizardRunning: Boolean(wizardSessionId),
    providerReady: runtimeSetup.providerReady,
    connectionRequired: false,
  });
  const value: BootstrapShellState = {
    wizardSessionId,
    runtimeSetup,
    stored,
  };
  cachedBootstrapShellState = {
    expiresAtMs: Date.now() + ALISIO_BOOTSTRAP_SHELL_CACHE_TTL_MS,
    key: {
      findRunningWizard: context.findRunningWizard,
      loadGatewayModelCatalog: context.loadGatewayModelCatalog,
      nodeRegistry: context.nodeRegistry,
    },
    value,
  };
  return value;
}

async function loadBootstrapShellState(
  context: Pick<
    GatewayRequestContext,
    "findRunningWizard" | "loadGatewayModelCatalog" | "nodeRegistry"
  >,
): Promise<BootstrapShellState> {
  const now = Date.now();
  const matchesCachedContext =
    cachedBootstrapShellState?.key.findRunningWizard === context.findRunningWizard &&
    cachedBootstrapShellState?.key.loadGatewayModelCatalog === context.loadGatewayModelCatalog &&
    cachedBootstrapShellState?.key.nodeRegistry === context.nodeRegistry;
  if (
    cachedBootstrapShellState &&
    matchesCachedContext &&
    cachedBootstrapShellState.expiresAtMs > now
  ) {
    return cachedBootstrapShellState.value;
  }
  if (cachedBootstrapShellState && matchesCachedContext) {
    inflightBootstrapShellState ??= refreshBootstrapShellState(context).finally(() => {
      inflightBootstrapShellState = undefined;
    });
    void inflightBootstrapShellState.catch(() => undefined);
    return cachedBootstrapShellState.value;
  }
  if (inflightBootstrapShellState) {
    return await inflightBootstrapShellState;
  }
  inflightBootstrapShellState = refreshBootstrapShellState(context).finally(() => {
    inflightBootstrapShellState = undefined;
  });
  return await inflightBootstrapShellState;
}

export async function publishAlisioDynamicModelProvidersForContext(
  context: Pick<GatewayRequestContext, "nodeRegistry">,
  opts?: { force?: boolean },
): Promise<AlisioModelsResult> {
  const account = await getAlisioAccountState();
  const currentDevice = account.devices.find((device) => device.current) ?? account.devices[0];
  const snapshot = await loadAlisioModelProviderSnapshot({
    nodeRegistry: context.nodeRegistry,
    currentDevice: currentDevice
      ? {
          id: currentDevice.id,
          label: currentDevice.label,
          platform: currentDevice.platform,
        }
      : undefined,
    env: process.env,
    force: opts?.force === true,
  });
  return {
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    catalog: snapshot.catalog,
    targets: snapshot.targets,
  };
}

function broadcastLocalModelOperation(
  context: GatewayRequestContext,
  payload: LocalModelOperationEvent,
) {
  context.broadcast(GATEWAY_EVENT_ALISIO_MODELS_OPERATION, payload, { dropIfSlow: true });
}

async function requireAuthenticatedAlisioAccount(respond: RespondFn) {
  const account = await getAlisioAccountState();
  if (!isAlisioAccountAuthenticated(account)) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "Alisio account sign-in required before using shared backend features.",
      ),
    );
    return null;
  }
  return account;
}

function findCurrentModelTarget(
  models: AlisioModelsResult,
  modelId: string,
): AlisioModelsResult["targets"][number] | undefined {
  const currentTargets = models.targets.filter((target) => target.current);
  const normalizedModelId = modelId.trim().toLowerCase();
  return (
    currentTargets.find((target) =>
      target.installedModels.some((model) => model.id.trim().toLowerCase() === normalizedModelId),
    ) ??
    currentTargets.find((target) =>
      (target.availableModels ?? []).some(
        (model) => model.id.trim().toLowerCase() === normalizedModelId,
      ),
    ) ??
    (findAlisioLocalModelCatalogEntry(modelId)
      ? currentTargets.find((target) => target.runtimeKind === ALISIO_LOCAL_MODEL_BACKEND)
      : undefined) ??
    currentTargets.find((target) => target.supportsInstall) ??
    currentTargets[0]
  );
}

function resolveSelectedModelsTarget(
  models: AlisioModelsResult,
  params: { targetId: string; modelId: string },
) {
  return params.targetId === "current" || params.targetId === "local"
    ? findCurrentModelTarget(models, params.modelId)
    : models.targets.find((target) => target.targetId === params.targetId);
}

function resolveRemoteManageCapabilityId(
  target: AlisioModelsResult["targets"][number],
  node: { capabilities: Array<{ id: string }> },
): string | null {
  if (target.runtimeKind !== ALISIO_LOCAL_MODEL_BACKEND) {
    return null;
  }
  return node.capabilities.some((capability) => capability.id === "model.manage.llamacpp.v1")
    ? "model.manage.llamacpp.v1"
    : null;
}

function resolveRemoteManageUnavailableMessage(
  _target: AlisioModelsResult["targets"][number],
  action: "install" | "uninstall",
) {
  return `target device does not support local model ${action === "install" ? "installation" : "uninstallation"}`;
}

function isReadOnlySharedModelsTarget(target: AlisioModelsResult["targets"][number]): boolean {
  return target.access === "shared" && Boolean(target.grantId?.trim());
}

export const alisioHandlers: GatewayRequestHandlers = {
  "alisio.account.get": async ({ params, respond }) => {
    if (!validateAlisioAccountGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.get params: ${formatValidationErrors(
            validateAlisioAccountGetParams.errors,
          )}`,
        ),
      );
      return;
    }
    const result = canonicalizeAlisioAccountResult(await getAlisioAccountState());
    if (!validateAlisioAccountResult(result)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.get result: ${formatValidationErrors(
            validateAlisioAccountResult.errors,
          )}`,
        ),
      );
      return;
    }
    respond(true, result, undefined);
  },
  "alisio.account.beginEmailAuth": async ({ params, respond }) => {
    if (!validateAlisioAccountEmailAuthBeginParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.beginEmailAuth params: ${formatValidationErrors(
            validateAlisioAccountEmailAuthBeginParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await beginAlisioAccountEmailAuth(
        {
          email: params.email,
          callbackUrl: typeof params.callbackUrl === "string" ? params.callbackUrl : undefined,
        },
        process.env,
      );
      if (!validateAlisioAccountEmailAuthBeginResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.account.beginEmailAuth result: ${formatValidationErrors(
              validateAlisioAccountEmailAuthBeginResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountCloudError || err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to begin Alisio email auth: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.account.completeEmailLinkAuth": async ({ params, respond, context }) => {
    if (!validateAlisioAccountEmailLinkAuthCompleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.completeEmailLinkAuth params: ${formatValidationErrors(
            validateAlisioAccountEmailLinkAuthCompleteParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = canonicalizeAlisioAccountResult(
        await completeAlisioAccountEmailLinkAuth(
          {
            accessToken: params.accessToken,
            refreshToken: params.refreshToken,
            expiresIn: params.expiresIn,
            tokenType: params.tokenType,
          },
          process.env,
        ),
      );
      if (!validateAlisioAccountResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.account.completeEmailLinkAuth result: ${formatValidationErrors(
              validateAlisioAccountResult.errors,
            )}`,
          ),
        );
        return;
      }
      await syncCronRuntimeScopeToAccount(context);
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountCloudError || err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to complete Alisio email link auth: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.account.verifyEmailAuth": async ({ params, respond, context }) => {
    if (!validateAlisioAccountEmailAuthVerifyParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.verifyEmailAuth params: ${formatValidationErrors(
            validateAlisioAccountEmailAuthVerifyParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = canonicalizeAlisioAccountResult(
        await verifyAlisioAccountEmailAuth(
          {
            email: params.email,
            code: params.code,
          },
          process.env,
        ),
      );
      if (!validateAlisioAccountResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.account.verifyEmailAuth result: ${formatValidationErrors(
              validateAlisioAccountResult.errors,
            )}`,
          ),
        );
        return;
      }
      await syncCronRuntimeScopeToAccount(context);
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountCloudError || err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to verify Alisio email: ${formatError(err)}`),
      );
    }
  },
  "alisio.account.beginGoogleAuth": async ({ params, respond }) => {
    if (!validateAlisioAccountGoogleAuthBeginParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.beginGoogleAuth params: ${formatValidationErrors(
            validateAlisioAccountGoogleAuthBeginParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await beginAlisioAccountGoogleAuth(
        { callbackUrl: params.callbackUrl },
        process.env,
      );
      if (!validateAlisioAccountGoogleAuthBeginResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.account.beginGoogleAuth result: ${formatValidationErrors(
              validateAlisioAccountGoogleAuthBeginResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountCloudError || err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to begin Alisio Google auth: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.account.completeGoogleAuth": async ({ params, respond, context }) => {
    if (!validateAlisioAccountGoogleAuthCompleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.completeGoogleAuth params: ${formatValidationErrors(
            validateAlisioAccountGoogleAuthCompleteParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = canonicalizeAlisioAccountResult(
        await completeAlisioAccountGoogleAuthFromCallback(
          {
            stateToken: params.stateToken,
            code: params.code,
            error: params.error,
            errorDescription: params.errorDescription,
          },
          process.env,
        ),
      );
      if (!validateAlisioAccountResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.account.completeGoogleAuth result: ${formatValidationErrors(
              validateAlisioAccountResult.errors,
            )}`,
          ),
        );
        return;
      }
      await syncCronRuntimeScopeToAccount(context);
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountCloudError || err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to complete Alisio Google auth: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.account.requestRecoveryEmail": async ({ params, respond }) => {
    if (!validateAlisioAccountRecoveryEmailParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.requestRecoveryEmail params: ${formatValidationErrors(
            validateAlisioAccountRecoveryEmailParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await requestAlisioAccountRecoveryEmail(
        {
          email: params.email,
          ...(typeof params.callbackUrl === "string" ? { callbackUrl: params.callbackUrl } : {}),
        },
        process.env,
      );
      if (!validateAlisioAccountRecoveryEmailResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.account.requestRecoveryEmail result: ${formatValidationErrors(
              validateAlisioAccountRecoveryEmailResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountCloudError || err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to start Alisio account recovery: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.account.requestPasswordReset": async ({ params, respond }) => {
    if (!validateAlisioAccountPasswordResetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.requestPasswordReset params: ${formatValidationErrors(
            validateAlisioAccountPasswordResetParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await requestAlisioAccountRecoveryEmail(
        {
          email: params.email,
          ...(typeof params.callbackUrl === "string" ? { callbackUrl: params.callbackUrl } : {}),
        },
        process.env,
      );
      if (!validateAlisioAccountPasswordResetResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.account.requestPasswordReset result: ${formatValidationErrors(
              validateAlisioAccountPasswordResetResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountCloudError || err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to start Alisio account recovery: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.account.changeEmail": async ({ params, respond }) => {
    if (!validateAlisioAccountEmailChangeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.changeEmail params: ${formatValidationErrors(
            validateAlisioAccountEmailChangeParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await changeAlisioAccountEmail(
        {
          email: params.email,
          ...(typeof params.callbackUrl === "string" ? { callbackUrl: params.callbackUrl } : {}),
        },
        process.env,
      );
      if (!validateAlisioAccountEmailChangeResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.account.changeEmail result: ${formatValidationErrors(
              validateAlisioAccountEmailChangeResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountCloudError || err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to change Alisio email: ${formatError(err)}`),
      );
    }
  },
  "alisio.account.updatePassword": async ({ params, respond }) => {
    if (!validateAlisioAccountPasswordUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.updatePassword params: ${formatValidationErrors(
            validateAlisioAccountPasswordUpdateParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await updateAlisioAccountPassword(
        {
          password: params.password,
        },
        process.env,
      );
      if (!validateAlisioAccountPasswordUpdateResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.account.updatePassword result: ${formatValidationErrors(
              validateAlisioAccountPasswordUpdateResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountCloudError || err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to update Alisio password: ${formatError(err)}`),
      );
    }
  },
  "alisio.account.signUp": async ({ params, respond, context }) => {
    if (!validateAlisioAccountSignUpParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.signUp params: ${formatValidationErrors(
            validateAlisioAccountSignUpParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await signUpAlisioAccount(
        {
          email: params.email,
          password: params.password,
          ...(typeof params.callbackUrl === "string" ? { callbackUrl: params.callbackUrl } : {}),
        },
        process.env,
      );
      await syncCronRuntimeScopeToAccount(context);
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountCloudError || err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to create Alisio account: ${formatError(err)}`),
      );
    }
  },
  "alisio.account.signIn": async ({ params, respond, context }) => {
    if (!validateAlisioAccountSignInParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.signIn params: ${formatValidationErrors(
            validateAlisioAccountSignInParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await signInAlisioAccount(
        {
          email: params.email,
          password: params.password,
        },
        process.env,
      );
      await syncCronRuntimeScopeToAccount(context);
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountCloudError || err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to sign in to Alisio: ${formatError(err)}`),
      );
    }
  },
  "alisio.account.signOut": async ({ params, respond, client, context }) => {
    if (!validateAlisioAccountSignOutParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.signOut params: ${formatValidationErrors(
            validateAlisioAccountSignOutParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const deviceId = client?.connect?.device?.id?.trim() || undefined;
      const result = await signOutAlisioAccount();
      if (deviceId) {
        await Promise.allSettled([
          revokeDeviceToken({ deviceId, role: client?.connect?.role ?? "operator" }),
          clearDeviceBootstrapTokens(),
        ]);
      } else {
        await clearDeviceBootstrapTokens();
      }
      await syncCronRuntimeScopeToAccount(context);
      respond(true, result, undefined);
      if (deviceId) {
        setTimeout(() => {
          context.disconnectClientsForDevice?.(deviceId, {
            role: client?.connect?.role ?? "operator",
          });
        }, 0);
      }
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to sign out of Alisio: ${formatError(err)}`),
      );
    }
  },
  "alisio.account.update": async ({ params, respond }) => {
    if (!validateAlisioAccountUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.update params: ${formatValidationErrors(
            validateAlisioAccountUpdateParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      respond(true, await updateAlisioAccountProfile(params), undefined);
    } catch (err) {
      if (err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to update Alisio account: ${formatError(err)}`),
      );
    }
  },
  "alisio.account.completeProfile": async ({ params, respond }) => {
    if (!validateAlisioAccountCompleteProfileParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.account.completeProfile params: ${formatValidationErrors(
            validateAlisioAccountCompleteProfileParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      respond(true, await updateAlisioAccountProfile(params), undefined);
    } catch (err) {
      if (err instanceof AlisioAccountValidationError || err instanceof AlisioAccountCloudError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to complete Alisio profile: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.ai.get": async ({ params, respond }) => {
    if (!validateAlisioAiGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.ai.get params: ${formatValidationErrors(validateAlisioAiGetParams.errors)}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    const result = await getAlisioAiState();
    if (!validateAlisioAiState(result)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.ai.get result: ${formatValidationErrors(validateAlisioAiState.errors)}`,
        ),
      );
      return;
    }
    respond(true, result, undefined);
  },
  "alisio.ai.beginConnect": async ({ params, respond }) => {
    if (!validateAlisioAiBeginConnectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.ai.beginConnect params: ${formatValidationErrors(
            validateAlisioAiBeginConnectParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    try {
      const result = await beginAlisioAiConnect(params);
      if (!validateAlisioAiBeginConnectResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.ai.beginConnect result: ${formatValidationErrors(
              validateAlisioAiBeginConnectResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAiError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to start OpenAI connection: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.ai.completeConnect": async ({ params, respond }) => {
    if (!validateAlisioAiCompleteConnectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.ai.completeConnect params: ${formatValidationErrors(
            validateAlisioAiCompleteConnectParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    try {
      const result = await completeAlisioAiConnect(params);
      if (!validateAlisioAiState(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.ai.completeConnect result: ${formatValidationErrors(
              validateAlisioAiState.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAiError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to complete OpenAI connection: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.ai.disconnect": async ({ params, respond }) => {
    if (!validateAlisioAiDisconnectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.ai.disconnect params: ${formatValidationErrors(
            validateAlisioAiDisconnectParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    const result = await disconnectAlisioAi(params as { profileId?: string });
    respond(true, result, undefined);
  },
  "alisio.ai.refreshLimits": async ({ params, respond }) => {
    if (!validateAlisioAiRefreshLimitsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.ai.refreshLimits params: ${formatValidationErrors(
            validateAlisioAiRefreshLimitsParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    try {
      respond(true, await refreshAlisioAiLimits(params as { profileId?: string }), undefined);
    } catch (err) {
      if (err instanceof AlisioAiError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to refresh OpenAI limits: ${formatError(err)}`),
      );
    }
  },
  "alisio.ai.renameProfile": async ({ params, respond }) => {
    if (!validateAlisioAiRenameProfileParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.ai.renameProfile params: ${formatValidationErrors(
            validateAlisioAiRenameProfileParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    try {
      const result = await renameAlisioAiProfile(params as { profileId: string; label: string });
      if (!validateAlisioAiState(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.ai.renameProfile result: ${formatValidationErrors(
              validateAlisioAiState.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAiError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to rename OpenAI profile: ${formatError(err)}`),
      );
    }
  },
  "alisio.ai.selectProfile": async ({ params, respond }) => {
    if (!validateAlisioAiSelectProfileParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.ai.selectProfile params: ${formatValidationErrors(
            validateAlisioAiSelectProfileParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    try {
      const result = await selectAlisioAiProfile(params as { profileId: string });
      if (!validateAlisioAiState(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.ai.selectProfile result: ${formatValidationErrors(
              validateAlisioAiState.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAiError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to select OpenAI profile: ${formatError(err)}`),
      );
    }
  },
  "alisio.bootstrap.get": async ({ params, respond, context }) => {
    if (!validateAlisioBootstrapGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.bootstrap.get params: ${formatValidationErrors(
            validateAlisioBootstrapGetParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const { wizardSessionId, runtimeSetup, stored } = await loadBootstrapShellState(context);
      const { snapshot, summary } = stored;
      const result = canonicalizeAlisioBootstrapResult({
        summary,
        snapshot,
        wizard: {
          running: Boolean(wizardSessionId),
          sessionId: wizardSessionId,
        },
        models: runtimeSetup.models,
      });
      if (!validateAlisioBootstrapResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.bootstrap.get result: ${formatValidationErrors(
              validateAlisioBootstrapResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      console.error("[alisio.models.get] failed", err);
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to load Alisio bootstrap state: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.models.get": async ({ params, respond, context }) => {
    if (!validateAlisioModelsGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.models.get params: ${formatValidationErrors(
            validateAlisioModelsGetParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    try {
      const result = await publishAlisioDynamicModelProvidersForContext(context, {
        force: true,
      });
      if (!validateAlisioModelsResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.models.get result: ${formatValidationErrors(
              validateAlisioModelsResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to load Alisio local models: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.models.install": async ({ params, respond, context }) => {
    if (!validateAlisioModelsInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.models.install params: ${formatValidationErrors(
            validateAlisioModelsInstallParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }

    let operationTargetId = params.targetId;
    try {
      const publishedModels = await publishAlisioDynamicModelProvidersForContext(context, {
        force: true,
      });
      const selectedTarget = resolveSelectedModelsTarget(publishedModels, params);
      if (!selectedTarget) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "target device unavailable"),
        );
        return;
      }
      if (isReadOnlySharedModelsTarget(selectedTarget)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "shared devices are read-only"),
        );
        return;
      }
      operationTargetId = selectedTarget.targetId;
      const installCurrentTarget = selectedTarget.current;

      if (installCurrentTarget) {
        if (
          selectedTarget.runtimeKind !== ALISIO_LOCAL_MODEL_BACKEND ||
          !selectedTarget.supportsInstall
        ) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              "target device does not support local model installation",
            ),
          );
          return;
        }
        if (
          !findAlisioLocalModelCatalogEntry(params.modelId) ||
          findAlisioLocalModelCatalogEntry(params.modelId)?.releaseStage !== "published"
        ) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown local model"));
          return;
        }
        broadcastLocalModelOperation(context, {
          targetId: selectedTarget.targetId,
          modelId: params.modelId,
          action: "install",
          phase: "started",
        });
        await installAlisioLocalModel({
          modelId: params.modelId,
          env: process.env,
          onProgress: ({ downloadedSize, totalSize }) => {
            const percent =
              totalSize > 0
                ? Math.max(0, Math.min(100, Math.round((downloadedSize / totalSize) * 100)))
                : undefined;
            broadcastLocalModelOperation(context, {
              targetId: selectedTarget.targetId,
              modelId: params.modelId,
              action: "install",
              phase: "running",
              downloadedSize,
              totalSize,
              percent,
            });
          },
        });
        broadcastLocalModelOperation(context, {
          targetId: selectedTarget.targetId,
          modelId: params.modelId,
          action: "install",
          phase: "completed",
          percent: 100,
        });
      } else {
        const node = context.nodeRegistry.get(selectedTarget.deviceId);
        if (!node) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "target device not connected"),
          );
          return;
        }
        const remoteManageCapabilityId = resolveRemoteManageCapabilityId(selectedTarget, node);
        if (!remoteManageCapabilityId) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              resolveRemoteManageUnavailableMessage(selectedTarget, "install"),
            ),
          );
          return;
        }
        if (
          !findAlisioLocalModelCatalogEntry(params.modelId) ||
          findAlisioLocalModelCatalogEntry(params.modelId)?.releaseStage !== "published"
        ) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown local model"));
          return;
        }

        const task = context.nodeRegistry.startTask({
          nodeId: node.nodeId,
          capabilityId: remoteManageCapabilityId,
          input: {
            action: "install",
            modelId: params.modelId,
          },
          timeoutMs: 1_800_000,
          onEvent: (event) => {
            const payload = event.payloadJSON ? safeParseJson(event.payloadJSON) : event.payload;
            if (!payload || typeof payload !== "object") {
              return;
            }
            const action =
              (payload as { action?: unknown }).action === "install" ? "install" : null;
            if (!action) {
              return;
            }
            const phaseValue =
              typeof (payload as { phase?: unknown }).phase === "string"
                ? (payload as { phase: string }).phase
                : event.kind;
            const phase =
              phaseValue === "started" ||
              phaseValue === "running" ||
              phaseValue === "completed" ||
              phaseValue === "failed"
                ? phaseValue
                : event.kind === "progress"
                  ? "running"
                  : event.kind === "completed"
                    ? "completed"
                    : event.kind === "failed"
                      ? "failed"
                      : event.kind === "status"
                        ? "started"
                        : null;
            if (!phase) {
              return;
            }
            broadcastLocalModelOperation(context, {
              targetId: selectedTarget.targetId,
              modelId: params.modelId,
              action,
              phase,
              percent:
                typeof (payload as { percent?: unknown }).percent === "number"
                  ? (payload as { percent: number }).percent
                  : undefined,
              downloadedSize:
                typeof (payload as { downloadedSize?: unknown }).downloadedSize === "number"
                  ? (payload as { downloadedSize: number }).downloadedSize
                  : undefined,
              totalSize:
                typeof (payload as { totalSize?: unknown }).totalSize === "number"
                  ? (payload as { totalSize: number }).totalSize
                  : undefined,
              message:
                typeof (payload as { message?: unknown }).message === "string"
                  ? (payload as { message: string }).message
                  : undefined,
            });
          },
        });
        if (!task.ok) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, task.error.message));
          return;
        }
        const result = await task.result;
        if (!result.ok) {
          broadcastLocalModelOperation(context, {
            targetId: selectedTarget.targetId,
            modelId: params.modelId,
            action: "install",
            phase: "failed",
            message: result.error?.message ?? "local model install failed",
          });
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              result.error?.message ?? "local model install failed",
            ),
          );
          return;
        }
      }

      clearAlisioModelProviderSnapshotCache();
      const result = {
        ok: true as const,
        backend: ALISIO_LOCAL_MODEL_BACKEND,
        targetId: selectedTarget.targetId,
        modelId: params.modelId,
      };
      if (!validateAlisioModelsInstallResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.models.install result: ${formatValidationErrors(
              validateAlisioModelsInstallResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      broadcastLocalModelOperation(context, {
        targetId: operationTargetId,
        modelId: params.modelId,
        action: "install",
        phase: "failed",
        message: formatError(err),
      });
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to install local model: ${formatError(err)}`),
      );
    }
  },
  "alisio.models.uninstall": async ({ params, respond, context }) => {
    if (!validateAlisioModelsUninstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.models.uninstall params: ${formatValidationErrors(
            validateAlisioModelsUninstallParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }

    let operationTargetId = params.targetId;
    try {
      const publishedModels = await publishAlisioDynamicModelProvidersForContext(context, {
        force: true,
      });
      const selectedTarget = resolveSelectedModelsTarget(publishedModels, params);
      if (!selectedTarget) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "target device unavailable"),
        );
        return;
      }
      if (isReadOnlySharedModelsTarget(selectedTarget)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "shared devices are read-only"),
        );
        return;
      }
      operationTargetId = selectedTarget.targetId;
      const uninstallCurrentTarget = selectedTarget.current;

      if (uninstallCurrentTarget) {
        if (
          selectedTarget.runtimeKind !== ALISIO_LOCAL_MODEL_BACKEND ||
          !selectedTarget.supportsUninstall
        ) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              "target device does not support local model uninstallation",
            ),
          );
          return;
        }
        broadcastLocalModelOperation(context, {
          targetId: selectedTarget.targetId,
          modelId: params.modelId,
          action: "uninstall",
          phase: "started",
        });
        await uninstallAlisioLocalModel({
          modelId: params.modelId,
          env: process.env,
        });
        broadcastLocalModelOperation(context, {
          targetId: selectedTarget.targetId,
          modelId: params.modelId,
          action: "uninstall",
          phase: "completed",
          percent: 100,
        });
      } else {
        const node = context.nodeRegistry.get(selectedTarget.deviceId);
        if (!node) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "target device not connected"),
          );
          return;
        }
        const remoteManageCapabilityId = resolveRemoteManageCapabilityId(selectedTarget, node);
        if (!remoteManageCapabilityId) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              resolveRemoteManageUnavailableMessage(selectedTarget, "uninstall"),
            ),
          );
          return;
        }

        const task = context.nodeRegistry.startTask({
          nodeId: node.nodeId,
          capabilityId: remoteManageCapabilityId,
          input: {
            action: "uninstall",
            modelId: params.modelId,
          },
          timeoutMs: 300_000,
          onEvent: (event) => {
            const payload = event.payloadJSON ? safeParseJson(event.payloadJSON) : event.payload;
            if (!payload || typeof payload !== "object") {
              return;
            }
            const action =
              (payload as { action?: unknown }).action === "uninstall" ? "uninstall" : null;
            if (!action) {
              return;
            }
            const phaseValue =
              typeof (payload as { phase?: unknown }).phase === "string"
                ? (payload as { phase: string }).phase
                : event.kind;
            const phase =
              phaseValue === "started" ||
              phaseValue === "running" ||
              phaseValue === "completed" ||
              phaseValue === "failed"
                ? phaseValue
                : event.kind === "completed"
                  ? "completed"
                  : event.kind === "failed"
                    ? "failed"
                    : event.kind === "status"
                      ? "started"
                      : null;
            if (!phase) {
              return;
            }
            broadcastLocalModelOperation(context, {
              targetId: selectedTarget.targetId,
              modelId: params.modelId,
              action,
              phase,
              message:
                typeof (payload as { message?: unknown }).message === "string"
                  ? (payload as { message: string }).message
                  : undefined,
            });
          },
        });
        if (!task.ok) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, task.error.message));
          return;
        }
        const result = await task.result;
        if (!result.ok) {
          broadcastLocalModelOperation(context, {
            targetId: selectedTarget.targetId,
            modelId: params.modelId,
            action: "uninstall",
            phase: "failed",
            message: result.error?.message ?? "local model uninstall failed",
          });
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              result.error?.message ?? "local model uninstall failed",
            ),
          );
          return;
        }
      }

      clearAlisioModelProviderSnapshotCache();
      const result = {
        ok: true as const,
        backend: ALISIO_LOCAL_MODEL_BACKEND,
        targetId: selectedTarget.targetId,
        modelId: params.modelId,
      };
      if (!validateAlisioModelsUninstallResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.models.uninstall result: ${formatValidationErrors(
              validateAlisioModelsUninstallResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      broadcastLocalModelOperation(context, {
        targetId: operationTargetId,
        modelId: params.modelId,
        action: "uninstall",
        phase: "failed",
        message: formatError(err),
      });
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to uninstall local model: ${formatError(err)}`),
      );
    }
  },
  "alisio.doctor.summary": async ({ params, respond, context }) => {
    if (!validateAlisioDoctorSummaryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.doctor.summary params: ${formatValidationErrors(
            validateAlisioDoctorSummaryParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const { wizardSessionId, runtimeSetup, stored } = await loadBootstrapShellState(context);
      const { snapshot, summary: bootstrapSummary } = stored;
      const doctorSummary = await getAlisioDoctorSummary({
        wizardRunning: wizardSessionId !== null,
        providerReady: runtimeSetup.providerReady,
        connectionRequired: false,
        bootstrap: bootstrapSummary,
      });
      const bootstrap = canonicalizeAlisioBootstrapResult({
        summary: bootstrapSummary,
        snapshot,
        wizard: {
          running: wizardSessionId !== null,
          sessionId: wizardSessionId,
        },
        models: runtimeSetup.models,
      });
      const result = {
        ...doctorSummary,
        bootstrap,
      };
      if (!validateAlisioDoctorSummaryResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.doctor.summary result: ${formatValidationErrors(
              validateAlisioDoctorSummaryResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to load Alisio doctor summary: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.providers.get": async ({ params, respond, context }) => {
    if (!validateAlisioProvidersGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.providers.get params: ${formatValidationErrors(
            validateAlisioProvidersGetParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    try {
      const loaded = await loadAlisioProviderOverview({
        nodeRegistry: context.nodeRegistry,
      });
      const result = {
        ...loaded,
        account: canonicalizeAlisioAccountResult(loaded.account),
      };
      if (!validateAlisioProvidersResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.providers.get result: ${formatValidationErrors(
              validateAlisioProvidersResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result satisfies AlisioProvidersResult, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to load Alisio provider overview: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.runtime.restart": async ({ params, respond, client }) => {
    if (!validateAlisioRuntimeRestartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.runtime.restart params: ${formatValidationErrors(
            validateAlisioRuntimeRestartParams.errors,
          )}`,
        ),
      );
      return;
    }
    const actor = client?.connect?.device?.id ?? client?.clientIp ?? "alisio";
    const result = scheduleGatewaySigusr1Restart({
      delayMs: 0,
      reason: "alisio.runtime.restart",
      audit: {
        actor,
        deviceId: client?.connect?.device?.id,
        clientIp: client?.clientIp,
      },
    });
    if (!validateAlisioRuntimeRestartResult(result)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `invalid alisio.runtime.restart result: ${formatValidationErrors(
            validateAlisioRuntimeRestartResult.errors,
          )}`,
        ),
      );
      return;
    }
    respond(true, result, undefined);
  },
  "alisio.app.rebuild": async ({ params, respond }) => {
    if (!validateAlisioAppRebuildParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.app.rebuild params: ${formatValidationErrors(
            validateAlisioAppRebuildParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = startAlisioDeveloperRebuild();
      if (!validateAlisioAppRebuildResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `invalid alisio.app.rebuild result: ${formatValidationErrors(
              validateAlisioAppRebuildResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to start app rebuild: ${formatError(err)}`),
      );
    }
  },
  "alisio.organization.get": async ({ params, respond }) => {
    if (!validateAlisioOrganizationGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.organization.get params: ${formatValidationErrors(
            validateAlisioOrganizationGetParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    respond(true, await getAlisioOrganizationState(), undefined);
  },
  "alisio.organization.set": async ({ params, respond }) => {
    if (!validateAlisioOrganizationSetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.organization.set params: ${formatValidationErrors(
            validateAlisioOrganizationSetParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    try {
      respond(true, await setAlisioOrganizationState(params as never), undefined);
    } catch (err) {
      if (err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to update Alisio organization: ${formatError(err)}`,
        ),
      );
    }
  },
  "connectors.catalog": async ({ params, respond }) => {
    if (!validateAlisioConnectorsCatalogParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.catalog params: ${formatValidationErrors(
            validateAlisioConnectorsCatalogParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    const result = { connectors: listAlisioConnectorDefinitions() };
    if (!validateAlisioConnectorsCatalogResult(result)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.catalog result: ${formatValidationErrors(
            validateAlisioConnectorsCatalogResult.errors,
          )}`,
        ),
      );
      return;
    }
    respond(true, result, undefined);
  },
  "connectors.list": async ({ params, respond }) => {
    if (!validateAlisioConnectorsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.list params: ${formatValidationErrors(
            validateAlisioConnectorsListParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    const result = { authorizations: await listAlisioConnectorAuthorizations() };
    if (!validateAlisioConnectorsListResult(result)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.list result: ${formatValidationErrors(
            validateAlisioConnectorsListResult.errors,
          )}`,
        ),
      );
      return;
    }
    respond(true, result, undefined);
  },
  "connectors.begin": async ({ params, respond }) => {
    if (!validateAlisioConnectorsBeginParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.begin params: ${formatValidationErrors(
            validateAlisioConnectorsBeginParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    try {
      const result = await beginAlisioConnectorSetup(
        (params as { connectorId: string }).connectorId,
      );
      if (!result) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown connectorId"));
        return;
      }
      if (!validateAlisioConnectorsBeginResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid connectors.begin result: ${formatValidationErrors(
              validateAlisioConnectorsBeginResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to begin Alisio connector setup: ${formatError(err)}`,
        ),
      );
    }
  },
  "connectors.revoke": async ({ params, respond }) => {
    if (!validateAlisioConnectorsRevokeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.revoke params: ${formatValidationErrors(
            validateAlisioConnectorsRevokeParams.errors,
          )}`,
        ),
      );
      return;
    }
    if (!(await requireAuthenticatedAlisioAccount(respond))) {
      return;
    }
    const result = await revokeAlisioConnectorAuthorization(
      (params as { connectorId: string }).connectorId,
    );
    if (!result) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown connectorId"));
      return;
    }
    if (!validateAlisioConnectorsRevokeResult(result)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid connectors.revoke result: ${formatValidationErrors(
            validateAlisioConnectorsRevokeResult.errors,
          )}`,
        ),
      );
      return;
    }
    respond(true, result, undefined);
  },
};
