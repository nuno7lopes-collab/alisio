import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderPlugin } from "../plugins/types.js";
import type { ProviderAuthMethod } from "../plugins/types.js";
import type { ApplyAuthChoiceParams } from "./auth-choice.apply.js";
import {
  applyAuthChoiceLoadedPluginProvider,
  applyAuthChoicePluginProvider,
  runProviderPluginAuthMethod,
} from "./auth-choice.apply.plugin-provider.js";

const resolvePluginProviders = vi.hoisted(() => vi.fn<() => ProviderPlugin[]>(() => []));
const resolveProviderPluginChoice = vi.hoisted(() =>
  vi.fn<() => { provider: ProviderPlugin; method: ProviderAuthMethod } | null>(),
);
const runProviderModelSelectedHook = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../plugins/provider-auth-choice.runtime.js", () => ({
  resolvePluginProviders,
  resolveProviderPluginChoice,
  runProviderModelSelectedHook,
}));

const upsertAuthProfile = vi.hoisted(() => vi.fn());
vi.mock("../agents/auth-profiles.js", () => ({
  upsertAuthProfile,
}));

const resolveDefaultAgentId = vi.hoisted(() => vi.fn(() => "default"));
const resolveAgentWorkspaceDir = vi.hoisted(() => vi.fn(() => "/tmp/workspace"));
const resolveAgentDir = vi.hoisted(() => vi.fn(() => "/tmp/agent"));
vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
}));

const resolveDefaultAgentWorkspaceDir = vi.hoisted(() => vi.fn(() => "/tmp/workspace"));
vi.mock("../agents/workspace.js", () => ({
  resolveDefaultAgentWorkspaceDir,
}));

const resolveAlisioAgentDir = vi.hoisted(() => vi.fn(() => "/tmp/agent"));
vi.mock("../agents/agent-paths.js", () => ({
  resolveAlisioAgentDir,
}));

const applyAuthProfileConfig = vi.hoisted(() => vi.fn((config) => config));
vi.mock("../plugins/provider-auth-helpers.js", () => ({
  applyAuthProfileConfig,
}));

const isRemoteEnvironment = vi.hoisted(() => vi.fn(() => false));
const openUrl = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../plugins/setup-browser.js", () => ({
  isRemoteEnvironment,
  openUrl,
}));

const createVpsAwareOAuthHandlers = vi.hoisted(() => vi.fn());
vi.mock("../plugins/provider-oauth-flow.js", () => ({
  createVpsAwareOAuthHandlers,
}));

function buildProvider(): ProviderPlugin {
  return {
    id: "vllm",
    label: "vLLM",
    auth: [
      {
        id: "local",
        label: "vLLM",
        kind: "custom",
        run: async () => ({
          profiles: [
            {
              profileId: "vllm:default",
              credential: {
                type: "api_key",
                provider: "vllm",
                key: "custom-local",
              },
            },
          ],
          defaultModel: "vllm/qwen3:4b",
        }),
      },
    ],
  };
}

function buildParams(overrides: Partial<ApplyAuthChoiceParams> = {}): ApplyAuthChoiceParams {
  return {
    authChoice: "vllm",
    config: {},
    prompter: {
      note: vi.fn(async () => {}),
    } as unknown as ApplyAuthChoiceParams["prompter"],
    runtime: {} as ApplyAuthChoiceParams["runtime"],
    setDefaultModel: true,
    ...overrides,
  };
}

describe("applyAuthChoiceLoadedPluginProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyAuthProfileConfig.mockImplementation((config) => config);
  });

  it("returns an agent model override when default model application is deferred", async () => {
    const provider = buildProvider();
    resolvePluginProviders.mockReturnValue([provider]);
    resolveProviderPluginChoice.mockReturnValue({
      provider,
      method: provider.auth[0],
    });

    const result = await applyAuthChoiceLoadedPluginProvider(
      buildParams({
        setDefaultModel: false,
      }),
    );

    expect(result).toEqual({
      config: {},
      agentModelOverride: "vllm/qwen3:4b",
    });
    expect(runProviderModelSelectedHook).not.toHaveBeenCalled();
  });

  it("applies the default model and runs provider post-setup hooks", async () => {
    const provider = buildProvider();
    resolvePluginProviders.mockReturnValue([provider]);
    resolveProviderPluginChoice.mockReturnValue({
      provider,
      method: provider.auth[0],
    });

    const result = await applyAuthChoiceLoadedPluginProvider(buildParams());

    expect(result?.config.agents?.defaults?.model).toEqual({
      primary: "vllm/qwen3:4b",
    });
    expect(upsertAuthProfile).toHaveBeenCalledWith({
      profileId: "vllm:default",
      credential: {
        type: "api_key",
        provider: "vllm",
        key: "custom-local",
      },
      agentDir: "/tmp/agent",
    });
    expect(runProviderModelSelectedHook).toHaveBeenCalledWith({
      config: result?.config,
      model: "vllm/qwen3:4b",
      prompter: expect.objectContaining({ note: expect.any(Function) }),
      agentDir: undefined,
      workspaceDir: "/tmp/workspace",
    });
  });

  it("merges provider config patches and emits provider notes", async () => {
    applyAuthProfileConfig.mockImplementation(((
      config: {
        auth?: {
          profiles?: Record<string, { provider: string; mode: string }>;
        };
      },
      profile: { profileId: string; provider: string; mode: string },
    ) => ({
      ...config,
      auth: {
        profiles: {
          ...config.auth?.profiles,
          [profile.profileId]: {
            provider: profile.provider,
            mode: profile.mode,
          },
        },
      },
    })) as never);

    const note = vi.fn(async () => {});
    const method: ProviderAuthMethod = {
      id: "local",
      label: "Local",
      kind: "custom",
      run: async () => ({
        profiles: [
          {
            profileId: "vllm:default",
            credential: {
              type: "api_key",
              provider: "vllm",
              key: "custom-local",
            },
          },
        ],
        configPatch: {
          models: {
            providers: {
              vllm: {
                api: "openai-completions",
                baseUrl: "http://127.0.0.1:8000/v1",
                models: [],
              },
            },
          },
        },
        defaultModel: "vllm/qwen3:4b",
        notes: ["Detected local vLLM runtime.", "Pulled model metadata."],
      }),
    };

    const result = await runProviderPluginAuthMethod({
      config: {
        agents: {
          defaults: {
            model: { primary: "anthropic/claude-sonnet-4-5" },
          },
        },
      },
      runtime: {} as ApplyAuthChoiceParams["runtime"],
      prompter: {
        note,
      } as unknown as ApplyAuthChoiceParams["prompter"],
      method,
    });

    expect(result.defaultModel).toBe("vllm/qwen3:4b");
    expect(result.config.models?.providers?.vllm).toEqual({
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:8000/v1",
      models: [],
    });
    expect(result.config.auth?.profiles?.["vllm:default"]).toEqual({
      provider: "vllm",
      mode: "api_key",
    });
    expect(note).toHaveBeenCalledWith(
      "Detected local vLLM runtime.\nPulled model metadata.",
      "Provider notes",
    );
  });

  it("returns an agent-scoped override for plugin auth choices when default model application is deferred", async () => {
    const provider = buildProvider();
    resolvePluginProviders.mockReturnValue([provider]);

    const note = vi.fn(async () => {});
    const result = await applyAuthChoicePluginProvider(
      buildParams({
        authChoice: "provider-plugin:vllm:local",
        agentId: "worker",
        setDefaultModel: false,
        prompter: {
          note,
        } as unknown as ApplyAuthChoiceParams["prompter"],
      }),
      {
        authChoice: "provider-plugin:vllm:local",
        pluginId: "vllm",
        providerId: "vllm",
        methodId: "local",
        label: "vLLM",
      },
    );

    expect(result?.agentModelOverride).toBe("vllm/qwen3:4b");
    expect(result?.config.plugins).toEqual({
      entries: {
        vllm: {
          enabled: true,
        },
      },
    });
    expect(runProviderModelSelectedHook).not.toHaveBeenCalled();
    expect(note).toHaveBeenCalledWith(
      'Default model set to vllm/qwen3:4b for agent "worker".',
      "Model configured",
    );
  });

  it("stops early when the plugin is disabled in config", async () => {
    const note = vi.fn(async () => {});

    const result = await applyAuthChoicePluginProvider(
      buildParams({
        config: {
          plugins: {
            enabled: false,
          },
        },
        prompter: {
          note,
        } as unknown as ApplyAuthChoiceParams["prompter"],
      }),
      {
        authChoice: "vllm",
        pluginId: "vllm",
        providerId: "vllm",
        label: "vLLM",
      },
    );

    expect(result).toEqual({
      config: {
        plugins: {
          enabled: false,
        },
      },
    });
    expect(resolvePluginProviders).not.toHaveBeenCalled();
    expect(note).toHaveBeenCalledWith("vLLM plugin is disabled (plugins disabled).", "vLLM");
  });
});
