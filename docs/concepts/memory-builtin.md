---
title: "Builtin Memory Engine"
summary: "The default SQLite-based memory backend with keyword, vector, and hybrid search"
read_when:
  - You want to understand the default memory backend
  - You want to configure embedding providers or hybrid search
---

# Builtin Memory Engine

The builtin engine is the default memory backend. It stores your memory index in
a per-agent SQLite database and keeps a separate profile-scoped canonical memory
store for structured note data. It needs no extra dependencies to get started.

## What it provides

- **Keyword search** via FTS5 full-text indexing (BM25 scoring).
- **Vector search** via embeddings from any supported provider.
- **Hybrid search** that combines both for best results.
- **CJK support** via trigram tokenization for Chinese, Japanese, and Korean.
- **sqlite-vec acceleration** for in-database vector queries (optional).
- **Structured canonical memory store** for note entities, explicit relations,
  regenerable Markdown projections, and local replica metadata.

## Getting started

If you have an API key for OpenAI, Gemini, Voyage, or Mistral, the builtin
engine auto-detects it and enables vector search. No config needed.

To set a provider explicitly:

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        provider: "openai",
      },
    },
  },
}
```

Without an embedding provider, only keyword search is available.

## Supported embedding providers

| Provider | ID        | Auto-detected | Notes                               |
| -------- | --------- | ------------- | ----------------------------------- |
| OpenAI   | `openai`  | Yes           | Default: `text-embedding-3-small`   |
| Gemini   | `gemini`  | Yes           | Supports multimodal (image + audio) |
| Voyage   | `voyage`  | Yes           |                                     |
| Mistral  | `mistral` | Yes           |                                     |
| Local    | `local`   | Yes (first)   | GGUF model, ~0.6 GB download        |

Auto-detection picks the first provider whose API key can be resolved, in the
order shown. Set `memorySearch.provider` to override.

## How storage works

Alisio currently maintains two local SQLite layers:

- **Search index:** `~/.alisio/memory/<agentId>.sqlite`
- **Canonical memory store:** `~/.alisio/memory/profiles/<profileId>/canonical.sqlite`

The search index powers retrieval. The canonical memory store keeps the
structured representation of owned memory notes for the active Alisio profile.

Today, the builtin engine supports both:

- importing operator-edited Markdown and derived memory projections into the
  structured store
- keeping store-authored structured entities plus regenerable Markdown
  projections in that same canonical store

Operational surfaces now split cleanly:

- `alisio memory search` still searches Markdown projections and
  optional session transcripts.
- `alisio memory graph` inspects the structured canonical store for explicit
  note-to-note relations under that human-facing projection, with a single
  surface that supports `overview` and `focus` modes.

Alisio indexes `MEMORY.md` and `memory/*.md` into chunks (~400 tokens with
80-token overlap) for search.

- **File watching:** changes to memory files trigger a debounced reindex (1.5s).
- **Auto-reindex:** when the embedding provider, model, or chunking config
  changes, the entire index is rebuilt automatically.
- **Reindex on demand:** `alisio memory index --force`

<Info>
The canonical memory store remains local-first, but signed-in profiles sync
encrypted ledger-backed state by default. Lamport ordering and derived-state
replay keep the local store and projections aligned without treating search
artifacts as the source of truth.
</Info>

<Info>
Store-authored Markdown projections are regenerable from the canonical store,
and operator edits to those generated projections now round-trip back into the
structured store on the next canonical sync.
</Info>

<Info>
Current limitation: cloud reconciliation is still coarse-grained. The canonical
store still has areas that replay conservatively, but page edits now rely on
CRDT state instead of merge-by-projection alone.
</Info>

<Info>
You can also index Markdown files outside the workspace with
`memorySearch.extraPaths`. See the
[configuration reference](/reference/memory-config#additional-memory-paths).
</Info>

## When to use

The builtin engine is the right choice for most users:

- Works out of the box with no extra dependencies.
- Handles keyword and vector search well.
- Supports all embedding providers.
- Hybrid search combines the best of both retrieval approaches.

Consider switching to [QMD](/concepts/memory-qmd) if you need reranking, query
expansion, or want to index directories outside the workspace.

Consider [Honcho](/concepts/memory-honcho) if you want cross-session memory with
automatic user modeling.

## Troubleshooting

**Memory search disabled?** Check `alisio memory status`. If no provider is
detected, set one explicitly or add an API key.

**Stale results?** Run `alisio memory index --force` to rebuild. The watcher
may miss changes in rare edge cases.

**sqlite-vec not loading?** Alisio falls back to in-process cosine similarity
automatically. Check logs for the specific load error.

## Configuration

For embedding provider setup, hybrid search tuning (weights, MMR, temporal
decay), batch indexing, multimodal memory, sqlite-vec, extra paths, and all
other config knobs, see the
[Memory configuration reference](/reference/memory-config).
