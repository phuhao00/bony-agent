#!/bin/bash
# =============================================================================
#  build_mac.sh  –  AI Media Agent macOS .dmg builder
#
#  Prerequisites:
#    • macOS (arm64 or x64)
#    • Go   1.22+   installed (brew install go)
#    • Rust 1.75+   installed (rustup)
#    • Node 18+     installed
#    • Python 3.10+ installed
#
#  Usage:
#    cd electron && ./build_mac.sh                    # 默认 arm64 + unsigned（M 系列，无 Developer ID）
#    cd electron && ./build_mac.sh arm64 unsigned   # 同上，显式写法
#    cd electron && ./build_mac.sh arm64 signed     # Developer ID 签名（有 mac-build.env 则公证）
#    cd electron && ./build_mac.sh universal signed # Intel+M 通用包（需显式指定，较慢）
#
#  Output:
#    electron/dist/AI Media Agent-*.dmg
#
#  Build cache (same as build_win.sh — archives under electron/resources/):
#    python tarball, node tar.gz, pip-wheels-mac, venv-prebuilt, lark-cli, mcp-bundled
#  Force refresh: FORCE_REDOWNLOAD=1 FORCE_REEXTRACT=1 FORCE_NPM_INSTALL=1 FORCE_PIP_WHEELS=1 FORCE_VENV_PREBUILT=1
# =============================================================================

set -euo pipefail

ARCH="${1:-arm64}"
UNSIGNED="${2:-unsigned}"
if [ "$ARCH" = "unsigned" ]; then
  UNSIGNED="unsigned"
  ARCH="arm64"
elif [ "$ARCH" = "signed" ]; then
  UNSIGNED=""
  ARCH="arm64"
fi
if [ "${2:-}" = "unsigned" ]; then
  UNSIGNED="unsigned"
elif [ "${2:-}" = "signed" ]; then
  UNSIGNED=""
fi
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"  # project root (agent/)
WEB_DIR="$ROOT_DIR/web"
ELECTRON_DIR="$ROOT_DIR/electron"
RES_DIR="$ELECTRON_DIR/resources"
BIN_DIR="$RES_DIR/bin"
ICONS_DIR="$RES_DIR/icons"
SCRIPT_DIR="$ELECTRON_DIR/scripts"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/build_cache.sh"

# Load notarization credentials only for signed builds (gitignored)
MAC_BUILD_ENV="$ELECTRON_DIR/mac-build.env"
if [ "$UNSIGNED" != "unsigned" ] && [ -f "$MAC_BUILD_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$MAC_BUILD_ENV"
  set +a
fi

# Colour helpers
C_RESET="\033[0m"; C_BOLD="\033[1m"
C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_RED="\033[31m"; C_CYAN="\033[36m"
info()  { printf "${C_CYAN}${C_BOLD}[build] ➜${C_RESET}  %s\n" "$*"; }
ok()    { printf "${C_GREEN}${C_BOLD}[build] ✓${C_RESET}  %s\n" "$*"; }
warn()  { printf "${C_YELLOW}${C_BOLD}[build] ⚠${C_RESET}  %s\n" "$*"; }
die()   { printf "${C_RED}${C_BOLD}[build] ✗${C_RESET}  %s\n" "$*"; exit 1; }

echo ""
printf "${C_BOLD}══════════════════════════════════════════════════════${C_RESET}\n"
printf "${C_BOLD}   AI Media Agent – macOS DMG Builder                 ${C_RESET}\n"
printf "${C_BOLD}   arch: %-10s  mode: %-10s                      ${C_RESET}\n" "$ARCH" "${UNSIGNED:-signed}"
printf "${C_BOLD}══════════════════════════════════════════════════════${C_RESET}\n\n"

mkdir -p "$BIN_DIR" "$ICONS_DIR"

# ─── STEP 0: Brand assets (logo + icons) — MUST run before Next.js public copy ─
info "Step 0/8 · Brand assets (logo + icons)…"
PYTHON="${ROOT_DIR}/venv/bin/python3"
if [ ! -x "$PYTHON" ]; then
  PYTHON="$(command -v python3)"
fi
[ -f "$ELECTRON_DIR/assets/logo.png" ] || die "Missing electron/assets/logo.png — add your app logo before building"
"$PYTHON" "$ELECTRON_DIR/scripts/create_icons.py"

# Bundle portable Python into .app (install-time no GitHub download)
info "Step 0b/8 · Bundling portable Python 3.12…"
PYTHON_RES="$RES_DIR/python"
mkdir -p "$PYTHON_RES"
case "$ARCH" in
  arm64) PY_ARCH=aarch64; NODE_DARWIN_ARCH=arm64 ;;
  x64)   PY_ARCH=x86_64; NODE_DARWIN_ARCH=x64 ;;
  *)     PY_ARCH=aarch64; NODE_DARWIN_ARCH=arm64 ;;
