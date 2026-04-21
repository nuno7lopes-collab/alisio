---
summary: "Windows truth: native CLI, WSL2, and the current desktop-host foundation"
read_when:
  - Running Alisio on Windows
  - Choosing between native Windows, WSL2, and the Windows desktop host
  - Checking what the Windows host app does and does not do
title: "Windows"
---

# Windows

As of **April 19, 2026**, Windows support is real, but it is **not one thing**.

Treat these as separate surfaces:

- **Native Windows CLI**
- **WSL2 runtime**
- **Windows desktop host app**
- **Future Windows local `computer` runtime**

They are **not** equivalent today.

## Recommended path

If you want the fullest Alisio runtime on a Windows machine today, use
**WSL2**. That keeps the CLI, Gateway, and Linux-first tooling on the path we
already exercise most heavily.

- [Getting Started](/start/getting-started) inside WSL2
- [Gateway](/gateway)
- Microsoft WSL install guide:
  [https://learn.microsoft.com/windows/wsl/install](https://learn.microsoft.com/windows/wsl/install)

## What exists today

### Native Windows CLI

Native Windows already supports real CLI and Gateway flows.

What works well today:

- website installer via `install.ps1`
- local CLI commands such as `alisio --version`, `alisio doctor`, and `alisio plugins list --json`
- native Windows Gateway install flows, including Scheduled Tasks first and a
  per-user Startup-folder fallback when task creation is denied
- local agent/provider smoke such as:

```powershell
alisio agent --local --agent main --thinking low -m "Reply with exactly WINDOWS-HATCH-OK."
```

Native Windows is **not** the same thing as the Windows desktop host app. The
CLI can work even if the host app is not built or installed.

### WSL2 runtime

WSL2 remains the recommended Windows path for the full runtime story:

- Linux package/tool compatibility
- Gateway service install via systemd
- the most battle-tested path for local runtime workflows on Windows

If you are deciding between native Windows and WSL2 for day-to-day operation,
pick **WSL2** unless you specifically need native Windows behavior.

### Windows desktop host app

This repo now contains a **real Windows desktop-host foundation** in
`apps/windows`.

What this foundation is:

- a native **WinUI 3** desktop app on **Windows App SDK 1.8.6**
- a **WebView2** host for the shared shell
- a native settings window that tells the truth about Windows capability state
- native log-folder reveal
- native external-link handoff
- native file and folder pickers
- a real WebView2 request/response bridge base for later shell integration

What this foundation is **not**:

- not a shipped parity app matching the macOS app
- not a replacement for WSL2
- not a Windows local `computer` runtime
- not background-safe desktop control
- not voice wake, launch-at-login, or a Windows-native permission bridge

For the host architecture details, see
[Windows Desktop Host](/architecture/windows-desktop-host).

## Capability truth

### 1) Windows desktop host app

This is the new native shell host in `apps/windows`.

Current truth:

- shared shell hosting: available
- WebView2 bridge base: available
- shell bridge injection: **experimental and off by default**
- native settings/logs/external/file pickers: available
- local `computer`: **not available**

Why bridge injection is off by default:

- the shared shell still hardcodes some macOS-native shell presentation
- enabling that bridge by default on Windows would surface misleading UI
- the host therefore keeps the bridge implementation real, but the shell wiring
  honest and opt-in until the shell contract becomes platform-neutral

### 2) Native Windows CLI

This is the normal `alisio` binary path on Windows.

Current truth:

- real and usable
- separate from the desktop host app
- can run without WinUI 3 or WebView2 app work

### 3) WSL2

This is the recommended Windows runtime path.

Current truth:

- best compatibility path on Windows
- best fit for Gateway service + Linux-first tooling
- still the safest recommendation if you want the most complete experience

### 4) Future Windows local `computer`

This does **not** exist yet.

Current truth:

- there is no Windows runtime equivalent today to the local macOS `computer`
  stack
- the Windows host app therefore does **not** advertise local `computer`
- there is no claim of background-safe control or local GUI action parity

If you are looking specifically for local host-computer control, read
[Computer](/tools/computer). That page is currently macOS-specific on purpose.

## Release recommendation

Current Windows recommendation:

- **GO** for a desktop-host foundation branch or internal preview
- **GO WITH LIMITATIONS** only if the release message is explicit that Windows
  ships a host shell foundation, not local-computer parity
- **NO-GO** for any claim that Windows already matches macOS local `computer`

## Microsoft stack choice

The Windows host foundation intentionally follows Microsoft’s primary path for a
native Windows desktop shell host:

- WinUI 3 / Windows App SDK:
  [https://learn.microsoft.com/windows/apps/winui/](https://learn.microsoft.com/windows/apps/winui/)
- latest Windows App SDK stable downloads:
  [https://learn.microsoft.com/windows/apps/windows-app-sdk/downloads](https://learn.microsoft.com/windows/apps/windows-app-sdk/downloads)
- WebView2 in WinUI 3:
  [https://learn.microsoft.com/microsoft-edge/webview2/get-started/winui](https://learn.microsoft.com/microsoft-edge/webview2/get-started/winui)

The host loads the shared shell from either:

- `ui/dist` in a repo checkout
- staged shell assets inside the Windows app folder

## Build the Windows host from source

The Windows host lives under `apps/windows`.

Typical source flow:

```powershell
pnpm ui:build
powershell -ExecutionPolicy Bypass -File apps/windows/scripts/stage-shell.ps1
powershell -ExecutionPolicy Bypass -File apps/windows/scripts/build.ps1
```

The staging step is optional if you are running from a repo checkout and the app
can resolve `ui/dist` directly.

## Native Windows caveats

Native Windows CLI and Gateway caveats still apply:

- `alisio onboard --non-interactive` still expects a reachable local gateway
  unless you pass `--skip-health`
- `alisio onboard --non-interactive --install-daemon` and
  `alisio gateway install` try Scheduled Tasks first
- when Scheduled Task creation is denied, Alisio falls back to a per-user
  Startup-folder login item
- Scheduled Tasks remain preferred when available because they provide better
  supervisor status

If you want the native CLI only, without gateway service install:

```powershell
alisio onboard --non-interactive --skip-health
alisio gateway run
```

If you do want managed startup on native Windows:

```powershell
alisio gateway install
alisio gateway status --json
```

## Gateway

- [Gateway](/gateway)
- [Gateway configuration](/gateway/configuration)

## Gateway service install

Inside WSL2:

```bash
alisio onboard --install-daemon
```

Or:

```bash
alisio gateway install
```

Or:

```bash
alisio configure
```

Select **Gateway service** when prompted.

Repair or migrate:

```bash
alisio doctor
```

## Gateway auto-start before Windows login

If you want the WSL2 Gateway path to come up before Windows sign-in, keep the
full boot chain in mind:

1. Keep the Linux user service alive without login:

```bash
sudo loginctl enable-linger "$(whoami)"
```

2. Install the Alisio gateway user service:

```bash
alisio gateway install
```

3. Wake WSL at Windows boot from an elevated PowerShell:

```powershell
schtasks /create /tn "WSL Boot" /tr "wsl.exe -d Ubuntu --exec /bin/true" /sc onstart /ru SYSTEM
```

Replace `Ubuntu` with your distro from:

```powershell
wsl --list --verbose
```

## Advanced: expose WSL services over LAN

WSL2 has its own virtual network. If another machine needs to reach a service
running inside WSL, forward a Windows port to the current WSL IP.

Example, in elevated PowerShell:

```powershell
$Distro = "Ubuntu-24.04"
$ListenPort = 2222
$TargetPort = 22

$WslIp = (wsl -d $Distro -- hostname -I).Trim().Split(" ")[0]
if (-not $WslIp) { throw "WSL IP not found." }

netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$ListenPort `
  connectaddress=$WslIp connectport=$TargetPort
```

Allow the port through Windows Firewall:

```powershell
New-NetFirewallRule -DisplayName "WSL SSH $ListenPort" -Direction Inbound `
  -Protocol TCP -LocalPort $ListenPort -Action Allow
```

Refresh the rule after WSL restarts because the WSL IP can change.

## WSL2 install notes

Open PowerShell as Administrator:

```powershell
wsl --install
# Or pick a distro explicitly:
wsl --list --online
wsl --install -d Ubuntu-24.04
```

Then enable systemd inside WSL:

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

Restart WSL:

```powershell
wsl --shutdown
```

Then continue with the normal Linux install flow inside WSL:

```bash
git clone https://github.com/alisio/alisio.git
cd alisio
pnpm install
pnpm ui:build
pnpm build
alisio onboard
```
