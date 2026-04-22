---
summary: "How the macOS app reports gateway/Baileys health states"
read_when:
  - Debugging mac app health indicators
title: "Health Checks (macOS)"
---

# Health Checks on macOS

How to see whether the linked channel is healthy from the menu bar app.

## Menu bar

- Status dot now reflects Baileys health:
  - Green: linked + socket opened recently.
  - Orange: connecting/retrying.
  - Red: logged out or probe failed.
- Secondary line reads "linked · auth 12m" or shows the failure reason.
- "Run Health Check" menu item triggers an on-demand probe.

## Settings

- General tab gains a Health card showing: linked auth age, session-store path/count, last check time, last error/status code, and buttons for Run Health Check / Reveal Logs.
- Uses a cached snapshot so the UI loads instantly and falls back gracefully when offline.
- **Channels tab** surfaces channel status + controls for WhatsApp/Telegram (login QR, logout, probe, last disconnect/error).

## How the probe works

- The packaged app probes the local Gateway over the native websocket control
  connection. It tries the `health` RPC first and accepts a successful `status`
  RPC as liveness while the Gateway is still finishing startup.
- Cache the last good snapshot and the last error separately to avoid flicker; show the timestamp of each.
- The native `chat.send` path runs a single local Gateway preflight before the
  RPC, with a slightly longer readiness window for cold starts, so first-message
  failures should surface as Gateway readiness errors instead of hanging.

## When in doubt

- Verify the packaged LaunchAgent and logs:

  ```bash
  /usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' ~/Library/LaunchAgents/ai.alisio.gateway.plist
  /usr/libexec/PlistBuddy -c 'Print :ProgramArguments:1' ~/Library/LaunchAgents/ai.alisio.gateway.plist
  launchctl print gui/$UID/ai.alisio.gateway | sed -n '1,120p'
  tail -n 120 ~/.alisio/logs/gateway.log
  tail -n 120 ~/.alisio/logs/gateway.err.log
  ```
