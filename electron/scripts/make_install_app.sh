#!/bin/bash
# Build "Install AI Media Agent.app" with a real Mach-O launcher (not a shell script).
set -euo pipefail

ELECTRON_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RES_DIR="$ELECTRON_DIR/resources"
APP_NAME="Install AI Media Agent.app"
APP_PATH="$RES_DIR/$APP_NAME"
INSTALL_SH="$ELECTRON_DIR/scripts/install-mac.sh"
STUB_SRC="$ELECTRON_DIR/scripts/install-stub.c"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"

rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources"

cp "$INSTALL_SH" "$APP_PATH/Contents/Resources/install.sh"
chmod +x "$APP_PATH/Contents/Resources/install.sh"

if ! clang -Wall -O2 -o "$APP_PATH/Contents/MacOS/install" "$STUB_SRC" 2>/dev/null; then
  echo "  clang failed — falling back to copying bash (may fail on other Macs)" >&2
  cp "$INSTALL_SH" "$APP_PATH/Contents/MacOS/install"
  chmod +x "$APP_PATH/Contents/MacOS/install"
fi

if [ -f "$RES_DIR/icons/icon.icns" ]; then
  cp "$RES_DIR/icons/icon.icns" "$APP_PATH/Contents/Resources/AppIcon.icns"
fi

cat > "$APP_PATH/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>install</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.conflux.farm.installer</string>
  <key>CFBundleName</key>
  <string>Install AI Media Agent</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>LSUIElement</key>
  <false/>
</dict>
</plist>
PLIST

# Sign Mach-O launcher + bundle (never --deep).
if [ "$SIGN_IDENTITY" = "-" ]; then
  codesign --force --sign - "$APP_PATH/Contents/MacOS/install" 2>/dev/null || true
  codesign --force --sign - "$APP_PATH" 2>/dev/null || true
elif [ -n "$SIGN_IDENTITY" ] && [ "$SIGN_IDENTITY" != "none" ]; then
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP_PATH/Contents/MacOS/install"
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP_PATH"
fi

file "$APP_PATH/Contents/MacOS/install"
echo "  created $APP_PATH"
