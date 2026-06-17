#!/bin/bash
# Download Windows x64 Python 3.12 wheels for offline first-run pip install.
# Usage: bundle_pip_wheels_win.sh [project-root]
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
WHEELS_DIR="$ROOT/electron/resources/pip-wheels-win"
REQ="$ROOT/backend/requirements.txt"
PYTHON="${ROOT}/venv/bin/python3"
[ -x "$PYTHON" ] || PYTHON="$(command -v python3)"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/build_cache.sh"

if [ "${SKIP_PIP_WHEELS:-}" = "1" ]; then
  echo "[wheels] SKIP_PIP_WHEELS=1 — skipping"
  exit 0
fi

[ -f "$REQ" ] || { echo "[wheels] missing $REQ"; exit 1; }

if cache_pip_wheels_fresh "$WHEELS_DIR" "$REQ" 5; then
  COUNT="$(find "$WHEELS_DIR" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')"
  cache_log "reuse pip-wheels-win (${COUNT} wheels)"
  exit 0
fi

mkdir -p "$WHEELS_DIR"
echo "[wheels] Downloading Windows wheels → $WHEELS_DIR"

"$PYTHON" -m pip install --upgrade pip -q 2>/dev/null || true

# Primary: binary wheels for win_amd64 / cp312
if ! "$PYTHON" -m pip download -r "$REQ" \
  -d "$WHEELS_DIR" \
  --platform win_amd64 --python-version 312 --implementation cp \
  --only-binary=:all: 2>"$WHEELS_DIR/download.log"; then
  echo "[wheels] partial binary download — retrying without only-binary for remaining"
  "$PYTHON" -m pip download -r "$REQ" \
    -d "$WHEELS_DIR" \
    --platform win_amd64 --python-version 312 --implementation cp \
    2>>"$WHEELS_DIR/download.log" || true
fi

COUNT="$(find "$WHEELS_DIR" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')"
cache_write_pip_stamp "$WHEELS_DIR" "$REQ"
echo "[wheels] done — ${COUNT} wheel(s) in $WHEELS_DIR"

if grep -qE '^pandas\b' "$REQ" 2>/dev/null; then
  if ! find "$WHEELS_DIR" -maxdepth 1 -name 'pandas-*.whl' 2>/dev/null | grep -q .; then
    echo "[wheels] ✗ requirements.txt lists pandas but no pandas-*.whl was downloaded" >&2
    exit 1
  fi
  echo "[wheels] ✓ pandas wheel present"
fi
