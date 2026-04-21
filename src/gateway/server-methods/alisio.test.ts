import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../../shared/alisio-appearance.js";
import {
  buildAlisioCurrentProviderId,
  buildAlisioTargetProviderId,
} from "../../shared/alisio-dynamic-provider.js";

const { scheduleGatewaySigusr1RestartMock, startAlisioDeveloperRebuildMock } = vi.hoisted(() => ({
  scheduleGatewaySigusr1RestartMock: vi.fn(() => ({
    ok: true,
    pid: 1234,
    signal: "SIGUSR1" as const,
    delayMs: 0,
    reason: "alisio.runtime.restart",
    mode: "emit" as const,
    coalesced: false,
    cooldownMsApplied: 0,
  })),
  startAlisioDeveloperRebuildMock: vi.fn(() => ({
    ok: true as const,
    message:
      "Sync started. The app will close, rebuild the Control UI, restart the local runtime, and reopen. Log: /tmp/alisio-dev-rebuild.log",
    logPath: "/tmp/alisio-dev-rebuild.log",
  })),
}));

const {
  changeAlisioAccountEmailMock,
  requestAlisioAccountRecoveryEmailMock,
  signOutAlisioAccountMock,
  updateAlisioAccountPasswordMock,
} = vi.hoisted(() => ({
  changeAlisioAccountEmailMock: vi.fn(async () => ({
    ok: true as const,
    message: "Check your new email inbox to confirm the change.",
  })),
  requestAlisioAccountRecoveryEmailMock: vi.fn(async () => ({
    ok: true as const,
    message: "A recovery email is on its way.",
  })),
  signOutAlisioAccountMock: vi.fn(async () => ({
    profile: {
      userId: "user-1",
      username: "nuno",
      displayName: "Nuno Lopes",
      email: "nuno@example.com",
      avatarLabel: "N",
      joinedAt: "2026-04-04T15:00:00.000Z",
      plan: "free",
      backend: "supabase",
    },
    preferences: {
      language: "pt-PT",
      themeFamily: DEFAULT_THEME_FAMILY,
      themeMode: "dark",
      themeAccents: DEFAULT_THEME_ACCENTS,
    },
    session: {
      state: "signed_out" as const,
      profileCompleted: true,
      signedOutAt: "2026-04-04T15:05:00.000Z",
      backend: "supabase" as const,
    },
    devices: [],
    cloud: {
      backend: "supabase" as const,
      available: true,
      missingEnvVars: [],
    },
  })),
  updateAlisioAccountPasswordMock: vi.fn(async () => ({
    ok: true as const,
    message: "Your Alisio password was updated.",
  })),
}));

const {
  inspectManagedLocalModelRuntimeMock,
  installAlisioLocalModelMock,
  uninstallAlisioLocalModelMock,
} = vi.hoisted(() => ({
  inspectManagedLocalModelRuntimeMock: vi.fn(async () => ({
    backend: "llama.cpp" as const,
    runtimeKind: "llama.cpp" as const,
    runtimeLabel: "Local GGUF",
    status: "not_configured" as const,
    message: "No local llama.cpp models are installed on this computer yet.",
    models: [],
    availableModels: [],
    capabilities: {
      install: true,
      update: true,
      uninstall: true,
      consentRequired: true,
    },
    supportsInstall: true,
    supportsUpdate: true,
    supportsUninstall: true,
    consentRequired: true,
  })),
  installAlisioLocalModelMock: vi.fn(async ({ modelId }: { modelId: string }) => ({
    id: modelId,
    name: modelId,
    ownedBy: "llama.cpp",
  })),
  uninstallAlisioLocalModelMock: vi.fn(async ({ modelId }: { modelId: string }) => ({
    id: modelId,
    name: modelId,
    ownedBy: "llama.cpp",
  })),
}));

vi.mock("../../infra/restart.js", () => ({
  scheduleGatewaySigusr1Restart: scheduleGatewaySigusr1RestartMock,
}));

vi.mock("../../infra/alisio-dev-rebuild.js", () => ({
  startAlisioDeveloperRebuild: startAlisioDeveloperRebuildMock,
}));

vi.mock("../../infra/alisio-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/alisio-store.js")>();
  return {
    ...actual,
    changeAlisioAccountEmail: changeAlisioAccountEmailMock,
    requestAlisioAccountRecoveryEmail: requestAlisioAccountRecoveryEmailMock,
    signOutAlisioAccount: signOutAlisioAccountMock,
    updateAlisioAccountPassword: updateAlisioAccountPasswordMock,
  };
});

