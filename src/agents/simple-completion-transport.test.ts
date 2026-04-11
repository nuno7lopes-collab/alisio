import type { Model } from "@mariozechner/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlisioConfig } from "../config/config.js";

const createAnthropicVertexStreamFnForModel = vi.fn();
const ensureCustomApiRegistered = vi.fn();
const resolveProviderStreamFn = vi.fn();

let prepareModelForSimpleCompletion: typeof import("./simple-completion-transport.js").prepareModelForSimpleCompletion;

describe("prepareModelForSimpleCompletion", () => {
  beforeEach(async () => {
    vi.resetModules();
    createAnthropicVertexStreamFnForModel.mockReset();
    ensureCustomApiRegistered.mockReset();
    resolveProviderStreamFn.mockReset();
    createAnthropicVertexStreamFnForModel.mockReturnValue("vertex-stream");
    resolveProviderStreamFn.mockReturnValue("provider-stream");

    vi.doMock("./anthropic-vertex-stream.js", () => ({
      createAnthropicVertexStreamFnForModel,
    }));
    vi.doMock("./custom-api-registry.js", () => ({
      ensureCustomApiRegistered,
    }));
    vi.doMock("../plugins/provider-runtime.js", () => ({
      resolveProviderStreamFn,
    }));

    ({ prepareModelForSimpleCompletion } = await import("./simple-completion-transport.js"));
  });

  it("registers the configured custom transport and keeps the original api", () => {
    const model: Model<"custom-local"> = {
      id: "llama3",
      name: "Llama 3",
      api: "custom-local",
      provider: "localproxy",
      baseUrl: "http://localhost:11434",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 4096,
      headers: {},
    };
    const cfg: AlisioConfig = {
      models: {
        providers: {
          localproxy: {
            baseUrl: "http://remote-localproxy:11434",
            models: [],
          },
        },
      },
    };

    const result = prepareModelForSimpleCompletion({
      model,
      cfg,
    });

    expect(resolveProviderStreamFn).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "localproxy",
        config: cfg,
        context: expect.objectContaining({
          provider: "localproxy",
          modelId: "llama3",
          model,
        }),
      }),
    );
    expect(ensureCustomApiRegistered).toHaveBeenCalledWith("custom-local", "provider-stream");
    expect(result).toBe(model);
  });

  it("uses a custom api alias for Anthropic Vertex simple completions", () => {
    const model: Model<"anthropic-messages"> = {
      id: "claude-sonnet",
      name: "Claude Sonnet",
      api: "anthropic-messages",
      provider: "anthropic-vertex",
      baseUrl: "https://us-central1-aiplatform.googleapis.com",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 8192,
    };

    resolveProviderStreamFn.mockReturnValueOnce(undefined);

    const result = prepareModelForSimpleCompletion({ model });

    expect(createAnthropicVertexStreamFnForModel).toHaveBeenCalledWith(model);
    expect(ensureCustomApiRegistered).toHaveBeenCalledWith(
      "alisio-anthropic-vertex-simple:https%3A%2F%2Fus-central1-aiplatform.googleapis.com",
      "vertex-stream",
    );
    expect(result).toEqual({
      ...model,
      api: "alisio-anthropic-vertex-simple:https%3A%2F%2Fus-central1-aiplatform.googleapis.com",
    });
  });
});
