import { describe, expect, it, vi } from "vitest";
import {
  refreshAlisioAiProfile,
  loadAlisioBootstrap,
  loadAlisioConnectors,
  loadAlisioDoctorSummary,
  signOutAlisioAccount,
  type AlisioState,
} from "./alisio.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createClient(request: ReturnType<typeof vi.fn>) {
  return { request } as unknown as AlisioState["client"];
}

function createState(overrides: Partial<AlisioState> = {}): AlisioState {
  return {
    client: null,
    connected: true,
    tab: "settings",
    setTab: vi.fn(),
    alisioBootstrapLoading: false,
    alisioBootstrapError: null,
    alisioBootstrap: null,
    alisioDoctorLoading: false,
    alisioDoctorError: null,
    alisioDoctor: null,
    alisioModelsLoading: false,
    alisioModelsError: null,
    alisioModels: null,
    alisioAccountLoading: false,
    alisioAccountError: null,
    alisioAccountNotice: null,
    alisioAccount: null,
    alisioAuthMode: "sign-in",
    alisioAuthEmail: "",
    alisioAuthPassword: "",
    alisioAiLoading: false,
    alisioAiError: null,
    alisioOrganizationLoading: false,
    alisioOrganizationError: null,
    alisioOrganization: null,
    alisioConnectorsLoading: false,
    alisioConnectorsError: null,
    alisioConnectorCatalog: [],
    alisioConnectorAuthorizations: [],
    alisioConnectorSetupGuide: null,
    setupWizardLoading: false,
    setupWizardSubmitting: false,
    setupWizardSessionId: null,
    setupWizardStep: null,
    setupWizardStatus: null,
    setupWizardError: null,
    setupWizardDraftText: "",
    setupWizardDraftConfirm: false,
    setupWizardDraftSelectIndex: 0,
    setupWizardDraftMultiIndexes: [],
    setupStep: null,
    ...overrides,
  };
}

