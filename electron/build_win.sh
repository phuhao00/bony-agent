#!/bin/bash
# =============================================================================
#  build_win.sh  –  AI Media Agent Windows installer builder
#
#  Prerequisites (build machine):
#    • Go 1.22+     (cross-compile to windows/amd64)
#    • Rust + x86_64-pc-windows-gnu target (optional parser-service)
#    • Node 18+     (Next.js + electron-builder)
#    • Python 3.10+ in ./venv (create_icons / Pillow)
#
#  Usage:
#    cd electron && ./build_win.sh              # NSIS if Wine available, else portable+zip
#    cd electron && ./build_win.sh portable     # force portable .exe only
#
#  Output:
#    electron/dist/AI Media Agent Setup *.exe   (NSIS, needs Wine on macOS/Linux)
#    electron/dist/AI Media Agent *.exe         (portable)
#    electron/dist/AI Media Agent-*-win.zip     (zip)
#
#  Build cache (skip re-download / re-extract when unchanged):
#    electron/resources/python/*.tar.gz
#    electron/resources/node/*.{zip,tar.gz} + runtime/
#    electron/resources/pip-wheels-win/  electron/resources/python/venv-prebuilt/
#    electron/resources/lark-cli/  electron/resources/mcp-bundled/
#  Force refresh: FORCE_REDOWNLOAD=1 FORCE_REEXTRACT=1 FORCE_NPM_INSTALL=1 FORCE_PIP_WHEELS=1 FORCE_VENV_PREBUILT=1
# =============================================================================

set -euo pipefail

TARGET="${1:-auto}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
ELECTRON_DIR="$ROOT_DIR/electron"
RES_DIR="$ELECTRON_DIR/resources"
BIN_DIR="$RES_DIR/bin"
ICONS_DIR="$RES_DIR/icons"
WEB_RES="$RES_DIR/web-standalone"
SCRIPT_DIR="$ELECTRON_DIR/scripts"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/build_cache.sh"
ARCH=x64
PY_ARCH=x86_64
PYTHON_VER=3.12.13
PYTHON_TAG=20260510

C_RESET="\033[0m"; C_BOLD="\033[1m"
C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_RED="\033[31m"; C_CYAN="\033[36m"
info()  { printf "${C_CYAN}${C_BOLD}[build] ➜${C_RESET}  %s\n" "$*"; }
ok()    { printf "${C_GREEN}${C_BOLD}[build] ✓${C_RESET}  %s\n" "$*"; }
warn()  { printf "${C_YELLOW}${C_BOLD}[build] ⚠${C_RESET}  %s\n" "$*"; }
die()   { printf "${C_RED}${C_BOLD}[build] ✗${C_RESET}  %s\n" "$*"; exit 1; }

has_wine() {
  command -v wine64 >/dev/null 2>&1 || command -v wine >/dev/null 2>&1
}

echo ""
printf "${C_BOLD}══════════════════════════════════════════════════════${C_RESET}\n"
printf "${C_BOLD}   AI Media Agent – Windows Builder (x64)             ${C_RESET}\n"
printf "${C_BOLD}══════════════════════════════════════════════════════${C_RESET}\n\n"

mkdir -p "$BIN_DIR" "$ICONS_DIR"

# ─── STEP 0: Brand assets ─────────────────────────────────────────────────────
info "Step 0/8 · Brand assets (logo + icons)…"
PYTHON="${ROOT_DIR}/venv/bin/python3"
if [ ! -x "$PYTHON" ]; then
  PYTHON="$(command -v python3)"
fi
[ -f "$ELECTRON_DIR/assets/logo.png" ] || die "Missing electron/assets/logo.png"
"$PYTHON" "$ELECTRON_DIR/scripts/create_icons.py"

