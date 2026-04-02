import { loadAlisioRuntimeSetupState } from "../../infra/alisio-runtime.js";
import {
  AlisioAccountValidationError,
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorization,
  getAlisioBootstrapSummary,
  getAlisioDoctorSummary,
  getAlisioAccountState,
  getAlisioOrganizationState,
  listAlisioConnectorAuthorizations,
  listAlisioConnectorDefinitions,
  loadAlisioBootstrapSnapshot,
  revokeAlisioConnectorAuthorization,
  setAlisioOrganizationState,
  signInAlisioAccount,
  signOutAlisioAccount,
  signUpAlisioAccount,
  updateAlisioAccountProfile,
} from "../../infra/alisio-store.js";
import { clearDeviceBootstrapTokens } from "../../infra/device-bootstrap.js";
import { revokeDeviceToken } from "../../infra/device-pairing.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAlisioAccountGetParams,
  validateAlisioAccountSignInParams,
  validateAlisioAccountSignOutParams,
  validateAlisioAccountSignUpParams,
  validateAlisioAccountUpdateParams,
  validateAlisioBootstrapGetParams,
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
    respond(true, await signUpAlisioAccount(), undefined);
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
    const result = await signInAlisioAccount();
    if (!result) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "no saved Alisio account is available on this device"),
      );
      return;
    }
    respond(true, result, undefined);
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
      const [{ models }, snapshot, summary] = await Promise.all([
        Promise.resolve(runtimeSetup),
        loadAlisioBootstrapSnapshot(),
        getAlisioBootstrapSummary({
          providerReady: runtimeSetup.providerReady,
          wizardRunning: Boolean(wizardSessionId),
          connectionRequired: false,
        }),
      ]);
      const result = {
        ...summary,
        account: snapshot.account,
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
      const [snapshot, bootstrapSummary, doctorSummary] = await Promise.all([
        loadAlisioBootstrapSnapshot(),
        getAlisioBootstrapSummary({
          providerReady: runtimeSetup.providerReady,
          wizardRunning: wizardSessionId !== null,
          connectionRequired: false,
        }),
        getAlisioDoctorSummary({
          providerReady: runtimeSetup.providerReady,
          wizardRunning: wizardSessionId !== null,
          connectionRequired: false,
        }),
      ]);
      const bootstrap = {
        ...bootstrapSummary,
        account: snapshot.account,
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
