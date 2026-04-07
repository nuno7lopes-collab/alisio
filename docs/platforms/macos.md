---
summary: "Alisio on macOS: the primary app experience for setup, permissions, AI, devices, and daily use."
read_when:
  - Explaining the macOS product surface
  - Documenting permissions, device actions, or local setup on a Mac
title: "macOS App"
---

# macOS App

The macOS app is the primary Alisio product surface.

It is not a thin companion to some other product. It is where Alisio starts, where permissions become real, and where one computer becomes an AI workspace.

## What The App Owns

- first-run setup
- account sign-in
- macOS permissions
- OpenAI, Local, and Server AI setup
- local device capabilities on this Mac
- connector, app, and skill installs from the local marketplace

## What The App Does Well

- keeps setup visual and understandable
- makes permission state visible
- turns this Mac into a device-aware automation runtime
- gives Alisio a concrete desktop home instead of forcing a terminal-first mental model

## AI Sources On macOS

From the Mac app, Alisio should make three paths obvious:

- **OpenAI** for fast hosted setup
- **Local** for models on this Mac
- **Server** for Ollama or OpenAI-compatible endpoints elsewhere

Those sources can coexist on one machine.

## Device Capabilities

This Mac can expose device-local actions such as:

- notifications
- camera
- microphone and speech
- screen capture
- local automation and system actions

That is why macOS permissions matter so much in the product.

## Local Vs Remote

- **Local** is the default and recommended desktop path.
- **Remote** is for connecting this Mac to a workspace that already lives elsewhere.

Even in remote mode, the Mac app still matters because it can expose device-local capabilities from this computer.

## Where State Lives

For desktop installs, local state should be treated as user-owned product state.

- default state root: `~/.alisio`
- common workspace path: `~/.alisio/workspace`

Keep that data in a normal local folder, not in a sync-first location that might interfere with live sessions or device capabilities.

## Advanced Surfaces

The CLI still exists for operations and remote administration.

Use it when you need:

- headless or remote setup
- scripted automation
- deep diagnostics
- hosted or containerized deployments

But for the product story, the Mac app comes first.

## Related Pages

- [Getting Started](/start/getting-started)
- [Onboarding (macOS App)](/start/onboarding)
- [Product Overview](/start/overview)
- [Local Models and Servers](/gateway/local-models)
- [Devices](/nodes)