info "Step 0b/8 · Bundling portable Python 3.12 (Windows)…"
PYTHON_RES="$RES_DIR/python"
mkdir -p "$PYTHON_RES"
PYTHON_TAR="cpython-${PYTHON_VER}+${PYTHON_TAG}-${PY_ARCH}-pc-windows-msvc-install_only.tar.gz"
PYTHON_TAR_PATH="$PYTHON_RES/$PYTHON_TAR"
PYTHON_TAR_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_TAG}/${PYTHON_TAR//+/%2B}"
cache_download "$PYTHON_TAR_URL" "$PYTHON_TAR_PATH" 1048576 "$PYTHON_TAR"
[ -f "$PYTHON_TAR_PATH" ] || die "Missing bundled Python: $PYTHON_TAR_PATH"

info "Step 0c/8 · Bundling portable Node.js (Windows)…"
NODE_VER=22.15.0
NODE_RES="$RES_DIR/node"
mkdir -p "$NODE_RES"
NODE_ZIP="node-v${NODE_VER}-win-x64.zip"
NODE_ZIP_PATH="$NODE_RES/$NODE_ZIP"
NODE_RUNTIME="$NODE_RES/runtime"
NODE_ZIP_URL="https://nodejs.org/dist/v${NODE_VER}/${NODE_ZIP}"
cache_download "$NODE_ZIP_URL" "$NODE_ZIP_PATH" 1048576 "$NODE_ZIP"
[ -f "$NODE_ZIP_PATH" ] || die "Missing bundled Node.js: $NODE_ZIP_PATH"
info "  Extracting Node.js runtime for offline install…"
cache_extract_tar "$NODE_ZIP_PATH" "$NODE_RUNTIME" "$NODE_RUNTIME/node.exe" 1

info "Step 0c+/8 · Pre-extract Python runtime (skip first-run tar)…"
PYTHON_RUNTIME="$PYTHON_RES/runtime"
cache_extract_tar "$PYTHON_TAR_PATH" "$PYTHON_RUNTIME" "$PYTHON_RUNTIME/python.exe" 1

info "Step 0d/8 · Bundling offline pip wheels (Windows x64)…"
if bash "$ELECTRON_DIR/scripts/bundle_pip_wheels_win.sh" "$ROOT_DIR"; then
  wheel_count=$(find "$RES_DIR/pip-wheels-win" -maxdepth 1 -name '*.whl' 2>/dev/null | wc -l | tr -d ' ')
  if [ "${wheel_count:-0}" -lt 5 ]; then
    die "pip-wheels-win 不足 (${wheel_count} wheels) — 首启将在线安装大量依赖。请检查网络后重跑，或设置 FORCE_PIP_WHEELS=1"
  fi
  ok "pip wheels (${wheel_count}) → $RES_DIR/pip-wheels-win/"
else
  die "pip wheels 下载失败 — Windows 包必须含离线 wheel，否则首启需联网安装数分钟"
fi

info "Step 0d+/8 · Prebuilding Windows venv (offline copy at first-run)…"
if bash "$ELECTRON_DIR/scripts/bundle_venv_prebuilt_win.sh" "$ROOT_DIR"; then
  ok "venv-prebuilt → $PYTHON_RES/venv-prebuilt/"
else
  warn "venv-prebuilt 未生成 — 首启将从 wheel 离线 pip（数分钟）。在 macOS 上需 Wine：brew install --cask wine-stable"
  warn "或在 Windows 上执行：powershell -File electron/scripts/prebuild_win_env.ps1"
fi

info "Step 0e/8 · Pre-install lark-cli…"
LARK_RES="$RES_DIR/lark-cli"
LARK_STAMP="@larksuite/cli@^1.0.12"
if cache_npm_installed "$LARK_RES" "$LARK_STAMP"; then
  ok "lark-cli (cached) → $LARK_RES/node_modules"
else
  rm -rf "$LARK_RES"
  mkdir -p "$LARK_RES"
  (
    cd "$LARK_RES"
    npm init -y >/dev/null 2>&1
    npm install --no-save --omit=dev @larksuite/cli@^1.0.12
  )
  cache_write_npm_marker "$LARK_RES" "$LARK_STAMP"
  ok "lark-cli → $LARK_RES/node_modules"
fi
node "$ELECTRON_DIR/scripts/materialize_npm_bins.js" "$LARK_RES"

info "Step 0f/8 · Prune Windows-incompatible bundled files…"
find "$PYTHON_RES" -maxdepth 1 -name '*darwin*' -delete 2>/dev/null || true
find "$BIN_DIR" -maxdepth 1 -type f ! -name '*.exe' -delete 2>/dev/null || true
ok "pruned mac python / mac bin (kept node/python archives for rebuild cache)"

SKIP_DESKTOP_PET=1 bash "$ELECTRON_DIR/scripts/validate_packaging_assets.sh" "$ROOT_DIR" win-resources
ok "brand-logo + icons + Windows Python + Node.js ready"

# ─── STEP 1+2: Go + Rust parallel build ──────────────────────────────────────
info "Step 1/8 · Building Go directory-service (windows/amd64) [parallel]…"
info "Step 2/8 · Building Rust parser-service (windows-gnu) [parallel]…"

_go_pid=""
_rust_pid=""

if command -v go >/dev/null 2>&1; then
  (
    cd "$ROOT_DIR/backend_massive_concurrent"
    go mod tidy 2>/dev/null
    GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" \
      -o "$BIN_DIR/directory-service.exe" ./cmd/server
  ) &
  _go_pid=$!
else
  warn "go not found — skipping directory-service.exe"
fi

export CARGO_TARGET_DIR="$ROOT_DIR/backend_safety/target"
if command -v cargo >/dev/null 2>&1; then
  (
    cd "$ROOT_DIR/backend_safety"
    rustup target add x86_64-pc-windows-gnu 2>/dev/null || true
    cargo build --release --target x86_64-pc-windows-gnu 2>/dev/null && \
      cp "$CARGO_TARGET_DIR/x86_64-pc-windows-gnu/release/parser-service.exe" \
        "$BIN_DIR/parser-service.exe"
  ) &
  _rust_pid=$!
else
  warn "cargo not found — skipping parser-service.exe"
fi

# Wait for both to finish
if [ -n "$_go_pid" ]; then
  if wait "$_go_pid"; then
    ok "directory-service.exe → $BIN_DIR/directory-service.exe"
  else
    warn "Go build failed — directory-service.exe unavailable"
  fi
fi
if [ -n "$_rust_pid" ]; then
  if wait "$_rust_pid"; then
    ok "parser-service.exe → $BIN_DIR/parser-service.exe"
  else
    warn "Rust windows cross-build failed — parser service will be unavailable in package"
  fi
fi

# ─── STEP 3: Next.js standalone ──────────────────────────────────────────────
info "Step 3/8 · Building Next.js (standalone)…"
bash "$ELECTRON_DIR/scripts/build_next_standalone.sh"
ok "Next.js build complete"

rm -rf "$WEB_RES"
cp -r "$WEB_DIR/.next/standalone" "$WEB_RES"
mkdir -p "$WEB_RES/public"
cp -r "$WEB_DIR/public/." "$WEB_RES/public/" 2>/dev/null || true
cp -f "$WEB_DIR/public/brand-logo.png" "$WEB_RES/public/brand-logo.png"
mkdir -p "$WEB_RES/.next"
cp -r "$WEB_DIR/.next/static" "$WEB_RES/.next/static"

info "  Installing Windows native modules for standalone frontend…"
(
  cd "$WEB_RES"
  rm -rf node_modules/@img/sharp-darwin-* node_modules/@next/swc-darwin-* 2>/dev/null || true
  npm install --no-save --omit=dev @img/sharp-win32-x64 sharp 2>/dev/null || \
    warn "Could not install @img/sharp-win32-x64 (frontend may still run with unoptimized images)"
)
info "  Pruning Windows-incompatible filenames in Next.js chunks…"
node "$ELECTRON_DIR/scripts/prune_windows_filenames.js" "$WEB_RES"
if find "$WEB_RES" -name '*:*' 2>/dev/null | grep -q .; then
  die "web-standalone still contains ':' in filenames — Windows 解压会报 0x80070057"
fi
ok "Next.js standalone → $WEB_RES"

# ─── STEP 3b: Ensure stock API keys in backend/.env (optional env injection) ───
if [ -x "$ELECTRON_DIR/scripts/ensure_stock_env_keys.sh" ]; then
  bash "$ELECTRON_DIR/scripts/ensure_stock_env_keys.sh" || true
fi

# ─── STEP 4: Backend source ───────────────────────────────────────────────────
info "Step 4/8 · Copying Python backend source…"
BACKEND_RES="$RES_DIR/backend"
rm -rf "$BACKEND_RES"
mkdir -p "$BACKEND_RES"
for d in agents core tools utils routers services admin; do
  [ -d "$ROOT_DIR/backend/$d" ] && cp -r "$ROOT_DIR/backend/$d" "$BACKEND_RES/"
done
for f in main.py requirements.txt .env.example; do
  [ -f "$ROOT_DIR/backend/$f" ] && cp "$ROOT_DIR/backend/$f" "$BACKEND_RES/"
done
if [ -f "$ROOT_DIR/backend/.env" ]; then
  cp "$ROOT_DIR/backend/.env" "$BACKEND_RES/.env.bundled"
  ok "Bundled env defaults → $BACKEND_RES/.env.bundled"
fi
[ -d "$ROOT_DIR/backend/generated" ] && cp -r "$ROOT_DIR/backend/generated" "$BACKEND_RES/generated"
PKG_VERSION="$(node -p "require(process.argv[1]).version" "$ELECTRON_DIR/package.json" 2>/dev/null || echo 0.0.0)"
GIT_REV="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "${PKG_VERSION}-${GIT_REV}" > "$BACKEND_RES/.bundle_revision"
ok "Backend source → $BACKEND_RES (rev ${PKG_VERSION}-${GIT_REV})"

# ─── STEP 4b: Bundle agent skills + default MCP/skill configs ────────────────
info "Step 4b/8 · Bundling agent skills + MCP defaults…"
SKILLS_RES="$RES_DIR/agent-skills"
rm -rf "$SKILLS_RES"
mkdir -p "$SKILLS_RES"
# -L: dereference symlinks (e.g. .agent/skills/last30days → ../../.agents/skills/last30days)
cp -RL "$ROOT_DIR/.agent/skills/." "$SKILLS_RES/"
find "$SKILLS_RES" -name '.DS_Store' -delete 2>/dev/null || true
SKILL_COUNT="$(find "$SKILLS_RES" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
ok "Agent skills (${SKILL_COUNT}) → $SKILLS_RES"

DEFAULTS_RES="$RES_DIR/storage-defaults"
rm -rf "$DEFAULTS_RES"
mkdir -p "$DEFAULTS_RES"
[ -f "$ROOT_DIR/storage/mcp_servers.json" ] && cp "$ROOT_DIR/storage/mcp_servers.json" "$DEFAULTS_RES/mcp_servers.json"
node "$ELECTRON_DIR/scripts/generate_skills_enabled.js" "$SKILLS_RES" > "$DEFAULTS_RES/skills_enabled.json"
ok "skills_enabled.json (${SKILL_COUNT} skills, all enabled)"
# 重置 MCP 运行时状态字段 — 目标机器首启时由后端重新探测/拉起预设
if [ -f "$DEFAULTS_RES/mcp_servers.json" ]; then
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const s of cfg.servers || []) {
      s.status = ""; s.status_msg = "";
      delete s.server_name; delete s.server_version;
    }
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
  ' "$DEFAULTS_RES/mcp_servers.json"
