#!/bin/bash
# Post-build verification for Windows Electron zip (out-of-box readiness).
# Usage: verify_win_zip.sh <project-root> <path-to-win.zip>
#
# Checks: desktop-pet sidecar, .env.bundled, core runtime, zip compatibility
# (see .agent/skills/electron-mac-packaging/SKILL.md + windows-package-compat skill).

set -euo pipefail

ROOT="${1:?project root required}"
ZIP="${2:?zip path required}"

if [ ! -f "$ZIP" ]; then
  echo "[verify-zip] ✗ zip not found: $ZIP" >&2
  exit 1
fi

failures=0
warns=0
ENTRIES="$(mktemp "$ROOT/storage/temp/verify-win-zip.XXXXXX")"
mkdir -p "$ROOT/storage/temp"
trap 'rm -f "$ENTRIES"' EXIT
zipinfo -1 "$ZIP" > "$ENTRIES"

check_zip_entry() {
  local label="$1"
  local needle="$2"
  if grep -Fq "$needle" "$ENTRIES"; then
    printf '[verify-zip] ✓ %s\n' "$label"
  else
    printf '[verify-zip] ✗ %s — missing: %s\n' "$label" "$needle" >&2
    failures=$((failures + 1))
  fi
}

warn_zip_entry() {
  local label="$1"
  local needle="$2"
  if grep -Fq "$needle" "$ENTRIES"; then
    printf '[verify-zip] ✓ %s\n' "$label"
  else
    printf '[verify-zip] ⚠ %s — optional missing: %s\n' "$label" "$needle" >&2
    warns=$((warns + 1))
  fi
}

echo "[verify-zip] Inspecting $(basename "$ZIP")…"

# ── Out-of-box: env (via .env.bundled, not plaintext .env) ─────────────────────
check_zip_entry ".env.bundled in package" "resources/resources/backend/.env.bundled"
if grep -Fxq "resources/resources/backend/.env" "$ENTRIES"; then
  printf '[verify-zip] ⚠ plaintext backend/.env found in zip — prefer .env.bundled only\n' >&2
  warns=$((warns + 1))
fi

# ── Desktop pet (Boni) sidecar ───────────────────────────────────────────────
check_zip_entry "desktop-pet exe" "resources/resources/desktop-pet/ai-media-agent-desktop-pet.exe"
check_zip_entry "WebView2Loader.dll" "resources/resources/desktop-pet/WebView2Loader.dll"
if grep -Fq "desktop-pet/launch/route.js" "$ENTRIES" || grep -Fq "desktop-pet/launch/route.ts" "$ENTRIES"; then
  printf '[verify-zip] ✓ desktop-pet launch API\n'
else
  printf '[verify-zip] ✗ desktop-pet launch API missing\n' >&2
  failures=$((failures + 1))
fi

# ── Core runtime ─────────────────────────────────────────────────────────────
check_zip_entry "pre-extracted Python runtime" "resources/resources/python/runtime/python.exe"
warn_zip_entry "prebuilt venv (fast first-run)" "resources/resources/python/venv-prebuilt/Scripts/python.exe"
warn_zip_entry "Windows Python tarball (fallback)" "cpython-3.12.13+20260510-x86_64-pc-windows-msvc-install_only.tar.gz"
check_zip_entry "bundled node.exe" "resources/resources/node/runtime/node.exe"
check_zip_entry "Next standalone server" "resources/resources/web-standalone/server.js"
check_zip_entry "backend bundle revision" "resources/resources/backend/.bundle_revision"
if grep -qE '^pandas\b' "$ROOT/backend/requirements.txt" 2>/dev/null; then
  if grep -Ei 'pip-wheels-win/pandas-.*\.whl' "$ENTRIES" >/dev/null 2>&1; then
    printf '[verify-zip] ✓ pandas wheel bundled for offline Excel/knowledge\n'
  else
    printf '[verify-zip] ⚠ pandas wheel not in zip — Excel RAG may need online pip on first run\n' >&2
    warns=$((warns + 1))
  fi
fi
warn_zip_entry "directory-service.exe" "resources/resources/bin/directory-service.exe"
warn_zip_entry "parser-service.exe" "resources/resources/bin/parser-service.exe"

# ── Agent skills ─────────────────────────────────────────────────────────────
skill_dirs=$(grep -E '^resources/resources/agent-skills/[^/]+/$' "$ENTRIES" | wc -l | tr -d ' ')
if [ "${skill_dirs:-0}" -ge 10 ]; then
  printf '[verify-zip] ✓ agent-skills (%s dirs)\n' "$skill_dirs"
else
  printf '[verify-zip] ✗ agent-skills too few (%s dirs)\n' "${skill_dirs:-0}" >&2
  failures=$((failures + 1))
fi

if grep -Fq "resources/resources/pip-wheels-win/" "$ENTRIES"; then
  wheel_in_zip=$(grep -cE 'pip-wheels-win/[^/]+\.whl$' "$ENTRIES" 2>/dev/null || echo 0)
  if [ "${wheel_in_zip:-0}" -lt 5 ]; then
    printf '[verify-zip] ✗ pip-wheels-win too few (%s .whl) — first-run needs online pip\n' "${wheel_in_zip:-0}" >&2
    failures=$((failures + 1))
  else
    printf '[verify-zip] ✓ offline pip wheels (%s .whl)\n' "$wheel_in_zip"
  fi
