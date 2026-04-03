import { clearDeviceAuthToken } from "../device-auth.ts";
import { loadOrCreateDeviceIdentity } from "../device-identity.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  AlisioAccountState,
  AlisioAiState,
  AlisioBootstrapState,
  AlisioConnectorsBeginResult,
  AlisioDoctorSummaryState,
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
  AlisioOrganizationMembershipState,
  WizardNextResult,
  WizardStartResult,
  WizardStatusResult,
  WizardStep,
} from "../types.ts";

export type AlisioState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  tab?: string;
  setTab?: (
    tab: "setup" | "chat" | "connections" | "authentications" | "organization" | "settings",
  ) => void;
  alisioBootstrapLoading: boolean;
  alisioBootstrapError: string | null;
  alisioBootstrap: AlisioBootstrapState | null;
  alisioDoctorLoading: boolean;
  alisioDoctorError: string | null;
  alisioDoctor: AlisioDoctorSummaryState | null;
  alisioAccountLoading: boolean;
  alisioAccountError: string | null;
  alisioAccountNotice: string | null;
  alisioAccount: AlisioAccountState | null;
  alisioAuthMode: "sign-up" | "sign-in";
  alisioAuthEmail: string;
  alisioAuthPassword: string;
  alisioAiLoading: boolean;
  alisioAiError: string | null;
  alisioOrganizationLoading: boolean;
  alisioOrganizationError: string | null;
  alisioOrganization: AlisioOrganizationMembershipState | null;
  alisioConnectorsLoading: boolean;
  alisioConnectorsError: string | null;
  alisioConnectorCatalog: AlisioConnectorDefinition[];
  alisioConnectorAuthorizations: AlisioConnectorAuthorization[];
  alisioConnectorSetupGuide: AlisioConnectorsBeginResult | null;
  setupWizardLoading: boolean;
  setupWizardSubmitting: boolean;
  setupWizardSessionId: string | null;
  setupWizardStep: WizardStep | null;
  setupWizardStatus: string | null;
  setupWizardError: string | null;
  setupWizardDraftText: string;
  setupWizardDraftConfirm: boolean;
  setupWizardDraftSelectIndex: number;
  setupWizardDraftMultiIndexes: number[];
  setupStep?: import("../types.ts").AlisioBootstrapStep | null;
};

function isWizardTerminalStatus(status: string | null | undefined) {
  return status === "done" || status === "cancelled" || status === "error";
}

function valuesEqual(left: unknown, right: unknown) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
}

function shouldForceSetup(bootstrap: AlisioBootstrapState | null | undefined) {
  if (!bootstrap) {
    return false;
  }
  return bootstrap.connectionRequired || bootstrap.startupState !== "ready";
}

function syncWizardDraftState(state: AlisioState, step: WizardStep | null) {
  if (!step) {
    state.setupWizardDraftText = "";
    state.setupWizardDraftConfirm = false;
    state.setupWizardDraftSelectIndex = 0;
    state.setupWizardDraftMultiIndexes = [];
    return;
  }
  state.setupWizardDraftText =
    step.type === "text" && typeof step.initialValue === "string" ? step.initialValue : "";
  state.setupWizardDraftConfirm = step.type === "confirm" ? Boolean(step.initialValue) : false;
  if (Array.isArray(step.options) && step.options.length > 0) {
    const selectIndex = step.options.findIndex((option) =>
      valuesEqual(option.value, step.initialValue),
    );
    state.setupWizardDraftSelectIndex = selectIndex >= 0 ? selectIndex : 0;
    const initialValues = Array.isArray(step.initialValue) ? step.initialValue : [];
    state.setupWizardDraftMultiIndexes = step.options.reduce<number[]>(
      (selected, option, index) => {
        if (initialValues.some((entry) => valuesEqual(entry, option.value))) {
          selected.push(index);
        }
        return selected;
      },
      [],
    );
    return;
  }
  state.setupWizardDraftSelectIndex = 0;
  state.setupWizardDraftMultiIndexes = [];
}

function syncSetupRoute(state: AlisioState) {
  if (typeof state.setTab !== "function") {
    return;
  }
  const activeTab = state.tab ?? "chat";
  const bootstrap = state.alisioBootstrap;
  if (shouldForceSetup(bootstrap) && activeTab !== "setup") {
    state.setupStep = !state.connected
      ? "gateway"
      : bootstrap?.startupState === "signed_out" || bootstrap?.startupState === "needs_profile"
        ? "account"
        : bootstrap?.startupState === "needs_ai"
          ? "runtime"
          : (bootstrap?.nextStep ?? "runtime");
    state.setTab("setup");
    return;
  }
  if (!shouldForceSetup(bootstrap) && activeTab === "setup") {
    state.setTab("chat");
  }
}

