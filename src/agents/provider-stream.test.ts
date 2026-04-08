import type { Model } from "@mariozechner/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureCustomApiRegistered = vi.fn();
const resolveProviderStreamFn = vi.fn();
const resolveAlisioProviderStream = vi.fn();

let registerProviderStreamForModel: typeof import("./provider-stream.js").registerProviderStreamForModel;

describe("registerProviderStreamForModel", () => {
  beforeEach(async () => {
    vi.resetModules();
    ensureCustomApiRegistered.mockReset();
    resolveProviderStreamFn.mockReset();
    resolveAlisioProviderStream.mockReset();

    vi.doMock("../plugins/provider-runtime.js", () => ({
      resolveProviderStreamFn,
    }));
    vi.doMock("./custom-api-registry.js", () => ({
      ensureCustomApiRegistered,
    }));
    vi.doMock("./alisio-provider-stream.js", () => ({
      resolveAlisioProviderStream,
    }));

    ({ registerProviderStreamForModel } = await import("./provider-stream.js"));
  });

  it("registers the Alisio dynamic stream for dynamic providers", async () => {
    resolveAlisioProviderStream.mockResolvedValue("alisio-stream");
    const model: Model<string> = {
      id: "gpt-oss-20b",
      name: "gpt-oss-20b",
      api: "alisio:alisio-server-home-lab",
      provider: "alisio-server-home-lab",
      baseUrl: "http://192.168.1.50:1234",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_768,
      maxTokens: 8_192,
    };

    const streamFn = registerProviderStreamForModel({ model });

    expect(streamFn).toBeTypeOf("function");
    expect(ensureCustomApiRegistered).toHaveBeenCalledWith(model.api, streamFn);

    await streamFn?.(model as never, {} as never, {} as never);

    expect(resolveAlisioProviderStream).toHaveBeenCalledWith(model, {}, {});
  });

  it("does not treat the legacy alisio-remote provider as a dynamic stream provider", () => {
    const model: Model<string> = {
      id: "gpt-oss-20b",
      name: "gpt-oss-20b",
      api: "openai-responses",
      provider: "alisio-remote",
      baseUrl: "http://192.168.1.50:1234/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_768,
      maxTokens: 8_192,
    };

    const streamFn = registerProviderStreamForModel({ model });

    expect(streamFn).toBeUndefined();
    expect(ensureCustomApiRegistered).not.toHaveBeenCalled();
    expect(resolveAlisioProviderStream).not.toHaveBeenCalled();
  });
});
