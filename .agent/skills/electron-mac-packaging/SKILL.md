---
name: electron-mac-packaging
display_name: Electron 桌面打包规范（macOS + Windows）
description: >-
  AI Media Agent Electron 打包流程：macOS DMG 与 Windows zip/portable/NSIS。
  涵盖 logo/icon、内置 Python/Node、.env.bundled 密钥合并、安装向导、内嵌控制台、
  Playwright、Backend 同步与 APP_DATA 404 修复、桌宠 (Boni) Windows 交叉编译 sidecar、
  陪伴室跨进程 signal 唤起、语音 STT (glm-asr-2512) 与 rcedit/Wine 失败绕过。在用户要求打 DMG、
  打 Windows 包、打包、发版、electron build，或修改 build_mac.sh / build_win.sh / main.js /
  renderer/ / desktop-pet/ 时使用。
version: 1.8.1
category: deployment
tags:
  - electron
  - dmg
  - macos
  - windows
  - nsis
  - zip
  - packaging
  - brand-logo
  - python-standalone
  - node-standalone
---

# Electron 桌面打包规范（macOS + Windows）

面向 **AI Media Agent** 的 Electron 桌面版（`electron/`）。打包前必读，避免 logo 占位图、Python/Node 安装失败、Windows 端口 8000 冲突或 Backend 误报 Error。

## 何时使用

- 用户说：打 DMG、打 Windows 包、打包、发版、build mac / build win
- 修改 `electron/main.js` 安装/venv/pip/Node/Python/端口/服务生命周期/**backend 同步**/**内嵌控制台**/**splash**
- 修改 `electron/renderer/`（status/setup/splash）或 `preload.js` 的 IPC
- 修改 `backend/` 新增 API 路由（如 `/agent/chat/stream`）后需重新打包并验证 APP_DATA 同步
- Sidebar/登录页 logo 空白；安装向导无进度；Node 安装失败；Backend :8000 Error
- 桌面包 Pexels/Pixabay 无素材、`PEXELS_API_KEY not configured`、一键短视频拿不到 stock footage

---

## 包类型选择（必读 — 勿用错脚本）

| 用户需求 | 正确命令 | 产物 | 说明 |
|----------|----------|------|------|
| **Windows 桌面版**（Electron，开箱即用） | `cd electron && ./build_win.sh` | `electron/dist/AI Media Agent-<ver>-win.zip` | **默认发这个**；内置 Python/Node、桌宠、`.env.bundled` |
| macOS 桌面版 | `cd electron && ./build_mac.sh arm64` | `electron/dist/*.dmg` | 同上逻辑 |
| 源码 zip（需用户自行装 Python/Node） | `./build_windows.sh` | `dist/ai-media-agent-windows.zip` | **不是** Electron 桌面包；仅内部源码分发 |

**用户说「打 Windows 包 / 打包 / env 打进包 / 开箱即用」→ 一律走 `electron/build_win.sh`，禁止默认跑 `build_windows.sh`。**

发版后必跑（`build_win.sh` Step 8 已自动执行）：

```bash
bash electron/scripts/verify_win_zip.sh "$(pwd)" "electron/dist/AI Media Agent-<ver>-win.zip"
```

另遵守 **windows-package-compat** skill：staging 用 `storage/temp/`、zip 用 `zip -r -X`、排除 `node_modules`/`.git`/`.DS_Store`、检查超长路径。

---

## 开箱即用（OOB）功能矩阵 — Windows zip

构建机 `backend/.env` 在 Step 4 复制为 `resources/backend/.env.bundled`；首次启动 `mergeBundledEnvDefaults()` 合并到 `%APPDATA%/ai-media-agent/backend/.env`。**用户无需手配 env。**

| 功能 | 包内依赖 | 验证方式 |
|------|----------|----------|
| AI 对话 / 多 Agent | `.env.bundled` 含 LLM Key | `verify_win_zip` ✓ bundled key |
| 一键短视频 Pexels | `PEXELS_API_KEY` in bundled | 安装后 `stock_keys.pexels: true` |
| 一键短视频 Pixabay | `PIXABAY_API_KEY`（**可选**） | 有 Pexels 即可；缺 Pixabay 时自动回退 Pexels / 本地 B-roll |
| 平台浏览器登录 | Playwright 首次后台安装 | `%APPDATA%/ai-media-agent/.browsers/` |
| 桌宠 Boni | `desktop-pet/ai-media-agent-desktop-pet.exe` + `WebView2Loader.dll` | `verify_win_zip` ✓ pet exe |
| 陪伴室 / 语音 STT | backend + `DASHSCOPE_API_KEY` 或 `ALIBABA_API_KEY` | 托盘启动桌宠 → 语音输入（引擎 `qwen3-asr-flash`） |
| 打开陪伴室（内嵌） | signal → `openDashboardWindow('/companion')` | 桌宠按钮不跳系统浏览器 |
| Agent Skills (54) | `resources/agent-skills/` | `verify_win_zip` ✓ skill count |
| 本地目录检索 | `directory-service.exe` | 可选 gRPC sidecar |
| 文档解析 | `parser-service.exe` | 可选 Rust sidecar |

**桌宠 Step 5b 失败 = 构建失败**（≥1.8.0，不再告警跳过）。前置：`brew install mingw-w64` + `rustup target add x86_64-pc-windows-gnu`。

**安装向导日志（≥1.8.1）**：首次安装过程写入 `%APPDATA%/ai-media-agent/logs/install.log`（向导内可滚动查看 +「打开日志文件」）；每行含时间戳、步骤名、进度与详情。

---

## macOS 快速命令

```bash
# 无 Developer ID（分发给其他 Mac，需 Install.app 或 dmg-install.sh）
cd electron && ./build_mac.sh arm64 unsigned

# 有 Developer ID + 公证（mac-build.env 已配置）
cd electron && ./build_mac.sh arm64

# 仅生成 logo/icon（推荐用 venv Python，确保有 Pillow）
./venv/bin/python3 electron/scripts/create_icons.py

# 仅校验 logo/icon/Python  tarball（不打包）
bash electron/scripts/validate_packaging_assets.sh "$(pwd)" resources
```

产物：`electron/dist/AI Media Agent-<version>-arm64.dmg`（`dist/` 在 `.gitignore`，不入库）

含内置 Python 后 DMG 约 **270MB**（含 Next standalone + 运行时）。

### macOS 运行时体验（≥1.0.37）

Mac 与 Windows **统一为内嵌控制台**，不再 `shell.openExternal` 跳 Safari/Chrome：

| 能力 | 实现 | 关键函数 / 文件 |
|------|------|-----------------|
| 内嵌控制台 | `BrowserWindow` 加载 `http://127.0.0.1:3000` | `openDashboardWindow()`、`openDashboard()` |
| 启动 splash | 服务拉起前显示进度 | `showSplashWindow()` → `renderer/splash.html` |
| 自动打开 UI | Frontend Running 后自动开控制台 | `maybeAutoOpenDashboard('frontend')` |
| 托盘入口 | 菜单「Open Dashboard」 | `ipcMain.handle('open-dashboard')` |
| 状态窗 | Mac 仍保留托盘「Service Status」 | `showStatusWindow()` → `renderer/status.html` |

**Dashboard 窗口选项（Mac + Windows 共用）：**

- `frame: true` — 标准标题栏，**避免** `titleBarOverlay` 盖住页面右上角按钮（如「对话设置」）
- `dashboardWindowNeedsReload(url)` — 仅在窗口不存在或 URL 变化时 `loadURL`，**禁止**每次 health poll 重载（否则聊天输入被清空）
- `dashboardAutoOpened` — 仅自动打开一次

**启动时序（已安装、非向导）：**

```
app.ready → startAllServices()
  → showSplashWindow + sendStartupProgress
  → syncAppResources + post-sync pip
  → ensurePlaywrightBrowsersReady（Mac 后台；Win 另 schedulePlaywrightInstall）
  → launchAllServices (backend → frontend)
  → pollHealth(frontend) → maybeAutoOpenDashboard
  → closeSplashWindow + openDashboardWindow
```

**Renderer 文件（须打进 asarUnpack）：**

```
electron/renderer/
  splash.html / splash.css / splash.js   # 启动进度
  status.html  / status.css  / status.js # 服务状态
  setup.html   / setup.css   / setup.js  # 安装向导
electron/preload.js                      # onStartupProgress IPC
```

`electron/package.json`：

```json
"files": ["main.js", "preload.js", "renderer/**/*", "!resources/**"],
"asarUnpack": ["renderer/**/*"]
```

> **Windows 专项**：`file://` 加载 setup/status 时，内联 `<style>` + CSP 会被当作文本显示；必须外置 `*.css`（见故障排查）。Mac 同样使用外置 CSS，但现象主要在 Windows 暴露。

