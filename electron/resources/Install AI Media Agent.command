#!/bin/bash
# 一键安装 AI Media Agent（推荐使用 DMG 内的 Install AI Media Agent.app）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALLER_APP="$SCRIPT_DIR/Install AI Media Agent.app"

if [ -d "$INSTALLER_APP" ]; then
  open "$INSTALLER_APP"
  exit 0
fi

# Fallback when only .command is present (e.g. old DMG layout)
APP_NAME="AI Media Agent.app"
APP_DST="/Applications/$APP_NAME"
if [ -d "$SCRIPT_DIR/../$APP_NAME" ]; then
  APP_SRC="$(cd "$SCRIPT_DIR/.." && pwd)/$APP_NAME"
else
  APP_SRC="$SCRIPT_DIR/$APP_NAME"
fi

if [ ! -d "$APP_SRC" ] && [ ! -d "$APP_DST" ]; then
  osascript -e "display alert \"未找到应用\" message \"请从 DMG 中运行 Install AI Media Agent.app。\""
  exit 1
fi

TMP_SCRIPT="$(mktemp /tmp/ama-install.XXXXXX.sh)"
chmod 700 "$TMP_SCRIPT"
cat > "$TMP_SCRIPT" <<EOF
#!/bin/bash
set -e
APP_SRC="$APP_SRC"
APP_DST="$APP_DST"
if [ -d "\$APP_SRC" ] && [ "\$APP_SRC" != "\$APP_DST" ]; then
  rm -rf "\$APP_DST"
  ditto "\$APP_SRC" "\$APP_DST"
fi
xattr -cr "\$APP_DST" 2>/dev/null || true
EOF

osascript -e "do shell script \"bash '$TMP_SCRIPT'\" with administrator privileges" 2>/dev/null || {
  rm -f "$TMP_SCRIPT"
  if [ -d "$APP_SRC" ] && [ "$APP_SRC" != "$APP_DST" ]; then ditto "$APP_SRC" "$APP_DST"; fi
  xattr -cr "$APP_DST" 2>/dev/null || true
}
rm -f "$TMP_SCRIPT"
open "$APP_DST"
