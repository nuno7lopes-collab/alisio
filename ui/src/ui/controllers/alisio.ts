import { summarizeAlisioConnectorUiStatuses } from "../../../../src/shared/alisio-connector-status.js";
import {
  ALISIO_LOCAL_MODEL_BACKEND,
  listPublishedAlisioLocalModels,
} from "../../../../src/shared/alisio-local-models.js";
import { isAlisioManagedProvider } from "../../../../src/shared/alisio-remote-model-provider.js";
import {
  alisioBootstrapBlocksChatAccess,
  isPostReadySetupStep,
  resolveBlockingSetupStep,
} from "../alisio-setup-state.ts";
import { clearDeviceAuthToken } from "../device-auth.ts";
import { loadOrCreateDeviceIdentity } from "../device-identity.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  makeModelsOperationKey,
  type ModelsOperation,
  type ModelsOperationMap,
} from "../models-view-types.ts";
import type {
  AlisioAccountState,
  AlisioAiState,
  AlisioBootstrapState,
  AlisioModelsInstallResult,
  AlisioModelsUninstallResult,
  AlisioModelsServerRemoveResult,
  AlisioModelsServerSaveResult,
  AlisioModelsServerSelectResult,
  AlisioModelsState,
  AlisioConnectorsBeginResult,
  AlisioDoctorSummaryState,
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
  AlisioOrganizationMembershipState,
  ModelCatalogEntry,
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
      | "models"
      | "channels"
      | "capabilities"
      | "connections"
      | "authentications"
      | "organization"
      | "settings",
  ) => void;
  alisioBootstrapLoading: boolean;
  alisioBootstrapError: string | null;
  alisioStartupBootstrap?: import("../types.ts").AlisioHttpBootstrap | null;
  alisioBootstrap: AlisioBootstrapState | null;
  alisioDoctorLoading: boolean;
  alisioDoctorError: string | null;
  alisioDoctor: AlisioDoctorSummaryState | null;
  alisioModelsLoading: boolean;
  alisioModelsError: string | null;
  alisioModels: AlisioModelsState | null;
  alisioModelOperations: ModelsOperationMap;
  chatModelCatalog?: ModelCatalogEntry[];
  chatModelsLoading?: boolean;
  modelsExpandedProfileId?: string | null;
  modelsSelectedProviderId?: "openai" | "server" | "local" | null;
  modelsServerDraft?: import("../models-view-types.ts").ModelsServerDraft | null;
  alisioAccountLoading: boolean;
  alisioAccountError: string | null;
  alisioAccountNotice: string | null;
  alisioAccount: AlisioAccountState | null;
  alisioAuthEmail: string;
  alisioAuthPendingEmail: string;
  alisioAuthCode: string;
  alisioAuthStage: "entry" | "email-code";
  alisioTermsAccepted: boolean;
  alisioMarketingOptIn: boolean;
  alisioBirthdate: string;
  alisioAiLoading: boolean;
  alisioAiError: string | null;
  alisioOrganizationLoading: boolean;
  alisioOrganizationError: string | null;
  alisioOrganization: AlisioOrganizationMembershipState | null;
  alisioOrganizationDraftMode: "create" | "join";
  alisioOrganizationName: string;
  alisioOrganizationInviteEmail: string;
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
const modelsRequests = new WeakMap<AlisioState, TrackedRequest>();
const accountRequests = new WeakMap<AlisioState, TrackedRequest>();
const aiRequests = new WeakMap<AlisioState, TrackedRequest>();
const organizationRequests = new WeakMap<AlisioState, TrackedRequest>();
const connectorRequests = new WeakMap<AlisioState, TrackedRequest>();
const bootstrapLastSuccessAt = new WeakMap<AlisioState, number>();
const doctorLastSuccessAt = new WeakMap<AlisioState, number>();
const connectorLastSuccessAt = new WeakMap<AlisioState, number>();
const BOOTSTRAP_CACHE_TTL_MS = 5_000;
const DOCTOR_CACHE_TTL_MS = 5_000;
const CONNECTORS_CACHE_TTL_MS = 15_000;

