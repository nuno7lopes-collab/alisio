import { incrementSyncCounter, recordSyncTiming } from "./telemetry.js";
import {
  MemorySyncHttpError,
  type CreateCloudRelayMemoryTransportParams,
  type EncryptedMemoryEvent,
  type MemoryBlobMeta,
  type MemorySyncAckVector,
  type MemorySyncTransport,
  type PulledMemoryBlob,
} from "./types.js";

function encodeBase64(value: Uint8Array) {
  return Buffer.from(value).toString("base64");
}

function decodeBase64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function trimBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error("memory sync relay baseUrl must not be empty");
  }
  return trimmed.replace(/\/+$/, "");
}

function asJsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decodeEvent(value: unknown): EncryptedMemoryEvent {
  const record = asJsonRecord(value);
  if (!record) {
    throw new Error("Invalid relay event payload");
  }

  const eventId = typeof record.eventId === "string" ? record.eventId : "";
  const deviceId = typeof record.deviceId === "string" ? record.deviceId : "";
  const eventType = typeof record.eventType === "string" ? record.eventType : "";
  const lamport = typeof record.lamport === "number" ? record.lamport : Number.NaN;
  const schemaVersion =
    typeof record.schemaVersion === "number" ? record.schemaVersion : Number.NaN;
  const createdAtMs = typeof record.createdAtMs === "number" ? record.createdAtMs : Number.NaN;
  const ciphertextBase64 =
    typeof record.ciphertextBase64 === "string" ? record.ciphertextBase64 : "";
  const nonceBase64 = typeof record.nonceBase64 === "string" ? record.nonceBase64 : "";

  if (
    !eventId ||
    !deviceId ||
    !eventType ||
    !Number.isFinite(lamport) ||
    !Number.isFinite(schemaVersion) ||
    !Number.isFinite(createdAtMs) ||
    !ciphertextBase64 ||
    !nonceBase64
  ) {
    throw new Error("Relay event payload is missing required ciphertext fields");
  }

  return {
    eventId,
    deviceId,
    lamport,
    eventType,
    schemaVersion,
    createdAtMs,
    algorithm: "AES-256-GCM",
    ciphertext: decodeBase64(ciphertextBase64),
    nonce: decodeBase64(nonceBase64),
  };
}

function encodeEvent(event: EncryptedMemoryEvent) {
  return {
    eventId: event.eventId,
    deviceId: event.deviceId,
    lamport: event.lamport,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    createdAtMs: event.createdAtMs,
    algorithm: event.algorithm ?? "AES-256-GCM",
    ciphertextBase64: encodeBase64(event.ciphertext),
    nonceBase64: encodeBase64(event.nonce),
  };
}

function decodeAckVector(value: unknown): MemorySyncAckVector {
  const record = asJsonRecord(value);
  if (!record) {
    return {};
  }

  const rawVector = asJsonRecord(record.ackVector) ?? record;
  const decoded: MemorySyncAckVector = {};
  for (const [replicaId, entry] of Object.entries(rawVector)) {
    const ack = asJsonRecord(entry);
    if (!ack) {
      continue;
    }
    const ackLamport = typeof ack.ackLamport === "number" ? ack.ackLamport : Number.NaN;
    const ackEventId = typeof ack.ackEventId === "string" ? ack.ackEventId : "";
    if (!Number.isFinite(ackLamport) || !ackEventId) {
      continue;
    }
    decoded[replicaId] = { ackLamport, ackEventId };
  }
  return decoded;
}

async function parseJsonResponse<T>(response: Response, endpoint: string): Promise<T | undefined> {
  if (response.status === 204) {
    return undefined;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MemorySyncHttpError("Invalid relay JSON response", response.status, endpoint);
  }
  return body as T;
}

