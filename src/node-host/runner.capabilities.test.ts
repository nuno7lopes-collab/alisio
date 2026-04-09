import { afterEach, describe, expect, it, vi } from "vitest";

const { inspectLocalModelRuntimesMock, resolveLmStudioCliPathMock } = vi.hoisted(() => ({
  inspectLocalModelRuntimesMock: vi.fn(async (): Promise<Array<{ runtimeKind: string }>> => []),
  resolveLmStudioCliPathMock: vi.fn((): string | null => null),
}));

vi.mock("../infra/alisio-local-model-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/alisio-local-model-runtime.js")>();
  return {
    ...actual,
    inspectLocalModelRuntimes: inspectLocalModelRuntimesMock,
  };
});

vi.mock("../infra/alisio-lmstudio.js", () => ({
  resolveLmStudioCliPath: resolveLmStudioCliPathMock,
}));

import { resolveNodeHostCapabilities } from "./capabilities.js";

describe("resolveNodeHostCapabilities", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("announces separate linked runtimes for Ollama, LM Studio, and generic OpenAI-compatible endpoints", async () => {
    inspectLocalModelRuntimesMock.mockResolvedValueOnce([
      { runtimeKind: "ollama" },
      { runtimeKind: "lmstudio" },
      { runtimeKind: "openai-compatible" },
    ]);
    resolveLmStudioCliPathMock.mockReturnValue("/usr/local/bin/lms");

    const capabilities = await resolveNodeHostCapabilities({ browserProxyEnabled: false });
    const capabilityIds = capabilities.map((capability) => capability.id);

    expect(capabilityIds).toEqual(
      expect.arrayContaining([
        "model.catalog.llamacpp.v1",
        "model.manage.llamacpp.v1",
        "model.chat.llamacpp.v1",
        "model.catalog.ollama.v1",
        "model.manage.ollama.v1",
        "model.chat.ollama.v1",
        "model.catalog.lmstudio.v1",
        "model.chat.lmstudio.v1",
        "model.server.start.lmstudio.v1",
        "model.catalog.openai.v1",
        "model.chat.openai.v1",
      ]),
    );
  });
});
