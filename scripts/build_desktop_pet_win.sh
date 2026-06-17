#!/usr/bin/env bash
# Build desktop-pet Windows executable (cross-compile from macOS/Linux with mingw).
# On native Windows: npm run tauri:build (MSVC + NSIS installer).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PET_DIR="$ROOT/desktop-pet"
TAURI_DIR="$PET_DIR/src-tauri"
OUT_DIR="$ROOT/storage/outputs/desktop-pet-win"
TARGET="${DESKTOP_PET_WIN_TARGET:-x86_64-pc-windows-gnu}"
ZIP_NAME="AI-Media-Agent-Pet-win-${TARGET}.zip"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$TAURI_DIR/target}"

command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1 || {
  echo "缺少 mingw 交叉编译器。macOS: brew install mingw-w64"
  echo "或在 Windows 上运行: powershell -File scripts/build_desktop_pet_win.ps1"
  exit 1
}

rustup target add "$TARGET" >/dev/null 2>&1 || true

cd "$PET_DIR"
npm install
npm run tauri:build:win:gnu

EXE="$CARGO_TARGET_DIR/$TARGET/release/ai-media-agent-desktop-pet.exe"
WV2_DLL="$CARGO_TARGET_DIR/$TARGET/release/WebView2Loader.dll"
if [[ ! -f "$EXE" ]]; then
  echo "未找到产物: $EXE"
  exit 1
fi
if [[ ! -f "$WV2_DLL" ]]; then
  echo "未找到 WebView2Loader.dll: $WV2_DLL"
  exit 1
fi

mkdir -p "$OUT_DIR/staging"
cp "$EXE" "$OUT_DIR/staging/"
cp "$WV2_DLL" "$OUT_DIR/staging/"
cp "$PET_DIR/README.md" "$OUT_DIR/staging/" 2>/dev/null || true
cat > "$OUT_DIR/staging/使用说明.txt" <<'EOF'
AI Media Agent 桌宠 (Windows)

1. 先启动 AI Media Agent 主应用（后端 http://127.0.0.1:8000）
2. 双击 ai-media-agent-desktop-pet.exe 运行桌宠
3. 托盘图标 / Alt+Shift+B 唤醒 · 右键菜单可关闭或退出
4. 需要 WebView2 运行时（Win10/11 通常已自带）

EOF

STAGE="$OUT_DIR/staging"
ZIP_PATH="$OUT_DIR/$ZIP_NAME"
rm -f "$ZIP_PATH"
(
  cd "$STAGE"
  zip -r -X "$ZIP_PATH" .
)

echo ""
echo "Windows 桌宠包已生成:"
echo "  可执行文件: $EXE"
echo "  分发 zip:   $ZIP_PATH"
echo "  大小:       $(du -h "$ZIP_PATH" | awk '{print $1}')"
