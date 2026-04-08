import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTask } from "./invoke.js";

describe("handleTask", () => {
  const originalBaseUrl = process.env.OPENCLAW_NODE_MODEL_BASE_URL;
  const originalApiKey = process.env.OPENCLAW_NODE_MODEL_API_KEY;

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    if (originalBaseUrl === undefined) {
      delete process.env.OPENCLAW_NODE_MODEL_BASE_URL;
    } else {
      process.env.OPENCLAW_NODE_MODEL_BASE_URL = originalBaseUrl;
    }
    if (originalApiKey === undefined) {
      delete process.env.OPENCLAW_NODE_MODEL_API_KEY;
    } else {
      process.env.OPENCLAW_NODE_MODEL_API_KEY = originalApiKey;
    }
  });

  it("falls back to the bare chat completions path for OpenAI-compatible node tasks", async () => {
    process.env.OPENCLAW_NODE_MODEL_BASE_URL = "http://127.0.0.1:1234";
    delete process.env.OPENCLAW_NODE_MODEL_API_KEY;

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "Hello from node host" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const request = vi.fn(async (_method: string, _params: unknown) => ({}));

    await handleTask(
      {
        taskId: "task-1",
        nodeId: "node-1",
        capabilityId: "model.chat.openai.v1",
        timeoutMs: 50,
        inputJSON: JSON.stringify({
          model: "gpt-oss-20b",
          messages: [{ role: "user", content: "Say hello." }],
        }),
      },
      { request } as never,
      (() => Promise.resolve([])) as never,
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:1234/v1/chat/completions",
      "http://127.0.0.1:1234/chat/completions",
    ]);

    const requestCalls = request.mock.calls as Array<[string, Record<string, unknown>]>;
    const resultCall = requestCalls.find(([method]) => method === "node.task.result");
    const resultParams = resultCall?.[1] as
      | {
          taskId?: string;
          nodeId?: string;
          ok?: boolean;
          payloadJSON?: string;
        }
      | undefined;

    expect(resultParams).toBeDefined();
    expect(resultParams).toMatchObject({
      taskId: "task-1",
      nodeId: "node-1",
      ok: true,
    });
    expect(JSON.parse(String(resultParams?.payloadJSON))).toEqual({
      text: "Hello from node host",
    });
  });
});
