---
summary: "CLI reference for `alisio reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `alisio reset`

Reset local config/state (keeps the CLI installed).

```bash
alisio backup create
alisio reset
alisio reset --dry-run
alisio reset --scope config+creds+sessions --yes --non-interactive
```

Run `alisio backup create` first if you want a restorable snapshot before removing local state.
