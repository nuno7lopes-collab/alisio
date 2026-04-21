---
summary: "Global voice wake words (Gateway-owned) and how they sync across computers"
read_when:
  - Changing voice wake words behavior or defaults
  - Adding new runtime platforms that need wake word sync
title: "Voice Wake"
---

# Voice Wake (Global Wake Words)

Alisio treats **wake words as a single global list** owned by the **Gateway**.

- There are **no per-node custom wake words**.
- **Any node/app UI may edit** the list; changes are persisted by the Gateway and broadcast to everyone.
- Runtime UIs can keep local **Voice Wake enabled/disabled** toggles when their local UX or permissions differ.

## Storage (Gateway host)

Wake words are stored on the gateway machine at:

- `~/.alisio/settings/voicewake.json`

Shape:

```json
{ "triggers": ["alisio", "claude", "computer"], "updatedAtMs": 1730000000000 }
```

## Protocol

### Methods

- `voicewake.get` → `{ triggers: string[] }`
- `voicewake.set` with params `{ triggers: string[] }` → `{ triggers: string[] }`

Notes:

- Triggers are normalized (trimmed, empties dropped). Empty lists fall back to defaults.
- Limits are enforced for safety (count/length caps).

### Events

- `voicewake.changed` payload `{ triggers: string[] }`

Who receives it:

- All WebSocket clients (macOS app, WebChat, etc.)
- All connected runtimes that implement Voice Wake, including the initial
  “current state” push on connect.

## Client behavior

### macOS app

- Uses the global list to gate `VoiceWakeRuntime` triggers.
- Editing “Trigger words” in Voice Wake settings calls `voicewake.set` and then relies on the broadcast to keep other clients in sync.

### Other runtime clients

- Any runtime that implements Voice Wake should consume the same global list.
- Editing wake words should call `voicewake.set` and then rely on the broadcast
  to keep other clients in sync.
