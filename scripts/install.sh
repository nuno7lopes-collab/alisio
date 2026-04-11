#!/usr/bin/env bash
set -euo pipefail

resolve_install_sh_root_dir() {
  if [[ -n "${ALISIO_INSTALL_SH_ROOT_DIR:-}" ]]; then
    printf '%s\n' "$ALISIO_INSTALL_SH_ROOT_DIR"
    return 0
  fi
  if [[ -n "${BASH_SOURCE[0]:-}" && "${BASH_SOURCE[0]}" != "bash" ]]; then
    cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
    return 0
  fi
  printf '%s\n' ""
}

install_sh_define_branding_fallbacks() {
  alisio_app_name() { printf '%s\n' "Alisio"; }
  alisio_app_slug() { printf '%s\n' "alisio"; }
  alisio_state_dir_name() { printf '%s\n' ".alisio"; }
  alisio_config_file_name() { printf '%s\n' "alisio.json"; }
  alisio_package_dir_name() { printf '%s\n' "alisio-package"; }
  alisio_legacy_slug() { alisio_app_slug; }
  alisio_legacy_env_name() { printf '%s_%s\n' "ALISIO" "${1:-}"; }
  alisio_read_prefixed_env() {
    local suffix="${1:-}"
    local default_value="${2:-}"
    local public_name="ALISIO_${suffix}"
    local legacy_name
    legacy_name="$(alisio_legacy_env_name "$suffix")"
    local public_value="${!public_name-}"
    if [[ -n "$public_value" ]]; then
      printf '%s\n' "$public_value"
      return 0
    fi
    local legacy_value="${!legacy_name-}"
    if [[ -n "$legacy_value" ]]; then
      printf '%s\n' "$legacy_value"
      return 0
    fi
    printf '%s\n' "$default_value"
  }
  alisio_warn_legacy_env_usage() { return 0; }
  alisio_export_legacy_env() {
    local suffix="${1:-}"
    local value="${2-}"
    local legacy_name
    legacy_name="$(alisio_legacy_env_name "$suffix")"
    export "${legacy_name}=${value}"
  }
  alisio_install_sh_url() { printf '%s\n' "https://alisio.pt/install.sh"; }
  alisio_install_ps1_url() { printf '%s\n' "https://alisio.pt/install.ps1"; }
  alisio_npm_package_spec() { printf '%s@%s\n' "$(alisio_app_slug)" "${1:-latest}"; }
  alisio_main_package_spec() { printf 'github:%s/%s#main\n' "$(alisio_app_slug)" "$(alisio_app_slug)"; }
  alisio_release_download_base() {
    local version="${1:-}"
    if [[ -z "$version" ]]; then
      return 1
    fi
    printf 'https://github.com/%s/%s/releases/download/v%s\n' "$(alisio_app_slug)" "$(alisio_app_slug)" "$version"
  }
  alisio_repo_https_url() {
    printf 'https://github.com/%s/%s.git\n' "$(alisio_app_slug)" "$(alisio_app_slug)"
  }
}

ROOT_DIR="$(resolve_install_sh_root_dir)"
if [[ -n "$ROOT_DIR" && -f "$ROOT_DIR/scripts/lib/alisio-branding.sh" ]]; then
  # shellcheck source=lib/alisio-branding.sh
  source "$ROOT_DIR/scripts/lib/alisio-branding.sh"
else
  install_sh_define_branding_fallbacks
fi

if ! declare -f extract_alisio_semver >/dev/null 2>&1; then
  extract_alisio_semver() {
    local raw="${1:-}"
    local parsed=""
    parsed="$(
      printf '%s\n' "$raw" \
        | tr -d '\r' \
        | grep -Eo 'v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?(\+[0-9A-Za-z.-]+)?' \
        | head -n 1 \
        || true
    )"
    printf '%s' "${parsed#v}"
  }
fi

APP_NAME="$(alisio_app_name)"
APP_SLUG="$(alisio_app_slug)"
STATE_DIR_NAME="$(alisio_state_dir_name)"
CONFIG_FILE_NAME="$(alisio_config_file_name)"
PACKAGE_DIR_NAME="$(alisio_package_dir_name)"
BOLD='\033[1m'
ACCENT='\033[38;2;255;77;77m'
SUCCESS='\033[38;2;0;229;204m'
WARN='\033[38;2;255;176;32m'
ERROR='\033[38;2;230;57;70m'
MUTED='\033[38;2;90;100;128m'
NC='\033[0m'

