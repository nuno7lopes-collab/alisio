import { afterEach, describe, expect, it, vi } from "vitest";

const { resolveAlisioDynamicProviderSourceMock, chatWithInstalledAlisioLocalModelMock } =
  vi.hoisted(() => ({
    resolveAlisioDynamicProviderSourceMock: vi.fn(),
    chatWithInstalledAlisioLocalModelMock: vi.fn(),
  }));

vi.mock("../infra/alisio-model-providers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/alisio-model-providers.js")>();
  return {
    ...actual,
    resolveAlisioDynamicProviderSource: resolveAlisioDynamicProviderSourceMock,
  };
});

vi.mock("../infra/alisio-local-llama-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/alisio-local-llama-runtime.js")>();
  return {
    ...actual,
    chatWithInstalledAlisioLocalModel: chatWithInstalledAlisioLocalModelMock,
  };
});

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
  });

  it("routes the current OpenAI-compatible dynamic provider through the local runtime", async () => {
    resolveAlisioDynamicProviderSourceMock.mockReturnValue({
      kind: "current-openai",
      providerId: "alisio-local-current",
      providerLabel: "This computer",
      targetId: "current",
      baseUrl: "http://127.0.0.1:1234",
      apiKey: "local-key",
      catalogEntries: [
        {
          id: "gpt-oss-20b",
          name: "gpt-oss-20b",
          provider: "alisio-local-current",
          input: ["text"],
        },
      ],
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "Hello world" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const stream = await resolveAlisioProviderStream(
      {
        id: "gpt-oss-20b",
        name: "gpt-oss-20b",
        provider: "alisio-local-current",
        api: "alisio:alisio-local-current",
        baseUrl: "http://127.0.0.1:1234",
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

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:1234/v1/chat/completions",
      "http://127.0.0.1:1234/chat/completions",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer local-key",
          "content-type": "application/json",
        }),
      }),
    );
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
    expect(doneEvent?.message?.content).toEqual([{ type: "text", text: "Hello world" }]);
  });
});
