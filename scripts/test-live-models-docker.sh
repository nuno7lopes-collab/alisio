#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/live-docker-auth.sh"
IMAGE_NAME="${ALISIO_IMAGE:-alisio:local}"
LIVE_IMAGE_NAME="${ALISIO_LIVE_IMAGE:-${IMAGE_NAME}-live}"
CONFIG_DIR="${ALISIO_CONFIG_DIR:-$HOME/.alisio}"
WORKSPACE_DIR="${ALISIO_WORKSPACE_DIR:-$HOME/.alisio/workspace}"
PROFILE_FILE="${ALISIO_PROFILE_FILE:-$HOME/.profile}"

PROFILE_MOUNT=()
if [[ -f "$PROFILE_FILE" ]]; then
  PROFILE_MOUNT=(-v "$PROFILE_FILE":/home/node/.profile:ro)
fi

AUTH_DIRS=()
if [[ -n "${ALISIO_DOCKER_AUTH_DIRS:-}" ]]; then
  while IFS= read -r auth_dir; do
    [[ -n "$auth_dir" ]] || continue
    AUTH_DIRS+=("$auth_dir")
  done < <(alisio_live_collect_auth_dirs)
elif [[ -n "${ALISIO_LIVE_PROVIDERS:-}" && -n "${ALISIO_LIVE_GATEWAY_PROVIDERS:-}" ]]; then
  while IFS= read -r auth_dir; do
    [[ -n "$auth_dir" ]] || continue
    AUTH_DIRS+=("$auth_dir")
  done < <(
    {
      alisio_live_collect_auth_dirs_from_csv "${ALISIO_LIVE_PROVIDERS:-}"
      alisio_live_collect_auth_dirs_from_csv "${ALISIO_LIVE_GATEWAY_PROVIDERS:-}"
    } | awk '!seen[$0]++'
  )
else
  while IFS= read -r auth_dir; do
    [[ -n "$auth_dir" ]] || continue
    AUTH_DIRS+=("$auth_dir")
  done < <(alisio_live_collect_auth_dirs)
fi
AUTH_DIRS_CSV="$(alisio_live_join_csv "${AUTH_DIRS[@]}")"

EXTERNAL_AUTH_MOUNTS=()
for auth_dir in "${AUTH_DIRS[@]}"; do
  host_path="$HOME/$auth_dir"
  if [[ -d "$host_path" ]]; then
    EXTERNAL_AUTH_MOUNTS+=(-v "$host_path":/host-auth/"$auth_dir":ro)
  fi
done

read -r -d '' LIVE_TEST_CMD <<'EOF' || true
set -euo pipefail
[ -f "$HOME/.profile" ] && source "$HOME/.profile" || true
IFS=',' read -r -a auth_dirs <<<"${ALISIO_DOCKER_AUTH_DIRS_RESOLVED:-}"
for auth_dir in "${auth_dirs[@]}"; do
  [ -n "$auth_dir" ] || continue
  if [ -d "/host-auth/$auth_dir" ]; then
    mkdir -p "$HOME/$auth_dir"
    cp -R "/host-auth/$auth_dir/." "$HOME/$auth_dir"
    chmod -R u+rwX "$HOME/$auth_dir" || true
  fi
done
tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT
tar -C /src \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=ui/dist \
  --exclude=ui/node_modules \
  -cf - . | tar -C "$tmp_dir" -xf -
ln -s /app/node_modules "$tmp_dir/node_modules"
ln -s /app/dist "$tmp_dir/dist"
if [ -d /app/dist-runtime/extensions ]; then
  export ALISIO_BUNDLED_PLUGINS_DIR=/app/dist-runtime/extensions
elif [ -d /app/dist/extensions ]; then
  export ALISIO_BUNDLED_PLUGINS_DIR=/app/dist/extensions
fi
cd "$tmp_dir"
pnpm test:live
EOF

echo "==> Build live-test image: $LIVE_IMAGE_NAME (target=build)"
docker build --target build -t "$LIVE_IMAGE_NAME" -f "$ROOT_DIR/Dockerfile" "$ROOT_DIR"

echo "==> Run live model tests (profile keys)"
echo "==> External auth dirs: ${AUTH_DIRS_CSV:-none}"
docker run --rm -t \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS=--disable-warning=ExperimentalWarning \
  -e ALISIO_SKIP_CHANNELS=1 \
  -e ALISIO_DOCKER_AUTH_DIRS_RESOLVED="$AUTH_DIRS_CSV" \
  -e ALISIO_LIVE_TEST=1 \
  -e ALISIO_LIVE_MODELS="${ALISIO_LIVE_MODELS:-modern}" \
  -e ALISIO_LIVE_PROVIDERS="${ALISIO_LIVE_PROVIDERS:-}" \
  -e ALISIO_LIVE_MAX_MODELS="${ALISIO_LIVE_MAX_MODELS:-48}" \
  -e ALISIO_LIVE_MODEL_TIMEOUT_MS="${ALISIO_LIVE_MODEL_TIMEOUT_MS:-}" \
  -e ALISIO_LIVE_REQUIRE_PROFILE_KEYS="${ALISIO_LIVE_REQUIRE_PROFILE_KEYS:-}" \
  -e ALISIO_LIVE_GATEWAY_MODELS="${ALISIO_LIVE_GATEWAY_MODELS:-}" \
  -e ALISIO_LIVE_GATEWAY_PROVIDERS="${ALISIO_LIVE_GATEWAY_PROVIDERS:-}" \
  -e ALISIO_LIVE_GATEWAY_MAX_MODELS="${ALISIO_LIVE_GATEWAY_MAX_MODELS:-}" \
  -v "$ROOT_DIR":/src:ro \
  -v "$CONFIG_DIR":/home/node/.alisio \
  -v "$WORKSPACE_DIR":/home/node/.alisio/workspace \
  "${EXTERNAL_AUTH_MOUNTS[@]}" \
  "${PROFILE_MOUNT[@]}" \
  "$LIVE_IMAGE_NAME" \
  -lc "$LIVE_TEST_CMD"
