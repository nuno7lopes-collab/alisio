import {
  alisioBootstrapBlocksChatAccess,
  resolveBlockingSetupStep,
} from "../alisio-setup-state.ts";
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
    tab:
      | "setup"
      | "chat"
      | "channels"
      | "capabilities"
      | "connections"
      | "authentications"
      | "organization"
      | "settings",
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

type TrackedRequest = {
  client: GatewayBrowserClient;
  token: symbol;
};

const bootstrapRequests = new WeakMap<AlisioState, TrackedRequest>();
const doctorRequests = new WeakMap<AlisioState, TrackedRequest>();
const accountRequests = new WeakMap<AlisioState, TrackedRequest>();
const aiRequests = new WeakMap<AlisioState, TrackedRequest>();
const organizationRequests = new WeakMap<AlisioState, TrackedRequest>();
const connectorRequests = new WeakMap<AlisioState, TrackedRequest>();
const connectorLastSuccessAt = new WeakMap<AlisioState, number>();
const CONNECTORS_CACHE_TTL_MS = 15_000;

function beginTrackedRequest(
  state: AlisioState,
  requests: WeakMap<AlisioState, TrackedRequest>,
  loading: boolean,
): TrackedRequest | null {
  if (!state.client || !state.connected) {
    return null;
  }
  const current = requests.get(state);
  if (loading && current?.client === state.client) {
    return null;
  }
  const next: TrackedRequest = {
    client: state.client,
    token: Symbol("alisio-request"),
  };
  requests.set(state, next);
  return next;
}

function isTrackedRequestCurrent(
  state: AlisioState,
  requests: WeakMap<AlisioState, TrackedRequest>,
  request: TrackedRequest,
): boolean {
  const current = requests.get(state);
  return current?.token === request.token && state.client === request.client;
}

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
  return alisioBootstrapBlocksChatAccess(bootstrap);
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
    state.setupStep = resolveBlockingSetupStep({
      connected: state.connected,
      bootstrap,
    });
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
  connectorLastSuccessAt.set(state, Date.now());
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
  const request = beginTrackedRequest(state, bootstrapRequests, state.alisioBootstrapLoading);
  if (!request) {
    return;
  }
  state.alisioBootstrapLoading = true;
  state.alisioBootstrapError = null;
  try {
    const result = await request.client.request<AlisioBootstrapState>("alisio.bootstrap.get", {});
    if (!isTrackedRequestCurrent(state, bootstrapRequests, request)) {
      return;
    }
    applyBootstrapSnapshot(state, result);
    state.setupWizardSessionId = result.wizard.sessionId;
    state.setupWizardStatus = result.wizard.running ? "running" : null;
    if (result.wizard.running && result.wizard.sessionId && !state.setupWizardStep) {
      try {
        const wizardResult = await request.client.request<WizardNextResult>("wizard.next", {
          sessionId: result.wizard.sessionId,
        });
        if (!isTrackedRequestCurrent(state, bootstrapRequests, request)) {
          return;
        }
        applyWizardResult(state, wizardResult, result.wizard.sessionId);
      } catch (error) {
        if (!isTrackedRequestCurrent(state, bootstrapRequests, request)) {
          return;
        }
        state.setupWizardError = String(error);
      }
    } else if (!result.wizard.running) {
      state.setupWizardStep = null;
      syncWizardDraftState(state, null);
    }
  } catch (error) {
    if (!isTrackedRequestCurrent(state, bootstrapRequests, request)) {
      return;
    }
    state.alisioBootstrapError = String(error);
  } finally {
    if (isTrackedRequestCurrent(state, bootstrapRequests, request)) {
      state.alisioBootstrapLoading = false;
    }
  }
}

