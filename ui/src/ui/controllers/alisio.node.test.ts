import { describe, expect, it, vi } from "vitest";
import {
  refreshAlisioAiProfile,
  loadAlisioBootstrap,
  loadAlisioConnectors,
  loadAlisioDoctorSummary,
  requestAlisioPasswordReset,
  saveAlisioAccount,
  saveAlisioOrganization,
  signInAlisioAccount,
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
    alisioAuthPasswordVisible: false,
    alisioAiLoading: false,
    alisioAiError: null,
    alisioOrganizationLoading: false,
    alisioOrganizationError: null,
    alisioOrganization: null,
    alisioOrganizationDraftMode: "create",
    alisioOrganizationName: "",
    alisioOrganizationInviteEmail: "",
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
      alisioAuthPasswordVisible: true,
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
    expect(state.alisioAuthPasswordVisible).toBe(false);
    expect(state.setupStep).toBe("account");
    expect(state.setTab).toHaveBeenCalledWith("setup");
  });

  it("ignora um save antigo da conta quando chega um pedido mais recente", async () => {
    const firstRequest = deferred<never>();
    const firstClient = createClient(
      vi.fn(async (method: string) => {
        if (method !== "alisio.account.update") {
          throw new Error(`unexpected method: ${method}`);
        }
        await firstRequest.promise;
        return {
          profile: {
            email: "stale@example.com",
            displayName: "Stale",
            username: "stale",
            avatarLabel: "S",
            joinedAt: "2026-04-05T09:00:00.000Z",
            plan: "free",
          },
          preferences: {
            language: "en",
            theme: "system",
          },
          session: {
            state: "signed_in",
            profileCompleted: true,
            backend: "supabase",
          },
          devices: [],
        };
      }),
    );
    const state = createState({
      client: firstClient,
      alisioAccount: {
        profile: {
          email: "owner@example.com",
          displayName: "Owner",
          username: "owner",
          avatarLabel: "O",
          joinedAt: "2026-04-05T09:00:00.000Z",
          plan: "free",
        },
        preferences: {
          language: "en",
          theme: "system",
        },
        session: {
          state: "signed_in",
          profileCompleted: true,
          backend: "supabase",
        },
        devices: [],
      } as unknown as AlisioState["alisioAccount"],
    });

    const firstSave = saveAlisioAccount(state, { displayName: "Stale" });
    expect(state.alisioAccountLoading).toBe(true);

    const secondClient = createClient(
      vi.fn(async (method: string) => {
        if (method === "alisio.account.update") {
          return {
            profile: {
              email: "owner@example.com",
              displayName: "Fresh",
              username: "owner",
              avatarLabel: "O",
              joinedAt: "2026-04-05T09:00:00.000Z",
              plan: "free",
            },
            preferences: {
              language: "en",
              theme: "system",
            },
            session: {
              state: "signed_in",
              profileCompleted: true,
              backend: "supabase",
            },
            devices: [],
          };
        }
        if (method === "alisio.bootstrap.get") {
          return {
            account: {
              profile: {
                email: "owner@example.com",
                displayName: "Fresh",
                username: "owner",
                avatarLabel: "O",
                joinedAt: "2026-04-05T09:00:00.000Z",
                plan: "free",
              },
              preferences: {
                language: "en",
                theme: "system",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                backend: "supabase",
              },
              devices: [],
            },
            organization: { mode: "none" as const },
            connectors: { catalog: [], authorizations: [], summary: [] },
            wizard: { running: false, sessionId: null },
          };
        }
        if (method === "alisio.doctor.summary") {
          return { ok: true, issues: [] };
        }
        throw new Error(`unexpected method: ${method}`);
      }),
    );
    state.client = secondClient;

    await saveAlisioAccount(state, { displayName: "Fresh" });

    firstRequest.reject(new Error("gateway closed (1012): service restart"));
    await firstSave;

    expect(state.alisioAccountError).toBeNull();
    expect(state.alisioAccount?.profile.displayName).toBe("Fresh");
    expect(state.alisioAccountLoading).toBe(false);
  });

  it("usa o endpoint de update para gravar a conta e sincroniza o email actual", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "alisio.account.update") {
        return {
          profile: {
            email: "owner@example.com",
            displayName: "Owner",
            username: "owner",
            avatarLabel: "O",
            joinedAt: "2026-04-05T09:00:00.000Z",
            plan: "free",
          },
          preferences: {
            language: "en",
            theme: "system",
          },
          session: {
            state: "signed_in",
            profileCompleted: true,
            backend: "supabase",
          },
          devices: [],
        };
      }
      if (method === "alisio.bootstrap.get") {
        return {
          account: {
            profile: {
              email: "owner@example.com",
            },
          },
          organization: { mode: "none" as const },
          connectors: { catalog: [], authorizations: [], summary: [] },
          wizard: { running: false, sessionId: null },
        };
      }
      if (method === "alisio.doctor.summary") {
        return { ok: true, issues: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      client: createClient(request),
      alisioAccount: {
        profile: {
          email: "draft@example.com",
          displayName: "Draft",
          username: "draft",
          avatarLabel: "D",
          joinedAt: "2026-04-05T09:00:00.000Z",
          plan: "free",
        },
        preferences: {
          language: "pt-PT",
          theme: "dark",
        },
        session: {
          state: "signed_in",
          profileCompleted: true,
          backend: "supabase",
        },
        devices: [],
      } as unknown as AlisioState["alisioAccount"],
    });

    await saveAlisioAccount(state, { language: "en" });

    expect(request).toHaveBeenCalledWith("alisio.account.update", { language: "en" });
    expect(state.alisioAuthEmail).toBe("owner@example.com");
  });

  it("pede reset da palavra-passe com o email actual da conta", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "alisio.account.requestPasswordReset") {
        expect(params).toEqual({ email: "owner@example.com" });
        return {
          ok: true,
          message: "Reset sent",
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      client: createClient(request),
      alisioAuthEmail: "",
      alisioAccount: {
        profile: {
          email: "owner@example.com",
        },
      } as unknown as AlisioState["alisioAccount"],
    });

    await requestAlisioPasswordReset(state);

    expect(state.alisioAuthEmail).toBe("owner@example.com");
    expect(state.alisioAccountNotice).toBe("Reset sent");
    expect(state.alisioAccountError).toBeNull();
  });

  it("limpa a palavra-passe visível depois de iniciar sessão", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "alisio.account.signIn") {
        return {
          profile: {
            email: "owner@example.com",
            displayName: "Owner",
            username: "owner",
            avatarLabel: "O",
            joinedAt: "2026-04-05T09:00:00.000Z",
            plan: "free",
          },
          preferences: {
            language: "en",
            theme: "system",
          },
          session: {
            state: "signed_in",
            profileCompleted: true,
            backend: "supabase",
          },
          devices: [],
        };
      }
      if (method === "alisio.bootstrap.get") {
        return {
          account: {
            profile: {
              email: "owner@example.com",
            },
          },
          organization: { mode: "none" as const },
          connectors: { catalog: [], authorizations: [], summary: [] },
          wizard: { running: false, sessionId: null },
        };
      }
      if (method === "alisio.doctor.summary") {
        return { ok: true, issues: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      client: createClient(request),
      alisioAuthEmail: "owner@example.com",
      alisioAuthPassword: "secret",
      alisioAuthPasswordVisible: true,
    });

    await signInAlisioAccount(state);

    expect(state.alisioAuthPassword).toBe("");
    expect(state.alisioAuthPasswordVisible).toBe(false);
    expect(state.alisioAccountError).toBeNull();
  });
});