fi
ok "Storage defaults → $DEFAULTS_RES"

info "Step 4d/8 · Bundling MCP npm packages (offline launch)…"
if bash "$ELECTRON_DIR/scripts/bundle_mcp_node.sh" "$ROOT_DIR"; then
  ok "mcp-bundled → $RES_DIR/mcp-bundled/"
else
  warn "MCP npm bundle incomplete — presets may download on first launch"
fi

# ─── STEP 4c: Bundle CodeGraph dist (vendor submodule) ───────────────────────
info "Step 4c/8 · Bundling CodeGraph dist…"
if [ -f "$ROOT_DIR/scripts/bundle_codegraph_for_electron.sh" ]; then
  bash "$ROOT_DIR/scripts/bundle_codegraph_for_electron.sh" || warn "CodeGraph dist missing — run ./scripts/setup_codegraph.sh"
else
  warn "bundle_codegraph_for_electron.sh not found; skipping CodeGraph bundle"
fi

# ─── STEP 5: OCR service ──────────────────────────────────────────────────────
info "Step 5/8 · Copying OCR service source…"
OCR_RES="$RES_DIR/ocr-service"
rm -rf "$OCR_RES"
mkdir -p "$OCR_RES"
cp -r "$ROOT_DIR/services/ocr/." "$OCR_RES/"
ok "OCR service → $OCR_RES"

