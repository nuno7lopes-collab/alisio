---
summary: "CLI reference for `alisio nodes` (list/status/approve/invoke, camera/canvas/screen)"
read_when:
  - You’re managing paired computers (nodes) for cameras, screen, or canvas
  - You need to approve requests or invoke node commands
title: "nodes"
---

# `alisio nodes`

Manage paired computers (nodes) and invoke node capabilities.

Related:

- Computers overview: [Computers](/nodes)
- Camera: [Camera devices](/nodes/camera)
- Images: [Image devices](/nodes/images)

Common options:

- `--url`, `--token`, `--timeout`, `--json`

## Common commands

```bash
alisio nodes list
alisio nodes list --connected
alisio nodes list --last-connected 24h
alisio nodes pending
alisio nodes approve <requestId>
alisio nodes status
alisio nodes status --connected
alisio nodes status --last-connected 24h
```

`nodes list` prints pending/paired tables. Paired rows include the most recent connect age (Last Connect).
Use `--connected` to only show currently-connected nodes. Use `--last-connected <duration>` to
filter to nodes that connected within a duration (e.g. `24h`, `7d`).

## Invoke

```bash
alisio nodes invoke --node <id|name|ip> --command <command> --params <json>
```

Invoke flags:

- `--params <json>`: JSON object string (default `{}`).
- `--invoke-timeout <ms>`: node invoke timeout (default `15000`).
- `--idempotency-key <key>`: optional idempotency key.
- `system.run` and `system.run.prepare` are blocked here; use the `exec` tool with `host=node` for shell execution.

For shell execution on a node, use the `exec` tool with `host=node` instead of `alisio nodes run`.
The `nodes` CLI is now capability-focused: direct RPC via `nodes invoke`, plus pairing, camera,
screen, location, canvas, and notifications.
