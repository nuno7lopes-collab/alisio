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

If you intentionally build without the bundled runtime during development, use
the dev setup flow to point the app at a local checkout or CLI install.

## Local mode in release builds

- `Alisio.app` carries the Gateway package in `Contents/Resources/alisio-package`
- release packaging embeds a compatible Node runtime (`>=22.16.0`) in
  `Contents/Resources/alisio-package/tools/node/bin/node`
- launchd starts the bundled Node plus the bundled `alisio.mjs` entrypoint for
  Local mode
- if a compatible local Gateway is already listening on the configured port, the app attaches to it instead of starting a duplicate

The real packaged LaunchAgent should look like this:

```text
ProgramArguments = (
  ".../Alisio.app/Contents/Resources/alisio-package/tools/node/bin/node",
  ".../Alisio.app/Contents/Resources/alisio-package/alisio.mjs",
  "gateway",
  "run",
  "--port",
  "40705"
)
```

If it points at a checkout path such as `src/entry.ts`, `pnpm`, or a repo-local
`node_modules/.bin/alisio`, rebuild the app bundle and reinstall the LaunchAgent.

## External CLI fallback (debug / development only)

If you intentionally build without the bundled runtime, install `alisio`
globally and let the app target that runtime instead:

```bash
npm install -g alisio@npm:alisio@<version>
```

The macOS app's **Install CLI** button exists for this fallback path.

## Launchd (Gateway as LaunchAgent)

Label:

- `ai.alisio.gateway`

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

- launchd stdout/err: `~/.alisio/logs/gateway.log` and `~/.alisio/logs/gateway.err.log`

## Local scheduling

In Local mode, the macOS app manages the `Schedules` surface through the
local Gateway control RPCs. Those actions require the signed-in Alisio account.
The app preflights the local Gateway before list, add, update, enable/disable,
manual run, heartbeat read, and heartbeat toggle calls, then surfaces the real
account or gateway error if the runtime is cold, offline, or restarting.

The native first-message path (`chat.send`) also preflights the local Gateway
before issuing the RPC and uses a longer readiness window for cold starts, so
the user sees a readiness failure instead of a silent hang when the bundled
runtime is still booting.

The default cron store is account scoped under the Alisio data directory:
`accounts/<account>/cron/jobs.json`. A signed-out Gateway uses an auth-required
scope with the scheduler disabled, so stored jobs from a previous account do not
continue running after sign-out.

See [Cron vs Heartbeat](/automation/cron-vs-heartbeat) for the scheduling model.

## Version compatibility

The macOS app checks the gateway version against its own version.

- bundled release builds should stay in lockstep automatically
- if you are using the external CLI fallback, update the global CLI to match the app version

## Packaged app release smoke

Use the heavy restart path for the final packaged-app QA bar:

```bash
scripts/restart-mac.sh
```

Preconditions:

- Local mode selected in the macOS app
- Attach-only disabled
- real signing identity in use

What the script proves automatically:

- packages a real `.app` bundle at `.run/Alisio.app`
- validates the bundle structure, signature, and bundled Node runtime
- opens the rebuilt bundle and waits for the first real window
- waits for the LaunchAgent plist to appear
- verifies `ProgramArguments:0` and `ProgramArguments:1` point at the bundled
  Node and bundled entrypoint inside that app bundle
- waits for `launchctl print gui/$UID/ai.alisio.gateway`
- waits for bundled `gateway call health` or `gateway call status`
- runs `launchctl kickstart -k` and waits for `health` or `status` again

What still stays manual:

- send one real first message from the packaged workspace and confirm the first
  assistant event arrives without a blank window, second reopen, or manual
  reconnect

If the script fails because the LaunchAgent never appears, treat that as a real
gap in Local mode readiness first. The common causes are:

- the app is still configured for remote mode
- attach-only is enabled
- the bundle is ad-hoc signed and you are trying to debug TCC or release wiring

Manual follow-up commands, only when the smoke fails or you need extra detail:

```bash
.run/Alisio.app/Contents/Resources/alisio-package/tools/node/bin/node -p 'process.execPath'
/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' ~/Library/LaunchAgents/ai.alisio.gateway.plist
/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:1' ~/Library/LaunchAgents/ai.alisio.gateway.plist
launchctl print gui/$UID/ai.alisio.gateway | sed -n '1,120p'
tail -n 120 ~/.alisio/logs/gateway.log
tail -n 120 ~/.alisio/logs/gateway.err.log
```
