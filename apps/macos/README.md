# Alisio macOS app (dev loops + signing)

## Lightweight loop

Use this for day-to-day iteration on the native frontend/runtime and the TypeScript gateway without rebuilding the real app bundle on every change.

```bash
pnpm mac:dev:app        # reopen the existing .run/Alisio.app bundle
pnpm mac:dev:gateway    # run the gateway in watch mode
```

- Keep `.run/Alisio.app` stable between iterations.
- Prefer Xcode Run/Debug when changing SwiftUI or native runtime behavior.
- Let the app attach to the manually running gateway in Local mode.
- If `.run/Alisio.app` does not exist yet, create it once with `pnpm mac:bundle:restart`.

## Heavy loop

Use this only when you need a real bundle refresh:

- packaging changes
- signing and entitlement validation
- launchd and startup validation
- TCC and permission checks
- pre-release local smoke

```bash
pnpm mac:bundle:restart
pnpm mac:bundle:restart:no-sign
pnpm mac:package
pnpm mac:smoke:local
```

- `pnpm mac:bundle:restart` packages `.run/Alisio.app`, validates it, and relaunches it.
- `pnpm mac:package` packages `dist/Alisio.app` without opening it.
- `pnpm mac:smoke:local` runs a quick CLI health check against the current local setup.
- `pnpm mac:bundle:restart:no-sign` forces ad-hoc signing. Use it only for quick local smoke when TCC persistence does not matter.

## Signing behavior

Debug packaging tries to use a real signing identity first:

1. `Developer ID Application`
2. `Apple Distribution`
3. `Apple Development`
4. first available identity

If none is available, debug packaging can fall back to ad-hoc signing. That is acceptable for quick smoke, but not for permission, TCC, or signing validation.

Useful env flags:

- `SIGN_IDENTITY="Apple Development: Your Name (TEAMID)"`
- `ALLOW_ADHOC_SIGNING=1`
- `CODESIGN_TIMESTAMP=off`
- `DISABLE_LIBRARY_VALIDATION=1`
- `SKIP_TEAM_ID_CHECK=1`

## Packaging modes

Standard debug bundle:

```bash
scripts/package-mac-app.sh
```

Release placeholder bundle:

```bash
BUILD_CONFIG=release MACOS_PACKAGE_MODE=release-placeholder scripts/package-mac-app.sh
```

Release-grade distribution:

```bash
BUILD_CONFIG=release scripts/package-mac-dist.sh
```

Use the release distribution path for signed/notarized artifacts such as `.zip` and `.dmg`.
