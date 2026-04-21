#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/alisio-branding.sh
source "$ROOT_DIR/scripts/lib/alisio-branding.sh"

APP_NAME="$(alisio_app_name)"
APP_SLUG="$(alisio_app_slug)"
LEGACY_SLUG="$(alisio_legacy_slug)"
LEGACY_ENTRYPOINT="$(alisio_legacy_entrypoint)"
PACKAGE_DIR_NAME="$(alisio_package_dir_name)"
CURRENT_SHARED_KIT_BUNDLE_NAME="AlisioKit_AlisioKit.bundle"

BUILD_ROOT="$ROOT_DIR/apps/macos/.build"
PRODUCT="${APP_PRODUCT:-${ALISIO_MAC_APP_PRODUCT:-$APP_NAME}}"
BUNDLE_ID="${BUNDLE_ID:-$(alisio_macos_debug_bundle_id)}"
BUNDLE_ID_LOWER="$(printf '%s' "$BUNDLE_ID" | tr '[:upper:]' '[:lower:]')"
APP_SLUG_LOWER="$(printf '%s' "$APP_SLUG" | tr '[:upper:]' '[:lower:]')"
LEGACY_SLUG_LOWER="$(printf '%s' "$LEGACY_SLUG" | tr '[:upper:]' '[:lower:]')"
PKG_VERSION="$(cd "$ROOT_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
if [[ -n "${SOURCE_DATE_EPOCH:-}" ]]; then
  BUILD_TS="$(date -u -r "$SOURCE_DATE_EPOCH" +"%Y-%m-%dT%H:%M:%SZ")"
else
  BUILD_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
fi
GIT_COMMIT="$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
GIT_BUILD_NUMBER="$(cd "$ROOT_DIR" && git rev-list --count HEAD 2>/dev/null || echo "0")"
APP_VERSION="${APP_VERSION:-$PKG_VERSION}"
APP_BUILD="${APP_BUILD:-}"
BUILD_CONFIG="${BUILD_CONFIG:-debug}"
PACKAGE_MODE="${MACOS_PACKAGE_MODE:-}"
BUILD_INFO_TS_KEY="${APP_NAME}BuildTimestamp"
BUILD_INFO_COMMIT_KEY="${APP_NAME}GitCommit"
BUILD_INFO_DIST_KEY="${APP_NAME}Distribution"
if [[ -n "${BUILD_ARCHS:-}" ]]; then
  BUILD_ARCHS_VALUE="${BUILD_ARCHS}"
elif [[ "$BUILD_CONFIG" == "release" ]]; then
  BUILD_ARCHS_VALUE="all"
else
  BUILD_ARCHS_VALUE="$(uname -m)"
fi
if [[ "$BUILD_ARCHS_VALUE" == "all" ]]; then
  BUILD_ARCHS_VALUE="arm64 x86_64"
fi
IFS=' ' read -r -a BUILD_ARCHS <<< "$BUILD_ARCHS_VALUE"
PRIMARY_ARCH="${BUILD_ARCHS[0]}"
DISTRO_ID="$(alisio_read_prefixed_env DISTRIBUTION "$APP_SLUG")"
FINAL_APP_ROOT="${MACOS_FINAL_APP_PATH:-$ROOT_DIR/dist/${APP_NAME}.app}"
FINAL_APP_PARENT="$(dirname "$FINAL_APP_ROOT")"
mkdir -p "$FINAL_APP_PARENT"
APP_STAGE_ROOT_PARENT="$(mktemp -d "$FINAL_APP_PARENT/.${APP_SLUG}-mac-app.XXXXXX")"
APP_ROOT="$APP_STAGE_ROOT_PARENT/${APP_NAME}.app"
CONTROL_UI_STAGE="$APP_STAGE_ROOT_PARENT/control-ui"
SPARKLE_PUBLIC_ED_KEY="${SPARKLE_PUBLIC_ED_KEY:-V+Cfq+Lc/udi4dxjxzHpObm3EHZdnphCPx1VNh3r0RU=}"
SPARKLE_FEED_URL="${SPARKLE_FEED_URL:-$(alisio_macos_sparkle_feed_url "$DISTRO_ID")}"
AUTO_CHECKS=true
if [[ "$BUNDLE_ID" == *.debug || -z "$SPARKLE_FEED_URL" ]]; then
  SPARKLE_FEED_URL=""
  AUTO_CHECKS=false
fi

if [[ -z "$PACKAGE_MODE" ]]; then
  if [[ "$BUILD_CONFIG" == "release" ]]; then
    PACKAGE_MODE="release-placeholder"
  else
    PACKAGE_MODE="debug"
  fi
fi

