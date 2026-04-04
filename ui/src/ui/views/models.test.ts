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
        runtimeStatus: "ready",
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
    ],
    servers: [
      {
        serverId: "server-1",
        label: "Home Lab",
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
    aiLoading: false,
    aiError: null,
    expandedProfileId: "profile-1",
    selectedProviderId: "openai" as const,
    chatModelOptions: [
      { value: "openai-codex/gpt-5.4", label: "gpt-5.4 · openai-codex" },
      { value: "openai-codex/gpt-5.3-codex", label: "gpt-5.3-codex · openai-codex" },
      { value: "anthropic/claude-sonnet-4-5", label: "claude-sonnet-4-5 · anthropic" },
    ],
    currentChatModelOverrideValue: "",
    defaultChatModelValue: "openai-codex/gpt-5.4",
    defaultChatModelLabel: "Default (gpt-5.4 · openai-codex)",
    effectiveChatModelValue: "openai-codex/gpt-5.4",
    effectiveChatModelLabel: "gpt-5.4 · openai-codex",
    modelPickerBusy: false,
    serverDraft: null,
    onToggleProfile: vi.fn(),
    onSelectProvider: vi.fn(),
    onConnectAi: vi.fn(),
    onRefreshAllAiProfiles: vi.fn(),
    onSelectChatModel: vi.fn(),
    onSelectAiProfile: vi.fn(),
    onDisconnectAiProfile: vi.fn(),
    onRefreshAiProfile: vi.fn(),
    onRenameAiProfile: vi.fn(),
    onInstallModel: vi.fn(),
    onStartCreateServer: vi.fn(),
    onStartEditServer: vi.fn(),
    onChangeServerDraft: vi.fn(),
    onCancelServerDraft: vi.fn(),
    onSubmitServerDraft: vi.fn(),
    onSaveServer: vi.fn(),
    onRemoveServer: vi.fn(),
    onSelectServer: vi.fn(),
    ...overrides,
  } satisfies Parameters<typeof renderModelsHub>[0];
}

describe("renderModelsHub", () => {
  it("renders provider cards and wires OpenAI model selection", () => {
    const props = createProps();
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("OpenAI Codex");
    expect(container.textContent).toContain("OpenAI Alt");
    expect(container.textContent).toContain("Local");

    const localCard = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Local"),
    );
    localCard?.click();
    expect(props.onSelectProvider).toHaveBeenCalledWith("local");

    const switchModelButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".alisio-models__model-chip"),
    ).find((button) => button.textContent?.includes("gpt-5.3-codex"));
    switchModelButton?.click();
    expect(props.onSelectChatModel).toHaveBeenCalledWith("openai-codex/gpt-5.3-codex");
  });

  it("renders only the selected local provider surface", () => {
    const props = createProps({ selectedProviderId: "local" });
    const container = document.createElement("div");

    render(renderModelsHub(props), container);

    expect(container.textContent).toContain("Qwen3 8B");
    expect(container.textContent).toContain("Install");
    expect(container.textContent).not.toContain("alice@example.com");
  });

  it("renders the inline OpenAI Alt form and wires edits", () => {
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
});