### 覆盖升级（同版本号换包时必读）

`electron/package.json` 的 `version`（如 `1.0.37`）与 **bundle revision**（如 `1.0.37-3e8a583`，写入 `resources/backend/.bundle_revision`）是两套标识：

| 标识 | 作用 |
|------|------|
| `APP_VERSION`（package.json） | 触发安装向导 / venv 全量清理 |
| `.bundle_revision`（git hash 后缀） | 触发 **backend 增量同步** 到 APP_DATA |

**仅换 DMG、版本号不变** 时，用户可能跳过安装向导，旧 backend 仍留在 APP_DATA → 新前端调新 API 会 **404**。

**发版后告知用户（覆盖安装）：**

```bash
# 1. 完全退出应用（托盘 → 退出）
# 2. 安装新 DMG 到「应用程序」
# 3. 清除 backend 同步戳，强制下次启动重拷
rm -f ~/Library/Application\ Support/ai-media-agent/.resource_bundle_version
# 4. 重新打开应用（会自动 sync backend + 刷新 pip）
```

≥1.0.37 的 `main.js` 已在 **每次 `startAllServices()`** 调用 `syncAppResources()`，并检查哨兵文件 `routers/agent_chat_router.py`；缺文件时强制同步。

---

## Windows 快速命令

> **前置（Mac 上交叉编译桌宠）**：`brew install mingw-w64` + `rustup target add x86_64-pc-windows-gnu`。**缺失则 Step 5b 失败，整包构建中断。**

```bash
# 推荐：zip + portable（Mac 上无 Wine 时默认，已自动跳过 rcedit）
cd electron && ./build_win.sh

# 仅 zip + portable
cd electron && ./build_win.sh portable

# NSIS 安装包（需 Wine：brew install --cask wine-stable）
cd electron && ./build_win.sh nsis

# 仅重编桌宠 exe（含陪伴室 signal / 语音修复后单独重打）
bash electron/scripts/bundle_desktop_pet_win.sh

# 校验 Windows 资源（不打包）
bash electron/scripts/validate_packaging_assets.sh "$(pwd)" win-resources
bash electron/scripts/validate_packaging_assets.sh "$(pwd)" win-unpacked electron/dist/win-unpacked

# 发版后 zip 开箱即用验证（build_win.sh Step 8 自动跑；也可手动）
bash electron/scripts/verify_win_zip.sh "$(pwd)" "electron/dist/AI Media Agent-<ver>-win.zip"
```

### Windows rcedit / Wine 失败（必读）

Mac/Linux 上 electron-builder 用 **rcedit**（经 Wine）给 `.exe` 写版本号 + 图标元数据。Wine 失效时报：

```
wineserver: Can't check in server_mach_port
wine: for some mysterious reason, the wine server failed to run.
⨯ cannot execute  cause=exit status 1   (rcedit-x64.exe …)
```

- **注意**：此时 `win-unpacked/` 通常已打包完成（含全部 resources），仅最后写元数据失败 → 整体 exit 1。
- **≥1.7.0 的 `build_win.sh` 已自动处理**：无 Wine 时 `build_portable_zip()` 追加 `--config.win.signAndEditExecutable=false`，跳过 rcedit。
- **手动绕过**（脚本中断 / 旧版脚本）：

```bash
cd electron
npx electron-builder --win --x64 --config.win.target=portable --config.win.signAndEditExecutable=false
npx electron-builder --win --x64 --config.win.target=zip --config.win.signAndEditExecutable=false
```

- **影响**：仅 exe 文件属性里的版本号/产品名/图标元数据缺失，**不影响运行**。要完整元数据需在 Windows 机器构建或装可用 Wine。

### Windows 产物（`electron/dist/`）

| 文件 | 说明 | 分发建议 |
|------|------|----------|
| `AI Media Agent-<ver>-win.zip` | 解压即用 | **首选**，启动最快 |
| `AI Media Agent <ver>.exe` | portable 单文件 | 每次启动解压，较慢 |
| `AI Media Agent Setup <ver>.exe` | NSIS（需 Wine 构建） | 标准安装向导 |

用户数据：`%APPDATA%/ai-media-agent/`

### Windows 7 步构建（`build_win.sh`）

