---
title: "Memory Overview"
summary: "How Alisio stores durable context in your workspace."
read_when:
  - You want to understand how memory works
  - You want to know which files Alisio reads and writes
---

# Memory Overview

Alisio remembers things through plain files in your workspace.

There is no magic hidden memory layer. Durable context lives where the operator can read it, edit it, version it, and back it up.

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

## Memory Search

When embeddings are configured, Alisio can search memory semantically and by keyword.

That makes it easier to find:

- decisions
- preferences
- notes
- recurring context

## Best Practice

Treat the workspace as durable product state.

- back it up
- version it when appropriate
- keep sensitive memory files private

## Related Pages

- [Memory Search](/concepts/memory-search)
- [Skills](/tools/skills)
- [Product Overview](/start/overview)
