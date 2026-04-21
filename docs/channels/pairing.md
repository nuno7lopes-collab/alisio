---
summary: "Pairing overview: approve who can DM you + which computers can join"
read_when:
  - Setting up DM access control
  - Pairing a new computer
  - Reviewing Alisio security posture
title: "Pairing"
---

# Pairing

“Pairing” is Alisio’s explicit **owner approval** step.
It is used in two places:

1. **DM pairing** (who is allowed to talk to the bot)
2. **Computer pairing** (which computers are allowed to join the gateway workspace)

Security context: [Security](/gateway/security)

## 1) DM pairing (inbound chat access)

When a channel is configured with DM policy `pairing`, unknown senders get a short code and their message is **not processed** until you approve.

Default DM policies are documented in: [Security](/gateway/security)

Pairing codes:

- 8 characters, uppercase, no ambiguous chars (`0O1I`).
- **Expire after 1 hour**. The bot only sends the pairing message when a new request is created (roughly once per hour per sender).
- Pending DM pairing requests are capped at **3 per channel** by default; additional requests are ignored until one expires or is approved.

### Approve a sender

```bash
alisio pairing list telegram
alisio pairing approve telegram <CODE>
```

Supported channels: `bluebubbles`, `discord`, `feishu`, `googlechat`, `imessage`, `irc`, `line`, `matrix`, `mattermost`, `msteams`, `nextcloud-talk`, `nostr`, `alisio-weixin`, `signal`, `slack`, `synology-chat`, `telegram`, `twitch`, `whatsapp`, `zalo`, `zalouser`.

### Where the state lives

Stored under `~/.alisio/credentials/`:

- Pending requests: `<channel>-pairing.json`
- Approved allowlist store:
  - Default account: `<channel>-allowFrom.json`
  - Non-default account: `<channel>-<accountId>-allowFrom.json`

Account scoping behavior:

- Non-default accounts read/write only their scoped allowlist file.
- Default account uses the channel-scoped unscoped allowlist file.

Treat these as sensitive (they gate access to your assistant).

## 2) Computer pairing (macOS/headless runtimes)

Runtime computers connect to the Gateway as **devices** with `role: node`. The
Gateway creates a computer pairing request that must be approved.

### Pair via Telegram

If you use the `device-pair` plugin, you can do first-time computer pairing entirely from Telegram:

1. In Telegram, message your bot: `/pair`
2. The bot replies with two messages: an instruction message and a separate **setup code** message (easy to copy/paste in Telegram).
3. Open the Alisio app on the computer you want to pair.
4. Paste the setup code and connect.
5. Back in Telegram: `/pair pending` (review request IDs, role, and scopes), then approve.

The setup code is a base64-encoded JSON payload that contains:

- `url`: the Gateway WebSocket URL (`ws://...` or `wss://...`)
- `bootstrapToken`: a short-lived single-device bootstrap token used for the initial pairing handshake

Treat the setup code like a password while it is valid.

### Approve a computer

```bash
alisio devices list
alisio devices approve <requestId>
alisio devices reject <requestId>
```

If the same computer retries with different auth details (for example different
role/scopes/public key), the previous pending request is superseded and a new
`requestId` is created.

### Computer pairing state storage

Stored under `~/.alisio/devices/`:

- `pending.json` (short-lived; pending requests expire)
- `paired.json` (paired computers + tokens)

### Notes

- The legacy `node.pair.*` API (CLI: `alisio nodes pending/approve`) is a
  separate gateway-owned compatibility store. Current WS runtime computers still
  use the main `alisio devices ...` pairing flow.

## Related docs

- Security model + prompt injection: [Security](/gateway/security)
- Updating safely (run doctor): [Updating](/install/updating)
- Channel configs:
  - Telegram: [Telegram](/channels/telegram)
  - WhatsApp: [WhatsApp](/channels/whatsapp)
  - Signal: [Signal](/channels/signal)
  - BlueBubbles (iMessage): [BlueBubbles](/channels/bluebubbles)
  - iMessage (legacy): [iMessage](/channels/imessage)
  - Discord: [Discord](/channels/discord)
  - Slack: [Slack](/channels/slack)