case "$PACKAGE_MODE" in
  debug)
    if [[ "$BUILD_CONFIG" != "debug" ]]; then
      echo "ERROR: MACOS_PACKAGE_MODE=debug requires BUILD_CONFIG=debug." >&2
      exit 1
    fi
    ;;
  release-placeholder)
    if [[ "$BUILD_CONFIG" != "release" ]]; then
      echo "ERROR: MACOS_PACKAGE_MODE=release-placeholder requires BUILD_CONFIG=release." >&2
      exit 1
    fi
    ;;
  release-real)
    echo "ERROR: scripts/package-mac-app.sh only produces a signed .app bundle." >&2
    echo "       Use scripts/package-mac-dist.sh for release zip/dmg packaging and notarization." >&2
    exit 1
    ;;
  *)
    echo "ERROR: Invalid MACOS_PACKAGE_MODE: $PACKAGE_MODE (use debug or release-placeholder)." >&2
    exit 1
    ;;
esac

if [[ "$LEGACY_SLUG_LOWER" != "$APP_SLUG_LOWER" && "$BUNDLE_ID_LOWER" == *"$LEGACY_SLUG_LOWER"* ]]; then
  echo "ERROR: BUNDLE_ID must not contain legacy branding ($LEGACY_SLUG): $BUNDLE_ID" >&2
  exit 1
fi
if [[ "$BUNDLE_ID" != "$(alisio_bundle_domain)."* ]]; then
  echo "ERROR: BUNDLE_ID must use the $(alisio_bundle_domain).* namespace: $BUNDLE_ID" >&2
  exit 1
fi

cleanup_app_stage() {
  rm -rf "$APP_STAGE_ROOT_PARENT"
}

trap cleanup_app_stage EXIT

sparkle_canonical_build_from_version() {
  node --import tsx "$ROOT_DIR/scripts/sparkle-build.ts" canonical-build "$1"
}

build_path_for_arch() {
  echo "$BUILD_ROOT/$1"
}

bin_for_arch() {
  echo "$(build_path_for_arch "$1")/$BUILD_CONFIG/$PRODUCT"
}

sparkle_framework_for_arch() {
  echo "$(build_path_for_arch "$1")/$BUILD_CONFIG/Sparkle.framework"
}

merge_framework_machos() {
  local primary="$1"
  local dest="$2"
  shift 2
  local others=("$@")

  archs_for() {
    /usr/bin/lipo -info "$1" | /usr/bin/sed -E 's/.*are: //; s/.*architecture: //'
  }

  arch_in_list() {
    local needle="$1"
    shift
    local item
    for item in "$@"; do
      if [[ "$item" == "$needle" ]]; then
        return 0
      fi
    done
    return 1
  }

  while IFS= read -r -d '' file; do
    if /usr/bin/file "$file" | /usr/bin/grep -q "Mach-O"; then
      local rel="${file#$primary/}"
      local primary_archs
      primary_archs="$(archs_for "$file")"
      IFS=' ' read -r -a primary_arch_array <<< "$primary_archs"

      local missing_files=()
      local tmp_dir
      tmp_dir="$(mktemp -d)"
      local fw
      for fw in "${others[@]}"; do
        local other_file="$fw/$rel"
        [[ -f "$other_file" ]] || continue
        if /usr/bin/file "$other_file" | /usr/bin/grep -q "Mach-O"; then
          local other_archs
          other_archs="$(archs_for "$other_file")"
          IFS=' ' read -r -a other_arch_array <<< "$other_archs"
          local arch
          for arch in "${other_arch_array[@]}"; do
            if ! arch_in_list "$arch" "${primary_arch_array[@]}"; then
              local thin_file="$tmp_dir/$(echo "$rel" | tr '/' '_')-$arch"
              /usr/bin/lipo -thin "$arch" "$other_file" -output "$thin_file"
              missing_files+=("$thin_file")
              primary_arch_array+=("$arch")
            fi
          done
        fi
      done

      if [[ "${#missing_files[@]}" -gt 0 ]]; then
        /usr/bin/lipo -create "$file" "${missing_files[@]}" -output "$dest/$rel"
      fi
      rm -rf "$tmp_dir"
    fi
  done < <(find "$primary" -type f -print0)
}

node_binary_meets_min() {
  local candidate="$1"
  "$candidate" -e '
    const [major, minor, patch] = process.versions.node.split(".").map(Number);
    const ok = major > 22 || (major === 22 && (minor > 16 || (minor === 16 && patch >= 0)));
    process.exit(ok ? 0 : 1);
  ' >/dev/null 2>&1
}

path_in_list() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

list_macho_deps() {
  otool -L "$1" 2>/dev/null | tail -n +2 | awk '{print $1}'
}

