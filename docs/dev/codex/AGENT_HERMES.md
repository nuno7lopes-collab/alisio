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
- E2EE é obrigatório; nesta árvore isso é tratado pelo fluxo/runtime, não por um knob global estável de config.
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
  enabled: true,
  mode: "cloud",
  directEnabled: false,
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

## Flags estáveis

- `memory.ledger.enabled`
- `memory.legacyMarkdownProjection.enabled`
- `memory.crdt.pages.enabled`

Os detalhes de transporte de sync continuam no contrato dos packages (`packages/memory-sync`, `packages/memory-crypto`) e não estão expostos aqui como config global estável nesta árvore.
