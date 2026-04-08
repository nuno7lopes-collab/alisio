#!/usr/bin/env bash

if [[ -n "${ALISIO_BRANDING_SH_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi
ALISIO_BRANDING_SH_LOADED=1
export ALISIO_BRANDING_SH_LOADED

alisio_app_name() {
  printf '%s\n' "Alisio"
}

alisio_app_slug() {
  printf '%s\n' "alisio"
}

alisio_state_dir_name() {
  printf '%s\n' ".alisio"
}

alisio_config_file_name() {
  printf '%s\n' "alisio.json"
}

alisio_package_dir_name() {
  printf '%s\n' "alisio-package"
}

alisio_bundle_domain() {
  printf '%s\n' "ai.alisio"
}

alisio_macos_bundle_id_root() {
  printf '%s\n' "$(alisio_bundle_domain).mac"
}

alisio_macos_release_bundle_id() {
  printf '%s\n' "$(alisio_macos_bundle_id_root)"
}

alisio_macos_debug_bundle_id() {
  printf '%s\n' "$(alisio_macos_release_bundle_id).debug"
}

alisio_macos_deeplink_id() {
  printf '%s\n' "$(alisio_macos_release_bundle_id).deeplink"
}

alisio_public_repo_nwo() {
  local slug
  slug="$(alisio_app_slug)"
  printf '%s/%s\n' "$slug" "$slug"
}

alisio_legacy_slug() {
  printf '%s\n' "open""claw"
}

alisio_legacy_title() {
  printf '%s\n' "Open""Claw"
}

alisio_legacy_env_prefix() {
  printf '%s\n' "OPEN""CLAW"
}

alisio_legacy_scope() {
  printf '@%s\n' "$(alisio_legacy_slug)"
}

alisio_legacy_plugin_manifest() {
  printf '%s.plugin.json\n' "$(alisio_legacy_slug)"
}

alisio_legacy_entrypoint() {
  printf '%s.mjs\n' "$(alisio_legacy_slug)"
}

alisio_legacy_config_name() {
  printf '%s.json\n' "$(alisio_legacy_slug)"
}

alisio_legacy_state_dir_name() {
  printf '.%s\n' "$(alisio_legacy_slug)"
}

alisio_legacy_plugin_sdk_root() {
  printf '%s/plugin-sdk\n' "$(alisio_legacy_slug)"
}

alisio_legacy_repo_nwo() {
  local slug
  slug="$(alisio_legacy_slug)"
  printf '%s/%s\n' "$slug" "$slug"
}

alisio_distribution_id() {
  alisio_read_prefixed_env DISTRIBUTION "$(alisio_app_slug)"
}

alisio_repo_nwo() {
  local distribution="${1:-$(alisio_distribution_id)}"
  if [[ "$distribution" == "$(alisio_legacy_slug)" ]]; then
    alisio_legacy_repo_nwo
    return 0
  fi
  alisio_public_repo_nwo
}

alisio_repo_https_url() {
  local distribution="${1:-$(alisio_distribution_id)}"
  printf 'https://github.com/%s.git\n' "$(alisio_repo_nwo "$distribution")"
}

alisio_repo_raw_base() {
  local distribution="${1:-$(alisio_distribution_id)}"
  printf 'https://raw.githubusercontent.com/%s/main\n' "$(alisio_repo_nwo "$distribution")"
}

alisio_macos_sparkle_feed_url() {
  local distribution="${1:-$(alisio_distribution_id)}"
  printf '%s/appcast.xml\n' "$(alisio_repo_raw_base "$distribution")"
}

alisio_release_download_base() {
  local version="${1:-}"
  local distribution="${2:-$(alisio_distribution_id)}"
  if [[ -z "$version" ]]; then
    return 1
  fi
  printf 'https://github.com/%s/releases/download/v%s\n' "$(alisio_repo_nwo "$distribution")" "$version"
}

alisio_install_sh_url() {
  printf '%s\n' "https://alisio.pt/install.sh"
}

alisio_install_ps1_url() {
  printf '%s\n' "https://alisio.pt/install.ps1"
}

alisio_npm_package_spec() {
  local version="${1:-latest}"
  printf '%s@%s\n' "$(alisio_app_slug)" "$version"
}

alisio_main_package_spec() {
  local distribution="${1:-$(alisio_distribution_id)}"
  printf 'github:%s#main\n' "$(alisio_repo_nwo "$distribution")"
}

alisio_legacy_env_name() {
  local suffix="${1:-}"
  printf '%s_%s\n' "$(alisio_legacy_env_prefix)" "$suffix"
}

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

alisio_has_legacy_env() {
  local suffix="${1:-}"
  local legacy_name
  legacy_name="$(alisio_legacy_env_name "$suffix")"
  [[ -n "${!legacy_name-}" ]]
}

alisio_warn_legacy_env_usage() {
  local sink="${1:-stderr}"
  shift || true
  local suffix
  for suffix in "$@"; do
    local public_name="ALISIO_${suffix}"
    if [[ -n "${!public_name-}" ]]; then
      continue
    fi
    if ! alisio_has_legacy_env "$suffix"; then
      continue
    fi
    local legacy_name
    legacy_name="$(alisio_legacy_env_name "$suffix")"
    local line="Aviso: ${legacy_name} está obsoleto; usa ${public_name}."
    if [[ "$sink" == "stdout" ]]; then
      printf '%s\n' "$line"
    else
      printf '%s\n' "$line" >&2
    fi
  done
}

alisio_export_legacy_env() {
  local suffix="${1:-}"
  local value="${2-}"
  local legacy_name
  legacy_name="$(alisio_legacy_env_name "$suffix")"
  export "${legacy_name}=${value}"
}

alisio_host_package_name() {
  local repo_root="${1:-$(pwd)}"
  if command -v node >/dev/null 2>&1 && [[ -f "$repo_root/package.json" ]]; then
    local package_name=""
    package_name="$(node - <<'NODE' "$repo_root" 2>/dev/null || true
const fs = require("node:fs");
const path = require("node:path");
const repoRoot = process.argv[2];
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  if (typeof pkg?.name === "string" && pkg.name.trim()) {
    process.stdout.write(pkg.name.trim());
  }
} catch {}
NODE
)"
    if [[ -n "$package_name" ]]; then
      printf '%s\n' "$package_name"
      return 0
    fi
  fi
  alisio_app_slug
}