NODE_DEFAULT_MAJOR=24
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=14
DEFAULT_METHOD=""
REQUESTED_VERSION="$(alisio_read_prefixed_env VERSION latest)"
USE_BETA="$(alisio_read_prefixed_env BETA 0)"
NO_ONBOARD="$(alisio_read_prefixed_env NO_ONBOARD 0)"
NO_PROMPT="$(alisio_read_prefixed_env NO_PROMPT 0)"
DRY_RUN="$(alisio_read_prefixed_env DRY_RUN 0)"
VERIFY_INSTALL="$(alisio_read_prefixed_env VERIFY_INSTALL 0)"
VERBOSE="$(alisio_read_prefixed_env VERBOSE 0)"
GIT_DIR="$(alisio_read_prefixed_env GIT_DIR "$HOME/$APP_SLUG")"
GIT_UPDATE="$(alisio_read_prefixed_env GIT_UPDATE 1)"
DESKTOP_URL_OVERRIDE="$(alisio_read_prefixed_env DESKTOP_URL "")"
MAC_DESKTOP_ASSET_PATTERN="$(alisio_read_prefixed_env MAC_DESKTOP_ASSET_PATTERN "${APP_NAME}-%s.zip")"
HELP=0
OS=""
DOWNLOADER=""
CLI_BIN=""
CLI_BIN_DIR=""
DESKTOP_APP_PATH=""

ui_info() {
  echo -e "${MUTED}·${NC} $*"
}

ui_success() {
  echo -e "${SUCCESS}✓${NC} $*"
}

ui_warn() {
  echo -e "${WARN}!${NC} $*"
}

ui_error() {
  echo -e "${ERROR}✗${NC} $*" >&2
}

ui_section() {
  echo ""
  echo -e "${ACCENT}${BOLD}$*${NC}"
}

print_banner() {
  echo -e "${ACCENT}${BOLD}  Alisio Installer${NC}"
  echo -e "${MUTED}  Desktop-first setup for gateway + UI.${NC}"
  echo ""
}

print_usage() {
  cat <<EOF
Alisio installer (macOS, Linux, WSL)

Uso:
  curl -fsSL --proto '=https' --tlsv1.2 $(alisio_install_sh_url) | bash -s -- [opções]

Opções:
  --install-method, --method desktop|npm|git
  --desktop
  --npm
  --git
  --version <latest|beta|main|semver|spec>
  --beta
  --git-dir <path>
  --no-git-update
  --no-onboard
  --no-prompt
  --verify
  --dry-run
  --verbose
  --help, -h

Ambiente:
  ALISIO_INSTALL_METHOD
  ALISIO_VERSION
  ALISIO_BETA
  ALISIO_GIT_DIR
  ALISIO_GIT_UPDATE
  ALISIO_NO_ONBOARD
  ALISIO_NO_PROMPT
  ALISIO_VERIFY_INSTALL
  ALISIO_DRY_RUN
  ALISIO_VERBOSE
  ALISIO_DESKTOP_URL

Compatibilidade:
  As variáveis antigas continuam a ser lidas, mas só como fallback.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --install-method|--method)
        DEFAULT_METHOD="${2:-}"
        shift 2
        ;;
      --desktop)
        DEFAULT_METHOD="desktop"
        shift
        ;;
      --npm)
        DEFAULT_METHOD="npm"
        shift
        ;;
      --git)
        DEFAULT_METHOD="git"
        shift
        ;;
      --version)
        REQUESTED_VERSION="${2:-latest}"
        shift 2
        ;;
      --beta)
        USE_BETA=1
        shift
        ;;
      --git-dir|--dir)
        GIT_DIR="${2:-$GIT_DIR}"
        shift 2
        ;;
      --no-git-update)
        GIT_UPDATE=0
        shift
        ;;
      --no-onboard)
        NO_ONBOARD=1
        shift
        ;;
      --no-prompt)
        NO_PROMPT=1
        shift
        ;;
      --verify)
        VERIFY_INSTALL=1
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --verbose)
        VERBOSE=1
        shift
        ;;
      --help|-h)
        HELP=1
        shift
        ;;
      *)
        ui_warn "Ignorado argumento desconhecido: $1"
        shift
        ;;
    esac
  done
}

