import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryCrypto, deriveProfileRootKey } from "../../memory-crypto/src/index.js";
import {
  createCloudRelayMemoryTransport,
  createDirectMemoryTransportStub,
  createMemorySyncTelemetryCollector,
  resolveMemorySyncAvailability,
} from "./index.js";

async function withServer(
  handler: (
    req: http.IncomingMessage,
    body: Buffer,
  ) => Promise<{
    status?: number;
    headers?: Record<string, string>;
    body?: string;
  }>,
) {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", async () => {
      const result = await handler(req, Buffer.concat(chunks));
      res.writeHead(result.status ?? 200, {
        "content-type": "application/json",
        ...result.headers,
      });
      res.end(result.body ?? "{}");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server");
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

describe("@alisio/memory-sync", () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = null;
    }
  });

  it("pushes and pulls ciphertext-only event and blob payloads through the cloud relay", async () => {
    const plaintextMarker = "TOP_SECRET_EVENT_MARKER";
    const profileRootKey = await deriveProfileRootKey({
      profileId: "profile-sync",
      passphrase: "memory sync passphrase",
    });
    const crypto = createMemoryCrypto({ profileRootKey });
    const eventMeta = {
      profileId: "profile-sync",
      deviceId: "device-sync",
      lamport: 11,
      eventType: "ledger.memory.merge",
      schemaVersion: 1,
      createdAtMs: 1_725_000_000_000,
      eventId: "evt-sync-1",
    };
    const encryptedEvent = await crypto.encryptEventPayload(
      eventMeta,
      new TextEncoder().encode(plaintextMarker),
    );
    const encryptedBlob = await crypto.encryptBlob(
      "blob-sync-1",
      new TextEncoder().encode(plaintextMarker),
    );

    let seenEventBody = "";
    let seenBlobBody = "";
    const seenAuthorizations: string[] = [];

    const server = await withServer(async (req, body) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      seenAuthorizations.push(String(req.headers.authorization ?? ""));
      if (req.method === "POST" && url.pathname === "/v1/memory/events") {
        seenEventBody = body.toString("utf8");
        return { status: 204, body: "" };
      }
      if (req.method === "GET" && url.pathname === "/v1/memory/events") {
        return {
          body: JSON.stringify({
            events: [
              {
                eventId: eventMeta.eventId,
                deviceId: eventMeta.deviceId,
                lamport: eventMeta.lamport,
                eventType: eventMeta.eventType,
                schemaVersion: eventMeta.schemaVersion,
                createdAtMs: eventMeta.createdAtMs,
                ciphertextBase64: Buffer.from(encryptedEvent.ciphertext).toString("base64"),
                nonceBase64: Buffer.from(encryptedEvent.nonce).toString("base64"),
              },
            ],
          }),
        };
      }
      if (req.method === "POST" && url.pathname === "/v1/memory/acks") {
        return { status: 204, body: "" };
      }
      if (req.method === "GET" && url.pathname === "/v1/memory/acks") {
        return {
          body: JSON.stringify({
            ackVector: {
              "replica-a": { ackLamport: 11, ackEventId: "evt-sync-1" },
            },
          }),
        };
      }
      if (req.method === "PUT" && url.pathname === "/v1/memory/blobs/blob-sync-1") {
        seenBlobBody = body.toString("utf8");
        return { status: 204, body: "" };
      }
      if (req.method === "GET" && url.pathname === "/v1/memory/blobs/blob-sync-1") {
        return {
          body: JSON.stringify({
            meta: {
              contentType: "application/octet-stream",
              algorithm: "AES-256-GCM",
            },
            ciphertextBase64: Buffer.from(encryptedBlob.ciphertext).toString("base64"),
          }),
        };
      }
      return { status: 404, body: JSON.stringify({ error: "not found" }) };
    });
    cleanup = server.close;

    const telemetry = createMemorySyncTelemetryCollector();
    const transport = createCloudRelayMemoryTransport({
      baseUrl: server.baseUrl,
      getAccessToken: async () => "relay-token",
      telemetry: telemetry.telemetry,
    });

    await transport.pushEncryptedEvents("profile-sync", [
      {
        eventId: eventMeta.eventId,
        deviceId: eventMeta.deviceId,
        lamport: eventMeta.lamport,
        eventType: eventMeta.eventType,
        schemaVersion: eventMeta.schemaVersion,
        createdAtMs: eventMeta.createdAtMs,
        ciphertext: encryptedEvent.ciphertext,
        nonce: encryptedEvent.nonce,
      },
    ]);

    const pulledEvents = await transport.pullEncryptedEvents("profile-sync", 0, 20);
    expect(pulledEvents).toHaveLength(1);
    expect(Buffer.from(pulledEvents[0].ciphertext)).toEqual(Buffer.from(encryptedEvent.ciphertext));
    expect(seenEventBody).not.toContain(plaintextMarker);

    await transport.pushAck("profile-sync", "replica-a", 11, "evt-sync-1");
    expect(await transport.pullAckVector("profile-sync")).toEqual({
      "replica-a": { ackLamport: 11, ackEventId: "evt-sync-1" },
    });

    await transport.pushBlob("profile-sync", "blob-sync-1", encryptedBlob.ciphertext, {
      contentType: "application/octet-stream",
    });
    const pulledBlob = await transport.pullBlob("profile-sync", "blob-sync-1");
    expect(pulledBlob?.meta).toEqual({
      contentType: "application/octet-stream",
      algorithm: "AES-256-GCM",
    });
    expect(Buffer.from(pulledBlob?.cipherBytes ?? [])).toEqual(
      Buffer.from(encryptedBlob.ciphertext),
    );
    expect(seenBlobBody).not.toContain(plaintextMarker);
    expect(seenAuthorizations.every((header) => header === "Bearer relay-token")).toBe(true);

    expect(telemetry.getCounter("encrypted_events_pushed")).toBe(1);
    expect(telemetry.getCounter("encrypted_events_pulled")).toBe(1);
    expect(telemetry.getTimings("relay_latency_ms").length).toBeGreaterThan(0);
  });

  it("tracks relay auth failures and blocks direct sync without the explicit flag", async () => {
    const server = await withServer(async () => ({
      status: 401,
      body: JSON.stringify({ error: "unauthorized" }),
    }));
    cleanup = server.close;

    const telemetry = createMemorySyncTelemetryCollector();
    const transport = createCloudRelayMemoryTransport({
      baseUrl: server.baseUrl,
      getAccessToken: async () => "bad-token",
      telemetry: telemetry.telemetry,
    });

    await expect(transport.pullAckVector("profile-sync")).rejects.toThrow(/authentication failed/i);
    expect(telemetry.getCounter("auth_failures")).toBe(1);

    const direct = createDirectMemoryTransportStub();
    await expect(direct.pullAckVector("profile-sync")).rejects.toThrow(/direct_disabled/i);

    expect(
      resolveMemorySyncAvailability({
        enabled: true,
        mode: "cloud",
        profileRootKeyAvailable: false,
      }),
    ).toEqual({
      state: "blocked",
      mode: "cloud",
      reason: "missing_profile_key",
    });
  });
});
