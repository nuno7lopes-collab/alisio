# Channel Product Surface

The sellable channel surface is intentionally limited to:

- `telegram`
- `whatsapp`
- `discord`

Product-facing status, setup, and health flows should only expose those three
channels as active choices. Other built-in or bundled channels can still exist
internally, but they should stay out of the default UX unless a specific flow
explicitly needs them.

## Hardening Expectations

- Runtime status must report actionable health for reconnecting, stopped, or
  stale accounts.
- Logging and audit output must redact sensitive values before they are stored
  or shown back to users.
- Inbound and outbound paths should keep rate limiting, debounce, or dedupe
  protections enabled.

## Minimum Setup UX

- Telegram: use `TELEGRAM_BOT_TOKEN` for the default account or per-account
  `botToken` / `tokenFile`.
- Discord: use `DISCORD_BOT_TOKEN` for the default account or a per-account
  token in config.
- WhatsApp: no env var is required; link with `openclaw channels login`.

Every missing-config or startup failure message should tell the operator what
to set or which command to run next.
