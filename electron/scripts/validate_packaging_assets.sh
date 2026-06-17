#!/bin/bash
# Validate brand logo, icons, and other assets required for Electron packaging.
# Usage:
#   validate_packaging_assets.sh <project-root> [resources|app-bundle <path>|win-resources|win-unpacked <path>|mac-resources]

set -euo pipefail

ROOT="${1:?project root required}"
MODE="${2:-resources}"
APP_BUNDLE="${3:-}"

failures=0
check_file() {
  local label="$1"
  local path="$2"
  if [ -f "$path" ]; then
    printf '[validate] ✓ %s\n' "$label"
  else
    printf '[validate] ✗ %s — missing: %s\n' "$label" "$path" >&2
    failures=$((failures + 1))
  fi
}

ELECTRON="$ROOT/electron"
WEB_PUBLIC="$ROOT/web/public/brand-logo.png"
STANDALONE_PUBLIC="$ELECTRON/resources/web-standalone/public/brand-logo.png"
ICON_ICNS="$ELECTRON/resources/icons/icon.icns"
ICON_512="$ELECTRON/resources/icons/icon_512.png"

ICON_ICNS="$ELECTRON/resources/icons/icon.icns"
ICON_ICO="$ELECTRON/resources/icons/icon.ico"
ICON_512="$ELECTRON/resources/icons/icon_512.png"

check_file "source logo (electron/assets)" "$ELECTRON/assets/logo.png"
check_file "brand-logo (web/public)" "$WEB_PUBLIC"

if [ "$MODE" = "win-resources" ] || [ "$MODE" = "win-unpacked" ]; then
  PYTHON_TAR="$ELECTRON/resources/python/cpython-3.12.13+20260510-x86_64-pc-windows-msvc-install_only.tar.gz"
  PYTHON_RUNTIME="$ELECTRON/resources/python/runtime/python.exe"
  NODE_RUNTIME="$ELECTRON/resources/node/runtime/node.exe"
  check_file "bundled Python runtime (win x64)" "$PYTHON_RUNTIME"
  VENV_PREBUILT="$ELECTRON/resources/python/venv-prebuilt/Scripts/python.exe"
  if [ -f "$VENV_PREBUILT" ]; then
    check_file "prebuilt venv (win x64)" "$VENV_PREBUILT"
  else
    printf '[validate] ○ venv-prebuilt optional — first-run pip from wheels\n'
  fi
  if [ -f "$PYTHON_TAR" ]; then
    printf '[validate] ✓ bundled Python tarball (fallback)\n'
  else
    printf '[validate] ○ bundled Python tarball optional (runtime pre-extracted)\n'
  fi
  check_file "bundled Node.js runtime (win x64)" "$NODE_RUNTIME"
  check_file "icon.ico" "$ICON_ICO"
  if [ -f "$ELECTRON/resources/bin/directory-service.exe" ]; then
    check_file "directory-service.exe" "$ELECTRON/resources/bin/directory-service.exe"
  fi
  if [ "${SKIP_DESKTOP_PET:-}" = "1" ]; then
    printf '[validate] ○ desktop-pet optional — built in Step 5b\n'
  else
    check_file "desktop-pet exe (required)" "$ELECTRON/resources/desktop-pet/ai-media-agent-desktop-pet.exe"
    check_file "WebView2Loader.dll (required)" "$ELECTRON/resources/desktop-pet/WebView2Loader.dll"
  fi
  check_file ".env.bundled (OOB keys)" "$ELECTRON/resources/backend/.env.bundled"
elif [ "$MODE" = "resources" ] || [ "$MODE" = "app-bundle" ] || [ "$MODE" = "mac-resources" ]; then
  PYTHON_TAR="$ELECTRON/resources/python/cpython-3.12.13+20260510-aarch64-apple-darwin-install_only.tar.gz"
  PYTHON_RUNTIME="$ELECTRON/resources/python/runtime/bin/python3"
  NODE_RUNTIME="$ELECTRON/resources/node/runtime/bin/node"
  check_file "bundled Python (arm64 tarball)" "$PYTHON_TAR"
  if [ -f "$PYTHON_RUNTIME" ]; then
    check_file "bundled Python runtime (pre-extracted)" "$PYTHON_RUNTIME"
  else
    printf '[validate] ○ bundled Python runtime optional (tarball fallback)\n'
  fi
  if [ -f "$NODE_RUNTIME" ]; then
    check_file "bundled Node.js runtime (darwin)" "$NODE_RUNTIME"
  else
    printf '[validate] ○ bundled Node.js runtime optional (install-time download)\n'
  fi
  VENV_PREBUILT_MAC="$ELECTRON/resources/python/venv-prebuilt/bin/python3"
  if [ -f "$VENV_PREBUILT_MAC" ]; then
    check_file "prebuilt venv (mac arm64)" "$VENV_PREBUILT_MAC"
  else
    printf '[validate] ○ venv-prebuilt optional — first-run pip from wheels\n'
  fi
fi

