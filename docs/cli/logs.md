---
summary: "CLI reference for `alisio logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `alisio logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
alisio logs
alisio logs --follow
alisio logs --json
alisio logs --limit 500
alisio logs --local-time
alisio logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.
