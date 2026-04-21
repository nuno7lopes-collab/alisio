---
summary: "Windows desktop-host foundation: WinUI 3, WebView2, compatibility shell bridging, and honest host gating"
read_when:
  - Understanding the Windows desktop-host architecture
  - Working on the Windows desktop-host foundation
  - Checking why the Windows bridge is opt-in instead of default-on
title: "Windows Desktop Host"
---

# Windows Desktop Host

This page documents the current **Windows desktop-host foundation** under
`apps/windows`.

It exists to host the current compatibility shell on Windows without pretending
that Windows already has macOS-equivalent native runtime features or a finished
Windows-native frontend.

Windows follows the same backend contract as macOS:

- the product root is `accountId`
- product auth is mandatory
- backend-shared state stays in the shared backend
- `IDENTITY.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, and `memory/` stay local to
  the Windows runtime

## Stack

The foundation uses Microsoft’s primary native desktop stack:

- **WinUI 3**
- **Windows App SDK**
- **WebView2**

Official references:

- [https://learn.microsoft.com/windows/apps/winui/](https://learn.microsoft.com/windows/apps/winui/)
- [https://learn.microsoft.com/windows/apps/windows-app-sdk/downloads](https://learn.microsoft.com/windows/apps/windows-app-sdk/downloads)
- [https://learn.microsoft.com/microsoft-edge/webview2/get-started/winui](https://learn.microsoft.com/microsoft-edge/webview2/get-started/winui)

## Shell loading

The host resolves compatibility shell assets from one of two places:

- `ui/dist` in a repo checkout
- staged shell assets copied into the Windows app folder

WebView2 serves those local assets through a virtual host mapping instead of
pretending they are raw local files.

Relevant Microsoft API:

- [https://learn.microsoft.com/dotnet/api/microsoft.web.webview2.core.corewebview2.setvirtualhostnametofoldermapping](https://learn.microsoft.com/dotnet/api/microsoft.web.webview2.core.corewebview2.setvirtualhostnametofoldermapping)

## Bridge base

The host includes a real WebView2 request/response bridge base using:

- document-start script injection
- `chrome.webview.postMessage(...)`
- native `WebMessageReceived`
- native `PostWebMessageAsJson(...)`

Relevant Microsoft APIs:

- [https://learn.microsoft.com/dotnet/api/microsoft.web.webview2.core.corewebview2.webmessagereceived](https://learn.microsoft.com/dotnet/api/microsoft.web.webview2.core.corewebview2.webmessagereceived)
- [https://learn.microsoft.com/dotnet/api/microsoft.web.webview2.core.corewebview2.postwebmessageasjson](https://learn.microsoft.com/dotnet/api/microsoft.web.webview2.core.corewebview2.postwebmessageasjson)

The native dispatcher already handles Windows-host operations such as:

- host state
- opening the native settings window
- revealing logs
- opening external links
- file and folder pickers

## Compatibility bridge

The current shell bridge still exposes a compatibility verb,
`getShellState`, because the temporary shell assets still ask for that payload.
That compatibility adapter is deliberate. It is not the final Windows contract.

## Why the shell bridge is off by default

The current compatibility shell still hardcodes some **macOS-native shell**
presentation and behavior.

If the Windows host injected `window.alisioHost` by default today, the shell
would expose UI that reads as macOS-specific even though the Windows runtime
behind it does not exist yet.

That would be misleading.

So the Windows host takes the stricter path:

- the bridge implementation is real
- the native settings window is real
- the shell bridge injection is **experimental and opt-in**
- the default path stays honest until the shell contract becomes
  platform-neutral

## Capability truth

Current Windows desktop-host truth:

- temporary shell host: yes
- native settings window: yes
- native logs reveal: yes
- native external handoff: yes
- native file/folder pickers: yes
- shell bridge injection: experimental
- local `computer`: no
- background-safe control: no
- launch at login: no
- voice wake: no
- managed host device identity bridge: no

## Release note

Treat this surface as a **host foundation**, not as completed product parity or
the final Windows frontend direction.

It is suitable for:

- compatibility-shell convergence work
- native Windows host integration
- internal preview validation

It is not yet suitable for:

- claiming Windows local `computer`
- claiming background-safe control
- claiming feature parity with the macOS desktop app

## External handoff and native pages

The host opens external URLs outside the WebView2 shell instead of trapping
them inside the app.

It also uses Windows `ms-settings:` URIs for OS-native pages such as
microphone, camera, location, notifications, speech, and graphics-capture
privacy.

Relevant Microsoft reference:

- [https://learn.microsoft.com/windows/apps/develop/launch/launch-settings](https://learn.microsoft.com/windows/apps/develop/launch/launch-settings)

## File access hooks

The current host foundation includes native file and folder pickers.

Relevant Microsoft interop reference:

- [https://learn.microsoft.com/windows/apps/develop/files/using-file-folder-pickers](https://learn.microsoft.com/windows/apps/develop/files/using-file-folder-pickers)

These hooks are deliberately limited to explicit picker flows. They do **not**
pretend that Windows already has a local `computer` action runtime.
