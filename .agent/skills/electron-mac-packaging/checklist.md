# Electron 桌面打包检查表（macOS + Windows）

> 与 `SKILL.md` 配套；发版前打印或逐项勾选。

## A. 品牌 Logo（共用）

- [ ] `electron/assets/logo.png` 存在（真源插画，非占位图）
- [ ] `electron/assets/logo.png` 已 git track（`.gitignore` 有 `!electron/assets/logo.png`）
- [ ] 使用 **`./venv/bin/python3`** 运行 `electron/scripts/create_icons.py`（勿只用无 Pillow 的系统 python3）
- [ ] `web/public/brand-logo.png` 与 `logo.png` MD5 一致（或两者均 >50KB）
- [ ] `electron/resources/icons/icon.icns` 由 logo 生成（非紫色火箭）
- [ ] `web/next.config.ts` standalone 模式含 `images.unoptimized: true`
- [ ] Sidebar / 登录页使用 `object-contain`
- [ ] Windows：`electron/resources/icons/icon.ico` 存在（256×256 首帧）

## B. 内置 Python（macOS）

- [ ] `electron/resources/python/cpython-3.12.13+20260510-aarch64-apple-darwin-install_only.tar.gz` 存在（构建 Step 0b 下载，~24MB）
- [ ] `validate_packaging_assets.sh resources` 通过 bundled Python 检查
- [ ] 打包后 app-bundle validate：`.app/Contents/Resources/resources/python/*.tar.gz` 存在
- [ ] 安装向导显示「使用安装包内置 Python…」（非仅 GitHub 下载）

## B2. 内置 Python + Node（Windows）

- [ ] `electron/resources/python/cpython-3.12.13+20260510-x86_64-pc-windows-msvc-install_only.tar.gz` 存在（Step 0b，~46MB）
- [ ] `electron/resources/node/runtime/node.exe` 存在（Step 0c 预解压，~80MB）
- [ ] `validate_packaging_assets.sh win-resources` 通过
- [ ] `validate … win-unpacked` 通过 bundled Node runtime
- [ ] 安装向导显示「复制内置 Node.js 运行时…」

## C. Node.js 运行时（macOS）

- [ ] `main.js` 打包版 `ensureNodeRuntime()` 强制 `APP_DATA/node/`
- [ ] 安装完成后 `~/Library/Application Support/ai-media-agent/node/bin/node --version` 可用
- [ ] Frontend :3000 状态 Running（非「Node.js 未安装」）

## C3. 内嵌控制台与 Splash（macOS + Windows，≥1.0.37）

- [ ] `electron/renderer/splash.html`、`splash.css`、`splash.js` 存在且已 asarUnpack
- [ ] `status.html` / `setup.html` 使用外置 `status.css` / `setup.css`（无大段内联 `<style>`）
- [ ] `preload.js` 暴露 `onStartupProgress`
- [ ] `openDashboard()` 调用 `openDashboardWindow()`（Mac **不再** `openExternal`）
- [ ] `maybeAutoOpenDashboard` 在 Mac/Win 均生效（不仅 IS_WIN）
- [ ] Dashboard `BrowserWindow` 使用 `frame: true`（Mac + Win）
- [ ] `dashboardWindowNeedsReload` 防止 health poll 反复 `loadURL`
- [ ] 安装后：Frontend Running → 自动弹出内嵌控制台（非 Safari/Chrome 新标签）

## C4. Playwright（macOS + Windows）

- [ ] `startAllServices()` 调用 `ensurePlaywrightBrowsersReady` / `schedulePlaywrightInstall`
- [ ] `spawnService` / `envForVenv` 注入 `PLAYWRIGHT_BROWSERS_PATH=APP_DATA/.browsers`
- [ ] `backend/main.py` 不覆盖已有 `PLAYWRIGHT_BROWSERS_PATH`
- [ ] `browser_login.py`、`interactive_login.py` 读取环境变量路径
- [ ] 冒烟：`APP_DATA/.browsers/chromium-*` 存在或重启后自动安装

## C2. Windows 服务与端口

- [ ] `main.js` 打包版 `resolveBackendPort()` / `taskkill /F /T` 已合入
- [ ] Backend 健康检查使用 `SERVICES.backend.port`（非硬编码 8000）
- [ ] Frontend 环境变量 `BACKEND_URL` 与 backend 端口一致
- [ ] 无 Backend Error 误报（Scheduler stopped 不应单独作为错误）
- [ ] `%APPDATA%/ai-media-agent/logs/backend.log` 无持续 10013

## D. 版本与 Backend 同步

