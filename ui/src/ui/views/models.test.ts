/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
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
        vramGb: 8,
        releaseStage: "published",
      },
    ],
    targets: [
      {
        targetId: "current",
        label: "This Mac",
        platform: "darwin",
        current: true,
        connected: true,
        backend: "llama.cpp",
        runtimeKind: "llama.cpp",
        chatProviderId: "alisio-local-current",
        runtimeStatus: "ready",
        supportsInstall: true,
        installedModels: [{ id: "qwen3-4b-q4-k-m", name: "Qwen3 4B", ownedBy: "llama.cpp" }],
        recommendations: [
          {
            modelId: "qwen3-4b-q4-k-m",
            grade: "recommended",
            label: "Recommended",
            reason: "Good fit",
          },
        ],
        bestModelId: "qwen3-4b-q4-k-m",
        bestModelName: "Qwen3 4B",
        hardware: {
          platform: "darwin",
          architecture: "arm64",
          totalMemoryGb: 36,
          cpuCores: 10,
        },
      },
      {
        targetId: "remote-1",
        label: "Studio Mac",
        platform: "darwin",
        current: false,
        connected: true,
        backend: "llama.cpp",
        runtimeKind: "llama.cpp",
        chatProviderId: "alisio-target-remote-1-llama",
        runtimeStatus: "ready",
        supportsInstall: true,
        installedModels: [{ id: "qwen3-8b-q4-k-m", name: "Qwen3 8B", ownedBy: "llama.cpp" }],
        recommendations: [
          {
            modelId: "qwen3-8b-q4-k-m",
            grade: "recommended",
            label: "Recommended",
            reason: "Good fit",
          },
        ],
        bestModelId: "qwen3-8b-q4-k-m",
        bestModelName: "Qwen3 8B",
        hardware: {
          platform: "darwin",
          architecture: "arm64",
          totalMemoryGb: 24,
          cpuCores: 8,
        },
      },
    ],
    servers: [
      {
        serverId: "server-1",
        label: "Home Lab",
        chatProviderId: "alisio-server-server-1",
        kind: "openai-compatible",
        baseUrl: "http://127.0.0.1:8080/v1",
        active: true,
        hasApiKey: false,
        status: "ready",
        models: [{ id: "gpt-oss-20b", name: "gpt-oss-20b", ownedBy: "openai-compatible" }],
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
    chatModelOptions: [
      { value: "openai-codex/gpt-5.4", label: "gpt-5.4 · openai-codex" },
      { value: "openai-codex/gpt-5.3-codex", label: "gpt-5.3-codex · openai-codex" },
      { value: "anthropic/claude-sonnet-4-5", label: "claude-sonnet-4-5 · anthropic" },
      {
        value: "alisio-local-current/qwen3-4b-q4-k-m",
        label: "Qwen3 4B · This Mac",
      },
      {
        value: "alisio-target-remote-1-llama/qwen3-8b-q4-k-m",
        label: "Qwen3 8B · Studio Mac",
      },
      {
        value: "alisio-server-server-1/gpt-oss-20b",
        label: "gpt-oss-20b · Home Lab",
      },
    ],
    currentChatModelOverrideValue: "",
    defaultChatModelValue: "openai-codex/gpt-5.4",
    defaultChatModelDisplay: "gpt-5.4 · openai-codex",
    defaultChatModelLabel: "Default (gpt-5.4 · openai-codex)",
    effectiveChatModelValue: "openai-codex/gpt-5.4",
    effectiveChatModelLabel: "gpt-5.4 · openai-codex",
    modelPickerBusy: false,
    serverDraft: null,
    onToggleProfile: vi.fn(),
    onSelectProvider: vi.fn(),
    onConnectAi: vi.fn(),
    onRefreshAllAiProfiles: vi.fn(),
    onSelectDefaultChatModel: vi.fn(),
    onSelectChatModel: vi.fn(),
    onSelectAiProfile: vi.fn(),
    onDisconnectAiProfile: vi.fn(),
    onRefreshAiProfile: vi.fn(),
    onRenameAiProfile: vi.fn(),
    onInstallModel: vi.fn(),
    onUninstallModel: vi.fn(),
    onStartCreateServer: vi.fn(),
    onStartEditServer: vi.fn(),
    onChangeServerDraft: vi.fn(),
    onCancelServerDraft: vi.fn(),
    onSubmitServerDraft: vi.fn(),
    onRemoveServer: vi.fn(),
    onSelectServer: vi.fn(),
    ...overrides,
  } satisfies Parameters<typeof renderModelsHub>[0];
}