detect_os() {
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) OS="macos" ;;
    Linux)
      if [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
        OS="wsl"
      else
        OS="linux"
      fi
      ;;
    *)
      ui_error "Sistema operativo não suportado."
      echo "Para Windows usa PowerShell: iwr -useb $(alisio_install_ps1_url) | iex" >&2
      exit 1
      ;;
  esac
}

default_method_for_os() {
  case "$OS" in
    macos) printf '%s\n' "desktop" ;;
    *) printf '%s\n' "npm" ;;
  esac
}

detect_downloader() {
  if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
    return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
    return 0
  fi
  ui_error "Falta curl ou wget."
  exit 1
}

download_file() {
  local url="$1"
  local output="$2"
  detect_downloader
  if [[ "$DOWNLOADER" == "curl" ]]; then
    curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 1 -o "$output" "$url"
  else
    wget -q --https-only --secure-protocol=TLSv1_2 --tries=3 -O "$output" "$url"
  fi
}

run_cmd() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '[dry-run] %q' "$1"
    shift
    printf ' %q' "$@"
    echo ""
    return 0
  fi
  "$@"
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    ui_error "Falta dependência: $name"
    exit 1
  fi
}

resolve_alisio_version() {
  local cli_bin="${ALISIO_BIN:-${FAKE_ALISIO_BIN:-${ALISIO_BIN:-${FAKE_ALISIO_BIN:-${CLI_BIN:-}}}}}"
  if [[ -z "$cli_bin" ]]; then
    cli_bin="$(command -v "$APP_SLUG" 2>/dev/null || true)"
  fi
  if [[ -z "$cli_bin" ]]; then
    return 1
  fi
  local raw
  raw="$("$cli_bin" --version 2>/dev/null || true)"
  local parsed
  parsed="$(extract_alisio_semver "$raw")"
  printf '%s\n' "${parsed:-$raw}"
}

node_is_new_enough() {
  command -v node >/dev/null 2>&1 || return 1
  node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && minor >= 14) ? 0 : 1);
  ' >/dev/null 2>&1
}

ensure_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    return 0
  fi
  ui_info "A instalar Homebrew."
  run_cmd /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_linux_sudo() {
  if [[ "$OS" != "linux" && "$OS" != "wsl" ]]; then
    return 0
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    return 0
  fi
  require_command sudo
  sudo -v
}

ensure_node() {
  if node_is_new_enough; then
    ui_success "Node.js disponível: $(node -v)"
    return 0
  fi

  ui_section "Node.js"
  case "$OS" in
    macos)
      ensure_homebrew
      run_cmd brew install "node@${NODE_DEFAULT_MAJOR}"
      run_cmd brew link "node@${NODE_DEFAULT_MAJOR}" --overwrite --force
      ;;
    linux|wsl)
      ensure_linux_sudo
      if command -v apt-get >/dev/null 2>&1; then
        run_cmd sudo apt-get update -qq
        run_cmd sudo apt-get install -y -qq ca-certificates curl git
        local nodesource
        nodesource="$(mktemp)"
        download_file "https://deb.nodesource.com/setup_${NODE_DEFAULT_MAJOR}.x" "$nodesource"
        run_cmd sudo -E bash "$nodesource"
        rm -f "$nodesource"
        run_cmd sudo apt-get install -y -qq nodejs
      elif command -v pacman >/dev/null 2>&1; then
        run_cmd sudo pacman -Sy --noconfirm nodejs npm git
      elif command -v dnf >/dev/null 2>&1; then
        run_cmd sudo dnf install -y -q nodejs npm git
      elif command -v yum >/dev/null 2>&1; then
        run_cmd sudo yum install -y -q nodejs npm git
      else
        ui_error "Não consegui instalar Node.js automaticamente."
        echo "Instala Node.js ${NODE_DEFAULT_MAJOR}+ manualmente e volta a correr o installer." >&2
        exit 1
      fi
      ;;
  esac

  if ! node_is_new_enough; then
    ui_error "Node.js não ficou activo na shell actual."
    exit 1
  fi
  ui_success "Node.js pronto: $(node -v)"
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi
  ui_info "A instalar Git."
  case "$OS" in
    macos)
      ensure_homebrew
      run_cmd brew install git
      ;;
    linux|wsl)
      ensure_linux_sudo
      if command -v apt-get >/dev/null 2>&1; then
        run_cmd sudo apt-get install -y -qq git
      elif command -v pacman >/dev/null 2>&1; then
        run_cmd sudo pacman -Sy --noconfirm git
      elif command -v dnf >/dev/null 2>&1; then
        run_cmd sudo dnf install -y -q git
      elif command -v yum >/dev/null 2>&1; then
        run_cmd sudo yum install -y -q git
      else
        ui_error "Não consegui instalar Git automaticamente."
        exit 1
      fi
      ;;
  esac
}

