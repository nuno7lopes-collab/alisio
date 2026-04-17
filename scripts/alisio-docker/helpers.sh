#!/usr/bin/env bash
# Alisio Docker Helpers
# Inspired by Simon Willison's "Running Alisio in Docker"
# https://til.simonwillison.net/llms/alisio-docker
#
# Installation:
#   mkdir -p ~/.alisio-docker && curl -sL https://raw.githubusercontent.com/alisio/alisio/main/scripts/alisio-docker/helpers.sh -o ~/.alisio-docker/helpers.sh
#   echo 'source ~/.alisio-docker/helpers.sh' >> ~/.zshrc
#
# Usage:
#   alisio-docker-help    # Show all available commands

# =============================================================================
# Colors
# =============================================================================
_CLR_RESET='\033[0m'
_CLR_BOLD='\033[1m'
_CLR_DIM='\033[2m'
_CLR_GREEN='\033[0;32m'
_CLR_YELLOW='\033[1;33m'
_CLR_BLUE='\033[0;34m'
_CLR_MAGENTA='\033[0;35m'
_CLR_CYAN='\033[0;36m'
_CLR_RED='\033[0;31m'

_clr_cmd() {
  echo -e "${_CLR_GREEN}${_CLR_BOLD}$1${_CLR_RESET}"
}

_cmd() {
  echo "${_CLR_GREEN}${_CLR_BOLD}$1${_CLR_RESET}"
}

# =============================================================================
# Config
# =============================================================================
ALISIO_DOCKER_CONFIG="${HOME}/.alisio-docker/config"

ALISIO_DOCKER_COMMON_PATHS=(
  "${HOME}/alisio"
  "${HOME}/workspace/alisio"
  "${HOME}/projects/alisio"
  "${HOME}/dev/alisio"
  "${HOME}/code/alisio"
  "${HOME}/src/alisio"
)

_alisio_docker_filter_warnings() {
  grep -v "^WARN\|^time="
}

_alisio_docker_trim_quotes() {
  local value="$1"
  value="${value#\"}"
  value="${value%\"}"
  printf "%s" "$value"
}

