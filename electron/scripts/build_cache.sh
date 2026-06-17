#!/bin/bash
# Shared download / extract / npm cache helpers for electron build scripts.
#
# Environment:
#   FORCE_REDOWNLOAD=1   Re-fetch archives even if cached
#   FORCE_REEXTRACT=1    Re-run tar extract even if marker matches
#   FORCE_NPM_INSTALL=1  Always npm install
#   FORCE_VENV_PREBUILT=1 Rebuild venv-prebuilt (Windows + macOS)
#
# Usage: source "$(dirname "$0")/build_cache.sh"

set -euo pipefail

CACHE_MIN_BYTES_DEFAULT=1048576

cache_log() { printf '[cache] %s\n' "$*"; }

cache_file_size() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0
}

cache_file_mtime() {
  stat -f%m "$1" 2>/dev/null || stat -c%Y "$1" 2>/dev/null || echo 0
}

cache_file_valid() {
  local file="$1"
  local min_bytes="${2:-$CACHE_MIN_BYTES_DEFAULT}"
  [ -f "$file" ] || return 1
  if [ "${FORCE_REDOWNLOAD:-}" = "1" ]; then return 1; fi
  [ "$(cache_file_size "$file")" -ge "$min_bytes" ]
}

# cache_download URL DEST [MIN_BYTES] [LABEL]
cache_download() {
  local url="$1"
  local dest="$2"
  local min_bytes="${3:-$CACHE_MIN_BYTES_DEFAULT}"
  local label="${4:-$(basename "$dest")}"

  mkdir -p "$(dirname "$dest")"
  if cache_file_valid "$dest" "$min_bytes"; then
    cache_log "reuse $label ($(du -sh "$dest" 2>/dev/null | cut -f1 || echo cached))"
    return 0
  fi

  cache_log "download ${label}..."
  curl -fL --retry 3 --retry-delay 2 -o "$dest" "$url"
  cache_file_valid "$dest" "$min_bytes" || {
    echo "[cache] ✗ invalid download: $dest" >&2
    return 1
  }
}

cache_extract_marker() {
  echo "$1/.extract-cache-marker"
}

# cache_extract_tar ARCHIVE DEST_DIR EXE_CHECK [STRIP_COMPONENTS]
cache_extract_tar() {
  local archive="$1"
  local dest_dir="$2"
  local exe_check="$3"
  local strip="${4:-1}"
  local marker
  marker="$(cache_extract_marker "$dest_dir")"

  if [ "${FORCE_REEXTRACT:-}" != "1" ] && [ -f "$exe_check" ] && [ -f "$marker" ]; then
    local archived archived_mtime marker_mtime
    archived="$(cache_file_size "$archive")"
    archived_mtime="$(cache_file_mtime "$archive")"
    marker_mtime="$(cache_file_mtime "$marker")"
    if [ "$marker_mtime" -ge "$archived_mtime" ] && grep -Fxq "size=${archived}" "$marker" 2>/dev/null; then
      cache_log "reuse extract → $(basename "$dest_dir")"
      return 0
    fi
  fi

  cache_log "extract → $(basename "$dest_dir")"
  rm -rf "$dest_dir"
  mkdir -p "$dest_dir"
  tar -xf "$archive" -C "$dest_dir" --strip-components="$strip"
  [ -f "$exe_check" ] || {
    echo "[cache] ✗ extract failed (missing $exe_check)" >&2
    return 1
  }
  printf 'size=%s\nmtime=%s\n' "$(cache_file_size "$archive")" "$(cache_file_mtime "$archive")" > "$marker"
}

cache_requirements_stamp() {
  local req="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$req" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$req" | awk '{print $1}'
  else
    cache_file_mtime "$req"
  fi
}

# cache_pip_wheels_fresh WHEELS_DIR REQ_FILE MIN_WHEELS
cache_pip_wheels_fresh() {
  local wheels_dir="$1"
  local req="$2"
  local min_wheels="${3:-5}"
  local stamp_file="$wheels_dir/.requirements.sha256"
  local stamp
  stamp="$(cache_requirements_stamp "$req")"

  if [ "${FORCE_PIP_WHEELS:-}" = "1" ]; then return 1; fi
  [ -d "$wheels_dir" ] || return 1
  [ -f "$stamp_file" ] || return 1
  [ "$(cat "$stamp_file" 2>/dev/null)" = "$stamp" ] || return 1
  local count
  count=$(find "$wheels_dir" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')
  [ "${count:-0}" -ge "$min_wheels" ]
}

cache_write_pip_stamp() {
  local wheels_dir="$1"
  local req="$2"
  mkdir -p "$wheels_dir"
  cache_requirements_stamp "$req" > "$wheels_dir/.requirements.sha256"
}

# cache_npm_installed DIR STAMP
cache_npm_installed() {
  local dir="$1"
  local stamp="$2"
  local marker="$dir/.npm-cache-marker"
  if [ "${FORCE_NPM_INSTALL:-}" = "1" ]; then return 1; fi
  [ -d "$dir/node_modules" ] || return 1
  [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$stamp" ]
}

cache_write_npm_marker() {
  local dir="$1"
  local stamp="$2"
  mkdir -p "$dir"
  echo "$stamp" > "$dir/.npm-cache-marker"
}
