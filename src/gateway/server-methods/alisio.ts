import { AlisioAccountCloudError } from "../../infra/alisio-account-cloud.js";
import { AlisioAiError } from "../../infra/alisio-ai.js";
import { startLmStudioLocalServer } from "../../infra/alisio-lmstudio.js";
import {
  installAlisioLocalModel,
  uninstallAlisioLocalModel,
} from "../../infra/alisio-local-llama-runtime.js";
import * as localModelRuntime from "../../infra/alisio-local-model-runtime.js";
import {
  clearAlisioModelProviderSnapshotCache,
  loadAlisioModelProviderSnapshot,
} from "../../infra/alisio-model-snapshot.js";
import { loadAlisioProviderOverview } from "../../infra/alisio-provider-overview.js";
import {
  loadAlisioRuntimeSetupState,
  resolveAlisioRuntimeProviderReady,
} from "../../infra/alisio-runtime.js";
import {
  approveAlisioSharingRequest,
  beginAlisioAccountEmailAuth,
  completeAlisioAccountEmailLinkAuth,
  beginAlisioAccountGoogleAuth,
  AlisioAccountValidationError,
  beginAlisioConnectorSetup,
  beginAlisioAiConnect,
  changeAlisioAccountEmail,
  completeAlisioConnectorAuthorization,
  completeAlisioAiConnect,
  disconnectAlisioAi,
  getAlisioDoctorSummary,
  getAlisioAccountState,
  getAlisioAiState,
  getAlisioOrganizationState,
  getAlisioSharingState,
  listAlisioConnectorAuthorizations,
  listAlisioConnectorDefinitions,
  loadAlisioBootstrapState,
  removeAlisioRemoteModelServer,
  rejectAlisioSharingRequest,
  refreshAlisioAiLimits,
  renameAlisioAiProfile,
  requestAlisioAccountRecoveryEmail,
  requestAlisioSharingAccess,
  revokeAlisioConnectorAuthorization,
  revokeAlisioSharingGrant,
  saveAlisioRemoteModelServer,
  selectAlisioAiProfile,
  selectAlisioRemoteModelServer,
  setAlisioOrganizationState,
  setAlisioSharingPolicy,
  signInAlisioAccount,
  signOutAlisioAccount,
  signUpAlisioAccount,
  updateAlisioAccountPassword,
  updateAlisioAccountProfile,
  verifyAlisioAccountEmailAuth,
} from "../../infra/alisio-store.js";
import { warnLegacyCompatibilityOnce } from "../../infra/compat-warning.js";
import { clearDeviceBootstrapTokens } from "../../infra/device-bootstrap.js";
import { listDevicePairing, revokeDeviceToken } from "../../infra/device-pairing.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import {
  ALISIO_LOCAL_MODEL_BACKEND,
  findAlisioLocalModelCatalogEntry,
} from "../../shared/alisio-local-models.js";
import { GATEWAY_EVENT_ALISIO_MODELS_OPERATION } from "../events.js";
import { createKnownNodeCatalog, listKnownNodes } from "../node-catalog.js";
import {
  ErrorCodes,
  errorShape,
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
  validateAlisioModelsRuntimeStartParams,
  validateAlisioModelsRuntimeStartResult,
  validateAlisioModelsUninstallParams,
  validateAlisioModelsUninstallResult,
  validateAlisioModelsServerRemoveParams,
  validateAlisioModelsServerRemoveResult,
  validateAlisioModelsServerSaveParams,
  validateAlisioModelsServerSaveResult,
  validateAlisioModelsServerSelectParams,
  validateAlisioModelsServerSelectResult,
  type AlisioModelsRuntimeStartResult,
  type AlisioModelsResult,
  type AlisioProvidersResult,
  validateAlisioModelsResult,
  validateAlisioBootstrapResult,
  validateAlisioConnectorsBeginParams,
  validateAlisioConnectorsCatalogParams,
  validateAlisioConnectorsCompleteParams,
  validateAlisioConnectorsListParams,
  validateAlisioConnectorsRevokeParams,
  validateAlisioDoctorSummaryParams,
  validateAlisioDoctorSummaryResult,
  validateAlisioProvidersGetParams,
  validateAlisioProvidersResult,
  validateAlisioRuntimeRestartParams,
  validateAlisioRuntimeRestartResult,
  validateAlisioOrganizationGetParams,
  validateAlisioOrganizationSetParams,
  type AlisioSharingState,
  validateAlisioSharingApproveParams,
  validateAlisioSharingApproveResult,
  validateAlisioSharingGetParams,
  validateAlisioSharingPolicySetParams,
  validateAlisioSharingPolicySetResult,
  validateAlisioSharingRejectParams,
  validateAlisioSharingRejectResult,
  validateAlisioSharingRequestParams,
  validateAlisioSharingRequestResult,
  validateAlisioSharingRevokeParams,
  validateAlisioSharingRevokeResult,
  validateAlisioSharingState,
} from "../protocol/index.js";
import { formatError } from "../server-utils.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";

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

