---
summary: "How the native macOS workspace talks to the gateway and how to debug it"
read_when:
  - Debugging the native macOS workspace or its loopback port
title: "Workspace (macOS)"
---

# Workspace (macOS app)

The macOS app now uses a **native SwiftUI workspace shell** for the main
product surface. Chat, navigation, settings, and the right inspector pane all
live in the native host. WebKit is only kept for narrow technical surfaces such
as Canvas, not as the primary workspace shell.

The workspace connects to the Gateway and defaults to the **main session** for
the selected agent, with a native session switcher for other sessions.

- **Local mode**: connects directly to the local Gateway WebSocket.
- **Remote mode**: forwards the Gateway control port over SSH and uses that
  tunnel as the data plane.
- **Inspector pane**: opens on real session activity and shows run state, tool
  output, and `computer use` when the runtime is local.

## Launch & debugging

- Manual: menu bar → **Open Alisio**.
- Auto‑open for testing:

  ```bash
  dist/Alisio.app/Contents/MacOS/Alisio --chat
  ```

- Logs: `./scripts/alisio-log.sh` (subsystem `ai.alisio`, categories such as `workspace`, `desktop.chat.transport`, and `gateway-endpoint`).

## How it is wired

- Data plane: Gateway WS methods `chat.history`, `chat.send`, `chat.abort`,
  `chat.inject` and events `chat`, `agent`, `presence`, `tick`, `health`.
- Session: defaults to the primary session (`main`, or `global` when scope is
  global). The UI can switch between sessions.
- Onboarding uses a dedicated session to keep first‑run setup separate.
- The first message path shows honest bootstrap state while session history,
  health, and models are loading, instead of leaving the window in a blank
  thinking state.

## Security surface

- Remote mode forwards only the Gateway WebSocket control port over SSH.

## Known limitations

- The workspace is optimized for chat and native desktop control, not a browser
  sandbox.
