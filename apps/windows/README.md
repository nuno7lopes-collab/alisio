# Alisio Windows Host

Foundation for a native Windows desktop host that currently embeds temporary shell assets while the future Windows-native frontend is still being prepared.

Current shape:

- `WinUI 3` desktop app on `Windows App SDK 1.8.6`
- `WebView2` host for the current shell assets
- native host services for logs, external links, native settings, and file pickers
- honest capability gating: no fake local `computer` runtime on Windows

Current non-goals:

- no claim of macOS parity
- no packaged Windows installer in this repo yet
- no Windows local-computer runtime
- no background-safe control surface

## Build from a Windows machine

1. Build the current shell assets:

```powershell
pnpm ui:build
```

2. Stage the built shell into the Windows app assets if you want a self-contained app folder:

```powershell
powershell -ExecutionPolicy Bypass -File apps/windows/scripts/stage-shell.ps1
```

3. Build the WinUI host:

```powershell
powershell -ExecutionPolicy Bypass -File apps/windows/scripts/build.ps1
```

The app can also resolve `ui/dist` directly from a repo checkout without staged assets.

## Bridge status

The native request/response bridge is implemented, but the current compatibility shell still hardcodes macOS-native copy and behavior in a few places. Because of that, the Windows host keeps bridge injection **off by default** and exposes the native settings window from the host chrome instead.

That keeps the Windows host honest while still giving us the real WebView2 bridge base for later Windows-native frontend work.
