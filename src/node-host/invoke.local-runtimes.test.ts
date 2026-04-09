import { afterEach, describe, expect, it, vi } from "vitest";

const {
  inspectLocalModelRuntimesMock,
  installOllamaLocalModelMock,
  uninstallOllamaLocalModelMock,
  resolveCurrentRuntimeBaseUrlForKindMock,
  startLmStudioLocalServerMock,
} = vi.hoisted(() => ({
  inspectLocalModelRuntimesMock: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
  installOllamaLocalModelMock: vi.fn(async ({ modelId }: { modelId: string }) => ({
    id: modelId,
    name: modelId,
    ownedBy: "ollama",
  })),
  uninstallOllamaLocalModelMock: vi.fn(async ({ modelId }: { modelId: string }) => ({
    id: modelId,
    name: modelId,
    ownedBy: "ollama",
  })),
  resolveCurrentRuntimeBaseUrlForKindMock: vi.fn(
    ({ runtimeKind }: { runtimeKind: "ollama" | "lmstudio" | "openai-compatible" }) =>
      runtimeKind === "ollama"
        ? "http://127.0.0.1:11434"
        : runtimeKind === "lmstudio"
          ? "http://127.0.0.1:1234"
          : "http://127.0.0.1:8080",
  ),
  startLmStudioLocalServerMock: vi.fn(async () => ({
    baseUrl: "http://127.0.0.1:1234",
    port: 1234,
    alreadyRunning: false,
  })),
}));

vi.mock("../infra/alisio-local-model-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/alisio-local-model-runtime.js")>();
  return {
    ...actual,
    inspectLocalModelRuntimes: inspectLocalModelRuntimesMock,
    installOllamaLocalModel: installOllamaLocalModelMock,
    uninstallOllamaLocalModel: uninstallOllamaLocalModelMock,
    resolveCurrentRuntimeBaseUrlForKind: resolveCurrentRuntimeBaseUrlForKindMock,
  };
});

vi.mock("../infra/alisio-lmstudio.js", () => ({
  startLmStudioLocalServer: startLmStudioLocalServerMock,
}));

import { handleTask } from "./invoke.js";

describe("handleTask runtimes remotos", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("devolve o catálogo do Ollama como runtime separado", async () => {
    inspectLocalModelRuntimesMock.mockResolvedValueOnce([
      {
        runtimeKind: "ollama",
        runtimeLabel: "Ollama",
        status: "ready",
        models: [{ id: "qwen3:8b", name: "qwen3:8b", ownedBy: "ollama" }],
        availableModels: [{ id: "qwen3:4b", name: "Qwen3 4B", runtimeKind: "ollama" }],
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
      },
    ]);
    const request = vi.fn(async () => ({}));

    await handleTask(
      {
        taskId: "task-ollama-catalog",
        nodeId: "node-1",
        capabilityId: "model.catalog.ollama.v1",
        inputJSON: "{}",
      },
      { request } as never,
      (() => Promise.resolve([])) as never,
    );

    const requestCalls = request.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    const resultCall = requestCalls.find(([method]) => method === "node.task.result");
    const resultParams = resultCall?.[1] as { payloadJSON?: string } | undefined;
    expect(JSON.parse(String(resultParams?.payloadJSON))).toMatchObject({
      runtimeKind: "ollama",
      supportsInstall: true,
    });
  });

  it("executa instalações do Ollama através da capability dedicada", async () => {
    const request = vi.fn(async () => ({}));

    await handleTask(
      {
        taskId: "task-ollama-install",
        nodeId: "node-1",
        capabilityId: "model.manage.ollama.v1",
        inputJSON: JSON.stringify({ action: "install", modelId: "qwen3:8b" }),
      },
      { request } as never,
      (() => Promise.resolve([])) as never,
    );

    expect(installOllamaLocalModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "qwen3:8b" }),
    );
  });

  it("arranca o servidor do LM Studio através da capability dedicada", async () => {
    const request = vi.fn(async () => ({}));

    await handleTask(
      {
        taskId: "task-lmstudio-start",
        nodeId: "node-1",
        capabilityId: "model.server.start.lmstudio.v1",
        inputJSON: "{}",
      },
      { request } as never,
      (() => Promise.resolve([])) as never,
    );

    expect(startLmStudioLocalServerMock).toHaveBeenCalled();
    const requestCalls = request.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    const resultCall = requestCalls.find(([method]) => method === "node.task.result");
    const resultParams = resultCall?.[1] as { payloadJSON?: string } | undefined;
    expect(JSON.parse(String(resultParams?.payloadJSON))).toMatchObject({
      runtimeKind: "lmstudio",
      baseUrl: "http://127.0.0.1:1234",
      alreadyRunning: false,
    });
  });
});
