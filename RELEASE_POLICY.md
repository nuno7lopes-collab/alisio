# Release Policy

This document defines the minimum repo-specific release policy for this repository.
For the public release lanes and versioning policy, see `docs/reference/RELEASING.md`.

Compatibility note: the published npm package and the existing helper scripts still use the
`alisio` slug until a package rename lands. This policy describes the release bar without
requiring that rename first.

## Version source of truth

- `package.json` is the canonical release version source.
- Release tags must match the version policy enforced by `scripts/alisio-npm-release-check.ts`.
- Before a release-grade publish, mirror that version into the platform/version surfaces that ship with the release:
  - `apps/android/app/build.gradle.kts`
  - `apps/ios/Sources/Info.plist`
  - `apps/ios/Tests/Info.plist`
  - `apps/macos/Sources/Alisio/Resources/Info.plist`
  - `docs/install/updating.md`
- Do not cut or publish a release without explicit operator approval.

## Minimum gates

- Required for every tagged release candidate:
  - `pnpm check`
  - `pnpm build`
  - `pnpm release:check`
- `pnpm release:check` includes the forbidden-artifact guardrail derived from `.gitignore`.
- Also run `ALISIO_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke` when the installer or published install path changed. The env var keeps its legacy name for compatibility with the current smoke helper.

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

The guardrail derives this list from the `.gitignore` `forbidden-commit-dir` markers so local hooks,
CI, and release validation stay aligned.

## Approval note

- Release-sensitive workflow, script, and documentation changes are CODEOWNERS-covered.
- Prepare those changes as a PR and obtain the required formal approval before landing on the protected path.
