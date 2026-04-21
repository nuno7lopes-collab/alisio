---
summary: "Gateway lifecycle on macOS (launchd)"
read_when:
  - Integrating the mac app with the gateway lifecycle
title: "Gateway Lifecycle"
---

# Gateway lifecycle on macOS

The macOS app **manages the Gateway via launchd** by default and does not spawn
the Gateway as a child process. It first tries to attach to an already‑running
Gateway on the configured port; if none is reachable, it enables the launchd
service via the external `alisio` CLI (no embedded runtime). This gives you
reliable auto‑start at login and restart on crashes.

Child‑process mode (Gateway spawned directly by the app) is **not in use** today.
If you need a faster dev loop, run the Gateway manually in a terminal and let the app attach to it.

## Default behavior (launchd)

- The app installs a per‑user LaunchAgent labeled `ai.alisio.gateway`
  (or `ai.alisio.<profile>` when using `--profile`/`ALISIO_PROFILE`; legacy `com.alisio.*` is supported).
- When Local mode is enabled, the app ensures the LaunchAgent is loaded and
  starts the Gateway if needed.
- Logs are written to the launchd gateway log path (visible in Debug Settings).

Common commands:

```bash
launchctl kickstart -k gui/$UID/ai.alisio.gateway
launchctl bootout gui/$UID/ai.alisio.gateway
```

Replace the label with `ai.alisio.<profile>` when running a named profile.

## Lightweight dev loop

For day-to-day development, let the app attach to a manually started Gateway:

```bash
pnpm mac:dev:gateway
pnpm mac:dev:app
```

Why this is the fast path:

- the Gateway reloads in watch mode
- the native app bundle stays stable at `.run/Alisio.app`
- you avoid rebuilding and repackaging the app bundle on every edit

If you are iterating on native UI or app-runtime behavior, use Xcode Run/Debug for the app side and keep the Gateway watch loop running separately.

## Heavy bundle restart

`pnpm mac:bundle:restart` is the heavy path. It packages a real `.app` bundle, validates it, and relaunches it.

Use it when you need to validate:

- launchd behavior
- real bundle startup
- signing and entitlements
- TCC and permission prompts
- packaging-adjacent smoke

`pnpm mac:bundle:restart:no-sign` forces ad-hoc signing. That is acceptable for quick smoke, but it is the wrong path for permission and TCC debugging.

## Attach-only mode

To force the macOS app to **never install or manage launchd**, launch it with
`--attach-only` (or `--no-launchd`). This sets `~/.alisio/disable-launchagent`,
so the app only attaches to an already running Gateway. You can toggle the same
behavior in Debug Settings.

Use attach-only only when you explicitly want to prevent launchd side effects.
It is not required for the normal lightweight loop because the app already prefers an existing Gateway on the configured port.

## Remote mode

Remote mode never starts a local Gateway. The app uses an SSH tunnel to the
remote host and connects over that tunnel.

## Why we prefer launchd

- Auto‑start at login.
- Built‑in restart/KeepAlive semantics.
- Predictable logs and supervision.

If a true child‑process mode is ever needed again, it should be documented as a
separate, explicit dev‑only mode.