- [ ] `electron/package.json` version 已 bump（大版本/发版）
- [ ] `build_mac.sh` Step 4 后 `resources/backend/.bundle_revision` 含 git short hash（如 `1.0.37-3e8a583`）
- [ ] 新增 backend 目录已在 `build_mac.sh` / `build_win.sh` copy 列表（`agents core tools utils routers services admin`）
- [ ] `resources/backend/routers/agent_chat_router.py` 存在（LangGraph 哨兵）
- [ ] `resources/backend/agents/chat_service.py`、`graph_router.py`、`checkpoint.py` 等已随 build 复制
- [ ] `requirements.txt` 含新依赖（如 `aiosqlite`、`langgraph-checkpoint-sqlite`）
- [ ] `electron/main.js` 的 `syncAppResources()` 在 **每次 `startAllServices()`** 调用（非仅安装向导）
- [ ] `electron/main.js` 含哨兵检查 `routers/agent_chat_router.py`
- [ ] backend sync 后会触发 `installPythonDependencies()`（post-sync pip）

## D2. 环境变量 `.env.bundled`（API Key 进包）

- [ ] 构建机 `backend/.env` 含发版所需 Key（如 `PEXELS_API_KEY`、`PIXABAY_API_KEY`）
- [ ] `build_mac.sh` / `build_win.sh` Step 4 输出 `Bundled env defaults → …/.env.bundled`
- [ ] DMG/zip 内 `.app/.../resources/backend/.env.bundled` 存在（挂载 DMG 抽查）
- [ ] `electron/main.js` 含 `mergeBundledEnvDefaults()`（`startAllServices` + `runSetup`）
- [ ] `.gitignore` 含 `electron/resources/backend/.env.bundled`（构建产物勿提交）
- [ ] 安装后 `APP_DATA/backend/.env` 已合并 Key（不覆盖用户已有非空 LLM Key）
- [ ] `curl …/tools/video/auto/config/voices` → `stock_keys.pexels: true`（若需 Pexels）

## E. macOS 构建

- [ ] `./build_mac.sh arm64 unsigned`（或 signed）无报错
- [ ] `electron/dist/AI Media Agent-<ver>-arm64.dmg` 生成（约 270MB）
- [ ] DMG 内含 Install AI Media Agent.app、安装说明、dmg-install.sh
- [ ] Step 8 app-bundle validate 全部 ✓

## E2. Windows 构建

- [ ] `./build_win.sh` 或 `./build_win.sh portable` 无报错
- [ ] `electron/dist/AI Media Agent-<ver>-win.zip` 生成（**首选分发**）
- [ ] 可选：`AI Media Agent <ver>.exe` portable
- [ ] Step 7 win-unpacked validate 全部 ✓
- [ ] **Step 8** `verify_win_zip.sh` PASSED（桌宠 + `.env.bundled` + 核心 runtime）
- [ ] `package.json` win.target 含 zip；`requestedExecutionLevel: asInvoker`
- [ ] 无 Wine 时构建未因 rcedit 中断（≥1.7.0 自动 `signAndEditExecutable=false`）；如中断手动加该 flag
- [ ] **未误用** `build_windows.sh`（那是源码 zip，不是 Electron 桌面包）

## E3. 桌宠 (Boni) Windows Sidecar（必选）

- [ ] 交叉编译前置：`x86_64-w64-mingw32-gcc` 可用（`brew install mingw-w64`）+ `rustup target add x86_64-pc-windows-gnu`
- [ ] Step 5b 输出 `desktop-pet → resources/desktop-pet/ai-media-agent-desktop-pet.exe`（**失败则整包构建中断**，≥1.8.0）
- [ ] `resources/desktop-pet/` 含 exe + `WebView2Loader.dll` + `使用说明.txt`
- [ ] win-unpacked 内 `resources/resources/desktop-pet/ai-media-agent-desktop-pet.exe` 存在
- [ ] 改了 `desktop-pet/` Rust/Svelte → 已 `bash electron/scripts/bundle_desktop_pet_win.sh` 重编
- [ ] 「打开陪伴室」唤起 Electron 内嵌窗口（`open_app_console` → signal → `startDesktopPetConsoleWatcher`），非系统浏览器
- [ ] 桌宠启动不误报「超时/WebView2」（main.js 含 `isPidAlive` + 20s 超时）

## E3b. zip 开箱即用验证（Step 8）

- [ ] `bash electron/scripts/verify_win_zip.sh "$(pwd)" "electron/dist/AI Media Agent-<ver>-win.zip"` → PASSED
- [ ] zip 内含 `resources/resources/desktop-pet/ai-media-agent-desktop-pet.exe`
- [ ] zip 内含 `resources/resources/backend/.env.bundled`（非明文 `.env`）
- [ ] bundled keys：`ZHIPUAI_API_KEY`、`OPENROUTER_API_KEY`、`GOOGLE_API_KEY`、`PEXELS_API_KEY` 非空（`PIXABAY_API_KEY` 可选，有 Pexels 即可）
- [ ] 无 `.DS_Store` / `__MACOSX` / 超长路径（>180）

## E4. 语音识别 (STT)