const LEGACY_SHARING_METHOD_REPLACEMENTS = {
  "alisio.sharing.get": "devices.list",
  "alisio.sharing.request": "devices.share.request",
  "alisio.sharing.approve": "devices.share.approve",
  "alisio.sharing.reject": 'devices.share.approve with { decision: "denied" }',
  "alisio.sharing.revoke": "devices.share.revoke",
  "alisio.sharing.policy.set": "devices.policy.set",
} as const;

function warnOnLegacySharingMethodUse(
  method: keyof typeof LEGACY_SHARING_METHOD_REPLACEMENTS,
): void {
  warnLegacyCompatibilityOnce({
    key: `gateway-method:${method}`,
    message: `Gateway method "${method}" is deprecated.`,
    replacement: LEGACY_SHARING_METHOD_REPLACEMENTS[method],
  });
}

const LEGACY_CONNECTOR_METHODS = [
  "alisio.connectors.catalog",
  "alisio.connectors.list",
  "alisio.connectors.begin",
  "alisio.connectors.complete",
  "alisio.connectors.revoke",
] as const;

function warnOnLegacyConnectorMethodUse(method: (typeof LEGACY_CONNECTOR_METHODS)[number]): void {
  warnLegacyCompatibilityOnce({
    key: `gateway-method:${method}`,
    message: `Gateway method "${method}" is deprecated legacy connector compatibility.`,
  });
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
    servers: snapshot.servers,
  };
}

async function loadAlisioSharingStateForContext(
  context: Pick<GatewayRequestContext, "nodeRegistry">,
): Promise<AlisioSharingState> {
  const account = await getAlisioAccountState();
  const currentDevice = account.devices.find((device) => device.current) ?? account.devices[0];
  const pairing = await listDevicePairing();
  const catalog = createKnownNodeCatalog({
    pairedDevices: pairing.paired,
    connectedNodes: context.nodeRegistry.listConnected(),
  });
  const knownNodes = listKnownNodes(catalog);
  return await getAlisioSharingState({
    targets: [
      ...(currentDevice
        ? [
            {
              targetId: currentDevice.id,
              label: currentDevice.label,
              platform: currentDevice.platform,
              sourceKind: "current" as const,
              connected: true,
              current: true,
            },
          ]
        : []),
      ...knownNodes.map((node) => ({
        targetId: node.nodeId,
        label: node.displayName ?? node.nodeId,
        platform: node.platform,
        sourceKind: "node" as const,
        connected: node.connected === true,
        current: false,
      })),
    ],
  });
}

function broadcastLocalModelOperation(
  context: GatewayRequestContext,
  payload: LocalModelOperationEvent,
) {
  context.broadcast(GATEWAY_EVENT_ALISIO_MODELS_OPERATION, payload, { dropIfSlow: true });
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
    currentTargets.find((target) => target.runtimeKind === "ollama" && target.supportsInstall) ??
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
  if (target.runtimeKind === "ollama") {
    return node.capabilities.some((capability) => capability.id === "model.manage.ollama.v1")
      ? "model.manage.ollama.v1"
      : null;
  }
  if (target.runtimeKind !== ALISIO_LOCAL_MODEL_BACKEND) {
    return null;
  }
  return node.capabilities.some((capability) => capability.id === "model.manage.llamacpp.v1")
    ? "model.manage.llamacpp.v1"
    : null;
}

