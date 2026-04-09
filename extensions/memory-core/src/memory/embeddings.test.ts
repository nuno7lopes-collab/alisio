import { beforeEach, describe, expect, it, vi } from "vitest";

const getMemoryEmbeddingProvider = vi.hoisted(() => vi.fn());
const listMemoryEmbeddingProviders = vi.hoisted(() => vi.fn());
const canAutoSelectLocal = vi.hoisted(() => vi.fn());
const getBuiltinMemoryEmbeddingProviderAdapter = vi.hoisted(() => vi.fn());

vi.mock("alisio/plugin-sdk/memory-core-host-engine-embeddings", () => ({
  DEFAULT_GEMINI_EMBEDDING_MODEL: "gemini-default",
  DEFAULT_LOCAL_MODEL: "local-default",
  DEFAULT_MISTRAL_EMBEDDING_MODEL: "mistral-default",
  DEFAULT_OLLAMA_EMBEDDING_MODEL: "ollama-default",
  DEFAULT_OPENAI_EMBEDDING_MODEL: "openai-default",
  DEFAULT_VOYAGE_EMBEDDING_MODEL: "voyage-default",
  getMemoryEmbeddingProvider,
  listMemoryEmbeddingProviders,
}));

vi.mock("./provider-adapters.js", () => ({
  canAutoSelectLocal,
  getBuiltinMemoryEmbeddingProviderAdapter,
}));

describe("createEmbeddingProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    getMemoryEmbeddingProvider.mockReset();
    listMemoryEmbeddingProviders.mockReset();
    canAutoSelectLocal.mockReset();
    getBuiltinMemoryEmbeddingProviderAdapter.mockReset();
    canAutoSelectLocal.mockReturnValue(false);
  });

  it("summarizes auto mode auth misses instead of returning one message per provider", async () => {
    listMemoryEmbeddingProviders.mockReturnValue([
      {
        id: "openai",
        autoSelectPriority: 20,
        create: vi.fn(async () => {
          throw new Error('No API key found for provider "openai".');
        }),
        shouldContinueAutoSelection: () => true,
      },
      {
        id: "voyage",
        autoSelectPriority: 30,
        create: vi.fn(async () => {
          throw new Error('No API key found for provider "voyage".');
        }),
        shouldContinueAutoSelection: () => true,
      },
    ]);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const result = await createEmbeddingProvider({
      config: {} as never,
      provider: "auto",
      fallback: "none",
      model: "",
    });

    expect(result).toMatchObject({
      provider: null,
      requestedProvider: "auto",
      providerUnavailableReason: "No embeddings provider available.",
    });
  });

  it("keeps the local setup error when local auto-selection was attempted first", async () => {
    canAutoSelectLocal.mockReturnValue(true);
    listMemoryEmbeddingProviders.mockReturnValue([
      {
        id: "local",
        autoSelectPriority: 10,
        create: vi.fn(async () => {
          throw new Error("Local embeddings unavailable.\nReason: node-llama-cpp missing.");
        }),
        shouldContinueAutoSelection: () => true,
      },
      {
        id: "openai",
        autoSelectPriority: 20,
        create: vi.fn(async () => {
          throw new Error('No API key found for provider "openai".');
        }),
        shouldContinueAutoSelection: () => true,
      },
    ]);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const result = await createEmbeddingProvider({
      config: {} as never,
      provider: "auto",
      fallback: "none",
      model: "",
      local: {
        modelPath: "/tmp/local.gguf",
      },
    });

    expect(result).toMatchObject({
      provider: null,
      requestedProvider: "auto",
    });
    expect(result.providerUnavailableReason).toContain("Local embeddings unavailable.");
    expect(result.providerUnavailableReason).not.toContain(
      'No API key found for provider "openai"',
    );
  });
});
