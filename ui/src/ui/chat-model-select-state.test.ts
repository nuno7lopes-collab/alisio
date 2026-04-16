import { describe, expect, it } from "vitest";
import {
  resolveChatModelOverrideValue,
  resolveChatModelSelectState,
} from "./chat-model-select-state.ts";
import {
  createModelCatalog,
  createSessionsListResult,
  DEEPSEEK_CHAT_MODEL,
  DEFAULT_CHAT_MODEL_CATALOG,
} from "./chat-model.test-helpers.ts";

describe("chat-model-select-state", () => {
  it("prefers the catalog provider when the active session provider is stale", () => {
    const state = {
      sessionKey: "main",
      chatModelOverrides: {},
      chatModelCatalog: createModelCatalog(DEEPSEEK_CHAT_MODEL),
      sessionsResult: createSessionsListResult({
        model: "deepseek-chat",
        modelProvider: "zai",
      }),
    };

    expect(resolveChatModelOverrideValue(state)).toBe("deepseek/deepseek-chat");
  });

  it("falls back to the server-qualified value when catalog lookup fails", () => {
    const state = {
      sessionKey: "main",
      chatModelOverrides: {},
      chatModelCatalog: [],
      sessionsResult: createSessionsListResult({
        model: "gpt-5-mini",
        modelProvider: "openai",
      }),
    };

    expect(resolveChatModelOverrideValue(state)).toBe("openai/gpt-5-mini");
  });

  it("builds picker options without introducing a bare duplicate", () => {
    const state = {
      sessionKey: "main",
      chatModelOverrides: {},
      chatModelCatalog: createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG),
      sessionsResult: createSessionsListResult({
        model: "gpt-5-mini",
        modelProvider: "openai",
      }),
    };

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.currentOverride).toBe("openai/gpt-5-mini");
    expect(resolved.options.map((option) => option.value)).toContain("openai/gpt-5-mini");
    expect(resolved.options.map((option) => option.value)).not.toContain("gpt-5-mini");
  });

  it("does not duplicate the default model inside the concrete option list", () => {
    const state = {
      sessionKey: "main",
      chatModelOverrides: {},
      chatModelCatalog: createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG),
      sessionsResult: createSessionsListResult(),
    };

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.defaultModel).toBe("openai/gpt-5");
    expect(resolved.options.map((option) => option.value)).not.toContain("openai/gpt-5");
    expect(resolved.options.map((option) => option.value)).toContain("openai/gpt-5-mini");
  });

  it("treats a default-backed runtime model as the default picker state when no explicit override exists", () => {
    const state = {
      sessionKey: "main",
      chatModelOverrides: {},
      chatModelCatalog: createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG),
      sessionsResult: createSessionsListResult({
        model: "gpt-5",
        modelProvider: "openai",
        modelOverride: null,
        providerOverride: null,
      }),
    };

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.currentOverride).toBe("");
    expect(resolved.defaultModel).toBe("openai/gpt-5");
  });

  it("hides local managed models from the main chat picker", () => {
    const state = {
      sessionKey: "main",
      chatModelOverrides: {},
      chatModelCatalog: createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG, {
        id: "qwen3-4b-q4-k-m",
        name: "Qwen3 4B",
        provider: "alisio-local-current-llama",
        providerLabel: "This device",
      }),
      sessionsResult: createSessionsListResult(),
    };

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.options.map((option) => option.value)).not.toContain(
      "alisio-local-current-llama/qwen3-4b-q4-k-m",
    );
  });

  it("keeps local managed models in subagent pickers", () => {
    const state = {
      sessionKey: "agent:main:subagent:child",
      chatModelOverrides: {},
      chatModelCatalog: createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG, {
        id: "qwen3-4b-q4-k-m",
        name: "Qwen3 4B",
        provider: "alisio-local-current-llama",
        providerLabel: "This device",
      }),
      sessionsResult: createSessionsListResult(),
    };

    const resolved = resolveChatModelSelectState(state);
    expect(resolved.options.map((option) => option.value)).toContain(
      "alisio-local-current-llama/qwen3-4b-q4-k-m",
    );
  });
});
