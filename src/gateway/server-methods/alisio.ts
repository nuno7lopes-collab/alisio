import { AlisioAccountCloudError } from "../../infra/alisio-account-cloud.js";
import { AlisioAiError } from "../../infra/alisio-ai.js";
import {
  inspectManagedLocalModelRuntime,
  installAlisioLocalModel,
} from "../../infra/alisio-local-llama-runtime.js";
import { loadAlisioRuntimeSetupState } from "../../infra/alisio-runtime.js";
import {
  AlisioAccountValidationError,
  beginAlisioConnectorSetup,
  beginAlisioAiConnect,
  completeAlisioConnectorAuthorization,
  completeAlisioAiConnect,
  disconnectAlisioAi,
  getAlisioDoctorSummary,
  getAlisioAccountState,
  getAlisioAiState,
  getAlisioOrganizationState,
  listAlisioConnectorAuthorizations,
  listAlisioConnectorDefinitions,
  listAlisioRemoteModelServers,
  loadAlisioBootstrapState,
  removeAlisioRemoteModelServer,
  refreshAlisioAiLimits,
  renameAlisioAiProfile,
  requestAlisioAccountPasswordReset,
  revokeAlisioConnectorAuthorization,
  saveAlisioRemoteModelServer,
  selectAlisioAiProfile,
  selectAlisioRemoteModelServer,
  setAlisioOrganizationState,
  signInAlisioAccount,
  signOutAlisioAccount,
  signUpAlisioAccount,
  updateAlisioAccountProfile,
} from "../../infra/alisio-store.js";
import { clearDeviceBootstrapTokens } from "../../infra/device-bootstrap.js";
import { revokeDeviceToken } from "../../infra/device-pairing.js";
import {
  summarizeHardwareRecommendation,
  type AlisioModelHardwareProfile,
} from "../../infra/model-hardware.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import {
  ALISIO_LOCAL_MODEL_BACKEND,
  findAlisioLocalModelCatalogEntry,
  listPublishedAlisioLocalModels,
} from "../../shared/alisio-local-models.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAlisioAccountGetParams,
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
  validateAlisioModelsServerRemoveParams,
  validateAlisioModelsServerRemoveResult,
  validateAlisioModelsServerSaveParams,
  validateAlisioModelsServerSaveResult,
  validateAlisioModelsServerSelectParams,
  validateAlisioModelsServerSelectResult,
  validateAlisioModelsResult,
  validateAlisioBootstrapResult,
  validateAlisioConnectorsBeginParams,
  validateAlisioConnectorsCatalogParams,
  validateAlisioConnectorsCompleteParams,
  validateAlisioConnectorsListParams,
  validateAlisioConnectorsRevokeParams,
  validateAlisioDoctorSummaryParams,
  validateAlisioDoctorSummaryResult,
  validateAlisioRuntimeRestartParams,
  validateAlisioRuntimeRestartResult,
  validateAlisioOrganizationGetParams,
  validateAlisioOrganizationSetParams,
} from "../protocol/index.js";
import { formatError } from "../server-utils.js";
import type { GatewayRequestHandlers } from "./types.js";

type RemoteServerInspection = {
  status: "ready" | "not_configured" | "error";
  message?: string;
  models: Array<{ id: string; name: string; ownedBy?: string }>;
};

function normalizeRemoteServerModels(payload: unknown, kind: "openai-compatible" | "ollama") {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (kind === "ollama") {
    const models = Array.isArray((payload as { models?: unknown[] }).models)
      ? ((payload as { models?: unknown[] }).models ?? [])
      : [];
    return models.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const name =
        typeof (entry as { name?: unknown }).name === "string"
          ? (entry as { name: string }).name.trim()
          : "";
      if (!name) {
        return [];
      }
      return [{ id: name, name, ownedBy: "ollama" }];
    });
  }

  const data = Array.isArray((payload as { data?: unknown[] }).data)
    ? ((payload as { data?: unknown[] }).data ?? [])
    : [];
  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const id =
      typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id.trim() : "";
    if (!id) {
      return [];
    }
    return [
      {
        id,
        name: id,
        ownedBy:
          typeof (entry as { owned_by?: unknown }).owned_by === "string"
            ? (entry as { owned_by: string }).owned_by.trim() || undefined
            : undefined,
      },
    ];
  });
}

function resolveRemoteServerModelUrls(baseUrl: string, kind: "openai-compatible" | "ollama") {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  if (kind === "ollama") {
    return normalizedBaseUrl.endsWith("/api")
      ? [`${normalizedBaseUrl}/tags`]
      : [`${normalizedBaseUrl}/api/tags`];
  }
  return normalizedBaseUrl.endsWith("/v1")
    ? [`${normalizedBaseUrl}/models`]
    : [`${normalizedBaseUrl}/models`, `${normalizedBaseUrl}/v1/models`];
}

