# AI Media Agent — Desktop Pet (Tauri Sidecar)

轻量桌宠客户端，连接本机 FastAPI `http://127.0.0.1:8000`（需先启动 AI Media Agent 主应用或 `./start_local.sh`）。

## 开发

```bash
cd desktop-pet
npm install
npm run tauri:dev
```

环境变量（可选）：

- `VITE_BACKEND_URL` — 默认 `http://127.0.0.1:8000`
- `VITE_CONSOLE_URL` — 默认 `http://127.0.0.1:3000/companion`

## 构建

```bash
# macOS 本地包
npm run tauri:build

# Windows — 在 Windows 本机（推荐，含 NSIS 安装器）
powershell -ExecutionPolicy Bypass -File ../scripts/build_desktop_pet_win.ps1

# Windows — 在 macOS 交叉编译便携版（需 brew install mingw-w64）
../scripts/build_desktop_pet_win.sh
```

产物：

- macOS：`src-tauri/target/release/bundle/macos/`
- Windows 安装器：`storage/outputs/desktop-pet-win/*.exe`（NSIS）
- Windows 便携 zip：`storage/outputs/desktop-pet-win/AI-Media-Agent-Pet-win-*.zip`

## 平台差异

| 能力 | macOS | Windows |
|------|-------|---------|
| 透明置顶窗 | `tauri.macos.conf.json` + 私有 API | `tauri.windows.conf.json` + WebView2 |
| 后端连接 | Rust 代理（绕过 WebView 限制） | 同上 |
| 全局唤醒 | `⌘⇧B` | `Alt+Shift+B` |
| 托盘菜单 | 唤醒 / 显示 / 隐藏 / 退出 | 同上 |
| idle 检测 | CoreGraphics | `GetLastInputInfo` |
| 本地时间 | `localtime_r` | `GetLocalTime` |

## 功能

- 透明置顶窗口 + CSS 宠物动画（idle / thinking / talking）
- 气泡对话 → `POST /companion/pet/chat/stream`
- 伙伴状态 → `GET /companion/state`
- Rust 感知：前台 App、idle、剪贴板 hash（preview opt-in）
- 复杂任务自动切完整 Agent（MCP 工具链）
- Dream digest 早晨问候

详见 [`docs/DESKTOP_PET.md`](../docs/DESKTOP_PET.md)。

默认不随 `./start_local.sh` / `./start_with_tunnel.sh` 启动；在陪伴室 `/companion` 点「启动桌宠」，或设 `START_DESKTOP_PET=1` 随脚本自动拉起。
