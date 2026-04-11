# HERMES

## Entregável

- `packages/memory-crypto` expõe:
  - `createMemoryCrypto({ profileRootKey, telemetry })`
  - `deriveProfileRootKey({ profileId, passphrase })`
  - `storeProfileRootKey(...)` / `loadProfileRootKey(...)`
  - `exportPairingCode(...)` / `importProfileKeyFromPairingCode(...)`
- `packages/memory-sync` expõe:
  - `createCloudRelayMemoryTransport({ baseUrl, getAccessToken, telemetry })`
  - `createDirectMemoryTransportStub({ directEnabled })`
  - `resolveMemorySyncAvailability(...)`

## Contrato

- O relay só recebe ciphertext:
  - eventos: `ciphertextBase64` + `nonceBase64`
  - blobs: `ciphertextBase64`
- A decriptação é sempre local.
- `memory.e2ee.required` é informativo; a implementação assume E2EE obrigatória.
- Se faltar `ProfileRootKey`, o estado correto é `blocked`, nunca plaintext fallback.

## Chamada mínima para GAIA

```ts
import {
  createMemoryCrypto,
  loadProfileRootKey,
} from "../../../packages/memory-crypto/src/index.js";
import {
  createCloudRelayMemoryTransport,
  resolveMemorySyncAvailability,
} from "../../../packages/memory-sync/src/index.js";

const profileRootKey = await loadProfileRootKey({ profileId, passphrase });
const availability = resolveMemorySyncAvailability({
  enabled: cfg.memory?.sync?.enabled,
  mode: cfg.memory?.sync?.mode,
  directEnabled: cfg.memory?.sync?.direct?.enabled,
  profileRootKeyAvailable: Boolean(profileRootKey),
});

if (availability.state !== "active" || !profileRootKey) {
  return availability;
}

const crypto = createMemoryCrypto({ profileRootKey, telemetry: cryptoTelemetry });
const transport = createCloudRelayMemoryTransport({
  baseUrl,
  getAccessToken,
  telemetry: syncTelemetry,
});

const cipher = await crypto.encryptEventPayload(meta, plaintextBytes);
await transport.pushEncryptedEvents(profileId, [
  {
    eventId: meta.eventId,
    deviceId: meta.deviceId,
    lamport: meta.lamport,
    eventType: meta.eventType,
    schemaVersion: meta.schemaVersion,
    ciphertext: cipher.ciphertext,
    nonce: cipher.nonce,
  },
]);
```

## Flags

- `memory.sync.enabled`
- `memory.sync.mode = "cloud" | "direct" | "off"`
- `memory.sync.batchSize`
- `memory.sync.pullIntervalMs`
- `memory.sync.maxInflightBatches`
- `memory.sync.direct.enabled`
- `memory.e2ee.required = true`
