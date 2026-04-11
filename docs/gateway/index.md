---
summary: "Runbook for the Gateway service, lifecycle, and operations"
read_when:
  - Running or debugging the gateway process
title: "Gateway Runbook"
---

# Gateway runbook

Use this page for day-1 startup and day-2 operations of the Gateway service.

<CardGroup cols={2}>
  <Card title="Deep troubleshooting" icon="siren" href="/gateway/troubleshooting">
    Symptom-first diagnostics with exact command ladders and log signatures.
  </Card>
  <Card title="Configuration" icon="sliders" href="/gateway/configuration">
    Task-oriented setup guide + full configuration reference.
  </Card>
  <Card title="Secrets management" icon="key-round" href="/gateway/secrets">
    SecretRef contract, runtime snapshot behavior, and migrate/reload operations.
  </Card>
  <Card title="Secrets plan contract" icon="shield-check" href="/gateway/secrets-plan-contract">
    Exact `secrets apply` target/path rules and ref-only auth-profile behavior.
  </Card>
</CardGroup>

## 5-minute local startup

<Steps>
  <Step title="Start the Gateway">

```bash
alisio gateway run --port 40705
# debug/trace mirrored to stdio
alisio gateway run --port 40705 --verbose
# force-kill listener on selected port, then start
alisio gateway run --force
```

  </Step>

  <Step title="Verify service health">

```bash
alisio gateway status
alisio status
alisio logs --follow
```

Healthy baseline: `Runtime: running` and `RPC probe: ok`.

  </Step>

  <Step title="Validate channel readiness">

```bash
alisio channels status --probe
```

  </Step>
</Steps>

<Note>
Gateway config reload watches the active config file path (resolved from profile/state defaults, or `ALISIO_CONFIG_PATH` when set).
Default mode is `gateway.reload.mode="hybrid"`.
After the first successful load, the running process serves the active in-memory config snapshot; successful reload swaps that snapshot atomically.
</Note>

## Runtime model

- One always-on process for routing, control plane, and channel connections.
- Single multiplexed port for:
  - WebSocket control/RPC
  - HTTP APIs, OpenAI compatible (`/v1/models`, `/v1/embeddings`, `/v1/chat/completions`, `/v1/responses`, `/tools/invoke`)
  - Control UI and hooks
- Default bind mode: `loopback`.
- Auth is required by default (`gateway.auth.token` / `gateway.auth.password`, or `ALISIO_GATEWAY_TOKEN` / `ALISIO_GATEWAY_PASSWORD`).

## OpenAI-compatible endpoints

Alisio’s highest-leverage compatibility surface is now:

- `GET /v1/models`
- `GET /v1/models/{id}`
- `POST /v1/embeddings`
- `POST /v1/chat/completions`
- `POST /v1/responses`

Why this set matters:

- Most Open WebUI, LobeChat, and LibreChat integrations probe `/v1/models` first.
- Many RAG and memory pipelines expect `/v1/embeddings`.
- Agent-native clients increasingly prefer `/v1/responses`.

Planning note:

- `/v1/models` is agent-first: it returns `alisio`, `alisio/default`, and `alisio/<agentId>`.
- `alisio/default` is the stable alias that always maps to the configured default agent.
- Use `x-alisio-model` when you want a backend provider/model override; otherwise the selected agent's normal model and embedding setup stays in control.

All of these run on the main Gateway port and use the same trusted operator auth boundary as the rest of the Gateway HTTP API.

### Port and bind precedence

| Setting      | Resolution order                                            |
| ------------ | ----------------------------------------------------------- |
| Gateway port | `--port` → `ALISIO_GATEWAY_PORT` → `gateway.port` → `40705` |
| Bind mode    | CLI/override → `gateway.bind` → `loopback`                  |

### Hot reload modes

| `gateway.reload.mode` | Behavior                                   |
| --------------------- | ------------------------------------------ |
| `off`                 | No config reload                           |
| `hot`                 | Apply only hot-safe changes                |
| `restart`             | Restart on reload-required changes         |
| `hybrid` (default)    | Hot-apply when safe, restart when required |

## Operator command set

```bash
alisio gateway status
alisio gateway status --deep
alisio gateway status --json
alisio gateway install
alisio gateway restart
alisio gateway stop
alisio secrets reload
alisio logs --follow
alisio doctor
```

