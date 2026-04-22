---
summary: "Windows: native desktop workspace with honest gateway state, session browsing, and shared-backend auth."
read_when:
  - Running Alisio on Windows
  - Choosing between the Windows app, the native CLI, and WSL2
  - Checking what the Windows frontend does and does not claim
title: "Windows"
---

# Windows

Windows now has a native desktop workspace for Alisio.

That workspace is account-rooted and gateway-backed:

- signed-out or not-ready Windows stays explicit about setup state
- stored sessions and transcripts render natively from the real session stores
- live readiness still comes from the canonical bootstrap state
- account and runtime state use the same backend truth as the rest of the product

Windows still does **not** claim macOS local `computer` parity.

If you need the fullest Linux-first runtime path on a Windows machine, keep using **WSL2**. If you want the native desktop product surface for workspace state, session browsing, account state, and honest reconnect/setup handling, use the **Windows app**.

## Product Truth On Windows

The Windows app does not invent its own auth or device model.

It reads the real Alisio runtime and Gateway contract:

- runtime availability comes from the actual `alisio` CLI
- startup gating comes from `alisio.bootstrap.get`
- account truth comes from the canonical account-rooted contract
- device binding stays attached to the current local runtime device
- product settings stay behind the same shared backend auth state

That means Windows does not silently fall back to a local-only product mode when the user is signed out.

## Choose The Right Surface

### Windows app

Use this when you want the native desktop frontend on Windows.

Current behavior:

- native WinUI 3 frontend
- native workspace and chat/session navigation
- native session-store and transcript browsing
- honest loading, reconnect, setup-required, and error states
- native log/state-folder reveal and Windows settings launchers

Current non-goals:

- no local `computer` runtime parity
- no claim of macOS permission parity
- no voice wake or launch-at-login product surface
- no second auth model separate from the Gateway
- no native message compose yet

### Native Windows CLI

Use this when you want terminal-led setup or operator flows on Windows.

Current truth:

- real and supported
- works separately from the Windows app
- good for scripting, diagnostics, and gateway operations

### WSL2

Use this when you want the most battle-tested runtime path on Windows.

Current truth:

- best compatibility path for Linux-first tooling
- strongest fit for runtime-heavy and service-oriented workflows
- still the right answer when you specifically need the fuller Linux runtime story

## What The Windows App Does

- renders the real runtime and gateway state instead of a compatibility dashboard
- keeps signed-out and setup-required state honest
- shows persisted sessions and transcripts directly from the real stores on disk
- reconnects against the canonical gateway contract instead of inventing a local-only mode
- keeps account and device-binding state rooted in the shared backend contract

## What The Windows App Does Not Do

- it does not claim a Windows local `computer` implementation
- it does not claim background-safe desktop control
- it does not pretend stored transcripts are a live connected chat
- it does not offer native message compose yet
- it does not replace the native CLI
- it does not replace WSL2 for Linux-first runtime workflows

If you are looking for local-computer control, read [Computer](/tools/computer). That surface remains intentionally macOS-first.

## Build From Source

The Windows app lives under `apps/windows`.

Typical source build:

```powershell
powershell -ExecutionPolicy Bypass -File apps/windows/scripts/build.ps1
```

If you have the Windows toolchain installed, you can also build the solution directly:

```powershell
dotnet build apps/windows/Alisio.WindowsHost.sln
```

## Related Pages

- [Getting Started](/start/getting-started)
- [Onboarding Overview](/start/onboarding-overview)
- [Windows Desktop Host](/architecture/windows-desktop-host)
- [Gateway](/gateway)