configure_user_npm_prefix() {
  local prefix
  prefix="$(npm config get prefix 2>/dev/null || true)"
  if [[ -n "$prefix" && -w "$prefix" ]]; then
    return 0
  fi
  mkdir -p "$HOME/.npm-global"
  run_cmd npm config set prefix "$HOME/.npm-global"
  export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    run_cmd corepack enable
    run_cmd corepack prepare pnpm@10 --activate
    if command -v pnpm >/dev/null 2>&1; then
      return 0
    fi
  fi
  configure_user_npm_prefix
  run_cmd npm install -g pnpm@10
}

is_explicit_spec() {
  local value="${1:-}"
  [[ "$value" == *"://"* || "$value" == *"#"* || "$value" =~ ^(file|github|git\+ssh|git\+https|git\+http|git\+file|npm): ]]
}

resolve_requested_version() {
  local version="${REQUESTED_VERSION:-latest}"
  if [[ "$USE_BETA" == "1" ]]; then
    local beta_version=""
    beta_version="$(npm view "$APP_SLUG" dist-tags.beta 2>/dev/null || true)"
    if [[ -n "$beta_version" && "$beta_version" != "undefined" ]]; then
      version="$beta_version"
    fi
  fi
  printf '%s\n' "$version"
}

resolve_npm_install_spec() {
  local version="$1"
  local normalized_version
  normalized_version="$(printf '%s' "$version" | tr '[:upper:]' '[:lower:]')"
  if [[ "$normalized_version" == "main" ]]; then
    alisio_main_package_spec
    return 0
  fi
  if is_explicit_spec "$version"; then
    printf '%s\n' "$version"
    return 0
  fi
  alisio_npm_package_spec "$version"
}

resolve_release_version() {
  local version="$1"
  if [[ "$version" == "latest" ]]; then
    npm view "$APP_SLUG" version 2>/dev/null || printf '%s\n' "$version"
    return 0
  fi
  printf '%s\n' "$version"
}

write_shell_exports() {
  local rc="$1"
  [[ -f "$rc" ]] || touch "$rc"
  local marker_begin="# >>> alisio state >>>"
  local marker_end="# <<< alisio state <<<"
  if grep -Fq "$marker_begin" "$rc" 2>/dev/null; then
    return 0
  fi
  local legacy_state_key legacy_config_key
  legacy_state_key="$(alisio_legacy_env_name STATE_DIR)"
  legacy_config_key="$(alisio_legacy_env_name CONFIG_PATH)"
  cat >>"$rc" <<EOF
$marker_begin
export ALISIO_STATE_DIR="\$HOME/${STATE_DIR_NAME}"
export ALISIO_CONFIG_PATH="\$ALISIO_STATE_DIR/${CONFIG_FILE_NAME}"
export ${legacy_state_key}="\$ALISIO_STATE_DIR"
export ${legacy_config_key}="\$ALISIO_CONFIG_PATH"
$marker_end
EOF
}

prepare_state_dirs() {
  local state_dir="$HOME/$STATE_DIR_NAME"
  local workspace_dir="$state_dir/workspace"
  local logs_dir="$state_dir/logs"
  local legacy_slug
  legacy_slug="$(alisio_legacy_slug)"
  mkdir -p "$workspace_dir" "$logs_dir"
  export ALISIO_STATE_DIR="$state_dir"
  export ALISIO_CONFIG_PATH="$state_dir/$CONFIG_FILE_NAME"
  alisio_export_legacy_env STATE_DIR "$ALISIO_STATE_DIR"
  alisio_export_legacy_env CONFIG_PATH "$ALISIO_CONFIG_PATH"
  if [[ -f "$HOME/.${legacy_slug}/${legacy_slug}.json" && ! -f "$ALISIO_CONFIG_PATH" ]]; then
    cp "$HOME/.${legacy_slug}/${legacy_slug}.json" "$ALISIO_CONFIG_PATH"
  fi
}