vi.mock("../../infra/alisio-local-llama-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/alisio-local-llama-runtime.js")>();
  return {
    ...actual,
    inspectManagedLocalModelRuntime: inspectManagedLocalModelRuntimeMock,
    installAlisioLocalModel: installAlisioLocalModelMock,
    uninstallAlisioLocalModel: uninstallAlisioLocalModelMock,
  };
});

import { setAlisioSharingPolicy } from "../../infra/alisio-store.js";
import { NodeRegistry } from "../node-registry.js";
import { alisioHandlers } from "./alisio.js";
import type { GatewayRequestContext } from "./types.js";

function makeContext(params?: {
  loadGatewayModelCatalog?: GatewayRequestContext["loadGatewayModelCatalog"];
  nodeRegistry?: GatewayRequestContext["nodeRegistry"];
}): GatewayRequestContext {
  return {
    getHealthCache: () => ({ ok: true }) as never,
    refreshHealthSnapshot: async () => ({ ok: true }) as never,
    loadGatewayModelCatalog: params?.loadGatewayModelCatalog ?? vi.fn(async () => []),
    findRunningWizard: () => null,
    broadcast: vi.fn(),
    nodeRegistry: params?.nodeRegistry ?? new NodeRegistry(),
  } as unknown as GatewayRequestContext;
}

