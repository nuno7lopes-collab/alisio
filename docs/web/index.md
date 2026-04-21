---
summary: "Legacy browser admin surfaces for the Gateway: compatibility, bind modes, and security"
read_when:
  - You want to access the Gateway over Tailscale
  - You still rely on the legacy browser admin surface
title: "Browser Surfaces (Legacy)"
---

# Browser Surfaces (Legacy)

The Gateway still serves a small **browser admin surface** (Vite + Lit) from
the same port as the Gateway WebSocket, but it is no longer the primary product
face.

Use these pages when you need legacy browser access, remote recovery, or
Gateway admin work. For the main product story, start with the macOS app today
and treat Windows as foundation work in progress.

Current browser endpoint:

- default: `http://<host>:40705/`
- optional prefix: set `gateway.controlUi.basePath` (e.g. `/alisio`)

Operational details live in [Control UI](/web/control-ui).
This page focuses on bind modes, security, and compatibility browser surfaces.

## Webhooks

When `hooks.enabled=true`, the Gateway also exposes a small webhook endpoint on the same HTTP server.
See [Gateway configuration](/gateway/configuration) → `hooks` for auth + payloads.

## Compatibility config

The browser admin surface is **enabled by default** when assets are present
(`dist/control-ui`).
You can control it via config:

```json5
{
  gateway: {
    controlUi: { enabled: true, basePath: "/alisio" }, // basePath optional
  },
}
```

## Tailscale access

### Integrated Serve (recommended)

Keep the Gateway on loopback and let Tailscale Serve proxy it:

```json5
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "serve" },
  },
}
```

Then start the gateway:

```bash
alisio gateway
```

Open:

- `https://<magicdns>/` (or your configured `gateway.controlUi.basePath`)

### Tailnet bind + token

```json5
{
  gateway: {
    bind: "tailnet",
    controlUi: { enabled: true },
    auth: { mode: "token", token: "your-token" },
  },
}
```

Then start the gateway (token required for non-loopback binds):

```bash
alisio gateway
```

Open:

- `http://<tailscale-ip>:40705/` (or your configured `gateway.controlUi.basePath`)

### Public internet (Funnel)

```json5
{
  gateway: {
    bind: "loopback",
    tailscale: { mode: "funnel" },
    auth: { mode: "password" }, // or ALISIO_GATEWAY_PASSWORD
  },
}
```

## Security notes

- Gateway auth is required by default (token/password or Tailscale identity headers).
- Non-loopback binds still **require** a shared token/password (`gateway.auth` or env).
- The wizard generates a gateway token by default (even on loopback).
- The UI sends `connect.params.auth.token` or `connect.params.auth.password`.
- For non-loopback Control UI deployments, set `gateway.controlUi.allowedOrigins`
  explicitly (full origins). Without it, gateway startup is refused by default.
- `gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback=true` enables
  Host-header origin fallback mode, but is a dangerous security downgrade.
- With Serve, Tailscale identity headers can satisfy Control UI/WebSocket auth
  when `gateway.auth.allowTailscale` is `true` (no token/password required).
  HTTP API endpoints still require token/password. Set
  `gateway.auth.allowTailscale: false` to require explicit credentials. See
  [Tailscale](/gateway/tailscale) and [Security](/gateway/security). This
  tokenless flow assumes the gateway host is trusted.
- `gateway.tailscale.mode: "funnel"` requires `gateway.auth.mode: "password"` (shared password).

## Building the browser assets

The Gateway serves static files from `dist/control-ui`. Build them with:

```bash
pnpm ui:build # auto-installs UI deps on first run
```