| 步骤 | 内容 |
|------|------|
| 0 | 品牌资源：`create_icons.py`（含 **icon.ico**，256×256 须为第一帧） |
| 0b | 下载 Windows Python tarball → `resources/python/` |
| 0c | 下载 Node zip 并**预解压** → `resources/node/runtime/node.exe` |
| 1 | Go `directory-service.exe`（`GOOS=windows GOARCH=amd64`） |
| 2 | Rust `parser-service.exe`（`x86_64-pc-windows-gnu`，可选） |
| 3 | Next standalone + `@img/sharp-win32-x64` |
| 4–5 | backend + ocr-service 复制 |
| **5b** | **桌宠 (Boni) exe**：`bundle_desktop_pet_win.sh`（**失败则构建中断**） |
| 6 | electron-builder（zip/portable/NSIS；无 Wine 自动 `signAndEditExecutable=false`） |
| 7 | `validate … win-unpacked` |
| **8** | **`verify_win_zip.sh`** — 桌宠 / `.env.bundled` / 核心 runtime / zip 兼容性 |

### 桌宠 (Boni) Windows Sidecar 打包

桌宠是独立 **Tauri 2** 进程（`desktop-pet/`），随数字员工安装包附带（非单独 zip）。

| 项 | 说明 |
|----|------|
| 构建脚本 | `electron/scripts/bundle_desktop_pet_win.sh`（build_win.sh Step 5b 调用） |
| 交叉编译目标 | `x86_64-pc-windows-gnu`（需 `brew install mingw-w64`） |
| 产物 | `electron/resources/desktop-pet/ai-media-agent-desktop-pet.exe` + `WebView2Loader.dll` + `使用说明.txt` |
| 打进包 | electron-builder `extraResources` → `resources/resources/desktop-pet/` |
| 运行依赖 | WebView2 运行时（Win10/11 多自带）；连本机 backend `:8000` |
| 启动方式 | Electron 托盘「启动桌宠」→ `spawnDesktopPetExe`；**不**单独打包 `.env`/Key |

**改了 `desktop-pet/` 的 Rust/Svelte 后**：必须 `bash electron/scripts/bundle_desktop_pet_win.sh` 重编 exe，再重打 Electron 包（或直接 `./build_win.sh`，Step 5b 会自动重编）。

**陪伴室跨进程唤起（≥1.7.0）**：桌宠点「打开陪伴室」**不再跳系统浏览器**，而是经 signal 文件让 Electron 主窗口打开：

```
桌宠 Svelte openConsole()
  → Tauri 命令 open_app_console (lib.rs)
  → backend_client::request_open_console("/companion")
  → 写 APP_DATA/desktop-pet/open-console.signal  {"path":"/companion"}
Electron startDesktopPetConsoleWatcher() 轮询该文件
  → openDashboardWindow({ path: '/companion' }) 打开/聚焦内嵌控制台
  → 删除 signal 文件
```

- 桌宠未由 Electron 托管（独立 `tauri:dev`）时，`request_open_console` 返回 false → Svelte 回退 `open()` 系统浏览器。
- 关键文件：`desktop-pet/src-tauri/src/{lib.rs,backend_client.rs}`、`desktop-pet/src/App.svelte`、`electron/main.js`（`startDesktopPetConsoleWatcher` / `openDashboardWindow` / `dashboardOnPath`）。

**桌宠启动「超时/WebView2」误报（已修，≥1.7.0）**：detached GUI 进程会让 `spawn` 提前返回，旧逻辑误判为失败。`main.js` 已用 `isPidAlive()` + 20s 超时 + `isDesktopPetProcessRunning()` 容错，并由 `startDesktopPetMonitor()` 持续同步状态。

### 语音识别 (STT) — qwen3-asr-flash

桌宠语音输入链路：Svelte `MediaRecorder`(webm/opus) → `/companion/pet/transcribe` → **DashScope Qwen ASR**（webm 直传）；失败时 ffmpeg 转 wav → 智谱/Whisper 兜底。

| 项 | 要点 |
|----|------|
| 主引擎 | **`qwen3-asr-flash`**（`transcribe_audio_qwen_asr_bytes`）；Windows 无 ffmpeg 也可识别 |
| Key | **`DASHSCOPE_API_KEY` 或 `ALIBABA_API_KEY`**（安装向导选通义；与 LLM 通义 Key 相同） |
| Fallback | 智谱 **`glm-asr-2512`** / Whisper（需 `ZHIPUAI_API_KEY` 或 ffmpeg） |
| ffmpeg 转码 | 仅 fallback 路径需要；`companion_pet_router.py` 优先 `shutil.which("ffmpeg")`，回退 `imageio_ffmpeg` |

> 改了 `audio_tools.py` / `companion_pet_router.py` 后属 backend 变更：重打包即自动进 `resources/backend/`（Step 4 全量刷新），并依赖 `syncAppResources` 同步到 APP_DATA。

### Windows 内置 Node（必读）

安装期 **禁止**依赖系统 Node 或错误地下载 macOS 版 Node：

| 路径 | 用途 |
|------|------|
| `resources/node/runtime/node.exe` | 构建期预解压，安装时 **copyDir**（无需 tar） |
| `resources/node/node-v22.15.0-win-x64.zip` | 构建缓存，validate 校验 |
| `APP_DATA/node/node.exe` | 运行时 copy 目标 |

`main.js` 关键函数：

- `installNodeFromBundledRuntime()` — 优先 copy 内置 runtime
- `extractNodeZipPowerShell()` — zip 解压兜底（tar 不可用时）
- `ensureNodeRuntime()` — 打包版强制 portable Node

安装向导应显示 **「复制内置 Node.js 运行时…」**。

### Windows 端口 8000（WinError 10013）

| 现象 | 处理 |
|------|------|
| `error while attempting to bind … 10013` | 8000 被占用或 Hyper-V 保留 |
| Backend Error + Scheduler stopped INFO | 常为绑定失败后的退出日志，非 Scheduler bug |

`main.js` 已实现：

- `collectPidsOnPort()` — 完整 `netstat -ano -p tcp`（支持中文「侦听」）
- `resolveBackendPort()` — 候选端口 `8000,8010,8020,8030,8080,8888,18000`
- `retryBackendOnNextPort()` — 绑定失败自动换端口
- Frontend `BACKEND_URL` 跟随 `SERVICES.backend.port`

排查占用：

```powershell
netstat -ano -p tcp | findstr :8000
taskkill /F /PID <pid> /T
```

### Windows Backend 误报 Error（已修复）

旧进程 `close` 事件覆盖新进程状态，Scheduler INFO 被当成错误：

- `spawnService` 用 `svc.proc !== proc` 忽略过期进程事件
- `isBenignServiceLog()` 过滤 Scheduler stopped / Uvicorn startup
- `stopAllServices` 用 `taskkill /F /T`

