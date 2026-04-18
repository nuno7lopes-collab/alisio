---
summary: "Devices: pairing, permissions, and device-local capabilities across macOS and remote machines."
read_when:
  - Pairing a device into Alisio
  - Explaining device-local actions and permissions
  - Clarifying the UX term “Devices” versus the internal term “node”
title: "Devices"
sidebarTitle: "Devices"
---

# Devices

In the product and UI, we say **Devices**.

Internally, some protocols and methods still use the technical word **node**. The product meaning is the same: a paired computer that gives Alisio local capabilities on that machine.

## What A Device Is

A device is a companion machine that can contribute local actions such as:

- camera and media capture
- microphone and speech
- screen recording or canvas views
- notifications
- local automation and system actions

## Why Devices Matter

Alisio is desktop-first, but it is not desktop-only.

Devices let the system extend from one Mac to:

- another Mac
- a remote helper machine

That makes automations more useful because actions can run where the hardware, permissions, or context actually live.

## Pairing

Pairing decides which devices belong to the same Alisio workspace.

Typical advanced commands:

```bash
alisio devices list
alisio devices approve <requestId>
alisio nodes status
```

Use the UI when available. Use the CLI when you are operating remotely or need deeper diagnostics.

## Device-Local Actions

Examples of what devices can expose:

- `camera.*`
- `screen.record`
- `canvas.*`
- notifications
- local system actions on trusted machines

The important product rule is simple:

- AI may decide **what** to do
- the paired device decides **where** it can happen
- the permission model decides **whether** it is allowed

## Platform Roles

### macOS

The Mac is the primary desktop shell and the richest device surface.

### Remote helper machine

Useful when a workflow should run on another computer while the main Alisio workspace stays on your Mac.

## Naming Guidance

Use these words consistently in product-facing docs:

- **Devices** for UX and product copy
- **node** only when explaining protocol details or low-level commands

## Related Pages

- [macOS App](/platforms/macos)
- [Product Overview](/start/overview)
- [Getting Started](/start/getting-started)