resolve_cli_bin() {
  if command -v "$APP_SLUG" >/dev/null 2>&1; then
    CLI_BIN="$(command -v "$APP_SLUG")"
    CLI_BIN_DIR="$(cd "$(dirname "$CLI_BIN")" && pwd)"
    return 0
  fi
  if [[ -x "$HOME/.npm-global/bin/$APP_SLUG" ]]; then
    CLI_BIN="$HOME/.npm-global/bin/$APP_SLUG"
    CLI_BIN_DIR="$HOME/.npm-global/bin"
    return 0
  fi
  local prefix
  prefix="$(npm prefix -g 2>/dev/null || true)"
  if [[ -n "$prefix" && -x "$prefix/bin/$APP_SLUG" ]]; then
    CLI_BIN="$prefix/bin/$APP_SLUG"
    CLI_BIN_DIR="$prefix/bin"
    return 0
  fi
  return 1
}

write_launcher_script() {
  local launcher_dir="$HOME/.local/bin"
  local launcher_path="$launcher_dir/${APP_SLUG}-desktop"
  local legacy_state_key legacy_config_key
  legacy_state_key="$(alisio_legacy_env_name STATE_DIR)"
  legacy_config_key="$(alisio_legacy_env_name CONFIG_PATH)"
  mkdir -p "$launcher_dir"
  cat >"$launcher_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export ALISIO_STATE_DIR="\${ALISIO_STATE_DIR:-\$HOME/${STATE_DIR_NAME}}"
export ALISIO_CONFIG_PATH="\${ALISIO_CONFIG_PATH:-\$ALISIO_STATE_DIR/${CONFIG_FILE_NAME}}"
export ${legacy_state_key}="\${${legacy_state_key}:-\$ALISIO_STATE_DIR}"
export ${legacy_config_key}="\${${legacy_config_key}:-\$ALISIO_CONFIG_PATH}"
mkdir -p "\$ALISIO_STATE_DIR/logs" "\$ALISIO_STATE_DIR/workspace"
if command -v ${APP_SLUG} >/dev/null 2>&1; then
  if ${APP_SLUG} gateway install --force >/dev/null 2>&1; then
    ${APP_SLUG} gateway restart >/dev/null 2>&1 || true
  else
    nohup ${APP_SLUG} gateway run --bind loopback --port "\${ALISIO_GATEWAY_PORT:-40705}" --force >"\$ALISIO_STATE_DIR/logs/gateway.log" 2>&1 &
  fi
  exec ${APP_SLUG} dashboard
fi
echo "${APP_NAME} não está instalado no PATH." >&2
exit 1
EOF
  chmod +x "$launcher_path"
  export PATH="$launcher_dir:$PATH"

  if [[ "$OS" == "linux" || "$OS" == "wsl" ]]; then
    local desktop_dir="$HOME/.local/share/applications"
    mkdir -p "$desktop_dir"
    cat >"$desktop_dir/${APP_SLUG}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Exec=${launcher_path}
Terminal=false
Categories=Utility;
EOF
  elif [[ "$OS" == "macos" ]]; then
    local app_dir="$HOME/Applications"
    mkdir -p "$app_dir"
    local command_path="$app_dir/${APP_NAME}.command"
    cat >"$command_path" <<EOF
#!/usr/bin/env bash
exec "${launcher_path}" "\$@"
EOF
    chmod +x "$command_path"
  fi
}