### Windows 安装向导

- `setup-ui-ready` IPC：UI 就绪后再 `runSetup`，避免无进度
- pip 依赖按 `requirements.txt` 哈希跳过重复安装
- Playwright 在 Windows **后台安装**，缩短首次向导时间
- `syncAppResources()` 按版本增量复制 backend

### Windows package.json 要点

```json
"win": {
  "target": [{ "target": "zip" }, { "target": "nsis" }],
  "requestedExecutionLevel": "asInvoker"
}
```

- `asInvoker`：无需管理员即可运行（旧版 `requireAdministrator` 易引发权限/端口问题）
- `create_icons.py` 生成 `icon.ico`（electron-builder 要求 256×256 为首帧）

### Windows 构建缓存（勿提交 git）

```
electron/resources/python/*.tar.gz
electron/resources/node/
```

构建时 Step 0b/0c 自动下载；`.gitignore` 已忽略。

---

## 打包前检查清单

复制 [checklist.md](checklist.md) 逐项确认；核心项：

```
- [ ] electron/package.json version 已递增
- [ ] electron/assets/logo.png 存在且已 git track
- [ ] ./venv/bin/python3 electron/scripts/create_icons.py 成功（勿只用无 Pillow 的系统 python3）
- [ ] web/public/brand-logo.png 与 logo.png MD5 一致（或体积均 >50KB，非 ~4KB 占位图）
- [ ] electron/resources/python/cpython-3.12.13+20260510-*-apple-darwin-install_only.tar.gz 存在
- [ ] backend 变更已能通过 build 脚本进入 resources/backend（含 routers/、agents/）
- [ ] Next build 输出含 `ƒ /api/agent/chat/stream`（LangGraph 代理路由）
- [ ] `electron/renderer/splash.*`、`status.*`、`setup.*` 外置 CSS 齐全；`asarUnpack` 含 `renderer/**/*`
- [ ] Mac/Win 控制台为内嵌 `openDashboardWindow`（非 openExternal）
- [ ] validate_packaging_assets.sh resources + app-bundle 均通过
- [ ] `electron/main.js` 含 `mergeBundledEnvDefaults()`（每次 `startAllServices` + `runSetup`）
- [ ] 构建机 `backend/.env` 含发版所需 Key；构建日志有 `.env.bundled`
- [ ] 未将 developer 证书/私钥、`.env.bundled` 构建产物提交到 git
```

## macOS 发版流程（推荐顺序）

1. **Bump** `electron/package.json` version（对外发版；同版本热修复可只依赖 git hash 更新 `.bundle_revision`）
2. **确认** `backend/` 新模块在 `build_mac.sh` Step 4 copy 列表内
3. **构建** `cd electron && ./build_mac.sh arm64`（或 `unsigned`）
4. **验包** Step 8 validate 通过；检查 `resources/backend/.bundle_revision`
5. **挂载 DMG 或解包** 抽查 `.app` 内 `resources/backend/routers/agent_chat_router.py`
6. **安装冒烟**（见文末命令）：health + `/agent/chat/stream` 200 + **内嵌控制台** + Playwright + **stock_keys**
7. **分发说明**：覆盖安装用户需删 `.resource_bundle_version` 或依赖新版 main.js 自动 sync；新 API Key 依赖 `.env.bundled` 合并
8. **勿提交** dist/、证书、python tarball、`electron/resources/web-standalone/public/public/`（Next 误产物）

## 品牌 Logo（禁止变成紫色火箭）

### 根因（必读）

| 陷阱 | 后果 |
|------|------|
| 系统 `python3` 无 Pillow | `create_icons.py` 走 `build_fallback`，生成**紫色火箭**占位图，**忽略** `electron/assets/logo.png` |
| `brand-logo.png` 被缩成 128×128 占位 | Sidebar 显示错误图标 |
| Next.js standalone 未 `images.unoptimized: true` | `/_next/image` 400，logo 空白 |

### 来源与引用

| 文件 | 用途 |
|------|------|
| **`electron/assets/logo.png`** | **唯一真源**（插画 logo，须入库） |
| `web/public/brand-logo.png` | **直接 copy** 自 `logo.png`；Sidebar/login 引用 `/brand-logo.png` |
| `web/next.config.ts` | standalone 须 `images.unoptimized: true` |
| `web/app/components/Sidebar.tsx`、`login/page.tsx` | 使用 `object-contain` 显示 logo |
| `electron/resources/web-standalone/public/brand-logo.png` | 打进 .app 的前端静态资源 |
| `electron/resources/icons/icon_512.png` / `icon.icns` | App 图标（`fit_square` 等比，不拉伸） |

### 生成

```bash
# 必须：build_mac.sh 使用 venv Python；手动时也同理
./venv/bin/python3 electron/scripts/create_icons.py
```

脚本行为：

1. 优先 Pillow；缺失时尝试 `pip install pillow` 或 macOS `sips` fallback
2. **`brand-logo.png` = shutil.copy2(logo.png)**，不是火箭占位图
3. `icon.icns` 从 logo 等比 fit 到 square canvas
4. 若 `web-standalone/public` 已存在则同步 brand-logo

### 构建顺序（强制）

`build_mac.sh` 约定：

1. **Step 0** — 检查 `electron/assets/logo.png` 存在 → `create_icons.py`（**venv Python**）
2. **Step 0b** — 下载/缓存 Python tarball 到 `electron/resources/python/`（见下节）
3. **Step 0 末** — `validate_packaging_assets.sh resources`（含 logo 体积校验 + bundled Python）
4. **Step 3** — Next standalone 复制 `public/`，并 `cp brand-logo.png` 双保险
5. **Step 6** — 再次 `cp brand-logo` 到 standalone
6. **Step 8** — `validate … app-bundle` 校验 .app 内 logo + Python

### .gitignore 例外

根目录 `*.png` / `*.html` 忽略，必须保留：

```
!web/public/brand-logo.png
!electron/assets/logo.png
!electron/resources/web-standalone/public/brand-logo.png
!mobile/**/*.html
```

Python tarball **不入库**（构建时下载）：

```
electron/resources/python/*.tar.gz
electron/resources/node/
electron/resources/backend/.env.bundled
```

**切勿提交：**

- `developer_id_private.key`、`developerID_application.cer`
- `electron/dist/`、`backend/published_content.json`
- `electron/resources/web-standalone/public/public/`（重复 public 目录，构建偶发产物）
- `electron/resources/backend/.env.bundled`（构建时从 `backend/.env` 生成，含密钥）