esac
PYTHON_VER=3.12.13
PYTHON_TAG=20260510
PYTHON_TAR="cpython-${PYTHON_VER}+${PYTHON_TAG}-${PY_ARCH}-apple-darwin-install_only.tar.gz"
PYTHON_TAR_PATH="$PYTHON_RES/$PYTHON_TAR"
PYTHON_TAR_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_TAG}/${PYTHON_TAR//+/%2B}"
cache_download "$PYTHON_TAR_URL" "$PYTHON_TAR_PATH" 1048576 "$PYTHON_TAR"
[ -f "$PYTHON_TAR_PATH" ] || die "Missing bundled Python: $PYTHON_TAR_PATH"

info "Step 0c/8 · Bundling portable Node.js (macOS)…"
NODE_VER=22.15.0
NODE_RES="$RES_DIR/node"
mkdir -p "$NODE_RES"
NODE_TGZ="node-v${NODE_VER}-darwin-${NODE_DARWIN_ARCH}.tar.gz"
NODE_TGZ_PATH="$NODE_RES/$NODE_TGZ"
NODE_RUNTIME="$NODE_RES/runtime"
NODE_TGZ_URL="https://nodejs.org/dist/v${NODE_VER}/${NODE_TGZ}"
cache_download "$NODE_TGZ_URL" "$NODE_TGZ_PATH" 1048576 "$NODE_TGZ"
[ -f "$NODE_TGZ_PATH" ] || die "Missing bundled Node.js: $NODE_TGZ_PATH"
info "  Extracting Node.js runtime for offline install…"
cache_extract_tar "$NODE_TGZ_PATH" "$NODE_RUNTIME" "$NODE_RUNTIME/bin/node" 1

info "Step 0c+/8 · Pre-extract Python runtime (skip first-run tar)…"
PYTHON_RUNTIME="$PYTHON_RES/runtime"
cache_extract_tar "$PYTHON_TAR_PATH" "$PYTHON_RUNTIME" "$PYTHON_RUNTIME/bin/python3" 1

info "Step 0d/8 · Bundling offline pip wheels (macOS ${PY_ARCH})…"
if bash "$SCRIPT_DIR/bundle_pip_wheels_mac.sh" "$ROOT_DIR" "$PY_ARCH"; then
  ok "pip wheels → $RES_DIR/pip-wheels-mac/"
else
  warn "pip wheels download incomplete — first-run may use online pip"
fi

info "Step 0d+/8 · Prebuilding macOS venv (offline copy at first-run)…"
if bash "$SCRIPT_DIR/bundle_venv_prebuilt_mac.sh" "$ROOT_DIR" "$PY_ARCH"; then
  ok "venv-prebuilt → $PYTHON_RES/venv-prebuilt/"
else
  warn "venv-prebuilt skipped — first-run will pip install from wheels (slower)"
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
node "$SCRIPT_DIR/materialize_npm_bins.js" "$LARK_RES"

info "Step 0f/8 · Prune macOS-incompatible bundled files…"
find "$PYTHON_RES" -maxdepth 1 -name '*windows*' -delete 2>/dev/null || true
find "$PYTHON_RES" -maxdepth 1 -name '*pc-windows*' -delete 2>/dev/null || true
find "$BIN_DIR" -maxdepth 1 -name '*.exe' -delete 2>/dev/null || true
rm -rf "$RES_DIR/desktop-pet" "$RES_DIR/pip-wheels-win" 2>/dev/null || true
ok "pruned win python / win bin / win-only bundles (kept node/python archives for rebuild cache)"

bash "$SCRIPT_DIR/validate_packaging_assets.sh" "$ROOT_DIR" mac-resources
ok "brand-logo.png + icons + Python + Node ready"

# ─── STEP 1+2: Go + Rust parallel build ──────────────────────────────────────
info "Step 1/8 · Building Go directory-service [parallel]…"
info "Step 2/8 · Building Rust parser-service [parallel]…"

_go_pid=""
_rust_pid=""

GO_CMD="$(command -v go || echo '')"
if [ -z "$GO_CMD" ]; then
  warn "go not found – skipping directory-service binary. Install with: brew install go"
else
  (
    cd "$ROOT_DIR/backend_massive_concurrent"
    go mod tidy 2>/dev/null
    case "$ARCH" in
      arm64)
        GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" \
          -o "$BIN_DIR/directory-service" ./cmd/server
        ;;
      x64)
        GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" \
          -o "$BIN_DIR/directory-service" ./cmd/server
        ;;
      universal|*)
        GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" \
          -o "$BIN_DIR/directory-service-arm64" ./cmd/server
        GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" \
          -o "$BIN_DIR/directory-service-x64" ./cmd/server
        lipo -create -output "$BIN_DIR/directory-service" \
          "$BIN_DIR/directory-service-arm64" "$BIN_DIR/directory-service-x64"
        rm -f "$BIN_DIR/directory-service-arm64" "$BIN_DIR/directory-service-x64"
        ;;
    esac
    chmod +x "$BIN_DIR/directory-service"
  ) &
  _go_pid=$!