install_cli_via_npm() {
  local version="$1"
  local spec
  spec="$(resolve_npm_install_spec "$version")"
  ui_section "CLI"
  ui_info "A instalar ${APP_NAME} via npm: ${spec}"
  ensure_node
  ensure_git
  configure_user_npm_prefix
  run_cmd npm install -g "$spec" --no-fund --no-audit
  if [[ "$DRY_RUN" == "1" ]]; then
    CLI_BIN="$APP_SLUG"
    CLI_BIN_DIR=""
    ui_success "CLI seria instalado via npm: ${spec}"
    return 0
  fi
  resolve_cli_bin || {
    ui_error "A instalação terminou mas ${APP_SLUG} não ficou disponível no PATH."
    exit 1
  }
  ui_success "CLI instalado em ${CLI_BIN}"
}

install_cli_via_git() {
  ui_section "Git checkout"
  ensure_node
  ensure_git
  ensure_pnpm
  if [[ "$DRY_RUN" == "1" ]]; then
    CLI_BIN="$HOME/.local/bin/$APP_SLUG"
    CLI_BIN_DIR="$HOME/.local/bin"
    ui_info "[dry-run] preparar checkout git em ${GIT_DIR}"
    ui_info "[dry-run] instalar dependências, UI e binário CLI"
    ui_success "Wrapper git seria criado em ${CLI_BIN}"
    return 0
  fi

  if [[ ! -d "$GIT_DIR/.git" ]]; then
    ui_info "A clonar repositório para ${GIT_DIR}"
    run_cmd git clone "$(alisio_repo_https_url)" "$GIT_DIR"
  elif [[ "$GIT_UPDATE" == "1" ]]; then
    ui_info "A actualizar checkout existente"
    run_cmd git -C "$GIT_DIR" pull --rebase
  fi

  run_cmd pnpm -C "$GIT_DIR" install
  run_cmd pnpm -C "$GIT_DIR" ui:build
  run_cmd pnpm -C "$GIT_DIR" build

  mkdir -p "$HOME/.local/bin"
  cat >"$HOME/.local/bin/$APP_SLUG" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export ALISIO_STATE_DIR="\${ALISIO_STATE_DIR:-\$HOME/${STATE_DIR_NAME}}"
export ALISIO_CONFIG_PATH="\${ALISIO_CONFIG_PATH:-\$ALISIO_STATE_DIR/${CONFIG_FILE_NAME}}"
export $(alisio_legacy_env_name STATE_DIR)="\${$(alisio_legacy_env_name STATE_DIR):-\$ALISIO_STATE_DIR}"
export $(alisio_legacy_env_name CONFIG_PATH)="\${$(alisio_legacy_env_name CONFIG_PATH):-\$ALISIO_CONFIG_PATH}"
exec node "${GIT_DIR}/dist/entry.js" "\$@"
EOF
  chmod +x "$HOME/.local/bin/$APP_SLUG"
  export PATH="$HOME/.local/bin:$PATH"
  CLI_BIN="$HOME/.local/bin/$APP_SLUG"
  CLI_BIN_DIR="$HOME/.local/bin"
  ui_success "Wrapper git criado em ${CLI_BIN}"
}

desktop_asset_url() {
  local version="$1"
  if [[ -n "$DESKTOP_URL_OVERRIDE" ]]; then
    printf '%s\n' "$DESKTOP_URL_OVERRIDE"
    return 0
  fi
  local resolved
  resolved="$(resolve_release_version "$version")"
  local asset_name
  printf -v asset_name "$MAC_DESKTOP_ASSET_PATTERN" "$resolved"
  printf '%s/%s\n' "$(alisio_release_download_base "$resolved")" "$asset_name"
}

install_macos_desktop() {
  local version="$1"
  if [[ "$OS" != "macos" ]]; then
    ui_warn "Modo desktop só está configurado para macOS; vou usar npm."
    install_cli_via_npm "$version"
    return 0
  fi

  require_command unzip
  detect_downloader

  local asset_url
  asset_url="$(desktop_asset_url "$version")"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap '[[ -n "${tmp_dir:-}" ]] && rm -rf "$tmp_dir" 2>/dev/null || true' RETURN
  local archive_path="$tmp_dir/${APP_NAME}.zip"
  local install_root="/Applications"
  if [[ ! -w "$install_root" ]]; then
    install_root="$HOME/Applications"
  fi
  DESKTOP_APP_PATH="${install_root}/${APP_NAME}.app"

  ui_section "Desktop"
  ui_info "A descarregar app desktop do canal de releases."
  if [[ "$DRY_RUN" == "1" ]]; then
    ui_info "[dry-run] obter pacote desktop da release pedida"
    ui_info "[dry-run] expandir bundle em ${DESKTOP_APP_PATH}"
    ui_success "App desktop seria instalada em ${DESKTOP_APP_PATH}"
    return 0
  fi
  run_cmd download_file "$asset_url" "$archive_path" || {
    ui_warn "O artefacto desktop não está disponível; vou usar npm."
    install_cli_via_npm "$version"
    return 0
  }

  mkdir -p "$install_root"
  run_cmd unzip -oq "$archive_path" -d "$install_root"
  local app_bundle="$DESKTOP_APP_PATH"
  if [[ ! -d "$app_bundle" ]]; then
    ui_error "Não encontrei ${APP_NAME}.app após o unzip."
    exit 1
  fi
  ui_success "App instalada em ${app_bundle}"
  if [[ "$DRY_RUN" != "1" ]]; then
    open "$app_bundle" || true
  fi
}

