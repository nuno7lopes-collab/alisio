#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/alisio-branding.sh
source "$ROOT_DIR/scripts/lib/alisio-branding.sh"

APP_NAME="$(alisio_app_name)"
PACKAGE_DIR_NAME="$(alisio_package_dir_name)"
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

gateway_launch_agent_label() {
  local profile="${ALISIO_PROFILE:-}"
  local profile_lower=""
  profile="$(printf '%s' "$profile" | xargs)"
  profile_lower="$(printf '%s' "$profile" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$profile" || "$profile_lower" == "default" ]]; then
    printf '%s\n' "ai.alisio.gateway"
    return
  fi
  printf 'ai.alisio.%s\n' "$profile"
}

show_help() {
  cat <<EOF
Uso: $(basename "$0") [--wait] [--sign|--no-sign]

Faz o ciclo pesado do macOS:
  1. empacota um bundle real em ${DEV_APP_BUNDLE}
  2. valida assinatura + estrutura do bundle
  3. relança a app com esse bundle

Usa este script quando precisas de validar bundle real, signing, TCC, launchd
ou packaging. Não é o loop leve do dia a dia para iterar no frontend/runtime.

Loop leve:
  pnpm mac:dev:app
  pnpm mac:dev:gateway

Opções:
  --wait, -w   espera se já existir outro restart em curso
  --sign       usa a estratégia normal de signing do packager
  --no-sign    força ad-hoc signing; permissões TCC não persistem
  --help, -h   mostra esta ajuda
EOF
}

validate_app_bundle() {
  local bundle_path="$1"
  local package_root="$bundle_path/Contents/Resources/$PACKAGE_DIR_NAME"
  local bundled_node="$package_root/tools/node/bin/node"
  [[ -d "$bundle_path" ]] || fail "App bundle não encontrado em $bundle_path."
  [[ -f "$bundle_path/Contents/Info.plist" ]] || fail "App bundle sem Info.plist em $bundle_path."
  [[ -x "$bundle_path/Contents/MacOS/$APP_EXECUTABLE" ]] \
    || fail "App bundle sem executável em $bundle_path/Contents/MacOS/$APP_EXECUTABLE."
  [[ -f "$package_root/package.json" ]] \
    || fail "Bundle sem runtime empacotado em $package_root/package.json."
  [[ -f "$package_root/alisio.mjs" || -f "$package_root/dist/index.js" ]] \
    || fail "Bundle sem entrypoint do runtime em $package_root."
  if [[ -x "$bundled_node" ]]; then
    "$bundled_node" -p 'process.execPath' >/dev/null \
      || fail "Node embutida não arranca em $bundled_node."
  fi
  /usr/bin/codesign -dv --verbose=2 "$bundle_path" >/dev/null 2>&1 \
    || fail "Assinatura inválida para $bundle_path."
}

wait_for_app_process() {
  local bundle_path="$1"
  local process_path="$bundle_path/Contents/MacOS/$APP_EXECUTABLE"
  local attempt
  for attempt in {1..30}; do
    if pgrep -f "$process_path" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "A app não arrancou a partir de $process_path."
}

wait_for_app_window() {
  local attempt
  local window_count=""
  for attempt in {1..20}; do
    window_count="$(
      osascript <<APPLESCRIPT 2>/dev/null || true
tell application "System Events"
  if exists process "$APP_NAME" then
    tell process "$APP_NAME"
      return count of windows
    end tell
  end if
end tell
return 0
APPLESCRIPT
    )"
    window_count="${window_count//[[:space:]]/}"
    if [[ "$window_count" =~ ^[1-9][0-9]*$ ]]; then
      return 0
    fi
    sleep 1
  done
  fail "A janela principal do $APP_NAME não ficou disponível após o arranque."
}

open_app_bundle() {
  local bundle_path="$1"
  # Force a fresh app instance so the heavy-loop smoke exercises the rebuilt bundle,
  # instead of reactivating an already-running Alisio from another path.
  open -n "$bundle_path" --args --chat || fail "Falha ao abrir $bundle_path."
  wait_for_app_process "$bundle_path"
  wait_for_app_window
}

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
    --sign) NO_SIGN=0 ;;
    --no-sign) NO_SIGN=1 ;;
    --help|-h) show_help; exit 0 ;;
    *) fail "Opção desconhecida: $arg" ;;
  esac
done

trap cleanup EXIT INT TERM

mkdir -p "$(dirname "$LOG_PATH")"
rm -f "$LOG_PATH"
exec > >(tee "$LOG_PATH") 2>&1

export PATH="${ROOT_DIR}/node_modules/.bin:${PATH}"
acquire_lock

GATEWAY_LAUNCH_AGENT_LABEL="$(gateway_launch_agent_label)"

pkill -f "${APP_NAME}.app/Contents/MacOS/${APP_EXECUTABLE}" 2>/dev/null || true
pkill -x "$APP_EXECUTABLE" 2>/dev/null || true
launchctl bootout gui/"$UID"/"$(alisio_bundle_domain).mac" 2>/dev/null || true
launchctl bootout gui/"$UID"/"$GATEWAY_LAUNCH_AGENT_LABEL" 2>/dev/null || true

if [[ "$NO_SIGN" == "1" ]]; then
  export ALLOW_ADHOC_SIGNING=1
  export SIGN_IDENTITY="-"
  log "==> Signing mode: ad-hoc (--no-sign); permissões TCC não persistem"
fi

if [[ -z "$APP_BUNDLE" ]]; then
  APP_BUNDLE="$DEV_APP_BUNDLE"
fi

log "==> Heavy macOS restart: package + relaunch de $APP_BUNDLE"
run_step "package app" bash -lc "cd '$ROOT_DIR' && MACOS_FINAL_APP_PATH='$APP_BUNDLE' bash '$ROOT_DIR/scripts/package-mac-app.sh'"
run_step "validate app bundle" validate_app_bundle "$APP_BUNDLE"

run_step "open app" open_app_bundle "$APP_BUNDLE"
log "==> Log: ${LOG_PATH}"
