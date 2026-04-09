import { afterEach, describe, expect, it, vi } from "vitest";

const { chatWithInstalledAlisioLocalModelMock } = vi.hoisted(() => ({
  chatWithInstalledAlisioLocalModelMock: vi.fn(),
}));

vi.mock("../infra/alisio-local-llama-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/alisio-local-llama-runtime.js")>();
  return {
    ...actual,
    chatWithInstalledAlisioLocalModel: chatWithInstalledAlisioLocalModelMock,
  };
});

import { handleTask } from "./invoke.js";

describe("handleTask", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("emite streaming consistente para chat llama.cpp", async () => {
    chatWithInstalledAlisioLocalModelMock.mockImplementationOnce(
      async ({
        modelId,
        onTextChunk,
      }: {
        modelId: string;
        onTextChunk?: (chunk: string) => void | Promise<void>;
      }) => {
        await onTextChunk?.("Ola");
        await onTextChunk?.(" mundo");
        return {
          modelId,
          text: "Ola mundo",
        };
      },
    );

    const request = vi.fn(async (_method: string, _params: unknown) => ({}));

    await handleTask(
      {
        taskId: "task-1",
        nodeId: "node-1",
        capabilityId: "model.chat.llamacpp.v1",
        timeoutMs: 50,
        inputJSON: JSON.stringify({
          model: "qwen3-8b-instruct-q4",
          messages: [{ role: "user", content: "Say hello." }],
        }),
      },
      { request } as never,
      (() => Promise.resolve([])) as never,
    );

    const requestCalls = request.mock.calls as Array<[string, Record<string, unknown>]>;
    const eventCalls = requestCalls.filter(([method]) => method === "node.task.event");
    expect(eventCalls).toHaveLength(4);
    expect(
      eventCalls.map(([, params]) => ({
        kind: params.kind,
        seq: params.seq,
        payload: typeof params.payloadJSON === "string" ? JSON.parse(params.payloadJSON) : null,
      })),
    ).toEqual([
      { kind: "started", seq: 0, payload: null },
      {
        kind: "delta",
        seq: 1,
        payload: { modelId: "qwen3-8b-instruct-q4", text: "Ola" },
      },
      {
        kind: "delta",
        seq: 2,
        payload: { modelId: "qwen3-8b-instruct-q4", text: " mundo" },
      },
      {
        kind: "completed",
        seq: 3,
        payload: { modelId: "qwen3-8b-instruct-q4", text: "Ola mundo" },
      },
    ]);

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
      modelId: "qwen3-8b-instruct-q4",
      text: "Ola mundo",
    });
  });
});
