---
summary: "Platform support overview (desktop hosts, gateway installs, and companion surfaces)"
read_when:
  - Looking for OS support or install paths
  - Deciding where to run the Gateway
title: "Platforms"
---

# Platforms

Alisio core is written in TypeScript. **Node is the recommended runtime**.
Bun is not recommended for the Gateway (WhatsApp/Telegram bugs).

The primary desktop app is macOS-first today. Windows and Linux are supported
as gateway/runtime hosts, and the Gateway is fully supported today. Native
Windows desktop host work is in progress; until then, the recommended Windows
path is WSL2.

## Choose your OS

- macOS: [macOS](/platforms/macos)
- Windows: [Windows](/platforms/windows)
- Linux: [Linux](/platforms/linux)

## VPS & hosting

- VPS hub: [VPS hosting](/vps)
- Fly.io: [Fly.io](/install/fly)
- Hetzner (Docker): [Hetzner](/install/hetzner)
- GCP (Compute Engine): [GCP](/install/gcp)
- Azure (Linux VM): [Azure](/install/azure)
- exe.dev (VM + HTTPS proxy): [exe.dev](/install/exe-dev)

## Common links

- Install guide: [Getting Started](/start/getting-started)
- Gateway runbook: [Gateway](/gateway)
- Gateway configuration: [Configuration](/gateway/configuration)
- Service status: `alisio gateway status`

## Gateway service install (CLI)

Use one of these (all supported):

- Wizard (recommended): `alisio onboard --install-daemon`
- Direct: `alisio gateway install`
- Configure flow: `alisio configure` → select **Gateway service**
- Repair/migrate: `alisio doctor` (offers to install or fix the service)

The service target depends on OS:

- macOS: LaunchAgent (`ai.alisio.gateway` or `ai.alisio.<profile>`; legacy `com.alisio.*`)
- Linux/WSL2: systemd user service (`alisio-gateway[-<profile>].service`)
