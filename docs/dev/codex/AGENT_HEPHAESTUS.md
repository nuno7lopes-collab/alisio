# HEPHAESTUS Memory Ledger Notes

## Scope

- Canonical memory source of truth is the append-only event ledger.
- Runtime state, projections, and sync transport stay outside this package boundary.
- There is no external vault surface in this design.

## Packages

- `packages/memory-schema`: canonical ULID IDs, event envelope schemas, plain/encrypted payload wrappers, stable hash helpers.
- `packages/memory-ledger`: SQLite storage engine, migrations, ack vector tracking, checkpoint storage, compaction planning, telemetry hooks.

## Integration contract

- GAIA should serialize domain payloads into bytes, assign stable IDs, and append events in lamport order.
- HERMES should provide encrypted payloads as `{ kind: "encrypted", ciphertext, nonce, aad? }` and manage transport plus key material outside the ledger.
- Integrators can bypass the ledger entirely when `memory.ledger.enabled=false`; these packages do not read global config.

## Safety invariants

- `event_id` is idempotent.
- Lamport ordering is enforced strictly at append time.
- Event hashes form a deterministic chain from `prev_event_hash`, `payload_hash`, and stable metadata fields.
- Compaction planning is advisory only and requires both replica acknowledgements and a covering checkpoint.
