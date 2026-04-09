#!/usr/bin/env bash
set -euo pipefail

REPO_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../lib/alisio-branding.sh
source "$REPO_PATH/scripts/lib/alisio-branding.sh"

APP_SLUG="$(alisio_app_slug)"
STATE_DIR_NAME="$(alisio_state_dir_name)"
CONFIG_FILE_NAME="$(alisio_config_file_name)"
RUN_SCRIPT_SRC="$REPO_PATH/scripts/run-alisio-podman.sh"
QUADLET_TEMPLATE="$REPO_PATH/scripts/podman/alisio.container.in"
QUADLET_MODE="$(alisio_read_prefixed_env PODMAN_QUADLET 0)"
CONFIG_DIR="$(alisio_read_prefixed_env CONFIG_DIR "$HOME/${STATE_DIR_NAME}")"
WORKSPACE_DIR="$(alisio_read_prefixed_env WORKSPACE_DIR "$CONFIG_DIR/workspace")"
IMAGE_NAME="$(alisio_read_prefixed_env PODMAN_IMAGE "${APP_SLUG}:local")"
CONTAINER_NAME="$(alisio_read_prefixed_env PODMAN_CONTAINER "$APP_SLUG")"
HOST_GATEWAY_PORT="$(alisio_read_prefixed_env PODMAN_GATEWAY_HOST_PORT "$(alisio_read_prefixed_env GATEWAY_PORT 40705)")"
GATEWAY_BIND="$(alisio_read_prefixed_env GATEWAY_BIND loopback)"
ENV_FILE="$(alisio_read_prefixed_env PODMAN_ENV "${CONFIG_DIR}/.env")"
CONFIG_JSON="${CONFIG_DIR}/${CONFIG_FILE_NAME}"

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1"
}

render_quadlet() {
  local quadlet_dir="$HOME/.config/containers/systemd"
  local quadlet_dst="$quadlet_dir/${APP_SLUG}.container"
  mkdir -p "$quadlet_dir"
  sed \
    -e "s|{{CONTAINER_NAME}}|${CONTAINER_NAME}|g" \
    -e "s|{{IMAGE_NAME}}|${IMAGE_NAME}|g" \
    -e "s|{{CONFIG_DIR}}|${CONFIG_DIR}|g" \
    -e "s|{{WORKSPACE_DIR}}|${WORKSPACE_DIR}|g" \
    -e "s|{{HOST_GATEWAY_PORT}}|${HOST_GATEWAY_PORT}|g" \
    -e "s|{{GATEWAY_BIND}}|${GATEWAY_BIND}|g" \
    -e "s|{{ENV_FILE}}|${ENV_FILE}|g" \
    -e "s|{{LEGACY_STATE_ENV}}|$(alisio_legacy_env_name STATE_DIR)|g" \
    -e "s|{{LEGACY_CONFIG_ENV}}|$(alisio_legacy_env_name CONFIG_PATH)|g" \
    "$QUADLET_TEMPLATE" >"$quadlet_dst"
  systemctl --user daemon-reload
  systemctl --user enable --now "${APP_SLUG}.service"
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

write_env_file() {
  [[ -f "$ENV_FILE" ]] && return 0
  local token
  token="$(openssl rand -hex 32 2>/dev/null || python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
  cat >"$ENV_FILE" <<EOF
ALISIO_GATEWAY_TOKEN=${token}
$(alisio_legacy_env_name GATEWAY_TOKEN)=${token}
EOF
  chmod 600 "$ENV_FILE"
}

case "${1:-}" in
  --quadlet)
    QUADLET_MODE=1
    ;;
  --container|"")
    QUADLET_MODE=0
    ;;
  *)
    fail "Uso: ./scripts/podman/setup.sh [--quadlet|--container]"
    ;;
esac

require_cmd podman
require_cmd sed
install -d -m 700 "$CONFIG_DIR" "$WORKSPACE_DIR"
write_env_file
write_default_config

if [[ "$IMAGE_NAME" == "${APP_SLUG}:local" ]]; then
  podman build -t "$IMAGE_NAME" -f "$REPO_PATH/Dockerfile" "$REPO_PATH"
else
  podman pull "$IMAGE_NAME"
fi

if [[ "$QUADLET_MODE" == "1" ]]; then
  require_cmd systemctl
  render_quadlet
  printf 'Quadlet activo: systemctl --user status %s.service\n' "$APP_SLUG"
else
  printf 'Setup concluído. Arranque com: ./scripts/run-alisio-podman.sh launch\n'
  printf 'Env file activo: %s\n' "$ENV_FILE"
fi