function makeRespond() {
  const calls: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

async function withReadyLocalAccountEnv<T>(run: () => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-gateway-account-"));
  const previousStateDir = process.env.ALISIO_STATE_DIR;
  const previousSupabaseUrl = process.env.ALISIO_SUPABASE_URL;
  const previousSupabaseAnonKey = process.env.ALISIO_SUPABASE_ANON_KEY;
  process.env.ALISIO_STATE_DIR = root;
  process.env.ALISIO_SUPABASE_URL = "https://example.supabase.co";
  process.env.ALISIO_SUPABASE_ANON_KEY = "anon-key";
  try {
    const statePath = path.join(root, "alisio", "state.json");
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          version: 1,
          account: {
            profile: {
              userId: "user-1",
              username: "nuno",
              displayName: "Nuno Lopes",
              email: "nuno@example.com",
              avatarLabel: "N",
              joinedAt: "2026-04-04T15:00:00.000Z",
              plan: "free",
              backend: "supabase",
            },
            preferences: {
              language: "pt-PT",
              themeFamily: DEFAULT_THEME_FAMILY,
              themeMode: "dark",
              themeAccents: DEFAULT_THEME_ACCENTS,
            },
            session: {
              state: "signed_in",
              profileCompleted: true,
              signedInAt: "2026-04-04T15:00:00.000Z",
              backend: "supabase",
            },
          },
          organization: {
            mode: "none",
          },
          ai: {},
          authorizations: {},
          oauthCredentials: {},
          pendingAuthorizations: {},
          pendingAccountAuths: {},
        },
        null,
        2,
      ),
    );
    return await run();
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.ALISIO_STATE_DIR;
    } else {
      process.env.ALISIO_STATE_DIR = previousStateDir;
    }
    if (previousSupabaseUrl === undefined) {
      delete process.env.ALISIO_SUPABASE_URL;
    } else {
      process.env.ALISIO_SUPABASE_URL = previousSupabaseUrl;
    }
    if (previousSupabaseAnonKey === undefined) {
      delete process.env.ALISIO_SUPABASE_ANON_KEY;
    } else {
      process.env.ALISIO_SUPABASE_ANON_KEY = previousSupabaseAnonKey;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createNodeSession(
  nodeId: string,
  capabilityIds: string[],
): {
  nodeId: string;
  displayName: string;
  platform: string;
  connected: true;
  capabilities: Array<{ id: string }>;
} {
  return {
    nodeId,
    displayName: nodeId,
    platform: "darwin",
    connected: true,
    capabilities: capabilityIds.map((id) => ({ id })),
  };
}

function createNodeRegistryStub(params: {
  nodes: Array<ReturnType<typeof createNodeSession>>;
  tasks: Record<string, (input: unknown) => unknown>;
}): GatewayRequestContext["nodeRegistry"] {
  const nodesById = new Map(params.nodes.map((node) => [node.nodeId, node]));
  return {
    listConnected: () => params.nodes as never,
    get: (nodeId: string) => nodesById.get(nodeId) as never,
    startTask: vi.fn(({ capabilityId, input }: { capabilityId: string; input?: unknown }) => {
      const handler = params.tasks[capabilityId];
      if (!handler) {
        return {
          ok: false as const,
          error: { code: "UNAVAILABLE", message: `unexpected capability: ${capabilityId}` },
        };
      }
      return {
        ok: true as const,
        taskId: `task-${capabilityId}`,
        result: Promise.resolve({
          ok: true as const,
          payload: handler(input),
        }),
      };
    }),
  } as unknown as GatewayRequestContext["nodeRegistry"];
}

describe("alisio gateway methods", () => {
  it("serves the unified bootstrap summary", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.bootstrap.get"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.bootstrap.get", params: {}, id: 1 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      connectionRequired: false,
      wizardRequired: false,
      wizardRunning: false,
      authRequired: true,
      providerReady: false,
      accountReady: false,
      startupState: "signed_out",
      nextStep: "account",
      scopeRoot: "account",
    });
  });

  it("canonicalizes the account root around accountId, auth, device binding, and residency", async () => {
    await withReadyLocalAccountEnv(async () => {
      const context = makeContext();
      const { calls, respond } = makeRespond();

      await alisioHandlers["alisio.account.get"]({
        params: {},
        client: null,
        context,
        isWebchatConnect: () => false,
        respond,
        req: { method: "alisio.account.get", params: {}, id: 18 } as never,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.ok).toBe(true);
      expect(calls[0]?.payload).toMatchObject({
        accountId: "user-1",
        scopeRoot: "account",
        canonical: {
          accountId: "user-1",
          source: "user_id",
          authenticated: true,
          authRequired: true,
        },
        session: {
          state: "signed_in",
          authRequired: true,
          authenticated: true,
          accountId: "user-1",
        },
        deviceBinding: {
          binding: "account_bound",
          runtime: "local",
          accountId: "user-1",
        },
        runtimeContract: {
          scopeRoot: "account",
          backendShared: expect.arrayContaining([
            "account",
            "auth",
            "linked_devices",
            "session_index",
            "automations",
          ]),
          localRuntime: expect.arrayContaining([
            "identity",
            "soul",
            "preferences",
            "memory",
            "native_runtime",
          ]),
        },
      });
    });
  });

  it("serves the unified doctor summary", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.doctor.summary"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.doctor.summary", params: {}, id: 2 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: false,
      bootstrap: {
        nextStep: "account",
      },
    });
    const payload = calls[0]?.payload as { issues?: Array<{ code: string }> };
    expect(payload.issues?.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["account_not_ready", "runtime_not_ready"]),
    );
  });

  it("treats a local dynamic provider as runtime-ready without OpenAI auth", async () => {
    const context = makeContext({
      loadGatewayModelCatalog: vi.fn(async () => [
        {
          provider: buildAlisioCurrentProviderId(),
          id: "qwen3-4b-q4-k-m",
          name: "Qwen3 4B",
        },
      ]),
    });
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.bootstrap.get"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.bootstrap.get", params: {}, id: 3 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      providerReady: true,
      models: {
        total: 1,
        providers: [buildAlisioCurrentProviderId()],
      },
    });
  });

  it("skips the runtime error when a node llama provider is ready", async () => {
    const context = makeContext({
      loadGatewayModelCatalog: vi.fn(async () => [
        {
          provider: buildAlisioTargetProviderId({ targetId: "node-1" }),
          id: "llama3.2",
          name: "Llama 3.2",
        },
      ]),
    });
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.doctor.summary"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.doctor.summary", params: {}, id: 4 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      checks?: { runtime?: boolean };
      issues?: Array<{ code: string }>;
      bootstrap?: { providerReady?: boolean };
    };
    expect(payload.bootstrap?.providerReady).toBe(true);
    expect(payload.checks?.runtime).toBe(true);
    expect(payload.issues?.map((issue) => issue.code)).not.toContain("runtime_not_ready");
  });

  it("requires auth before serving local model targets", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.models.get"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.models.get", params: {}, id: 6 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(false);
    expect(calls[0]?.error).toMatchObject({
      code: "INVALID_REQUEST",
      message: "Alisio account sign-in required before using shared backend features.",
    });
  });

  it("installs a published local model on this computer", async () => {
    await withReadyLocalAccountEnv(async () => {
      const context = makeContext();
      const { calls, respond } = makeRespond();

      await alisioHandlers["alisio.models.install"]({
        params: {
          targetId: "current",
          modelId: "qwen3-4b-q4-k-m",
        },
        client: null,
        context,
        isWebchatConnect: () => false,
        respond,
        req: { method: "alisio.models.install", params: {}, id: 7 } as never,
      });

      expect(installAlisioLocalModelMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: "qwen3-4b-q4-k-m",
        }),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.ok).toBe(true);
      expect(calls[0]?.payload).toMatchObject({
        ok: true,
        backend: "llama.cpp",
        targetId: expect.stringMatching(/^local:.*::llama\.cpp$/),
        modelId: "qwen3-4b-q4-k-m",
      });
    });
  });

  it("uninstalls a published local model on this computer", async () => {
    await withReadyLocalAccountEnv(async () => {
      const context = makeContext();
      const { calls, respond } = makeRespond();

      await alisioHandlers["alisio.models.uninstall"]({
        params: {
          targetId: "current",
          modelId: "qwen3-4b-q4-k-m",
        },
        client: null,
        context,
        isWebchatConnect: () => false,
        respond,
        req: { method: "alisio.models.uninstall", params: {}, id: 8 } as never,
      });

      expect(uninstallAlisioLocalModelMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: "qwen3-4b-q4-k-m",
        }),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.ok).toBe(true);
      expect(calls[0]?.payload).toMatchObject({
        ok: true,
        backend: "llama.cpp",
        targetId: expect.stringMatching(/^local:.*::llama\.cpp$/),
        modelId: "qwen3-4b-q4-k-m",
      });
    });
  });

  it("installs a llama.cpp model on a linked device via the dedicated node capability", async () => {
    await withReadyLocalAccountEnv(async () => {
      const statePath = path.join(process.env.ALISIO_STATE_DIR!, "alisio", "state.json");
      const state = JSON.parse(await fs.readFile(statePath, "utf-8")) as {
        account?: { profile?: { plan?: string } };
      };
      if (state.account?.profile) {
        state.account.profile.plan = "plus";
      }
      await fs.writeFile(statePath, JSON.stringify(state, null, 2));

      await setAlisioSharingPolicy({
        resourcePolicies: {
          models: "paired-device",
          compute: "paired-device",
          jobs: "paired-device",
        },
      });

      const nodeRegistry = createNodeRegistryStub({
        nodes: [
          createNodeSession("remote-llama", [
            "model.catalog.llamacpp.v1",
            "model.manage.llamacpp.v1",
            "model.chat.llamacpp.v1",
          ]),
        ],
        tasks: {
          "model.catalog.llamacpp.v1": () => ({
            runtimeKind: "llama.cpp",
            runtimeLabel: "Local GGUF",
            status: "ready",
            models: [],
            availableModels: [],
            capabilities: {
              install: true,
              update: true,
              uninstall: true,
              consentRequired: true,
            },
            supportsInstall: true,
            supportsUpdate: true,
            supportsUninstall: true,
            consentRequired: true,
          }),
          "model.manage.llamacpp.v1": () => ({
            ok: true,
            action: "install",
          }),
        },
      });
      const context = makeContext({ nodeRegistry });
      const { calls, respond } = makeRespond();

      await alisioHandlers["alisio.models.install"]({
        params: {
          targetId: "remote-llama::llama.cpp",
          modelId: "qwen3-4b-q4-k-m",
        },
        client: null,
        context,
        isWebchatConnect: () => false,
        respond,
        req: { method: "alisio.models.install", params: {}, id: 72 } as never,
      });

      const startTaskCalls = (
        nodeRegistry.startTask as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }
      ).mock.calls;
      expect(startTaskCalls).toEqual(
        expect.arrayContaining([
          [
            expect.objectContaining({
              capabilityId: "model.manage.llamacpp.v1",
              input: expect.objectContaining({
                action: "install",
                modelId: "qwen3-4b-q4-k-m",
              }),
            }),
          ],
        ]),
      );
      expect(calls[0]?.ok).toBe(true);
      expect(calls[0]?.payload).toMatchObject({
        targetId: "remote-llama::llama.cpp",
        modelId: "qwen3-4b-q4-k-m",
      });
    });
  });

  it("allows organization membership on Free", async () => {
    await withReadyLocalAccountEnv(async () => {
      const context = makeContext();
      const { calls, respond } = makeRespond();

      await alisioHandlers["alisio.organization.set"]({
        params: {
          mode: "owner",
          organizationName: "Alisio",
        },
        client: null,
        context,
        isWebchatConnect: () => false,
        respond,
        req: { method: "alisio.organization.set", params: {}, id: 9 } as never,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.ok).toBe(true);
      expect(calls[0]?.payload).toMatchObject({
        mode: "owner",
        organizationName: "Alisio",
      });
    });
  });

  it("allows connector setup to continue when the cloud account backend is configured", async () => {
    await withReadyLocalAccountEnv(async () => {
      const context = makeContext();
      const { calls, respond } = makeRespond();

      await alisioHandlers["connectors.begin"]({
        params: {
          connectorId: "google-calendar",
        },
        client: null,
        context,
        isWebchatConnect: () => false,
        respond,
        req: { method: "connectors.begin", params: {}, id: 10 } as never,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.ok).toBe(true);
      expect(calls[0]?.payload).toMatchObject({
        connectorId: "google-calendar",
      });
    });
  });

  it("rejects invalid account usernames with a product-facing validation error", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.account.update"]({
      params: {
        username: "nu!",
        displayName: "Nuno Lopes",
        email: "nuno@example.com",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.account.update", params: {}, id: 4 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(false);
  });

  it("starts account recovery with a product-facing success result", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.account.requestRecoveryEmail"]({
      params: {
        email: "nuno@example.com",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.account.requestRecoveryEmail", params: {}, id: 5 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      message: expect.stringContaining("recovery email"),
    });
  });

  it("starts account email change with a product-facing success result", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.account.changeEmail"]({
      params: {
        email: "next@example.com",
        callbackUrl: "http://localhost:40705/logout/settings",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.account.changeEmail", params: {}, id: 15 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(changeAlisioAccountEmailMock).toHaveBeenCalledWith(
      {
        email: "next@example.com",
        callbackUrl: "http://localhost:40705/logout/settings",
      },
      process.env,
    );
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      message: expect.stringContaining("confirm the change"),
    });
  });

  it("updates the account password with a product-facing success result", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.account.updatePassword"]({
      params: {
        password: "password123",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.account.updatePassword", params: {}, id: 16 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(updateAlisioAccountPasswordMock).toHaveBeenCalledWith(
      {
        password: "password123",
      },
      process.env,
    );
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      message: expect.stringContaining("password"),
    });
  });

  it("surfaces a controlled gateway error when logout fails", async () => {
    signOutAlisioAccountMock.mockRejectedValueOnce(new Error("disk unavailable"));
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.account.signOut"]({
      params: {},
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.account.signOut", params: {}, id: 17 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(false);
    expect(calls[0]?.error).toMatchObject({
      code: "UNAVAILABLE",
      message: "failed to sign out of Alisio: disk unavailable",
    });
  });

  it("keeps the legacy password-reset alias working for older clients", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.account.requestPasswordReset"]({
      params: {
        email: "nuno@example.com",
      },
      client: null,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.account.requestPasswordReset", params: {}, id: 6 } as never,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ok).toBe(true);
  });

  it("schedules a restart from the unified product runtime action", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.runtime.restart"]({
      params: {},
      client: {
        connect: {
          role: "operator",
          scopes: ["operator.admin"],
          device: { id: "device-1" },
        },
        clientIp: "127.0.0.1",
      } as never,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.runtime.restart", params: {}, id: 3 } as never,
    });

    expect(scheduleGatewaySigusr1RestartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        delayMs: 0,
        reason: "alisio.runtime.restart",
      }),
    );
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      signal: "SIGUSR1",
      delayMs: 0,
      reason: "alisio.runtime.restart",
    });
  });

  it("starts an app rebuild from the unified product runtime action", async () => {
    const context = makeContext();
    const { calls, respond } = makeRespond();

    await alisioHandlers["alisio.app.rebuild"]({
      params: {},
      client: {
        connect: {
          role: "operator",
          scopes: ["operator.admin"],
          device: { id: "device-1" },
        },
        clientIp: "127.0.0.1",
      } as never,
      context,
      isWebchatConnect: () => false,
      respond,
      req: { method: "alisio.app.rebuild", params: {}, id: 4 } as never,
    });

    expect(startAlisioDeveloperRebuildMock).toHaveBeenCalledTimes(1);
    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      logPath: "/tmp/alisio-dev-rebuild.log",
    });
  });
});
