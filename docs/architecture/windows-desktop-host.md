---
summary: "Windows desktop host architecture: native WinUI workspace, honest runtime state, and shared gateway truth."
read_when:
  - Understanding how the Windows workspace boots
  - Working on Windows chat, sessions, navigation, or loading states
  - Verifying Windows product behavior against the shared backend
title: "Windows Desktop Host"
---

# Windows Desktop Host

The Windows desktop host is the native frontend under `apps/windows`.

Its job is narrow and explicit:

- render a native workspace instead of embedding the web product as the main UI
- show the real runtime and gateway state without pretending disconnected state is live chat
- browse the real session stores and JSONL transcripts on disk
- avoid a second Windows-only auth, routing, or account model

## Core Shape

The Windows host is a **WinUI 3** app on **Windows App SDK 1.8.6**.

One window matters:

- `MainWindow`: native workspace shell with chat/session browsing and workspace state

The window owns:

- left-rail navigation between chat and workspace views
- refresh, reconnect, loading, and error handling
- native session list rendering from discovered `sessions.json` stores
- native transcript rendering from persisted JSONL files
- native launchers for logs, workspace/config paths, and Windows settings pages

## Source Of Truth

Windows still does not invent product state from ad hoc local heuristics.

It resolves:

- runtime availability from the real `alisio` CLI
- gateway health from `alisio gateway health --json`
- canonical bootstrap and account state from `alisio.bootstrap.get`
- gateway config from `config.get`
- workspace and session-store layout from `~/.alisio/alisio.json` plus discovered disk state

That keeps Windows aligned with the same shared backend contract used elsewhere in the product while still exposing honest local recovery when only stored transcripts are available.

## Product Gating

Windows applies these rules:

- if the runtime is missing, Windows does not fake setup, chat, or reconnect state
- if the gateway is down but session stores exist, Windows renders local transcript history as read-only state
- if the gateway is up but bootstrap is not ready, Windows says so explicitly instead of claiming ready chat
- only a ready bootstrap produces a live-connected workspace state

This is the important cut from earlier Windows experiments: the app no longer exposes a fake usable-enough product surface while the canonical contract is incomplete.

## Native Workspace Model

The native workspace intentionally has two panes:

- `Chat`: session list plus transcript rendering for the selected stored session
- `Workspace`: runtime, gateway, config, capability, and path truth for the current Windows environment

Current deliberate cuts:

- no embedded browser shell as the main product surface
- no duplicate settings window
- no native message compose yet
- no Windows local `computer` parity claim

## Build

Use the Windows solution under `apps/windows`:

```powershell
dotnet build apps/windows/Alisio.WindowsHost.sln
```