list_macho_rpaths() {
  otool -l "$1" 2>/dev/null | awk '
    $1 == "cmd" && $2 == "LC_RPATH" { want = 1; next }
    want && $1 == "path" { print $2; want = 0 }
  '
}

resolve_special_macho_path() {
  local token="$1"
  local current_file="$2"
  local runtime_root="$3"
  local current_dir
  current_dir="$(cd "$(dirname "$current_file")" && pwd)"
  case "$token" in
    @loader_path)
      printf '%s\n' "$current_dir"
      ;;
    @loader_path/*)
      printf '%s/%s\n' "$current_dir" "${token#@loader_path/}"
      ;;
    @executable_path)
      printf '%s\n' "$runtime_root/bin"
      ;;
    @executable_path/*)
      printf '%s/%s\n' "$runtime_root/bin" "${token#@executable_path/}"
      ;;
    *)
      printf '%s\n' "$token"
      ;;
  esac
}

resolve_macho_dep_source() {
  local current_file="$1"
  local dep="$2"
  local runtime_root="$3"
  local candidate
  case "$dep" in
    /System/Library/*|/usr/lib/*)
      return 1
      ;;
    /*)
      [[ -e "$dep" ]] || return 1
      printf '%s\n' "$dep"
      return 0
      ;;
    @loader_path*|@executable_path*)
      candidate="$(resolve_special_macho_path "$dep" "$current_file" "$runtime_root")"
      [[ -e "$candidate" ]] || return 1
      printf '%s\n' "$candidate"
      return 0
      ;;
    @rpath/*)
      local suffix="${dep#@rpath/}"
      local rpath resolved_rpath
      while IFS= read -r rpath; do
        [[ -n "$rpath" ]] || continue
        resolved_rpath="$(resolve_special_macho_path "$rpath" "$current_file" "$runtime_root")"
        candidate="${resolved_rpath}/${suffix}"
        if [[ -e "$candidate" ]]; then
          printf '%s\n' "$candidate"
          return 0
        fi
      done < <(list_macho_rpaths "$current_file")
      candidate="$runtime_root/lib/$suffix"
      if [[ -e "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
      return 1
      ;;
  esac
  return 1
}

copy_bundled_node_runtime() {
  local source_node="$1"
  local dest_root="$2"
  local source_runtime_root
  source_runtime_root="$(cd "$(dirname "$source_node")/.." && pwd)"
  local dest_bin_dir="$dest_root/bin"
  local dest_lib_dir="$dest_root/lib"
  local dest_node="$dest_bin_dir/node"
  local -a queue_sources=()
  local -a queue_dests=()
  local -a processed_dests=()
  local source_current dest_current dep_ref dep_source dep_basename dep_dest new_ref

  mkdir -p "$dest_bin_dir" "$dest_lib_dir"
  cp -L "$source_node" "$dest_node"
  chmod +x "$dest_node"
  chmod u+w "$dest_node" 2>/dev/null || true
  /usr/bin/codesign --remove-signature "$dest_node" 2>/dev/null || true
  queue_sources+=("$source_node")
  queue_dests+=("$dest_node")

  while [[ "${#queue_sources[@]}" -gt 0 ]]; do
    source_current="${queue_sources[0]}"
    dest_current="${queue_dests[0]}"
    queue_sources=("${queue_sources[@]:1}")
    queue_dests=("${queue_dests[@]:1}")

    if [[ "${#processed_dests[@]}" -gt 0 ]] && path_in_list "$dest_current" "${processed_dests[@]}"; then
      continue
    fi
    processed_dests+=("$dest_current")

    while IFS= read -r dep_ref; do
      [[ -n "$dep_ref" ]] || continue
      dep_source="$(resolve_macho_dep_source "$source_current" "$dep_ref" "$source_runtime_root" || true)"
      [[ -n "$dep_source" ]] || continue

      dep_basename="$(basename "$dep_source")"
      dep_dest="$dest_lib_dir/$dep_basename"
      if [[ ! -e "$dep_dest" ]]; then
        cp -L "$dep_source" "$dep_dest"
        chmod u+w "$dep_dest" 2>/dev/null || true
        /usr/bin/codesign --remove-signature "$dep_dest" 2>/dev/null || true
        queue_sources+=("$dep_source")
        queue_dests+=("$dep_dest")
      fi

      if [[ "$dest_current" == "$dest_bin_dir/"* ]]; then
        new_ref="@loader_path/../lib/$dep_basename"
      else
        new_ref="@loader_path/$dep_basename"
      fi
      install_name_tool -change "$dep_ref" "$new_ref" "$dest_current"
    done < <(list_macho_deps "$source_current")

    if [[ "$dest_current" == "$dest_lib_dir/"* ]]; then
      install_name_tool -id "@rpath/$(basename "$dest_current")" "$dest_current"
    fi
  done
}

validate_bundled_node_runtime() {
  local node_path="$1"
  "$node_path" -p 'process.execPath' >/dev/null
}

sign_bundled_node_runtime() {
  local runtime_root="$1"
  local dylib
  if [[ -d "$runtime_root/lib" ]]; then
    while IFS= read -r -d '' dylib; do
      /usr/bin/codesign --force --sign - --timestamp=none "$dylib"
    done < <(find "$runtime_root/lib" -type f -name '*.dylib' -print0)
  fi
  /usr/bin/codesign --force --sign - --timestamp=none "$runtime_root/bin/node"
}

resolve_bundled_node_source() {
  if [[ "${SKIP_BUNDLED_NODE:-0}" == "1" ]]; then
    return 1
  fi
  local candidate="${BUNDLED_NODE_SOURCE:-$(command -v node || true)}"
  [[ -n "$candidate" && -x "$candidate" ]] || return 1
  if node_binary_meets_min "$candidate"; then
    printf '%s\n' "$candidate"
    return 0
  fi
  return 1
}

find_info_plist_template() {
  local preferred="$ROOT_DIR/apps/macos/Sources/${APP_NAME}/Resources/Info.plist"
  if [[ -f "$preferred" ]]; then
    printf '%s\n' "$preferred"
    return 0
  fi
  find "$ROOT_DIR/apps/macos/Sources" -path "*/Resources/Info.plist" -print -quit
}

