# ATLAS Native Memory UI Notes

## Scope

- Own the native memory operator surface in the control UI.
- Keep the page split to exactly three views: Notes, Files, and Graph.
- Treat the ledger as canonical and the UI as a client of backend memory APIs.

## UI contract

- Notes load entries from `memory.notes.list`, `memory.notes.get`, `memory.notes.update`, and `memory.notes.history`.
- Files loads attachments from `memory.files.list` and `memory.files.get`.
- Trace inspection loads explainability from `memory.trace.get`.
- Export uses `memory.export` with `zip`, `json`, or `markdown`.

## Product rules

- No direct file writes for native editing.
- Every edit must append backend ledger events.
- Provenance and retrieval traces must stay visible when available.
- Sync status should surface Lamport progress and `E2EE required`.

## Safety

- If a gateway is older and a native memory method is missing, show a friendly unsupported message instead of failing hard.
- Avoid backend refactors in UI work. Assume backend teams own schema and storage internals.