_alisio_docker_mask_value() {
  local value="$1"
  local length=${#value}
  if (( length == 0 )); then
    printf "%s" "<empty>"
    return 0
  fi
  if (( length == 1 )); then
    printf "%s" "<redacted:1 char>"
    return 0
  fi
  printf "%s" "<redacted:${length} chars>"
}

_alisio_docker_read_config_dir() {
  if [[ ! -f "$ALISIO_DOCKER_CONFIG" ]]; then
    return 1
  fi
  local raw
  raw=$(sed -n 's/^ALISIO_DOCKER_DIR=//p' "$ALISIO_DOCKER_CONFIG" | head -n 1)
  if [[ -z "$raw" ]]; then
    return 1
  fi
  _alisio_docker_trim_quotes "$raw"
}

_alisio_docker_ensure_dir() {
  if [[ -n "$ALISIO_DOCKER_DIR" && -f "${ALISIO_DOCKER_DIR}/docker-compose.yml" ]]; then
    return 0
  fi

  local config_dir
  config_dir=$(_alisio_docker_read_config_dir)
  if [[ -n "$config_dir" && -f "${config_dir}/docker-compose.yml" ]]; then
    ALISIO_DOCKER_DIR="$config_dir"
    return 0
  fi

  local found_path=""
  for path in "${ALISIO_DOCKER_COMMON_PATHS[@]}"; do
    if [[ -f "${path}/docker-compose.yml" ]]; then
      found_path="$path"
      break
    fi
  done

  if [[ -n "$found_path" ]]; then
    echo ""
    echo "🦞 Found Alisio at: $found_path"
    echo -n "   Use this location? [Y/n] "
    read -r response
    if [[ "$response" =~ ^[Nn] ]]; then
      echo ""
      echo "Set ALISIO_DOCKER_DIR manually:"
      echo "  export ALISIO_DOCKER_DIR=/path/to/alisio"
      return 1
    fi
    ALISIO_DOCKER_DIR="$found_path"
  else
    echo ""
    echo "❌ Alisio not found in common locations."
    echo ""
    echo "Clone it first:"
    echo ""
    echo "  git clone https://github.com/alisio/alisio.git ~/alisio"
    echo "  cd ~/alisio && ./scripts/docker/setup.sh"
    echo ""
    echo "Or set ALISIO_DOCKER_DIR if it's elsewhere:"
    echo ""
    echo "  export ALISIO_DOCKER_DIR=/path/to/alisio"
    echo ""
    return 1
  fi

  if [[ ! -d "${HOME}/.alisio-docker" ]]; then
    /bin/mkdir -p "${HOME}/.alisio-docker"
  fi
  echo "ALISIO_DOCKER_DIR=\"$ALISIO_DOCKER_DIR\"" > "$ALISIO_DOCKER_CONFIG"
  echo "✅ Saved to $ALISIO_DOCKER_CONFIG"
  echo ""
  return 0
}

_alisio_docker_compose() {
  _alisio_docker_ensure_dir || return 1
  local compose_args=(-f "${ALISIO_DOCKER_DIR}/docker-compose.yml")
  if [[ -f "${ALISIO_DOCKER_DIR}/docker-compose.extra.yml" ]]; then
    compose_args+=(-f "${ALISIO_DOCKER_DIR}/docker-compose.extra.yml")
  fi
  command docker compose "${compose_args[@]}" "$@"
}

_alisio_docker_read_env_token() {
  _alisio_docker_ensure_dir || return 1
  if [[ ! -f "${ALISIO_DOCKER_DIR}/.env" ]]; then
    return 1
  fi
  local raw
  raw=$(sed -n 's/^ALISIO_GATEWAY_TOKEN=//p' "${ALISIO_DOCKER_DIR}/.env" | head -n 1)
  if [[ -z "$raw" ]]; then
    return 1
  fi
  _alisio_docker_trim_quotes "$raw"
}

alisio-docker-start() {
  _alisio_docker_compose up -d alisio-gateway
}

alisio-docker-stop() {
  _alisio_docker_compose down
}

alisio-docker-restart() {
  _alisio_docker_compose restart alisio-gateway
}

alisio-docker-logs() {
  _alisio_docker_compose logs -f alisio-gateway
}

alisio-docker-status() {
  _alisio_docker_compose ps
}

alisio-docker-cd() {
  _alisio_docker_ensure_dir || return 1
  cd "${ALISIO_DOCKER_DIR}"
}

alisio-docker-config() {
  cd ~/.alisio
}

alisio-docker-show-config() {
  _alisio_docker_ensure_dir >/dev/null 2>&1 || true
  local config_dir="${HOME}/.alisio"
  echo -e "${_CLR_BOLD}Config directory:${_CLR_RESET} ${_CLR_CYAN}${config_dir}${_CLR_RESET}"
  echo ""

  if [[ -f "${config_dir}/alisio.json" ]]; then
    echo -e "${_CLR_BOLD}${config_dir}/alisio.json${_CLR_RESET}"
    echo -e "${_CLR_DIM}$(cat "${config_dir}/alisio.json")${_CLR_RESET}"
  else
    echo -e "${_CLR_YELLOW}No alisio.json found${_CLR_RESET}"
  fi
  echo ""

  if [[ -f "${config_dir}/.env" ]]; then
    echo -e "${_CLR_BOLD}${config_dir}/.env${_CLR_RESET}"
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "$line" ]]; then
        echo -e "${_CLR_DIM}${line}${_CLR_RESET}"
      elif [[ "$line" == *=* ]]; then
        local key="${line%%=*}"
        local val="${line#*=}"
        echo -e "${_CLR_CYAN}${key}${_CLR_RESET}=${_CLR_DIM}$(_alisio_docker_mask_value "$val")${_CLR_RESET}"
      else
        echo -e "${_CLR_DIM}${line}${_CLR_RESET}"
      fi
    done < "${config_dir}/.env"
  else
    echo -e "${_CLR_YELLOW}No .env found${_CLR_RESET}"
  fi
  echo ""

  if [[ -n "$ALISIO_DOCKER_DIR" && -f "${ALISIO_DOCKER_DIR}/.env" ]]; then
    echo -e "${_CLR_BOLD}${ALISIO_DOCKER_DIR}/.env${_CLR_RESET}"
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "$line" ]]; then
        echo -e "${_CLR_DIM}${line}${_CLR_RESET}"
      elif [[ "$line" == *=* ]]; then
        local key="${line%%=*}"
        local val="${line#*=}"
        echo -e "${_CLR_CYAN}${key}${_CLR_RESET}=${_CLR_DIM}$(_alisio_docker_mask_value "$val")${_CLR_RESET}"
      else
        echo -e "${_CLR_DIM}${line}${_CLR_RESET}"
      fi
    done < "${ALISIO_DOCKER_DIR}/.env"
  fi
  echo ""
}

