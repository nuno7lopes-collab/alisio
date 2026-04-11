---
title: "Memory Overview"
summary: "How Alisio stores durable context through a canonical ledger, derived state, and native memory views."
read_when:
  - You want to understand how memory works
  - You want to know which layer is canonical
  - You want to understand native wiki pages, attachments, graph state, and sync
---

# Memory Overview

Alisio memory is now a native product surface built around three user-facing
views:

- Wiki
- Files
- Graph

Those views are backed by a **profile-scoped append-only ledger**. The ledger is
the canonical memory source of truth. Everything else is derived from it.

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

Operators still get inspectable memory surfaces:

- native Wiki editing
- native Files browsing and provenance
- native Graph navigation
- optional exports such as ZIP, JSON, or Markdown

Exports are derived artifacts, not the canonical transaction log.

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
