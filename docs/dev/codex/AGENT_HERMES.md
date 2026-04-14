# HERMES

## Entregável

- `packages/memory-crypto` expõe:
  - `createMemoryCrypto({ profileRootKey, telemetry })`
  - `deriveProfileRootKey({ profileId, passphrase })`
  - `storeProfileRootKey(...)` / `loadProfileRootKey(...)`
  - `setupProfileRootKey(...)`
  - `exportPairingCode(...)` / `importProfileKeyFromPairingCode(...)`
- `packages/memory-sync` expõe:
  - `createCloudRelayMemoryTransport({ baseUrl, getAccessToken, telemetry })`
  - `createDirectMemoryTransportStub({ directEnabled })`
  - `resolveMemorySyncAvailability(...)`
- Config global estável:
  - `memory.e2ee.required` (hard requirement; default `true`)
  - `memory.sync.mode` (default `off`)
  - `memory.sync.relayBaseUrl` (opcional)
  - `memory.sync.ui.enabled` (default `true`, guard de rollout UI)
- Gateway RPC mínimo:
  - `memory.e2ee.setup`
  - `memory.e2ee.exportPairingCode`
  - `memory.e2ee.importPairingCode`

## Contrato

- O relay só recebe ciphertext:
  - eventos: `ciphertextBase64` + `nonceBase64`
  - blobs: `ciphertextBase64`
- A decriptação é sempre local.
- E2EE é obrigatório; `memory.e2ee.required` documenta esse requisito e não introduz um fallback plaintext.
- Se faltar `ProfileRootKey`, o estado correto é `blocked`, nunca plaintext fallback.
- `canonical-store` lê config primeiro e env vars depois para `memory.sync.*`; env legacy continua suportado por compatibilidade durante a transição.

## Chamada mínima para GAIA

```ts
import {
  createMemoryCrypto,
  loadProfileRootKey,
  setupProfileRootKey,
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

## Flags estáveis e rollout

- `memory.ledger.enabled`
- `memory.legacyMarkdownProjection.enabled`
- `memory.crdt.pages.enabled`
- `memory.e2ee.required`
- `memory.sync.ui.enabled`

Os detalhes de pairing continuam locais ao device: a pairing code é a única exportação explícita de material sensível.