async function inspectRemoteModelServer(server: {
  kind: "openai-compatible" | "ollama";
  baseUrl: string;
  apiKey?: string;
}): Promise<RemoteServerInspection> {
  const headers: Record<string, string> = {};
  if (server.apiKey?.trim()) {
    headers.authorization = `Bearer ${server.apiKey.trim()}`;
  }
  let lastError = "server did not respond";
  for (const endpoint of resolveRemoteServerModelUrls(server.baseUrl, server.kind)) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`.trim();
        continue;
      }
      const payload = (await response.json()) as unknown;
      return {
        status: "ready",
        models: normalizeRemoteServerModels(payload, server.kind),
      };
    } catch (error) {
      lastError = String(error);
    }
  }
  return {
    status: "error",
    message: lastError,
    models: [],
  };
}

function buildTargetRecommendations(params: {
  hardware?: AlisioModelHardwareProfile;
  catalog: ReturnType<typeof listPublishedAlisioLocalModels>;
}) {
  if (!params.hardware) {
    return {
      recommendations: [],
      bestModelId: undefined,
      bestModelName: undefined,
    };
  }
  const summarized = summarizeHardwareRecommendation(params.hardware, params.catalog);
  return {
    recommendations: summarized.recommendations,
    bestModelId: summarized.bestModel?.id,
    bestModelName: summarized.bestModel?.name,
  };
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
      const result = await requestAlisioAccountPasswordReset({ email: params.email }, process.env);
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
          `failed to start Alisio password recovery: ${formatError(err)}`,
        ),
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
      if (err instanceof AlisioAccountCloudError) {
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
      const [{ models }, { snapshot, summary }] = await Promise.all([
        Promise.resolve(runtimeSetup),
        loadAlisioBootstrapState({
          wizardRunning: Boolean(wizardSessionId),
          providerReady: runtimeSetup.providerReady,
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
      const account = await getAlisioAccountState();
      const currentDevice = account.devices.find((device) => device.current) ?? account.devices[0];
      const currentInspection = await inspectManagedLocalModelRuntime(process.env);
      const catalog = listPublishedAlisioLocalModels();
      const currentRecommendations = buildTargetRecommendations({
        hardware: currentInspection.hardware,
        catalog,
      });
      const targets = [
        {
          targetId: currentDevice?.id ?? "current",
          label: currentDevice?.label ?? "This computer",
          platform: currentDevice?.platform,
          current: true,
          connected: true,
          backend: ALISIO_LOCAL_MODEL_BACKEND,
          runtimeStatus: currentInspection.status,
          runtimeMessage: currentInspection.message,
          installedModels: currentInspection.models,
          hardware: currentInspection.hardware,
          recommendations: currentRecommendations.recommendations,
          bestModelId: currentRecommendations.bestModelId,
          bestModelName: currentRecommendations.bestModelName,
        },
        ...(await Promise.all(
          context.nodeRegistry.listConnected().map(async (node) => {
            const supportsLlamaCatalog = node.capabilities.some(
              (capability) => capability.id === "model.catalog.llamacpp.v1",
            );
            const supportsOpenAiCatalog = node.capabilities.some(
              (capability) => capability.id === "model.catalog.openai.v1",
            );
            const capabilityId = supportsLlamaCatalog
              ? "model.catalog.llamacpp.v1"
              : supportsOpenAiCatalog
                ? "model.catalog.openai.v1"
                : null;
            if (!capabilityId) {
              return {
                targetId: node.nodeId,
                label: node.displayName ?? node.platform ?? node.nodeId,
                platform: node.platform,
                current: false,
                connected: true,
                backend: ALISIO_LOCAL_MODEL_BACKEND,
                runtimeStatus: "not_configured" as const,
                runtimeMessage: "local model runtime not configured on this computer",
                installedModels: [],
                recommendations: [],
              };
            }

            const task = context.nodeRegistry.startTask({
              nodeId: node.nodeId,
              capabilityId,
              input: {},
              timeoutMs: 5_000,
            });
            if (!task.ok) {
              return {
                targetId: node.nodeId,
                label: node.displayName ?? node.platform ?? node.nodeId,
                platform: node.platform,
                current: false,
                connected: true,
                backend: ALISIO_LOCAL_MODEL_BACKEND,
                runtimeStatus: "error" as const,
                runtimeMessage: task.error.message,
                installedModels: [],
                recommendations: [],
              };
            }

            const result: Awaited<typeof task.result> = await task.result.catch((error) => ({
              ok: false,
              error: { message: String(error) },
            }));
            const payload =
              result.ok &&
              "payload" in result &&
              typeof result.payload === "object" &&
              result.payload !== null
                ? (result.payload as {
                    status?: "ready" | "not_configured" | "error";
                    message?: string;
                    models?: Array<{ id?: string; name?: string; ownedBy?: string }>;
                    hardware?: AlisioModelHardwareProfile;
                  })
                : null;
            const recommendations = buildTargetRecommendations({
              hardware: payload?.hardware,
              catalog,
            });
            return {
              targetId: node.nodeId,
              label: node.displayName ?? node.platform ?? node.nodeId,
              platform: node.platform,
              current: false,
              connected: true,
              backend: ALISIO_LOCAL_MODEL_BACKEND,
              runtimeStatus: payload?.status ?? "error",
              runtimeMessage:
                payload?.message ??
                result.error?.message ??
                (!result.ok ? "failed to read local model runtime" : undefined),
              installedModels:
                payload?.models?.filter(
                  (model): model is { id: string; name: string; ownedBy?: string } =>
                    typeof model?.id === "string" && typeof model?.name === "string",
                ) ?? [],
              hardware: payload?.hardware,
              recommendations: recommendations.recommendations,
              bestModelId: recommendations.bestModelId,
              bestModelName: recommendations.bestModelName,
            };
          }),
        )),
      ];
      const servers = await Promise.all(
        (await listAlisioRemoteModelServers(process.env)).map(async (server) => {
          const inspection = await inspectRemoteModelServer(server);
          return {
            serverId: server.serverId,
            label: server.label,
            kind: server.kind,
            baseUrl: server.baseUrl,
            active: server.active,
            hasApiKey: Boolean(server.apiKey?.trim() || server.apiKeyEncrypted),
            status: inspection.status,
            message: inspection.message,
            models: inspection.models,
          };
        }),
      );
      const result = {
        backend: ALISIO_LOCAL_MODEL_BACKEND,
        catalog: catalog.map(({ sourceUri: _sourceUri, ...entry }) => entry),
        targets,
        servers,
      };
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

    const catalogEntry = findAlisioLocalModelCatalogEntry(params.modelId);
    if (!catalogEntry || catalogEntry.releaseStage !== "published") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown local model"));
      return;
    }

    try {
      const account = await getAlisioAccountState();
      const currentDevice = account.devices.find((device) => device.current) ?? account.devices[0];
      const installCurrentTarget =
        params.targetId === "current" ||
        params.targetId === "local" ||
        params.targetId === currentDevice?.id;

      if (installCurrentTarget) {
        await installAlisioLocalModel({
          modelId: params.modelId,
          env: process.env,
        });
      } else {
        const node = context.nodeRegistry.get(params.targetId);
        if (!node) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "target computer not connected"),
          );
          return;
        }
        if (!node.capabilities.some((capability) => capability.id === "model.manage.llamacpp.v1")) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              "target computer does not support local model installation",
            ),
          );
          return;
        }

        const task = context.nodeRegistry.startTask({
          nodeId: node.nodeId,
          capabilityId: "model.manage.llamacpp.v1",
          input: {
            action: "install",
            modelId: params.modelId,
          },
          timeoutMs: 1_800_000,
        });
        if (!task.ok) {
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, task.error.message));
          return;
        }
        const result = await task.result;
        if (!result.ok) {
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

      const result = {
        ok: true as const,
        backend: ALISIO_LOCAL_MODEL_BACKEND,
        targetId: params.targetId,
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
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to install local model: ${formatError(err)}`),
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
      respond(true, payload, undefined);
    } catch (err) {
      const message = err instanceof AlisioAccountValidationError ? err.message : formatError(err);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
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
      respond(true, payload, undefined);
    } catch (err) {
      const message = err instanceof AlisioAccountValidationError ? err.message : formatError(err);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
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
      const [{ snapshot, summary: bootstrapSummary }, doctorSummary] = await Promise.all([
        loadAlisioBootstrapState({
          wizardRunning: wizardSessionId !== null,
          providerReady: runtimeSetup.providerReady,
          connectionRequired: false,
        }),
        getAlisioDoctorSummary({
          wizardRunning: wizardSessionId !== null,
          providerReady: runtimeSetup.providerReady,
          connectionRequired: false,
        }),
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
    respond(true, await setAlisioOrganizationState(params as never), undefined);
  },
  "alisio.connectors.catalog": async ({ params, respond }) => {
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
    const result = await beginAlisioConnectorSetup((params as { connectorId: string }).connectorId);
    if (!result) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown connectorId"));
      return;
    }
    respond(true, result, undefined);
  },
  "alisio.connectors.complete": async ({ params, respond }) => {
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
    const result = await completeAlisioConnectorAuthorization(params as never);
    if (!result) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "connector cannot be completed in this environment"),
      );
      return;
    }
    respond(true, result, undefined);
  },
  "alisio.connectors.revoke": async ({ params, respond }) => {
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