function resolveRemoteManageUnavailableMessage(
  target: AlisioModelsResult["targets"][number],
  action: "install" | "uninstall",
) {
  if (target.runtimeKind === "ollama") {
    return `target device does not support Ollama model ${action === "install" ? "installation" : "removal"}`;
  }
  return `target device does not support local model ${action === "install" ? "installation" : "uninstallation"}`;
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
    respond(true, await getAlisioAccountState(), undefined);
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
  "alisio.account.completeEmailLinkAuth": async ({ params, respond }) => {
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
      respond(
        true,
        await completeAlisioAccountEmailLinkAuth(
          {
            accessToken: params.accessToken,
            refreshToken: params.refreshToken,
            expiresIn: params.expiresIn,
            tokenType: params.tokenType,
          },
          process.env,
        ),
        undefined,
      );
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
  "alisio.account.verifyEmailAuth": async ({ params, respond }) => {
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
      respond(
        true,
        await verifyAlisioAccountEmailAuth(
          {
            email: params.email,
            code: params.code,
          },
          process.env,
        ),
        undefined,
      );
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
  "alisio.account.signUp": async ({ params, respond }) => {
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
      respond(
        true,
        await signUpAlisioAccount(
          {
            email: params.email,
            password: params.password,
            ...(typeof params.callbackUrl === "string" ? { callbackUrl: params.callbackUrl } : {}),
          },
          process.env,
        ),
        undefined,
      );
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
  "alisio.account.signIn": async ({ params, respond }) => {
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
      respond(
        true,
        await signInAlisioAccount(
          {
            email: params.email,
            password: params.password,
          },
          process.env,
        ),
        undefined,
      );
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
      const wizardSessionId = context.findRunningWizard();
      const runtimeSetup = await loadAlisioRuntimeSetupState(context);
      const providerReady = resolveAlisioRuntimeProviderReady(runtimeSetup);
      const [{ models }, { snapshot, summary }] = await Promise.all([
        Promise.resolve(runtimeSetup),
        loadAlisioBootstrapState({
          wizardRunning: Boolean(wizardSessionId),
          providerReady,
          connectionRequired: false,
        }),
      ]);
      const result = {
        ...summary,
        account: snapshot.account,
        ai: snapshot.ai,
        organization: snapshot.organization,
        connectors: snapshot.connectors,
        wizard: {
          running: Boolean(wizardSessionId),
          sessionId: wizardSessionId,
        },
        models,
      };
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
      if (selectedTarget.access === "shared") {
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
          !(selectedTarget.runtimeKind === "ollama" && selectedTarget.supportsInstall) &&
          (!findAlisioLocalModelCatalogEntry(params.modelId) ||
            findAlisioLocalModelCatalogEntry(params.modelId)?.releaseStage !== "published")
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
        if (selectedTarget.runtimeKind === "ollama" && selectedTarget.supportsInstall) {
          await localModelRuntime.installOllamaLocalModel({
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
        } else {
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
        }
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
          selectedTarget.runtimeKind !== "ollama" &&
          (!findAlisioLocalModelCatalogEntry(params.modelId) ||
            findAlisioLocalModelCatalogEntry(params.modelId)?.releaseStage !== "published")
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
      if (selectedTarget.access === "shared") {
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
        broadcastLocalModelOperation(context, {
          targetId: selectedTarget.targetId,
          modelId: params.modelId,
          action: "uninstall",
          phase: "started",
        });
        if (selectedTarget.runtimeKind === "ollama" && selectedTarget.supportsUninstall) {
          await localModelRuntime.uninstallOllamaLocalModel({
            modelId: params.modelId,
            env: process.env,
          });
        } else {
          await uninstallAlisioLocalModel({
            modelId: params.modelId,
            env: process.env,
          });
        }
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
  "alisio.models.runtime.start": async ({ params, respond, context }) => {
    if (!validateAlisioModelsRuntimeStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.models.runtime.start params: ${formatValidationErrors(
            validateAlisioModelsRuntimeStartParams.errors,
          )}`,
        ),
      );
      return;
    }

    try {
      const publishedModels = await publishAlisioDynamicModelProvidersForContext(context, {
        force: true,
      });
      const selectedTarget =
        params.targetId === "current" || params.targetId === "local"
          ? publishedModels.targets.find(
              (target) => target.current && target.runtimeKind === "lmstudio",
            )
          : publishedModels.targets.find((target) => target.targetId === params.targetId);
      if (!selectedTarget) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "target device unavailable"),
        );
        return;
      }
      if (selectedTarget.access === "shared") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "shared devices are read-only"),
        );
        return;
      }
      if (selectedTarget.runtimeKind !== "lmstudio" || !selectedTarget.capabilities.startServer) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            "target device does not support starting a model server",
          ),
        );
        return;
      }

      let startResult: Omit<AlisioModelsRuntimeStartResult, "ok" | "targetId" | "runtimeKind">;
      if (selectedTarget.current) {
        const localResult = await startLmStudioLocalServer({ env: process.env });
        startResult = {
          baseUrl: localResult.baseUrl,
          alreadyRunning: localResult.alreadyRunning,
        };
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
        if (
          !node.capabilities.some(
            (capability) => capability.id === "model.server.start.lmstudio.v1",
          )
        ) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              "target device does not support starting the LM Studio server",
            ),
          );
          return;
        }
        const task = context.nodeRegistry.startTask({
          nodeId: node.nodeId,
          capabilityId: "model.server.start.lmstudio.v1",
          input: {},
          timeoutMs: 30_000,
        });
        if (!task.ok) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, task.error.message));
          return;
        }
        const taskResult = await task.result;
        if (!taskResult.ok) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              taskResult.error?.message ?? "failed to start LM Studio server",
            ),
          );
          return;
        }
        const payload = taskResult.payloadJSON
          ? safeParseJson(taskResult.payloadJSON)
          : taskResult.payload;
        const payloadObject =
          payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
        const baseUrl =
          typeof payloadObject?.baseUrl === "string"
            ? payloadObject.baseUrl
            : (localModelRuntime.resolveCurrentRuntimeBaseUrlForKind({
                runtimeKind: "lmstudio",
                env: process.env,
              }) ?? "http://127.0.0.1:1234");
        startResult = {
          baseUrl,
          alreadyRunning: payloadObject?.alreadyRunning === true,
        };
      }

      clearAlisioModelProviderSnapshotCache();
      const result: AlisioModelsRuntimeStartResult = {
        ok: true,
        targetId: selectedTarget.targetId,
        runtimeKind: "lmstudio",
        baseUrl: startResult.baseUrl,
        alreadyRunning: startResult.alreadyRunning,
      };
      if (!validateAlisioModelsRuntimeStartResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.models.runtime.start result: ${formatValidationErrors(
              validateAlisioModelsRuntimeStartResult.errors,
            )}`,
          ),
        );
        return;
      }
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to start model server: ${formatError(error)}`),
      );
    }
  },
  "alisio.models.server.save": async ({ params, respond }) => {
    if (!validateAlisioModelsServerSaveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.models.server.save params: ${formatValidationErrors(
            validateAlisioModelsServerSaveParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await saveAlisioRemoteModelServer(
        {
          serverId: params.serverId?.trim() || undefined,
          label: params.label,
          kind: params.kind,
          baseUrl: params.baseUrl,
          apiKey: params.apiKey,
          clearApiKey: params.clearApiKey,
        },
        process.env,
      );
      const payload = { ok: true as const, serverId: result.serverId };
      if (!validateAlisioModelsServerSaveResult(payload)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.models.server.save result: ${formatValidationErrors(
              validateAlisioModelsServerSaveResult.errors,
            )}`,
          ),
        );
        return;
      }
      clearAlisioModelProviderSnapshotCache();
      respond(true, payload, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatError(err)));
    }
  },
  "alisio.models.server.remove": async ({ params, respond }) => {
    if (!validateAlisioModelsServerRemoveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.models.server.remove params: ${formatValidationErrors(
            validateAlisioModelsServerRemoveParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const removed = await removeAlisioRemoteModelServer(
        { serverId: params.serverId },
        process.env,
      );
      const payload = { ok: true as const, serverId: removed.serverId };
      if (!validateAlisioModelsServerRemoveResult(payload)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.models.server.remove result: ${formatValidationErrors(
              validateAlisioModelsServerRemoveResult.errors,
            )}`,
          ),
        );
        return;
      }
      clearAlisioModelProviderSnapshotCache();
      respond(true, payload, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to remove remote server: ${formatError(err)}`),
      );
    }
  },
  "alisio.models.server.select": async ({ params, respond }) => {
    if (!validateAlisioModelsServerSelectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.models.server.select params: ${formatValidationErrors(
            validateAlisioModelsServerSelectParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const selected = await selectAlisioRemoteModelServer(
        { serverId: params.serverId },
        process.env,
      );
      const payload = { ok: true as const, serverId: selected.serverId };
      if (!validateAlisioModelsServerSelectResult(payload)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.models.server.select result: ${formatValidationErrors(
              validateAlisioModelsServerSelectResult.errors,
            )}`,
          ),
        );
        return;
      }
      clearAlisioModelProviderSnapshotCache();
      respond(true, payload, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatError(err)));
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
      const wizardSessionId = context.findRunningWizard();
      const runtimeSetup = await loadAlisioRuntimeSetupState(context);
      const providerReady = resolveAlisioRuntimeProviderReady(runtimeSetup);
      const bootstrapStatePromise = loadAlisioBootstrapState({
        wizardRunning: wizardSessionId !== null,
        providerReady,
        connectionRequired: false,
      });
      const doctorSummaryPromise = bootstrapStatePromise.then(({ summary }) =>
        getAlisioDoctorSummary({
          wizardRunning: wizardSessionId !== null,
          providerReady,
          connectionRequired: false,
          bootstrap: summary,
        }),
      );
      const [{ snapshot, summary: bootstrapSummary }, doctorSummary] = await Promise.all([
        bootstrapStatePromise,
        doctorSummaryPromise,
      ]);
      const bootstrap = {
        ...bootstrapSummary,
        account: snapshot.account,
        ai: snapshot.ai,
        organization: snapshot.organization,
        connectors: snapshot.connectors,
        wizard: {
          running: wizardSessionId !== null,
          sessionId: wizardSessionId,
        },
        models: runtimeSetup.models,
      };
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
    try {
      const result = await loadAlisioProviderOverview({
        nodeRegistry: context.nodeRegistry,
      });
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
  "alisio.sharing.get": async ({ params, respond, context }) => {
    warnOnLegacySharingMethodUse("alisio.sharing.get");
    if (!validateAlisioSharingGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.sharing.get params: ${formatValidationErrors(
            validateAlisioSharingGetParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await loadAlisioSharingStateForContext(context);
      if (!validateAlisioSharingState(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.sharing.get result: ${formatValidationErrors(
              validateAlisioSharingState.errors,
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
          `failed to load Alisio sharing state: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.sharing.request": async ({ params, respond }) => {
    warnOnLegacySharingMethodUse("alisio.sharing.request");
    if (!validateAlisioSharingRequestParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.sharing.request params: ${formatValidationErrors(
            validateAlisioSharingRequestParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await requestAlisioSharingAccess({
        targetId: params.targetId,
        scopes: params.scopes,
      });
      if (!validateAlisioSharingRequestResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.sharing.request result: ${formatValidationErrors(
              validateAlisioSharingRequestResult.errors,
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
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatError(err)));
    }
  },
  "alisio.sharing.approve": async ({ params, respond }) => {
    warnOnLegacySharingMethodUse("alisio.sharing.approve");
    if (!validateAlisioSharingApproveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.sharing.approve params: ${formatValidationErrors(
            validateAlisioSharingApproveParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await approveAlisioSharingRequest({
        requestId: params.requestId,
      });
      if (!validateAlisioSharingApproveResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.sharing.approve result: ${formatValidationErrors(
              validateAlisioSharingApproveResult.errors,
            )}`,
          ),
        );
        return;
      }
      clearAlisioModelProviderSnapshotCache();
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatError(err)));
    }
  },
  "alisio.sharing.reject": async ({ params, respond }) => {
    warnOnLegacySharingMethodUse("alisio.sharing.reject");
    if (!validateAlisioSharingRejectParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.sharing.reject params: ${formatValidationErrors(
            validateAlisioSharingRejectParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await rejectAlisioSharingRequest({
        requestId: params.requestId,
      });
      if (!validateAlisioSharingRejectResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.sharing.reject result: ${formatValidationErrors(
              validateAlisioSharingRejectResult.errors,
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
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatError(err)));
    }
  },
  "alisio.sharing.revoke": async ({ params, respond }) => {
    warnOnLegacySharingMethodUse("alisio.sharing.revoke");
    if (!validateAlisioSharingRevokeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.sharing.revoke params: ${formatValidationErrors(
            validateAlisioSharingRevokeParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await revokeAlisioSharingGrant({
        grantId: params.grantId,
      });
      if (!validateAlisioSharingRevokeResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.sharing.revoke result: ${formatValidationErrors(
              validateAlisioSharingRevokeResult.errors,
            )}`,
          ),
        );
        return;
      }
      clearAlisioModelProviderSnapshotCache();
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatError(err)));
    }
  },
  "alisio.sharing.policy.set": async ({ params, respond }) => {
    warnOnLegacySharingMethodUse("alisio.sharing.policy.set");
    if (!validateAlisioSharingPolicySetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.sharing.policy.set params: ${formatValidationErrors(
            validateAlisioSharingPolicySetParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await setAlisioSharingPolicy({
        ...(params.allowExternalUse !== undefined
          ? { allowExternalUse: params.allowExternalUse }
          : {}),
        ...(params.resourcePolicies ? { resourcePolicies: params.resourcePolicies } : {}),
      });
      if (!validateAlisioSharingPolicySetResult(result)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid alisio.sharing.policy.set result: ${formatValidationErrors(
              validateAlisioSharingPolicySetResult.errors,
            )}`,
          ),
        );
        return;
      }
      clearAlisioModelProviderSnapshotCache();
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof AlisioAccountValidationError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatError(err)));
    }
  },
  "alisio.connectors.catalog": async ({ params, respond }) => {
    warnOnLegacyConnectorMethodUse("alisio.connectors.catalog");
    if (!validateAlisioConnectorsCatalogParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.connectors.catalog params: ${formatValidationErrors(
            validateAlisioConnectorsCatalogParams.errors,
          )}`,
        ),
      );
      return;
    }
    respond(true, { connectors: listAlisioConnectorDefinitions() }, undefined);
  },
  "alisio.connectors.list": async ({ params, respond }) => {
    warnOnLegacyConnectorMethodUse("alisio.connectors.list");
    if (!validateAlisioConnectorsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.connectors.list params: ${formatValidationErrors(
            validateAlisioConnectorsListParams.errors,
          )}`,
        ),
      );
      return;
    }
    respond(true, { authorizations: await listAlisioConnectorAuthorizations() }, undefined);
  },
  "alisio.connectors.begin": async ({ params, respond }) => {
    warnOnLegacyConnectorMethodUse("alisio.connectors.begin");
    if (!validateAlisioConnectorsBeginParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.connectors.begin params: ${formatValidationErrors(
            validateAlisioConnectorsBeginParams.errors,
          )}`,
        ),
      );
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
  "alisio.connectors.complete": async ({ params, respond }) => {
    warnOnLegacyConnectorMethodUse("alisio.connectors.complete");
    if (!validateAlisioConnectorsCompleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.connectors.complete params: ${formatValidationErrors(
            validateAlisioConnectorsCompleteParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const result = await completeAlisioConnectorAuthorization(params as never);
      if (!result) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "connector cannot be completed in this environment",
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
          `failed to complete Alisio connector setup: ${formatError(err)}`,
        ),
      );
    }
  },
  "alisio.connectors.revoke": async ({ params, respond }) => {
    warnOnLegacyConnectorMethodUse("alisio.connectors.revoke");
    if (!validateAlisioConnectorsRevokeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid alisio.connectors.revoke params: ${formatValidationErrors(
            validateAlisioConnectorsRevokeParams.errors,
          )}`,
        ),
      );
      return;
    }
    const result = await revokeAlisioConnectorAuthorization(
      (params as { connectorId: string }).connectorId,
    );
    if (!result) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown connectorId"));
      return;
    }
    respond(true, result, undefined);
  },
};