function applyBootstrapSnapshot(state: AlisioState, bootstrap: AlisioBootstrapState) {
  state.alisioBootstrap = bootstrap;
  state.alisioAccount = bootstrap.account;
  if (!state.alisioAuthEmail && bootstrap.account.profile.email) {
    state.alisioAuthEmail = bootstrap.account.profile.email;
  }
  state.alisioOrganization = bootstrap.organization;
  state.alisioConnectorCatalog = [...bootstrap.connectors.catalog];
  state.alisioConnectorAuthorizations = [...bootstrap.connectors.authorizations];
  syncSetupRoute(state);
}

function applyWizardResult(
  state: AlisioState,
  result: WizardStartResult | WizardNextResult | WizardStatusResult,
  sessionId?: string | null,
) {
  if ("sessionId" in result) {
    state.setupWizardSessionId = result.sessionId;
  } else if (typeof sessionId === "string" || sessionId === null) {
    state.setupWizardSessionId = sessionId;
  }
  state.setupWizardStatus = result.status ?? ("done" in result && result.done ? "done" : null);
  state.setupWizardError = result.error ?? null;
  if ("step" in result) {
    state.setupWizardStep = result.step ?? null;
  }
  syncWizardDraftState(state, state.setupWizardStep);
  if (("done" in result && result.done) || isWizardTerminalStatus(state.setupWizardStatus)) {
    state.setupWizardSessionId = null;
    state.setupWizardStep = null;
    syncWizardDraftState(state, null);
  }
}

export async function loadAlisioBootstrap(state: AlisioState) {
  if (!state.client || !state.connected || state.alisioBootstrapLoading) {
    return;
  }
  state.alisioBootstrapLoading = true;
  state.alisioBootstrapError = null;
  try {
    const result = await state.client.request<AlisioBootstrapState>("alisio.bootstrap.get", {});
    applyBootstrapSnapshot(state, result);
    state.setupWizardSessionId = result.wizard.sessionId;
    state.setupWizardStatus = result.wizard.running ? "running" : null;
    if (result.wizard.running && result.wizard.sessionId && !state.setupWizardStep) {
      try {
        const wizardResult = await state.client.request<WizardNextResult>("wizard.next", {
          sessionId: result.wizard.sessionId,
        });
        applyWizardResult(state, wizardResult, result.wizard.sessionId);
      } catch (error) {
        state.setupWizardError = String(error);
      }
    } else if (!result.wizard.running) {
      state.setupWizardStep = null;
      syncWizardDraftState(state, null);
    }
  } catch (error) {
    state.alisioBootstrapError = String(error);
  } finally {
    state.alisioBootstrapLoading = false;
  }
}

export async function loadAlisioDoctorSummary(state: AlisioState) {
  if (!state.client || !state.connected || state.alisioDoctorLoading) {
    return;
  }
  state.alisioDoctorLoading = true;
  state.alisioDoctorError = null;
  try {
    state.alisioDoctor = await state.client.request<AlisioDoctorSummaryState>(
      "alisio.doctor.summary",
      {},
    );
  } catch (error) {
    state.alisioDoctorError = String(error);
  } finally {
    state.alisioDoctorLoading = false;
  }
}

export async function loadAlisioAccount(state: AlisioState) {
  if (!state.client || !state.connected || state.alisioAccountLoading) {
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    state.alisioAccount = await state.client.request<AlisioAccountState>("alisio.account.get", {});
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    state.alisioAccountError = String(error);
  } finally {
    state.alisioAccountLoading = false;
  }
}

export async function signUpAlisioAccount(state: AlisioState) {
  if (state.alisioAccountLoading) {
    return;
  }
  if (!state.client || !state.connected) {
    state.alisioAccountError =
      "Alisio is still reconnecting. Wait a moment, then try creating your account again.";
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    const email = state.alisioAuthEmail.trim();
    const password = state.alisioAuthPassword;
    state.alisioAccount = await state.client.request<AlisioAccountState>("alisio.account.signUp", {
      email,
      password,
    });
    state.alisioAuthMode = "sign-in";
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    state.alisioAccountError = String(error);
  } finally {
    state.alisioAccountLoading = false;
  }
}