## Remote access

Preferred: Tailscale/VPN.
Fallback: SSH tunnel.

```bash
ssh -N -L 40705:127.0.0.1:40705 user@host
```

Then connect clients to `ws://127.0.0.1:40705` locally.

<Warning>
If gateway auth is configured, clients still must send auth (`token`/`password`) even over SSH tunnels.
</Warning>

See: [Remote Gateway](/gateway/remote), [Authentication](/gateway/authentication), [Tailscale](/gateway/tailscale).

## Supervision and service lifecycle

Use supervised runs for production-like reliability.

<Tabs>
  <Tab title="macOS (launchd)">

```bash
alisio gateway install
alisio gateway status
alisio gateway restart
alisio gateway stop
```

LaunchAgent labels are `ai.alisio.gateway` (default) or `ai.alisio.<profile>` (named profile). `alisio doctor` audits and repairs service config drift.

  </Tab>

  <Tab title="Linux (systemd user)">

```bash
alisio gateway install
systemctl --user enable --now alisio-gateway[-<profile>].service
alisio gateway status
```

For persistence after logout, enable lingering:

```bash
sudo loginctl enable-linger <user>
```

  </Tab>

  <Tab title="Linux (system service)">

Use a system unit for multi-user/always-on hosts.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now alisio-gateway[-<profile>].service
```

  </Tab>
</Tabs>

## Multiple gateways on one host

Most setups should run **one** Gateway.
Use multiple only for strict isolation/redundancy (for example a rescue profile).

Checklist per instance:

- Unique `gateway.port`
- Unique `ALISIO_CONFIG_PATH`
- Unique `ALISIO_STATE_DIR`
- Unique `agents.defaults.workspace`

Example:

```bash
ALISIO_CONFIG_PATH=~/.alisio/a.json ALISIO_STATE_DIR=~/.alisio-a alisio gateway run --port 19001
ALISIO_CONFIG_PATH=~/.alisio/b.json ALISIO_STATE_DIR=~/.alisio-b alisio gateway run --port 19002
```

See: [Multiple gateways](/gateway/multiple-gateways).

### Dev profile quick path

```bash
alisio --dev setup
alisio --dev gateway run --allow-unconfigured
alisio --dev status
```

Defaults include isolated state/config and base gateway port `19001`.

## Protocol quick reference (operator view)

- First client frame must be `connect`.
- Gateway returns `hello-ok` snapshot (`presence`, `health`, `stateVersion`, `uptimeMs`, limits/policy).
- Requests: `req(method, params)` → `res(ok/payload|error)`.
- Common events: `connect.challenge`, `agent`, `chat`, `presence`, `tick`, `health`, `heartbeat`, `shutdown`.

Agent runs are two-stage:

1. Immediate accepted ack (`status:"accepted"`)
2. Final completion response (`status:"ok"|"error"`), with streamed `agent` events in between.

See full protocol docs: [Gateway Protocol](/gateway/protocol).

## Operational checks

### Liveness

- Open WS and send `connect`.
- Expect `hello-ok` response with snapshot.

### Readiness

```bash
alisio gateway status
alisio channels status --probe
alisio health
```

### Gap recovery

Events are not replayed. On sequence gaps, refresh state (`health`, `system-presence`) before continuing.

## Common failure signatures

| Signature                                                      | Likely issue                             |
| -------------------------------------------------------------- | ---------------------------------------- |
| `refusing to bind gateway ... without auth`                    | Non-loopback bind without token/password |
| `another gateway instance is already listening` / `EADDRINUSE` | Port conflict                            |
| `Gateway start blocked: set gateway.mode=local`                | Config set to remote mode                |
| `unauthorized` during connect                                  | Auth mismatch between client and gateway |

For full diagnosis ladders, use [Gateway Troubleshooting](/gateway/troubleshooting).

## Safety guarantees

- Gateway protocol clients fail fast when Gateway is unavailable (no implicit direct-channel fallback).
- Invalid/non-connect first frames are rejected and closed.
- Graceful shutdown emits `shutdown` event before socket close.

---

Related:

- [Troubleshooting](/gateway/troubleshooting)
- [Background Process](/gateway/background-process)
- [Configuration](/gateway/configuration)
- [Health](/gateway/health)
- [Doctor](/gateway/doctor)
- [Authentication](/gateway/authentication)