run_post_install_setup() {
  prepare_state_dirs
  write_shell_exports "$HOME/.bashrc"
  write_shell_exports "$HOME/.zshrc"
  write_launcher_script

  if [[ -n "$CLI_BIN" ]]; then
    ui_section "Gateway + UI"
    if [[ "$DRY_RUN" == "1" ]]; then
      ui_info "Iria preparar serviço do gateway e abrir o dashboard."
      return 0
    fi
    if "$CLI_BIN" gateway install --force >/dev/null 2>&1; then
      "$CLI_BIN" gateway restart >/dev/null 2>&1 || true
    else
      nohup "$CLI_BIN" gateway run --bind loopback --port "${ALISIO_GATEWAY_PORT:-40705}" --force >"$ALISIO_STATE_DIR/logs/gateway.log" 2>&1 &
    fi
    if [[ "$NO_ONBOARD" != "1" ]]; then
      "$HOME/.local/bin/${APP_SLUG}-desktop" >/dev/null 2>&1 || true
    fi
  fi
}

verify_installation() {
  if [[ "$VERIFY_INSTALL" != "1" ]]; then
    return 0
  fi
  ui_section "Verificação"
  if [[ -n "$CLI_BIN" ]]; then
    run_cmd "$CLI_BIN" --version
    run_cmd "$CLI_BIN" dashboard --no-open || true
  fi
}

main() {
  parse_args "$@"
  if [[ "$HELP" == "1" ]]; then
    print_usage
    return 0
  fi

  print_banner
  detect_os
  alisio_warn_legacy_env_usage stderr \
    VERSION INSTALL_METHOD DISTRIBUTION BETA NO_ONBOARD NO_PROMPT DRY_RUN VERIFY_INSTALL VERBOSE GIT_DIR GIT_UPDATE DESKTOP_URL

  local method="${DEFAULT_METHOD:-$(default_method_for_os)}"
  local version
  version="$(resolve_requested_version)"

  ui_info "Sistema: ${OS}"
  ui_info "Método: ${method}"
  ui_info "Versão pedida: ${version}"

  case "$method" in
    desktop)
      install_macos_desktop "$version"
      ;;
    npm)
      install_cli_via_npm "$version"
      run_post_install_setup
      ;;
    git)
      install_cli_via_git
      run_post_install_setup
      ;;
    *)
      ui_error "Método inválido: ${method}"
      exit 2
      ;;
  esac

  verify_installation

  echo ""
  ui_success "${APP_NAME} pronto."
  if [[ -n "$DESKTOP_APP_PATH" ]]; then
    echo "Arranque sem CLI:"
    echo "  ${DESKTOP_APP_PATH}"
  elif [[ -x "$HOME/.local/bin/${APP_SLUG}-desktop" ]]; then
    echo "Arranque sem CLI:"
    if [[ "$OS" == "macos" ]]; then
      echo "  $HOME/Applications/${APP_NAME}.command"
    else
      echo "  $HOME/.local/bin/${APP_SLUG}-desktop"
    fi
  fi
  if [[ -n "$CLI_BIN" ]]; then
    echo "CLI:"
    echo "  ${CLI_BIN} dashboard"
  fi
}

if [[ "$(alisio_read_prefixed_env INSTALL_SH_NO_RUN 0)" != "1" ]]; then
  main "$@"
fi
