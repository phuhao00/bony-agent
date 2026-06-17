# AI Media Agent v1.0.36 安装指南

面向两个桌面包，不含源码部署。

| 平台 | 文件 | 适用 |
|------|------|------|
| macOS | `AI Media Agent-1.0.36-arm64.dmg` | Apple Silicon（M 系列），**不支持 Intel Mac** |
| Windows | `AI Media Agent-1.0.36-win.zip` | Windows 10 / 11 **64 位** |

包内已含 Python 3.12、Node.js、后端与前端资源，**无需**另装 Python / Node.js。  
首次启动需联网（装依赖 + Playwright 浏览器），约 **3–8 分钟**；建议内存 ≥ 8 GB、磁盘 ≥ 5 GB。

---

## macOS（DMG）

### 1. 安装到「应用程序」

1. 双击 `AI Media Agent-1.0.36-arm64.dmg`
2. **勿**把 `AI Media Agent.app` 直接拖进「应用程序」（未签名包易报「已损坏」）
3. 任选一种安装方式：

| 方式 | 操作 |
|------|------|
| **A · 推荐** | 双击 **`Install AI Media Agent.app`** → 输入 Mac 密码 → 自动装到「应用程序」并启动 |
| **B · 终端** | 打开「终端」，粘贴回车：<br>`bash "$(ls -d /Volumes/AI\ Media\ Agent* 2>/dev/null \| tail -1)/dmg-install.sh"` |

无法打开安装器时：`Control + 点击` → **打开** → **打开**（仅首次）。

### 2. 首次放行（Gatekeeper）

仍被拦截时：

1. 「应用程序」→ **AI Media Agent** → `Control + 点击` → **打开** → **打开**
2. 或终端执行：`xattr -rd com.apple.quarantine "/Applications/AI Media Agent.app"`

### 3. 安装向导 → 见 [首次启动](#首次启动共用)

---

## Windows（ZIP）

### 1. 解压并运行

1. 右键 `AI Media Agent-1.0.36-win.zip` → **全部解压缩…**
2. 解压到固定目录，如 `C:\AI Media Agent\`（**不要**在 ZIP 内直接运行）
3. 双击 **`AI Media Agent.exe`**

SmartScreen 提示「未知发布者」：**更多信息** → **仍要运行**（未签名，属正常）。

### 2. 安装向导 → 见 [首次启动](#首次启动共用)

---

## 首次启动（共用）

弹出安装向导后按顺序操作：

| # | 界面 | 你要做的 |
|---|------|----------|
| 1 | 欢迎 | 点 **开始自动安装** |
| 2 | 正在自动安装 | 等待完成（复制资源 → Python 3.12 → venv → pip 依赖 → Playwright Chromium → Node.js） |
| 3 | 配置 AI 模型 | 选供应商、填 **API Key** → **保存并启动**；或 **稍后配置**（使用前必须补 Key） |
| 4 | 安装完成 | 点 **打开控制台**，或从托盘 / 菜单栏进入 |

**自动启动的服务**

| 服务 | 默认端口 | 说明 |
|------|----------|------|
| Frontend | 3000 | 浏览器操作界面 |
| Backend | 8000 | API；被占用时自动改 8010 / 8020 … |
| OCR / Parser / Directory | 50051–50053 | 可选；失败不影响对话与生成 |

**访问地址**

- 界面：http://localhost:3000  
- API 文档：http://localhost:8000/docs  
- 实际 Backend 端口：托盘 → **Service Status** 查看  

---

## API Key

**向导内填（推荐）** 或 **托盘 → Edit Config (.env)**，保存后 **Restart Services**。

| 供应商 | `LLM_PROVIDER` | 环境变量 | 申请 |
|--------|----------------|----------|------|
| 通义千问 | `alibaba` | `ALIBABA_API_KEY` 或 `DASHSCOPE_API_KEY` | https://dashscope.console.aliyun.com/apiKey |
| 智谱 | `zhipu` | `ZHIPUAI_API_KEY` | https://open.bigmodel.cn |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| Gemini | `google` | `GOOGLE_API_KEY` | https://aistudio.google.com/apikey |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | https://platform.deepseek.com |

示例（通义）：

```env
LLM_PROVIDER=alibaba
LLM_MODEL=qwen-max
ALIBABA_API_KEY=sk-你的密钥
```

---

## 日常使用

通过 **菜单栏**（macOS）或 **系统托盘**（Windows）操作：

| 菜单项 | 作用 |
|--------|------|
| Open Dashboard | 打开 http://localhost:3000 |
| Service Status | 查看各服务是否 running |
| Restart Services | 改 `.env` 后重启 |
| Stop Services | 停止服务 |
| Edit Config (.env) | 编辑 API Key |
| Open Logs Folder | 打开日志 |
| Quit | 退出并停服 |

---

## 数据路径

用户数据在安装包外，换包 / 升级一般**不会丢**。

| 内容 | macOS | Windows |
|------|-------|---------|
| 根目录 | `~/Library/Application Support/ai-media-agent/` | `%APPDATA%\ai-media-agent\` |
| 配置 | `…/backend/.env` | `…\backend\.env` |
| 日志 | `…/logs/` | `…\logs\` |
| 生成文件 | `…/storage/` | `…\storage\` |
| 浏览器组件 | `…/.browsers/` | `…\.browsers\` |

Windows 快速打开：资源管理器地址栏输入 `%APPDATA%\ai-media-agent`。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| Mac「已损坏，无法打开」 | 用 **Install AI Media Agent.app** 重装，或执行 `xattr -rd com.apple.quarantine "/Applications/AI Media Agent.app"` |
| 安装向导失败 / 卡住 | 查网络 → 完全退出再开（会自动清坏环境重试）→ 看 `logs/` |
| Win 双击 exe 无反应 | 确认已解压 → 关杀毒拦截 → 看 `logs\` |
| 页面打不开 | **Service Status** 看 Backend / Frontend 是否 running → 查 `.env` Key → **Restart Services** → 关占用 3000 / 8000 端口的程序 |
| AI 无响应 / Key 报错 | `.env` 去空格 → **Restart Services** → 查供应商余额 |
| 社媒登录失败 | 退出 → 删 `.browsers` 文件夹 → 重开应用重装浏览器 |
| 8000 被占用 | 应用会自动换端口；以 **Service Status** 显示为准 |

---

## 卸载

1. **Quit** 退出应用  
2. 删安装文件：Mac 删 `/Applications/AI Media Agent.app`；Win 删解压目录  
3. 删用户数据（可选）：Mac `rm -rf ~/Library/Application\ Support/ai-media-agent`；Win 删 `%APPDATA%\ai-media-agent`

---

v1.0.36 · 2026-05-25
