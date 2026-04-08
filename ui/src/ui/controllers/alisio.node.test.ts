import { describe, expect, it, vi } from "vitest";
import {
  verifyAlisioAccountEmailAuth,
  refreshAlisioAiProfile,
  loadAlisioAccount,
  loadAlisioBootstrap,
  loadAlisioConnectors,
  loadAlisioDoctorSummary,
  requestAlisioRecoveryEmail,
  saveAlisioAccount,
  saveAlisioOrganization,
  selectAlisioModelsServer,
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
    alisioModelOperations: {},
    chatModelCatalog: [],
    modelsExpandedProfileId: undefined,
    modelsSelectedProviderId: undefined,
    modelsServerDraft: null,
    alisioAccountLoading: false,
    alisioAccountError: null,
    alisioAccountNotice: null,
    alisioAccount: null,
    alisioAuthEmail: "",
    alisioAuthPendingEmail: "",
    alisioAuthCode: "",
    alisioAuthStage: "entry",
    alisioTermsAccepted: false,
    alisioMarketingOptIn: false,
    alisioBirthdate: "",
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

function createBootstrapSnapshot(
  overrides: Partial<NonNullable<AlisioState["alisioBootstrap"]>> = {},
): NonNullable<AlisioState["alisioBootstrap"]> {
  return {
    account: {
      profile: {
        email: "",
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
    },
    ai: {
      provider: "openai",
      status: "disconnected",
    },
    organization: { mode: "none" },
    connectors: { catalog: [], authorizations: [], summary: [] },
    wizard: { running: false, sessionId: null },
    ...overrides,
  } as unknown as NonNullable<AlisioState["alisioBootstrap"]>;
}

function createDoctorSummary(
  bootstrapOverrides: Partial<NonNullable<AlisioState["alisioBootstrap"]>> = {},
) {
  return {
    bootstrap: createBootstrapSnapshot(bootstrapOverrides),
    ok: true,
    issues: [],
  } as unknown as NonNullable<AlisioState["alisioDoctor"]>;
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
            session: {
              state: "signed_out",
              profileCompleted: false,
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
        session: {
          state: "signed_out" as const,
          profileCompleted: false,
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

  it("reutiliza bootstrap recente e evita novo fetch imediato", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);
    const request = vi.fn(async () => ({
      account: {
        profile: {
          email: "nuno@example.com",
        },
        session: {
          state: "signed_out" as const,
          profileCompleted: false,
        },
      },
      organization: { mode: "none" as const },
      connectors: { catalog: [], authorizations: [], summary: [] },
      wizard: { running: false, sessionId: null },
    }));
    const state = createState({ client: createClient(request) });

    await loadAlisioBootstrap(state);
    nowSpy.mockReturnValue(2_000);
    await loadAlisioBootstrap(state);

    expect(request).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it("reutiliza doctor recente e evita novo fetch imediato", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);
    const request = vi.fn(async () => createDoctorSummary());
    const state = createState({ client: createClient(request) });

    await loadAlisioDoctorSummary(state);
    nowSpy.mockReturnValue(2_000);
    await loadAlisioDoctorSummary(state);

    expect(request).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it("hidrata o bootstrap a partir do doctor sem fetch separado", async () => {
    const doctor = createDoctorSummary({
      account: {
        profile: {
          username: "doctor",
          displayName: "Doctor",
          email: "doctor@example.com",
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
        },
        devices: [],
      },
    });
    const request = vi.fn(async () => doctor);
    const state = createState({ client: createClient(request) });

    await loadAlisioDoctorSummary(state);

    expect(request).toHaveBeenCalledTimes(1);
    expect(state.alisioBootstrap).toEqual(doctor.bootstrap);
    expect(state.alisioAccount?.profile.email).toBe("doctor@example.com");
  });

  it("actualiza a conta sem refazer bootstrap nem doctor em leitura simples", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "alisio.account.get") {
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
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      client: createClient(request),
      alisioBootstrap: createBootstrapSnapshot(),
    });

    await loadAlisioAccount(state);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("alisio.account.get", {});
    expect(state.alisioBootstrap?.account.profile.email).toBe("owner@example.com");
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

  it("aplica a resposta do refresh AI directamente no bootstrap sem refetch extra", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "alisio.ai.refreshLimits") {
        return {
          provider: "openai",
          status: "connected",
          email: "updated@example.com",
          planLabel: "team",
          profiles: [],
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
        ai: {
          provider: "openai",
          status: "disconnected",
        },
        organization: { mode: "none" },
        connectors: { catalog: [], authorizations: [], summary: [] },
        wizard: { running: false, sessionId: null },
      } as unknown as AlisioState["alisioBootstrap"],
    });

    await refreshAlisioAiProfile(state);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("alisio.ai.refreshLimits", {});
    expect(state.alisioBootstrap?.ai).toMatchObject({
      provider: "openai",
      status: "connected",
      email: "updated@example.com",
      planLabel: "team",
    });
  });

  it("reutiliza os connectors do bootstrap e evita novo fetch imediato", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "alisio.bootstrap.get") {
        return {
          account: {
            profile: {
              email: "",
            },
            session: {
              state: "signed_out" as const,
              profileCompleted: false,
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
      alisioModelsLoading: true,
      alisioModelsError: "stale models",
      alisioModels: {
        backend: "llama.cpp",
        catalog: [],
        targets: [],
        servers: [
          {
            serverId: "server-1",
            label: "Home Lab",
            kind: "openai-compatible",
            baseUrl: "http://192.168.1.50:1234",
            active: true,
            hasApiKey: false,
            status: "ready",
            models: [{ id: "gpt-oss-20b", name: "gpt-oss-20b" }],
          },
        ],
      } as unknown as AlisioState["alisioModels"],
      alisioModelOperations: {
        "current::qwen3-8b": {
          targetId: "current",
          modelId: "qwen3-8b",
          action: "install",
          phase: "running",
          updatedAt: Date.now(),
        },
      },
      chatModelCatalog: [
        { id: "gpt-5.4", name: "gpt-5.4", provider: "openai" },
        { id: "gpt-oss-20b", name: "gpt-oss-20b", provider: "alisio-remote" },
      ],
      modelsExpandedProfileId: "profile-1",
      modelsSelectedProviderId: "server",
      modelsServerDraft: {
        mode: "create",
        label: "Draft",
        kind: "openai-compatible",
        baseUrl: "http://192.168.1.50:1234",
        apiKey: "",
      },
      setupWizardSessionId: "wizard-1",
      setupWizardStatus: "running",
      setupWizardStep: {
        id: "step-1",
        type: "text",
        message: "Question",
      } as NonNullable<AlisioState["setupWizardStep"]>,
      setupWizardError: "stale",
      setupWizardDraftText: "draft",
      alisioAuthPendingEmail: "owner@example.com",
      alisioAuthCode: "654321",
      alisioAuthStage: "email-code",
      alisioTermsAccepted: true,
      alisioMarketingOptIn: true,
      alisioBirthdate: "1990-04-06",
      alisioDoctor: createDoctorSummary(),
      alisioDoctorError: "stale doctor",
    });

    await signOutAlisioAccount(state);

    expect(state.alisioBootstrap).toBeNull();
    expect(state.alisioDoctor).toBeNull();
    expect(state.alisioDoctorError).toBeNull();
    expect(state.alisioModelsLoading).toBe(false);
    expect(state.alisioModelsError).toBeNull();
    expect(state.alisioModels).toBeNull();
    expect(state.alisioModelOperations).toEqual({});
    expect(state.alisioOrganization).toBeNull();
    expect(state.alisioConnectorCatalog).toEqual([]);
    expect(state.alisioConnectorAuthorizations).toEqual([]);
    expect(state.alisioConnectorSetupGuide).toBeNull();
    expect(state.chatModelCatalog).toEqual([
      { id: "gpt-5.4", name: "gpt-5.4", provider: "openai" },
    ]);
    expect(state.modelsExpandedProfileId).toBeUndefined();
    expect(state.modelsSelectedProviderId).toBeUndefined();
    expect(state.modelsServerDraft).toBeNull();
    expect(state.setupWizardSessionId).toBeNull();
    expect(state.setupWizardStep).toBeNull();
    expect(state.setupWizardStatus).toBeNull();
    expect(state.setupWizardDraftText).toBe("");
    expect(state.alisioAuthCode).toBe("");
    expect(state.alisioAuthStage).toBe("entry");
    expect(state.alisioTermsAccepted).toBe(false);
    expect(state.alisioMarketingOptIn).toBe(false);
    expect(state.alisioBirthdate).toBe("");
    expect(state.setupStep).toBe("account");
    expect(state.setTab).toHaveBeenCalledWith("setup");
  });

  it("actualiza o catálogo do picker de chat quando muda o endpoint activo", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "alisio.models.server.select") {
        return { ok: true, serverId: "server-2" };
      }
      if (method === "alisio.models.get") {
        return {
          backend: "llama.cpp",
          catalog: [],
          targets: [],
          servers: [
            {
              serverId: "server-2",
              label: "Studio",
              kind: "openai-compatible",
              baseUrl: "http://192.168.1.60:1234",
              active: true,
              hasApiKey: false,
              status: "ready",
              models: [{ id: "gpt-oss-20b", name: "gpt-oss-20b" }],
            },
          ],
        };
      }
      if (method === "models.list") {
        return {
          models: [{ id: "gpt-oss-20b", name: "gpt-oss-20b", provider: "alisio-remote" }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      client: createClient(request),
      chatModelCatalog: [{ id: "gpt-5.4", name: "gpt-5.4", provider: "openai" }],
    });

    await selectAlisioModelsServer(state, "server-2");

    expect(state.alisioModels?.servers[0]?.serverId).toBe("server-2");
    expect(state.chatModelCatalog).toEqual([
      { id: "gpt-oss-20b", name: "gpt-oss-20b", provider: "alisio-remote" },
    ]);
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

  it("pede o email de recuperação com o email actual da conta", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "alisio.account.requestRecoveryEmail") {
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

    await requestAlisioRecoveryEmail(state);

    expect(state.alisioAuthEmail).toBe("owner@example.com");
    expect(state.alisioAccountNotice).toBe("Reset sent");
    expect(state.alisioAccountError).toBeNull();
  });

  it("troca wording antigo de password por copy de recuperação de conta", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "alisio.account.requestRecoveryEmail") {
        return {
          ok: true,
          message: "We've sent a password reset email.",
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState({
      client: createClient(request),
      alisioAccount: {
        profile: {
          email: "owner@example.com",
        },
      } as unknown as AlisioState["alisioAccount"],
    });

    await requestAlisioRecoveryEmail(state);

    expect(state.alisioAccountNotice).toBe("Check your email for the Alisio recovery link.");
  });

  it("limpa o código pendente depois de verificar o email", async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "alisio.account.verifyEmailAuth") {
        expect(params).toEqual({
          email: "owner@example.com",
          code: "123456",
        });
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
      alisioAuthPendingEmail: "owner@example.com",
      alisioAuthCode: "123456",
      alisioAuthStage: "email-code",
    });

    await verifyAlisioAccountEmailAuth(state);

    expect(state.alisioAuthCode).toBe("");
    expect(state.alisioAuthStage).toBe("entry");
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
