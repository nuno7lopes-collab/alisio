---
summary: "CLI reference for `alisio voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall call|continue|status|tail|expose`
title: "voicecall"
---

# `alisio voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:

- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
alisio voicecall status --call-id <id>
alisio voicecall call --to "+15555550123" --message "Hello" --mode notify
alisio voicecall continue --call-id <id> --message "Any questions?"
alisio voicecall end --call-id <id>
```

## Exposing webhooks (Tailscale)

```bash
alisio voicecall expose --mode serve
alisio voicecall expose --mode funnel
alisio voicecall expose --mode off
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.