export async function signInAlisioAccount(state: AlisioState) {
  if (state.alisioAccountLoading) {
    return;
  }
  if (!state.client || !state.connected) {
    state.alisioAccountError =
      "Alisio is still reconnecting. Wait a moment, then try signing in again.";
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    const email = state.alisioAuthEmail.trim();
    const password = state.alisioAuthPassword;
    state.alisioAccount = await state.client.request<AlisioAccountState>("alisio.account.signIn", {
      email,
      password,
    });
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    state.alisioAccountError = String(error);
  } finally {
    state.alisioAccountLoading = false;
  }
}

export async function saveAlisioAccount(
  state: AlisioState,
  patch: {
    username?: string;
    displayName?: string;
    email?: string;
    avatarLabel?: string;
    avatarUrl?: string;
    language?: "en" | "pt-PT" | "es";
    theme?: "system" | "light" | "dark";
  },
) {
  if (!state.client || !state.connected) {
    state.alisioAccountError =
      "Alisio is still reconnecting. Wait a moment, then save your profile again.";
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    state.alisioAccount = await state.client.request<AlisioAccountState>(
      "alisio.account.completeProfile",
      patch,
    );
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    state.alisioAccountError = String(error);
  } finally {
    state.alisioAccountLoading = false;
  }
}

export async function signOutAlisioAccount(state: AlisioState) {
  if (!state.client || !state.connected || state.alisioAccountLoading) {
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    state.alisioAccount = await state.client.request<AlisioAccountState>(
      "alisio.account.signOut",
      {},
    );
    const identity = await loadOrCreateDeviceIdentity().catch(() => null);
    if (identity?.deviceId) {
      clearDeviceAuthToken({ deviceId: identity.deviceId, role: "operator" });
    }
    state.alisioBootstrap = null;
    state.setupStep = "account";
    state.alisioAuthPassword = "";
    state.setTab?.("setup");
  } catch (error) {
    state.alisioAccountError = String(error);
  } finally {
    state.alisioAccountLoading = false;
  }
}

export async function requestAlisioPasswordReset(state: AlisioState) {
  if (state.alisioAccountLoading) {
    return;
  }
  if (!state.client || !state.connected) {
    state.alisioAccountError =
      "Alisio is still reconnecting. Wait a moment, then request a password reset again.";
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    const email = state.alisioAuthEmail.trim();
    const result = await state.client.request<{ message: string; ok: true }>(
      "alisio.account.requestPasswordReset",
      { email },
    );
    state.alisioAccountNotice = result.message;
  } catch (error) {
    state.alisioAccountError = String(error);
  } finally {
    state.alisioAccountLoading = false;
  }
}

export async function beginAlisioAiConnect(state: AlisioState, callbackUrl: string) {
  if (!state.client || !state.connected || state.alisioAiLoading) {
    return null;
  }
  state.alisioAiLoading = true;
  state.alisioAiError = null;
  try {
    const result = await state.client.request<{ setupUrl: string }>("alisio.ai.beginConnect", {
      callbackUrl,
    });
    return result;
  } catch (error) {
    state.alisioAiError = String(error);
    return null;
  } finally {
    state.alisioAiLoading = false;
  }
}

export async function disconnectAlisioAi(state: AlisioState) {
  if (!state.client || !state.connected || state.alisioAiLoading) {
    return;
  }
  state.alisioAiLoading = true;
  state.alisioAiError = null;
  try {
    await state.client.request<AlisioAiState>("alisio.ai.disconnect", {});
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    state.alisioAiError = String(error);
  } finally {
    state.alisioAiLoading = false;
  }
}

export async function refreshAlisioAi(state: AlisioState) {
  if (!state.client || !state.connected || state.alisioAiLoading) {
    return;
  }
  state.alisioAiLoading = true;
  state.alisioAiError = null;
  try {
    await state.client.request<AlisioAiState>("alisio.ai.refreshLimits", {});
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    state.alisioAiError = String(error);
  } finally {
    state.alisioAiLoading = false;
  }
}

export async function loadAlisioOrganization(state: AlisioState) {
  if (!state.client || !state.connected || state.alisioOrganizationLoading) {
    return;
  }
  state.alisioOrganizationLoading = true;
  state.alisioOrganizationError = null;
  try {
    state.alisioOrganization = await state.client.request<AlisioOrganizationMembershipState>(
      "alisio.organization.get",
      {},
    );
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    state.alisioOrganizationError = String(error);
  } finally {
    state.alisioOrganizationLoading = false;
  }
}