export async function loadAlisioDoctorSummary(state: AlisioState) {
  const request = beginTrackedRequest(state, doctorRequests, state.alisioDoctorLoading);
  if (!request) {
    return;
  }
  state.alisioDoctorLoading = true;
  state.alisioDoctorError = null;
  try {
    const result = await request.client.request<AlisioDoctorSummaryState>(
      "alisio.doctor.summary",
      {},
    );
    if (!isTrackedRequestCurrent(state, doctorRequests, request)) {
      return;
    }
    state.alisioDoctor = result;
  } catch (error) {
    if (!isTrackedRequestCurrent(state, doctorRequests, request)) {
      return;
    }
    state.alisioDoctorError = String(error);
  } finally {
    if (isTrackedRequestCurrent(state, doctorRequests, request)) {
      state.alisioDoctorLoading = false;
    }
  }
}

export async function loadAlisioAccount(state: AlisioState) {
  const request = beginTrackedRequest(state, accountRequests, state.alisioAccountLoading);
  if (!request) {
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    const result = await request.client.request<AlisioAccountState>("alisio.account.get", {});
    if (!isTrackedRequestCurrent(state, accountRequests, request)) {
      return;
    }
    state.alisioAccount = result;
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    if (!isTrackedRequestCurrent(state, accountRequests, request)) {
      return;
    }
    state.alisioAccountError = String(error);
  } finally {
    if (isTrackedRequestCurrent(state, accountRequests, request)) {
      state.alisioAccountLoading = false;
    }
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
  const currentProfile = state.alisioAccount?.profile;
  const nextProfile = {
    username: patch.username ?? currentProfile?.username ?? "",
    displayName: patch.displayName ?? currentProfile?.displayName ?? "",
    email: patch.email ?? currentProfile?.email ?? "",
    avatarLabel: patch.avatarLabel ?? currentProfile?.avatarLabel ?? "",
    avatarUrl: patch.avatarUrl ?? currentProfile?.avatarUrl ?? "",
  };
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    state.alisioAccount = await state.client.request<AlisioAccountState>(
      "alisio.account.completeProfile",
      {
        ...nextProfile,
        ...(patch.language ? { language: patch.language } : {}),
        ...(patch.theme ? { theme: patch.theme } : {}),
      },
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
  const request = beginTrackedRequest(state, aiRequests, state.alisioAiLoading);
  if (!request) {
    return null;
  }
  state.alisioAiLoading = true;
  state.alisioAiError = null;
  try {
    const result = await request.client.request<{ setupUrl: string }>("alisio.ai.beginConnect", {
      callbackUrl,
    });
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return null;
    }
    return result;
  } catch (error) {
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return null;
    }
    state.alisioAiError = String(error);
    return null;
  } finally {
    if (isTrackedRequestCurrent(state, aiRequests, request)) {
      state.alisioAiLoading = false;
    }
  }
}

export async function disconnectAlisioAi(state: AlisioState) {
  return await disconnectAlisioAiProfile(state);
}

export async function disconnectAlisioAiProfile(state: AlisioState, profileId?: string) {
  const request = beginTrackedRequest(state, aiRequests, state.alisioAiLoading);
  if (!request) {
    return;
  }
  state.alisioAiLoading = true;
  state.alisioAiError = null;
  try {
    await request.client.request<AlisioAiState>(
      "alisio.ai.disconnect",
      profileId ? { profileId } : {},
    );
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    state.alisioAiError = String(error);
  } finally {
    if (isTrackedRequestCurrent(state, aiRequests, request)) {
      state.alisioAiLoading = false;
    }
  }
}

export async function selectAlisioAiProfile(state: AlisioState, profileId: string) {
  const request = beginTrackedRequest(state, aiRequests, state.alisioAiLoading);
  if (!request) {
    return;
  }
  state.alisioAiLoading = true;
  state.alisioAiError = null;
  try {
    await request.client.request<AlisioAiState>("alisio.ai.selectProfile", { profileId });
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    state.alisioAiError = String(error);
  } finally {
    if (isTrackedRequestCurrent(state, aiRequests, request)) {
      state.alisioAiLoading = false;
    }
  }
}