fi

export CARGO_TARGET_DIR="$ROOT_DIR/backend_safety/target"
CARGO_CMD="$(command -v cargo || echo '')"
if [ -z "$CARGO_CMD" ]; then
  warn "cargo not found – skipping parser-service binary. Install with: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
else
  (
    cd "$ROOT_DIR/backend_safety"
    case "$ARCH" in
      arm64)
        rustup target add aarch64-apple-darwin 2>/dev/null || true
        cargo build --release --target aarch64-apple-darwin
        cp "$CARGO_TARGET_DIR/aarch64-apple-darwin/release/parser-service" "$BIN_DIR/parser-service"
        ;;
      x64)
        rustup target add x86_64-apple-darwin 2>/dev/null || true
        cargo build --release --target x86_64-apple-darwin
        cp "$CARGO_TARGET_DIR/x86_64-apple-darwin/release/parser-service" "$BIN_DIR/parser-service"
        ;;
      universal|*)
        rustup target add aarch64-apple-darwin x86_64-apple-darwin 2>/dev/null || true
        cargo build --release --target aarch64-apple-darwin
        cargo build --release --target x86_64-apple-darwin
        ARM_BIN="$CARGO_TARGET_DIR/aarch64-apple-darwin/release/parser-service"
        X64_BIN="$CARGO_TARGET_DIR/x86_64-apple-darwin/release/parser-service"
        [ -f "$ARM_BIN" ] || { echo "[build] ✗ Missing $ARM_BIN — Rust arm64 build failed" >&2; exit 1; }
        [ -f "$X64_BIN" ] || { echo "[build] ✗ Missing $X64_BIN — Rust x86_64 build failed" >&2; exit 1; }
        lipo -create -output "$BIN_DIR/parser-service" "$ARM_BIN" "$X64_BIN"
        ;;
    esac
    chmod +x "$BIN_DIR/parser-service"
  ) &
  _rust_pid=$!
fi

# Wait for Go + Rust to finish
if [ -n "$_go_pid" ]; then
  if wait "$_go_pid"; then
    ok "directory-service → $BIN_DIR/directory-service"
  else
    warn "Go build failed — directory-service unavailable"
  fi
fi
if [ -n "$_rust_pid" ]; then
  if wait "$_rust_pid"; then
    ok "parser-service → $BIN_DIR/parser-service"
  else
    warn "Rust build failed — parser service will be unavailable in package"
  fi
fi

# ─── STEP 3: Build Next.js standalone ────────────────────────────────────────
info "Step 3/8 · Building Next.js (standalone output)…"
bash "$SCRIPT_DIR/build_next_standalone.sh"
ok "Next.js build complete"