- [ ] 主引擎：`qwen3-asr-flash`（`companion_pet_router.py` → `transcribe_audio_qwen_asr_bytes`）
- [ ] Key：`DASHSCOPE_API_KEY` 或 `ALIBABA_API_KEY`（安装向导 / 设置页，非 bundled 智谱 Key）
- [ ] `/companion/pet/transcribe/status` → `has_alibaba_key: true`、`primary_engine: qwen3-asr-flash`
- [ ] Fallback：`glm-asr-2512` / Whisper（`audio_tools.py`）
- [ ] backend 变更随 Step 4 全量刷新进 `resources/backend/`

## F. macOS 安装冒烟（本机）

- [ ] 用 Install.app 或 dmg-install.sh 安装（unsigned 勿直接双击主 .app）
- [ ] **覆盖升级时**：`rm -f ~/Library/Application Support/ai-media-agent/.resource_bundle_version` 后重启
- [ ] 安装向导完成（Python + pip + Node + 依赖）
- [ ] Backend :8000、Frontend :3000 Running
- [ ] 侧边栏与登录页显示**插画 logo**（非紫色火箭）
- [ ] `curl http://127.0.0.1:3000/brand-logo.png` 返回 200
- [ ] `curl http://127.0.0.1:8000/health` 返回 200
- [ ] `POST /agent/chat/stream` 返回 **200**（非 404）：
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8000/agent/chat/stream \
    -H "Content-Type: application/json" -d '{"input":"你好","mode":"direct"}'
  ```
- [ ] APP_DATA 含 `backend/routers/agent_chat_router.py`
- [ ] `APP_DATA/backend/.resource_bundle_version` 与 bundle 内 `.bundle_revision` 一致
- [ ] 主界面发消息不再出现 `Backend error: 404` on `/api/agent/chat/stream`
- [ ] **内嵌控制台**打开（非 Safari）；splash 启动进度正常
- [ ] Playwright：`playwright:ok` 或重启后 `.browsers` 自动生成
- [ ] 一键短视频：`stock_keys.pexels` 为 true（或 APP_DATA `.env` 含 `PEXELS_API_KEY`）

## F2. Windows 安装冒烟

- [ ] 解压 zip，运行 `AI Media Agent.exe`（勿长期用 portable 单文件测性能）
- [ ] 安装向导有进度反馈；完成后 Backend / Frontend Running
- [ ] `curl http://127.0.0.1:8000/health` 与 `:3000/` 可达
- [ ] `%APPDATA%\ai-media-agent\node\node.exe --version` 可用
- [ ] `%APPDATA%\ai-media-agent\backend\.env` 已含 LLM Key（来自 `.env.bundled` 合并，无需手配）
- [ ] 托盘「启动桌宠」→ Boni 窗口出现；语音 / 打开陪伴室可用

## G. Git 安全

- [ ] 未提交 `.env.bundled`、`developer_id_private.key`、证书、`.dmg`
- [ ] 未提交 `electron/resources/python/*.tar.gz`（构建缓存）
- [ ] 未提交 `electron/resources/node/`（Node zip + runtime 构建缓存）
- [ ] 未提交 `electron/dist/`、`backend/published_content.json`
- [ ] 未提交 `electron/resources/web-standalone/public/public/`
- [ ] `.gitignore` logo / html / env 例外完整：
  - `!web/public/brand-logo.png`
  - `!electron/assets/logo.png`
  - `!electron/resources/web-standalone/public/brand-logo.png`
  - `!mobile/**/*.html`
  - `electron/resources/backend/.env.bundled`（应被 ignore）

## H. 常见失败速查

| 检查项 | 失败时动作 |
|--------|------------|
| brand-logo ~4KB | `./venv/bin/python3 electron/scripts/create_icons.py` |
| validate placeholder | 同上，确认 Pillow 可用 |
| tar _python-dist.tar.gz | 确认 Step 0b 与 .app 内 python tarball |
| Node 未安装 | 删 `.setup_done`，用最新 DMG 重装 |
| Win Node 失败 | 确认 `resources/node/runtime/node.exe` + 新 zip |
| Win 10013 端口 | 自动换端口；netstat + taskkill |
| Backend 误报 Error | 更新 main.js 进程归属检查 |
| logo 空白 | 查 `images.unoptimized` + standalone public 路径 |
| **聊天 API 404** | APP_DATA backend 未 sync | 删 `.resource_bundle_version` 重启；验哨兵文件与 openapi |
| openapi 无 `/agent/chat/*` | 旧 main.py 仍在 APP_DATA | 强制 sync；确认 DMG 内 bundle_revision |
| 同版本换包仍 404 | 跳过安装向导 + 旧 sync 逻辑 | 用含 startAllServices sync 的 main.js 重打 DMG |
| Mac 跳 Safari | 旧 openExternal | 更新 main.js 内嵌控制台 |
| 聊天输入被清空 | pollHealth 重载 dashboard | dashboardWindowNeedsReload |
| Playwright missing | 未 ensure / 路径不一致 | 查 APP_DATA/.browsers + backend env |
| Pexels 无素材 | 无 `.env.bundled` 或未 merge | 重打包；查 APP_DATA `.env` 与 config/voices |
| Win/CSS 纯文本 | 内联 style | 外置 setup.css / status.css |