alisio-docker-workspace() {
  cd ~/.alisio/workspace
}

alisio-docker-shell() {
  _alisio_docker_compose exec alisio-gateway \
    bash -c 'echo "alias alisio=\"./alisio.mjs\"" > /tmp/.bashrc_alisio && bash --rcfile /tmp/.bashrc_alisio'
}

alisio-docker-exec() {
  _alisio_docker_compose exec alisio-gateway "$@"
}

alisio-docker-cli() {
  _alisio_docker_compose run --rm alisio-cli "$@"
}

alisio-docker-update() {
  _alisio_docker_ensure_dir || return 1

  echo "🔄 Updating Alisio..."
  echo ""
  echo "📥 Pulling latest source..."
  git -C "${ALISIO_DOCKER_DIR}" pull || { echo "❌ git pull failed"; return 1; }

  echo ""
  echo "🔨 Rebuilding Docker image (this may take a few minutes)..."
  _alisio_docker_compose build alisio-gateway || { echo "❌ Build failed"; return 1; }

  echo ""
  echo "♻️  Recreating container with new image..."
  _alisio_docker_compose down 2>&1 | _alisio_docker_filter_warnings
  _alisio_docker_compose up -d alisio-gateway 2>&1 | _alisio_docker_filter_warnings

  echo ""
  echo "⏳ Waiting for gateway to start..."
  sleep 5

  echo "✅ Update complete!"
  echo -e "   Verify: $(_cmd alisio-docker-cli status)"
}

alisio-docker-rebuild() {
  _alisio_docker_compose build alisio-gateway
}

alisio-docker-clean() {
  _alisio_docker_compose down -v --remove-orphans
}

alisio-docker-health() {
  _alisio_docker_ensure_dir || return 1
  local token
  token=$(_alisio_docker_read_env_token)
  if [[ -z "$token" ]]; then
    echo "❌ Error: Could not find gateway token"
    echo "   Check: ${ALISIO_DOCKER_DIR}/.env"
    return 1
  fi
  _alisio_docker_compose exec -e "ALISIO_GATEWAY_TOKEN=$token" alisio-gateway \
    node dist/index.js health
}

alisio-docker-token() {
  _alisio_docker_read_env_token
}

alisio-docker-fix-token() {
  _alisio_docker_ensure_dir || return 1

  echo "🔧 Configuring gateway token..."
  local token
  token=$(alisio-docker-token)
  if [[ -z "$token" ]]; then
    echo "❌ Error: Could not find gateway token"
    echo "   Check: ${ALISIO_DOCKER_DIR}/.env"
    return 1
  fi

  echo "📝 Setting token: ${token:0:20}..."

  _alisio_docker_compose exec -e "TOKEN=$token" alisio-gateway \
    bash -c './alisio.mjs config set gateway.remote.token "$TOKEN" && ./alisio.mjs config set gateway.auth.token "$TOKEN"' 2>&1 | _alisio_docker_filter_warnings

  echo "🔍 Verifying token was saved..."
  local saved_token
  saved_token=$(_alisio_docker_compose exec alisio-gateway \
    bash -c "./alisio.mjs config get gateway.remote.token 2>/dev/null" 2>&1 | _alisio_docker_filter_warnings | tr -d '\r\n' | head -c 64)

  if [[ "$saved_token" == "$token" ]]; then
    echo "✅ Token saved correctly!"
  else
    echo "⚠️  Token mismatch detected"
    echo "   Expected: ${token:0:20}..."
    echo "   Got: ${saved_token:0:20}..."
  fi

  echo "🔄 Restarting gateway..."
  _alisio_docker_compose restart alisio-gateway 2>&1 | _alisio_docker_filter_warnings

  echo "⏳ Waiting for gateway to start..."
  sleep 5

  echo "✅ Configuration complete!"
  echo -e "   Try: $(_cmd alisio-docker-devices)"
}

