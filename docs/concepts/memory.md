---
title: "Memory Overview"
summary: "How Alisio stores durable context in your workspace."
read_when:
  - You want to understand how memory works
  - You want to know which files Alisio reads and writes
---

# Memory Overview

Alisio currently exposes memory through Markdown files, but the runtime no longer treats those files as the only durable data layer.

The human-facing memory surface is still local and inspectable:

- `MEMORY.md`
- `memory/YYYY-MM-DD.md`
- a configured Obsidian memory directory when `memory.vaultPath` is enabled

Under that surface, the active memory plugin now keeps a **profile-scoped local structured store** that tracks note entities, explicit note-to-note relations, Markdown projections, and local replica metadata.

## The Two Main Memory Surfaces

- **`MEMORY.md`** for durable facts, preferences, and stable context
- **`memory/YYYY-MM-DD.md`** for day-to-day notes and recent observations

Typical workspace root:

- `~/.alisio/workspace`

## Why This Matters

The product should make memory feel:

- local
- inspectable
- editable
- portable

That is especially important in a desktop-first product where the operator expects their AI workspace to behave like a real working directory.

## Current Verified State

- Markdown remains the editable operator surface for memory.
- The builtin/QMD runtime syncs owned memory notes into a structured local store under the active state dir, scoped to the current Alisio profile.
- Explicit note links are stored as relations in that structured store instead of existing only as raw text links in Markdown.
- The structured store is **local-first** and **per-device** today.
- The structured store can also preserve store-authored entities and regenerate Markdown projections for them, so Markdown is no longer the only transactional representation the runtime can persist.
- Signed-in profiles can sync that canonical store through the Alisio cloud backend using snapshot-based replication plus remote backups.
- Generated canonical Markdown projections now round-trip back into the structured store on the next sync, so operator edits are no longer one-way for store-owned memory notes.

## Compatibility And Legacy

- `MEMORY.md` and `memory/*.md` remain the main compatibility projection surfaces.
- A configured Obsidian memory vault is treated as the human projection/interface for the same memory layer.
- Search-only sources such as `memorySearch.extraPaths` or the read-only Obsidian connector are still searchable context, but they are not treated as the canonical profile memory store.

## Memory Search

When embeddings are configured, Alisio can search memory semantically and by keyword.

That makes it easier to find:

- decisions
- preferences
- notes
- recurring context

When you need explicit structure instead of text retrieval, `alisio memory graph`
reads the canonical local store and returns note entities plus their stored
relations.

## Best Practice

Treat the workspace and vault as the human-editable projection of durable product state.

- back it up
- version it when appropriate
- keep sensitive memory files private

## Current Limitations and Roadmap

- The main end-user write path still enters through Markdown and Obsidian memory
  surfaces (including memory flush), even though the store can now preserve
  store-authored entities and regenerate their Markdown projections locally.
- Cross-device replication is currently coarse-grained. The cloud layer syncs
  whole canonical snapshots, not CRDT-style per-field merges, so concurrent
  edits across non-empty devices still resolve conservatively.
- Visual graph navigation remains roadmap direction, not a finished end-user
  surface.

## Related Pages

- [Memory Search](/concepts/memory-search)
- [Skills](/tools/skills)
- [Product Overview](/start/overview)
