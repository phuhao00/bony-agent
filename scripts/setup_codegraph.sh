#!/usr/bin/env bash
# Initialize vendor/codegraph submodule and build dist/ for local + Electron use.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$ROOT/vendor/codegraph"
LEGACY="${CODEGRAPH_LEGACY_HOME:-$HOME/Downloads/codegraph}"

info() { printf '[setup-codegraph] %s\n' "$*"; }
warn() { printf '[setup-codegraph] WARN: %s\n' "$*" >&2; }

if [ ! -d "$VENDOR/.git" ] && [ ! -f "$VENDOR/package.json" ]; then
  info "Initializing git submodule vendor/codegraph…"
  git -C "$ROOT" submodule update --init --recursive vendor/codegraph 2>/dev/null \
    || git -C "$ROOT" submodule add https://github.com/colbymchenry/codegraph vendor/codegraph
fi

if [ ! -f "$VENDOR/package.json" ]; then
  echo "vendor/codegraph missing — run: git submodule update --init vendor/codegraph" >&2
  exit 1
fi

info "Installing npm dependencies in $VENDOR …"
(
  cd "$VENDOR"
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
)

if [ ! -f "$VENDOR/dist/index.js" ] && [ -f "$LEGACY/dist/index.js" ]; then
  info "Reusing built dist/ from $LEGACY"
  mkdir -p "$VENDOR/dist"
  cp -R "$LEGACY/dist/." "$VENDOR/dist/"
fi

if [ ! -f "$VENDOR/dist/index.js" ]; then
  info "Building CodeGraph in $VENDOR …"
  (cd "$VENDOR" && npm run build)
fi

if [ ! -f "$VENDOR/dist/bin/codegraph.js" ]; then
  echo "Build failed: $VENDOR/dist/bin/codegraph.js not found" >&2
  exit 1
fi

info "CodeGraph ready at $VENDOR (dist built)"
"$ROOT/scripts/bundle_codegraph_for_electron.sh"
