/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { setDefaultChatModel } from "../app-render.helpers.ts";
import type { AlisioBootstrapState, AlisioModelsState } from "../types.ts";
import { renderModelsHub } from "./models.ts";

function createBootstrap(): AlisioBootstrapState {
  return {
    ai: {
      provider: "openai",
      status: "connected",
      activeProfileId: "profile-1",
      binding: {
        workerId: "main",
        workerCredentialId: "cred-1",
        authProfileId: "auth-1",
        boundAt: "2026-04-04T12:00:00.000Z",
      },
      profiles: [
        {
          profileId: "profile-1",
          label: "Personal",
          provider: "openai",
          scope: "user",
          ownerKey: "user:1",
          canonicalIdentityKey: "user:1",
          identity: {
            email: "alice@example.com",
          },
          status: "connected",
          email: "alice@example.com",
          connectedAt: "2026-04-04T12:00:00.000Z",
        },
      ],
    },
    account: {
      profile: {
        plan: "plus",
      },
      preferences: {
        language: "en",
      },
    },
  } as AlisioBootstrapState;
}

function createModelsState(): AlisioModelsState {
  return {
    backend: "llama.cpp",
    catalog: [
      {
        id: "qwen3-4b-q4-k-m",
        slug: "qwen3-4b-q4-k-m",
        family: "Qwen",
        name: "Qwen3 4B",
        parametersBillions: 4,
        quantization: "Q4_K_M",
        backend: "llama.cpp",
        summary: "Light local model.",
        diskGb: 3.3,
        memoryGb: 8,
        releaseStage: "published",
      },
      {
        id: "qwen3-8b-q4-k-m",
        slug: "qwen3-8b-q4-k-m",
        family: "Qwen",
        name: "Qwen3 8B",
        parametersBillions: 8,
        quantization: "Q4_K_M",
        backend: "llama.cpp",
        summary: "Balanced local model.",
        diskGb: 5.1,
        memoryGb: 12,
        releaseStage: "published",
      },
    ],
    targets: [
      {
        targetId: "current",
        deviceId: "current",
        label: "Workstation",
        runtimeLabel: "Local GGUF",
        platform: "darwin",
        current: true,
        connected: true,
        location: "local",
        backend: "llama.cpp",
        runtimeKind: "llama.cpp",
        chatProviderId: "alisio-local-current",
        runtimeStatus: "ready",
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
        installedModels: [{ id: "qwen3-4b-q4-k-m", name: "Qwen3 4B", ownedBy: "llama.cpp" }],
        recommendations: [
          {
            modelId: "qwen3-8b-q4-k-m",
            grade: "recommended",
            label: "Recommended",
            reason: "Best fit for this computer",
          },
        ],
        bestModelId: "qwen3-8b-q4-k-m",
        bestModelName: "Qwen3 8B",
        hardware: {
          platform: "darwin",
          architecture: "arm64",
          totalMemoryGb: 36,
          cpuCores: 10,
        },
      },
      {
        targetId: "node-1",
        deviceId: "node-1",
        label: "Studio Mac",
        runtimeLabel: "Local GGUF",
        platform: "darwin",
        current: false,
        connected: true,
        location: "node",
        backend: "llama.cpp",
        runtimeKind: "llama.cpp",
        chatProviderId: "alisio-target-node-1-llama",
        runtimeStatus: "ready",
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
        installedModels: [{ id: "qwen3-8b-q4-k-m", name: "Qwen3 8B", ownedBy: "llama.cpp" }],
        recommendations: [
          {
            modelId: "qwen3-8b-q4-k-m",
            grade: "recommended",
            label: "Recommended",
            reason: "Good fit for this node",
          },
        ],
      },
    ],
  };
}

