import { describe, expect, it, vi } from "vitest";

describe("loadGatewayModelCatalog", () => {
  it("merges live Alisio dynamic catalog entries when a node registry is available", async () => {
    vi.resetModules();
    vi.doMock("../agents/model-catalog.js", () => ({
      loadModelCatalog: vi.fn(async () => [
        {
          id: "gpt-5.4",
          name: "gpt-5.4",
          provider: "openai",
        },
      ]),
      resetModelCatalogCacheForTest: vi.fn(),
    }));
    vi.doMock("../infra/alisio-model-snapshot.js", () => ({
      loadAlisioModelProviderSnapshot: vi.fn(async () => ({
        dynamicCatalogEntries: [
          {
            id: "gpt-oss-20b",
            name: "gpt-oss-20b",
            provider: "alisio-server-home-lab",
            providerLabel: "Home Lab",
            input: ["text"],
          },
          {
            id: "gpt-5.4",
            name: "duplicate",
            provider: "openai",
          },
        ],
      })),
    }));

    const { loadGatewayModelCatalog } = await import("./server-model-catalog.js");
    const catalog = await loadGatewayModelCatalog({
      getConfig: () => ({}),
      nodeRegistry: {} as never,
    });

    expect(catalog).toEqual([
      {
        id: "gpt-oss-20b",
        name: "gpt-oss-20b",
        provider: "alisio-server-home-lab",
        providerLabel: "Home Lab",
        input: ["text"],
      },
      {
        id: "gpt-5.4",
        name: "gpt-5.4",
        provider: "openai",
      },
    ]);
  });
});
