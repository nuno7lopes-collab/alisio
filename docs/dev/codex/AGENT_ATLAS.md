# ATLAS Native Memory UI Notes

## Scope

- Own the native memory operator surface in the control UI.
- Keep the page split to exactly three views: Wiki, Files, and Graph.
- Treat the ledger as canonical and the UI as a client of backend memory APIs.

## UI contract

- Wiki loads pages from `memory.wiki.list`, `memory.wiki.get`, `memory.wiki.update`, and `memory.wiki.history`.
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
- Keep legacy file editing behind `ui.memory.legacyEditor.enabled=false` by default.
- Avoid backend refactors in UI work. Assume backend teams own schema and storage internals.
