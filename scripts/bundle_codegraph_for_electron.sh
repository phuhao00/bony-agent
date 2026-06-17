#!/usr/bin/env bash
# Copy built CodeGraph dist + SDK bridge into electron/resources for packaged apps.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${CODEGRAPH_HOME:-$ROOT/vendor/codegraph}"
DEST="$ROOT/electron/resources/codegraph"
SCRIPTS_DEST="$ROOT/electron/resources/scripts"

if [ ! -f "$SRC/dist/bin/codegraph.js" ]; then
  echo "[bundle-codegraph] dist not built at $SRC — run ./scripts/setup_codegraph.sh first" >&2
  exit 1
fi

mkdir -p "$DEST/dist" "$SCRIPTS_DEST"
rm -rf "$DEST/dist"
cp -R "$SRC/dist" "$DEST/"
cp -f "$ROOT/scripts/codegraph_sdk.mjs" "$SCRIPTS_DEST/codegraph_sdk.mjs"
printf '[bundle-codegraph] %s/dist → %s/dist\n' "$SRC" "$DEST"
printf '[bundle-codegraph] codegraph_sdk.mjs → %s\n' "$SCRIPTS_DEST"
