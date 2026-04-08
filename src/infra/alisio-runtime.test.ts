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

import type { AlisioModelProviderSnapshot } from "./alisio-model-snapshot.js";
import {
  loadAlisioRuntimeSetupState,
  resolveAlisioRuntimeProviderReady,
} from "./alisio-runtime.js";

function createRuntimeSnapshot(params?: {
  localTargetProviderId?: string;
  serverProviderId?: string;
  serverActive?: boolean;
}) {
  const dynamicCatalogEntries = [];
  if (params?.localTargetProviderId) {
    dynamicCatalogEntries.push({
      provider: params.localTargetProviderId,
      id: "qwen3-4b-q4-k-m",
      name: "Qwen3 4B",
    });
  }
  if (params?.serverProviderId && (params.serverActive ?? true)) {
    dynamicCatalogEntries.push({
      provider: params.serverProviderId,
      id: "gpt-oss-20b",
      name: "gpt-oss-20b",
    });
  }
  return {
    targets: params?.localTargetProviderId
      ? [{ chatProviderId: params.localTargetProviderId }]
      : [],
    servers: params?.serverProviderId
      ? [
          {
            active: params.serverActive ?? true,
            chatProviderId: params.serverProviderId,
          },
        ]
      : [],
    dynamicCatalogEntries,
  } as Pick<AlisioModelProviderSnapshot, "targets" | "servers" | "dynamicCatalogEntries">;
}

describe("loadAlisioRuntimeSetupState", () => {
  it("treats local dynamic providers as ready without OpenAI credentials", async () => {
    const runtime = await loadAlisioRuntimeSetupState({
      loadGatewayModelCatalog: async () => [
        {
          provider: "alisio-local-current",
          id: "qwen3-4b-q4-k-m",
          name: "Qwen3 4B",
        },
      ],
    });

    expect(runtime.models.providers).toEqual(["alisio-local-current"]);
    expect(runtime.providerReady).toBe(true);
  });

  it("treats snapshot-backed local runtimes as ready even without a merged catalog", async () => {
    const runtime = await loadAlisioRuntimeSetupState({
      loadGatewayModelCatalog: async () => [],
      loadAlisioModelProviderSnapshot: async () =>
        createRuntimeSnapshot({
          localTargetProviderId: "alisio-local-current",
        }),
    });

    expect(runtime.models.providers).toEqual(["alisio-local-current"]);
    expect(runtime.signals.localTargetReady).toBe(true);
    expect(runtime.providerReady).toBe(true);
  });

  it("requires remote servers to be active before treating them as ready", async () => {
    const activeRuntime = await loadAlisioRuntimeSetupState({
      loadGatewayModelCatalog: async () => [],
      loadAlisioModelProviderSnapshot: async () =>
        createRuntimeSnapshot({
          serverProviderId: "alisio-server-studio",
          serverActive: true,
        }),
    });
    const inactiveRuntime = await loadAlisioRuntimeSetupState({
      loadGatewayModelCatalog: async () => [],
      loadAlisioModelProviderSnapshot: async () =>
        createRuntimeSnapshot({
          serverProviderId: "alisio-server-studio",
          serverActive: false,
        }),
    });

    expect(activeRuntime.signals.activeServerReady).toBe(true);
    expect(activeRuntime.models.providers).toEqual(["alisio-server-studio"]);
    expect(activeRuntime.providerReady).toBe(true);
    expect(inactiveRuntime.signals.activeServerReady).toBe(false);
    expect(inactiveRuntime.models.providers).toEqual([]);
    expect(inactiveRuntime.providerReady).toBe(false);
  });
});

describe("resolveAlisioRuntimeProviderReady", () => {
  it("honors explicit runtime signals from the snapshot", () => {
    expect(
      resolveAlisioRuntimeProviderReady({
        providerReady: false,
        signals: {
          authenticatedProviderReady: false,
          localTargetReady: true,
          activeServerReady: false,
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
