---
summary: "Setup guide for developers working on the Alisio macOS app"
read_when:
  - Setting up the macOS development environment
title: "macOS Dev Setup"
---

# macOS Developer Setup

This guide covers the macOS-native development workflow for Alisio.

## Prerequisites

Before working on the app, ensure you have:

1. **Xcode 26.2+** for Swift development and app debugging
2. **Node.js 24 + pnpm** for the gateway, CLI, and packaging scripts

Node 22 LTS remains supported, but keep the macOS packaging path on a current toolchain.

## 1. Install Dependencies

Install the project-wide dependencies:

```bash
pnpm install
```

## 2. Understand the two loops

There are two valid macOS development loops. Keep them separate.

### Lightweight loop

Use this for most edits:

```bash
pnpm mac:dev:gateway
pnpm mac:dev:app
```

- `pnpm mac:dev:gateway` runs the TypeScript gateway in watch mode.
- `pnpm mac:dev:app` opens the existing `.run/Alisio.app` bundle without rebuilding it.
- For native UI or native runtime work, prefer Xcode Run/Debug instead of repackaging the app every time.

This is the default loop for frontend/runtime iteration.

### Heavy loop

Use this only when you need a fresh real bundle:

```bash
pnpm mac:bundle:restart
pnpm mac:package
```

- `pnpm mac:bundle:restart` packages `.run/Alisio.app`, validates the bundle, and relaunches it.
- `pnpm mac:package` packages `dist/Alisio.app` without opening it.

This is the loop for bundle, signing, TCC, launchd, and packaging validation.

## 3. Create the local bundle once

If `.run/Alisio.app` does not exist yet, create it once:

```bash
pnpm mac:bundle:restart
```

After that, keep using the lightweight loop until you need to validate the real bundle again.

## 4. Run native UI changes in Xcode

Use Xcode when you are iterating on:

- SwiftUI layout and state
- native menu bar behavior
- app lifecycle and launch behavior
- native child-process and launchd integration debugging

Use the packaged heavy loop when you need to validate the actual signed bundle that the app launches outside Xcode.

### Native workspace fast path

For the native frontend itself, keep one more loop available that does not
depend on rebuilding the full `.app` bundle:

```bash
swift build --package-path apps/macos
swift test --package-path apps/macos --filter AlisioWorkspaceWindowSmokeTests
swift test --package-path apps/shared/AlisioKit --filter ChatViewModelTests
```

That path rebuilds the Swift packages, the native workspace host, and the
shared native chat state without repackaging the app bundle.

The workspace also exposes preview scenarios directly in Xcode via
`AlisioWorkspaceRootView_Previews` for:

- ready local chat
- first-message warmup
- remote reconnect state

Use previews plus `swift build` for layout/state iteration. Use the packaged
bundle only for real launchd, signing, and permission validation.

## 5. Install the CLI

The macOS app expects a global `alisio` CLI install to manage background tasks.

**To install it (recommended):**

1. Open the Alisio app.
2. Go to the **General** settings tab.
3. Click **"Install CLI"**.

Alternatively, install it manually:

```bash
npm install -g alisio@npm:alisio@<version>
```

## 6. When to use `--no-sign`

`pnpm mac:bundle:restart:no-sign` is useful only for quick local smoke when you need a rebuilt `.app` bundle but do not care about persistent permissions.

Do not use ad-hoc signing for:

- TCC verification
- permissions troubleshooting
- signing and entitlement validation
- packaging sign-off

## Troubleshooting

### `pnpm mac:dev:app` fails because `.run/Alisio.app` does not exist

Create the bundle once:

```bash
pnpm mac:bundle:restart
```

### Build fails because of toolchain or SDK mismatch

The macOS app build expects the latest macOS SDK and Swift 6.2 toolchain.

**Checks:**

```bash
xcodebuild -version
xcrun swift --version
```

If versions don’t match, update macOS/Xcode and re-run the build.

### Permissions behave inconsistently after `--no-sign`

That is expected with ad-hoc signing. Rebuild with a real signing identity before debugging TCC or permission behavior.

### App crashes on permission grant

If the app crashes when you try to allow **Speech Recognition** or **Microphone** access, it may be due to a corrupted TCC cache or signature mismatch.

**Fix:**

1. Reset the TCC permissions:

   ```bash
   tccutil reset All ai.alisio.mac.debug
   ```

2. Rebuild with a real signing identity and relaunch the packaged app.

### Gateway stays on "Starting..." indefinitely

If the gateway status stays on "Starting...", check if a zombie process is holding the port:

```bash
alisio gateway status
alisio gateway stop

# If you're not using a LaunchAgent (dev mode / manual runs), find the listener:
lsof -nP -iTCP:40705 -sTCP:LISTEN
```

If a manual run is holding the port, stop that process (Ctrl+C). As a last resort, kill the PID you found above.
