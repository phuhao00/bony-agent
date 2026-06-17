# AI Media Agent — iOS 客户端

与 Windows 桌面版类似，这是一个**独立 App 壳**：全屏 WebView 打开控制台 UI，不依赖 Safari。

## 与 Windows 桌面版的差异（必读）

| | Windows 桌面版 | iOS 客户端 |
|---|----------------|------------|
| 本地 Python/Node | ✅ 内置 | ❌ iOS 无法运行 |
| Playwright 浏览器自动化 | ✅ | ❌ |
| 独立窗口 / 非浏览器 | ✅ Electron | ✅ Capacitor WKWebView |
| 典型用法 | 单机完整功能 | 连接**已启动**的桌面版或云端部署 |

iPhone 上无法把 FastAPI + Next.js + Playwright 整套打进 App Store 包。iOS 客户端的定位是：**移动端的原生外壳**，通过 Wi‑Fi 或公网访问你的 AI Media Agent 控制台（`http://<host>:3000`）。

## 前置条件

- macOS + **Xcode**（App Store 安装）
- **Apple Developer** 账号（真机 / TestFlight / App Store）
- Node.js 18+

## 构建

```bash
cd mobile
chmod +x build_ios.sh scripts/patch-ios-plist.sh
./build_ios.sh
npm run open:ios
```

在 Xcode 中：

1. 选择 **Signing & Capabilities** → Team
2. 连接 iPhone 或选择模拟器（模拟器访问 Mac 本机请用 Mac 局域网 IP，不要用 `127.0.0.1`）
3. **Run** 调试，或 **Product → Archive** 导出 `.ipa`

## 使用流程

1. 在 Mac/Windows 上启动 **AI Media Agent 桌面版**，确保前端 `:3000` 已运行
2. 查 Mac 局域网 IP（系统设置 → 网络），例如 `192.168.1.10`
3. 打开 iOS App，首次输入：`http://192.168.1.10:3000`
4. 连接成功后进入全屏控制台（与 Windows 内嵌窗口相同的 Web UI）

## 目录结构

```
mobile/
  index.html          # Vite 入口
  src/main.js         # 连接配置 + 跳转逻辑
  capacitor.config.ts
  build_ios.sh
  ios/                # cap add ios 后生成
```

## 可选：云端部署

若控制台部署在 HTTPS 域名（如 `https://agent.example.com`），在 App 内直接填该地址即可，无需局域网。

架构与移动端关系见 [`docs/CANVAS_OVERVIEW.md`](../docs/CANVAS_OVERVIEW.md) §4.1 / §5（iOS Shell 与 Electron 对比）。

## 后续增强（未实现）

- 桌面版显示「局域网连接二维码」供手机扫码
- Mac 桌面版也改为内嵌窗口（与 Windows 一致，改 `electron/main.js` 即可）
- 推送通知、生物识别锁定
