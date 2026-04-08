---
title: "macOS Release"
summary: "Prerequisites and packaging stages for shipping the Alisio macOS app"
read_when:
  - Preparing a macOS release build
  - Checking which packaging script is release-grade
---

# macOS Release

Alisio macOS packaging has two supported lanes:

- `scripts/package-mac-app.sh` for local debug smoke builds and `release-placeholder` builds. It produces `dist/Alisio.app` only.
- `scripts/package-mac-dist.sh` for release-grade distribution. It packages the app for shipping and is the path that emits the release archive formats.

## Prerequisites

- An Apple Developer account with a valid `Developer ID Application` certificate.
- Notary credentials via either `NOTARYTOOL_PROFILE` or the App Store Connect API key variables in `apps/macos/signing.env.example`.
- A clean lockfile state. `scripts/package-mac-app.sh` now defaults to `pnpm install --frozen-lockfile` so packaging uses the checked-in dependency graph.
- If you need stable build metadata across repeated packaging runs, set `SOURCE_DATE_EPOCH` before invoking the script.

## Packaging Modes

Local debug smoke build:

```bash
scripts/package-mac-app.sh
```

If no Apple signing identity is configured, the debug lane falls back to ad-hoc signing so local smoke builds still produce `dist/Alisio.app`.

Signed release placeholder (`.app` only, not ship-ready):

```bash
BUILD_CONFIG=release MACOS_PACKAGE_MODE=release-placeholder scripts/package-mac-app.sh
```

This lane does not allow ad-hoc signing. It is the gate between local debug packaging and the fully signed/notarized distribution flow.

Release-grade bundle, zip, DMG, and notarization:

```bash
BUILD_CONFIG=release scripts/package-mac-dist.sh
```

## Expected Outputs

- Debug and placeholder runs produce `dist/Alisio.app`.
- Release distribution produces `dist/Alisio.app`, `dist/Alisio-<version>.zip`, `dist/Alisio-<version>.dmg`, and optionally `dist/Alisio-<version>.dSYM.zip`.
- Release distribution expects a non-debug bundle id, a non-empty Sparkle feed URL, and a numeric `CFBundleVersion`.

## Assumptions

- Signing and notarization credentials are maintained outside this repository.
- Sparkle publishing and appcast updates still follow the maintainer release flow in [Release Policy](/reference/RELEASING) and the signing notes in [mac signing](/platforms/mac/signing).
