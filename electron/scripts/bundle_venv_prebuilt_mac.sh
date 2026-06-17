#!/bin/bash
# Build macOS prebuilt venv for offline first-run (copy instead of pip install).
# Requires: extracted resources/python/runtime/bin/python3 + pip-wheels-mac/
#
# Usage: bundle_venv_prebuilt_mac.sh [project-root] [aarch64|x86_64]
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
MAC_ARCH="${2:-aarch64}"
PYTHON_RES="$ROOT/electron/resources/python"
PY_RUNTIME="$PYTHON_RES/runtime"
PY_EXE="$PY_RUNTIME/bin/python3"
VENV_OUT="$PYTHON_RES/venv-prebuilt"
VENV_PY="$VENV_OUT/bin/python3"
WHEELS_DIR="$ROOT/electron/resources/pip-wheels-mac"
REQ="$ROOT/backend/requirements.txt"
STAMP_FILE="$VENV_OUT/.venv-prebuilt.stamp"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/build_cache.sh"

if [ "${SKIP_VENV_PREBUILT:-}" = "1" ]; then
  echo "[venv-prebuilt-mac] SKIP_VENV_PREBUILT=1 — skipping"
  exit 0
fi

[ -x "$PY_EXE" ] || { echo "[venv-prebuilt-mac] missing $PY_EXE — run build_mac.sh Step 0c+ first" >&2; exit 1; }
[ -f "$REQ" ] || { echo "[venv-prebuilt-mac] missing $REQ" >&2; exit 1; }

wheel_count=0
if [ -d "$WHEELS_DIR" ]; then
  wheel_count=$(find "$WHEELS_DIR" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')
fi
if [ "${wheel_count:-0}" -lt 5 ]; then
  echo "[venv-prebuilt-mac] need pip-wheels-mac (≥5 wheels) — run bundle_pip_wheels_mac.sh first" >&2
  exit 1
fi

req_stamp="$(cache_requirements_stamp "$REQ")"
wheels_stamp=""
[ -f "$WHEELS_DIR/.requirements.sha256" ] && wheels_stamp="$(cat "$WHEELS_DIR/.requirements.sha256")"

cache_venv_prebuilt_fresh() {
  if [ "${FORCE_VENV_PREBUILT:-}" = "1" ]; then return 1; fi
  [ -x "$VENV_PY" ] || return 1
  [ -f "$STAMP_FILE" ] || return 1
  grep -Fxq "req=${req_stamp}" "$STAMP_FILE" 2>/dev/null || return 1
  grep -Fxq "wheels=${wheels_stamp}" "$STAMP_FILE" 2>/dev/null || return 1
  grep -Fxq "arch=${MAC_ARCH}" "$STAMP_FILE" 2>/dev/null || return 1
  return 0
}

if cache_venv_prebuilt_fresh; then
  cache_log "reuse venv-prebuilt-mac ($(du -sh "$VENV_OUT" 2>/dev/null | cut -f1 || echo ok))"
  exit 0
fi

echo "[venv-prebuilt-mac] Building (${MAC_ARCH}) → $VENV_OUT"
rm -rf "$VENV_OUT"
mkdir -p "$(dirname "$VENV_OUT")"

"$PY_EXE" -m venv "$VENV_OUT" --copies

"$VENV_PY" -m pip install --upgrade pip -q 2>/dev/null || true
"$VENV_PY" -m pip install \
  --no-index \
  --find-links "$WHEELS_DIR" \
  -r "$REQ" \
  --prefer-binary

"$VENV_PY" -c "import uvicorn, fastapi, pandas, openpyxl"

# Strip bytecode caches — shrink bundle and avoid spurious codesign targets
find "$VENV_OUT" -type d -name __pycache__ -print0 2>/dev/null | xargs -0 rm -rf 2>/dev/null || true
find "$VENV_OUT" -name '*.pyc' -delete 2>/dev/null || true

{
  echo "req=${req_stamp}"
  echo "wheels=${wheels_stamp}"
  echo "arch=${MAC_ARCH}"
  echo "built=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$STAMP_FILE"

echo "[venv-prebuilt-mac] done — $(du -sh "$VENV_OUT" 2>/dev/null | cut -f1 || echo ok) at $VENV_OUT"
