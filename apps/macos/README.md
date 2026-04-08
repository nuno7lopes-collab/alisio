# Alisio macOS app (dev + signing)

## Quick dev run

```bash
# from repo root
scripts/restart-mac.sh
```

Options:

```bash
scripts/restart-mac.sh --no-sign   # fastest dev; ad-hoc signing (TCC permissions do not stick)
scripts/restart-mac.sh --sign      # force code signing (requires cert)
```

## Packaging flow

```bash
scripts/package-mac-app.sh
```

Creates `dist/Alisio.app` and signs it via `scripts/codesign-mac-app.sh`.

## Signing behavior

Auto-selects identity (first match):
1) Developer ID Application
2) Apple Distribution
3) Apple Development
4) first available identity

If none found:
- errors by default
- set `ALLOW_ADHOC_SIGNING=1` or `SIGN_IDENTITY="-"` to ad-hoc sign

## Team ID audit (Sparkle mismatch guard)

After signing, we read the app bundle Team ID and compare every Mach-O inside the app.
If any embedded binary has a different Team ID, signing fails.

Skip the audit:
```bash
SKIP_TEAM_ID_CHECK=1 scripts/package-mac-app.sh
```

## Library validation workaround (dev only)

If Sparkle Team ID mismatch blocks loading (common with Apple Development certs), opt in:

```bash
DISABLE_LIBRARY_VALIDATION=1 scripts/package-mac-app.sh
```

This adds `com.apple.security.cs.disable-library-validation` to app entitlements.
Use for local dev only; keep off for release builds.

## Useful env flags

- `SIGN_IDENTITY="Apple Development: Your Name (TEAMID)"`
- `ALLOW_ADHOC_SIGNING=1` (ad-hoc, TCC permissions do not persist)
- `CODESIGN_TIMESTAMP=off` (offline debug)
- `DISABLE_LIBRARY_VALIDATION=1` (dev-only Sparkle workaround)
- `SKIP_TEAM_ID_CHECK=1` (bypass audit)

## Notarization placeholders

`scripts/package-mac-dist.sh` already supports notarization, but the Apple account details are not set in this repo.
Before a release build, fill the placeholders in `apps/macos/signing.env.example` and export the values you actually use.

Supported auth modes:

- `NOTARYTOOL_PROFILE` for a keychain profile created with `xcrun notarytool store-credentials`
- `NOTARYTOOL_KEY` + `NOTARYTOOL_KEY_ID` + `NOTARYTOOL_ISSUER` for App Store Connect API key auth
