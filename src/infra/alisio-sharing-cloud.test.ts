import { describe, expect, it, vi } from "vitest";
import { loadAlisioSharingCloudState } from "./alisio-sharing-cloud.js";

describe("alisio-sharing-cloud", () => {
  it("deduplicates runtime targets before syncing them to Supabase", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof Request ? input.url : String(input),
      );
      const tableName = url.pathname.split("/").at(-1);
      if (
        tableName === "alisio_sharing_targets" &&
        (init?.method ?? "GET").toUpperCase() === "GET"
      ) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        tableName === "alisio_sharing_targets" &&
        (init?.method ?? "GET").toUpperCase() === "POST"
      ) {
        return new Response(JSON.stringify([]), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await loadAlisioSharingCloudState({
      env: {
        ALISIO_SUPABASE_URL: "https://example.supabase.co",
        ALISIO_SUPABASE_ANON_KEY: "anon-key",
      } as NodeJS.ProcessEnv,
      accessToken: "access-token",
      viewer: {
        ownerKey: "user:user-1",
        ownerScope: "user",
        label: "Nuno",
        email: "nuno@example.com",
      },
      targets: [
        {
          targetId: "local:nunos-macbook-air.local",
          label: "Nunos-MacBook-Air.local",
          platform: "macOS",
          sourceKind: "current",
          connected: true,
          current: true,
        },
        {
          targetId: "local:nunos-macbook-air.local",
          label: "Nunos-MacBook-Air.local",
          platform: "macOS",
          sourceKind: "current",
          connected: true,
          current: true,
        },
      ],
      fetchImpl: fetchMock,
    });

    const targetSyncCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof Request ? input.url : String(input),
      );
      return (
        url.pathname.endsWith("/alisio_sharing_targets") &&
        (init?.method ?? "GET").toUpperCase() === "POST"
      );
    });

    expect(targetSyncCall).toBeTruthy();
    const payloadBody = targetSyncCall?.[1]?.body;
    expect(typeof payloadBody).toBe("string");
    const payload = JSON.parse(payloadBody as string) as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      target_id: "local:nunos-macbook-air.local",
      owner_key: "user:user-1",
      source_kind: "current",
      connected: true,
      current: true,
    });
  });
});