## 内置 Python 运行时（安装时不依赖 GitHub）

### 构建期

Step 0b 将 `python-build-standalone` 下载到：

```
electron/resources/python/cpython-3.12.13+20260510-{aarch64|x86_64}-apple-darwin-install_only.tar.gz
```

经 `extraResources` 打进 `.app/Contents/Resources/resources/python/`。

### 安装期（main.js）

| 函数 | 行为 |
|------|------|
| `materializePythonTarball()` | **优先**从 `RESOURCES/python/` copy 到 `APP_DATA/_python-dist.tar.gz` |
| | 无内置包时回退 GitHub 下载（3 次重试） |
| `downloadFile()` | 写 `.part` → rename；处理 301–308 重定向；校验体积 ≥1KB |
| `downloadPythonStandalone()` | 解压前校验 tar 存在且 >1MB，再 `tar -xzf` |
| `resolvePythonForSetup()` | 打包版 `!IS_DEV` **只用** portable Python 3.12，不用 Homebrew 3.13 |
| `autoCleanupBeforeInstall()` | 版本变更 / venv 损坏 / Node 缺失时清理 |

用户数据目录：`~/Library/Application Support/ai-media-agent/`

- `python-dist/` — 解压后的 Python 3.12
- `venv/` — pip 依赖与 Playwright
- `node/` — portable Node.js（Frontend 用）
- `.browsers/` — Playwright Chromium（由 Electron 注入 `PLAYWRIGHT_BROWSERS_PATH`）
- `.playwright_browser_stamp` — 已安装 Chromium 对应的 playwright 包版本
- `.setup_done` / `.app_version` — 安装状态

## Playwright 浏览器（macOS / Windows 共用）

桌面包的平台登录、浏览器 RPA 依赖 Chromium；路径**必须**与 backend 一致。

### Electron 侧（main.js）

| 函数 | 行为 |
|------|------|
| `playwrightChromiumExecutable()` | 检测 `APP_DATA/.browsers/chromium-*/chrome-*` |
| `playwrightBrowsersNeedInstall()` | Chromium 缺失或 stamp ≠ playwright 包版本 |
| `ensurePlaywrightBrowsersReady()` | **Mac**：`startAllServices()` 内后台安装；**Win**：`schedulePlaywrightInstall()` |
| `envForVenv()` / `spawnService` | 注入 `PLAYWRIGHT_BROWSERS_PATH: APP_DATA/.browsers` |

### Backend 侧（须同步进 bundle）

打包后 backend 从 APP_DATA 启动，须**尊重环境变量**，勿硬编码项目根 `.browsers`：

| 文件 | 要点 |
|------|------|
| `backend/main.py` `_apply_playwright_fix()` | 仅当 `PLAYWRIGHT_BROWSERS_PATH` 未设置时才写默认路径 |
| `backend/tools/connectors/browser_login.py` | `Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or …)` |
| `backend/tools/connectors/interactive_login.py` | 同上 |

修改上述文件后 **必须重打 DMG**，并确认 `syncAppResources` 已把新 backend 拷到 APP_DATA。

## 内置 Node.js 运行时（Frontend :3000）

打包版 macOS **禁止**依赖 Homebrew `node`：

| 函数 | 行为 |
|------|------|
| `ensureNodeRuntime()` | 打包版强制下载 Node 到 `APP_DATA/node/bin/node` |
| `isNodeRuntimeReady()` | 启动 Frontend 前检测 |
| `resolveNodeBin()` | 只认 `APP_DATA` 下 node 或 `.node_bin` 缓存 |
| `needsInstallSetup()` | Node 未就绪时重新走安装向导 |

安装向导若跳过 Node 下载会导致 Frontend 报 **「Node.js 未安装，请重新运行安装向导」**。

## 8 步构建流程

| 步骤 | 内容 |
|------|------|
| 0 | 品牌资源：`create_icons.py`（venv Python）+ **0b 内置 Python tarball** + validate |
| 1 | Go `directory-service` → `resources/bin/` |
| 2 | Rust `parser-service` → `resources/bin/` |
| 3 | Next.js standalone → `resources/web-standalone/` |
| 4 | Python backend → `resources/backend/`（含 `agents/`、`routers/` 等；**`.env.bundled`**；写入 `.bundle_revision`） |
| 5 | OCR → `resources/ocr-service/` |
| 6 | Install.app + 再次同步 brand-logo |
| 7 | electron-builder DMG |
| 8 | validate app-bundle（logo + Python in .app） |

## 环境变量与 `.env.bundled`（API Key 进包必读）

桌面包 **不会**直接把 `backend/.env` 打进 DMG 的 backend 源码目录（避免 `syncAppResources` 覆盖用户 LLM Key）。  
构建机上的 `backend/.env` 以 **只读 defaults** 形式进入安装包，启动时再合并到用户目录。

### 三份 `.env` 各是什么

| 路径 | 何时产生 | 作用 |
|------|----------|------|
| `backend/.env`（仓库/开发机） | 本地开发 | dev 与 **构建输入**；`build_*.sh` 复制为 `.env.bundled` |
| `.app/.../resources/backend/.env.bundled` | **构建 Step 4** | 安装包内只读 defaults（**不入 git**，见 `.gitignore`） |
| `APP_DATA/backend/.env` | 安装向导 / 合并 | **运行时唯一生效**；`buildEnv()` 注入 backend 进程 |

macOS：`~/Library/Application Support/ai-media-agent/backend/.env`  
Windows：`%APPDATA%/ai-media-agent/backend/.env`

### 构建期（`build_mac.sh` / `build_win.sh` Step 4）

```bash
for f in main.py requirements.txt .env.example; do …
# 若构建机存在 backend/.env → 复制为 resources/backend/.env.bundled
if [ -f "$ROOT_DIR/backend/.env" ]; then
  cp "$ROOT_DIR/backend/.env" "$BACKEND_RES/.env.bundled"
fi
```

- 复制的是 **整份** 构建机 `backend/.env`（含 `PEXELS_API_KEY`、`ZHIPUAI_API_KEY` 等）
- `.env.bundled` 经 `extraResources` 进 `.app`，**不**参与 `copyDir` 覆盖 `APP_DATA/backend/` 源码树
- `.gitignore`：`electron/resources/backend/.env.bundled`（构建产物，勿提交）

### 运行期（`main.js`）

| 函数 | 行为 |
|------|------|
| `ENV_FILE` | `path.join(APP_DATA, 'backend', '.env')` |
| `parseDotEnv()` / `buildEnv()` | spawn backend 时把 `ENV_FILE` 键值注入进程环境 |
| `mergeBundledEnvDefaults()` | 读 `RES_BACKEND/.env.bundled`，**仅补全** `ENV_FILE` 中缺失或为空的 Key |
| `updateEnvFile()` | 追加/更新单行 `KEY=value` |

