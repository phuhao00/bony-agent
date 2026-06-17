#!/usr/bin/env bash
# Build web/ with Next.js standalone output for Electron packaging.
# Uses Turbopack (default in Next.js 16+). Set NEXT_BUILD_HEAP_MB to increase heap if OOM.
# Incremental cache: skips rebuild when web/ source is unchanged (set FORCE_NEXT_BUILD=1 to override).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB="$ROOT/web"
HEAP_MB="${NEXT_BUILD_HEAP_MB:-6144}"
CACHE_STAMP="$WEB/.next/.build_stamp"

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=${HEAP_MB}}"
export NEXT_TELEMETRY_DISABLED=1
export NEXT_STANDALONE=1

info() { printf '[next-standalone] %s\n' "$*"; }

cd "$WEB"
if [ ! -d node_modules ]; then
  info "Installing npm dependencies…"
  npm install --silent
fi

# ── Incremental cache check ───────────────────────────────────────────────────
# Compute a checksum of all source files (app/, components/, public/, config files).
# If the checksum matches the last successful build, skip rebuilding.
_src_hash() {
  find "$WEB/app" "$WEB/components" "$WEB/public" \
    "$WEB/next.config.ts" "$WEB/package.json" "$WEB/tsconfig.json" \
    -type f 2>/dev/null \
  | sort | xargs md5 -q 2>/dev/null || \
  find "$WEB/app" "$WEB/components" "$WEB/public" \
    "$WEB/next.config.ts" "$WEB/package.json" "$WEB/tsconfig.json" \
    -type f 2>/dev/null \
  | sort | xargs md5sum 2>/dev/null | md5sum | awk '{print $1}'
}

if [ "${FORCE_NEXT_BUILD:-0}" != "1" ] && [ -f "$CACHE_STAMP" ] && [ -f ".next/standalone/server.js" ]; then
  CURRENT_HASH="$(_src_hash)"
  CACHED_HASH="$(cat "$CACHE_STAMP" 2>/dev/null || echo '')"
  if [ "$CURRENT_HASH" = "$CACHED_HASH" ]; then
    info "Source unchanged (hash: ${CURRENT_HASH:0:12}…) — reusing cached standalone build. Set FORCE_NEXT_BUILD=1 to override."
    info "Done → $WEB/.next/standalone"
    exit 0
  fi
fi
# ─────────────────────────────────────────────────────────────────────────────

info "Building (turbopack, heap=${HEAP_MB}MB)…"
npm run build:standalone

[ -f .next/standalone/server.js ] || {
  echo "[next-standalone] ✗ missing .next/standalone/server.js" >&2
  exit 1
}

# Save checksum after successful build
_src_hash > "$CACHE_STAMP"

info "Done → $WEB/.next/standalone"
