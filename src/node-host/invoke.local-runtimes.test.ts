import { afterEach, describe, expect, it, vi } from "vitest";

const {
  inspectManagedLocalModelRuntimeMock,
  installAlisioLocalModelMock,
  uninstallAlisioLocalModelMock,
} = vi.hoisted(() => ({
  inspectManagedLocalModelRuntimeMock: vi.fn(
    async (): Promise<Record<string, unknown>> => ({
      runtimeKind: "llama.cpp",
      runtimeLabel: "Local GGUF",
      status: "ready",
      models: [{ id: "qwen3-8b-instruct-q4", name: "Qwen3 8B Instruct", ownedBy: "llama.cpp" }],
      availableModels: [],
      capabilities: {
        install: true,
        update: true,
        uninstall: true,
        consentRequired: true,
        startServer: false,
      },
      supportsInstall: true,
      supportsUpdate: true,
      supportsUninstall: true,
      consentRequired: true,
    }),
  ),
  installAlisioLocalModelMock: vi.fn(async ({ modelId }: { modelId: string }) => ({
    id: modelId,
    name: modelId,
    ownedBy: "llama.cpp",
  })),
  uninstallAlisioLocalModelMock: vi.fn(async ({ modelId }: { modelId: string }) => ({
    id: modelId,
    name: modelId,
    ownedBy: "llama.cpp",
  })),
}));

vi.mock("../infra/alisio-local-llama-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/alisio-local-llama-runtime.js")>();
  return {
    ...actual,
    inspectManagedLocalModelRuntime: inspectManagedLocalModelRuntimeMock,
    installAlisioLocalModel: installAlisioLocalModelMock,
    uninstallAlisioLocalModel: uninstallAlisioLocalModelMock,
  };
});

import { handleTask } from "./invoke.js";

describe("handleTask llama.cpp", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("devolve o catálogo llama.cpp do nó", async () => {
    const request = vi.fn(async () => ({}));

    await handleTask(
      {
        taskId: "task-catalog",
        nodeId: "node-1",
        capabilityId: "model.catalog.llamacpp.v1",
        inputJSON: "{}",
      },
      { request } as never,
      (() => Promise.resolve([])) as never,
    );

    const requestCalls = request.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    const resultCall = requestCalls.find(([method]) => method === "node.task.result");
    const resultParams = resultCall?.[1] as { payloadJSON?: string } | undefined;
    expect(JSON.parse(String(resultParams?.payloadJSON))).toMatchObject({
      runtimeKind: "llama.cpp",
      supportsInstall: true,
    });
  });

  it("executa instalações llama.cpp através da capability dedicada", async () => {
    const request = vi.fn(async () => ({}));

    await handleTask(
      {
        taskId: "task-install",
        nodeId: "node-1",
        capabilityId: "model.manage.llamacpp.v1",
        inputJSON: JSON.stringify({ action: "install", modelId: "qwen3-8b-instruct-q4" }),
      },
      { request } as never,
      (() => Promise.resolve([])) as never,
    );

    expect(installAlisioLocalModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "qwen3-8b-instruct-q4" }),
    );
  });

  it("executa desinstalações llama.cpp através da capability dedicada", async () => {
    const request = vi.fn(async () => ({}));

    await handleTask(
      {
        taskId: "task-uninstall",
        nodeId: "node-1",
        capabilityId: "model.manage.llamacpp.v1",
        inputJSON: JSON.stringify({ action: "uninstall", modelId: "qwen3-8b-instruct-q4" }),
      },
      { request } as never,
      (() => Promise.resolve([])) as never,
    );

    expect(uninstallAlisioLocalModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "qwen3-8b-instruct-q4" }),
    );
  });
});
