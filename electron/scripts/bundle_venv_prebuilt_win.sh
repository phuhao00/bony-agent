#!/bin/bash
# Build Windows x64 prebuilt venv for offline first-run (copy instead of pip install).
# Requires: extracted resources/python/runtime/python.exe + pip-wheels-win/
#
# On Windows (Git Bash / native): runs python.exe directly.
# On macOS/Linux: uses Wine to execute the bundled Windows Python (brew install wine-stable).
#
# Usage: bundle_venv_prebuilt_win.sh [project-root]
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
PYTHON_RES="$ROOT/electron/resources/python"
PY_RUNTIME="$PYTHON_RES/runtime"
PY_EXE="$PY_RUNTIME/python.exe"
VENV_OUT="$PYTHON_RES/venv-prebuilt"
VENV_PY="$VENV_OUT/Scripts/python.exe"
WHEELS_DIR="$ROOT/electron/resources/pip-wheels-win"
REQ="$ROOT/backend/requirements.txt"
STAMP_FILE="$VENV_OUT/.venv-prebuilt.stamp"
WINE_PREFIX="${WINEPREFIX:-$ROOT/storage/temp/wine-venv-prebuilt-prefix}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/build_cache.sh"

if [ "${SKIP_VENV_PREBUILT:-}" = "1" ]; then
  echo "[venv-prebuilt] SKIP_VENV_PREBUILT=1 — skipping"
  exit 0
fi

[ -f "$PY_EXE" ] || { echo "[venv-prebuilt] missing $PY_EXE — run build_win.sh Step 0c+ first" >&2; exit 1; }
[ -f "$REQ" ] || { echo "[venv-prebuilt] missing $REQ" >&2; exit 1; }

wheel_count=0
if [ -d "$WHEELS_DIR" ]; then
  wheel_count=$(find "$WHEELS_DIR" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')
fi
if [ "${wheel_count:-0}" -lt 5 ]; then
  echo "[venv-prebuilt] need pip-wheels-win (≥5 wheels) — run bundle_pip_wheels_win.sh first" >&2
  exit 1
fi

req_stamp="$(cache_requirements_stamp "$REQ")"
wheels_stamp=""
[ -f "$WHEELS_DIR/.requirements.sha256" ] && wheels_stamp="$(cat "$WHEELS_DIR/.requirements.sha256")"

cache_venv_prebuilt_fresh() {
  if [ "${FORCE_VENV_PREBUILT:-}" = "1" ]; then return 1; fi
  [ -f "$VENV_PY" ] || return 1
  [ -f "$STAMP_FILE" ] || return 1
  grep -Fxq "req=${req_stamp}" "$STAMP_FILE" 2>/dev/null || return 1
  grep -Fxq "wheels=${wheels_stamp}" "$STAMP_FILE" 2>/dev/null || return 1
  return 0
}

if cache_venv_prebuilt_fresh; then
  cache_log "reuse venv-prebuilt ($(du -sh "$VENV_OUT" 2>/dev/null | cut -f1 || echo ok))"
  exit 0
fi

is_windows_host() {
  case "${OS:-}" in
    Windows_NT) return 0 ;;
  esac
  case "${OSTYPE:-}" in
    msys*|cygwin*|win32*) return 0 ;;
  esac
  return 1
}

has_wine() {
  command -v wine64 >/dev/null 2>&1 || command -v wine >/dev/null 2>&1
}

wine_bin() {
  if command -v wine64 >/dev/null 2>&1; then echo wine64
  else echo wine
  fi
}

# Run Windows python.exe with Unix paths (Wine accepts them on macOS).
run_win_py() {
  local exe="$1"
  shift
  if is_windows_host; then
    "$exe" "$@"
  elif has_wine; then
    mkdir -p "$WINE_PREFIX"
    export WINEPREFIX="$WINE_PREFIX"
    export WINEDEBUG="${WINEDEBUG:--all}"
    "$(wine_bin)" "$exe" "$@"
  else
    echo "[venv-prebuilt] Wine not found — cannot build Windows venv on this host." >&2
    echo "[venv-prebuilt] Install: brew install --cask wine-stable" >&2
    echo "[venv-prebuilt] Or build once on Windows: powershell -File electron/scripts/prebuild_win_env.ps1" >&2
    return 1
  fi
}

to_win_path() {
  local p="$1"
  if is_windows_host; then
    if command -v cygpath >/dev/null 2>&1; then cygpath -w "$p"
    else printf '%s' "$p"
    fi
  else
    printf '%s' "$p"
  fi
}

echo "[venv-prebuilt] Building → $VENV_OUT"
rm -rf "$VENV_OUT"
mkdir -p "$(dirname "$VENV_OUT")"

run_win_py "$PY_EXE" -m venv "$VENV_OUT" --copies

WHEELS_ARG="$(to_win_path "$WHEELS_DIR")"
REQ_ARG="$(to_win_path "$REQ")"

run_win_py "$VENV_PY" -m pip install \
  --no-index \
  --find-links "$WHEELS_ARG" \
  -r "$REQ_ARG" \
  --prefer-binary \
  --no-warn-script-location

run_win_py "$VENV_PY" -c "import uvicorn, fastapi, pandas, openpyxl"

mkdir -p "$VENV_OUT"
{
  echo "req=${req_stamp}"
  echo "wheels=${wheels_stamp}"
  echo "built=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$STAMP_FILE"

echo "[venv-prebuilt] done — $(du -sh "$VENV_OUT" 2>/dev/null | cut -f1 || echo ok) at $VENV_OUT"