function buildLegacyModelsState(state: AlisioState): AlisioModelsState {
  const devices = state.alisioBootstrap?.account.devices ?? state.alisioAccount?.devices ?? [];
  const catalog = listPublishedAlisioLocalModels().map(
    ({ sourceUri: _sourceUri, ...entry }) => entry,
  );
  return {
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    catalog,
    targets: devices.map((device) => ({
      targetId: device.id,
      label: device.label,
      platform: device.platform,
      current: device.current,
      connected: true,
      backend: ALISIO_LOCAL_MODEL_BACKEND,
      runtimeKind: ALISIO_LOCAL_MODEL_BACKEND,
      runtimeStatus: "not_configured",
      runtimeMessage:
        "Actualiza o Alisio para a versão mais recente para activar instalações e sincronização de modelos.",
      supportsInstall: false,
      installedModels: [],
      recommendations: [],
    })),
    servers: [],
  };
}

function isUnknownMethodError(error: unknown, method: string) {
  return String(error).includes(`unknown method: ${method}`);
}

function setModelOperation(state: AlisioState, operation: ModelsOperation) {
  state.alisioModelOperations = {
    ...state.alisioModelOperations,
    [makeModelsOperationKey(operation.targetId, operation.modelId)]: operation,
  };
}

function clearModelOperation(state: AlisioState, targetId: string, modelId: string) {
  const key = makeModelsOperationKey(targetId, modelId);
  if (!state.alisioModelOperations[key]) {
    return;
  }
  const next = { ...state.alisioModelOperations };
  delete next[key];
  state.alisioModelOperations = next;
}

function syncModelOperationsWithSnapshot(state: AlisioState, models: AlisioModelsState | null) {
  if (!models || Object.keys(state.alisioModelOperations).length === 0) {
    return;
  }
  const installedByTarget = new Map<string, Set<string>>();
  for (const target of models.targets ?? []) {
    installedByTarget.set(
      target.targetId,
      new Set(target.installedModels.map((model) => model.id.trim().toLowerCase())),
    );
  }

  const nextEntries = Object.entries(state.alisioModelOperations).filter(([, operation]) => {
    if (operation.phase === "failed") {
      return false;
    }
    const installed = installedByTarget
      .get(operation.targetId)
      ?.has(operation.modelId.toLowerCase());
    if (operation.action === "install" && installed) {
      return false;
    }
    if (operation.action === "uninstall" && installed === false) {
      return false;
    }
    return operation.phase === "started" || operation.phase === "running";
  });

  state.alisioModelOperations = nextEntries.length > 0 ? Object.fromEntries(nextEntries) : {};
}

async function refreshChatModelCatalog(state: AlisioState) {
  if (!state.client || !state.connected || !("chatModelCatalog" in state)) {
    return;
  }
  state.chatModelsLoading = true;
  try {
    const result = await state.client.request<{ models: ModelCatalogEntry[] }>("models.list", {});
    state.chatModelCatalog = result?.models ?? [];
  } catch {
    // Keep the existing picker state when this secondary refresh fails.
  } finally {
    state.chatModelsLoading = false;
  }
}

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

function syncOrganizationDraftState(
  state: AlisioState,
  organization: AlisioOrganizationMembershipState | null,
  options?: { resetWhenNone?: boolean },
) {
  if (organization?.mode === "owner") {
    state.alisioOrganizationDraftMode = "create";
    state.alisioOrganizationName = organization.organizationName ?? "";
    state.alisioOrganizationInviteEmail = "";
    return;
  }
  if (organization?.mode === "member") {
    state.alisioOrganizationDraftMode = "join";
    state.alisioOrganizationName = organization.organizationName ?? "";
    state.alisioOrganizationInviteEmail = organization.inviteEmail ?? "";
    return;
  }
  if (!options?.resetWhenNone) {
    return;
  }
  state.alisioOrganizationDraftMode = "create";
  state.alisioOrganizationName = "";
  state.alisioOrganizationInviteEmail = "";
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
  if (
    !shouldForceSetup(bootstrap) &&
    activeTab === "setup" &&
    !isPostReadySetupStep(state.setupStep)
  ) {
    state.setTab("chat");
  }
}

function syncDoctorBootstrap(state: AlisioState) {
  if (!state.alisioDoctor || !state.alisioBootstrap) {
    return;
  }
  if (state.alisioDoctor.bootstrap === state.alisioBootstrap) {
    return;
  }
  state.alisioDoctor = {
    ...state.alisioDoctor,
    bootstrap: state.alisioBootstrap,
  };
}

