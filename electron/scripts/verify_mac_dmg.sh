#!/bin/bash
# Post-build verification for macOS Electron DMG / .app (out-of-box readiness).
# Usage:
#   verify_mac_dmg.sh <project-root> <path-to.dmg>
#   verify_mac_dmg.sh <project-root> --app <path-to.app>
#
# Mirrors verify_win_zip.sh checks where applicable (env, runtime, skills, zip compat).

set -euo pipefail

ROOT="${1:?project root required}"
INPUT="${2:?dmg or --app required}"
MODE="dmg"
APP_BUNDLE=""

if [ "$INPUT" = "--app" ]; then
  MODE="app"
  APP_BUNDLE="${3:? .app path required with --app}"
else
  DMG="$INPUT"
fi

failures=0
warns=0
MOUNT=""
CLEANUP_MOUNT=0

cleanup() {
  if [ "$CLEANUP_MOUNT" = "1" ] && [ -n "$MOUNT" ] && [ -d "$MOUNT" ]; then
    hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  fi
}
trap cleanup EXIT

mkdir -p "$ROOT/storage/temp"

if [ "$MODE" = "dmg" ]; then
  [ -f "$DMG" ] || { echo "[verify-mac] ✗ dmg not found: $DMG" >&2; exit 1; }
  MOUNT="$ROOT/storage/temp/verify-mac-dmg-$$"
  mkdir -p "$MOUNT"
  echo "[verify-mac] Mounting $(basename "$DMG")…"
  hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT" "$DMG" >/dev/null
  CLEANUP_MOUNT=1
  # DMG also ships Install AI Media Agent.app — verify the main Electron app, not the installer.
  APP_BUNDLE=""
  for candidate in "$MOUNT/AI Media Agent.app" "$MOUNT"/*.app; do
    [ -d "$candidate" ] || continue
    case "$(basename "$candidate")" in
      Install*) continue ;;
    esac
    if [ -f "$candidate/Contents/Resources/resources/web-standalone/server.js" ]; then
      APP_BUNDLE="$candidate"
      break
    fi
  done
  if [ -z "$APP_BUNDLE" ]; then
    while IFS= read -r candidate; do
      case "$(basename "$candidate")" in
        Install*) continue ;;
      esac
      APP_BUNDLE="$candidate"
      break
    done < <(find "$MOUNT" -maxdepth 3 -name '*.app' -type d 2>/dev/null)
  fi
  [ -n "$APP_BUNDLE" ] || { echo "[verify-mac] ✗ no main .app in dmg (expected AI Media Agent.app)" >&2; exit 1; }
else
  [ -d "$APP_BUNDLE" ] || { echo "[verify-mac] ✗ app not found: $APP_BUNDLE" >&2; exit 1; }
fi

RES="$APP_BUNDLE/Contents/Resources/resources"

check_path() {
  local label="$1"
  local path="$2"
  if [ -e "$path" ]; then
    printf '[verify-mac] ✓ %s\n' "$label"
  else
    printf '[verify-mac] ✗ %s — missing: %s\n' "$label" "$path" >&2
    failures=$((failures + 1))
  fi
}

warn_path() {
  local label="$1"
  local path="$2"
  if [ -e "$path" ]; then
    printf '[verify-mac] ✓ %s\n' "$label"
  else
    printf '[verify-mac] ⚠ %s — optional missing: %s\n' "$label" "$path" >&2
    warns=$((warns + 1))
  fi
}

echo "[verify-mac] Inspecting $(basename "$APP_BUNDLE")…"

check_path ".env.bundled in package" "$RES/backend/.env.bundled"
if [ -f "$RES/backend/.env" ]; then
  printf '[verify-mac] ⚠ plaintext backend/.env found — prefer .env.bundled only\n' >&2
  warns=$((warns + 1))
fi

check_path "bundled Python tarball" "$RES/python/cpython-3.12.13+20260510-aarch64-apple-darwin-install_only.tar.gz"
warn_path "pre-extracted Python runtime" "$RES/python/runtime/bin/python3"
warn_path "bundled node (runtime)" "$RES/node/runtime/bin/node"
check_path "Next standalone server" "$RES/web-standalone/server.js"
check_path "backend bundle revision" "$RES/backend/.bundle_revision"
check_path "brand-logo (standalone)" "$RES/web-standalone/public/brand-logo.png"
warn_path "directory-service" "$RES/bin/directory-service"
warn_path "parser-service" "$RES/bin/parser-service"

if [ -d "$RES/agent-skills" ]; then
  skill_count=$(find "$RES/agent-skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
  if [ "${skill_count:-0}" -ge 10 ]; then
    printf '[verify-mac] ✓ agent-skills (%s skills)\n' "$skill_count"
  else
    printf '[verify-mac] ✗ agent-skills too few (%s)\n' "${skill_count:-0}" >&2
    failures=$((failures + 1))
  fi
else
  printf '[verify-mac] ✗ agent-skills missing\n' >&2
  failures=$((failures + 1))
fi

warn_path "offline pip wheels (mac)" "$RES/pip-wheels-mac"
mac_wheel_count=0
if [ -d "$RES/pip-wheels-mac" ]; then
  mac_wheel_count=$(find "$RES/pip-wheels-mac" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')
fi
if [ "${mac_wheel_count:-0}" -ge 5 ]; then
  printf '[verify-mac] ✓ offline pip wheels (mac) (%s wheels)\n' "$mac_wheel_count"
else
  printf '[verify-mac] ⚠ offline pip wheels (mac) — optional missing or too few (%s wheels)\n' "${mac_wheel_count:-0}" >&2
  warns=$((warns + 1))
fi
if [ -x "$RES/python/venv-prebuilt/bin/python3" ]; then
  printf '[verify-mac] ✓ prebuilt venv (fast first-run)\n'
else
  printf '[verify-mac] ⚠ prebuilt venv missing — first-run pip install\n' >&2
  warns=$((warns + 1))
fi
warn_path "mcp-bundled npm" "$RES/mcp-bundled/node_modules"
warn_path "lark-cli bundled" "$RES/lark-cli/node_modules"

BUNDLED_STAGING="$ROOT/electron/resources/backend/.env.bundled"
if [ -f "$BUNDLED_STAGING" ]; then
  for key in ZHIPUAI_API_KEY OPENROUTER_API_KEY GOOGLE_API_KEY; do
    if grep -qE "^${key}=.+[^[:space:]]" "$BUNDLED_STAGING" 2>/dev/null; then
      printf '[verify-mac] ✓ bundled key %s\n' "$key"
    else
      printf '[verify-mac] ✗ bundled key %s missing or empty\n' "$key" >&2
      failures=$((failures + 1))
    fi
  done
  for key in PEXELS_API_KEY; do
    if grep -qE "^${key}=.+[^[:space:]]" "$BUNDLED_STAGING" 2>/dev/null; then
      printf '[verify-mac] ✓ bundled key %s\n' "$key"
    else
      printf '[verify-mac] ✗ bundled key %s missing or empty\n' "$key" >&2
      failures=$((failures + 1))
    fi
  done
else
  printf '[verify-mac] ✗ staging .env.bundled missing — rebuild with backend/.env present\n' >&2
  failures=$((failures + 1))
fi

if [ "$MODE" = "dmg" ]; then
  size=$(du -sh "$DMG" | cut -f1)
  printf '[verify-mac] dmg size: %s\n' "$size"
fi

if [ "$failures" -gt 0 ]; then
  echo "[verify-mac] FAILED — $failures error(s), $warns warning(s)" >&2
  exit 1
fi

echo "[verify-mac] PASSED — $warns warning(s)"
exit 0
