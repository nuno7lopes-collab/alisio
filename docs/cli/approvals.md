---
summary: "CLI reference for `alisio approvals` (exec approvals for gateway or node hosts)"
read_when:
  - You want to edit exec approvals from the CLI
  - You need to manage allowlists on gateway or node hosts
title: "approvals"
---

# `alisio approvals`

Manage exec approvals for the **local host**, **gateway host**, or a **node host**.
By default, commands target the local approvals file on disk. Use `--gateway` to target the gateway, or `--node` to target a specific node.

Related:

- Exec approvals: [Exec approvals](/tools/exec-approvals)
- Nodes: [Nodes](/nodes)

## Common commands

```bash
alisio approvals get
alisio approvals get --node <id|name|ip>
alisio approvals get --gateway
```

## Replace approvals from a file

```bash
alisio approvals set --file ./exec-approvals.json
alisio approvals set --node <id|name|ip> --file ./exec-approvals.json
alisio approvals set --gateway --file ./exec-approvals.json
```

## Allowlist helpers

```bash
alisio approvals allowlist add "~/Projects/**/bin/rg"
alisio approvals allowlist add --agent main --node <id|name|ip> "/usr/bin/uptime"
alisio approvals allowlist add --agent "*" "/usr/bin/uname"

alisio approvals allowlist remove "~/Projects/**/bin/rg"
```

## Notes

- `--node` uses the same resolver as `alisio nodes` (id, name, ip, or id prefix).
- `--agent` defaults to `"*"`, which applies to all agents.
- The node host must advertise `system.execApprovals.get/set` (macOS app or headless node host).
- Approvals files are stored per host at `~/.alisio/exec-approvals.json`.
