#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/alisio-branding.sh
source "$ROOT_DIR/scripts/lib/alisio-branding.sh"

APP_NAME="$(alisio_app_name)"
BUILD_ROOT="$ROOT_DIR/apps/macos/.build"
PRODUCT="${APP_PRODUCT:-${ALISIO_MAC_APP_PRODUCT:-$APP_NAME}}"
BUILD_CONFIG="${BUILD_CONFIG:-release}"
APP_VERSION_INPUT="${APP_VERSION:-$(cd "$ROOT_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")}"

export BUILD_ARCHS="${BUILD_ARCHS:-all}"
export BUILD_CONFIG
export BUNDLE_ID="${BUNDLE_ID:-$(alisio_bundle_domain).mac}"

canonical_sparkle_build() {
  node --import tsx "$ROOT_DIR/scripts/sparkle-build.ts" canonical-build "$1"
}

if [[ -z "${APP_BUILD:-}" && "$BUILD_CONFIG" == "release" ]]; then
  CANONICAL_APP_BUILD="$(canonical_sparkle_build "$APP_VERSION_INPUT" 2>/dev/null || true)"
  if [[ "$CANONICAL_APP_BUILD" =~ ^[0-9]+$ ]]; then
    export APP_BUILD="$CANONICAL_APP_BUILD"
  fi
fi

ARTIFACT_STAGE_ROOT="$(mktemp -d -t ${APP_NAME}-mac-dist.XXXXXX)"
cleanup_stage() {
  rm -rf "$ARTIFACT_STAGE_ROOT"
}
trap cleanup_stage EXIT

APP="$ARTIFACT_STAGE_ROOT/${APP_NAME}.app"
MACOS_FINAL_APP_PATH="$APP" bash "$ROOT_DIR/scripts/package-mac-app.sh"

[[ -d "$APP" ]] || { echo "Error: missing staged app bundle at $APP" >&2; exit 1; }

VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null || echo "0.0.0")
BUNDLE_VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleVersion" "$APP/Contents/Info.plist" 2>/dev/null || echo "")
ACTUAL_BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$APP/Contents/Info.plist" 2>/dev/null || echo "")
ACTUAL_FEED_URL=$(/usr/libexec/PlistBuddy -c "Print SUFeedURL" "$APP/Contents/Info.plist" 2>/dev/null || echo "")
ZIP="$ROOT_DIR/dist/${APP_NAME}-${VERSION}.zip"
DMG="$ROOT_DIR/dist/${APP_NAME}-${VERSION}.dmg"
NOTARY_ZIP="$ARTIFACT_STAGE_ROOT/${APP_NAME}-${VERSION}.notary.zip"
ZIP_STAGE="$ARTIFACT_STAGE_ROOT/${APP_NAME}-${VERSION}.zip"
DMG_STAGE="$ARTIFACT_STAGE_ROOT/${APP_NAME}-${VERSION}.dmg"
DSYM_ZIP="$ROOT_DIR/dist/${APP_NAME}-${VERSION}.dSYM.zip"
FINAL_APP="$ROOT_DIR/dist/${APP_NAME}.app"
SKIP_NOTARIZE="${SKIP_NOTARIZE:-0}"
SKIP_DSYM="${SKIP_DSYM:-0}"
SKIP_DMG="${SKIP_DMG:-0}"

if [[ "$BUILD_CONFIG" == "release" ]]; then
  if [[ "$ACTUAL_BUNDLE_ID" == *.debug ]]; then
    echo "Error: release packaging produced debug bundle id '$ACTUAL_BUNDLE_ID'." >&2
    exit 1
  fi
  if [[ -z "$ACTUAL_FEED_URL" ]]; then
    echo "Error: release packaging produced an empty SUFeedURL." >&2
    exit 1
  fi
  CANONICAL_APP_BUILD="$(canonical_sparkle_build "$VERSION" 2>/dev/null || true)"
  if [[ "$CANONICAL_APP_BUILD" =~ ^[0-9]+$ ]]; then
    if [[ ! "$BUNDLE_VERSION" =~ ^[0-9]+$ ]]; then
      echo "Error: release packaging produced non-numeric CFBundleVersion '$BUNDLE_VERSION'." >&2
      exit 1
    fi
    if (( BUNDLE_VERSION < CANONICAL_APP_BUILD )); then
      echo "Error: CFBundleVersion '$BUNDLE_VERSION' is below the canonical Sparkle floor '$CANONICAL_APP_BUILD' for '$VERSION'." >&2
      exit 1
    fi
  fi
