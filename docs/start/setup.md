---
summary: "Advanced setup and development workflows for Alisio"
read_when:
  - Setting up a new machine
  - You want “latest + greatest” without breaking your personal setup
title: "Setup"
---

# Setup

<Note>
If you are setting up for the first time, start with [Getting Started](/start/getting-started).
For onboarding details, see [Onboarding (CLI)](/start/wizard).
</Note>

## TL;DR

- **Tailoring lives outside the repo:** `~/.alisio/workspace` (workspace) + `~/.alisio/alisio.json` (config).
- **Stable workflow:** install the macOS app; let it run the bundled Gateway.
- **Bleeding edge workflow:** keep the macOS app bundle stable, run the Gateway yourself via `pnpm mac:dev:gateway`, and only rebuild the real `.app` bundle when you are validating signing, TCC, launchd, or packaging.

## Prereqs (from source)

- Node 24 recommended (Node 22 LTS, currently `22.14+`, still supported)
- `pnpm`
- Docker (optional; only for containerized setup/e2e — see [Docker](/install/docker))

## Tailoring strategy (so updates do not hurt)

If you want “100% tailored to me” _and_ easy updates, keep your customization in:

- **Config:** `~/.alisio/alisio.json` (JSON/JSON5-ish)
- **Workspace:** `~/.alisio/workspace` (skills, prompts, memories; make it a private git repo)

Bootstrap once:

```bash
alisio setup
```

From inside this repo, use the local CLI entry:

```bash
alisio setup
```

If you don’t have a global install yet, run it via `pnpm alisio setup`.

## Run the Gateway from this repo

After `pnpm build`, you can run the packaged CLI directly:

```bash
node alisio.mjs gateway run --port 40705 --verbose
```

## Stable workflow (macOS app first)

1. Install + launch **Alisio.app** (menu bar).
2. Complete the onboarding/permissions checklist (TCC prompts).
3. Ensure Gateway is **Local** and running (the app manages it).
4. Link surfaces (example: WhatsApp):

```bash
alisio channels login
```

5. Sanity check:

```bash
alisio health
```

If onboarding is not available in your build:

- Run `alisio setup`, then `alisio channels login`, then start the Gateway manually (`alisio gateway`).

## Bleeding edge workflow (Gateway in a terminal)

Goal: iterate quickly on the TypeScript Gateway while keeping the native macOS app attached.

### 1) Create the local app bundle once

If you have not created the local bundle yet, do it once:

```bash
pnpm mac:bundle:restart
```

After that, treat `pnpm mac:bundle:restart` as the heavy path, not the default edit loop.

### 2) Start the dev Gateway

```bash
pnpm install
pnpm mac:dev:gateway
```

`pnpm mac:dev:gateway` wraps `gateway:watch`, which reloads on relevant source,
config, and bundled-plugin metadata changes.

### 3) Open the existing macOS app bundle

```bash
pnpm mac:dev:app
```

Use Xcode's Run/Debug flow instead when you are iterating on native SwiftUI or app-runtime behavior.

### 4) Point the macOS app at your running Gateway

In **Alisio.app**:

- Connection Mode: **Local**
  The app will attach to the running gateway on the configured port.

### 5) Verify

- In-app Gateway status should read **“Using existing gateway …”**
- Or via CLI:

```bash
alisio health
```

### Common footguns

- **Using the heavy path for every edit:** `pnpm mac:bundle:restart` rebuilds and repackages a real `.app` bundle. Use it only when you need signing, TCC, launchd, or packaging validation.
- **No bundle to open:** if `pnpm mac:dev:app` fails, create `.run/Alisio.app` once with `pnpm mac:bundle:restart`.
- **Wrong port:** Gateway WS defaults to `ws://127.0.0.1:40705`; keep app + CLI on the same port.
- **Where state lives:**
  - Credentials: `~/.alisio/credentials/`
  - Sessions: `~/.alisio/agents/<agentId>/sessions/`
  - Logs: `/tmp/alisio/`

## Credential storage map

Use this when debugging auth or deciding what to back up:

- **WhatsApp**: `~/.alisio/credentials/whatsapp/<accountId>/creds.json`
- **Telegram bot token**: config/env or `channels.telegram.tokenFile` (regular file only; symlinks rejected)
- **Discord bot token**: config/env or SecretRef (env/file/exec providers)
- **Slack tokens**: config/env (`channels.slack.*`)
- **Pairing allowlists**:
  - `~/.alisio/credentials/<channel>-allowFrom.json` (default account)
  - `~/.alisio/credentials/<channel>-<accountId>-allowFrom.json` (non-default accounts)
- **Model auth profiles**: `~/.alisio/agents/<agentId>/agent/auth-profiles.json`
- **File-backed secrets payload (optional)**: `~/.alisio/secrets.json`

## Updating (without wrecking your setup)

- Keep `~/.alisio/workspace` and `~/.alisio/` as “your stuff”; don’t put personal prompts/config into the `alisio` repo.
- Updating source: `git pull` + `pnpm install` (when lockfile changed) + keep using `pnpm mac:dev:gateway`.

## Linux (systemd user service)

Linux installs use a systemd **user** service. By default, systemd stops user
services on logout/idle, which kills the Gateway. Onboarding attempts to enable
lingering for you (may prompt for sudo). If it’s still off, run:

```bash
sudo loginctl enable-linger $USER
```

For always-on or multi-user servers, consider a **system** service instead of a
user service (no lingering needed). See [Gateway runbook](/gateway) for the systemd notes.

## Related docs

- [Gateway runbook](/gateway) (flags, supervision, ports)
- [Gateway configuration](/gateway/configuration) (config schema + examples)
- [Discord](/channels/discord) and [Telegram](/channels/telegram) (reply tags + replyToMode settings)
- [Getting Started](/start/getting-started)
- [macOS app](/platforms/macos) (gateway lifecycle)
- [macOS Dev Setup](/platforms/mac/dev-setup)