export function createCloudRelayMemoryTransport(
  params: CreateCloudRelayMemoryTransportParams,
): MemorySyncTransport {
  const baseUrl = trimBaseUrl(params.baseUrl);
  const fetchImpl = params.fetch ?? fetch;

  async function request(endpoint: string, init: RequestInit) {
    const token = (await params.getAccessToken())?.trim();
    if (!token) {
      incrementSyncCounter(params.telemetry, "auth_failures");
      throw new MemorySyncHttpError("Missing relay bearer token", 401, endpoint);
    }

    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const startedAt = Date.now();
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      ...init,
      headers,
    });
    recordSyncTiming(params.telemetry, "relay_latency_ms", Date.now() - startedAt);

    if (response.status === 401 || response.status === 403) {
      incrementSyncCounter(params.telemetry, "auth_failures");
      throw new MemorySyncHttpError("Relay authentication failed", response.status, endpoint);
    }
    if (!response.ok) {
      throw new MemorySyncHttpError(
        `Relay request failed with status ${String(response.status)}`,
        response.status,
        endpoint,
      );
    }
    return response;
  }

  return {
    async pushEncryptedEvents(profileId, batch) {
      const endpoint = "/v1/memory/events";
      const response = await request(endpoint, {
        method: "POST",
        body: JSON.stringify({
          profileId,
          events: batch.map(encodeEvent),
        }),
      });
      await parseJsonResponse(response, endpoint);
      incrementSyncCounter(params.telemetry, "encrypted_events_pushed", batch.length);
    },

    async pullEncryptedEvents(profileId, sinceLamportExclusive, limit) {
      const endpoint = `/v1/memory/events?profileId=${encodeURIComponent(profileId)}&sinceLamport=${encodeURIComponent(String(sinceLamportExclusive))}&limit=${encodeURIComponent(String(limit))}`;
      const response = await request(endpoint, { method: "GET" });
      const payload = await parseJsonResponse<{ events?: unknown[] } | unknown[]>(
        response,
        endpoint,
      );
      const rawEvents = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.events)
          ? payload.events
          : [];
      const events = rawEvents.map(decodeEvent);
      incrementSyncCounter(params.telemetry, "encrypted_events_pulled", events.length);
      return events;
    },

    async pushAck(profileId, replicaId, ackLamport, ackEventId) {
      const endpoint = "/v1/memory/acks";
      const response = await request(endpoint, {
        method: "POST",
        body: JSON.stringify({
          profileId,
          replicaId,
          ackLamport,
          ackEventId,
        }),
      });
      await parseJsonResponse(response, endpoint);
    },

    async pullAckVector(profileId) {
      const endpoint = `/v1/memory/acks?profileId=${encodeURIComponent(profileId)}`;
      const response = await request(endpoint, { method: "GET" });
      const payload = await parseJsonResponse(response, endpoint);
      return decodeAckVector(payload);
    },

    async pushBlob(profileId, blobId, cipherBytes, meta) {
      const endpoint = `/v1/memory/blobs/${encodeURIComponent(blobId)}`;
      const response = await request(endpoint, {
        method: "PUT",
        body: JSON.stringify({
          profileId,
          blobId,
          meta,
          ciphertextBase64: encodeBase64(cipherBytes),
        }),
      });
      await parseJsonResponse(response, endpoint);
    },

    async pullBlob(profileId, blobId): Promise<PulledMemoryBlob | null> {
      const endpoint = `/v1/memory/blobs/${encodeURIComponent(blobId)}?profileId=${encodeURIComponent(profileId)}`;
      const response = await request(endpoint, { method: "GET" });
      if (response.status === 204) {
        return null;
      }
      const payload = await parseJsonResponse<{
        meta?: MemoryBlobMeta;
        ciphertextBase64?: string;
      }>(response, endpoint);
      const meta = asJsonRecord(payload?.meta) ?? {};
      const ciphertextBase64 =
        typeof payload?.ciphertextBase64 === "string" ? payload.ciphertextBase64 : "";
      if (!ciphertextBase64) {
        throw new MemorySyncHttpError(
          "Relay blob response missing ciphertext",
          response.status,
          endpoint,
        );
      }
      return {
        cipherBytes: decodeBase64(ciphertextBase64),
        meta,
      };
    },
  };
}
