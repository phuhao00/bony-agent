#!/usr/bin/env bash
# Build desktop-pet for Windows and copy into electron/resources/desktop-pet/
# for bundling with AI Media Agent (数字员工) via electron-builder extraResources.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PET_DIR="$ROOT/desktop-pet"
TAURI_DIR="$PET_DIR/src-tauri"
DEST="$ROOT/electron/resources/desktop-pet"
TARGET="${DESKTOP_PET_WIN_TARGET:-x86_64-pc-windows-gnu}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$TAURI_DIR/target}"

info() { printf '[bundle-pet] %s\n' "$*"; }

if [ "${FORCE_DESKTOP_PET_REBUILD:-}" != "1" ] && [ -f "$DEST/ai-media-agent-desktop-pet.exe" ] && [ -f "$DEST/WebView2Loader.dll" ]; then
  info "reuse bundled desktop-pet (set FORCE_DESKTOP_PET_REBUILD=1 to rebuild)"
  exit 0
fi

command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1 || {
  echo "[bundle-pet] 缺少 mingw 交叉编译器。macOS: brew install mingw-w64"
  echo "[bundle-pet] 或在 Windows 上先运行: powershell -File scripts/build_desktop_pet_win.ps1"
  echo "[bundle-pet] 再将 ai-media-agent-desktop-pet.exe 复制到 electron/resources/desktop-pet/"
  exit 1
}

rustup target add "$TARGET" >/dev/null 2>&1 || true

export VITE_BACKEND_URL="${VITE_BACKEND_URL:-http://127.0.0.1:8000}"
export VITE_CONSOLE_URL="${VITE_CONSOLE_URL:-http://127.0.0.1:3000/companion}"

info "Building desktop-pet ($TARGET)…"
cd "$PET_DIR"
npm install --silent
npm run tauri:build:win:gnu

EXE="$CARGO_TARGET_DIR/$TARGET/release/ai-media-agent-desktop-pet.exe"
WV2_DLL="$CARGO_TARGET_DIR/$TARGET/release/WebView2Loader.dll"
[ -f "$EXE" ] || { echo "[bundle-pet] 未找到产物: $EXE"; exit 1; }
[ -f "$WV2_DLL" ] || { echo "[bundle-pet] 未找到 WebView2Loader.dll: $WV2_DLL"; exit 1; }

mkdir -p "$DEST"
cp -f "$EXE" "$DEST/ai-media-agent-desktop-pet.exe"
cp -f "$WV2_DLL" "$DEST/WebView2Loader.dll"
cat > "$DEST/使用说明.txt" <<'EOF'
AI Media Agent 桌宠 (Windows，已随数字员工安装包附带)

1. 先启动 AI Media Agent 主应用（系统托盘 → 启动桌宠 / 陪伴室）
2. 或在主应用菜单选择「启动桌宠 (Boni)」
3. 托盘 Alt+Shift+B 唤醒 · 右键菜单可关闭或退出
4. 需要 WebView2 运行时（Win10/11 通常已自带）
EOF

info "Bundled → $DEST/ (exe + WebView2Loader.dll)"