alisio-docker-dashboard() {
  _alisio_docker_ensure_dir || return 1

  echo "🦞 Getting dashboard URL..."
  local output exit_status url
  output=$(_alisio_docker_compose run --rm alisio-cli dashboard --no-open 2>&1)
  exit_status=$?
  url=$(printf "%s\n" "$output" | _alisio_docker_filter_warnings | grep -o 'http[s]\?://[^[:space:]]*' | head -n 1)
  if [[ $exit_status -ne 0 ]]; then
    echo "❌ Failed to get dashboard URL"
    echo -e "   Try restarting: $(_cmd alisio-docker-restart)"
    return 1
  fi

  if [[ -n "$url" ]]; then
    echo -e "✅ Opening: ${_CLR_CYAN}${url}${_CLR_RESET}"
    open "$url" 2>/dev/null || xdg-open "$url" 2>/dev/null || echo -e "   Please open manually: ${_CLR_CYAN}${url}${_CLR_RESET}"
    echo ""
    echo -e "${_CLR_CYAN}💡 If you see ${_CLR_RED}'pairing required'${_CLR_CYAN} error:${_CLR_RESET}"
    echo -e "   1. Run: $(_cmd alisio-docker-devices)"
    echo "   2. Copy the Request ID from the Pending table"
    echo -e "   3. Run: $(_cmd 'alisio-docker-approve <request-id>')"
  else
    echo "❌ Failed to get dashboard URL"
    echo -e "   Try restarting: $(_cmd alisio-docker-restart)"
  fi
}

alisio-docker-devices() {
  _alisio_docker_ensure_dir || return 1

  echo "🔍 Checking device pairings..."
  local output exit_status
  output=$(_alisio_docker_compose exec alisio-gateway node dist/index.js devices list 2>&1)
  exit_status=$?
  printf "%s\n" "$output" | _alisio_docker_filter_warnings
  if [ $exit_status -ne 0 ]; then
    echo ""
    echo -e "${_CLR_CYAN}💡 If you see token errors above:${_CLR_RESET}"
    echo -e "   1. Verify token is set: $(_cmd alisio-docker-token)"
    echo -e "   2. Try fixing the token automatically: $(_cmd alisio-docker-fix-token)"
    echo "   3. If you still see errors, try manual config inside container:"
    echo -e "      $(_cmd alisio-docker-shell)"
    echo -e "      $(_cmd 'alisio config get gateway.remote.token')"
    return 1
  fi

  echo ""
  echo -e "${_CLR_CYAN}💡 To approve a pairing request:${_CLR_RESET}"
  echo -e "   $(_cmd 'alisio-docker-approve <request-id>')"
}

alisio-docker-approve() {
  _alisio_docker_ensure_dir || return 1

  if [[ -z "$1" ]]; then
    echo -e "❌ Usage: $(_cmd 'alisio-docker-approve <request-id>')"
    echo ""
    echo -e "${_CLR_CYAN}💡 How to approve a device:${_CLR_RESET}"
    echo -e "   1. Run: $(_cmd alisio-docker-devices)"
    echo "   2. Find the Request ID in the Pending table (long UUID)"
    echo -e "   3. Run: $(_cmd 'alisio-docker-approve <that-request-id>')"
    echo ""
    echo "Example:"
    echo -e "   $(_cmd 'alisio-docker-approve 6f9db1bd-a1cc-4d3f-b643-2c195262464e')"
    return 1
  fi

  echo "✅ Approving device: $1"
  _alisio_docker_compose exec alisio-gateway \
    node dist/index.js devices approve "$1" 2>&1 | _alisio_docker_filter_warnings

  echo ""
  echo "✅ Device approved! Refresh your browser."
}

