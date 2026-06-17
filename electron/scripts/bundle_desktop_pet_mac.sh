#!/usr/bin/env bash
# Build desktop-pet for macOS and copy into electron/resources/desktop-pet/
# for bundling with AI Media Agent via electron-builder extraResources.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PET_DIR="$ROOT/desktop-pet"
TAURI_DIR="$PET_DIR/src-tauri"
DEST="$ROOT/electron/resources/desktop-pet"
ARCH="${1:-arm64}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$TAURI_DIR/target}"

info() { printf '[bundle-pet] %s\n' "$*"; }

case "$ARCH" in
  arm64)  TAURI_TARGET="aarch64-apple-darwin" ;;
  x64)    TAURI_TARGET="x86_64-apple-darwin" ;;
  universal) TAURI_TARGET="universal-apple-darwin" ;;
  *)      TAURI_TARGET="aarch64-apple-darwin" ;;
esac

APP_BUNDLE_NAME="AI Media Agent Pet.app"
APP_BUNDLE="$CARGO_TARGET_DIR/release/bundle/macos/$APP_BUNDLE_NAME"

if [ "${FORCE_DESKTOP_PET_REBUILD:-}" != "1" ] && [ -d "$DEST/$APP_BUNDLE_NAME" ]; then
  info "reuse bundled desktop-pet (set FORCE_DESKTOP_PET_REBUILD=1 to rebuild)"
  exit 0
fi

command -v cargo >/dev/null 2>&1 || {
  echo "[bundle-pet] 缺少 Rust/cargo，无法构建 macOS 桌宠"
  exit 1
}

rustup target add "$TAURI_TARGET" >/dev/null 2>&1 || true

export VITE_BACKEND_URL="${VITE_BACKEND_URL:-http://127.0.0.1:8000}"
export VITE_CONSOLE_URL="${VITE_CONSOLE_URL:-http://127.0.0.1:3000/companion}"

info "Building desktop-pet ($TAURI_TARGET)…"
cd "$PET_DIR"

if [ ! -d node_modules ]; then
  info "  Installing desktop-pet deps…"
  npm install --silent
fi

npm run tauri:build -- --target "$TAURI_TARGET"

[ -d "$APP_BUNDLE" ] || { echo "[bundle-pet] 未找到产物: $APP_BUNDLE"; exit 1; }

mkdir -p "$DEST"
rm -rf "$DEST/$APP_BUNDLE_NAME"
cp -a "$APP_BUNDLE" "$DEST/$APP_BUNDLE_NAME"

cat > "$DEST/使用说明.txt" <<'EOF'
AI Media Agent 桌宠 (macOS，已随安装包附带)

1. 先启动 AI Media Agent 主应用
2. 在陪伴室 /companion 点击「启动桌宠」，或从系统托盘选择「启动桌宠 (Boni)」
3. 托盘 / 快捷键可唤醒或关闭
EOF

info "Bundled → $DEST/$APP_BUNDLE_NAME"