调用时机：

- `runSetup()` 在 `syncAppResources()` 之后
- **每次** `startAllServices()` 在 `syncAppResources()` 之后（覆盖升级也能补新 Key）

合并规则（重要）：

- bundled 有、用户 `.env` **无或空** → **写入**
- 用户 `.env` **已有非空值** → **不覆盖**（保护用户自配 LLM Key）
- 新增功能 Key（如 `PEXELS_API_KEY`）发版后：用户重启 App 即可自动合并，**无需**重装向导

Backend 侧：`main.py` 的 `load_dotenv()` + Electron `buildEnv()` 双路径；桌面包以 **`buildEnv()` 注入为准**。

### 常见 Key 与功能

| 变量 | 功能 | 未配置时现象 |
|------|------|----------------|
| `ZHIPUAI_API_KEY` 等 | LLM 对话 | 安装向导 / 设置页提示缺 Key |
| `PEXELS_API_KEY` | 一键短视频 Pexels 素材 | `stock_keys.pexels: false`；日志 `PEXELS_API_KEY not configured` |
| `PIXABAY_API_KEY` | 一键短视频 Pixabay 素材 | 同上，回退 FFmpeg B-roll |
| `PLAYWRIGHT_BROWSERS_PATH` | 平台浏览器登录 | 由 Electron 注入，勿写进 `.env` |

### 发版前检查

1. 构建机 `backend/.env` 含所需 Key（或 CI 构建前写入）
2. 构建日志出现 `Bundled env defaults → …/.env.bundled`
3. 挂载 DMG 抽查：`.app/Contents/Resources/resources/backend/.env.bundled` 存在且含 `PEXELS_API_KEY=`
4. 安装后：`grep PEXELS ~/Library/Application\ Support/ai-media-agent/backend/.env`

### 故障：打包后 Pexels 仍无数据

| 根因 | 处理 |
|------|------|
| 构建机无 `backend/.env` 或无 `PEXELS_API_KEY` | 补 Key 后重跑 `./build_mac.sh` |
| 旧 DMG（无 `.env.bundled` / 无 `mergeBundledEnvDefaults`） | 换 ≥1.5.0 skill 对应的新包 |
| 用户 `.env` 已有空行 `PEXELS_API_KEY=` | 删掉空值或手填 Key；合并逻辑跳过非空才写 |
| 未重启 backend | 完全退出 App 再开，或托盘重启服务 |

**临时手动修复（不重打包）：**

```bash
# macOS
grep -q '^PEXELS_API_KEY=' ~/Library/Application\ Support/ai-media-agent/backend/.env \
  || echo 'PEXELS_API_KEY=你的key' >> ~/Library/Application\ Support/ai-media-agent/backend/.env
```

验证 API：

```bash
curl -s http://127.0.0.1:8000/tools/video/auto/config/voices | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('pexels:', d.get('stock_keys',{}).get('pexels'))"
# 期望 pexels: True
```

## Backend 双副本与同步（macOS / Windows 共用逻辑）

运行时 **不**直接读 `.app` 内 `resources/backend/`，而是复制到用户目录后启动：

```
.app/Contents/Resources/resources/backend/   ← 构建期 bundle（只读来源）
        ↓ syncAppResources()
~/Library/Application Support/ai-media-agent/backend/   ← uvicorn cwd（macOS）
%APPDATA%/ai-media-agent/backend/                      ← uvicorn cwd（Windows）
```

| 文件 | 含义 |
|------|------|
| `resources/backend/.bundle_revision` | 构建时写入，格式 `<version>-<git-short>`，如 `1.0.37-3e8a583` |
| `APP_DATA/backend/.resource_bundle_version` | 上次同步成功的 revision 戳 |
| `APP_DATA/backend/routers/agent_chat_router.py` | **哨兵文件**：缺失则强制 sync（LangGraph 统一入口） |

### `syncAppResources()` 触发条件（main.js）

同步 **当且仅当** 以下任一成立：

1. `.resource_bundle_version` ≠ `.bundle_revision`
2. `APP_DATA/backend/main.py` 不存在
3. `APP_DATA/backend/routers/agent_chat_router.py` 不存在（哨兵）

同步后：

- `copyDir(RES_BACKEND → BACKEND_DATA)` 覆盖 backend 源码
- 写入 `.resource_bundle_version`
- **`startAllServices()`** 若刚同步且 venv 就绪 → 调用 `installPythonDependencies()` 刷新 pip（新依赖如 `aiosqlite`）

> **历史坑**：旧版仅在安装向导 / Python repair 时 sync，正常启动不同步 → 新前端 + 旧 backend → `/agent/chat/stream` 404。

### build_mac.sh Step 4 复制范围

```bash
for d in agents core tools utils routers services admin; do
  cp -r backend/$d → resources/backend/
done
for f in main.py requirements.txt .env.example; do …
# 若存在 backend/.env → resources/backend/.env.bundled
echo "${PKG_VERSION}-${GIT_REV}" > resources/backend/.bundle_revision
```

**新增 backend 模块时**：若目录不在上述列表，必须改 `build_mac.sh` / `build_win.sh` 的 copy 循环，否则不会进包。

### LangGraph 统一聊天 API（≥1.0.37）

| 层级 | 路径 |
|------|------|
| 前端 | `POST /api/agent/chat/stream`（Next standalone） |
| 代理 | → `POST http://127.0.0.1:<backend_port>/agent/chat/stream` |
| 遗留 | `/multi-agent/stream` thin proxy 到新入口 |

Next 代理在 backend 404 时会 **fallback** 到 `/multi-agent/stream`（兼容未同步的旧 APP_DATA）。

打包后必验（backend 就绪后）：

```bash
# 应返回 200（SSE），不是 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8000/agent/chat/stream \
  -H "Content-Type: application/json" -d '{"input":"你好","mode":"direct"}'

# OpenAPI 应含新路由
curl -s http://127.0.0.1:8000/openapi.json | python3 -c \
  "import sys,json; print([p for p in json.load(sys.stdin)['paths'] if 'agent/chat' in p])"
# 期望: ['/agent/chat/invoke', '/agent/chat/stream']
```

APP_DATA 内人工检查：

```bash
ls ~/Library/Application\ Support/ai-media-agent/backend/routers/agent_chat_router.py
cat ~/Library/Application\ Support/ai-media-agent/backend/.resource_bundle_version
# 应与 .app 内 bundle_revision 一致
```