export async function saveAlisioOrganization(
  state: AlisioState,
  next:
    | { mode: "none" }
    | { mode: "owner"; organizationName: string }
    | { mode: "member"; organizationName: string; inviteEmail?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.alisioOrganizationLoading = true;
  state.alisioOrganizationError = null;
  try {
    state.alisioOrganization = await state.client.request<AlisioOrganizationMembershipState>(
      "alisio.organization.set",
      next,
    );
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    state.alisioOrganizationError = String(error);
  } finally {
    state.alisioOrganizationLoading = false;
  }
}

export async function loadAlisioConnectors(state: AlisioState) {
  if (!state.client || !state.connected || state.alisioConnectorsLoading) {
    return;
  }
  state.alisioConnectorsLoading = true;
  state.alisioConnectorsError = null;
  try {
    const [catalog, authorizations] = await Promise.all([
      state.client.request<{ connectors: AlisioConnectorDefinition[] }>(
        "alisio.connectors.catalog",
        {},
      ),
      state.client.request<{ authorizations: AlisioConnectorAuthorization[] }>(
        "alisio.connectors.list",
        {},
      ),
    ]);
    state.alisioConnectorCatalog = catalog.connectors;
    state.alisioConnectorAuthorizations = authorizations.authorizations;
    if (
      state.alisioConnectorSetupGuide &&
      authorizations.authorizations.some(
        (entry) =>
          entry.connectorId === state.alisioConnectorSetupGuide?.connectorId &&
          entry.state === "connected",
      )
    ) {
      state.alisioConnectorSetupGuide = null;
    }
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    state.alisioConnectorsError = String(error);
  } finally {
    state.alisioConnectorsLoading = false;
  }
}

export async function revokeAlisioConnector(state: AlisioState, connectorId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  await state.client.request("alisio.connectors.revoke", { connectorId });
  await loadAlisioConnectors(state);
}

export async function beginAlisioConnector(
  state: AlisioState,
  connectorId: string,
): Promise<AlisioConnectorsBeginResult | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  return state.client.request("alisio.connectors.begin", { connectorId });
}

export async function startAlisioSetupWizard(
  state: AlisioState,
  mode: "local" | "remote" = "local",
) {
  if (
    !state.client ||
    !state.connected ||
    state.setupWizardLoading ||
    state.setupWizardSubmitting
  ) {
    return;
  }
  state.setupWizardLoading = true;
  state.setupWizardError = null;
  try {
    const result = await state.client.request<WizardStartResult>("wizard.start", { mode });
    applyWizardResult(state, result);
    await loadAlisioBootstrap(state);
  } catch (error) {
    state.setupWizardError = String(error);
  } finally {
    state.setupWizardLoading = false;
  }
}

export async function continueAlisioSetupWizard(
  state: AlisioState,
  answer?: { stepId: string; value?: unknown },
) {
  if (!state.client || !state.connected || state.setupWizardSubmitting) {
    return;
  }
  const sessionId = state.setupWizardSessionId;
  if (!sessionId) {
    return;
  }
  state.setupWizardSubmitting = true;
  state.setupWizardError = null;
  try {
    const result = await state.client.request<WizardNextResult>("wizard.next", {
      sessionId,
      ...(answer ? { answer } : {}),
    });
    applyWizardResult(state, result, sessionId);
    await loadAlisioBootstrap(state);
  } catch (error) {
    state.setupWizardError = String(error);
  } finally {
    state.setupWizardSubmitting = false;
  }
}

export async function cancelAlisioSetupWizard(state: AlisioState) {
  if (!state.client || !state.connected || !state.setupWizardSessionId) {
    return;
  }
  state.setupWizardSubmitting = true;
  state.setupWizardError = null;
  try {
    const sessionId = state.setupWizardSessionId;
    const result = await state.client.request<WizardStatusResult>("wizard.cancel", { sessionId });
    applyWizardResult(state, result, null);
    await loadAlisioBootstrap(state);
  } catch (error) {
    state.setupWizardError = String(error);
  } finally {
    state.setupWizardSubmitting = false;
  }
}

export async function restartAlisioRuntime(state: AlisioState) {
  if (!state.client || !state.connected) {
    return;
  }
  await state.client.request("alisio.runtime.restart", {});
}
