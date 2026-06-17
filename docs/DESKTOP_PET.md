# Desktop Pet（Tauri Sidecar）

AI Media Agent 的轻量桌宠 Sidecar：透明置顶小窗 + 气泡对话，通过 HTTP 连接本机 FastAPI（`:8000`），复用 companion 状态、记忆、MCP、LangGraph 与 Dream 养成。

## 架构

```
Electron 主应用 / start_local.sh  →  FastAPI :8000
desktop-pet (Tauri 2)             →  HTTP/SSE  →  :8000
```

桌宠 **不内置 LLM / MCP**；感知数据上报后端，由 `companion_pet_router` 统一决策。

## 前置条件

1. 启动 backend（任选其一）：
   - 打开 AI Media Agent Electron 桌面包
   - 或项目根目录：`./start_local.sh`
2. 确认健康检查：`curl http://127.0.0.1:8000/health`
3. （可选）安装 [Ollama](https://ollama.com) 以启用本地闲聊分流

## 安装与运行

### 一键启动（推荐）

与主应用一同启动（Backend + Frontend 就绪后自动拉起桌宠）：

```bash
./start_local.sh              # 本地开发
./start_with_tunnel.sh        # 含 Cloudflare Tunnel（控制台 URL 走公网域名）
```

环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `START_DESKTOP_PET` | `0` | 设为 `1` 随 `start_local.sh` 自动拉起桌宠 |
| `DESKTOP_PET_DEV` | `1` | 设为 `0` 仅尝试打开已构建的 `.app` |
| `VITE_BACKEND_URL` | `http://127.0.0.1:8000` | 桌宠 API（始终本机） |
| `VITE_CONSOLE_URL` | `http://127.0.0.1:3000/companion` | 双击宠物打开的陪伴室 |

### 开发模式

```bash
cd desktop-pet
npm install
npm run tauri:dev
```

### 发布构建

```bash
cd desktop-pet
npm run tauri:build
```

macOS 产物：`desktop-pet/src-tauri/target/release/bundle/macos/*.app`

## 桌宠形象

在 **宠物正下方** 点击 **状态芯片**（头像 + 名字 + 等级），弹出卡片网格选择 **星星 / Kitty / 佩奇 / 熊二 / 猪猪侠**。对话模式下也可在顶栏芯片切换。

| 选项 | 说明 |
|------|------|
| **波尼星星** | 默认黄色星星精灵 |
| **Hello Kitty** | 白猫圆脸 + 红色蝴蝶结（原创 SVG 风格，非官方素材） |
| **小猪佩奇** | 3D 玩偶风：球体头鼻、渐变体积感、3/4 视角双眼、红裙与柔影（原创 SVG，非官方素材） |
| **熊二** | 熊出没风格棕熊：圆头圆耳、浅棕毛绒渐变、大肚皮与黑鼻头（原创 SVG，非官方素材） |
| **猪猪侠** | 超级英雄小猪：粉红猪脸、红色战甲头盔、金色胸章与腰带（原创 SVG，非官方素材） |

选择会保存在本机 `localStorage`（`ama_pet_character_v1`），下次启动自动恢复。首次使用会有短暂高亮提示。

## 环境变量

### 桌宠前端（Vite）

| 变量 | 默认 | 说明 |
|------|------|------|
| `VITE_BACKEND_URL` | `http://127.0.0.1:8000` | FastAPI 地址 |
| `VITE_CONSOLE_URL` | `http://127.0.0.1:3000/companion` | 双击宠物打开沉浸式陪伴室 |

### 后端（`backend/.env`）

| 变量 | 默认 | 说明 |
|------|------|------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434/v1/` | 本地 Ollama OpenAI 兼容端点 |
| `OLLAMA_MODEL` | `llama3.2:3b` | 桌宠 local 路由模型 |
| `OLLAMA_API_KEY` | `ollama` | Ollama 占位 key |

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/companion/state` | 伙伴/宠物状态（已有） |
| GET | `/companion/pet/status` | Ollama 可用性、stage、care_score |
| POST | `/companion/pet/wake` | 唤醒波尼：返回问候 action/text（托盘/快捷键/点击） |
| POST | `/companion/pet/context` | Tauri 感知上报 → `storage/companion/perception.jsonl` |
| POST | `/companion/pet/chat/stream` | SSE 结构化输出：`action`, `text`, `mood`, `tool_hint` |
| GET | `/evolution/dream/digest` | 早晨问候（Phase 3） |

### 聊天 SSE 事件类型

- `metadata` — route: `local` \| `cloud` \| `agent`
- `pet_action` — 动画提示（如 `thinking`）
- `token` — 流式文本（解析前）
- `pet_response` — 最终结构化 JSON
- `agent_handoff` — 已切完整 Agent（含 MCP）
- `done` / `error`

## 混合大脑路由

| 场景 | 路由 | 模型 |
|------|------|------|
| 短闲聊 / 情绪 | `local` / `cloud` | Ollama 或当前 LLM（无工具） |
| 天气 / 新闻 / 知识库 / 实时查询 | `tools` | ReAct + `search_web` / RAG / 记忆 / MCP |
| 生成媒体 / 发布 / 多步任务 | `agent` | `creative_agent` 全工具链 |

规则见 `backend/agents/pet_router.py`。

## 感知与隐私

- **前台 App / 窗口标题**：Rust `active-win-pos-rs`，约 45s 轮询
- **idle 秒数**：macOS `CGEventSource` / Windows `GetLastInputInfo`
- **剪贴板**：默认仅 **SHA256 hash + 长度**；UI opt-in 后才传 preview（前 200 字符）

## care_score 与 stage

| care_score | stage | 视觉 |
|------------|-------|------|
| 0–49 | young | 默认橙黄 |
| 50–199 | teen | 粉色 |
| 200+ | evolved | 蓝色光晕 |

交互 +1 care（`PATCH` 经 pet chat 自动）；Dream act 等沿用现有 API。

## macOS 权限

Phase 2 感知（前台 App 名）通常无需辅助功能。若扩展屏幕 OCR，需单独说明权限。

## Windows 适配

- 配置：`src-tauri/tauri.windows.conf.json`（透明窗、`shadow: false`、WebView2 引导、NSIS 安装器）
- 后端 API：**全部经 Rust `backend_request` / `backend_post_stream_cmd` 代理**，避免 WebView2 拦截 `localhost`
- 打包（独立便携 zip）：`scripts/build_desktop_pet_win.ps1`（本机 MSVC）或 `scripts/build_desktop_pet_win.sh`（macOS 交叉编译 GNU 便携版）
- **与数字员工合并打包**：`cd electron && ./build_win.sh` 的 Step 5b 会自动交叉编译桌宠并放入 `resources/desktop-pet/ai-media-agent-desktop-pet.exe`（+ `WebView2Loader.dll`），随 NSIS / zip 一起分发
- **Mac 交叉编译前置**：`brew install mingw-w64` + `rustup target add x86_64-pc-windows-gnu`；缺失时 Step 5b 仅告警跳过桌宠
- **改了桌宠 Rust/Svelte 后**：单独重编用 `bash electron/scripts/bundle_desktop_pet_win.sh`，再重打 Electron 包
- electron-builder 在 Mac 上若遇 `wineserver: Can't check in server_mach_port`（rcedit 写 exe 元数据失败）：≥1.7.0 的 `build_win.sh` 已自动加 `--config.win.signAndEditExecutable=false` 跳过；详见 `electron-mac-packaging` skill
- 快捷键：`Alt+Shift+B` 唤醒
- 依赖：WebView2（Win10/11 通常已自带；安装器可自动下载引导程序）

## 与 Electron 协作

Electron 托盘菜单「🐾 启动桌宠 (Boni)」会优先启动安装包内附带的桌宠：

- **Windows**：`resources/desktop-pet/ai-media-agent-desktop-pet.exe`（由 `electron/scripts/bundle_desktop_pet_win.sh` 在 `build_win.sh` 中自动构建）
- **macOS**：`resources/desktop-pet/AI Media Agent Pet.app`（可选手动放入 DMG）

开发环境无内置二进制时，回退为 `desktop-pet/` 目录下 `npm run tauri:dev`。

## 启动入口

| 入口 | 说明 |
|------|------|
| `./start_local.sh` / `./start_with_tunnel.sh` | 默认**不**拉起桌宠；`START_DESKTOP_PET=1` 可随脚本自动启动 |
| **Electron 托盘** | 「🐾 启动桌宠 (Boni)」 |
| **陪伴室** `/companion` | 右上角「**启动桌宠**」按钮 |
| **浏览器开发** | 陪伴室按钮 → `POST /api/desktop-pet/launch` |
| 手动 | `cd desktop-pet && npm run tauri:dev` |

### 桌宠「打开陪伴室」唤起内嵌控制台（独立 app，非浏览器）

打包版（Electron 托管桌宠）下，点桌宠「打开陪伴室」会在 **Electron 内嵌窗口** 打开 `/companion`，不再跳系统浏览器：

```
桌宠 Svelte openConsole()  (desktop-pet/src/App.svelte)
  → Tauri 命令 open_app_console            (src-tauri/src/lib.rs)
  → backend_client::request_open_console("/companion")   (src-tauri/src/backend_client.rs)
  → 写 APP_DATA/desktop-pet/open-console.signal  {"path":"/companion"}
Electron startDesktopPetConsoleWatcher() 轮询      (electron/main.js)
  → openDashboardWindow({ path: '/companion' })  打开/聚焦内嵌控制台
  → 删除 signal 文件
```

- 独立 `npm run tauri:dev`（非 Electron 托管）时 `request_open_console` 返回 false → 回退系统浏览器 `open()`。
- `pet_managed_by_app()` 依据环境变量 / 配置判断是否由 Electron 托管。

## 唤醒入口

| 操作 | 说明 |
|------|------|
| 启动桌宠 | 自动 `POST /companion/pet/wake`（source=startup） |
| 点击宠物 | 从休眠唤醒（source=click） |
| 右键宠物 | 弹出菜单（唤醒 / 陪伴室 / 关闭 / 退出） |
| 托盘 · 唤醒波尼 | 显示窗口并问候 |
| 托盘左键单击 | 同唤醒 |
| 全局快捷键 | macOS `⌘⇧B` / Windows `Alt+Shift+B` |

长时间 idle（≥10 分钟）进入休眠；定时 `companion_nudge` 写入的反馈会在下次唤醒时优先展示。

**启动加速（v0.1+）**：桌宠打开后**立即**显示本地问候（读缓存昵称），同时并行探测后端；连上后一次 `GET /companion/pet/bootstrap?fast=1` 同步状态与正式问候（startup 跳过 dream 加载）。

## 对话 UI 与语音

- **底部输入栏**：唤醒后始终固定在窗口底部（文字 + 🎤 + 发送），不再藏在展开面板里。
- **聊天记录**：点击星星或聚焦输入框展开上方消息列表；收起后保留最近一条预览气泡。
- **语音输入**：点击麦克风开始录音，**再次点击结束**并自动识别发送。Tauri 桌面版经后端 `/companion/pet/transcribe` 转写，避免 WebView 内 Web Speech API 闪退。macOS 首次需允许麦克风权限。
  - 链路：`MediaRecorder`(webm/opus) → `/companion/pet/transcribe` → ffmpeg 转 16k 单声道 wav → ASR。
  - ASR：**通义千问 `qwen3-asr-flash`（DashScope，默认）** → 失败再回退智谱 GLM-ASR / Whisper。
  - 需配置 **`ALIBABA_API_KEY` 或 `DASHSCOPE_API_KEY`**（与项目 LLM 通义 Key 相同）。
  - ffmpeg：优先系统 `ffmpeg`，**打包环境 PATH 无 ffmpeg 时回退 `imageio_ffmpeg` 内置二进制**（`companion_pet_router.py`），保证 webm 能转码。
- **窗口尺寸**：紧凑 300×420（宠物 + 输入栏）；展开聊天 300×620。需 Tauri 权限 `core:window:allow-set-size`。

## 对话路由（三层）

| 路由 | 触发示例 | 能力 |
|------|----------|------|
| `local` / `cloud` | 「你好」「今天有点累」 | 纯 LLM 陪伴闲聊（Ollama 优先） |
| `tools` | 「深圳天气」「查股价」「知识库里有什么」 | ReAct + `search_web` / RAG / 记忆 / MCP |
| `agent` | 「生成图片」「发布到小红书」「写脚本并执行」 | 完整 `creative_agent`（含媒体生成、多步任务） |

天气/新闻/实时数据走 `tools`；复杂创作走 `agent`。

**天气快路径（性能优化）**：`pet_service._stream_via_pet_tools` 先用 `weather_tools.looks_like_weather_query(text)` 判定天气意图，命中则直接调结构化 API `fetch_weather_short_sync`（Open-Meteo，失败回退 wttr.in），**跳过** DuckDuckGo 网搜，避免又慢又「查不到」。城市抽取由 `extract_city_from_query` 负责（已剥离「今天/查一下」等填充词，准确取出如「深圳」）。

## 故障排查

| 现象 | 处理 |
|------|------|
| 桌宠显示「请先启动 AI Media Agent」 | 确认主应用 Backend 已运行；桌宠会自动读取 `%APPDATA%\\ai-media-agent\\.backend_port` 并扫描 8000/8010/… 端口；点「重试」或重启桌宠 |
| Windows 无法启动 / 白屏 | 安装 [WebView2 运行时](https://developer.microsoft.com/microsoft-edge/webview2/) |
| 闲聊仍走云端 | 安装 Ollama 并 `ollama pull llama3.2:3b` |
| 复杂指令无工具 | 应出现 `tools_handoff` 或 `agent_handoff`；检查 backend MCP 与 `search_web` |
| 构建失败缺 icon | 运行 `desktop-pet/src-tauri/icons/` 下占位图或 `npm run tauri icon` |
| 看不到输入框 | 确认已唤醒（非休眠）；窗口应 ≥420px 高；重新打包以包含 `allow-set-size` 权限 |
| 语音不可用 | macOS 检查系统设置 → 隐私 → 麦克风/语音识别；WebView 不支持时按钮会变灰 |
| **语音识别报错 / TypeError** | 确保用 `glm-asr-2512` 且**未传** `response_format`，结果取 `choices[0].message.content`（`audio_tools.py`） |
| **打包版语音识别失败（webm 未转码）** | PATH 无系统 ffmpeg → 已回退 `imageio_ffmpeg`；用 ≥1.7.0 包 |
| **「打开陪伴室」跳系统浏览器** | 桌宠 exe 旧或非 Electron 托管；重编桌宠 exe（含 `open_app_console`），确认 Electron `startDesktopPetConsoleWatcher` 运行 |
| **天气「查不到」/ 很慢** | 用含天气快路径的 backend（`looks_like_weather_query` → `fetch_weather_short_sync`），跳过 DuckDuckGo |
| **报「启动超时 / 检查 WebView2」但桌宠其实在跑** | detached 进程误判；用 ≥1.7.0 含 `isPidAlive`/20s 超时的 `main.js` 重打 |

## 测试

```bash
cd backend
../venv/bin/python -m pytest ../tests/test_companion_pet_router.py -q
```

## 相关文件

- `desktop-pet/` — Tauri 工程
- `backend/routers/companion_pet_router.py`
- `backend/agents/pet_service.py`
- `backend/agents/pet_router.py`
- `backend/agents/pet_tools_agent.py`
- `web/app/companion/page.tsx` — 全屏陪伴室（非 Sidecar）