# ─── STEP 5b: Desktop pet (Boni) ─────────────────────────────────────────────
info "Step 5b/8 · Bundling desktop pet (Windows exe)…"
if bash "$ELECTRON_DIR/scripts/bundle_desktop_pet_win.sh"; then
  ok "desktop-pet → $RES_DIR/desktop-pet/ai-media-agent-desktop-pet.exe"
else
  die "桌宠交叉编译失败 — Windows 包必须含 Boni sidecar。修复: brew install mingw-w64 && rustup target add x86_64-pc-windows-gnu，然后重跑 ./build_win.sh"
fi

cp -f "$ROOT_DIR/web/public/brand-logo.png" "$WEB_RES/public/brand-logo.png"
bash "$ELECTRON_DIR/scripts/validate_packaging_assets.sh" "$ROOT_DIR" win-resources

info "Step 5c/8 · Materialize npm .bin for Windows (no symlinks in zip)…"
node "$ELECTRON_DIR/scripts/materialize_npm_bins.js" "$LARK_RES" "$RES_DIR/mcp-bundled"
ok "npm .bin → Windows .cmd shims"

# ─── STEP 6: electron-builder (Windows) ───────────────────────────────────────
info "Step 6/8 · Building Windows package…"
cd "$ELECTRON_DIR"
if [ ! -d node_modules ]; then
  npm install --silent