describe("renderModelsHub", () => {
  it("renders provider cards and wires OpenAI default and session model selection", () => {
    const props = createProps();
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("OpenAI");
    expect(container.textContent).toContain("Server");
    expect(container.textContent).toContain("Local");

    const localCard = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Local"),
    );
    localCard?.click();
    expect(props.onSelectProvider).toHaveBeenCalledWith("local");

    const allModelButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".alisio-models__model-chip"),
    ).filter((button) => button.textContent?.includes("gpt-5.3-codex"));
    allModelButtons[0]?.click();
    expect(props.onSelectDefaultChatModel).toHaveBeenCalledWith("openai-codex/gpt-5.3-codex");

    allModelButtons[1]?.click();
    expect(props.onSelectChatModel).toHaveBeenCalledWith("openai-codex/gpt-5.3-codex");
  });

  it("hides the rename action for personal OpenAI profiles", () => {
    const props = createProps();
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).not.toContain("Rename");
  });

  it("keeps the rename action visible for team OpenAI profiles", () => {
    const props = createProps({
      bootstrap: {
        ...createBootstrap(),
        ai: {
          ...createBootstrap().ai,
          profiles: [
            {
              profileId: "profile-1",
              label: "Workspace Alpha",
              provider: "openai",
              scope: "organization",
              ownerKey: "organization:1",
              canonicalIdentityKey: "organization:1",
              identity: {
                email: "workspace@example.com",
              },
              status: "connected",
              email: "workspace@example.com",
              connectedAt: "2026-04-04T12:00:00.000Z",
              planLabel: "Team",
            },
          ],
        },
      } as AlisioBootstrapState,
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("Rename");
  });

  it("renders only the selected local provider surface", () => {
    const props = createProps({ selectedProviderId: "local" });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const targetTitles = Array.from(
      container.querySelectorAll<HTMLElement>(".alisio-models__target .list-title"),
    ).map((element) => element.textContent?.trim() ?? "");

    expect(container.textContent).toContain("This Mac");
    expect(container.textContent).toContain("macOS");
    expect(container.textContent).toContain("Qwen3 8B");
    expect(container.textContent).toContain("Install");
    expect(container.textContent).toContain("Uninstall");
    expect(container.textContent).not.toContain("alice@example.com");
    expect(targetTitles).toContain("This Mac");
    expect(targetTitles).not.toContain("Studio Mac");

    const localChip = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".alisio-models__model-chip"),
    ).find((button) => button.textContent?.includes("Qwen3 4B"));
    localChip?.click();

    expect(props.onSelectChatModel).toHaveBeenCalledWith("alisio-local-current/qwen3-4b-q4-k-m");
  });

  it("shows install progress and wires uninstall for local models", () => {
    const props = createProps({
      selectedProviderId: "local",
      modelOperations: {
        "current::qwen3-8b-q4-k-m": {
          targetId: "current",
          modelId: "qwen3-8b-q4-k-m",
          action: "install",
          phase: "running",
          percent: 42,
          downloadedSize: 2_100_000_000,
          totalSize: 5_100_000_000,
          updatedAt: Date.now(),
        },
      },
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("Installing");
    expect(container.textContent).toContain("42%");

    const uninstallButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Uninstall"));
    uninstallButton?.click();
    expect(props.onUninstallModel).toHaveBeenCalledWith("current", "qwen3-4b-q4-k-m");
  });

  it("renders linked computers and remote endpoints in the server surface", () => {
    const props = createProps({ selectedProviderId: "server" });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("Studio Mac");
    expect(container.textContent).toContain("Home Lab");
    expect(container.textContent).toContain("gpt-oss-20b");
  });

  it("permite escolher um modelo do endpoint activo na superfície de servidor", () => {
    const props = createProps({
      selectedProviderId: "server",
      currentChatModelOverrideValue: "alisio-server-server-1/gpt-oss-20b",
      effectiveChatModelValue: "alisio-server-server-1/gpt-oss-20b",
      effectiveChatModelLabel: "gpt-oss-20b · Home Lab",
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const remoteChip = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".alisio-models__model-chip"),
    ).find((button) => button.textContent?.includes("gpt-oss-20b"));
    remoteChip?.click();

    expect(props.onSelectChatModel).toHaveBeenCalledWith("alisio-server-server-1/gpt-oss-20b");
    expect(container.textContent).toContain("Choose model");
  });

  it("uses a generic empty-state copy for linked OpenAI-compatible targets", () => {
    const baseModels = createModelsState();
    const props = createProps({
      selectedProviderId: "server",
      models: {
        ...baseModels,
        targets: [
          baseModels.targets[0],
          {
            targetId: "remote-openai",
            label: "Edge Box",
            platform: "linux",
            current: false,
            connected: true,
            backend: "llama.cpp",
            runtimeKind: "openai-compatible",
            runtimeStatus: "ready",
            supportsInstall: false,
            installedModels: [],
            recommendations: [],
          },
        ],
        servers: [],
      },
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("No models are available here yet.");
    expect(container.textContent).not.toContain(
      "There are no installed models on this computer yet.",
    );
  });

  it("renders the inline server form and wires edits", () => {
    const props = createProps({
      selectedProviderId: "server",
      serverDraft: {
        mode: "create",
        label: "",
        kind: "openai-compatible",
        baseUrl: "",
        apiKey: "",
      },
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    const inputs = container.querySelectorAll<HTMLInputElement>("input");
    const nameInput = inputs[0];
    nameInput.value = "Edge Box";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    expect(props.onChangeServerDraft).toHaveBeenCalledWith("label", "Edge Box");

    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Save"),
    );
    expect(saveButton).toBeDefined();
    expect(saveButton?.disabled).toBe(true);
  });

  it("keeps the endpoints group visible even when only linked computers exist", () => {
    const props = createProps({
      selectedProviderId: "server",
      models: {
        ...createModelsState(),
        servers: [],
      },
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("Linked computers");
    expect(container.textContent).toContain("Endpoints");
    expect(container.textContent).toContain("Studio Mac");
    expect(container.textContent).toContain(
      "You have not added any remote endpoints yet. You can also use a linked computer shown above.",
    );
  });

  it("shows local loading skeletons before the models catalog arrives", () => {
    const props = createProps({
      selectedProviderId: "local",
      modelsLoading: true,
      models: null,
    });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.querySelectorAll(".loading-state__list-item").length).toBeGreaterThan(1);
    expect(container.textContent).not.toContain("No local models");
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
});
