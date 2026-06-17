#!/bin/bash
# 放在 DMG 根目录 — 在终端执行: bash "/Volumes/AI Media Agent x.x.x/dmg-install.sh"
set -euo pipefail

TARGET_APP="AI Media Agent.app"
APP_DST="/Applications/$TARGET_APP"
DMG_ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$DMG_ROOT/$TARGET_APP"

alert() {
  osascript -e "display alert \"$1\" message \"$2\" as informational" 2>/dev/null || echo "$1: $2"
}

if [ ! -d "$APP_SRC" ]; then
  alert "找不到应用" "未在 DMG 中找到 $TARGET_APP。\n\n当前目录: $DMG_ROOT\n\n请确认从 .dmg 内运行此脚本。"
  exit 1
fi

alert "开始安装" "将把 AI Media Agent 安装到「应用程序」并解除 macOS 安全限制。\n\n请在下一步输入 Mac 登录密码。"

# base64 避免路径含空格时 osascript 转义失败
TMP_SCRIPT="$(mktemp /tmp/ama-dmg-install.XXXXXX.sh)"
chmod 700 "$TMP_SCRIPT"
cat > "$TMP_SCRIPT" <<EOF
#!/bin/bash
set -e
APP_SRC='$APP_SRC'
APP_DST='$APP_DST'
DMG_ROOT='$DMG_ROOT'
xattr -cr "\$APP_SRC" 2>/dev/null || true
xattr -cr "\$DMG_ROOT/Install AI Media Agent.app" 2>/dev/null || true
rm -rf "\$APP_DST"
ditto "\$APP_SRC" "\$APP_DST"
xattr -cr "\$APP_DST" 2>/dev/null || true
xattr -dr com.apple.quarantine "\$APP_DST" 2>/dev/null || true
chmod -R u+rwX,go+rX "\$APP_DST" 2>/dev/null || true
test -d "\$APP_DST/Contents/MacOS"
EOF

B64="$(base64 < "$TMP_SCRIPT" | tr -d '\n')"
rm -f "$TMP_SCRIPT"

if ! osascript -e "do shell script \"echo '$B64' | base64 -D | bash\" with administrator privileges" 2>/dev/null; then
  alert "需要管理员权限" "安装取消或失败。\n\n请打开「终端」，粘贴以下命令后回车:\n\nbash '$DMG_ROOT/dmg-install.sh'"
  exit 1
fi

if open "$APP_DST" 2>/dev/null; then
  alert "安装完成" "AI Media Agent 已安装并启动。\n\n请查看 Dock 或安装向导窗口。"
else
  alert "请手动打开" "已安装到「应用程序」。\n\n请打开「应用程序」→ AI Media Agent → Control+点击 → 打开 → 打开（仅首次）。"
fi