describe("alisio controller reconnect safety", () => {
  it("ignora um erro antigo do doctor depois de reconectar", async () => {
    const firstRequest = deferred<never>();
    const firstClient = createClient(
      vi.fn(async () => {
        await firstRequest.promise;
        return { ok: true };
      }),
    );
    const state = createState({ client: firstClient });

    const firstLoad = loadAlisioDoctorSummary(state);
    expect(state.alisioDoctorLoading).toBe(true);

    const secondClient = createClient(vi.fn(async () => ({ ok: true, issues: [] })));
    state.client = secondClient;
    state.connected = true;

    await loadAlisioDoctorSummary(state);

    firstRequest.reject(new Error("gateway closed (1012): service restart"));
    await firstLoad;

    expect(state.alisioDoctorError).toBeNull();
    expect(state.alisioDoctor).toEqual({ ok: true, issues: [] });
    expect(state.alisioDoctorLoading).toBe(false);
  });

  it("permite um bootstrap novo mesmo com o pedido anterior ainda pendente", async () => {
    const firstRequest = deferred<never>();
    const firstClient = createClient(
      vi.fn(async (method: string) => {
        if (method === "alisio.bootstrap.get") {
          await firstRequest.promise;
        }
        return {
          account: {
            profile: {
              email: "",
            },
          },
          organization: { mode: "none" },
          connectors: { catalog: [], authorizations: [], summary: [] },
          wizard: { running: false, sessionId: null },
        };
      }),
    );
    const state = createState({ client: firstClient });

    const firstLoad = loadAlisioBootstrap(state);
    expect(state.alisioBootstrapLoading).toBe(true);

    const secondBootstrap = {
      account: {
        profile: {
          email: "nuno7lopes@gmail.com",
        },
      },
      organization: { mode: "none" as const },
      connectors: { catalog: [], authorizations: [], summary: [] },
      wizard: { running: false, sessionId: null },
    };
    const secondClient = createClient(vi.fn(async () => secondBootstrap));
    state.client = secondClient;
    state.connected = true;

    await loadAlisioBootstrap(state);

    firstRequest.reject(new Error("gateway closed (1012): service restart"));
    await firstLoad;

    expect(state.alisioBootstrapError).toBeNull();
    expect(state.alisioBootstrap).toEqual(secondBootstrap);
    expect(state.alisioAuthEmail).toBe("nuno7lopes@gmail.com");
    expect(state.alisioBootstrapLoading).toBe(false);
  });

  it("ignora um erro antigo ao refrescar telemetria AI depois de reconectar", async () => {
    const firstRequest = deferred<never>();
    const firstClient = createClient(
      vi.fn(async () => {
        await firstRequest.promise;
        return { provider: "openai", status: "connected" };
      }),
    );
    const state = createState({ client: firstClient });

    const firstRefresh = refreshAlisioAiProfile(state, "profile-1");
    expect(state.alisioAiLoading).toBe(true);

    const secondClient = createClient(
      vi.fn(async (method: string) => {
        if (method === "alisio.ai.refreshLimits") {
          return { provider: "openai", status: "connected" };
        }
        if (method === "alisio.bootstrap.get") {
          return {
            account: {
              profile: {
                email: "",
              },
            },
            organization: { mode: "none" },
            connectors: { catalog: [], authorizations: [], summary: [] },
            wizard: { running: false, sessionId: null },
          };
        }
        if (method === "alisio.doctor.summary") {
          return { ok: true, issues: [] };
        }
        return {};
      }),
    );
    state.client = secondClient;
    state.connected = true;

    await refreshAlisioAiProfile(state, "profile-1");

    firstRequest.reject(new Error("gateway closed (1012): service restart"));
    await firstRefresh;

    expect(state.alisioAiError).toBeNull();
    expect(state.alisioAiLoading).toBe(false);
  });

  it("reutiliza os connectors do bootstrap e evita novo fetch imediato", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "alisio.bootstrap.get") {
        return {
          account: {
            profile: {
              email: "",
            },
          },
          organization: { mode: "none" as const },
          connectors: {
            catalog: [{ id: "google" }],
            authorizations: [{ connectorId: "google", state: "connected" }],
            summary: [],
          },
          wizard: { running: false, sessionId: null },
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({ client: createClient(request) });

    await loadAlisioBootstrap(state);
    await loadAlisioConnectors(state);

    expect(request).toHaveBeenCalledTimes(1);
    expect(state.alisioConnectorCatalog).toEqual([{ id: "google" }]);
    expect(state.alisioConnectorAuthorizations).toEqual([
      { connectorId: "google", state: "connected" },
    ]);
  });

  it("limpa estado e cache de connectors ao terminar sessão", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "alisio.account.signOut") {
        return {
          profile: {
            email: "signed-out@example.com",
          },
          preferences: {
            language: "en",
            theme: "system",
          },
          session: {
            state: "signed_out",
            profileCompleted: false,
          },
          devices: [],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      client: createClient(request),
      alisioBootstrap: {
        account: {
          profile: {
            email: "nuno@example.com",
          },
        },
        organization: { mode: "owner", organizationName: "Team" },
        connectors: {
          catalog: [{ id: "google" }],
          authorizations: [{ connectorId: "google", state: "connected" }],
          summary: [],
        },
        wizard: { running: false, sessionId: null },
      } as unknown as AlisioState["alisioBootstrap"],
      alisioOrganization: { mode: "owner", organizationName: "Team" },
      alisioConnectorCatalog: [
        { id: "google" },
      ] as unknown as AlisioState["alisioConnectorCatalog"],
      alisioConnectorAuthorizations: [
        { connectorId: "google", state: "connected" },
      ] as unknown as AlisioState["alisioConnectorAuthorizations"],
      alisioConnectorSetupGuide: {
        connectorId: "google",
        availability: "ready",
        mode: "setup",
        provider: "google",
        providerLabel: "Google",
        statusReason: "missing_client_config",
      } as unknown as AlisioState["alisioConnectorSetupGuide"],
      setupWizardSessionId: "wizard-1",
      setupWizardStatus: "running",
      setupWizardStep: {
        id: "step-1",
        type: "text",
        message: "Question",
      } as NonNullable<AlisioState["setupWizardStep"]>,
      setupWizardError: "stale",
      setupWizardDraftText: "draft",
      alisioAuthPassword: "secret",
    });

    await signOutAlisioAccount(state);

    expect(state.alisioBootstrap).toBeNull();
    expect(state.alisioOrganization).toBeNull();
    expect(state.alisioConnectorCatalog).toEqual([]);
    expect(state.alisioConnectorAuthorizations).toEqual([]);
    expect(state.alisioConnectorSetupGuide).toBeNull();
    expect(state.setupWizardSessionId).toBeNull();
    expect(state.setupWizardStep).toBeNull();
    expect(state.setupWizardStatus).toBeNull();
    expect(state.setupWizardDraftText).toBe("");
    expect(state.alisioAuthPassword).toBe("");
    expect(state.setupStep).toBe("account");
    expect(state.setTab).toHaveBeenCalledWith("setup");
  });
});
