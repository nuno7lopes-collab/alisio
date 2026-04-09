#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/alisio-branding.sh
source "$ROOT/scripts/lib/alisio-branding.sh"

APP_NAME="$(alisio_app_name)"
ZIP=${1:?"Usage: $0 ${APP_NAME}-<ver>.zip"}
DISTRO_ID="$(alisio_read_prefixed_env DISTRIBUTION "$(alisio_app_slug)")"
PRIVATE_KEY_FILE=${SPARKLE_PRIVATE_KEY_FILE:-}
FEED_URL="${SPARKLE_FEED_URL:-$(alisio_repo_raw_base "$DISTRO_ID")/appcast.xml}"

find_generate_appcast() {
  if command -v generate_appcast >/dev/null 2>&1; then
    command -v generate_appcast
    return 0
  fi
  find "$ROOT/apps/macos/.build" -type f -path "*/artifacts/sparkle/Sparkle/bin/generate_appcast" -print -quit 2>/dev/null
}

[[ -n "$PRIVATE_KEY_FILE" ]] || { echo "Set SPARKLE_PRIVATE_KEY_FILE." >&2; exit 1; }
[[ -f "$ZIP" ]] || { echo "Zip not found: $ZIP" >&2; exit 1; }
[[ -n "$FEED_URL" ]] || { echo "Set FEED_URL ou SPARKLE_FEED_URL." >&2; exit 1; }

ZIP_DIR="$(cd "$(dirname "$ZIP")" && pwd)"
ZIP_NAME="$(basename "$ZIP")"
ZIP_BASE="${ZIP_NAME%.zip}"
VERSION="${SPARKLE_RELEASE_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  if [[ "$ZIP_NAME" =~ ^${APP_NAME}-([0-9]+(\.[0-9]+){1,2}([-.][0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?)\.zip$ ]]; then
    VERSION="${BASH_REMATCH[1]}"
  else
    echo "Could not infer version from $ZIP_NAME; set SPARKLE_RELEASE_VERSION." >&2
    exit 1
  fi
fi

TMP_DIR="$(mktemp -d)"
NOTES_HTML="${ZIP_DIR}/${ZIP_BASE}.html"
cleanup() {
  rm -rf "$TMP_DIR"
  if [[ "${KEEP_SPARKLE_NOTES:-0}" != "1" ]]; then
    rm -f "$NOTES_HTML"
  fi
}
trap cleanup EXIT

cp -f "$ZIP" "$TMP_DIR/$ZIP_NAME"
if [[ -f "$ROOT/appcast.xml" ]]; then
  cp -f "$ROOT/appcast.xml" "$TMP_DIR/appcast.xml"
fi

"$ROOT/scripts/changelog-to-html.sh" "$VERSION" >"$NOTES_HTML"
cp -f "$NOTES_HTML" "$TMP_DIR/${ZIP_BASE}.html"

DOWNLOAD_URL_PREFIX="${SPARKLE_DOWNLOAD_URL_PREFIX:-$(alisio_release_download_base "$VERSION" "$DISTRO_ID")/}"
[[ -n "$DOWNLOAD_URL_PREFIX" ]] || { echo "Set SPARKLE_DOWNLOAD_URL_PREFIX." >&2; exit 1; }

GENERATE_APPCAST="$(find_generate_appcast)"
[[ -n "$GENERATE_APPCAST" ]] || { echo "generate_appcast not found." >&2; exit 1; }

"$GENERATE_APPCAST" \
  --ed-key-file "$PRIVATE_KEY_FILE" \
  --download-url-prefix "$DOWNLOAD_URL_PREFIX" \
  --embed-release-notes \
  --link "$FEED_URL" \
  "$TMP_DIR"

cp -f "$TMP_DIR/appcast.xml" "$ROOT/appcast.xml"
echo "Appcast gerado em $ROOT/appcast.xml"
