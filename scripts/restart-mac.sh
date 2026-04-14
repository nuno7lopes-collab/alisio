#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/alisio-branding.sh
source "$ROOT_DIR/scripts/lib/alisio-branding.sh"

APP_NAME="$(alisio_app_name)"
PRODUCT="${APP_PRODUCT:-${ALISIO_MAC_APP_PRODUCT:-$APP_NAME}}"
APP_EXECUTABLE="${APP_EXECUTABLE:-${ALISIO_MAC_EXECUTABLE:-$PRODUCT}}"
APP_BUNDLE="${ALISIO_APP_BUNDLE:-${APP_BUNDLE:-}}"
DEV_APP_BUNDLE="$ROOT_DIR/.run/${APP_NAME}.app"
LOG_PATH="${ALISIO_RESTART_LOG:-/tmp/alisio-restart.log}"
LOCK_KEY="$(printf '%s' "$ROOT_DIR" | shasum -a 256 | cut -c1-8)"
LOCK_DIR="${TMPDIR:-/tmp}/alisio-restart-${LOCK_KEY}"
WAIT_FOR_LOCK=0
NO_SIGN=0

log() { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

run_step() {
  local label="$1"
  shift
  log "==> ${label}"
  "$@" || fail "${label} falhou"
}

acquire_lock() {
  while true; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf '%s\n' "$$" >"$LOCK_DIR/pid"
      return 0
    fi
    local existing_pid=""
    existing_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
      if [[ "$WAIT_FOR_LOCK" == "1" ]]; then
        sleep 1
        continue
      fi
      fail "Já existe outro restart em curso (pid ${existing_pid}). Usa --wait."
    fi
    rm -rf "$LOCK_DIR"
  done
}

cleanup() {
  rm -rf "$LOCK_DIR" 2>/dev/null || true
}

for arg in "$@"; do
  case "$arg" in
    --wait|-w) WAIT_FOR_LOCK=1 ;;
    --no-sign) NO_SIGN=1 ;;
    --help|-h)
      cat <<EOF
Uso: $(basename "$0") [--wait] [--no-sign]
EOF
      exit 0
      ;;
  esac
done

trap cleanup EXIT INT TERM

mkdir -p "$(dirname "$LOG_PATH")"
rm -f "$LOG_PATH"
exec > >(tee "$LOG_PATH") 2>&1

export PATH="${ROOT_DIR}/node_modules/.bin:${PATH}"
acquire_lock

pkill -f "${APP_NAME}.app/Contents/MacOS/${APP_EXECUTABLE}" 2>/dev/null || true
pkill -x "$APP_EXECUTABLE" 2>/dev/null || true
launchctl bootout gui/"$UID"/"$(alisio_bundle_domain).mac" 2>/dev/null || true

run_step "bundle canvas a2ui" bash -lc "cd '$ROOT_DIR' && pnpm canvas:a2ui:bundle"
# Keep the bundled Control UI aligned with the checkout before packaging/relaunch.
run_step "build control ui" bash -lc "cd '$ROOT_DIR' && pnpm ui:build"
run_step "swift build" bash -lc "cd '$ROOT_DIR/apps/macos' && swift build -q --product '$PRODUCT'"

if [[ "$NO_SIGN" == "1" ]]; then
  export ALLOW_ADHOC_SIGNING=1
  export SIGN_IDENTITY="-"
fi

if [[ -z "$APP_BUNDLE" ]]; then
  APP_BUNDLE="$DEV_APP_BUNDLE"
fi

run_step "package app" bash -lc "cd '$ROOT_DIR' && SKIP_TSC=${SKIP_TSC:-1} MACOS_FINAL_APP_PATH='$APP_BUNDLE' bash '$ROOT_DIR/scripts/package-mac-app.sh'"
[[ -d "$APP_BUNDLE" ]] || fail "App bundle não encontrado. Define ALISIO_APP_BUNDLE."

run_step "open app" open "$APP_BUNDLE"
log "==> Log: ${LOG_PATH}"