alisio_current_extension_scope() {
  local repo_root="${1:-$(pwd)}"
  if command -v node >/dev/null 2>&1 && [[ -d "$repo_root/extensions" ]]; then
    local scope=""
    scope="$(node - <<'NODE' "$repo_root" 2>/dev/null || true
const fs = require("node:fs");
const path = require("node:path");
const repoRoot = process.argv[2];
const counts = new Map();
try {
  for (const entry of fs.readdirSync(path.join(repoRoot, "extensions"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = path.join(repoRoot, "extensions", entry.name, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const match = typeof pkg?.name === "string" ? pkg.name.trim().match(/^(@[^/]+)\/[^/]+$/u) : null;
    if (!match) continue;
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
} catch {}
let resolved = "";
let bestCount = -1;
for (const [candidate, count] of counts) {
  if (count > bestCount) {
    resolved = candidate;
    bestCount = count;
  }
}
process.stdout.write(resolved);
NODE
)"
    if [[ -n "$scope" ]]; then
      printf '%s\n' "$scope"
      return 0
    fi
  fi
  alisio_legacy_scope
}

alisio_current_plugin_manifest_name() {
  local repo_root="${1:-$(pwd)}"
  if [[ -d "$repo_root/extensions" ]]; then
    local manifest_name=""
    manifest_name="$(
      find "$repo_root/extensions" -mindepth 2 -maxdepth 2 -type f -name '*.plugin.json' -print 2>/dev/null \
        | head -n 1 \
        | xargs -I{} basename "{}" 2>/dev/null || true
    )"
    if [[ -n "$manifest_name" ]]; then
      printf '%s\n' "$manifest_name"
      return 0
    fi
  fi
  alisio_legacy_plugin_manifest
}

alisio_current_package_brand_key() {
  local repo_root="${1:-$(pwd)}"
  if command -v node >/dev/null 2>&1 && [[ -d "$repo_root/extensions" ]]; then
    local brand_key=""
    brand_key="$(node - <<'NODE' "$repo_root" 2>/dev/null || true
const fs = require("node:fs");
const path = require("node:path");
const repoRoot = process.argv[2];
const keys = ["alisio", ["open", "claw"].join("")];
try {
  for (const entry of fs.readdirSync(path.join(repoRoot, "extensions"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = path.join(repoRoot, "extensions", entry.name, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    for (const key of keys) {
      if (pkg && typeof pkg[key] === "object" && pkg[key] && !Array.isArray(pkg[key])) {
        process.stdout.write(key);
        process.exit(0);
      }
    }
  }
} catch {}
process.stdout.write("alisio");
NODE
)"
    if [[ -n "$brand_key" ]]; then
      printf '%s\n' "$brand_key"
      return 0
    fi
  fi
  printf '%s\n' "alisio"
}

alisio_plugin_sdk_root() {
  local repo_root="${1:-$(pwd)}"
  printf '%s/plugin-sdk\n' "$(alisio_host_package_name "$repo_root")"
}
