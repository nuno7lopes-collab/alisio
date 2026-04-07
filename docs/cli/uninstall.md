---
summary: "CLI reference for `alisio uninstall` (remove gateway service + local data)"
read_when:
  - You want to remove the gateway service and/or local state
  - You want a dry-run first
title: "uninstall"
---

# `alisio uninstall`

Uninstall the gateway service + local data (CLI remains).

```bash
alisio backup create
alisio uninstall
alisio uninstall --all --yes
alisio uninstall --dry-run
```

Run `alisio backup create` first if you want a restorable snapshot before removing state or workspaces.