function createProps(overrides: Partial<Parameters<typeof renderModelsHub>[0]> = {}) {
  return {
    bootstrap: createBootstrap(),
    models: createModelsState(),
    modelsLoading: false,
    modelsError: null,
    modelOperations: {},
    aiLoading: false,
    aiError: null,
    expandedProfileId: "profile-1",
    selectedProviderId: "openai" as const,
    modelOptions: [
      { value: "openai-codex/gpt-5.4", label: "gpt-5.4 · openai-codex" },
      { value: "openai-codex/gpt-5.3-codex", label: "gpt-5.3-codex · openai-codex" },
      {
        value: "alisio-local-current/qwen3-4b-q4-k-m",
        label: "Qwen3 4B · This computer",
      },
      {
        value: "alisio-target-node-1-llama/qwen3-8b-q4-k-m",
        label: "Qwen3 8B · Studio Mac",
      },
    ],
    defaultChatModelValue: "openai-codex/gpt-5.4",
    defaultChatModelDisplay: "gpt-5.4 · openai-codex",
    defaultChatModelLabel: "Default (gpt-5.4 · openai-codex)",
    modelPickerBusy: false,
    onToggleProfile: vi.fn(),
    onSelectProvider: vi.fn(),
    onConnectAi: vi.fn(),
    onRefreshAllAiProfiles: vi.fn(),
    onSelectDefaultChatModel: vi.fn(),
    onSelectAiProfile: vi.fn(),
    onDisconnectAiProfile: vi.fn(),
    onRefreshAiProfile: vi.fn(),
    onRenameAiProfile: vi.fn(),
    onInstallModel: vi.fn(),
    onUpdateModel: vi.fn(),
    onUninstallModel: vi.fn(),
    ...overrides,
  } satisfies Parameters<typeof renderModelsHub>[0];
}

function createDefaultModelState(
  request: (method: string, params?: unknown) => Promise<unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    client: { request },
    connected: true,
    applySessionKey: "main",
    configLoading: false,
    configRaw: "",
    configRawOriginal: "",
    configValid: null,
    configIssues: [],
    configSaving: false,
    configApplying: false,
    updateRunning: false,
    configSnapshot: null,
    configSchema: null,
    configSchemaVersion: null,
    configSchemaLoading: false,
    configUiHints: {},
    configForm: null,
    configFormOriginal: null,
    configFormDirty: false,
    configFormMode: "form",
    configSearchQuery: "",
    configActiveSection: null,
    configActiveSubsection: null,
    lastError: null,
    sessionKey: "main",
    chatModelOverrides: {},
    chatModelCatalog: [{ id: "gpt-5.4", name: "GPT-5.4", provider: "openai-codex" }],
    chatModelsLoading: false,
    modelManagementCatalog: [],
    modelManagementLoading: false,
    sessionsResult: {
      ts: 0,
      path: "",
      count: 1,
      defaults: {
        modelProvider: "openai-codex",
        model: "gpt-5.4",
        contextTokens: null,
      },
      sessions: [{ key: "main", kind: "direct", updatedAt: null }],
    },
    ...overrides,
  } as unknown as Parameters<typeof setDefaultChatModel>[0];
}

