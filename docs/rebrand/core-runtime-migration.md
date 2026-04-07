---
title: "Core Runtime Migration"
summary: "How the core runtime moves existing installs from the legacy state layout to the new Alisio layout."
---

# Core Runtime Migration

The core runtime now defaults to the Alisio state layout:

- state directory: `~/.alisio`
- default config file: `~/.alisio/alisio.json`
- default log file: `~/.alisio/logs/alisio.log`

## First Run Migration

If an existing install still uses the previous layout (legacy state directory + config file), the gateway migrates it automatically on first start.

The migration is designed to be idempotent and conservative:

1. Copy the legacy state tree into a staging directory under the new root.
2. Verify the copied tree before switching over.
3. Rename the copied config file to `alisio.json`.
4. Move the old directory aside to a timestamped backup such as `~/.alisio.backup-<timestamp>`.
5. Promote the staged copy to `~/.alisio`.

If the new root already exists, the migration step is skipped safely.

## Environment Variable Compatibility

The runtime now prefers `ALISIO_*` environment variables.

For one compatibility release, the runtime still reads matching legacy variables as fallback input when a new `ALISIO_*` value is not present. The runtime does not write legacy names back out.

Examples of the updated primary variables include:

- `ALISIO_HOME`
- `ALISIO_STATE_DIR`
- `ALISIO_CONFIG_PATH`
- `ALISIO_OAUTH_DIR`
- `ALISIO_GATEWAY_PORT`
- `ALISIO_UPDATE_*`

## Browser OAuth Storage Migration

Browser-facing OAuth helpers now migrate persisted state on read:

- read the old localStorage key or BroadcastChannel name if it exists
- rewrite the value under the new Alisio key
- remove the old key after a successful rewrite

This keeps existing sign-ins working while stopping new writes to the legacy storage names.

## Current Status

- The AG2 ownership surface for core runtime paths/env/storage keys is now clean: the requested audit grep returns zero matches under `src/config/**`, `src/shared/**`, `src/infra/**`, `alisio.mjs`, and `package.json`.
- The migration path is covered by targeted tests for state-dir resolution, first-run migration, env compatibility, and browser OAuth signalling.
- The repo build is green again: public config/plugin-sdk surfaces now carry a temporary type-only compatibility alias for legacy config type imports while the runtime core stays fully on the Alisio names.

## Repo-wide Follow-up

The remaining rebrand work is optional cleanup rather than a blocker. Internal consumers can still migrate from the temporary legacy config type alias to `AlisioConfig` over time, but the runtime slice itself is closed.

Use the runtime audit note in `src/config/rebrand-audit.md` to track the AG2 result and the remaining repo-wide follow-up.