function toBootstrapOrganizationState(
  organization: AlisioOrganizationMembershipState,
): AlisioBootstrapState["organization"] {
  if (organization.mode === "owner" && organization.organizationName) {
    return {
      mode: "owner",
      organizationName: organization.organizationName,
    };
  }
  if (organization.mode === "member" && organization.organizationName) {
    return {
      mode: "member",
      organizationName: organization.organizationName,
      ...(organization.inviteEmail ? { inviteEmail: organization.inviteEmail } : {}),
    };
  }
  return { mode: "none" };
}

function applyBootstrapSnapshot(state: AlisioState, bootstrap: AlisioBootstrapState) {
  const previousOrganizationMode = state.alisioOrganization?.mode ?? "none";
  state.alisioBootstrap = bootstrap;
  state.alisioAccount = bootstrap.account;
  syncAccountDraftFromSnapshot(state, bootstrap.account);
  state.alisioOrganization = bootstrap.organization;
  syncOrganizationDraftState(state, bootstrap.organization, {
    resetWhenNone: previousOrganizationMode !== "none",
  });
  state.alisioConnectorCatalog = [...bootstrap.connectors.catalog];
  state.alisioConnectorAuthorizations = [...bootstrap.connectors.authorizations];
  if (
    state.alisioConnectorSetupGuide &&
    bootstrap.connectors.authorizations.some(
      (entry) =>
        entry.connectorId === state.alisioConnectorSetupGuide?.connectorId &&
        entry.state === "connected",
    )
  ) {
    state.alisioConnectorSetupGuide = null;
  }
  connectorLastSuccessAt.set(state, Date.now());
  syncSetupRoute(state);
  syncDoctorBootstrap(state);
}

function applyAiSnapshot(state: AlisioState, ai: AlisioAiState) {
  if (state.alisioBootstrap) {
    state.alisioBootstrap = {
      ...state.alisioBootstrap,
      ai,
    };
    syncSetupRoute(state);
    syncDoctorBootstrap(state);
  }
  if (state.alisioStartupBootstrap) {
    state.alisioStartupBootstrap = {
      ...state.alisioStartupBootstrap,
      ai: {
        provider: ai.provider,
        status: ai.status,
        ...(ai.email ? { email: ai.email } : {}),
        ...(ai.planLabel ? { planLabel: ai.planLabel } : {}),
      },
    };
  }
}

function applyAccountSnapshot(state: AlisioState, account: AlisioAccountState) {
  state.alisioAccount = account;
  syncAccountDraftFromSnapshot(state, account);
  if (state.alisioBootstrap) {
    state.alisioBootstrap = {
      ...state.alisioBootstrap,
      account,
    };
    syncSetupRoute(state);
  }
  syncDoctorBootstrap(state);
}

function applyOrganizationSnapshot(
  state: AlisioState,
  organization: AlisioOrganizationMembershipState,
) {
  const previousOrganizationMode = state.alisioOrganization?.mode ?? "none";
  state.alisioOrganization = organization;
  syncOrganizationDraftState(state, organization, {
    resetWhenNone: previousOrganizationMode !== "none",
  });
  if (state.alisioBootstrap) {
    state.alisioBootstrap = {
      ...state.alisioBootstrap,
      organization: toBootstrapOrganizationState(organization),
    };
    syncSetupRoute(state);
  }
  syncDoctorBootstrap(state);
}

function applyConnectorSnapshot(
  state: AlisioState,
  params: {
    catalog: AlisioConnectorDefinition[];
    authorizations: AlisioConnectorAuthorization[];
  },
) {
  const catalog = [...params.catalog];
  const authorizations = [...params.authorizations];
  const summary = summarizeAlisioConnectorUiStatuses({
    definitions: catalog,
    authorizations,
  });
  state.alisioConnectorCatalog = catalog;
  state.alisioConnectorAuthorizations = authorizations;
  connectorLastSuccessAt.set(state, Date.now());
  if (state.alisioBootstrap) {
    state.alisioBootstrap = {
      ...state.alisioBootstrap,
      connectorSummary: summary,
      connectors: {
        ...state.alisioBootstrap.connectors,
        catalog,
        authorizations,
        summary,
      },
    };
    syncSetupRoute(state);
  }
  syncDoctorBootstrap(state);
  if (
    state.alisioConnectorSetupGuide &&
    authorizations.some(
      (entry) =>
        entry.connectorId === state.alisioConnectorSetupGuide?.connectorId &&
        entry.state === "connected",
    )
  ) {
    state.alisioConnectorSetupGuide = null;
  }
}