fi

export CSC_IDENTITY_AUTO_DISCOVERY=false

build_portable_zip() {
  # On macOS/Linux without a working Wine, electron-builder's rcedit step
  # (embeds version string + icon into the .exe) fails with
  #   "wineserver: Can't check in server_mach_port".
  # That step is cosmetic for portable/zip, so skip it when Wine is absent.
  local extra=()
  if ! has_wine; then
    warn "Wine 不可用 — 跳过 rcedit (signAndEditExecutable=false)，exe 版本号/图标元数据不写入（不影响运行）"
    extra+=(--config.win.signAndEditExecutable=false)
  fi
  # bash 3.2 (macOS) + set -u: guard empty-array expansion
  npx electron-builder --win --x64 --config.win.target=portable ${extra[@]+"${extra[@]}"}
  npx electron-builder --win --x64 --config.win.target=zip ${extra[@]+"${extra[@]}"}
}

case "$TARGET" in
  portable)
    build_portable_zip
    ;;
  nsis)
    if has_wine; then
      npm run build:win
    else
      die "NSIS build requires Wine. Install: brew install wine-stable — or run: ./build_win.sh portable"
    fi
    ;;
  auto|*)
    if has_wine; then
      info "  Wine detected — building NSIS installer + portable fallback"
      npm run build:win || build_portable_zip
    else
      warn "Wine not found — building portable .exe + zip (no NSIS Setup.exe on this machine)"
      warn "Install Wine for NSIS: brew install --cask wine-stable"
      build_portable_zip
    fi
    ;;
esac

# ─── STEP 7: Validate win-unpacked ────────────────────────────────────────────
info "Step 7/8 · Validating packaged Windows assets…"
WIN_UNPACKED="$(find "$ELECTRON_DIR/dist/win-unpacked" -maxdepth 0 -type d 2>/dev/null | head -1 || true)"
if [ -n "$WIN_UNPACKED" ]; then
  bash "$ELECTRON_DIR/scripts/validate_packaging_assets.sh" "$ROOT_DIR" win-unpacked "$WIN_UNPACKED"
  ok "Bundled Windows assets verified"
else
  warn "win-unpacked not found — skip unpacked validation"
fi

# ─── STEP 8: Verify final zip (out-of-box / pet / env / zip compat) ───────────
info "Step 8/8 · Verifying Windows zip (OOB readiness)…"
WIN_ZIP="$(find "$ELECTRON_DIR/dist" -maxdepth 1 -name '*-win.zip' -type f 2>/dev/null | head -1 || true)"
if [ -n "$WIN_ZIP" ]; then
  bash "$ELECTRON_DIR/scripts/verify_win_zip.sh" "$ROOT_DIR" "$WIN_ZIP"
  ok "zip verification passed: $(basename "$WIN_ZIP")"
else
  warn "no *-win.zip found in dist/ — skip zip verification"
fi

echo ""
ok "════════════════════════════════════════════"
ok " Build complete!"
ok " Output: electron/dist/"
ls -lh "$ELECTRON_DIR/dist/"*.exe "$ELECTRON_DIR/dist/"*.zip 2>/dev/null || true
ok "════════════════════════════════════════════"
echo ""
cat <<'NOTE'
═══════════════════════════════════════════════════════
  Windows 分发说明:

  • NSIS: AI Media Agent Setup <ver>.exe — 标准安装向导（需管理员）
  • Portable: AI Media Agent <ver>.exe — 免安装单文件（便携版，每次启动会解压，较慢）
  • Zip: 解压后运行 AI Media Agent.exe（推荐，启动更快）

  首次启动会运行安装向导（内置 Python + Node，无需单独安装）。
  若包内含有 venv-prebuilt，Python 依赖为复制预构建环境（秒级），否则离线 pip wheel（数分钟）。
  在 macOS 上打 Windows 包并生成 venv-prebuilt 需 Wine：
    brew install --cask wine-stable
  或在 Windows 上执行：powershell -File electron/scripts/prebuild_win_env.ps1
  用户数据: %APPDATA%/ai-media-agent/

  桌宠 (Boni) 已内置：托盘「启动桌宠」即可，无需单独下载便携 zip。
  路径: resources/resources/desktop-pet/ai-media-agent-desktop-pet.exe
═══════════════════════════════════════════════════════
NOTE