export async function renameAlisioAiProfile(state: AlisioState, profileId: string, label: string) {
  const request = beginTrackedRequest(state, aiRequests, state.alisioAiLoading);
  if (!request) {
    return;
  }
  state.alisioAiLoading = true;
  state.alisioAiError = null;
  try {
    await request.client.request<AlisioAiState>("alisio.ai.renameProfile", { profileId, label });
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    state.alisioAiError = String(error);
  } finally {
    if (isTrackedRequestCurrent(state, aiRequests, request)) {
      state.alisioAiLoading = false;
    }
  }
}

export async function refreshAlisioAi(state: AlisioState) {
  return await refreshAlisioAiProfile(state);
}

export async function refreshAlisioAiProfile(state: AlisioState, profileId?: string) {
  const request = beginTrackedRequest(state, aiRequests, state.alisioAiLoading);
  if (!request) {
    return;
  }
  state.alisioAiLoading = true;
  state.alisioAiError = null;
  try {
    await request.client.request<AlisioAiState>(
      "alisio.ai.refreshLimits",
      profileId ? { profileId } : {},
    );
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    state.alisioAiError = String(error);
  } finally {
    if (isTrackedRequestCurrent(state, aiRequests, request)) {
      state.alisioAiLoading = false;
    }
  }
}

export async function loadAlisioOrganization(state: AlisioState) {
  const request = beginTrackedRequest(state, organizationRequests, state.alisioOrganizationLoading);
  if (!request) {
    return;
  }
  state.alisioOrganizationLoading = true;
  state.alisioOrganizationError = null;
  try {
    const result = await request.client.request<AlisioOrganizationMembershipState>(
      "alisio.organization.get",
      {},
    );
    if (!isTrackedRequestCurrent(state, organizationRequests, request)) {
      return;
    }
    state.alisioOrganization = result;
    await Promise.allSettled([loadAlisioBootstrap(state), loadAlisioDoctorSummary(state)]);
  } catch (error) {
    if (!isTrackedRequestCurrent(state, organizationRequests, request)) {
      return;
    }
    state.alisioOrganizationError = String(error);
  } finally {
    if (isTrackedRequestCurrent(state, organizationRequests, request)) {
      state.alisioOrganizationLoading = false;
    }
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

export async function loadAlisioConnectors(state: AlisioState, opts?: { force?: boolean }) {
  const request = beginTrackedRequest(state, connectorRequests, state.alisioConnectorsLoading);
  if (!request) {
    return;
  }
  const cachedAt = connectorLastSuccessAt.get(state);
  if (
    !opts?.force &&
    typeof cachedAt === "number" &&
    Date.now() - cachedAt < CONNECTORS_CACHE_TTL_MS
  ) {
    return;
  }
  state.alisioConnectorsLoading = true;
  state.alisioConnectorsError = null;
  try {
    const [catalog, authorizations] = await Promise.all([
      request.client.request<{ connectors: AlisioConnectorDefinition[] }>(
        "alisio.connectors.catalog",
        {},
      ),
      request.client.request<{ authorizations: AlisioConnectorAuthorization[] }>(
        "alisio.connectors.list",
        {},
      ),
    ]);
    if (!isTrackedRequestCurrent(state, connectorRequests, request)) {
      return;
    }
    state.alisioConnectorCatalog = catalog.connectors;
    state.alisioConnectorAuthorizations = authorizations.authorizations;
    connectorLastSuccessAt.set(state, Date.now());
    if (state.alisioBootstrap) {
      state.alisioBootstrap = {
        ...state.alisioBootstrap,
        connectors: {
          ...state.alisioBootstrap.connectors,
          catalog: [...catalog.connectors],
          authorizations: [...authorizations.authorizations],
        },
      };
    }
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
  } catch (error) {
    if (!isTrackedRequestCurrent(state, connectorRequests, request)) {
      return;
    }
    state.alisioConnectorsError = String(error);
  } finally {
    if (isTrackedRequestCurrent(state, connectorRequests, request)) {
      state.alisioConnectorsLoading = false;
    }
  }
}

export async function revokeAlisioConnector(state: AlisioState, connectorId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  await state.client.request("alisio.connectors.revoke", { connectorId });
  await loadAlisioConnectors(state, { force: true });
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
