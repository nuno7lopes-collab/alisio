export type MemorySyncMode = "cloud" | "direct" | "off";

export type MemorySyncCounter =
  | "encrypted_events_pushed"
  | "encrypted_events_pulled"
  | "auth_failures";

export type MemorySyncTimingMetric = "relay_latency_ms";

export type MemorySyncTelemetry = {
  incrementCounter: (name: MemorySyncCounter, value?: number) => void;
  recordTiming: (name: MemorySyncTimingMetric, durationMs: number) => void;
};

export type EncryptedMemoryEvent = {
  eventId: string;
  deviceId: string;
  lamport: number;
  eventType: string;
  schemaVersion: number;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  algorithm?: "AES-256-GCM";
};

export type MemorySyncAck = {
  replicaId: string;
  ackLamport: number;
  ackEventId: string;
};

export type MemorySyncAckVector = Record<
  string,
  {
    ackLamport: number;
    ackEventId: string;
  }
>;

export type MemoryBlobMeta = Record<string, unknown>;

export type PulledMemoryBlob = {
  cipherBytes: Uint8Array;
  meta: MemoryBlobMeta;
};

export interface MemorySyncTransport {
  pushEncryptedEvents(profileId: string, batch: EncryptedMemoryEvent[]): Promise<void>;
  pullEncryptedEvents(
    profileId: string,
    sinceLamportExclusive: number,
    limit: number,
  ): Promise<EncryptedMemoryEvent[]>;
  pushAck(
    profileId: string,
    replicaId: string,
    ackLamport: number,
    ackEventId: string,
  ): Promise<void>;
  pullAckVector(profileId: string): Promise<MemorySyncAckVector>;
  pushBlob(
    profileId: string,
    blobId: string,
    cipherBytes: Uint8Array,
    meta: MemoryBlobMeta,
  ): Promise<void>;
  pullBlob(profileId: string, blobId: string): Promise<PulledMemoryBlob | null>;
}

export type CreateCloudRelayMemoryTransportParams = {
  baseUrl: string;
  getAccessToken: () => string | undefined | Promise<string | undefined>;
  fetch?: typeof fetch;
  telemetry?: MemorySyncTelemetry;
};

export type CreateDirectMemoryTransportStubParams = {
  directEnabled?: boolean;
};

export type ResolveSyncAvailabilityParams = {
  enabled?: boolean;
  mode?: MemorySyncMode;
  directEnabled?: boolean;
  profileRootKeyAvailable?: boolean;
};

export type MemorySyncAvailability = {
  state: "active" | "inactive" | "blocked";
  mode: MemorySyncMode;
  reason?: "disabled" | "mode_off" | "missing_profile_key" | "direct_disabled";
};

export class MemorySyncHttpError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = "MemorySyncHttpError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

export class MemorySyncBlockedError extends Error {
  readonly reason: NonNullable<MemorySyncAvailability["reason"]>;

  constructor(reason: NonNullable<MemorySyncAvailability["reason"]>) {
    super(`memory sync blocked: ${reason}`);
    this.name = "MemorySyncBlockedError";
    this.reason = reason;
  }
}