# Copy standalone to resources
WEB_RES="$RES_DIR/web-standalone"
rm -rf "$WEB_RES"
cp -r "$WEB_DIR/.next/standalone" "$WEB_RES"
cp -r "$WEB_DIR/public" "$WEB_RES/public" 2>/dev/null || true
mkdir -p "$WEB_RES/public"
cp -f "$WEB_DIR/public/brand-logo.png" "$WEB_RES/public/brand-logo.png"
bash "$SCRIPT_DIR/validate_packaging_assets.sh" "$ROOT_DIR" mac-resources
mkdir -p "$WEB_RES/.next"
cp -r "$WEB_DIR/.next/static" "$WEB_RES/.next/static"
ok "Next.js standalone → $WEB_RES"

# ─── STEP 3b: Ensure stock API keys in backend/.env (optional env injection) ───
if [ -x "$SCRIPT_DIR/ensure_stock_env_keys.sh" ]; then
  bash "$SCRIPT_DIR/ensure_stock_env_keys.sh" || true
fi

# ─── STEP 4: Copy Python backend source ──────────────────────────────────────
info "Step 4/8 · Copying Python backend source…"
BACKEND_RES="$RES_DIR/backend"
rm -rf "$BACKEND_RES"
mkdir -p "$BACKEND_RES"

# Copy key directories (exclude heavy virtual envs, caches, outputs)
for d in agents core tools utils routers services admin; do
  [ -d "$ROOT_DIR/backend/$d" ] && cp -r "$ROOT_DIR/backend/$d" "$BACKEND_RES/"
done
# Key files
for f in main.py requirements.txt .env.example; do
  [ -f "$ROOT_DIR/backend/$f" ] && cp "$ROOT_DIR/backend/$f" "$BACKEND_RES/"
done
# 构建机 backend/.env → 只读 defaults（合并进 APP_DATA/backend/.env，不覆盖用户已有 Key）
if [ -f "$ROOT_DIR/backend/.env" ]; then
  cp "$ROOT_DIR/backend/.env" "$BACKEND_RES/.env.bundled"
  ok "Bundled env defaults → $BACKEND_RES/.env.bundled"
fi
# Generated protobuf stubs
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
node "$SCRIPT_DIR/generate_skills_enabled.js" "$SKILLS_RES" > "$DEFAULTS_RES/skills_enabled.json"
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
if bash "$SCRIPT_DIR/bundle_mcp_node.sh" "$ROOT_DIR"; then
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

# ─── STEP 5: Copy OCR service source ─────────────────────────────────────────
info "Step 5/8 · Copying OCR service source…"
OCR_RES="$RES_DIR/ocr-service"
rm -rf "$OCR_RES"
mkdir -p "$OCR_RES"
cp -r "$ROOT_DIR/services/ocr/." "$OCR_RES/"
ok "OCR service → $OCR_RES"

# ─── STEP 5b: Bundle desktop-pet (Tauri sidecar) for macOS ───────────────────
info "Step 5b/8 · Bundling desktop-pet for macOS…"
if bash "$SCRIPT_DIR/bundle_desktop_pet_mac.sh" "$ARCH"; then
  ok "desktop-pet → $RES_DIR/desktop-pet/AI Media Agent Pet.app"
else
  warn "desktop-pet bundle failed — 陪伴室「启动桌宠」可能不可用"
fi

is_valid_notarize_creds() {
  [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] \
    && [ "$APPLE_ID" != "your@email.com" ] \
    && [ "$APPLE_APP_SPECIFIC_PASSWORD" != "xxxx-xxxx-xxxx-xxxx" ]
}

# ─── STEP 6: Installer app (icons already generated in step 0) ───────────────
info "Step 6/8 · Building installer app…"
cp -f "$ROOT_DIR/web/public/brand-logo.png" "$WEB_RES/public/brand-logo.png"
bash "$SCRIPT_DIR/validate_packaging_assets.sh" "$ROOT_DIR" mac-resources
if [ "$UNSIGNED" = "unsigned" ]; then
  SIGN_IDENTITY=- bash "$ELECTRON_DIR/scripts/make_install_app.sh"
else
  DEV_ID="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1 || true)"
  SIGN_IDENTITY="${DEV_ID:--}" bash "$ELECTRON_DIR/scripts/make_install_app.sh"
fi
chmod +x "$RES_DIR/Install AI Media Agent.command" 2>/dev/null || true
chmod +x "$RES_DIR/如遇无法打开请双击此文件.command" 2>/dev/null || true
chmod +x "$RES_DIR/dmg-install.sh" 2>/dev/null || true
ok "Icons → $ICONS_DIR"

