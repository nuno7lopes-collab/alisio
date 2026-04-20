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

function createRecommendation(
  overrides: Partial<NonNullable<AlisioModelsState["targets"]>[number]["recommendations"][number]>,
): NonNullable<AlisioModelsState["targets"]>[number]["recommendations"][number] {
  return {
    modelId: "qwen3-8b-q4-k-m",
    grade: "recommended",
    reasonCode: "comfortable",
    requiredRamGb: 12,
    requiredVramGb: 8,
    availableRamGb: 36,
    availableVramGb: 18,
    label: "Recommended",
    reason: "Best fit for the current runtime",
    ...overrides,
  };
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
        recommendations: [createRecommendation({})],
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
          createRecommendation({
            reason: "Good fit for this node",
          }),
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
    profileSort: "email-asc" as const,
    profileRecentIds: [],
    modelOptions: [
      { value: "openai-codex/gpt-5.4", label: "gpt-5.4 · openai-codex" },
      { value: "openai-codex/gpt-5.3-codex", label: "gpt-5.3-codex · openai-codex" },
      {
        value: "alisio-local-current/qwen3-4b-q4-k-m",
        label: "Qwen3 4B · Current runtime",
      },
      {
        value: "alisio-target-node-1-llama/qwen3-8b-q4-k-m",
        label: "Qwen3 8B · Studio Mac",
      },
    ],
    onToggleProfile: vi.fn(),
    onProfileSortChange: vi.fn(),
    onSelectProvider: vi.fn(),
    onConnectAi: vi.fn(),
    onRefreshAllAiProfiles: vi.fn(),
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
  it("renders only OpenAI and current runtime cards and wires local selection", () => {
    const props = createProps();
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const providerTitles = Array.from(
      container.querySelectorAll<HTMLElement>(".alisio-models__provider-title"),
    ).map((element) => element.textContent?.trim() ?? "");

    expect(providerTitles).toEqual(["OpenAI", "Current runtime"]);

    const localCard = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Current runtime"),
    );
    localCard?.click();
    expect(props.onSelectProvider).toHaveBeenCalledWith("local");
    expect(container.querySelector(".alisio-models__chooser")).toBeNull();
    expect(container.textContent).toContain("alice@example.com");
    expect(container.textContent).not.toContain("This chat");
    expect(container.textContent).not.toContain("Alisio nodes");
  });

  it("renders the shared empty state when no OpenAI profiles are available", () => {
    const container = document.createElement("div");

    render(
      renderModelsHub(
        createProps({
          bootstrap: {
            ai: null,
            account: createBootstrap().account,
          } as unknown as AlisioBootstrapState,
          selectedProviderId: "openai",
        }),
      ),
      container,
    );

    const emptyState = container.querySelector(".empty-state--surface");
    expect(emptyState).not.toBeNull();
    expect(emptyState?.textContent).toContain(
      "No OpenAI accounts have been connected in Alisio yet.",
    );
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

    expect(section?.textContent).toContain("Current runtime");
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

  it("shows unsupported heavy models as blocked installs with the hardware reason", () => {
    const props = createProps({
      selectedProviderId: "local",
      models: {
        ...createModelsState(),
        catalog: [
          ...createModelsState().catalog,
          {
            id: "qwen3-32b-q4-k-m",
            slug: "qwen3-32b-q4-k-m",
            family: "Qwen",
            name: "Qwen3 32B",
            parametersBillions: 32,
            quantization: "Q4_K_M",
            backend: "llama.cpp",
            summary: "Large local model.",
            diskGb: 19.8,
            memoryGb: 32,
            vramGb: 20,
            releaseStage: "published",
          },
        ],
        targets: [
          {
            ...createModelsState().targets[0],
            recommendations: [
              createRecommendation({
                modelId: "qwen3-32b-q4-k-m",
                grade: "unsupported",
                reasonCode: "insufficient",
                requiredRamGb: 32,
                requiredVramGb: 20,
                availableRamGb: 36,
                availableVramGb: 18,
                label: "Not recommended",
                reason: "Needs about ~32 GB RAM / ~20 GB VRAM.",
              }),
            ],
          },
          ...createModelsState().targets.slice(1),
        ],
      },
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const renderedModelRows = Array.from(
      container.querySelectorAll<HTMLElement>(".alisio-models__model-row"),
    ).map((row) => row.textContent ?? "");
    expect(renderedModelRows.some((text) => text.includes("Qwen3 32B"))).toBe(false);
    expect(container.textContent).toContain(
      "Qwen3 32B needs more RAM or VRAM than the current runtime has.",
    );
    const blockedInstallButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Install" && button.disabled);
    expect(blockedInstallButton).toBeFalsy();
  });

  it("keeps update progress copy in sync with the update action", () => {
    const props = createProps({
      selectedProviderId: "local",
      modelOperations: {
        "current::qwen3-4b-q4-k-m": {
          targetId: "current",
          modelId: "qwen3-4b-q4-k-m",
          action: "install",
          intent: "update",
          phase: "running",
          percent: 42,
          updatedAt: Date.now(),
        },
      },
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("Updating 42%");
    expect(container.textContent).not.toContain("Installing 42%");
  });

  it("renders loading, empty and error states for the local surface", () => {
    const loadingProps = createProps({
      selectedProviderId: "local",
      modelsLoading: true,
      models: null,
    });
    const loadingContainer = document.createElement("div");
    render(renderModelsHub(loadingProps), loadingContainer);
    expect(loadingContainer.querySelectorAll(".alisio-models__target--skeleton").length).toBe(2);

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
      "The current runtime has not reported any local model state yet.",
    );

    const errorProps = createProps({
      selectedProviderId: "local",
      modelsError: "Local fetch failed",
    });
    const errorContainer = document.createElement("div");
    render(renderModelsHub(errorProps), errorContainer);
    expect(errorContainer.textContent).toContain("Local fetch failed");
  });

  it("shows per-card loading and keeps ready provider summaries visible", () => {
    const props = createProps({
      modelsLoading: true,
      models: null,
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const providerCards = Array.from(
      container.querySelectorAll<HTMLElement>(".alisio-models__provider-card"),
    );
    expect(providerCards).toHaveLength(2);
    expect(providerCards[0]?.textContent).toContain("alice@example.com");
    expect(providerCards[0]?.classList.contains("is-loading")).toBe(false);
    expect(providerCards[1]?.classList.contains("is-loading")).toBe(true);
  });

  it("shows a reload indicator without dropping rendered local content", () => {
    const props = createProps({
      selectedProviderId: "local",
      modelsLoading: true,
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("Qwen3 4B");
    expect(container.querySelector(".alisio-models__refresh-indicator")).not.toBeNull();
  });

  it("falls back to a valid surface when a stale nodes selection is provided", () => {
    const props = createProps({
      selectedProviderId: "nodes" as unknown as Parameters<
        typeof renderModelsHub
      >[0]["selectedProviderId"],
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("OpenAI");
    expect(container.textContent).not.toContain("Alisio nodes");
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

  it("shows a subtle sort dropdown and emits profile sort changes", () => {
    const props = createProps({
      bootstrap: {
        ...createBootstrap(),
        ai: {
          ...createBootstrap().ai,
          profiles: [
            createBootstrap().ai.profiles![0],
            {
              ...createBootstrap().ai.profiles![0],
              profileId: "profile-2",
              email: "zeta@example.com",
              identity: { email: "zeta@example.com" },
            },
          ],
        },
      } as AlisioBootstrapState,
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const select = container.querySelector<HTMLSelectElement>(".alisio-settings-ai__sort-select");
    expect(select).not.toBeNull();
    expect(select?.value).toBe("email-asc");

    if (!select) {
      throw new Error("expected sort select");
    }
    select.value = "weekly-reset-desc";
    select.dispatchEvent(new Event("change"));

    expect(props.onProfileSortChange).toHaveBeenCalledWith("weekly-reset-desc");
  });

  it("starts with the active OpenAI account collapsed while keeping the active glow", () => {
    const props = createProps({
      expandedProfileId: undefined,
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const activeProfile = container.querySelector<HTMLElement>(
      ".alisio-settings-ai__profile.is-active",
    );
    expect(activeProfile).not.toBeNull();
    expect(activeProfile?.classList.contains("is-expanded")).toBe(false);
  });

  it("sorts OpenAI accounts by recent usage with the active profile first", () => {
    const props = createProps({
      expandedProfileId: null,
      profileSort: "recent",
      profileRecentIds: ["profile-3", "profile-1"],
      bootstrap: {
        ...createBootstrap(),
        ai: {
          ...createBootstrap().ai,
          activeProfileId: "profile-2",
          binding: {
            ...createBootstrap().ai.binding!,
            authProfileId: "auth-2",
          },
          profiles: [
            {
              ...createBootstrap().ai.profiles![0],
              profileId: "profile-1",
              email: "zeta@example.com",
              identity: { email: "zeta@example.com" },
            },
            {
              ...createBootstrap().ai.profiles![0],
              profileId: "profile-2",
              email: "beta@example.com",
              identity: { email: "beta@example.com" },
            },
            {
              ...createBootstrap().ai.profiles![0],
              profileId: "profile-3",
              email: "alpha@example.com",
              identity: { email: "alpha@example.com" },
            },
          ],
        },
      } as AlisioBootstrapState,
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const profileOrder = Array.from(
      container.querySelectorAll<HTMLElement>(".alisio-settings-ai__profile-title"),
    ).map((element) => element.textContent?.trim() ?? "");

    expect(profileOrder).toEqual(["beta@example.com", "alpha@example.com", "zeta@example.com"]);
  });

  it("sorts OpenAI accounts by weekly reset with the soonest reset first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T20:00:00.000Z"));
    try {
      const props = createProps({
        expandedProfileId: null,
        profileSort: "weekly-reset-asc",
        bootstrap: {
          ...createBootstrap(),
          ai: {
            ...createBootstrap().ai,
            profiles: [
              {
                ...createBootstrap().ai.profiles![0],
                profileId: "profile-1",
                email: "zeta@example.com",
                identity: { email: "zeta@example.com" },
                aggregatedTelemetry: {
                  secondaryWindow: {
                    label: "Week",
                    remainingPercent: 40,
                    resetAt: new Date("2026-04-20T20:00:00.000Z").getTime(),
                  },
                },
              },
              {
                ...createBootstrap().ai.profiles![0],
                profileId: "profile-2",
                email: "beta@example.com",
                identity: { email: "beta@example.com" },
                aggregatedTelemetry: {
                  secondaryWindow: {
                    label: "Week",
                    remainingPercent: 70,
                    resetAt: new Date("2026-04-16T20:00:00.000Z").getTime(),
                  },
                },
              },
              {
                ...createBootstrap().ai.profiles![0],
                profileId: "profile-3",
                email: "alpha@example.com",
                identity: { email: "alpha@example.com" },
                aggregatedTelemetry: {
                  secondaryWindow: {
                    label: "Week",
                    remainingPercent: 55,
                    resetAt: new Date("2026-04-18T20:00:00.000Z").getTime(),
                  },
                },
              },
            ],
          },
        } as AlisioBootstrapState,
      });
      const container = document.createElement("div");

      render(renderModelsHub(props), container);

      const profileOrder = Array.from(
        container.querySelectorAll<HTMLElement>(".alisio-settings-ai__profile-title"),
      ).map((element) => element.textContent?.trim() ?? "");

      expect(profileOrder).toEqual(["beta@example.com", "alpha@example.com", "zeta@example.com"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a subtle weekly reset hint on collapsed telemetry pills", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T20:00:00.000Z"));
    try {
      const props = createProps({
        expandedProfileId: null,
        bootstrap: {
          ...createBootstrap(),
          ai: {
            ...createBootstrap().ai,
            profiles: [
              {
                ...createBootstrap().ai.profiles![0],
                aggregatedTelemetry: {
                  primaryWindow: {
                    label: "5h",
                    remainingPercent: 100,
                    resetAt: new Date("2026-04-16T01:00:00.000Z").getTime(),
                  },
                  secondaryWindow: {
                    label: "Week",
                    remainingPercent: 53,
                    resetAt: new Date("2026-04-20T20:00:00.000Z").getTime(),
                  },
                },
              },
            ],
          },
        } as AlisioBootstrapState,
      });
      const container = document.createElement("div");

      render(renderModelsHub(props), container);

      const usagePills = Array.from(
        container.querySelectorAll<HTMLElement>(".alisio-models__usage-pill"),
      ).map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "");
      const pillMains = Array.from(
        container.querySelectorAll<HTMLElement>(".alisio-models__usage-pill-main"),
      ).map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "");
      const weeklyReset = container.querySelector<HTMLElement>(".alisio-models__usage-pill-reset");

      expect(usagePills).toContain("5h · 100% available");
      expect(pillMains).toContain("Week · 53% available");
      expect(weeklyReset?.textContent?.trim()).toBe("5d");
      expect(container.querySelectorAll(".alisio-models__usage-pill-reset")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
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
