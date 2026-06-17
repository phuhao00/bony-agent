#!/bin/bash
# Pre-install MCP npm packages for offline preset launch (Windows/mac build host).
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
MCP_DIR="$ROOT/electron/resources/mcp-bundled"
MCP_STAMP="supergateway@latest @modelcontextprotocol/server-memory@latest @modelcontextprotocol/server-filesystem@latest @modelcontextprotocol/server-sequential-thinking@latest @modelcontextprotocol/server-everything@latest @playwright/mcp@latest"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/build_cache.sh"

if [ "${SKIP_MCP_BUNDLE:-}" = "1" ]; then
  echo "[mcp-bundle] SKIP_MCP_BUNDLE=1 — skipping"
  exit 0
fi

if cache_npm_installed "$MCP_DIR" "$MCP_STAMP"; then
  cache_log "reuse mcp-bundled → $MCP_DIR/node_modules"
  node "$SCRIPT_DIR/materialize_npm_bins.js" "$MCP_DIR"
  exit 0
fi

mkdir -p "$MCP_DIR"
cd "$MCP_DIR"

if [ ! -f package.json ]; then
  npm init -y >/dev/null 2>&1
fi

echo "[mcp-bundle] Installing MCP npm packages…"
npm install --no-save --omit=dev \
  supergateway@latest \
  @modelcontextprotocol/server-memory@latest \
  @modelcontextprotocol/server-filesystem@latest \
  @modelcontextprotocol/server-sequential-thinking@latest \
  @modelcontextprotocol/server-everything@latest \
  @playwright/mcp@latest

cache_write_npm_marker "$MCP_DIR" "$MCP_STAMP"
node "$SCRIPT_DIR/materialize_npm_bins.js" "$MCP_DIR"
echo "[mcp-bundle] → $MCP_DIR/node_modules"