function resetSignedOutAccountState(state: AlisioState) {
  state.alisioBootstrap = null;
  bootstrapLastSuccessAt.delete(state);
  state.alisioDoctor = null;
  state.alisioDoctorError = null;
  state.alisioModelsLoading = false;
  state.alisioModelsError = null;
  state.alisioModels = null;
  state.alisioModelOperations = {};
  state.alisioOrganization = null;
  state.alisioOrganizationError = null;
  state.modelsExpandedProfileId = undefined;
  state.modelsSelectedProviderId = undefined;
  state.modelsServerDraft = null;
  if (Array.isArray(state.chatModelCatalog)) {
    state.chatModelCatalog = state.chatModelCatalog.filter(
      (entry) => !isAlisioManagedProvider(entry.provider),
    );
  }
  state.chatModelsLoading = false;
  syncOrganizationDraftState(state, null, { resetWhenNone: true });
  state.alisioConnectorCatalog = [];
  state.alisioConnectorAuthorizations = [];
  state.alisioConnectorsError = null;
  state.alisioConnectorSetupGuide = null;
  doctorLastSuccessAt.delete(state);
  connectorLastSuccessAt.delete(state);
  state.setupWizardSessionId = null;
  state.setupWizardStatus = null;
  state.setupWizardStep = null;
  state.setupWizardError = null;
  state.alisioAuthPendingEmail = state.alisioAuthEmail;
  state.alisioAuthCode = "";
  state.alisioAuthStage = "entry";
  state.alisioTermsAccepted = false;
  state.alisioMarketingOptIn = false;
  state.alisioBirthdate = "";
  syncWizardDraftState(state, null);
}

