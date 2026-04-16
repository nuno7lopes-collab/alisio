---
summary: "CLI reference for `alisio memory` (status/index/search/graph)"
read_when:
  - You want to index or search semantic memory
  - You’re debugging memory availability or indexing
title: "memory"
---

# `alisio memory`

Manage semantic memory indexing, search, and canonical graph inspection.
Provided by the active memory plugin (default: `memory-core`; set `plugins.slots.memory = "none"` to disable).

Related:

- Memory concept: [Memory](/concepts/memory)
- Plugins: [Plugins](/tools/plugin)

## Examples

```bash
alisio memory status
alisio memory status --deep
alisio memory index --force
alisio memory search "meeting notes"
alisio memory graph "project atlas"
alisio memory graph --scope overview
alisio memory graph --scope focus --page-id page-atlas
alisio memory search --query "deployment" --max-results 20
alisio memory graph --query "roadmap" --direction incoming --relation-limit 12
alisio memory graph --scope overview --include-attachments --node-limit 24
alisio memory status --json
alisio memory status --deep --index
alisio memory status --deep --index --verbose
alisio memory status --agent main
alisio memory index --agent main --verbose
```

## Options

`memory status` and `memory index`:

- `--agent <id>`: scope to a single agent. Without it, these commands run for each configured agent; if no agent list is configured, they fall back to the default agent.
- `--verbose`: emit detailed logs during probes and indexing.

`memory status`:

- `--deep`: probe vector + embedding availability.
- `--index`: run a reindex if the store is dirty (implies `--deep`).
- `--json`: print JSON output.

`memory index`:

- `--force`: force a full reindex.

`memory search`:

- Query input: pass either positional `[query]` or `--query <text>`.
- If both are provided, `--query` wins.
- If neither is provided, the command exits with an error.
- `--agent <id>`: scope to a single agent (default: the default agent).
- `--max-results <n>`: limit the number of results returned.
- `--min-score <n>`: filter out low-score matches.
- `--json`: print JSON results.

`memory graph`:

- Use `--scope overview` for the broad graph view. This does not require a query.
- Use `--scope focus` for a focused graph view. This requires `--query <text>`, `--page-id <id>`, or `--entity-id <id>`.
- Query input: pass either positional `[query]` or `--query <text>`.
- If both are provided, `--query` wins.
- Without `--scope`, the CLI infers focus mode when you provide a query/page/entity id; otherwise it asks you to choose a target explicitly.
- `--agent <id>`: scope to a single agent (default: the default agent).
- `--page-id <id>`: focus a specific canonical page id.
- `--entity-id <id>`: focus a specific canonical entity id.
- `--scope <mode>`: `overview` or `focus`. Legacy `global` and `local` values are still accepted for compatibility.
- `--direction <dir>`: `incoming`, `outgoing`, or `both` (default).
- `--depth <n>`: control traversal depth.
- `--match-limit <n>`: limit matched entities from the canonical store.
- `--relation-limit <n>`: cap returned relations across the selected directions.
- `--node-limit <n>`: cap visible graph nodes.
- `--edge-limit <n>`: cap visible graph edges.
- `--include-attachments`: include referenced attachment nodes in the visible graph.
- `--json`: print structured JSON results.

Notes:

- `memory index --verbose` prints per-phase details (provider, model, sources, batch activity).
- `memory status` includes any extra paths configured via `memorySearch.extraPaths`.
- `memory graph` reads the profile-scoped structured canonical store behind the native wiki and derived projections, so it can return explicit note-to-note relations instead of only text matches.
- `memory graph` now exposes one surface with two modes: `overview` for the broader map, and `focus` for a relationship trace around a specific note/entity.
- When the active profile is signed into Alisio cloud, the canonical store keeps a local-first replica on disk and may report snapshot-based cloud sync status for that profile store.
- If effectively active memory remote API key fields are configured as SecretRefs, the command resolves those values from the active gateway snapshot. If gateway is unavailable, the command fails fast.
- Gateway version skew note: this command path requires a gateway that supports `secrets.resolve`; older gateways return an unknown-method error.