describe("alisio organization draft sync", () => {
  it("limpa o draft local depois de sair da organização", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "alisio.organization.set") {
        return { mode: "none" as const };
      }
      if (method === "alisio.bootstrap.get") {
        return {
          account: {
            profile: {
              email: "nuno@example.com",
            },
          },
          organization: { mode: "none" as const },
          connectors: { catalog: [], authorizations: [], summary: [] },
          wizard: { running: false, sessionId: null },
        };
      }
      if (method === "alisio.doctor.summary") {
        return { ok: true, issues: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      client: createClient(request),
      alisioOrganization: { mode: "owner", organizationName: "Team Orbit" },
      alisioOrganizationDraftMode: "join",
      alisioOrganizationName: "Draft Team",
      alisioOrganizationInviteEmail: "invite@example.com",
    });

    await saveAlisioOrganization(state, { mode: "none" });

    expect(state.alisioOrganization).toEqual({ mode: "none" });
    expect(state.alisioOrganizationDraftMode).toBe("create");
    expect(state.alisioOrganizationName).toBe("");
    expect(state.alisioOrganizationInviteEmail).toBe("");
  });

  it("preserva o draft local quando o bootstrap confirma que ainda não há organização", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "alisio.bootstrap.get") {
        return {
          account: {
            profile: {
              email: "nuno@example.com",
            },
          },
          organization: { mode: "none" as const },
          connectors: { catalog: [], authorizations: [], summary: [] },
          wizard: { running: false, sessionId: null },
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      client: createClient(request),
      alisioOrganization: { mode: "none" },
      alisioOrganizationDraftMode: "join",
      alisioOrganizationName: "Team Orbit",
      alisioOrganizationInviteEmail: "invite@example.com",
    });

    await loadAlisioBootstrap(state);

    expect(state.alisioOrganization).toEqual({ mode: "none" });
    expect(state.alisioOrganizationDraftMode).toBe("join");
    expect(state.alisioOrganizationName).toBe("Team Orbit");
    expect(state.alisioOrganizationInviteEmail).toBe("invite@example.com");
  });
});