alisio-docker-help() {
  echo -e "\n${_CLR_BOLD}${_CLR_CYAN}🦞 Alisio Docker Helpers${_CLR_RESET}\n"

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}⚡ Basic Operations${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-start)       ${_CLR_DIM}Start the gateway${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-stop)        ${_CLR_DIM}Stop the gateway${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-restart)     ${_CLR_DIM}Restart the gateway${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-status)      ${_CLR_DIM}Check container status${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-logs)        ${_CLR_DIM}View live logs (follows)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🐚 Container Access${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-shell)       ${_CLR_DIM}Shell into container (alisio alias ready)${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-cli)         ${_CLR_DIM}Run CLI commands (e.g., alisio-docker-cli status)${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-exec) ${_CLR_CYAN}<cmd>${_CLR_RESET}  ${_CLR_DIM}Execute command in gateway container${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🌐 Web UI & Devices${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-dashboard)   ${_CLR_DIM}Open web UI in browser ${_CLR_CYAN}(auto-guides you)${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-devices)     ${_CLR_DIM}List device pairings ${_CLR_CYAN}(auto-guides you)${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-approve) ${_CLR_CYAN}<id>${_CLR_RESET} ${_CLR_DIM}Approve device pairing ${_CLR_CYAN}(with examples)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}⚙️  Setup & Configuration${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-fix-token)   ${_CLR_DIM}Configure gateway token ${_CLR_CYAN}(run once)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🔧 Maintenance${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-update)      ${_CLR_DIM}Pull, rebuild, and restart ${_CLR_CYAN}(one-command update)${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-rebuild)     ${_CLR_DIM}Rebuild Docker image only${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-clean)       ${_CLR_RED}⚠️  Remove containers & volumes (nuclear)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🛠️  Utilities${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-health)      ${_CLR_DIM}Run health check${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-token)       ${_CLR_DIM}Show gateway auth token${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-cd)          ${_CLR_DIM}Jump to alisio project directory${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-config)      ${_CLR_DIM}Open config directory (~/.alisio)${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-show-config) ${_CLR_DIM}Print config files with redacted values${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-workspace)   ${_CLR_DIM}Open workspace directory${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${_CLR_RESET}"
  echo -e "${_CLR_BOLD}${_CLR_GREEN}🚀 First Time Setup${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  1.${_CLR_RESET} $(_cmd alisio-docker-start)          ${_CLR_DIM}# Start the gateway${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  2.${_CLR_RESET} $(_cmd alisio-docker-fix-token)      ${_CLR_DIM}# Configure token${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  3.${_CLR_RESET} $(_cmd alisio-docker-dashboard)      ${_CLR_DIM}# Open web UI${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  4.${_CLR_RESET} $(_cmd alisio-docker-devices)        ${_CLR_DIM}# If pairing needed${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  5.${_CLR_RESET} $(_cmd alisio-docker-approve) ${_CLR_CYAN}<id>${_CLR_RESET}   ${_CLR_DIM}# Approve pairing${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_GREEN}💬 WhatsApp Setup${_CLR_RESET}"
  echo -e "  $(_cmd alisio-docker-shell)"
  echo -e "    ${_CLR_BLUE}>${_CLR_RESET} $(_cmd 'alisio channels login --channel whatsapp')"
  echo -e "    ${_CLR_BLUE}>${_CLR_RESET} $(_cmd 'alisio status')"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_CYAN}💡 All commands guide you through next steps!${_CLR_RESET}"
  echo -e "${_CLR_BLUE}📚 Docs: ${_CLR_RESET}${_CLR_CYAN}https://docs.alisio.ai/install/alisio-docker${_CLR_RESET}"
  echo ""
}