function syncAccountDraftFromSnapshot(state: AlisioState, account: AlisioAccountState | null) {
  const profile = account?.profile;
  if (!profile) {
    return;
  }
  state.alisioAuthEmail = profile.email;
  if (!state.alisioAuthPendingEmail.trim() || account.session.state === "signed_in") {
    state.alisioAuthPendingEmail = profile.email;
  }
  state.alisioTermsAccepted = Boolean(profile.termsAcceptedAt);
  state.alisioMarketingOptIn = profile.marketingOptIn === true;
  state.alisioBirthdate = profile.birthdate ?? "";
  if (account.session.state === "signed_in") {
    state.alisioAuthCode = "";
    state.alisioAuthStage = "entry";
  }
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

export async function loadAlisioBootstrap(state: AlisioState, opts?: { force?: boolean }) {
  const request = beginTrackedRequest(state, bootstrapRequests, state.alisioBootstrapLoading);
  if (!request) {
    return;
  }
  const cachedAt = bootstrapLastSuccessAt.get(state);
  if (
    !opts?.force &&
    state.alisioBootstrap &&
    typeof cachedAt === "number" &&
    Date.now() - cachedAt < BOOTSTRAP_CACHE_TTL_MS
  ) {
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
    bootstrapLastSuccessAt.set(state, Date.now());
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

export async function loadAlisioDoctorSummary(state: AlisioState, opts?: { force?: boolean }) {
  const request = beginTrackedRequest(state, doctorRequests, state.alisioDoctorLoading);
  if (!request) {
    return;
  }
  const cachedAt = doctorLastSuccessAt.get(state);
  if (
    !opts?.force &&
    state.alisioDoctor &&
    typeof cachedAt === "number" &&
    Date.now() - cachedAt < DOCTOR_CACHE_TTL_MS
  ) {
    if (!state.alisioBootstrap && state.alisioDoctor.bootstrap) {
      applyBootstrapSnapshot(state, state.alisioDoctor.bootstrap);
    }
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
    if (result.bootstrap) {
      applyBootstrapSnapshot(state, result.bootstrap);
    }
    doctorLastSuccessAt.set(state, Date.now());
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

export async function loadAlisioModels(state: AlisioState) {
  const request = beginTrackedRequest(state, modelsRequests, state.alisioModelsLoading);
  if (!request) {
    return;
  }
  state.alisioModelsLoading = true;
  state.alisioModelsError = null;
  try {
    const result = await request.client.request<AlisioModelsState>("alisio.models.get", {});
    if (!isTrackedRequestCurrent(state, modelsRequests, request)) {
      return;
    }
    state.alisioModels = result;
    syncModelOperationsWithSnapshot(state, result);
    await refreshChatModelCatalog(state);
  } catch (error) {
    if (!isTrackedRequestCurrent(state, modelsRequests, request)) {
      return;
    }
    if (isUnknownMethodError(error, "alisio.models.get")) {
      state.alisioModels = buildLegacyModelsState(state);
      syncModelOperationsWithSnapshot(state, state.alisioModels);
      state.alisioModelsError = null;
      await refreshChatModelCatalog(state);
      return;
    }
    state.alisioModelsError = String(error);
  } finally {
    if (isTrackedRequestCurrent(state, modelsRequests, request)) {
      state.alisioModelsLoading = false;
    }
  }
}

export async function installAlisioModel(
  state: AlisioState,
  params: {
    targetId: string;
    modelId: string;
  },
) {
  if (
    !state.client ||
    !state.connected ||
    state.alisioModelsLoading ||
    state.alisioModelOperations[makeModelsOperationKey(params.targetId, params.modelId)]
  ) {
    return;
  }
  state.alisioModelsError = null;
  setModelOperation(state, {
    targetId: params.targetId,
    modelId: params.modelId,
    action: "install",
    phase: "started",
    updatedAt: Date.now(),
  });
  try {
    await state.client.request<AlisioModelsInstallResult>("alisio.models.install", params);
    const result = await state.client.request<AlisioModelsState>("alisio.models.get", {});
    state.alisioModels = result;
    syncModelOperationsWithSnapshot(state, result);
    await refreshChatModelCatalog(state);
  } catch (error) {
    clearModelOperation(state, params.targetId, params.modelId);
    state.alisioModelsError = String(error);
  }
}

export async function uninstallAlisioModel(
  state: AlisioState,
  params: {
    targetId: string;
    modelId: string;
  },
) {
  if (
    !state.client ||
    !state.connected ||
    state.alisioModelsLoading ||
    state.alisioModelOperations[makeModelsOperationKey(params.targetId, params.modelId)]
  ) {
    return;
  }
  state.alisioModelsError = null;
  setModelOperation(state, {
    targetId: params.targetId,
    modelId: params.modelId,
    action: "uninstall",
    phase: "started",
    updatedAt: Date.now(),
  });
  try {
    await state.client.request<AlisioModelsUninstallResult>("alisio.models.uninstall", params);
    const result = await state.client.request<AlisioModelsState>("alisio.models.get", {});
    state.alisioModels = result;
    syncModelOperationsWithSnapshot(state, result);
    await refreshChatModelCatalog(state);
  } catch (error) {
    clearModelOperation(state, params.targetId, params.modelId);
    state.alisioModelsError = String(error);
  }
}

export function applyAlisioModelOperation(
  state: AlisioState,
  operation: Omit<ModelsOperation, "updatedAt">,
) {
  if (operation.phase === "completed" || operation.phase === "failed") {
    clearModelOperation(state, operation.targetId, operation.modelId);
    if (operation.phase === "failed" && operation.message?.trim()) {
      state.alisioModelsError = operation.message.trim();
    }
    return;
  }
  setModelOperation(state, {
    ...operation,
    updatedAt: Date.now(),
  });
}

export async function saveAlisioModelsServer(
  state: AlisioState,
  params: {
    serverId?: string;
    label: string;
    kind: "openai-compatible" | "ollama";
    baseUrl: string;
    apiKey?: string;
    clearApiKey?: boolean;
  },
) {
  if (!state.client || !state.connected || state.alisioModelsLoading) {
    return;
  }
  state.alisioModelsLoading = true;
  state.alisioModelsError = null;
  try {
    await state.client.request<AlisioModelsServerSaveResult>("alisio.models.server.save", params);
    state.alisioModels = await state.client.request<AlisioModelsState>("alisio.models.get", {});
    await refreshChatModelCatalog(state);
  } catch (error) {
    state.alisioModelsError = String(error);
  } finally {
    state.alisioModelsLoading = false;
  }
}

export async function removeAlisioModelsServer(state: AlisioState, serverId: string) {
  if (!state.client || !state.connected || state.alisioModelsLoading) {
    return;
  }
  state.alisioModelsLoading = true;
  state.alisioModelsError = null;
  try {
    await state.client.request<AlisioModelsServerRemoveResult>("alisio.models.server.remove", {
      serverId,
    });
    state.alisioModels = await state.client.request<AlisioModelsState>("alisio.models.get", {});
    await refreshChatModelCatalog(state);
  } catch (error) {
    state.alisioModelsError = String(error);
  } finally {
    state.alisioModelsLoading = false;
  }
}

export async function selectAlisioModelsServer(state: AlisioState, serverId: string) {
  if (!state.client || !state.connected || state.alisioModelsLoading) {
    return;
  }
  state.alisioModelsLoading = true;
  state.alisioModelsError = null;
  try {
    await state.client.request<AlisioModelsServerSelectResult>("alisio.models.server.select", {
      serverId,
    });
    state.alisioModels = await state.client.request<AlisioModelsState>("alisio.models.get", {});
    await refreshChatModelCatalog(state);
  } catch (error) {
    state.alisioModelsError = String(error);
  } finally {
    state.alisioModelsLoading = false;
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
    applyAccountSnapshot(state, result);
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

export async function beginAlisioAccountEmailAuth(state: AlisioState) {
  if (!state.client || !state.connected) {
    state.alisioAccountError =
      "O Alisio ainda está a religar-se. Espera um momento e tenta novamente.";
    return;
  }
  const request = beginTrackedRequest(state, accountRequests, false);
  if (!request) {
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    const email = state.alisioAuthEmail.trim();
    const result = await request.client.request<{ ok: true; email: string; message: string }>(
      "alisio.account.beginEmailAuth",
      {
        email,
      },
    );
    if (!isTrackedRequestCurrent(state, accountRequests, request)) {
      return;
    }
    state.alisioAuthPendingEmail = result.email;
    state.alisioAuthStage = "email-code";
    state.alisioAuthCode = "";
    state.alisioAccountNotice = result.message;
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

export async function verifyAlisioAccountEmailAuth(state: AlisioState) {
  if (!state.client || !state.connected) {
    state.alisioAccountError =
      "O Alisio ainda está a religar-se. Espera um momento e tenta novamente.";
    return;
  }
  const request = beginTrackedRequest(state, accountRequests, false);
  if (!request) {
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    const account = await request.client.request<AlisioAccountState>(
      "alisio.account.verifyEmailAuth",
      {
        email: state.alisioAuthPendingEmail.trim() || state.alisioAuthEmail.trim(),
        code: state.alisioAuthCode.trim(),
      },
    );
    if (!isTrackedRequestCurrent(state, accountRequests, request)) {
      return;
    }
    applyAccountSnapshot(state, account);
    await loadAlisioDoctorSummary(state, { force: true });
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

export async function beginAlisioAccountGoogleAuth(state: AlisioState, callbackUrl: string) {
  if (!state.client || !state.connected) {
    state.alisioAccountError =
      "O Alisio ainda está a religar-se. Espera um momento e tenta novamente.";
    return null;
  }
  const request = beginTrackedRequest(state, accountRequests, false);
  if (!request) {
    return null;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    return await request.client.request<{ setupUrl: string }>("alisio.account.beginGoogleAuth", {
      callbackUrl,
    });
  } catch (error) {
    if (!isTrackedRequestCurrent(state, accountRequests, request)) {
      return null;
    }
    state.alisioAccountError = String(error);
    return null;
  } finally {
    if (isTrackedRequestCurrent(state, accountRequests, request)) {
      state.alisioAccountLoading = false;
    }
  }
}

export async function saveAlisioAccount(
  state: AlisioState,
  patch: {
    username?: string;
    displayName?: string;
    email?: string;
    agentName?: string;
    avatarLabel?: string;
    avatarUrl?: string;
    termsAcceptedAt?: string;
    marketingOptIn?: boolean;
    birthdate?: string;
    language?: "en" | "pt-PT" | "es";
    theme?: "system" | "light" | "dark";
  },
) {
  if (!state.client || !state.connected) {
    state.alisioAccountError =
      "Alisio is still reconnecting. Wait a moment, then save your profile again.";
    return;
  }
  const request = beginTrackedRequest(state, accountRequests, false);
  if (!request) {
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    const account = await request.client.request<AlisioAccountState>("alisio.account.update", {
      ...(typeof patch.username === "string" ? { username: patch.username } : {}),
      ...(typeof patch.displayName === "string" ? { displayName: patch.displayName } : {}),
      ...(typeof patch.email === "string" ? { email: patch.email } : {}),
      ...(typeof patch.agentName === "string" ? { agentName: patch.agentName } : {}),
      ...(typeof patch.avatarLabel === "string" ? { avatarLabel: patch.avatarLabel } : {}),
      ...(typeof patch.avatarUrl === "string" ? { avatarUrl: patch.avatarUrl } : {}),
      ...(typeof patch.termsAcceptedAt === "string"
        ? { termsAcceptedAt: patch.termsAcceptedAt }
        : {}),
      ...("marketingOptIn" in patch ? { marketingOptIn: patch.marketingOptIn === true } : {}),
      ...(typeof patch.birthdate === "string" ? { birthdate: patch.birthdate } : {}),
      ...(patch.language ? { language: patch.language } : {}),
      ...(patch.theme ? { theme: patch.theme } : {}),
    });
    if (!isTrackedRequestCurrent(state, accountRequests, request)) {
      return;
    }
    applyAccountSnapshot(state, account);
    await loadAlisioDoctorSummary(state, { force: true });
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

export async function signOutAlisioAccount(state: AlisioState) {
  if (!state.client || !state.connected) {
    state.alisioAccountError =
      "Alisio is still reconnecting. Wait a moment, then try signing out again.";
    return;
  }
  const request = beginTrackedRequest(state, accountRequests, false);
  if (!request) {
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    const account = await request.client.request<AlisioAccountState>("alisio.account.signOut", {});
    if (!isTrackedRequestCurrent(state, accountRequests, request)) {
      return;
    }
    state.alisioAccount = account;
    const identity = await loadOrCreateDeviceIdentity().catch(() => null);
    if (!isTrackedRequestCurrent(state, accountRequests, request)) {
      return;
    }
    if (identity?.deviceId) {
      clearDeviceAuthToken({ deviceId: identity.deviceId, role: "operator" });
    }
    resetSignedOutAccountState(state);
    state.setupStep = "account";
    state.setTab?.("setup");
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

export async function requestAlisioRecoveryEmail(state: AlisioState) {
  if (!state.client || !state.connected) {
    state.alisioAccountError =
      "Alisio is still reconnecting. Wait a moment, then request another recovery email.";
    return;
  }
  const request = beginTrackedRequest(state, accountRequests, false);
  if (!request) {
    return;
  }
  state.alisioAccountLoading = true;
  state.alisioAccountError = null;
  state.alisioAccountNotice = null;
  try {
    const email = state.alisioAccount?.profile.email?.trim() || state.alisioAuthEmail.trim() || "";
    if (!email) {
      state.alisioAccountError = "Enter the email for your Alisio account first.";
      return;
    }
    state.alisioAuthEmail = email;
    state.alisioAuthPendingEmail = email;
    const result = await request.client.request<{ message: string; ok: true }>(
      "alisio.account.requestRecoveryEmail",
      { email },
    );
    if (!isTrackedRequestCurrent(state, accountRequests, request)) {
      return;
    }
    state.alisioAuthStage = "entry";
    state.alisioAuthCode = "";
    state.alisioAccountNotice = /password/i.test(result.message)
      ? "Check your email for the Alisio recovery link."
      : result.message;
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
    const result = await request.client.request<AlisioAiState>(
      "alisio.ai.disconnect",
      profileId ? { profileId } : {},
    );
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    applyAiSnapshot(state, result);
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
    const result = await request.client.request<AlisioAiState>("alisio.ai.selectProfile", {
      profileId,
    });
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    applyAiSnapshot(state, result);
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
    const result = await request.client.request<AlisioAiState>("alisio.ai.renameProfile", {
      profileId,
      label,
    });
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    applyAiSnapshot(state, result);
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
    const result = await request.client.request<AlisioAiState>(
      "alisio.ai.refreshLimits",
      profileId ? { profileId } : {},
    );
    if (!isTrackedRequestCurrent(state, aiRequests, request)) {
      return;
    }
    applyAiSnapshot(state, result);
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
    applyOrganizationSnapshot(state, result);
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
    const organization = await state.client.request<AlisioOrganizationMembershipState>(
      "alisio.organization.set",
      next,
    );
    applyOrganizationSnapshot(state, organization);
    await loadAlisioDoctorSummary(state, { force: true });
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
    applyConnectorSnapshot(state, {
      catalog: catalog.connectors,
      authorizations: authorizations.authorizations,
    });
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
  await Promise.allSettled([
    loadAlisioConnectors(state, { force: true }),
    loadAlisioDoctorSummary(state, { force: true }),
  ]);
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
    await loadAlisioBootstrap(state, { force: true });
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
    await loadAlisioBootstrap(state, { force: true });
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
    await loadAlisioBootstrap(state, { force: true });
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
