import { describe, expect, it, vi } from "vitest";
import {
  augmentConfigWithAlisioRemoteProvider,
  loadAlisioRemoteCatalogEntries,
} from "./alisio-remote-model-provider.js";
import type { AlisioRemoteModelServer } from "./alisio-store.js";

const { listAlisioRemoteModelServersMock } = vi.hoisted(() => ({
  listAlisioRemoteModelServersMock: vi.fn<() => Promise<AlisioRemoteModelServer[]>>(async () => []),
}));

vi.mock("./alisio-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./alisio-store.js")>();
  return {
    ...actual,
    listAlisioRemoteModelServers: listAlisioRemoteModelServersMock,
  };
});

describe("alisio remote model provider", () => {
  it("lists active remote endpoint models in the gateway catalog", async () => {
    listAlisioRemoteModelServersMock.mockResolvedValueOnce([
      {
        serverId: "server-1",
        label: "Studio",
        kind: "openai-compatible",
        baseUrl: "http://192.168.1.50:1234",
        active: true,
        createdAt: "2026-04-06T10:00:00.000Z",
        updatedAt: "2026-04-06T10:00:00.000Z",
      },
    ]);

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "qwen3-32b" }, { id: "gpt-oss-20b", owned_by: "lm-studio" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const entries = await loadAlisioRemoteCatalogEntries({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(entries).toEqual([
      {
        id: "gpt-oss-20b",
        name: "gpt-oss-20b",
        provider: "alisio-remote",
        input: ["text"],
      },
      {
        id: "qwen3-32b",
        name: "qwen3-32b",
        provider: "alisio-remote",
        input: ["text"],
      },
    ]);
  });

  it("injects the active remote endpoint as a runtime provider for selected models", async () => {
    listAlisioRemoteModelServersMock.mockResolvedValueOnce([
      {
        serverId: "server-1",
        label: "Studio",
        kind: "openai-compatible",
        baseUrl: "http://192.168.1.50:1234",
        active: true,
        createdAt: "2026-04-06T10:00:00.000Z",
        updatedAt: "2026-04-06T10:00:00.000Z",
      },
    ]);

    const config = await augmentConfigWithAlisioRemoteProvider({
      config: {},
      requiredModelIds: ["gpt-oss-20b"],
      fetchImpl: vi.fn(async () => new Response("offline", { status: 503 })),
    });

    expect(config.models?.providers?.["alisio-remote"]).toMatchObject({
      baseUrl: "http://192.168.1.50:1234/v1",
      api: "openai-responses",
      models: [
        expect.objectContaining({
          id: "gpt-oss-20b",
          name: "gpt-oss-20b",
        }),
      ],
    });
  });
});
