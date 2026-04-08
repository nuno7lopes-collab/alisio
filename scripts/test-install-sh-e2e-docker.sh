#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${ALISIO_INSTALL_E2E_IMAGE:-alisio-install-e2e:local}"
INSTALL_URL="${ALISIO_INSTALL_URL:-https://alisio.pt/install.sh}"

OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ANTHROPIC_API_TOKEN="${ANTHROPIC_API_TOKEN:-}"
ALISIO_E2E_MODELS="${ALISIO_E2E_MODELS:-}"

echo "==> Build image: $IMAGE_NAME"
docker build \
  -t "$IMAGE_NAME" \
  -f "$ROOT_DIR/scripts/docker/install-sh-e2e/Dockerfile" \
  "$ROOT_DIR/scripts/docker/install-sh-e2e"

echo "==> Run E2E installer test"
docker run --rm \
  -e ALISIO_INSTALL_URL="$INSTALL_URL" \
  -e ALISIO_INSTALL_TAG="${ALISIO_INSTALL_TAG:-latest}" \
  -e ALISIO_E2E_MODELS="$ALISIO_E2E_MODELS" \
  -e ALISIO_INSTALL_E2E_PREVIOUS="${ALISIO_INSTALL_E2E_PREVIOUS:-}" \
  -e ALISIO_INSTALL_E2E_SKIP_PREVIOUS="${ALISIO_INSTALL_E2E_SKIP_PREVIOUS:-0}" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e ANTHROPIC_API_TOKEN="$ANTHROPIC_API_TOKEN" \
  "$IMAGE_NAME"
