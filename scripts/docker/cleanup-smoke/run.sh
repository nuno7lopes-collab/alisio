#!/usr/bin/env bash
set -euo pipefail

cd /repo

export ALISIO_STATE_DIR="/tmp/alisio-test"
export ALISIO_CONFIG_PATH="${ALISIO_STATE_DIR}/alisio.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${ALISIO_STATE_DIR}/credentials"
mkdir -p "${ALISIO_STATE_DIR}/agents/main/sessions"
echo '{}' >"${ALISIO_CONFIG_PATH}"
echo 'creds' >"${ALISIO_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${ALISIO_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm alisio reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${ALISIO_CONFIG_PATH}"
test ! -d "${ALISIO_STATE_DIR}/credentials"
test ! -d "${ALISIO_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${ALISIO_STATE_DIR}/credentials"
echo '{}' >"${ALISIO_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm alisio uninstall --state --yes --non-interactive

test ! -d "${ALISIO_STATE_DIR}"

echo "OK"