---

## 版本与 pip

- **版本号**：改 `electron/package.json` 的 `version`；`build_mac.sh` 同时写入 `resources/backend/.bundle_revision`
- **同版本热修复**：只改 backend/前端逻辑、不 bump version 时，仍会因 git hash 变化更新 `.bundle_revision`；依赖 `syncAppResources` 或用户手动删 `.resource_bundle_version`
- **pip**：macOS 用 `python -m pip`；backend sync 后自动 `installPythonDependencies`；检测 `~ip` 损坏包并重建 venv
- **Playwright**：安装向导内可跳过；**≥1.0.37** 每次 `startAllServices()` 会 `ensurePlaywrightBrowsersReady`（Mac 后台装，Win 另起线程）；stamp 文件 `.playwright_browser_stamp` 与 playwright 包版本对齐
- **LangGraph checkpoint 依赖**：`requirements.txt` 含 `langgraph-checkpoint-sqlite`、`aiosqlite`；backend sync 后 pip 会增量安装

详见 `electron/main.js`：`runSetup`、`autoCleanupBeforeInstall`、`installPythonDependencies`、`ensureNodeRuntime`、`ensurePlaywrightBrowsersReady`、`openDashboardWindow`。

## 签名与分发

| 模式 | 命令 | 其他 Mac 安装 |
|------|------|----------------|
| unsigned | `./build_mac.sh arm64 unsigned` | DMG 内 **Install AI Media Agent.app** 或 `dmg-install.sh` |
| signed | `./build_mac.sh arm64` + `mac-build.env` | 公证后可双击 |

- ad-hoc 签名：`electron/scripts/afterPack.js` + `disable-library-validation` entitlement
- **不要**恢复 DMG 内已删除的 `.command` 方式一（Gatekeeper 易报「已损坏」）

## 发版 commit 建议

```bash
git add electron/package.json electron/main.js electron/build_mac.sh electron/build_win.sh \
  electron/preload.js electron/renderer/ \
  backend/.env.example \
  electron/scripts/ electron/assets/logo.png web/public/brand-logo.png \
  .agent/skills/electron-mac-packaging/ .gitignore
git commit -m "fix(electron): … — bump vX.Y.Z"
git push origin HEAD
```

**勿提交：**

- `developer_id_private.key`、`developerID_application.cer`
- `electron/dist/`、`electron/resources/python/*.tar.gz`、`electron/resources/node/`
- `backend/published_content.json` 等运行时数据
- `electron/resources/web-standalone/public/public/`（构建误产物）

## 故障排查

| 现象 | 根因 | 处理 |
|------|------|------|
| Sidebar 仍是紫色火箭 | 无 Pillow 的 fallback | 用 `./venv/bin/python3 electron/scripts/create_icons.py` 重建；确认 brand-logo MD5 = logo.png |
| Sidebar logo 空白 | `/_next/image` 400 | `next.config.ts` standalone 加 `images.unoptimized: true` |
| `tar: Failed to open _python-dist.tar.gz` | GitHub 下载失败仍解压 | 用含**内置 Python** 的新 DMG（≥1.0.36）；或检查网络 |
| `Node.js 未安装` | 打包版用了 Homebrew node 但未缓存 | 最新 main.js 强制 `APP_DATA/node/`；删 `.setup_done` 重装 |
| `venv/bin/python3 ENOENT` | venv 损坏或版本升级 | 删 `APP_DATA/venv`，重装向导 |
| pip `~ip` / `bin/pip` 错误 | Homebrew Python 污染 venv | 打包版勿用 Homebrew；删 venv 重装 |
| validate: brand-logo placeholder | brand-logo ~4KB | 重新跑 create_icons（venv Python） |
| 「已损坏」 | unsigned 直接双击 .app | 用 Install.app 或 `dmg-install.sh` |
| **聊天 404** `Backend error: 404` on `/api/agent/chat/stream` | APP_DATA 仍是旧 backend（无 `/agent/chat/stream`） | 删 `.resource_bundle_version` 重启；或装含 sync 修复的新 DMG；验 `openapi.json` |
| 新 API 有、OpenAPI 无 | uvicorn 读旧 `main.py` | 查 APP_DATA/backend 与 bundle_revision 是否一致 |
| pip 缺 `aiosqlite` | backend 已 sync 但 venv 未刷新 | 重启触发 post-sync pip；或删 `venv` 重装 |
| **Bilibili/平台登录** `Executable doesn't exist` … `.browsers/chromium-*` | Playwright 未装或 pip 升级后浏览器 revision 不匹配 | 重启 App（≥1.0.37 含自动 ensure）；或手动见下方命令 |
| **Mac 仍跳 Safari 打开控制台** | 旧版 `openDashboard()` 用 `openExternal` | 用含 `openDashboardWindow()` 的 main.js 重打 DMG |
| **Mac 右上角按钮被挡** | Dashboard 用了 hidden titleBar + overlay | Dashboard 须 `frame: true`（Mac/Win 均已修复） |
| **聊天输入突然清空** | health poll 反复 `loadURL` 控制台 | 用含 `dashboardWindowNeedsReload` 的新 main.js |
| **启动无 splash / 无进度** | 缺少 `renderer/splash.*` 或未 asarUnpack | 确认 `asarUnpack: ["renderer/**/*"]` 后重打 |
| **Windows 启动只显示 CSS 源码** | `file://` + CSP 导致内联 `<style>` 当作文本渲染 | 使用含外置 `status.css`/`setup.css` 的新包；Windows 会自动内嵌打开控制台 |
| **Pexels/Pixabay 无素材** | `PEXELS_API_KEY` 未进 `APP_DATA/.env`；旧包无 `.env.bundled` | 重打含 merge 的新 DMG；或手动写入 APP_DATA `.env`；验 `/tools/video/auto/config/voices` |
| **stock_keys.pexels: false** | 同上或 Key 为空 | `grep PEXELS APP_DATA/backend/.env`；查 `.app/.../resources/backend/.env.bundled` |

### Windows 故障排查

