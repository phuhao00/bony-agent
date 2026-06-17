#!/bin/bash
# Download macOS Python 3.12 wheels for offline first-run pip install.
# Usage: bundle_pip_wheels_mac.sh [project-root] [x86_64|aarch64]
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
MAC_ARCH="${2:-aarch64}"
WHEELS_DIR="$ROOT/electron/resources/pip-wheels-mac"
REQ="$ROOT/backend/requirements.txt"
PYTHON="${ROOT}/venv/bin/python3"
[ -x "$PYTHON" ] || PYTHON="$(command -v python3)"
PY_RUNTIME="$ROOT/electron/resources/python/runtime/bin/python3"
MIN_WHEELS=5

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/build_cache.sh"

if [ "${SKIP_PIP_WHEELS:-}" = "1" ]; then
  echo "[wheels-mac] SKIP_PIP_WHEELS=1 — skipping"
  exit 0
fi

[ -f "$REQ" ] || { echo "[wheels-mac] missing $REQ"; exit 1; }

if cache_pip_wheels_fresh "$WHEELS_DIR" "$REQ" "$MIN_WHEELS"; then
  COUNT="$(find "$WHEELS_DIR" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')"
  cache_log "reuse pip-wheels-mac (${COUNT} wheels)"
  exit 0
fi

mkdir -p "$WHEELS_DIR"
: > "$WHEELS_DIR/download.log"
echo "[wheels-mac] Downloading macOS wheels (${MAC_ARCH}) → $WHEELS_DIR"

download_native() {
  local py="$1"
  "$py" -m pip install --upgrade pip -q 2>/dev/null || true
  if "$py" -m pip download -r "$REQ" -d "$WHEELS_DIR" \
    --only-binary=:all: 2>>"$WHEELS_DIR/download.log"; then
    return 0
  fi
  echo "[wheels-mac] partial binary download — retrying with source/sdists allowed" >>"$WHEELS_DIR/download.log"
  "$py" -m pip download -r "$REQ" -d "$WHEELS_DIR" \
    2>>"$WHEELS_DIR/download.log" || return 1
}

download_cross() {
  local platform_tag="macosx_11_0_${MAC_ARCH}"
  "$PYTHON" -m pip install --upgrade pip -q 2>/dev/null || true
  if "$PYTHON" -m pip download -r "$REQ" -d "$WHEELS_DIR" \
    --platform "$platform_tag" --python-version 312 --implementation cp \
    --only-binary=:all: 2>>"$WHEELS_DIR/download.log"; then
    return 0
  fi
  echo "[wheels-mac] cross binary failed — per-package fallback" >>"$WHEELS_DIR/download.log"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs 2>/dev/null || true)"
    [ -n "$line" ] || continue
    "$PYTHON" -m pip download "$line" -d "$WHEELS_DIR" \
      --platform "$platform_tag" --python-version 312 --implementation cp \
      --only-binary=:all: 2>>"$WHEELS_DIR/download.log" || \
    "$PYTHON" -m pip download "$line" -d "$WHEELS_DIR" \
      --no-deps --platform "$platform_tag" --python-version 312 --implementation cp \
      --only-binary=:all: 2>>"$WHEELS_DIR/download.log" || true
  done < "$REQ"
}

if [ "$MAC_ARCH" = "aarch64" ] && [ "$(uname -m)" = "arm64" ] && [ -x "$PY_RUNTIME" ]; then
  echo "[wheels-mac] using bundled Python runtime (native arm64 download)"
  download_native "$PY_RUNTIME" || download_cross || true
else
  echo "[wheels-mac] using cross-platform pip download (${MAC_ARCH})"
  download_cross || true
fi

COUNT="$(find "$WHEELS_DIR" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')"
if [ "${COUNT:-0}" -ge "$MIN_WHEELS" ]; then
  cache_write_pip_stamp "$WHEELS_DIR" "$REQ"
  echo "[wheels-mac] done — ${COUNT} wheel(s) in $WHEELS_DIR"
  exit 0
fi

rm -f "$WHEELS_DIR/.requirements.sha256"
echo "[wheels-mac] ✗ only ${COUNT:-0} wheel(s) — need ≥${MIN_WHEELS} (see $WHEELS_DIR/download.log)" >&2
exit 1
