# HERMES Coordination Notes

## Estado

- Config persistente para canonical memory sync ficou exposta em `memory.e2ee.required`, `memory.sync.mode`, `memory.sync.relayBaseUrl` e `memory.sync.ui.enabled`.
- `canonical-store` passa a resolver `memory.sync.*` por ordem: config primeiro, env vars legacy depois.
- O path legacy com `ALISIO_MEMORY_SYNC_PAIRING_CODE` e `ALISIO_MEMORY_SYNC_PAIRING_PASSPHRASE` continua activo por compatibilidade durante esta release.

## RPC mínimo para UI

- `memory.e2ee.setup`
  - Cria ou carrega a profile root key local do device.
  - Persiste localmente; nunca envia key material ao relay.
- `memory.e2ee.exportPairingCode`
  - Exporta uma pairing code cifrada a partir da key local já presente no device.
  - Requer `operator.write`.
- `memory.e2ee.importPairingCode`
  - Importa uma pairing code para storage local.
  - Valida `profileId` antes de persistir.
  - Requer `operator.write`.

## Invariantes

- Não existe path plaintext para relay.
- O relay só recebe ciphertext.
- Material de chave nunca sai do device excepto na pairing code exportada explicitamente.
- Sync não é auto-activado só por definir `relayBaseUrl`; `memory.sync.mode` controla isso.

## Telemetria

- Eventos de log emitidos pelo gateway:
  - `key_created`
  - `key_loaded`
  - `pairing_exported`
  - `pairing_imported`
- Os logs não incluem segredos, passphrases, root keys nem pairing codes.