else
  printf '[verify-zip] ✗ pip-wheels-win missing — first-run needs online pip\n' >&2
  failures=$((failures + 1))
fi
warn_zip_entry "mcp-bundled npm" "resources/resources/mcp-bundled/node_modules"
warn_zip_entry "lark-cli bundled" "resources/resources/lark-cli/node_modules"

# ── npm .bin: no symlinks (Windows Explorer unzip privilege error) ───────────
bin_symlinks=$(
  LC_ALL=C zipinfo -l "$ZIP" 2>/dev/null \
    | grep 'node_modules/\.bin/' \
    | grep '^l' \
    | head -20 \
    || true
)
if [ -n "$bin_symlinks" ]; then
  printf '[verify-zip] ✗ symlinks in node_modules/.bin — Windows unzip needs Developer Mode\n' >&2
  echo "$bin_symlinks" >&2
  failures=$((failures + 1))
else
  printf '[verify-zip] ✓ no symlinks in npm .bin\n'
fi

check_zip_entry "supergateway.cmd (MCP offline)" "resources/resources/mcp-bundled/node_modules/.bin/supergateway.cmd"
check_zip_entry "lark-cli.cmd" "resources/resources/lark-cli/node_modules/.bin/lark-cli.cmd"

# ── .env.bundled key sanity (names only, no secret output) ───────────────────
BUNDLED_STAGING="$ROOT/electron/resources/backend/.env.bundled"
if [ -f "$BUNDLED_STAGING" ]; then
  for key in ZHIPUAI_API_KEY OPENROUTER_API_KEY GOOGLE_API_KEY; do
    if grep -qE "^${key}=.+[^[:space:]]" "$BUNDLED_STAGING" 2>/dev/null; then
      printf '[verify-zip] ✓ bundled key %s\n' "$key"
    else
      printf '[verify-zip] ✗ bundled key %s missing or empty\n' "$key" >&2
      failures=$((failures + 1))
    fi
  done
  for key in PEXELS_API_KEY; do
    if grep -qE "^${key}=.+[^[:space:]]" "$BUNDLED_STAGING" 2>/dev/null; then
      printf '[verify-zip] ✓ bundled key %s\n' "$key"
    else
      printf '[verify-zip] ✗ bundled key %s missing or empty — stock footage not OOB\n' "$key" >&2
      failures=$((failures + 1))
    fi
  done
  for key in PIXABAY_API_KEY; do
    if grep -qE "^${key}=.+[^[:space:]]" "$BUNDLED_STAGING" 2>/dev/null; then
      printf '[verify-zip] ✓ bundled key %s (optional)\n' "$key"
    else
      printf '[verify-zip] ○ bundled key %s not set — Pexels alone is sufficient\n' "$key"
    fi
  done
  printf '[verify-zip] ○ STT (桌宠语音): 需用户在向导配置 DASHSCOPE_API_KEY 或 ALIBABA_API_KEY（引擎 qwen3-asr-flash）\n'
else
  printf '[verify-zip] ✗ staging .env.bundled missing — rebuild with backend/.env present\n' >&2
  failures=$((failures + 1))
fi

# ── windows-package-compat checks ────────────────────────────────────────────
colon_entries=$(grep -E ':' "$ENTRIES" || true)
if [ -n "$colon_entries" ]; then
  printf '[verify-zip] ✗ filenames with ":" — Windows Explorer unzip fails (0x80070057)\n' >&2
  echo "$colon_entries" | head -5 >&2
  failures=$((failures + 1))
else
  printf '[verify-zip] ✓ no colon in zip paths\n'
fi

bad=$(grep -E '(^|/)(__MACOSX|\.DS_Store|\.git)(/|$)|(^|/)\._' "$ENTRIES" || true)
if [ -n "$bad" ]; then
  printf '[verify-zip] ✗ macOS metadata or .git in zip\n' >&2
  echo "$bad" | head -5 >&2
  failures=$((failures + 1))
else
  printf '[verify-zip] ✓ no .DS_Store / __MACOSX / .git\n'
fi

long=$(awk 'length($0) > 180 { print length($0), $0 }' "$ENTRIES" | head -3)
if [ -n "$long" ]; then
  printf '[verify-zip] ⚠ paths longer than 180 chars (Windows Explorer risk)\n' >&2
  echo "$long" >&2
  warns=$((warns + 1))
else
  printf '[verify-zip] ✓ path lengths OK\n'
fi

file_count=$(wc -l < "$ENTRIES" | tr -d ' ')
size=$(du -sh "$ZIP" | cut -f1)
printf '[verify-zip] %s files, %s total\n' "$file_count" "$size"

if [ "$failures" -gt 0 ]; then
  echo "[verify-zip] FAILED — $failures error(s), $warns warning(s)" >&2
  exit 1
fi

echo "[verify-zip] PASSED — $warns warning(s)"
exit 0
