---
summary: "CLI reference for `alisio node` (headless node host)"
read_when:
  - Running the headless node host
  - Pairing a non-macOS node for system.run
title: "node"
---

# `alisio node`

Run a **headless node host** that connects to the Gateway WebSocket and exposes
`system.run` / `system.which` on this machine.

## Why use a node host?

Use a node host when you want agents to **run commands on other machines** in your
network without installing a full macOS companion app there.

Common use cases:

- Run commands on remote Linux/Windows boxes (build servers, lab machines, NAS).
- Keep exec **sandboxed** on the gateway, but delegate approved runs to other hosts.
- Provide a lightweight, headless execution target for automation or CI nodes.

Execution is still guarded by **exec approvals** and per‑agent allowlists on the
node host, so you can keep command access scoped and explicit.

## Browser proxy (zero-config)

Node hosts automatically advertise a browser proxy if `browser.enabled` is not
disabled on the node. This lets the agent use browser automation on that node
without extra configuration.

By default, the proxy exposes the node's normal browser profile surface. If you
set `nodeHost.browserProxy.allowProfiles`, the proxy becomes restrictive:
non-allowlisted profile targeting is rejected, and persistent profile
create/delete routes are blocked through the proxy.

Disable it on the node if needed:

```json5
{
  nodeHost: {
    browserProxy: {
      enabled: false,
    },
  },
}
```

## Run (foreground)

```bash
alisio node run --host <gateway-host> --port 40705
```

Options:

- `--host <host>`: Gateway WebSocket host (default: `127.0.0.1`)
- `--port <port>`: Gateway WebSocket port (default: `40705`)
- `--tls`: Use TLS for the gateway connection
- `--tls-fingerprint <sha256>`: Expected TLS certificate fingerprint (sha256)
- `--node-id <id>`: Override node id (clears pairing token)
- `--display-name <name>`: Override the node display name

## Gateway auth for node host

`alisio node run` and `alisio node install` resolve gateway auth from config/env (no `--token`/`--password` flags on node commands):

- `ALISIO_GATEWAY_TOKEN` / `ALISIO_GATEWAY_PASSWORD` are checked first.
- Then local config fallback: `gateway.auth.token` / `gateway.auth.password`.
- In local mode, node host intentionally does not inherit `gateway.remote.token` / `gateway.remote.password`.
- If `gateway.auth.token` / `gateway.auth.password` is explicitly configured via SecretRef and unresolved, node auth resolution fails closed (no remote fallback masking).
- In `gateway.mode=remote`, remote client fields (`gateway.remote.token` / `gateway.remote.password`) are also eligible per remote precedence rules.
- Node host auth resolution only honors `ALISIO_GATEWAY_*` env vars.

## Service (background)

Install a headless node host as a user service.

```bash
alisio node install --host <gateway-host> --port 40705
```

Options:

- `--host <host>`: Gateway WebSocket host (default: `127.0.0.1`)
- `--port <port>`: Gateway WebSocket port (default: `40705`)
- `--tls`: Use TLS for the gateway connection
- `--tls-fingerprint <sha256>`: Expected TLS certificate fingerprint (sha256)
- `--node-id <id>`: Override node id (clears pairing token)
- `--display-name <name>`: Override the node display name
- `--runtime <runtime>`: Service runtime (`node` or `bun`)
- `--force`: Reinstall/overwrite if already installed

Manage the service:

```bash
alisio node status
alisio node stop
alisio node restart
alisio node uninstall
```

Use `alisio node run` for a foreground node host (no service).

Service commands accept `--json` for machine-readable output.

## Pairing

The first connection creates a pending device pairing request (`role: node`) on the Gateway.
Approve it via:

```bash
alisio devices list
alisio devices approve <requestId>
```

If the node retries pairing with changed auth details (role/scopes/public key),
the previous pending request is superseded and a new `requestId` is created.
Run `alisio devices list` again before approval.

The node host stores its node id, token, display name, and gateway connection info in
`~/.alisio/node.json`.

## Exec approvals

`system.run` is gated by local exec approvals:

- `~/.alisio/exec-approvals.json`
- [Exec approvals](/tools/exec-approvals)
- `alisio approvals --node <id|name|ip>` (edit from the Gateway)