# brand-logo must be copied from source logo, not the old purple placeholder (~4 KB)
if [ -f "$ELECTRON/assets/logo.png" ] && [ -f "$WEB_PUBLIC" ]; then
  src_size=$(stat -f%z "$ELECTRON/assets/logo.png" 2>/dev/null || stat -c%s "$ELECTRON/assets/logo.png" 2>/dev/null || echo 0)
  brand_size=$(stat -f%z "$WEB_PUBLIC" 2>/dev/null || stat -c%s "$WEB_PUBLIC" 2>/dev/null || echo 0)
  if [ "$src_size" -gt 50000 ] && [ "$brand_size" -lt 50000 ]; then
    printf '[validate] ✗ brand-logo looks like placeholder (%s bytes) — source logo is %s bytes\n' "$brand_size" "$src_size" >&2
    failures=$((failures + 1))
  fi
fi
check_file "icon_512.png" "$ICON_512"
if [ "$MODE" != "win-resources" ] && [ "$MODE" != "win-unpacked" ]; then
  check_file "icon.icns" "$ICON_ICNS"
fi

if [ "$MODE" = "resources" ] || [ "$MODE" = "win-resources" ] || [ "$MODE" = "mac-resources" ]; then
  if [ -d "$ELECTRON/resources/web-standalone" ]; then
    check_file "brand-logo (web-standalone/public)" "$STANDALONE_PUBLIC"
    if [ "$MODE" = "win-resources" ] || [ "$MODE" = "win-unpacked" ]; then
      colon_count=$(find "$ELECTRON/resources/web-standalone" -name '*:*' 2>/dev/null | wc -l | tr -d ' ')
      if [ "${colon_count:-0}" -gt 0 ]; then
        printf '[validate] ✗ web-standalone has %s file(s) with ":" — run prune_windows_filenames.js\n' "$colon_count" >&2
        failures=$((failures + 1))
      else
        printf '[validate] ✓ no colon filenames in web-standalone\n'
      fi
    fi
  fi
  for tray in tray-green tray-yellow tray-red; do
    check_file "$tray.png" "$ELECTRON/resources/icons/${tray}.png"
  done
  check_file "MCP defaults (storage-defaults/mcp_servers.json)" "$ELECTRON/resources/storage-defaults/mcp_servers.json"
  if [ -d "$ELECTRON/resources/lark-cli/node_modules" ]; then
    printf '[validate] ✓ lark-cli preinstalled\n'
  else
    printf '[validate] ⚠ lark-cli not bundled — first-run npm install\n' >&2
  fi
  if [ -d "$ELECTRON/resources/mcp-bundled/node_modules" ]; then
    printf '[validate] ✓ mcp-bundled npm packages\n'
  else
    printf '[validate] ⚠ mcp-bundled missing — MCP presets may download on first use\n' >&2
  fi
  wheel_count=0
  if [ -d "$ELECTRON/resources/pip-wheels-win" ]; then
    wheel_count=$(find "$ELECTRON/resources/pip-wheels-win" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')
  fi
  if [ "${wheel_count:-0}" -ge 5 ]; then
    printf '[validate] ✓ pip-wheels-win (%s wheels)\n' "$wheel_count"
    if grep -qE '^pandas\b' "$ROOT/backend/requirements.txt" 2>/dev/null; then
      if find "$ELECTRON/resources/pip-wheels-win" -maxdepth 1 -name 'pandas-*.whl' 2>/dev/null | grep -q .; then
        printf '[validate] ✓ pip-wheels-win includes pandas\n'
      else
        printf '[validate] ✗ pip-wheels-win missing pandas wheel — run FORCE_PIP_WHEELS=1 ./build_win.sh\n' >&2
        failures=$((failures + 1))
      fi
    fi
  elif [ "$MODE" = "win-resources" ] || [ "$MODE" = "win-unpacked" ]; then
    printf '[validate] ✗ pip-wheels-win too few (%s wheels) — run bundle_pip_wheels_win.sh\n' "${wheel_count:-0}" >&2
    failures=$((failures + 1))
  else
    printf '[validate] ○ pip-wheels-win optional (%s wheels) — online pip fallback\n' "${wheel_count:-0}"
  fi
  mac_wheel_count=0
  if [ -d "$ELECTRON/resources/pip-wheels-mac" ]; then
    mac_wheel_count=$(find "$ELECTRON/resources/pip-wheels-mac" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')
  fi
  if [ "$MODE" = "mac-resources" ] || [ "$MODE" = "resources" ]; then
    if [ "${mac_wheel_count:-0}" -ge 5 ]; then
      printf '[validate] ✓ pip-wheels-mac (%s wheels)\n' "$mac_wheel_count"
    else
      printf '[validate] ○ pip-wheels-mac optional (%s wheels) — online pip fallback\n' "${mac_wheel_count:-0}"
    fi
  fi
  if [ -d "$ELECTRON/resources/agent-skills" ]; then
    skill_count=$(find "$ELECTRON/resources/agent-skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
    if [ "${skill_count:-0}" -lt 10 ]; then
      printf '[validate] ✗ agent-skills too few (%s dirs) — run build step 4b\n' "$skill_count" >&2
      failures=$((failures + 1))
    else
      printf '[validate] ✓ agent-skills (%s skills)\n' "$skill_count"
    fi
  else
    printf '[validate] ✗ agent-skills missing — run build step 4b\n' >&2
    failures=$((failures + 1))
  fi
fi

if [ "$MODE" = "app-bundle" ]; then
  [ -n "$APP_BUNDLE" ] || { echo "[validate] app-bundle mode requires .app path" >&2; exit 1; }
  RES="$APP_BUNDLE/Contents/Resources/resources"
  check_file "brand-logo (bundled standalone)" "$RES/web-standalone/public/brand-logo.png"
  check_file "icon.icns (bundled)" "$APP_BUNDLE/Contents/Resources/icon.icns"
  check_file "bundled Python (in .app)" "$RES/python/cpython-3.12.13+20260510-aarch64-apple-darwin-install_only.tar.gz"
  if [ -f "$RES/python/runtime/bin/python3" ]; then
    check_file "pre-extracted Python (in .app)" "$RES/python/runtime/bin/python3"
  fi
  if [ -f "$RES/node/runtime/bin/node" ]; then
    check_file "bundled Node.js (in .app)" "$RES/node/runtime/bin/node"
  fi
  if [ -f "$RES/python/venv-prebuilt/bin/python3" ]; then
    check_file "prebuilt venv (in .app)" "$RES/python/venv-prebuilt/bin/python3"
  fi
  check_file ".env.bundled (in .app)" "$RES/backend/.env.bundled"
fi

if [ "$MODE" = "win-unpacked" ]; then
  [ -n "$APP_BUNDLE" ] || { echo "[validate] win-unpacked mode requires win-unpacked dir path" >&2; exit 1; }
  RES="$APP_BUNDLE/resources/resources"
  colon_count=$(find "$RES/web-standalone" -name '*:*' 2>/dev/null | wc -l | tr -d ' ')
  if [ "${colon_count:-0}" -gt 0 ]; then
    printf '[validate] ✗ web-standalone has %s file(s) with ":" in name — Windows unzip 0x80070057\n' "$colon_count" >&2
    find "$RES/web-standalone" -name '*:*' 2>/dev/null | head -3 >&2
    failures=$((failures + 1))
  else
    printf '[validate] ✓ no colon filenames in web-standalone\n'
  fi
  check_file "brand-logo (bundled standalone)" "$RES/web-standalone/public/brand-logo.png"
  check_file "bundled Python (in win package)" "$RES/python/cpython-3.12.13+20260510-x86_64-pc-windows-msvc-install_only.tar.gz"
  if [ -f "$RES/python/venv-prebuilt/Scripts/python.exe" ]; then
    check_file "prebuilt venv (in win package)" "$RES/python/venv-prebuilt/Scripts/python.exe"
  else
    printf '[validate] ⚠ prebuilt venv missing — first-run will offline pip from wheels (slower)\n' >&2
  fi
  win_wheel_count=0
  if [ -d "$RES/pip-wheels-win" ]; then
    win_wheel_count=$(find "$RES/pip-wheels-win" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')
  fi
  if [ "${win_wheel_count:-0}" -lt 5 ]; then
    printf '[validate] ✗ pip-wheels-win too few (%s) — first-run needs online pip\n' "${win_wheel_count:-0}" >&2
    failures=$((failures + 1))
  else
    printf '[validate] ✓ pip-wheels-win (%s wheels)\n' "$win_wheel_count"
  fi
  check_file "bundled Node.js runtime (in win package)" "$RES/node/runtime/node.exe"
  if [ -f "$RES/bin/directory-service.exe" ]; then
    check_file "directory-service.exe (bundled)" "$RES/bin/directory-service.exe"
  fi
  check_file "desktop-pet exe (in win package)" "$RES/desktop-pet/ai-media-agent-desktop-pet.exe"
  check_file "WebView2Loader.dll (in win package)" "$RES/desktop-pet/WebView2Loader.dll"
  check_file ".env.bundled (in win package)" "$RES/backend/.env.bundled"
  check_file "MCP defaults (in win package)" "$RES/storage-defaults/mcp_servers.json"
  if [ -d "$RES/agent-skills" ]; then
    skill_count=$(find "$RES/agent-skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
    if [ "${skill_count:-0}" -lt 10 ]; then
      printf '[validate] ✗ agent-skills in win package too few (%s)\n' "$skill_count" >&2
      failures=$((failures + 1))
    else
      printf '[validate] ✓ agent-skills in win package (%s skills)\n' "$skill_count"
    fi
  else
    printf '[validate] ✗ agent-skills missing in win package\n' >&2
    failures=$((failures + 1))
  fi
fi

if [ "$failures" -gt 0 ]; then
  echo "[validate] $failures check(s) failed — run: python3 electron/scripts/create_icons.py" >&2
  exit 1
fi

echo "[validate] All packaging asset checks passed."
