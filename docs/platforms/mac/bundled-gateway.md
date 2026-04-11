---
summary: "Gateway runtime on macOS (bundled app runtime with launchd)"
read_when:
  - Packaging Alisio.app
  - Debugging the macOS gateway launchd service
  - Installing the gateway CLI for macOS
title: "Gateway on macOS"
---

# Gateway on macOS (bundled runtime)

Release builds of `Alisio.app` bundle the local Gateway runtime inside the app
package and manage a per-user launchd service for Local mode. The app still
prefers attaching to an already-running compatible Gateway when it finds one,
but a consumer install should not require a separate CLI or Node install.

Debug or development builds can still fall back to an external `alisio` CLI
install when the bundled runtime is intentionally skipped.

## Local mode in release builds

- `Alisio.app` carries the Gateway package in `Contents/Resources/alisio-package`
- release packaging should also embed a compatible Node runtime (`>=22.16.0`)
- launchd starts the bundled runtime for Local mode
- if a compatible local Gateway is already listening on the configured port, the app attaches to it instead of starting a duplicate

## External CLI fallback (debug / development only)

If you intentionally build without the bundled runtime, install `alisio`
globally and let the app target that runtime instead:

```bash
npm install -g alisio@npm:alisio@<version>
```

The macOS app's **Install CLI** button exists for this fallback path.

## Launchd (Gateway as LaunchAgent)

Label:

- `ai.alisio.gateway` (or `ai.alisio.<profile>`; legacy `com.alisio.*` may remain)

Plist location (per‑user):

- `~/Library/LaunchAgents/ai.alisio.gateway.plist`
  (or `~/Library/LaunchAgents/ai.alisio.<profile>.plist`)

Manager:

- The macOS app owns LaunchAgent install/update in Local mode.
- The CLI can also install it: `alisio gateway install`.

Behavior:

- "Alisio Active" enables/disables the LaunchAgent.
- App quit does **not** stop the gateway (launchd keeps it alive).
- If a Gateway is already running on the configured port, the app attaches to
  it instead of starting a new one.

Logging:

- launchd stdout/err: `/tmp/alisio/alisio-gateway.log`

## Version compatibility

The macOS app checks the gateway version against its own version.

- bundled release builds should stay in lockstep automatically
- if you are using the external CLI fallback, update the global CLI to match the app version

## Smoke check (fallback CLI flow)

```bash
alisio --version

ALISIO_SKIP_CHANNELS=1 \
ALISIO_SKIP_CANVAS_HOST=1 \
alisio gateway run --port 18999 --bind loopback
```

Then:

```bash
alisio gateway call health --url ws://127.0.0.1:18999 --timeout 3000
```
