#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$ROOT/ios/App/App/Info.plist"

if [[ ! -f "$PLIST" ]]; then
  echo "跳过 ATS 修补: 未找到 $PLIST（请先 npx cap add ios）"
  exit 0
fi

/usr/libexec/PlistBuddy -c "Print :NSAppTransportSecurity" "$PLIST" >/dev/null 2>&1 || \
  /usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity dict" "$PLIST"

/usr/libexec/PlistBuddy -c "Print :NSAppTransportSecurity:NSAllowsLocalNetworking" "$PLIST" >/dev/null 2>&1 || \
  /usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$PLIST"

/usr/libexec/PlistBuddy -c "Set :NSAppTransportSecurity:NSAllowsLocalNetworking true" "$PLIST" 2>/dev/null || true

/usr/libexec/PlistBuddy -c "Print :NSAppTransportSecurity:NSAllowsArbitraryLoadsInWebContent" "$PLIST" >/dev/null 2>&1 || \
  /usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoadsInWebContent bool true" "$PLIST"

/usr/libexec/PlistBuddy -c "Set :NSAppTransportSecurity:NSAllowsArbitraryLoadsInWebContent true" "$PLIST" 2>/dev/null || true

echo "已更新 Info.plist ATS 规则"
