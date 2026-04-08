# Release Policy

This document defines the minimum release policy for this repository.

## Version source of truth

- `package.json` is the canonical release version source.
- Release tags must match the version policy enforced by `scripts/alisio-npm-release-check.ts`.
- Before a release-grade publish, mirror that version into the platform/version surfaces that ship with the release:
  - `apps/android/app/build.gradle.kts`
  - `apps/ios/Sources/Info.plist`
  - `apps/ios/Tests/Info.plist`
  - `apps/macos/Sources/Alisio/Resources/Info.plist`
  - `docs/install/updating.md`

## Minimum gates

- Required for every tagged release candidate:
  - `pnpm check`
  - `pnpm build`
  - `pnpm release:check`
- Also run `OPENCLAW_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke` when the installer or published install path changed.

## macOS artifact classes

- Placeholder or ad-hoc package:
  - Built via `scripts/package-mac-app.sh`
  - Useful for smoke tests and local validation only
  - Not release-grade
- Release-grade macOS package:
  - Built via `scripts/package-mac-dist.sh` or the equivalent private publish workflow
  - Must produce signed/notarized public artifacts
  - Stable release readiness requires `.zip`, `.dmg`, and `.dSYM.zip`
  - Stable release readiness also requires `appcast.xml` on `main` to point at the shipped stable zip

## Forbidden tracked artifacts

Tracked files under these generated directories are rejected by `scripts/committer`, pre-commit, CI, and `pnpm release:check`:

- `node_modules/`
- `.build/`
- `.build-local/`
- `dist/`
- `dist-runtime/`
- `coverage/`

## CODEOWNERS migration note

- Verified on 2026-04-08: `gh api repos/alisio/alisio` returned `404 Not Found`.
- Verified on 2026-04-08: `gh api orgs/alisio/teams --paginate` returned `404 Not Found`.
- Because no resolvable Alisio GitHub org/team slugs were available at update time, `CODEOWNERS` comments were de-branded but existing owner handles were left in place until the GitHub org/team migration exists.
