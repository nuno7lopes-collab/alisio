import { afterEach, describe, expect, it, vi } from "vitest";

const { chatWithInstalledAlisioLocalModelMock } = vi.hoisted(() => ({
  chatWithInstalledAlisioLocalModelMock: vi.fn(),
}));

vi.mock("../infra/alisio-local-llama-runtime.js", () => {
  return {
    chatWithInstalledAlisioLocalModel: chatWithInstalledAlisioLocalModelMock,
  };
});

import {
  clearAlisioDynamicModelProviders,
  setAlisioDynamicModelProviders,
} from "../infra/alisio-model-providers.js";
import { resolveAlisioProviderStream } from "./alisio-provider-stream.js";

async function collectStreamEvents<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("resolveAlisioProviderStream", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    clearAlisioDynamicModelProviders();
  });

  it("streams the local llama.cpp dynamic provider", async () => {
    setAlisioDynamicModelProviders([
      {
        kind: "managed-local",
        location: "current",
        providerId: "alisio-local-current-llama",
        providerLabel: "This computer",
        targetId: "current::llama.cpp",
        catalogEntries: [
          {
            id: "qwen3-4b-q4-k-m",
            name: "Qwen3 4B",
            provider: "alisio-local-current-llama",
            input: ["text"],
          },
        ],
      },
    ]);
    chatWithInstalledAlisioLocalModelMock.mockResolvedValue({
      text: "Olá mundo",
    });

    const stream = await resolveAlisioProviderStream(
      {
        id: "qwen3-4b-q4-k-m",
        name: "Qwen3 4B",
        provider: "alisio-local-current-llama",
        api: "alisio:alisio-local-current-llama",
        baseUrl: "http://127.0.0.1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32_768,
        maxTokens: 8_192,
      },
      {
        messages: [{ role: "user", content: "Say hello." }],
      } as never,
      {},
    );

    expect(stream).toBeDefined();
    const events = await collectStreamEvents(stream!);

    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "text_end",
      "done",
    ]);
    const doneEvent = events.at(-1) as
      | {
          type: string;
          message?: { content?: Array<{ type: string; text?: string }> };
        }
      | undefined;
    expect(doneEvent?.type).toBe("done");
    expect(doneEvent?.message?.content).toEqual([{ type: "text", text: "Olá mundo" }]);
  });

  it("streams the remote node-llama dynamic provider", async () => {
    const runTask = vi
      .fn()
      .mockImplementation(async ({ onEvent }: { onEvent?: (event: unknown) => void }) => {
        onEvent?.({ kind: "delta", payload: { text: "Olá " } });
        onEvent?.({ kind: "delta", payload: { text: "nó" } });
        return {
          ok: true,
          payload: { text: "Olá nó" },
        };
      });
    setAlisioDynamicModelProviders([
      {
        kind: "linked-node",
        location: "target",
        providerId: "alisio-target-remote-1-llama",
        providerLabel: "Remote 1",
        targetId: "remote-1::llama.cpp",
        runTask,
        catalogEntries: [
          {
            id: "qwen3-8b-q4-k-m",
            name: "Qwen3 8B",
            provider: "alisio-target-remote-1-llama",
            input: ["text"],
          },
        ],
      },
    ]);

    const stream = await resolveAlisioProviderStream(
      {
        id: "qwen3-8b-q4-k-m",
        name: "Qwen3 8B",
        provider: "alisio-target-remote-1-llama",
        api: "alisio:alisio-target-remote-1-llama",
        baseUrl: "http://127.0.0.1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32_768,
        maxTokens: 8_192,
      },
      {
        messages: [{ role: "user", content: "Say hello." }],
      } as never,
      {},
    );

    expect(stream).toBeDefined();
    const events = await collectStreamEvents(stream!);

    expect(runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          model: "qwen3-8b-q4-k-m",
          messages: [{ role: "user", content: "Say hello." }],
        }),
      }),
    );
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      "start",
      "text_start",
      "text_delta",
      "text_delta",
      "text_end",
      "done",
    ]);
    const doneEvent = events.at(-1) as
      | {
          type: string;
          message?: { content?: Array<{ type: string; text?: string }> };
        }
      | undefined;
    expect(doneEvent?.message?.content).toEqual([{ type: "text", text: "Olá nó" }]);
  });
});
