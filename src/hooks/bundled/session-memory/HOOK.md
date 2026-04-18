---
name: session-memory
description: "Save session context to memory when /new or /reset command is issued"
homepage: https://docs.alisio.ai/automation/hooks#session-memory
metadata:
  {
    "alisio":
      {
        "emoji": "💾",
        "events": ["command:new", "command:reset"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with Alisio" }],
      },
  }
---

# Session Memory Hook

Automatically saves session context to your workspace memory when you issue `/new` or `/reset`.

## What It Does

When you run `/new` or `/reset` to start a fresh session:

1. **Finds the previous session** - Uses the pre-reset session entry to locate the correct transcript
2. **Extracts conversation** - Reads the last N user/assistant messages from the session (default: 15, configurable)
3. **Generates descriptive slug** - Uses LLM to create a meaningful backlog note slug based on conversation content
4. **Writes to backlog** - Creates a canonical backlog note at `<workspace>/memory/backlog/YYYY-MM-DD/<slug>.md`
5. **Triggers canonical sync** - Reingests the new backlog note through the canonical memory pipeline

## Output Format

Each snapshot is stored as its own backlog note with the following format:

```markdown
---
memoryRole: backlog
backlogStatus: pending
capturedAt: "2026-04-18T14:30:00.000Z"
sessionAction: "new"
tags:
  - backlog
  - session-memory
---
# Session new - Vendor Pitch

## Context

- **Action**: /new
- **Session Key**: agent:main:main
- **Session ID**: abc123def456
- **Source**: telegram

## Conversation Summary
```

## Path Examples

The LLM-generated slug is used in the backlog path:

- `memory/backlog/2026-04-18/vendor-pitch.md` - Discussion about vendor evaluation
- `memory/backlog/2026-04-18/api-design.md` - API architecture planning
- `memory/backlog/2026-04-18/bug-fix.md` - Debugging session
- `memory/backlog/2026-04-18/1720.md` - Fallback when slug generation is unavailable

## Requirements

- **Config**: `workspace.dir` must be set (automatically configured during setup)

The hook uses your configured LLM provider to generate descriptive labels when available, so it works with any provider (Anthropic, OpenAI, etc.).

## Configuration

The hook supports optional configuration:

| Option     | Type   | Default | Description                                                     |
| ---------- | ------ | ------- | --------------------------------------------------------------- |
| `messages` | number | 15      | Number of user/assistant messages to include in the memory file |

Example configuration:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "session-memory": {
          "enabled": true,
          "messages": 25
        }
      }
    }
  }
}
```

The hook automatically:

- Uses your workspace directory (`~/.alisio/workspace` by default)
- Uses your configured LLM for backlog note slug generation
- Falls back to a time-based slug if LLM is unavailable
- Keeps each session snapshot as a separate promotable backlog note

## Disabling

To disable this hook:

```bash
alisio hooks disable session-memory
```

Or remove it from your config:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "session-memory": { "enabled": false }
      }
    }
  }
}
```