fi

if [[ "$SKIP_NOTARIZE" != "1" ]]; then
  echo "📦 Notary zip: $NOTARY_ZIP"
  rm -f "$NOTARY_ZIP"
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$NOTARY_ZIP"
  STAPLE_APP_PATH="$APP" bash "$ROOT_DIR/scripts/notarize-mac-artifact.sh" "$NOTARY_ZIP"
  rm -f "$NOTARY_ZIP"
fi

echo "📦 Zip: $ZIP"
rm -f "$ZIP" "$ZIP_STAGE"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP_STAGE"

if [[ "$SKIP_DMG" != "1" ]]; then
  echo "💿 DMG: $DMG"
  rm -f "$DMG" "$DMG_STAGE"
  bash "$ROOT_DIR/scripts/create-dmg.sh" "$APP" "$DMG_STAGE"
  if [[ "$SKIP_NOTARIZE" != "1" ]]; then
    if [[ -n "${SIGN_IDENTITY:-}" ]]; then
      /usr/bin/codesign --force --sign "$SIGN_IDENTITY" --timestamp "$DMG_STAGE"
    fi
    bash "$ROOT_DIR/scripts/notarize-mac-artifact.sh" "$DMG_STAGE"
  fi
fi

echo "📦 Persisting app bundle: $FINAL_APP"
rm -rf "$FINAL_APP"
ditto "$APP" "$FINAL_APP"
mv "$ZIP_STAGE" "$ZIP"
if [[ -f "$DMG_STAGE" ]]; then
  mv "$DMG_STAGE" "$DMG"
fi

if [[ "$SKIP_DSYM" != "1" ]]; then
  DSYM_ARM64="$(find "$BUILD_ROOT/arm64" -type d -path "*/$BUILD_CONFIG/$PRODUCT.dSYM" -print -quit)"
  DSYM_X86="$(find "$BUILD_ROOT/x86_64" -type d -path "*/$BUILD_CONFIG/$PRODUCT.dSYM" -print -quit)"
  if [[ -n "$DSYM_ARM64" || -n "$DSYM_X86" ]]; then
    TMP_DSYM="$ROOT_DIR/dist/$PRODUCT.dSYM"
    rm -rf "$TMP_DSYM"
    if [[ -n "$DSYM_ARM64" && -n "$DSYM_X86" ]]; then
      cp -R "$DSYM_ARM64" "$TMP_DSYM"
      DWARF_OUT="$TMP_DSYM/Contents/Resources/DWARF/$PRODUCT"
      DWARF_ARM="$DSYM_ARM64/Contents/Resources/DWARF/$PRODUCT"
      DWARF_X86="$DSYM_X86/Contents/Resources/DWARF/$PRODUCT"
      if [[ -f "$DWARF_ARM" && -f "$DWARF_X86" ]]; then
        /usr/bin/lipo -create "$DWARF_ARM" "$DWARF_X86" -output "$DWARF_OUT"
      fi
    else
      cp -R "${DSYM_ARM64:-$DSYM_X86}" "$TMP_DSYM"
    fi
    echo "🧩 dSYM: $DSYM_ZIP"
    rm -f "$DSYM_ZIP"
    ditto -c -k --keepParent "$TMP_DSYM" "$DSYM_ZIP"
    rm -rf "$TMP_DSYM"
  fi
fi