find_resource_dir() {
  local preferred="$ROOT_DIR/apps/macos/Sources/${APP_NAME}/Resources"
  if [[ -d "$preferred" ]]; then
    printf '%s\n' "$preferred"
    return 0
  fi
  find "$ROOT_DIR/apps/macos/Sources" -path "*/Resources" -type d -print -quit
}

find_shared_kit_bundle() {
  local build_dir="$1"
  local candidate

  for candidate in "$build_dir/$CURRENT_SHARED_KIT_BUNDLE_NAME"; do
    if [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  find "$BUILD_ROOT" -type d -name "$CURRENT_SHARED_KIT_BUNDLE_NAME" -print -quit
}

plist_get() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2>/dev/null || true
}

plist_set_or_add() {
  local plist="$1"
  local key="$2"
  local type="$3"
  local value="$4"
  /usr/libexec/PlistBuddy -c "Set :${key} ${value}" "$plist" >/dev/null 2>&1 \
    || /usr/libexec/PlistBuddy -c "Add :${key} ${type} ${value}" "$plist" >/dev/null 2>&1
}

copy_tree_snapshot() {
  local source="$1"
  local dest="$2"

  if /bin/cp -cR "$source" "$dest" 2>/dev/null; then
    return 0
  fi

  /usr/bin/ditto "$source" "$dest"
}

copy_dist_snapshot_with_retry() {
  local source="$1"
  local dest="$2"
  local attempt rc
  local max_attempts="${DIST_SNAPSHOT_MAX_ATTEMPTS:-12}"
  local sleep_seconds

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    rm -rf "$dest"
    if copy_tree_snapshot "$source" "$dest"; then
      rm -rf "$dest/${APP_NAME}.app"
      find "$dest" -maxdepth 1 -type f \( \
        -name "${APP_NAME}-*.zip" -o \
        -name "${APP_NAME}-*.dmg" -o \
        -name "${APP_NAME}-*.dSYM.zip" \
      \) -delete
      return 0
    fi
    rc=$?
    if (( attempt == max_attempts )); then
      return "$rc"
    fi
    sleep_seconds=$((attempt < 5 ? attempt : 5))
    echo "WARN: transient staging copy failure for $(basename "$source") (attempt $attempt/${max_attempts}); retrying in ${sleep_seconds}s." >&2
    sleep "$sleep_seconds"
  done
}

prune_broken_symlinks() {
  local target_root="$1"
  local broken=()
  local link

  while IFS= read -r -d '' link; do
    broken+=("$link")
  done < <(find "$target_root" -type l ! -exec test -e {} \; -print0)

  if [[ "${#broken[@]}" -eq 0 ]]; then
    return 0
  fi

  echo "WARN: removing ${#broken[@]} broken symlink(s) from $(basename "$target_root")." >&2
  for link in "${broken[@]}"; do
    rm -f "$link"
  done
}