describe("renderModelsHub", () => {
  it("renders only the three supported source cards and wires OpenAI selection", () => {
    const props = createProps();
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const providerTitles = Array.from(
      container.querySelectorAll<HTMLElement>(".alisio-models__provider-title"),
    ).map((element) => element.textContent?.trim() ?? "");

    expect(providerTitles).toEqual(["OpenAI", "This computer", "Alisio nodes"]);

    const nodesCard = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Alisio nodes"),
    );
    nodesCard?.click();
    expect(props.onSelectProvider).toHaveBeenCalledWith("nodes");

    const allModelButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".alisio-models__model-chip"),
    ).filter((button) => button.textContent?.includes("gpt-5.3-codex"));
    allModelButtons[0]?.click();
    expect(props.onSelectDefaultChatModel).toHaveBeenCalledWith("openai-codex/gpt-5.3-codex");
    expect(container.textContent).not.toContain("This chat");
  });

  it("renders the local surface with install, update and uninstall actions", () => {
    const props = createProps({
      selectedProviderId: "local",
      modelOperations: {
        "current::qwen3-8b-q4-k-m": {
          targetId: "current",
          modelId: "qwen3-8b-q4-k-m",
          action: "install",
          phase: "running",
          percent: 42,
          updatedAt: Date.now(),
        },
      },
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const section = container.querySelector<HTMLElement>(".alisio-models-section");

    expect(section?.textContent).toContain("This computer");
    expect(section?.textContent).toContain("Qwen3 4B");
    expect(section?.textContent).toContain("Installing");
    expect(section?.textContent ?? "").not.toContain("Studio Mac");

    const updateButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Update"),
    );
    updateButton?.click();
    expect(props.onUpdateModel).toHaveBeenCalledWith("current", "qwen3-4b-q4-k-m");

    const uninstallButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Uninstall"));
    uninstallButton?.click();
    expect(props.onUninstallModel).toHaveBeenCalledWith("current", "qwen3-4b-q4-k-m");
  });

  it("renders the nodes surface with paired-node models only", () => {
    const props = createProps({
      selectedProviderId: "nodes",
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const section = container.querySelector<HTMLElement>(".alisio-models-section");

    expect(section?.textContent).toContain("Alisio nodes");
    expect(section?.textContent).toContain("Studio Mac");
    expect(section?.textContent).toContain("Qwen3 8B");
    expect(section?.textContent ?? "").not.toContain("alice@example.com");
    expect(container.querySelector(".alisio-models__chooser")).toBeNull();
  });

  it("shows read-only metadata for shared nodes", () => {
    const baseModels = createModelsState();
    const props = createProps({
      selectedProviderId: "nodes",
      models: {
        ...baseModels,
        targets: [
          baseModels.targets[0],
          {
            ...baseModels.targets[1],
            access: "shared",
            ownerLabel: "Alice",
            ownerScope: "user",
            grantId: "grant-1",
          },
        ],
      },
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("Read-only");
    expect(container.textContent).toContain("Shared");
    expect(container.textContent).toContain("Owned by Alice");
  });

  it("renders loading, empty and error states for the local surface", () => {
    const loadingProps = createProps({
      selectedProviderId: "local",
      modelsLoading: true,
      models: null,
    });
    const loadingContainer = document.createElement("div");
    render(renderModelsHub(loadingProps), loadingContainer);
    expect(loadingContainer.querySelectorAll(".loading-state__list-item").length).toBeGreaterThan(
      1,
    );

    const emptyProps = createProps({
      selectedProviderId: "local",
      models: {
        ...createModelsState(),
        targets: [],
      },
    });
    const emptyContainer = document.createElement("div");
    render(renderModelsHub(emptyProps), emptyContainer);
    expect(emptyContainer.textContent).toContain(
      "This computer has not reported any local model state yet.",
    );

    const errorProps = createProps({
      selectedProviderId: "local",
      modelsError: "Local fetch failed",
    });
    const errorContainer = document.createElement("div");
    render(renderModelsHub(errorProps), errorContainer);
    expect(errorContainer.textContent).toContain("Local fetch failed");
  });

  it("renders loading, empty and error states for the nodes surface", () => {
    const loadingProps = createProps({
      selectedProviderId: "nodes",
      modelsLoading: true,
      models: null,
    });
    const loadingContainer = document.createElement("div");
    render(renderModelsHub(loadingProps), loadingContainer);
    expect(loadingContainer.querySelectorAll(".loading-state__list-item").length).toBeGreaterThan(
      1,
    );

    const emptyProps = createProps({
      selectedProviderId: "nodes",
      models: {
        ...createModelsState(),
        targets: [createModelsState().targets[0]],
      },
    });
    const emptyContainer = document.createElement("div");
    render(renderModelsHub(emptyProps), emptyContainer);
    expect(emptyContainer.textContent).toContain("No Alisio nodes are available yet.");

    const errorProps = createProps({
      selectedProviderId: "nodes",
      modelsError: "Node list failed",
    });
    const errorContainer = document.createElement("div");
    render(renderModelsHub(errorProps), errorContainer);
    expect(errorContainer.textContent).toContain("Node list failed");
  });

  it("hides OpenAI model controls until an account is actually connected", () => {
    const props = createProps({
      bootstrap: {
        ...createBootstrap(),
        ai: {
          provider: "openai",
          status: "disconnected",
        },
      } as AlisioBootstrapState,
      selectedProviderId: "openai",
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain(
      "No OpenAI accounts have been connected in Alisio yet.",
    );
    expect(container.querySelector(".alisio-models__chooser")).toBeNull();
    expect(container.textContent).not.toContain("gpt-5.4 · openai-codex");
  });

  it("shows the precise status copy when limits telemetry is unavailable", () => {
    const props = createProps({
      bootstrap: {
        ...createBootstrap(),
        ai: {
          ...createBootstrap().ai,
          status: "limits_unavailable",
          profiles: [
            {
              ...createBootstrap().ai.profiles![0],
              status: "limits_unavailable",
            },
          ],
        },
      } as AlisioBootstrapState,
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("Connected (limits unavailable)");
  });

  it("setDefaultChatModel does not create a new allowlist when the config was previously open", async () => {
    const patchedRaw: unknown[] = [];
    const request = async (method: string, params?: unknown) => {
      if (method === "config.get") {
        return {
          hash: "hash-1",
          config: {
            agents: {
              defaults: {
                model: {
                  primary: "openai-codex/gpt-5.4",
                },
              },
            },
          },
        };
      }
      if (method === "config.patch") {
        const raw = (params as { raw?: unknown }).raw;
        if (typeof raw !== "string") {
          throw new Error("expected config.patch raw string");
        }
        patchedRaw.push(JSON.parse(raw));
        return { ok: true };
      }
      if (method === "sessions.list") {
        return {
          ts: 0,
          path: "",
          count: 1,
          defaults: {
            modelProvider: "openai-codex",
            model: "gpt-5.3-codex",
            contextTokens: null,
          },
          sessions: [{ key: "main", kind: "direct", updatedAt: null }],
        };
      }
      if (method === "models.list") {
        return {
          models: [{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex", provider: "openai-codex" }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    };

    const state = createDefaultModelState(request);
    await setDefaultChatModel(state, "openai-codex/gpt-5.3-codex");

    expect(patchedRaw).toHaveLength(1);
    expect(patchedRaw[0]).toEqual({
      agents: {
        defaults: {
          model: {
            primary: "openai-codex/gpt-5.3-codex",
          },
        },
      },
    });
  });

  it("setDefaultChatModel preserves and extends an existing allowlist", async () => {
    const patchedRaw: unknown[] = [];
    const request = async (method: string, params?: unknown) => {
      if (method === "config.get") {
        return {
          hash: "hash-1",
          config: {
            agents: {
              defaults: {
                model: {
                  primary: "openai-codex/gpt-5.4",
                },
                models: {
                  "openai-codex/gpt-5.4": {},
                },
              },
            },
          },
        };
      }
      if (method === "config.patch") {
        const raw = (params as { raw?: unknown }).raw;
        if (typeof raw !== "string") {
          throw new Error("expected config.patch raw string");
        }
        patchedRaw.push(JSON.parse(raw));
        return { ok: true };
      }
      if (method === "sessions.list") {
        return {
          ts: 0,
          path: "",
          count: 1,
          defaults: {
            modelProvider: "openai-codex",
            model: "gpt-5.3-codex",
            contextTokens: null,
          },
          sessions: [{ key: "main", kind: "direct", updatedAt: null }],
        };
      }
      if (method === "models.list") {
        return {
          models: [
            { id: "gpt-5.4", name: "GPT-5.4", provider: "openai-codex" },
            { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", provider: "openai-codex" },
          ],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    };

    const state = createDefaultModelState(request);
    await setDefaultChatModel(state, "openai-codex/gpt-5.3-codex");

    expect(patchedRaw).toHaveLength(1);
    expect(patchedRaw[0]).toEqual({
      agents: {
        defaults: {
          model: {
            primary: "openai-codex/gpt-5.3-codex",
          },
          models: {
            "openai-codex/gpt-5.4": {},
            "openai-codex/gpt-5.3-codex": {},
          },
        },
      },
    });
  });
});
