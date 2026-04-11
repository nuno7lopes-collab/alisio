import type { CreateDirectMemoryTransportStubParams, MemorySyncTransport } from "./types.js";
import { MemorySyncBlockedError } from "./types.js";

function unsupported<T>(reason: "direct_disabled" | "mode_off" = "direct_disabled"): Promise<T> {
  return Promise.reject(new MemorySyncBlockedError(reason));
}

export function createDirectMemoryTransportStub(
  params: CreateDirectMemoryTransportStubParams = {},
): MemorySyncTransport {
  const reason = params.directEnabled ? "mode_off" : "direct_disabled";
  return {
    pushEncryptedEvents() {
      return unsupported(reason);
    },
    pullEncryptedEvents() {
      return unsupported(reason);
    },
    pushAck() {
      return unsupported(reason);
    },
    pullAckVector() {
      return unsupported(reason);
    },
    pushBlob() {
      return unsupported(reason);
    },
    pullBlob() {
      return unsupported(reason);
    },
  };
}