# ─── STEP 7: Build Electron DMG ───────────────────────────────────────────────
info "Step 7/8 · Building Electron DMG…"

if [ "$UNSIGNED" = "unsigned" ]; then
  export MAC_BUILD_UNSIGNED=1
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  warn "Unsigned 构建 — 其他 Mac 极易出现「已损坏」，请改用终端 dmg-install.sh"
else
  unset MAC_BUILD_UNSIGNED
  if is_valid_notarize_creds; then
    ok "将使用 Developer ID 签名 + Apple 公证 (APPLE_ID=${APPLE_ID})"
  else
    warn "mac-build.env 未配置公证凭据 — 将仅 Developer ID 签名（不公证）"
    warn "其他 Mac 首次需 Control+点击 → 打开；配置 mac-build.env 后可双击即开"
  fi
fi

cd "$ELECTRON_DIR"
if [ ! -d node_modules ]; then
  info "  Installing Electron deps…"
  npm install --silent
fi

# electron-builder 检测到 APPLE_ID 环境变量会自动公证；无效凭据会导致构建失败
if [ "$UNSIGNED" != "unsigned" ] && ! is_valid_notarize_creds; then
  unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_ID_PASSWORD
fi

case "$ARCH" in
  arm64)
    if [ "$UNSIGNED" = "unsigned" ]; then npm run build:unsigned:arm64
    else npm run build:arm64; fi ;;
  x64)
    if [ "$UNSIGNED" = "unsigned" ]; then npm run build:unsigned:x64
    else npm run build:x64; fi ;;
  universal|*)
    if [ "$UNSIGNED" = "unsigned" ]; then npm run build:unsigned:universal
    else npm run build:universal; fi ;;
esac

# ─── STEP 8: Validate bundled .app + verify DMG ─────────────────────────────
info "Step 8/8 · Validating packaged .app assets…"
APP_BUNDLE=""
for mac_dir in "$ELECTRON_DIR/dist/mac-arm64" "$ELECTRON_DIR/dist/mac" "$ELECTRON_DIR/dist/mac-universal"; do
  APP_BUNDLE="$(find "$mac_dir" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)"
  [ -n "$APP_BUNDLE" ] && break
done
if [ -n "$APP_BUNDLE" ]; then
  bash "$SCRIPT_DIR/validate_packaging_assets.sh" "$ROOT_DIR" app-bundle "$APP_BUNDLE"
  ok "Bundled app assets verified"
else
  warn "No .app found under dist/mac-* — skip app-bundle validation"
fi

MAC_DMG="$(find "$ELECTRON_DIR/dist" -maxdepth 1 -name '*.dmg' -type f 2>/dev/null | head -1 || true)"
if [ -n "$MAC_DMG" ]; then
  if [ -n "$APP_BUNDLE" ]; then
    bash "$SCRIPT_DIR/verify_mac_dmg.sh" "$ROOT_DIR" --app "$APP_BUNDLE"
  else
    bash "$SCRIPT_DIR/verify_mac_dmg.sh" "$ROOT_DIR" "$MAC_DMG"
  fi
  ok "dmg verification passed: $(basename "$MAC_DMG")"
else
  warn "no *.dmg found in dist/ — skip dmg verification"
fi

echo ""
ok "════════════════════════════════════════════"
ok " Build complete!"
ok " Output: electron/dist/"
ls -lh "$ELECTRON_DIR/dist/"*.dmg 2>/dev/null || true
ok "════════════════════════════════════════════"
echo ""

cat <<'NOTE'
═══════════════════════════════════════════════════════
  分发给 M 系列 Mac 用户（unsigned 默认）:

  1) 双击 DMG 内「Install AI Media Agent.app」（Control+点击→打开）
  2) 或终端执行:
     bash "$(ls -d /Volumes/AI\ Media\ Agent* | tail -1)/dmg-install.sh"

  需要 Developer ID 签名: ./build_mac.sh arm64 signed
  需要 universal 通用包:  ./build_mac.sh universal signed

  若包内含有 venv-prebuilt，Python 依赖为复制预构建环境（秒级），否则离线 pip wheel（数分钟）。
  强制重建 venv: FORCE_VENV_PREBUILT=1 ./build_mac.sh
═══════════════════════════════════════════════════════
NOTE
