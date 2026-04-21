---
title: "Memory Overview"
summary: "How Alisio turns workspace files, operational notes, and native storage into one durable personal-context contract."
read_when:
  - You want to understand the personal-context contract
  - You want to know how workspace memory relates to native storage and sync
---

# Memory Overview

Alisio memory starts with an explicit workspace contract:

- `MEMORY.md` is curated durable memory.
- `memory/backlog/YYYY-MM-DD/<slug>.md` is backlog intake.
- `memory/<topic>.md` is durable operational topic memory.
- `memory/YYYY-MM-DD.md` is promoted daily memory.

Everything else in the memory product should reinforce that contract, not blur
it.

## Product contract

These layers are intentionally different:

- **Main memory**: `MEMORY.md` for durable facts, preferences, decisions, and stable context.
- **Operational memory**: backlog, topic, and daily notes under `memory/`.
- **Retrieval layer**: search, note views, files views, graph views, and transcript recall.
- **Canonical native store**: profile-scoped ledger-backed storage that syncs and rebuilds derived state.

The product root is `accountId`.

- Backend-shared truth owns auth/session state, linked-device bindings, session
  indexes, and automations.
- Local runtime truth owns `MEMORY.md`, `memory/`, `IDENTITY.md`, `SOUL.md`,
  and `USER.md`.
- Workspace files are local runtime surfaces. They do not replace backend auth
  or account identity.
- Product-facing memory RPC flows (`memory.status`, `memory.sync`, and E2EE
  helpers) resolve against the authenticated account-scoped runtime path instead
  of a single machine-wide workspace root.

Main memory and operational memory are the human-facing product contract.
Search, graph, and sync exist to support them.

## Canonical Layer

The canonical memory layer stores durable events such as:

- page edits
- attachment imports and metadata updates
- relation changes
- sync acknowledgements and checkpoints

Every write goes through backend endpoints that append ledger events. The UI
does not write memory files directly.

## Derived State

Alisio derives several local runtime surfaces from the ledger:

- CRDT-backed wiki pages for editing and conflict-friendly merges
- attachment metadata and provenance panels
- relation graphs and backlinks
- search projections and embeddings indexes

These derived surfaces are rebuildable. If they drift or are deleted, the
runtime can regenerate them from the canonical ledger.

## Search And Retrieval

Memory search indexes **projections** plus any configured
`memorySearch.extraPaths`.

- Projections are derived, query-friendly materializations of ledger-owned
  memory.
- `memorySearch.extraPaths` adds extra read-only search surfaces outside the
  canonical store.
- Search results can expose reason tags and retrieval traces so operators can
  inspect why a page or file surfaced.

Search does not redefine ownership. The ledger remains canonical even when
search indexes, graph summaries, or exported Markdown are regenerated.

## Sync Model

Memory sync is:

- local-first
- end-to-end encrypted by default
- coordinated with Lamport ordering

The runtime keeps local replicas on disk, syncs encrypted ledger payloads, and
replays them into derived state. CRDT page state handles normal concurrent page
edits without treating the exported projection as the merge source of truth.

## Human Facing Surfaces

Operators still get inspectable surfaces:

- workspace memory files (`MEMORY.md` and `memory/**/*.md`)
- native note, file, and graph views
- optional exports such as ZIP, JSON, or Markdown

Exports and native views are derived artifacts around the same durable contract,
not separate memory systems with separate meaning.

## Why This Matters

This model keeps memory:

- durable
- inspectable
- explainable
- portable

It also gives the product a clean separation between what the user edits,
what search indexes, and what sync replicates.

## Related Pages

- [Builtin Engine](/concepts/memory-builtin)
- [Memory Search](/concepts/memory-search)
- [Memory Configuration](/reference/memory-config)