| 现象 | 根因 | 处理 |
|------|------|------|
| Node 安装失败 / 无进度 | 未内置 runtime 或 tar 失败 | 确认 `resources/node/runtime/node.exe`；用新 zip |
| `10013` 绑定 8000 | 端口占用/保留 | 自动换端口；或 `netstat` + `taskkill` |
| Backend Error + Scheduler stopped | 绑定失败或旧进程误报 | 最新 main.js；看 `%APPDATA%/ai-media-agent/logs/backend.log` |
| 安装很慢 | 全量 pip + Playwright | 第二次启动应快；Playwright 后台装 |
| portable .exe 启动慢 | 每次解压 | 改发 **zip** 版 |
| NSIS 构建失败 | Mac 无 Wine | `./build_win.sh portable` 或装 Wine |
| **`wineserver: Can't check in server_mach_port`** | rcedit 经 Wine 写 exe 元数据失败 | ≥1.7.0 已自动跳过；旧版手动加 `--config.win.signAndEditExecutable=false`（见上节） |
| **安装包内无桌宠** | mingw 缺失，Step 5b 跳过 | `brew install mingw-w64` + `rustup target add x86_64-pc-windows-gnu` 后重跑 |
| **桌宠报「启动超时/检查 WebView2」但其实在跑** | detached 进程被误判失败 | 用 ≥1.7.0 含 `isPidAlive`/20s 超时的 main.js 重打 |
| **「打开陪伴室」跳系统浏览器** | 桌宠 exe 旧 / 非 Electron 托管 | 重编桌宠 exe（含 `open_app_console`）；确认 `startDesktopPetConsoleWatcher` 在运行 |
| **语音识别失败 / TypeError** | 模型名错或传了 `response_format` | 用 `glm-asr-2512` + 去掉 `response_format`，读 `choices[0].message.content` |
| **语音识别在打包版失败（webm 未转码）** | PATH 无系统 ffmpeg | `companion_pet_router.py` 回退 `imageio_ffmpeg`（≥1.7.0） |
| icon.ico 报错 | 256×256 非首帧 | 重新跑 `create_icons.py` |

### macOS 安装冒烟命令

```bash
# 覆盖升级：强制 backend 重同步（可选）
rm -f ~/Library/Application\ Support/ai-media-agent/.resource_bundle_version

# 可选：干净重装（会清 venv）
# rm -f ~/Library/Application\ Support/ai-media-agent/.setup_done

# 安装后验证 — 基础服务
curl -sI http://127.0.0.1:3000/brand-logo.png | head -1   # HTTP/1.1 200
curl -sI http://127.0.0.1:8000/health | head -1             # HTTP/1.1 200
ls ~/Library/Application\ Support/ai-media-agent/node/bin/node
ls ~/Library/Application\ Support/ai-media-agent/python-dist/bin/python3

# LangGraph 统一入口（≥1.0.37）
curl -s -o /dev/null -w "agent-chat:%{http_code}\n" -X POST http://127.0.0.1:8000/agent/chat/stream \
  -H "Content-Type: application/json" -d '{"input":"ping","mode":"direct"}'
# 期望 agent-chat:200

# 内嵌控制台（手动：托盘 → Open Dashboard；自动：Frontend Running 后应弹出窗口，非 Safari）
# 若仍跳浏览器 → DMG 内 main.js 过旧

# Playwright Chromium（交互式登录 / 浏览器 RPA）
CHROME="$HOME/Library/Application Support/ai-media-agent/.browsers/chromium-"*/chrome-mac-arm64/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing
test -x "$CHROME" && echo "playwright:ok" || echo "playwright:missing"
# 若 missing，手动安装：
# PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Application Support/ai-media-agent/.browsers" \
#   "$HOME/Library/Application Support/ai-media-agent/venv/bin/python" -m playwright install chromium

# APP_DATA backend 与 bundle 一致
cat ~/Library/Application\ Support/ai-media-agent/backend/.resource_bundle_version
# 应与 DMG 内 resources/backend/.bundle_revision 相同（若可挂载 DMG 查看）
test -f ~/Library/Application\ Support/ai-media-agent/backend/routers/agent_chat_router.py && echo "langgraph router ok"

# 一键短视频 / Pexels（需 backend/.env 在构建时打进 .env.bundled）
curl -s http://127.0.0.1:8000/tools/video/auto/config/voices | python3 -c \
  "import sys,json; sk=json.load(sys.stdin).get('stock_keys',{}); print('pexels:', sk.get('pexels'), 'pixabay:', sk.get('pixabay'))"
grep -E '^PEXELS_API_KEY=' ~/Library/Application\ Support/ai-media-agent/backend/.env || echo "PEXELS missing in APP_DATA .env"
```

### Windows 安装冒烟

```powershell
# 安装向导完成后
curl -sI http://127.0.0.1:8000/health
curl -sI http://127.0.0.1:3000/
dir "$env:APPDATA\ai-media-agent\node\node.exe"
type "$env:APPDATA\ai-media-agent\.backend_port"   # 若非 8000 说明发生过端口切换
```

## 附加资源

- 详细检查表：[checklist.md](checklist.md)
- macOS 安装说明：`electron/resources/安装说明.txt`
- 项目文档：`docs/WINDOWS_DEPLOYMENT.md`
- **iOS 全屏客户端**（连接局域网/云端 `:3000`，非本地 Python）：`mobile/README.md` + `mobile/build_ios.sh`
- **桌宠 Sidecar（Tauri 2）**（连接本机 FastAPI `:8000`，依赖 Electron/`start_local.sh` 已启动 backend）：
  - 工程：`desktop-pet/`
  - 文档：`docs/DESKTOP_PET.md`
  - 开发：`cd desktop-pet && npm install && npm run tauri:dev`
  - 构建：`cd desktop-pet && npm run tauri:build` → `src-tauri/target/release/bundle/macos/*.app`
  - **DMG 可选附带**：将 `desktop-pet.app` 复制到 `electron/dist/mac-arm64/AI Media Agent.app/Contents/Resources/desktop-pet.app`，或在 DMG 根目录增加「桌宠」快捷方式；Electron 菜单可 `shell.openPath` 启动
  - **不打包** `.env` / API Key；桌宠只连 `:8000`，密钥由 backend APP_DATA `.env` + `.env.bundled` 提供
  - 本地闲聊可选 Ollama（`OLLAMA_BASE_URL` / `OLLAMA_MODEL` 见 `backend/.env.example`）

## mac-build.env（签名 + 公证，可选）

有 **Developer ID Application** 证书时，在 `electron/mac-build.env`（gitignore）配置：

```bash
APPLE_ID=your@email.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
# 可选：APPLE_TEAM_ID=XXXXXXXXXX
```

然后执行 `cd electron && ./build_mac.sh arm64`（无 `unsigned`）。`build_mac.sh` 会：

1. 用 Keychain 中第一个 `Developer ID Application:` 身份签名 Install.app
2. electron-builder 签名 `.app` + DMG
3. 若 `APPLE_ID` 有效 → `scripts/notarize.js` 公证

无效占位凭据会被自动 unset，避免 electron-builder 公证步骤失败。
