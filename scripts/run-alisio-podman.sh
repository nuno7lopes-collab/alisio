#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/alisio-branding.sh
source "$ROOT_DIR/scripts/lib/alisio-branding.sh"

APP_SLUG="$(alisio_app_slug)"
STATE_DIR_NAME="$(alisio_state_dir_name)"
CONFIG_FILE_NAME="$(alisio_config_file_name)"
CONTAINER_STATE_DIR="/home/node/${STATE_DIR_NAME}"
CONTAINER_CONFIG_PATH="${CONTAINER_STATE_DIR}/${CONFIG_FILE_NAME}"
CONTAINER_NAME=""
IMAGE_NAME=""
CONFIG_DIR=""
WORKSPACE_DIR=""
HOST_GATEWAY_PORT=""
GATEWAY_BIND=""
ENV_FILE=""
CONFIG_JSON=""

legacy_env_name() {
  alisio_legacy_env_name "$1"
}

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1"
}

usage() {
  cat <<EOF
Rootless ${APP_SLUG} in Podman.

Uso:
  ./scripts/run-alisio-podman.sh launch [setup]
  ./scripts/run-alisio-podman.sh stop
  ./scripts/run-alisio-podman.sh status
  ./scripts/run-alisio-podman.sh logs
  ./scripts/run-alisio-podman.sh exec <args...>
  ./scripts/run-alisio-podman.sh setup-host [--quadlet|--container]
EOF
}

resolve_env_file_path() {
  local config_dir="$1"
  local explicit_env_file
  explicit_env_file="$(alisio_read_prefixed_env PODMAN_ENV "")"
  if [[ -n "$explicit_env_file" ]]; then
    printf '%s\n' "$explicit_env_file"
    return 0
  fi
  printf '%s\n' "${config_dir}/.env"
}

refresh_runtime_config() {
  CONFIG_DIR="$(alisio_read_prefixed_env CONFIG_DIR "$HOME/${STATE_DIR_NAME}")"
  WORKSPACE_DIR="$(alisio_read_prefixed_env WORKSPACE_DIR "$CONFIG_DIR/workspace")"
  HOST_GATEWAY_PORT="$(alisio_read_prefixed_env PODMAN_GATEWAY_HOST_PORT "$(alisio_read_prefixed_env GATEWAY_PORT 40705)")"
  GATEWAY_BIND="$(alisio_read_prefixed_env GATEWAY_BIND loopback)"
  CONTAINER_NAME="$(alisio_read_prefixed_env PODMAN_CONTAINER "$APP_SLUG")"
  IMAGE_NAME="$(alisio_read_prefixed_env PODMAN_IMAGE "${APP_SLUG}:local")"
  ENV_FILE="$(resolve_env_file_path "$CONFIG_DIR")"
  CONFIG_JSON="${CONFIG_DIR}/${CONFIG_FILE_NAME}"
}

ensure_not_root() {
  [[ "$(id -u)" -ne 0 ]] || fail "Corre este launcher como utilizador normal para manter Podman rootless."
}

ensure_dirs() {
  install -d -m 700 "$CONFIG_DIR" "$WORKSPACE_DIR"
}

load_env_file() {
  [[ -f "$ENV_FILE" ]] || return 0
  while IFS='=' read -r raw_key raw_value; do
    [[ -n "${raw_key:-}" ]] || continue
    [[ "${raw_key:0:1}" == "#" ]] && continue
    local key="${raw_key#"${raw_key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    local value="${raw_value:-}"
    value="${value%$'\r'}"
    export "$key=$value"
  done <"$ENV_FILE"
}

write_default_config() {
  [[ -f "$CONFIG_JSON" ]] && return 0
  cat >"$CONFIG_JSON" <<EOF
{
  "gateway": {
    "bind": "${GATEWAY_BIND}",
    "port": ${HOST_GATEWAY_PORT},
    "controlUi": {
      "enabled": true,
      "allowedOrigins": [
        "http://127.0.0.1:${HOST_GATEWAY_PORT}",
        "http://localhost:${HOST_GATEWAY_PORT}"
      ]
    }
  }
}
EOF
}

ensure_env_file() {
  [[ -f "$ENV_FILE" ]] && return 0
  local token
  token="$(openssl rand -hex 32 2>/dev/null || python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
  cat >"$ENV_FILE" <<EOF
ALISIO_GATEWAY_TOKEN=${token}
$(legacy_env_name GATEWAY_TOKEN)=${token}
ALISIO_STATE_DIR=${CONTAINER_STATE_DIR}
$(legacy_env_name STATE_DIR)=${CONTAINER_STATE_DIR}
ALISIO_CONFIG_PATH=${CONTAINER_CONFIG_PATH}
$(legacy_env_name CONFIG_PATH)=${CONTAINER_CONFIG_PATH}
EOF
  chmod 600 "$ENV_FILE"
}

resolve_cli() {
  if command -v "$APP_SLUG" >/dev/null 2>&1; then
    command -v "$APP_SLUG"
    return 0
  fi
  printf '%s\n' "$APP_SLUG"
}

run_container() {
  local cli
  cli="$(resolve_cli)"
  podman run -d \
    --name "$CONTAINER_NAME" \
    --replace \
    -p "${HOST_GATEWAY_PORT}:40705" \
    -e "ALISIO_STATE_DIR=${CONTAINER_STATE_DIR}" \
    -e "$(legacy_env_name STATE_DIR)=${CONTAINER_STATE_DIR}" \
    -e "ALISIO_CONFIG_PATH=${CONTAINER_CONFIG_PATH}" \
    -e "$(legacy_env_name CONFIG_PATH)=${CONTAINER_CONFIG_PATH}" \
    --env-file "$ENV_FILE" \
    -v "${CONFIG_DIR}:${CONTAINER_STATE_DIR}:Z" \
    -v "${WORKSPACE_DIR}:${CONTAINER_STATE_DIR}/workspace:Z" \
    "$IMAGE_NAME" \
    "$cli" gateway run --bind "$GATEWAY_BIND" --port 40705 --force
}

launch() {
  ensure_not_root
  require_cmd podman
  refresh_runtime_config
  load_env_file
  refresh_runtime_config
  ensure_dirs
  ensure_env_file
  write_default_config
  run_container >/dev/null
  printf 'Gateway disponível em http://127.0.0.1:%s\n' "$HOST_GATEWAY_PORT"
  if [[ "${1:-}" == "setup" ]]; then
    podman exec -it "$CONTAINER_NAME" "$(resolve_cli)" onboard || true
  fi
}

status() {
  podman ps --filter "name=${CONTAINER_NAME}"
}

stop_container() {
  podman rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

show_logs() {
  podman logs -f "$CONTAINER_NAME"
}

refresh_runtime_config
load_env_file
refresh_runtime_config
alisio_warn_legacy_env_usage stderr \
  PODMAN_ENV \
  CONFIG_DIR \
  WORKSPACE_DIR \
  PODMAN_CONTAINER \
  PODMAN_IMAGE \
  PODMAN_GATEWAY_HOST_PORT \
  GATEWAY_PORT \
  GATEWAY_TOKEN \
  GATEWAY_BIND

case "${1:-}" in
  launch)
    shift
    launch "${1:-}"
    ;;
  stop)
    stop_container
    ;;
  status)
    status
    ;;
  logs)
    show_logs
    ;;
  exec)
    shift
    podman exec -it "$CONTAINER_NAME" "$@"
    ;;
  setup-host)
    shift
    exec "$ROOT_DIR/scripts/podman/setup.sh" "$@"
    ;;
  --help|-h|"")
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac
