#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/alisio-branding.sh
source "$ROOT_DIR/scripts/lib/alisio-branding.sh"

APP_PATH="${1:-}"
OUT_PATH="${2:-}"
APP_NAME="$(alisio_app_name)"
DMG_TEMP_PREFIX="${TMPDIR:-/tmp}/alisio-dmg"
LIMITS_FILE="${TMPDIR:-/tmp}/alisio-dmg-limits.txt"

[[ -n "$APP_PATH" ]] || { echo "Usage: $0 <app_path> [output_dmg]" >&2; exit 1; }
[[ -d "$APP_PATH" ]] || { echo "Error: App not found: $APP_PATH" >&2; exit 1; }

BUILD_DIR="$ROOT_DIR/dist"
mkdir -p "$BUILD_DIR"

APP_NAME=$(/usr/libexec/PlistBuddy -c "Print CFBundleName" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "$APP_NAME")
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "0.0.0")

DMG_NAME="${APP_NAME}-${VERSION}.dmg"
DMG_VOLUME_NAME="${DMG_VOLUME_NAME:-$APP_NAME}"
DMG_BACKGROUND_SMALL="${DMG_BACKGROUND_SMALL:-$ROOT_DIR/assets/dmg-background-small.png}"
DMG_BACKGROUND_PATH="${DMG_BACKGROUND_PATH:-$ROOT_DIR/assets/dmg-background.png}"
DMG_WINDOW_BOUNDS="${DMG_WINDOW_BOUNDS:-400 100 900 420}"
DMG_ICON_SIZE="${DMG_ICON_SIZE:-128}"
DMG_APP_POS="${DMG_APP_POS:-125 160}"
DMG_APPS_POS="${DMG_APPS_POS:-375 160}"
DMG_EXTRA_SECTORS="${DMG_EXTRA_SECTORS:-2048}"

to_applescript_list4() {
  echo "$1" | awk '{ printf "%s, %s, %s, %s", $1, $2, $3, $4 }'
}

to_applescript_pair() {
  echo "$1" | awk '{ printf "%s, %s", $1, $2 }'
}

if [[ -z "$OUT_PATH" ]]; then
  OUT_PATH="$BUILD_DIR/$DMG_NAME"
fi

echo "Creating DMG: $OUT_PATH"

for vol in "/Volumes/$DMG_VOLUME_NAME"* "/Volumes/$APP_NAME"*; do
  [[ -d "$vol" ]] || continue
  hdiutil detach "$vol" -force 2>/dev/null || true
  sleep 1
done

DMG_TEMP="$(mktemp -d "${DMG_TEMP_PREFIX}.XXXXXX")"
trap 'hdiutil detach "/Volumes/'"$DMG_VOLUME_NAME"'" -force 2>/dev/null || true; rm -rf "$DMG_TEMP" 2>/dev/null || true' EXIT

cp -R "$APP_PATH" "$DMG_TEMP/"
ln -s /Applications "$DMG_TEMP/Applications"

APP_SIZE_MB=$(du -sm "$APP_PATH" | awk '{print $1}')
DMG_SIZE_MB=$((APP_SIZE_MB + 80))
DMG_RW_PATH="${OUT_PATH%.dmg}-rw.dmg"
rm -f "$DMG_RW_PATH" "$OUT_PATH"

hdiutil create \
  -volname "$DMG_VOLUME_NAME" \
  -srcfolder "$DMG_TEMP" \
  -ov \
  -format UDRW \
  -size "${DMG_SIZE_MB}m" \
  "$DMG_RW_PATH"

MOUNT_POINT="/Volumes/$DMG_VOLUME_NAME"
if [[ -d "$MOUNT_POINT" ]]; then
  hdiutil detach "$MOUNT_POINT" -force 2>/dev/null || true
  sleep 2
fi
hdiutil attach "$DMG_RW_PATH" -mountpoint "$MOUNT_POINT" -nobrowse

if [[ "${SKIP_DMG_STYLE:-0}" != "1" ]]; then
  mkdir -p "$MOUNT_POINT/.background"
  if [[ -f "$DMG_BACKGROUND_SMALL" ]]; then
    cp "$DMG_BACKGROUND_SMALL" "$MOUNT_POINT/.background/background.png"
  elif [[ -f "$DMG_BACKGROUND_PATH" ]]; then
    cp "$DMG_BACKGROUND_PATH" "$MOUNT_POINT/.background/background.png"
  fi

  ICON_FILE=$(/usr/libexec/PlistBuddy -c "Print CFBundleIconFile" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "$APP_NAME")
  RESOURCE_DIR="$(find "$ROOT_DIR/apps/macos/Sources" -path "*/Resources" -type d -print -quit 2>/dev/null || true)"
  ICON_SRC="${RESOURCE_DIR}/${ICON_FILE}.icns"
  if [[ -f "$ICON_SRC" ]]; then
    cp "$ICON_SRC" "$MOUNT_POINT/.VolumeIcon.icns"
    if command -v SetFile >/dev/null 2>&1; then
      SetFile -a C "$MOUNT_POINT" 2>/dev/null || true
    fi
  fi

  osascript <<EOF
tell application "Finder"
  tell disk "$DMG_VOLUME_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {$(to_applescript_list4 "$DMG_WINDOW_BOUNDS")}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to ${DMG_ICON_SIZE}
    if exists file ".background:background.png" then
      set background picture of viewOptions to file ".background:background.png"
    end if
    set text size of viewOptions to 12
    set label position of viewOptions to bottom
    set shows item info of viewOptions to false
    set shows icon preview of viewOptions to true
    set position of item "${APP_NAME}.app" of container window to {$(to_applescript_pair "$DMG_APP_POS")}
    set position of item "Applications" of container window to {$(to_applescript_pair "$DMG_APPS_POS")}
    update without registering applications
    delay 2
    close
    open
    delay 1
  end tell
end tell
EOF
  sleep 2
  osascript -e 'tell application "Finder" to close every window' || true
fi

for i in {1..5}; do
  if hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null; then
    break
  fi
  if [[ "$i" == "3" ]]; then
    hdiutil detach "$MOUNT_POINT" -force 2>/dev/null || true
  fi
  sleep 2
done

hdiutil resize -limits "$DMG_RW_PATH" >"$LIMITS_FILE" 2>/dev/null || true
MIN_SECTORS="$(tail -n 1 "$LIMITS_FILE" 2>/dev/null | awk '{print $1}')"
rm -f "$LIMITS_FILE"
if [[ "$MIN_SECTORS" =~ ^[0-9]+$ ]] && [[ "$DMG_EXTRA_SECTORS" =~ ^[0-9]+$ ]]; then
  TARGET_SECTORS=$((MIN_SECTORS + DMG_EXTRA_SECTORS))
  hdiutil resize -sectors "$TARGET_SECTORS" "$DMG_RW_PATH" >/dev/null 2>&1 || true
fi

hdiutil convert "$DMG_RW_PATH" -format ULMO -o "$OUT_PATH" -ov
rm -f "$DMG_RW_PATH"
hdiutil verify "$OUT_PATH" >/dev/null
echo "✅ DMG pronto: $OUT_PATH"
