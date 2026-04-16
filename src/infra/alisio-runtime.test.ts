import { describe, expect, it, vi } from "vitest";

const { listProfilesForProviderMock, loadAuthProfileStoreMock, collectProviderApiKeysMock } =
  vi.hoisted(() => ({
    listProfilesForProviderMock: vi.fn(() => []),
    loadAuthProfileStoreMock: vi.fn(() => ({})),
    collectProviderApiKeysMock: vi.fn(() => []),
  }));

vi.mock("../agents/auth-profiles.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/auth-profiles.js")>();
  return {
    ...actual,
    loadAuthProfileStore: loadAuthProfileStoreMock,
    listProfilesForProvider: listProfilesForProviderMock,
  };
});

vi.mock("../agents/live-auth-keys.js", () => ({
  collectProviderApiKeys: collectProviderApiKeysMock,
}));

import {
  buildEmptyAlisioRuntimeSetupState,
  loadAlisioRuntimeSetupState,
  loadAlisioRuntimeSetupStateWithTimeout,
  resolveAlisioRuntimeProviderReady,
} from "./alisio-runtime.js";

type RuntimeSnapshot = {
  targets: Array<{ chatProviderId?: string }>;
  dynamicCatalogEntries: Array<{ provider: string; id: string; name: string }>;
};

function createRuntimeSnapshot(params?: {
  targetProviderIds?: string[];
}) {
  const dynamicCatalogEntries = [];
  for (const providerId of params?.targetProviderIds ?? []) {
    dynamicCatalogEntries.push({
      provider: providerId,
      id: providerId.includes("local") ? "qwen3-4b-q4-k-m" : "gpt-oss-20b",
      name: providerId.includes("local") ? "Qwen3 4B" : "gpt-oss-20b",
    });
  }
  return {
    targets: (params?.targetProviderIds ?? []).map((chatProviderId) => ({ chatProviderId })),
    dynamicCatalogEntries,
  } satisfies RuntimeSnapshot;
}

describe("loadAlisioRuntimeSetupState", () => {
  it("treats local dynamic providers as ready without OpenAI credentials", async () => {
    const runtime = await loadAlisioRuntimeSetupState({
      loadGatewayModelCatalog: async () => [
        {
          provider: "alisio-local-current-llama",
          id: "qwen3-4b-q4-k-m",
          name: "Qwen3 4B",
        },
      ],
    });

    expect(runtime.models.providers).toEqual(["alisio-local-current-llama"]);
    expect(runtime.providerReady).toBe(true);
  });

  it("treats snapshot-backed local runtimes as ready even without a merged catalog", async () => {
    const runtime = await loadAlisioRuntimeSetupState({
      loadGatewayModelCatalog: async () => [],
      loadAlisioModelProviderSnapshot: async () =>
        createRuntimeSnapshot({
          targetProviderIds: ["alisio-local-current-llama"],
        }),
    });

    expect(runtime.models.providers).toEqual(["alisio-local-current-llama"]);
    expect(runtime.signals.targetReady).toBe(true);
    expect(runtime.providerReady).toBe(true);
  });

  it("treats linked-node runtimes as ready when the snapshot exposes them", async () => {
    const runtime = await loadAlisioRuntimeSetupState({
      loadGatewayModelCatalog: async () => [],
      loadAlisioModelProviderSnapshot: async () =>
        createRuntimeSnapshot({
          targetProviderIds: ["alisio-target-remote-1-llama"],
        }),
    });

    expect(runtime.signals.targetReady).toBe(true);
    expect(runtime.models.providers).toEqual(["alisio-target-remote-1-llama"]);
    expect(runtime.providerReady).toBe(true);
  });

  it("can skip dynamic runtime discovery for startup-safe shells", async () => {
    const loadGatewayModelCatalog = vi.fn(async () => []);
    const loadAlisioModelProviderSnapshot = vi.fn(async () =>
      createRuntimeSnapshot({
        targetProviderIds: ["alisio-local-current-llama"],
      }),
    );

    const runtime = await loadAlisioRuntimeSetupState({
      includeDynamicCatalog: false,
      loadGatewayModelCatalog,
      loadAlisioModelProviderSnapshot,
    });

    expect(loadGatewayModelCatalog).toHaveBeenCalledOnce();
    expect(loadAlisioModelProviderSnapshot).not.toHaveBeenCalled();
    expect(runtime).toEqual(buildEmptyAlisioRuntimeSetupState());
  });

  it("falls back quickly when runtime discovery stalls", async () => {
    const runtime = await loadAlisioRuntimeSetupStateWithTimeout(
      {
        loadGatewayModelCatalog: async () => await new Promise<never>(() => undefined),
      },
      { timeoutMs: 1 },
    );

    expect(runtime).toEqual(buildEmptyAlisioRuntimeSetupState());
  });
});

describe("resolveAlisioRuntimeProviderReady", () => {
  it("honors explicit runtime signals from the snapshot", () => {
    expect(
      resolveAlisioRuntimeProviderReady({
        providerReady: false,
        signals: {
          authenticatedProviderReady: false,
          targetReady: true,
        },
        models: {
          total: 0,
          defaultProvider: "openai",
          providers: [],
        },
      }),
    ).toBe(true);
  });

  it("keeps needs-ai when no authenticated or dynamic provider exists", () => {
    expect(
      resolveAlisioRuntimeProviderReady({
        providerReady: false,
        models: {
          total: 0,
          defaultProvider: "openai",
          providers: [],
        },
      }),
    ).toBe(false);
  });
});
