---
summary: "Uninstall Alisio completely (CLI, service, state, workspace)"
read_when:
  - You want to remove Alisio from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** if `alisio` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
alisio uninstall
```

Non-interactive (automation / npx):

```bash
alisio uninstall --all --yes --non-interactive
npx -y alisio uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
alisio gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
alisio gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${ALISIO_STATE_DIR:-$HOME/.alisio}"
```

If you set `ALISIO_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.alisio/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g alisio
pnpm remove -g alisio
bun remove -g alisio
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/Alisio.app
```

Notes:

- If you used profiles (`--profile` / `ALISIO_PROFILE`), repeat step 3 for each state dir (defaults are `~/.alisio-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `alisio` is missing.

### macOS (launchd)

Default label is `ai.alisio.gateway` (or `ai.alisio.<profile>`; legacy `com.alisio.*` may still exist):

```bash
launchctl bootout gui/$UID/ai.alisio.gateway
rm -f ~/Library/LaunchAgents/ai.alisio.gateway.plist
```

If you used a profile, replace the label and plist name with `ai.alisio.<profile>`. Remove any legacy `com.alisio.*` plists if present.

### Linux (systemd user unit)

Default unit name is `alisio-gateway.service` (or `alisio-gateway-<profile>.service`):

```bash
systemctl --user disable --now alisio-gateway.service
rm -f ~/.config/systemd/user/alisio-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `Alisio Gateway` (or `Alisio Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "Alisio Gateway"
Remove-Item -Force "$env:USERPROFILE\.alisio\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.alisio-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://alisio.app/install.sh` or `install.ps1`, the CLI was installed with `npm install -g alisio@npm:alisio@latest`.
Remove it with `npm rm -g alisio` (or `pnpm remove -g alisio` / `bun remove -g alisio` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `alisio ...` / `bun run alisio ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
