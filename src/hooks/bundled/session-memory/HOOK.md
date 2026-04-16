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
3. **Generates descriptive slug** - Uses LLM to create a meaningful section label based on conversation content
4. **Appends to memory** - Writes into the canonical daily note at `<workspace>/memory/YYYY-MM-DD.md`
5. **Triggers canonical sync** - Reingests the updated daily note through the canonical memory pipeline

## Output Format

Entries are appended to the daily note with the following format:

```markdown
## 14:30:00 UTC - vendor-pitch

- **Action**: /new
- **Session Key**: agent:main:main
- **Session ID**: abc123def456
- **Source**: telegram

### Conversation Summary
```

## Section Examples

The LLM-generated slug is used inside the section heading:

- `## 14:30:00 UTC - vendor-pitch` - Discussion about vendor evaluation
- `## 15:10:00 UTC - api-design` - API architecture planning
- `## 16:45:00 UTC - bug-fix` - Debugging session
- `## 17:20:00 UTC` - Fallback when slug generation is unavailable

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
- Uses your configured LLM for section label generation
- Falls back to a time-only heading if LLM is unavailable
- Keeps all session snapshots for the same day in the same canonical daily note

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
