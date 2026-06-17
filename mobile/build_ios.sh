#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "错误: 未检测到 Xcode，请从 App Store 安装 Xcode 后重试。"
  exit 1
fi

echo "==> 安装依赖"
npm install

echo "==> 构建 Web 壳"
npm run build

if [[ ! -d ios/App ]]; then
  echo "==> 初始化 iOS 工程 (Capacitor)"
  npx cap add ios
fi

echo "==> 同步 Capacitor 资源"
npx cap sync ios

echo "==> 修补 iOS ATS（允许局域网 HTTP）"
bash ./scripts/patch-ios-plist.sh

echo ""
echo "完成。下一步："
echo "  1. npm run open:ios   # 在 Xcode 中打开"
echo "  2. 选择 Team / Signing，连接 iPhone 或选模拟器"
echo "  3. Product → Archive → Distribute App（TestFlight 或 Ad Hoc）"
echo ""
echo "说明: iOS 客户端为全屏 WebView，需连接已运行的桌面版或云端控制台（:3000）。"
