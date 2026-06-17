#!/bin/bash
# Runs from Install AI Media Agent.app/Contents/Resources/install.sh
set -euo pipefail

TARGET_APP="AI Media Agent.app"
APP_DST="/Applications/$TARGET_APP"

# Install.app 在 DMG 根目录，与 AI Media Agent.app 同级
INSTALL_APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DMG_ROOT="$(dirname "$INSTALL_APP_ROOT")"
APP_SRC="$DMG_ROOT/$TARGET_APP"

alert() {
  osascript -e "display alert \"$1\" message \"$2\" as informational" 2>/dev/null || echo "$1: $2"
}

# 若 DMG 内找不到，尝试 walk-up；再尝试已安装副本
if [ ! -d "$APP_SRC" ]; then
  dir="$INSTALL_APP_ROOT"
  while [ "$dir" != "/" ]; do
    if [ -d "$dir/$TARGET_APP" ]; then
      APP_SRC="$dir/$TARGET_APP"
      DMG_ROOT="$dir"
      break
    fi
    dir="$(dirname "$dir")"
  done
fi

if [ ! -d "$APP_SRC" ] && [ -d "$APP_DST" ]; then
  APP_SRC="$APP_DST"
fi

if [ ! -d "$APP_SRC" ]; then
  # 尝试 DMG 根目录的 dmg-install.sh
  if [ -f "$DMG_ROOT/dmg-install.sh" ]; then
    exec bash "$DMG_ROOT/dmg-install.sh"
  fi
  alert "找不到应用" "未找到 $TARGET_APP。\n\n请打开「终端」执行:\nbash \"$DMG_ROOT/dmg-install.sh\""
  exit 1
fi

TMP_SCRIPT="$(mktemp /tmp/ama-install.XXXXXX.sh)"
chmod 700 "$TMP_SCRIPT"
cat > "$TMP_SCRIPT" <<EOF
#!/bin/bash
set -e
APP_SRC='$APP_SRC'
APP_DST='$APP_DST'
xattr -cr "\$APP_SRC" 2>/dev/null || true
xattr -cr "$INSTALL_APP_ROOT" 2>/dev/null || true
if [ -d "\$APP_SRC" ] && [ "\$APP_SRC" != "\$APP_DST" ]; then
  rm -rf "\$APP_DST"
  ditto "\$APP_SRC" "\$APP_DST"
fi
xattr -cr "\$APP_DST" 2>/dev/null || true
xattr -dr com.apple.quarantine "\$APP_DST" 2>/dev/null || true
chmod -R u+rwX,go+rX "\$APP_DST" 2>/dev/null || true
test -d "\$APP_DST/Contents/MacOS"
EOF

B64="$(base64 < "$TMP_SCRIPT" | tr -d '\n')"
rm -f "$TMP_SCRIPT"

ADMIN_OK=0
if osascript -e "do shell script \"echo '$B64' | base64 -D | bash\" with administrator privileges" 2>/dev/null; then
  ADMIN_OK=1
else
  alert "自动安装失败" "将尝试无需管理员权限安装…"
  if [ -d "$APP_SRC" ] && [ "$APP_SRC" != "$APP_DST" ]; then
    rm -rf "$APP_DST" 2>/dev/null || true
    ditto "$APP_SRC" "$APP_DST" 2>/dev/null || true
  fi
  xattr -cr "$APP_DST" 2>/dev/null || true
fi

if [ ! -d "$APP_DST/Contents/MacOS" ]; then
  if [ -f "$DMG_ROOT/dmg-install.sh" ]; then
    exec bash "$DMG_ROOT/dmg-install.sh"
  fi
  alert "安装失败" "复制到「应用程序」失败。\n\n请打开「终端」执行:\nbash \"$DMG_ROOT/dmg-install.sh\""
  exit 1
fi

if open "$APP_DST" 2>/dev/null; then
  alert "安装完成" "AI Media Agent 已安装并启动。\n\n请查看 Dock 或安装向导窗口。"
else
  alert "请手动打开" "已安装到「应用程序」。\n\nControl+点击 AI Media Agent → 打开 → 打开（仅首次）。"
fi