materialize_dist_runtime_node_modules() {
  local runtime_root="$1"
  local link target
  local count=0

  while IFS= read -r -d '' link; do
    target="$(readlink "$link" || true)"
    if [[ -z "$target" || "$target" != /* ]]; then
      continue
    fi

    if [[ ! -d "$target" ]]; then
      echo "WARN: removing missing dist-runtime node_modules symlink $link -> $target." >&2
      rm -f "$link"
      continue
    fi

    rm -f "$link"
    copy_tree_snapshot "$target" "$link"
    prune_broken_symlinks "$link"
    count=$((count + 1))
  done < <(find "$runtime_root/extensions" -path '*/node_modules' -type l -print0 2>/dev/null)

  if (( count > 0 )); then
    echo "WARN: materialized ${count} dist-runtime node_modules symlink(s) for bundled packaging." >&2
  fi
}

if [[ "${SKIP_PNPM_INSTALL:-0}" != "1" ]]; then
  PNPM_INSTALL_ARGS=(install --config.node-linker=hoisted)
  if [[ "${ALLOW_LOCKFILE_REFRESH:-0}" == "1" ]]; then
    PNPM_INSTALL_ARGS+=(--no-frozen-lockfile)
  else
    PNPM_INSTALL_ARGS+=(--frozen-lockfile)
  fi
  echo "📦 Ensuring deps (pnpm ${PNPM_INSTALL_ARGS[*]})"
  (cd "$ROOT_DIR" && pnpm "${PNPM_INSTALL_ARGS[@]}")
fi

if [[ -z "$APP_BUILD" ]]; then
  APP_BUILD="$GIT_BUILD_NUMBER"
  if [[ "$APP_VERSION" =~ ^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}([.-].*)?$ ]]; then
    CANONICAL_BUILD="$(sparkle_canonical_build_from_version "$APP_VERSION" 2>/dev/null || true)"
    if [[ "$CANONICAL_BUILD" =~ ^[0-9]+$ ]] && (( CANONICAL_BUILD > APP_BUILD )); then
      APP_BUILD="$CANONICAL_BUILD"
    fi
  fi
fi

if [[ "$AUTO_CHECKS" == "true" && ! "$APP_BUILD" =~ ^[0-9]+$ ]]; then
  echo "ERROR: APP_BUILD tem de ser numérico." >&2
  exit 1
fi

if [[ "${SKIP_TSC:-0}" != "1" ]]; then
  echo "📦 Building JS (pnpm build)"
  (cd "$ROOT_DIR" && pnpm build)
fi

if [[ "${SKIP_UI_BUILD:-0}" != "1" ]]; then
  echo "🖥  Building Control UI"
  (cd "$ROOT_DIR" && node scripts/ui.js build)
fi

CONTROL_UI_SRC="$ROOT_DIR/dist/control-ui"
if [[ -d "$CONTROL_UI_SRC" && -f "$CONTROL_UI_SRC/index.html" ]]; then
  rm -rf "$CONTROL_UI_STAGE"
  copy_tree_snapshot "$CONTROL_UI_SRC" "$CONTROL_UI_STAGE"
else
  echo "ERROR: Control UI assets em falta em $CONTROL_UI_SRC." >&2
  exit 1
fi

cd "$ROOT_DIR/apps/macos"

echo "📦 Packaging mode: $PACKAGE_MODE"
echo "🔨 Building ${PRODUCT} ($BUILD_CONFIG) [${BUILD_ARCHS[*]}]"
echo "📍 Final app bundle: $FINAL_APP_ROOT"
echo "🧱 Staging app bundle: $APP_ROOT"
for arch in "${BUILD_ARCHS[@]}"; do
  BUILD_PATH="$(build_path_for_arch "$arch")"
  swift build -c "$BUILD_CONFIG" --product "$PRODUCT" --build-path "$BUILD_PATH" --arch "$arch" -Xlinker -rpath -Xlinker @executable_path/../Frameworks
done

BIN_PRIMARY="$(bin_for_arch "$PRIMARY_ARCH")"
rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT/Contents/MacOS" "$APP_ROOT/Contents/Resources" "$APP_ROOT/Contents/Frameworks"

INFO_PLIST_SRC="$(find_info_plist_template)"
RESOURCE_DIR="$(find_resource_dir)"
if [[ -z "$INFO_PLIST_SRC" || ! -f "$INFO_PLIST_SRC" ]]; then
  echo "ERROR: Info.plist template em falta." >&2
  exit 1
fi
cp "$INFO_PLIST_SRC" "$APP_ROOT/Contents/Info.plist"

EXECUTABLE_NAME="$(plist_get "$APP_ROOT/Contents/Info.plist" CFBundleExecutable)"
if [[ -z "$EXECUTABLE_NAME" ]]; then
  EXECUTABLE_NAME="$PRODUCT"
fi
ICON_FILE="$(plist_get "$APP_ROOT/Contents/Info.plist" CFBundleIconFile)"
if [[ -z "$ICON_FILE" ]]; then
  ICON_FILE="$APP_NAME"
fi

plist_set_or_add "$APP_ROOT/Contents/Info.plist" CFBundleIdentifier string "$BUNDLE_ID"
plist_set_or_add "$APP_ROOT/Contents/Info.plist" CFBundleName string "$APP_NAME"
plist_set_or_add "$APP_ROOT/Contents/Info.plist" CFBundleDisplayName string "$APP_NAME"
plist_set_or_add "$APP_ROOT/Contents/Info.plist" CFBundleShortVersionString string "$APP_VERSION"
plist_set_or_add "$APP_ROOT/Contents/Info.plist" CFBundleVersion string "$APP_BUILD"
plist_set_or_add "$APP_ROOT/Contents/Info.plist" "$BUILD_INFO_TS_KEY" string "$BUILD_TS"
plist_set_or_add "$APP_ROOT/Contents/Info.plist" "$BUILD_INFO_COMMIT_KEY" string "$GIT_COMMIT"
plist_set_or_add "$APP_ROOT/Contents/Info.plist" "$BUILD_INFO_DIST_KEY" string "$DISTRO_ID"
plist_set_or_add "$APP_ROOT/Contents/Info.plist" SUFeedURL string "$SPARKLE_FEED_URL"
plist_set_or_add "$APP_ROOT/Contents/Info.plist" SUPublicEDKey string "$SPARKLE_PUBLIC_ED_KEY"
plist_set_or_add "$APP_ROOT/Contents/Info.plist" SUEnableAutomaticChecks bool "$AUTO_CHECKS"

cp "$BIN_PRIMARY" "$APP_ROOT/Contents/MacOS/$EXECUTABLE_NAME"
if [[ "${#BUILD_ARCHS[@]}" -gt 1 ]]; then
  BIN_INPUTS=()
  for arch in "${BUILD_ARCHS[@]}"; do
    BIN_INPUTS+=("$(bin_for_arch "$arch")")
  done
  /usr/bin/lipo -create "${BIN_INPUTS[@]}" -output "$APP_ROOT/Contents/MacOS/$EXECUTABLE_NAME"
fi
chmod +x "$APP_ROOT/Contents/MacOS/$EXECUTABLE_NAME"
/usr/bin/codesign --remove-signature "$APP_ROOT/Contents/MacOS/$EXECUTABLE_NAME" 2>/dev/null || true

SPARKLE_FRAMEWORK_PRIMARY="$(sparkle_framework_for_arch "$PRIMARY_ARCH")"
if [[ -d "$SPARKLE_FRAMEWORK_PRIMARY" ]]; then
  cp -R "$SPARKLE_FRAMEWORK_PRIMARY" "$APP_ROOT/Contents/Frameworks/"
  if [[ "${#BUILD_ARCHS[@]}" -gt 1 ]]; then
    OTHER_FRAMEWORKS=()
    for arch in "${BUILD_ARCHS[@]}"; do
      [[ "$arch" == "$PRIMARY_ARCH" ]] && continue
      OTHER_FRAMEWORKS+=("$(sparkle_framework_for_arch "$arch")")
    done
    merge_framework_machos "$SPARKLE_FRAMEWORK_PRIMARY" "$APP_ROOT/Contents/Frameworks/Sparkle.framework" "${OTHER_FRAMEWORKS[@]}"
  fi
fi

SWIFT_COMPAT_LIB="$(xcode-select -p)/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-6.2/macosx/libswiftCompatibilitySpan.dylib"
if [[ -f "$SWIFT_COMPAT_LIB" ]]; then
  cp "$SWIFT_COMPAT_LIB" "$APP_ROOT/Contents/Frameworks/"
  chmod +x "$APP_ROOT/Contents/Frameworks/libswiftCompatibilitySpan.dylib"
fi

ICON_SOURCE="${RESOURCE_DIR}/${ICON_FILE}.icns"
if [[ -f "$ICON_SOURCE" ]]; then
  cp "$ICON_SOURCE" "$APP_ROOT/Contents/Resources/${ICON_FILE}.icns"
fi

if [[ -d "$RESOURCE_DIR/DeviceModels" ]]; then
  rm -rf "$APP_ROOT/Contents/Resources/DeviceModels"
  cp -R "$RESOURCE_DIR/DeviceModels" "$APP_ROOT/Contents/Resources/DeviceModels"
fi

MODEL_CATALOG_SRC="$ROOT_DIR/node_modules/@mariozechner/pi-ai/dist/models.generated.js"
if [[ -f "$MODEL_CATALOG_SRC" ]]; then
  cp "$MODEL_CATALOG_SRC" "$APP_ROOT/Contents/Resources/models.generated.js"
fi

CONTROL_UI_DEST="$APP_ROOT/Contents/Resources/control-ui"
if [[ -d "$CONTROL_UI_STAGE" && -f "$CONTROL_UI_STAGE/index.html" ]]; then
  rm -rf "$CONTROL_UI_DEST"
  cp -R "$CONTROL_UI_STAGE" "$CONTROL_UI_DEST"
else
  echo "ERROR: Control UI staged assets em falta em $CONTROL_UI_STAGE." >&2
  exit 1
fi

BUNDLED_PACKAGE_DEST="$APP_ROOT/Contents/Resources/${PACKAGE_DIR_NAME}"
BUNDLED_PACKAGE_STAGE_ROOT="$(mktemp -d -t ${APP_SLUG}-bundled-package.XXXXXX)"
BUNDLED_PACKAGE_STAGE="$BUNDLED_PACKAGE_STAGE_ROOT/${PACKAGE_DIR_NAME}"
BUNDLED_NODE_RESOLVED="$(resolve_bundled_node_source || true)"
ENTRYPOINT_SOURCE=""
if [[ -f "$ROOT_DIR/${APP_SLUG}.mjs" ]]; then
  ENTRYPOINT_SOURCE="$ROOT_DIR/${APP_SLUG}.mjs"
elif [[ -f "$ROOT_DIR/${LEGACY_ENTRYPOINT}" ]]; then
  ENTRYPOINT_SOURCE="$ROOT_DIR/${LEGACY_ENTRYPOINT}"
fi
rm -rf "$BUNDLED_PACKAGE_DEST"
mkdir -p "$BUNDLED_PACKAGE_STAGE"
cp "$ROOT_DIR/package.json" "$BUNDLED_PACKAGE_STAGE/package.json"
if [[ -f "$ROOT_DIR/pnpm-lock.yaml" ]]; then
  cp "$ROOT_DIR/pnpm-lock.yaml" "$BUNDLED_PACKAGE_STAGE/pnpm-lock.yaml"
fi
if [[ -f "$ROOT_DIR/scripts/postinstall-bundled-plugins.mjs" ]]; then
  mkdir -p "$BUNDLED_PACKAGE_STAGE/scripts"
  cp "$ROOT_DIR/scripts/postinstall-bundled-plugins.mjs" \
    "$BUNDLED_PACKAGE_STAGE/scripts/postinstall-bundled-plugins.mjs"
fi
if [[ -n "$ENTRYPOINT_SOURCE" ]]; then
  cp "$ENTRYPOINT_SOURCE" "$BUNDLED_PACKAGE_STAGE/$(basename "$ENTRYPOINT_SOURCE")"
fi
if [[ -d "$ROOT_DIR/bin" ]]; then
  (cd "$ROOT_DIR" && tar -cf - bin) | (cd "$BUNDLED_PACKAGE_STAGE" && tar -xf -)
fi
copy_dist_snapshot_with_retry "$ROOT_DIR/dist" "$BUNDLED_PACKAGE_STAGE/dist"
if [[ -d "$ROOT_DIR/dist-runtime" ]]; then
  copy_tree_snapshot "$ROOT_DIR/dist-runtime" "$BUNDLED_PACKAGE_STAGE/dist-runtime"
  materialize_dist_runtime_node_modules "$BUNDLED_PACKAGE_STAGE/dist-runtime"
fi
# The embedded CLI resolves docs and built-in skills relative to the bundled package root.
for runtime_dir in docs skills; do
  if [[ -d "$ROOT_DIR/$runtime_dir" ]]; then
    (cd "$ROOT_DIR" && tar -cf - "$runtime_dir") | (cd "$BUNDLED_PACKAGE_STAGE" && tar -xf -)
  fi
done
if [[ ! -f "$BUNDLED_PACKAGE_STAGE/docs/reference/templates/AGENTS.md" ]]; then
  echo "ERROR: bundled package missing docs/reference/templates/AGENTS.md." >&2
  exit 1
fi
if [[ -d "$ROOT_DIR/skills" && ! -d "$BUNDLED_PACKAGE_STAGE/skills" ]]; then
  echo "ERROR: bundled package missing skills/." >&2
  exit 1
fi
if [[ -n "$BUNDLED_NODE_RESOLVED" ]]; then
  copy_bundled_node_runtime "$BUNDLED_NODE_RESOLVED" "$BUNDLED_PACKAGE_STAGE/tools/node"
  sign_bundled_node_runtime "$BUNDLED_PACKAGE_STAGE/tools/node"
  if ! validate_bundled_node_runtime "$BUNDLED_PACKAGE_STAGE/tools/node/bin/node"; then
    echo "ERROR: bundled Node runtime validation failed for $BUNDLED_NODE_RESOLVED." >&2
    exit 1
  fi
elif [[ "$BUILD_CONFIG" == "release" ]]; then
  echo "ERROR: release packaging exige Node bundled >=22.16.0." >&2
  exit 1
fi
(cd "$BUNDLED_PACKAGE_STAGE" && pnpm install --prod --frozen-lockfile --ignore-scripts)
prune_broken_symlinks "$BUNDLED_PACKAGE_STAGE"
mv "$BUNDLED_PACKAGE_STAGE" "$BUNDLED_PACKAGE_DEST"
rm -rf "$BUNDLED_PACKAGE_STAGE_ROOT"

KIT_BUNDLE_CANDIDATE="$(find_shared_kit_bundle "$(build_path_for_arch "$PRIMARY_ARCH")/$BUILD_CONFIG" || true)"
if [[ -n "$KIT_BUNDLE_CANDIDATE" && -d "$KIT_BUNDLE_CANDIDATE" ]]; then
  rm -rf "$APP_ROOT/Contents/Resources/$(basename "$KIT_BUNDLE_CANDIDATE")"
  cp -R "$KIT_BUNDLE_CANDIDATE" "$APP_ROOT/Contents/Resources/$(basename "$KIT_BUNDLE_CANDIDATE")"
fi

TEXTUAL_BUNDLE_DIR="$(build_path_for_arch "$PRIMARY_ARCH")/$BUILD_CONFIG"
TEXTUAL_BUNDLE=""
for candidate in "$TEXTUAL_BUNDLE_DIR/textual_Textual.bundle" "$TEXTUAL_BUNDLE_DIR/Textual_Textual.bundle"; do
  if [[ -d "$candidate" ]]; then
    TEXTUAL_BUNDLE="$candidate"
    break
  fi
done
if [[ -z "$TEXTUAL_BUNDLE" ]]; then
  TEXTUAL_BUNDLE="$(find "$BUILD_ROOT" -type d \( -name "textual_Textual.bundle" -o -name "Textual_Textual.bundle" \) -print -quit)"
fi
if [[ -n "$TEXTUAL_BUNDLE" && -d "$TEXTUAL_BUNDLE" ]]; then
  rm -rf "$APP_ROOT/Contents/Resources/$(basename "$TEXTUAL_BUNDLE")"
  cp -R "$TEXTUAL_BUNDLE" "$APP_ROOT/Contents/Resources/"
elif [[ "${ALLOW_MISSING_TEXTUAL_BUNDLE:-0}" != "1" ]]; then
  echo "ERROR: Textual resource bundle em falta." >&2
  exit 1
fi

killall -q "$PRODUCT" 2>/dev/null || true
if [[ "$PACKAGE_MODE" == "debug" && -z "${ALLOW_ADHOC_SIGNING:-}" ]]; then
  export ALLOW_ADHOC_SIGNING=1
fi
if [[ "$PACKAGE_MODE" != "debug" && "${ALLOW_ADHOC_SIGNING:-0}" == "1" ]]; then
  echo "ERROR: release-placeholder requires a real signing identity." >&2
  exit 1
fi
"$ROOT_DIR/scripts/codesign-mac-app.sh" "$APP_ROOT"
if [[ ! -d "$APP_ROOT" ]]; then
  echo "ERROR: bundle final em falta em $APP_ROOT." >&2
  exit 1
fi
if [[ ! -f "$APP_ROOT/Contents/Info.plist" ]]; then
  echo "ERROR: bundle final sem Info.plist em $APP_ROOT." >&2
  exit 1
fi
if [[ ! -x "$APP_ROOT/Contents/MacOS/$EXECUTABLE_NAME" ]]; then
  echo "ERROR: bundle final sem executável em $APP_ROOT/Contents/MacOS/$EXECUTABLE_NAME." >&2
  exit 1
fi
mkdir -p "$(dirname "$FINAL_APP_ROOT")"
rm -rf "$FINAL_APP_ROOT"
mv "$APP_ROOT" "$FINAL_APP_ROOT"
if [[ ! -d "$FINAL_APP_ROOT" ]]; then
  echo "ERROR: bundle final não foi persistido em $FINAL_APP_ROOT." >&2
  exit 1
fi
APP_ROOT="$FINAL_APP_ROOT"
if [[ "$PACKAGE_MODE" == "release-placeholder" ]]; then
  echo "ℹ️ Release placeholder ready. Use scripts/package-mac-dist.sh for zip/dmg + notarized distribution."
fi
echo "✅ Bundle pronto em $APP_ROOT"
