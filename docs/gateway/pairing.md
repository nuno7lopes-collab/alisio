---
summary: "Legacy gateway-owned pairing compatibility for `node.pair.*` clients"
read_when:
  - Maintaining or debugging the legacy `node.pair.*` flow
  - Verifying compatibility for older runtime clients
  - Extending gateway protocol compatibility around node management
title: "Gateway Pairing Compatibility"
---

# Gateway pairing compatibility

This page documents the legacy **`node.pair.*` compatibility flow**.

It is **not** the primary pairing path for current Alisio computers. Current
runtime pairing happens through the main device-pairing flow (`alisio devices
...`) during `connect`.

The **Gateway** remains the source of truth for this compatibility store. UIs
and tools are just frontends that approve or reject pending requests.

**Important:** WS runtime computers use **device pairing** (role `node`) during
`connect`. `node.pair.*` is a separate pairing store and does **not** gate the
WS handshake. Only clients that explicitly call `node.pair.*` use this flow.

## Concepts

- **Pending request**: a runtime computer asked to join through the legacy flow; requires approval.
- **Paired node**: approved runtime computer with an issued compatibility auth token.
- **Transport**: the Gateway WS endpoint forwards requests but does not decide
  membership. (Legacy TCP bridge support is deprecated/removed.)

## How pairing works

1. A runtime computer calls the legacy pairing request.
2. The Gateway stores a **pending request** and emits `node.pair.requested`.
3. You approve or reject the request (CLI or UI).
4. On approval, the Gateway issues a **new token** (tokens are rotated on re‑pair).
5. The runtime computer reconnects using the token and is now “paired” in this compatibility store.

Pending requests expire automatically after **5 minutes**.

## CLI workflow (compatibility / headless friendly)

```bash
alisio nodes pending
alisio nodes approve <requestId>
alisio nodes reject <requestId>
alisio nodes status
alisio nodes rename --node <id|name|ip> --name "Living Room Mac"
```

`nodes status` shows paired and connected runtime entries plus their capabilities.

## API surface (gateway protocol)

Events:

- `node.pair.requested` — emitted when a new pending request is created.
- `node.pair.resolved` — emitted when a request is approved/rejected/expired.

Methods:

- `node.pair.request` — create or reuse a pending request.
- `node.pair.list` — list pending + paired nodes.
- `node.pair.approve` — approve a pending request (issues token).
- `node.pair.reject` — reject a pending request.
- `node.pair.verify` — verify `{ nodeId, token }`.

Notes:

- `node.pair.request` is idempotent per runtime entry: repeated calls return the same
  pending request.
- Approval **always** generates a fresh token; no token is ever returned from
  `node.pair.request`.
- Requests may include `silent: true` as a hint for auto-approval flows.

## Auto-approval (macOS app)

The macOS app can optionally attempt a **silent approval** when:

- the request is marked `silent`, and
- the app can verify an SSH connection to the gateway host using the same user.

If silent approval fails, it falls back to the normal “Approve/Reject” prompt.

## Storage (local, private)

Pairing state is stored under the Gateway state directory (default `~/.alisio`):

- `~/.alisio/nodes/paired.json`
- `~/.alisio/nodes/pending.json`

If you override `ALISIO_STATE_DIR`, the `nodes/` folder moves with it.

Security notes:

- Tokens are secrets; treat `paired.json` as sensitive.
- Rotating a token requires re-approval (or deleting the node entry).

## Transport behavior

- The transport is **stateless**; it does not store membership.
- If the Gateway is offline or pairing is disabled, legacy `node.pair.*`
  clients cannot pair.
- If the Gateway is in remote mode, compatibility pairing still happens against
  the remote Gateway’s store.
