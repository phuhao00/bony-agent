# 🤖 AI Media Agent — 全链路内容生产与分发数字员工

> 一站式 AI 驱动的内容自动化平台：文案 → 图片/视频/音乐/短剧生成 → 自动定时发布到全平台矩阵。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![Version](https://img.shields.io/badge/Version-v1.0.36-green.svg)](docs/CHANGELOG.md)

---

## ✨ 核心亮点

| 功能                    | 说明                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| 🤖 多模型 AI 对话       | 支持 GLM-4、GPT-4o、Claude 3.5、Gemini 等，可在界面切换，对话记录模型标签                        |
| 🎨 AI 图片生成          | CogView-3-Plus、即梦 4.0、Gemini Image、OpenRouter 多后端                                        |
| 🖼️ AI 图片编辑         | 11 种编辑模式：重绘、去水印、扩图、参考图编辑、Inpaint、局部替换、高清放大、超分辨率             |
| 🎬 AI 视频生成          | CogVideoX、豆包 SeaDance、图生视频、故事板混剪、长视频、OpenCut 专业剪辑                        |
| 🎵 AI 音乐生成          | 文本生成音乐、歌词谱曲、参考风格迁移、视频 BGM 一键配乐                                          |
| 🎭 AI 短剧制作          | 一句话 → 剧本 → 分镜 → 场景生成 → 配音字幕 → 成片组装全流水线                                  |
| 🎙️ AI 播客制作          | 策划 → 脚本 → 封面 → TTS 配音 → 多平台发布完整工作流                                            |
| 🎞️ 一键短视频流水线     | MoneyPrinterTurbo 风格：话题 → 文案 → Pexels 素材 → 配音字幕 → 成片                             |
| 🐴 HappyHorse 视频工坊  | 阿里 DashScope 集成，专业视频生成与五阶精准图层处理                                              |
| 🖨️ 图片转 PSD           | LayerD AI 智能分层：图片/设计稿 → Photoshop 可编辑多图层 PSD 文件                               |
| ✍️ 文案/软文            | 多平台风格适配（小红书/抖音/微博/知乎），一键生成 + 标题变体                                    |
| 📋 故事板生成           | 分镜脚本 → AI 配图 → 自动拼接视频，全流程自动化                                                  |
| 🔥 游戏热点大盘         | 集成 Steam（畅销/新品/特惠）、Epic（免费获取）、TapTap（热门），无头抓取全网实时热点             |
| ⏰ 24h 定时发布         | APScheduler 驱动，Cron/间隔双模式，按时结合全网热点自动生成并发布到指定平台                     |
| 📢 平台自动发布         | Playwright 浏览器自动化，支持 **14** 个平台：小红书、抖音、B站、微博、快手、视频号、YouTube、Twitter/X、TikTok、Discord、飞书等 |
| 🧠 RAG 知识库           | 上传 PDF/Word/MD 构建私有知识库，AI 对话自动检索，一键优化内容                                  |
| 🔍 内容安全审核         | 内置风险词检测 + AI 二次审核                                                                     |
| 🤝 多 Agent 协作        | LangGraph Supervisor 编排，**27+** 专业 Agent 协同工作                                           |
| 🌐 Computer Use         | Playwright 浏览器 GUI 自动化，LLM 规划执行网页操作                                              |
| 🦞 OpenClaw             | 分布式多 Agent 协作网络，支持节点发现与群聊                                                      |
| 🧑‍💻 AI 伙伴 + 桌面宠物 | 可交互数字人 companion + 5 款桌面宠物角色（Kitty/熊二/GG Bond/3D Peppa 等），支持语音对话         |
| 🏭 爆款流水线           | 一键式内容生产流水线，从选题到发布全流程                                                         |
| 🧠 My context           | 后端拼装的知识图谱可视化 + 上下文记忆（Memory）检索与管理                                       |
| 🔌 MCP 协议             | Model Context Protocol 客户端，无缝连接外部工具服务器                                            |
| 💻 Figma 集成           | Figma API + Plugin 工具，设计与 AI 内容生产联动                                                  |

---

## 🚀 快速启动

> 桌面安装包说明（v1.0.36 DMG / ZIP）：[`docs/INSTALLATION.md`](docs/INSTALLATION.md)

### 环境要求

- **Node.js** 18+（推荐 20）
- **Python** 3.10+
- 至少一个 AI 大模型的 API Key（见下方配置）

### 一键启动

```bash
# 克隆项目
git clone https://github.com/phuhao00/ai-media-agent.git
cd ai-media-agent

# 启动（自动安装依赖 + 启动前后端）
./start_local.sh
```

启动完成后访问：

- **操作界面**：http://localhost:3000
- **API 文档**：http://localhost:8000/docs
- **后端日志**：`tail -f logs/agent.log`

### 配置 API Key

编辑 `backend/.env`（首次启动会自动生成模板）：

```env
# 选择至少一个（推荐智谱或 OpenRouter）
ZHIPUAI_API_KEY=your_key_here        # 智谱 GLM-4 / CogView / CogVideoX
OPENROUTER_API_KEY=your_key_here     # 接入 GPT-4o / Claude / Gemini 等 100+ 模型
GOOGLE_API_KEY=your_key_here         # Gemini 系列模型
DEEPSEEK_API_KEY=your_key_here       # DeepSeek
BYTEDANCE_API_KEY=your_key_here      # 字节豆包

# 媒体生成
JIMENG_ACCESS_KEY=your_key_here      # 即梦 AI 图片/视频生成
JIMENG_SECRET_KEY=your_key_here
ARK_API_KEY=your_key_here            # 豆包 SeaDance 视频生成
ALIBABA_API_KEY=your_key_here        # 通义/DashScope（HappyHorse）

# 短视频素材（可选）
PEXELS_API_KEY=your_key_here         # Pexels 免版权素材库（自动短视频流水线）
```

### Docker 部署

```bash
docker compose up -d --build
```

---

## 🎨 媒体生成矩阵

### 图片生成与编辑

| 功能 | 页面路径 | 说明 |
|------|----------|------|
| 文生图 | `/media/image` | CogView / 即梦 / Gemini Image / OpenRouter 多后端 |
| 图片编辑 | `/media/image-edit` | 11 种模式：重绘、去水印、扩图、参考图、Inpaint、超分等 |
| 高清放大 | `/media/image-hd` | AI 高清放大与细节增强 |
| 图片超分 | `/media/image-sr` | 超分辨率处理 |
| 图片转 PSD | `/media/image-to-psd` | LayerD 五阶精准分层，生成可编辑 Photoshop 文件 |

### 视频生成与剪辑

| 功能 | 页面路径 | 说明 |
|------|----------|------|
| 文生视频 | `/media/video` | CogVideoX、豆包 SeaDance |
| 图生视频 | `/media/video` | 上传图片生成视频 |
| 故事板 | `/media/storyboard` | 分镜 → AI 配图 → 拼接视频 |
| 长视频 | `/media/long-video` | 多分镜规划 + Wan 分段生成 + 成片拼接 |
| 自动短视频 | `/media/auto-video` | 一键流水线：话题 → 文案 → Pexels 素材 → 配音 → 成片 |
| HappyHorse | `/media/happyhorse` | DashScope 集成专业视频工作室 |
| OpenCut | `/media/opencut` | OpenCut 风格专业剪辑 |
| OpenCut Pro | `/media/opencut-pro` | 多轨道、转场、画中画、字幕、滤镜 |
| 短剧生成 | `/media/short-drama` | AI 短剧全流水线：剧本→分镜→场景→配音→成片 |

### 音频内容

| 功能 | 页面路径 | 说明 |
|------|----------|------|
| 音乐生成 | `/media/music` | 文本/歌词 → 音乐，风格迁移，视频 BGM |
| 播客制作 | `/create/podcast` | 策划 → 脚本 → 封面 → TTS 配音 → 发布 |

---

## ⏰ 定时发布功能

在侧边栏点击 **⏰ 定时发布** 进入管理页。

**支持的调度方式：**

- **Cron 表达式**：`0 9 * * *`（每天早9点）、`0 */6 * * *`（每6小时）等
- **固定间隔**：每 N 小时执行一次

**快捷预设：**

- 每天早9点发图 → 自动生成 AI 图片发布到选定平台
- 每6小时发图
- 每天发视频
- 每周一软文

**执行步骤：**

1. 调度器触发 → AI 生成内容（图片/视频/软文）
2. 使用真实平台连接器发布（需在「平台管理」配置 Cookie/Token）
3. 执行日志记录结果（成功/失败/URL）

**API 端点（可外部调用）：**

| 方法     | 路径                       | 说明             |
| -------- | -------------------------- | ---------------- |
| `GET`    | `/scheduler/jobs`          | 获取所有定时任务 |
| `POST`   | `/scheduler/jobs`          | 创建任务         |
| `PUT`    | `/scheduler/jobs/{id}`     | 更新任务         |
| `DELETE` | `/scheduler/jobs/{id}`     | 删除任务         |
| `POST`   | `/scheduler/jobs/{id}/run` | 立即执行         |
| `GET`    | `/scheduler/logs`          | 获取执行日志     |

---

## 📢 平台发布配置

在侧边栏 **⚙️ 模型设置 → 平台管理** 中配置各平台凭证：

| 平台 | 认证方式 | 获取方法 | 状态 |
|------|----------|----------|------|
| **小红书** | Cookie（`a1` 等字段） | 浏览器开发者工具抓取 | ✅ 稳定 |
| **抖音** | Cookie | 同上 | ✅ 稳定 |
| **B站** | Cookie（`SESSDATA` 等） | 同上 | ✅ 稳定 |
| **微博** | Cookie | 同上 | ✅ 稳定 |
| **快手** | Cookie | 同上 | ✅ 稳定 |
| **微信视频号** | Cookie | 同上 | ✅ 稳定 |
| **YouTube** | OAuth2 Token | Google Cloud Console | ✅ 稳定 |
| **Twitter/X** | API Token | developer.twitter.com | ✅ 稳定 |
| **TikTok** | Cookie/Session | 同上 | ✅ 稳定 |
| **Discord** | Bot Token | Discord Developer Portal | ✅ 稳定 |
| **飞书** | Bot/App Token | 飞书开放平台 | ✅ 稳定 |

> 配置后点击「测试连接」验证是否生效。完整平台列表与连接状态 → [`docs/FEATURE_LIST.md`](docs/FEATURE_LIST.md)

---

## 🤖 Agent 体系（27+ 专业 Agent）

| Agent | 职责 | 核心能力 |
|-------|------|----------|
| `media_agent` | 多媒体创作核心 | 图/视频生成、发布、记忆、RAG |
| `creative_agent` | 全能媒体创作助理 | 图/视频/脚本/文案/审核/联网搜索 |
| `image_edit_agent` | 图片编辑专家 | 11 种编辑模式：重绘/去水印/扩图/参考图/Inpaint |
| `video_editor_agent` | 视频剪辑 | 合并、裁剪、转场、AI 混剪 |
| `opencut_agent` | OpenCut 专业剪辑 | 多轨道、转场、画中画、字幕、滤镜 |
| `long_video_agent` | 长视频工坊 | 多分镜规划 + Wan 分段生成 + 成片拼接 |
| `music_agent` | AI 音乐制作 | 文本/歌词生成音乐、风格迁移、视频 BGM |
| `podcast_agent` | AI 播客制作 | 策划、脚本、封面、TTS 配音与发布 |
| `short_drama_agent` | AI 短剧导演 | 剧本、分镜、场景生成、配音字幕与成片组装 |
| `copywriter_agent` | 文案创作 | 多平台适配软文、种草文、标题变体 |
| `script_writer_agent` | 视频脚本 | 结构化脚本、差异化版本 |
| `trend_analyst_agent` | 热点分析 | Steam/Epic/TapTap/社媒趋势追踪 |
| `reviewer_agent` | 内容审查 | 合规、趋势洞察、文案润色 |
| `system_assistant` | 系统维护 | 软件安装/卸载、网络修复、环境配置 |
| `desktop_operator_agent` | 桌面操作 | 本机软件 CLI/GUI 自动化 |
| `programmer_agent` | 编程助手 | Git/SSH、中间件运维、测试与代码工具 |
| `product_manager_agent` | 产品经理 | 市场洞察、产品创意、PM 方法论 |
| `legal_agent` | 法律顾问 | 合同审查、合规体检、法规政策分析 |
| `ad_campaign_agent` | 广告投放 | 投放策略、创意文案、受众定向 |
| `business_partnership_agent` | 商务合作 | outreach、方案撰写、BD pipeline |
| `procurement_agent` | 采购助手 | 供应商评估、RFQ 起草、成本优化 |
| `game_art_agent` | 游戏美术 | 视觉风格、角色场景 Brief、UI 规范 |
| `game_design_agent` | 游戏策划 | 概念案、核心循环、系统设计、关卡规划 |
| `code_analyst_agent` | 代码分析 | 符号搜索、调用关系、架构建议 |
| `architect_agent` | 项目架构师 | 目录结构、命名规范、代码质量 |
| `lobster_agent` | OpenClaw 分布式 | 热点收集 → AI 克隆内容 → 多平台发布 |
| `image_hd_agent` | 高清图片 | 高清放大与图像细节增强 |

---

## 🛠️ 技术栈

| 层           | 技术                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| 前端         | Next.js 16 (App Router)，Tailwind CSS 4，**40+ 页面**；明暗主题统一走 CSS 变量       |
| 后端         | FastAPI, Python 3.10+                                                                 |
| AI 编排      | LangChain, LangGraph（Supervisor 多 Agent + Plan-Execute）                            |
| 向量检索     | LlamaIndex（ChromaDB / 本地 JSON fallback）                                           |
| 定时调度     | APScheduler                                                                           |
| 浏览器自动化 | Microsoft Playwright                                                                  |
| 高并发引擎   | Go 1.22+ + gRPC + Worker Pool（目录检索、批量抓取）                                  |
| 安全引擎     | Rust + Tokio + Tonic（文档/视频解析、OCR、加密）                                     |
| 跨服务通信   | gRPC + Protocol Buffers + mTLS                                                        |
| 媒体处理     | FFmpeg（via imageio-ffmpeg 自动捆绑）                                                 |
| Figma 集成   | Figma REST API + Plugin Bridge                                                        |
| 桌面应用     | Electron + Tauri Sidecar（Mac DMG / Windows ZIP）                                    |
| 持久化       | JSON 文件 + ChromaDB + SQLite（auth.db）                                              |

---

## 📂 项目结构

```
ai-media-agent/
├── backend/                        # FastAPI 后端
│   ├── main.py                     # 主入口，所有 API 端点
│   ├── agents/                     # LangGraph 多 Agent 编排（27+）
│   │   ├── orchestrator.py         # Supervisor 多 Agent 调度
│   │   ├── router.py               # 意图路由（关键词 + LLM 兜底）
│   │   ├── music_agent.py          # 🎵 AI 音乐制作 Agent
│   │   ├── podcast_agent.py        # 🎙️ AI 播客制作 Agent
│   │   ├── short_drama_agent.py    # 🎭 AI 短剧导演 Agent
│   │   ├── opencut_agent.py        # ✂️ OpenCut 专业剪辑 Agent
│   │   ├── long_video_agent.py     # 📽️ 长视频工坊 Agent
│   │   ├── image_edit_agent.py     # 🖼️ 图片编辑 Agent（11 种模式）
│   │   ├── image_hd_agent.py       # 🔍 高清放大 Agent
│   │   ├── lobster_bot.py          # 🦞 OpenClaw 分布式 Agent
│   │   ├── copywriter_agent.py     # ✍️ 文案创作 Agent
│   │   ├── script_writer_agent.py  # 📋 脚本生成 Agent
│   │   └── registry.py             # Agent 注册中心
│   ├── tools/                      # 功能工具库
│   │   ├── image_tools.py          # AI 图片生成
│   │   ├── image_edit_tools.py     # 图片编辑（11 种模式）
│   │   ├── video_tools.py          # AI 视频生成
│   │   ├── long_video_tools.py     # 长视频生成
│   │   ├── music_tools.py          # 🎵 音乐生成
│   │   ├── podcast_tools.py        # 🎙️ 播客制作
│   │   ├── short_drama_tools.py    # 🎭 短剧制作
│   │   ├── copywriting_tools.py    # 软文/文案生成
│   │   ├── publisher_tools.py      # 发布工具
│   │   ├── gaming_trending.py      # 游戏热点抓取（Steam/Epic/TapTap）
│   │   ├── social_trending.py      # 社媒热点
│   │   ├── ai_trending.py          # AI 资讯热点
│   │   ├── financial_news_tools.py # 金融资讯工具
│   │   ├── web_search_tools.py     # 联网搜索工具
│   │   ├── weather_tools.py        # 天气工具
│   │   ├── figma_api_tools.py      # Figma API 集成
│   │   ├── figma_plugin_tools.py   # Figma 插件工具
│   │   ├── logo_motion_tools.py    # Logo 动效工具
│   │   ├── remix_tools.py          # AI 混剪
│   │   ├── opencut_tools.py        # OpenCut 剪辑工具
│   │   ├── material_tools.py       # 素材管理工具
│   │   ├── psd_element_extract.py  # PSD 元素提取
│   │   ├── code_analysis_tools.py  # 代码分析工具
│   │   └── connectors/             # 平台连接器（14+ 平台）
│   ├── services/
│   │   ├── scheduler.py            # APScheduler 定时发布
│   │   └── computer_use_service.py # Computer Use 浏览器自动化
│   └── core/                       # LLM 供应商路由 & 能力注册
├── web/                            # Next.js 前端（40+ 页面）
│   ├── app/
│   │   ├── page.tsx                # AI 对话主页
│   │   ├── workbench/              # 🏗️ 工作台（工具聚合入口）
│   │   ├── companion/              # 🧑‍💻 AI 伙伴（数字人）
│   │   ├── pipeline/               # 🏭 爆款流水线
│   │   ├── scheduler/              # ⏰ 定时发布管理
│   │   ├── trending/               # 🔥 游戏热点看板
│   │   ├── create/                 # 文章 / 软文 / 脚本 / 播客创作
│   │   ├── media/                  # 图片 / 视频 / 音乐 / 短剧等生成
│   │   │   ├── image/              # 文生图
│   │   │   ├── image-edit/         # 图片编辑（11 种模式）
│   │   │   ├── image-hd/           # 高清放大
│   │   │   ├── image-sr/           # 图片超分
│   │   │   ├── image-to-psd/       # 图片转 PSD（LayerD）
│   │   │   ├── video/              # AI 视频生成
│   │   │   ├── storyboard/         # 故事板
│   │   │   ├── long-video/         # 长视频
│   │   │   ├── auto-video/         # 一键短视频流水线
│   │   │   ├── happyhorse/         # HappyHorse 视频工作室
│   │   │   ├── opencut/            # OpenCut 剪辑
│   │   │   ├── opencut-pro/        # OpenCut 专业版
│   │   │   ├── short-drama/        # 短剧生成
│   │   │   └── music/              # AI 音乐生成
│   │   ├── labs/                   # 🧪 专业助手实验室（10+ 垂直助手）
│   │   ├── tasks/                  # 📋 任务管理中心
│   │   ├── creative-apps/          # 🎨 创意应用入口
│   │   ├── computer-use/           # 🌐 Computer Use
│   │   ├── hermes-agent/           # Hermes Agent
│   │   ├── lark-cli/               # Lark CLI 助手
│   │   ├── platforms/              # 平台管理
│   │   ├── knowledge/              # RAG 知识库管理
│   │   ├── history/                # 历史记录
│   │   ├── moderation/             # 内容审核
│   │   ├── openclaw/               # 🦞 OpenClaw
│   │   ├── ai-news/                # 📰 AI 资讯日报
│   │   ├── financial-news/         # 💹 金融资讯
│   │   ├── workflows/              # 可视化工作流
│   │   ├── architecture/           # 项目架构图
│   │   └── settings/               # 设置中心（capabilities / context / my-computer 等）
│   └── components/                 # 共享组件
├── .agent/skills/                  # 54+ 专业数字员工技能定义
├── backend_massive_concurrent/     # Go 高并发引擎（gRPC :50053）
├── backend_safety/                 # Rust 安全引擎（gRPC :50052）
├── storage/                        # 本地持久化存储
│   ├── outputs/                    # 生成的媒体文件
│   ├── scheduler/                  # 定时任务配置和执行日志
│   ├── traces/                     # Agent 执行追踪
│   ├── memory/                     # Agent 记忆
│   └── trending/                   # 热点数据缓存
├── docs/                           # 技术文档（50+ 篇）
├── proto/                          # Protocol Buffers 定义
├── start_local.sh                  # 一键本地启动脚本
└── docker-compose.yml              # Docker 部署配置
```

---

## 🧠 AI 技能体系（`.agent/skills/`）

内置 **54+** 专业技能，覆盖平台运营、内容创作、数据智能、文档办公、设计前端、技术工程、基础设施 7 大类别，每个技能都有独立的 `SKILL.md` 定义：

| 技能 | 类别 | 描述 |
|------|------|------|
| `xiaohongshu-operator` | 平台运营 | 小红书种草爆文策略 |
| `douyin-operator` | 平台运营 | 抖音前3秒黄金钩子 + 完播优化 |
| `bilibili-operator` | 平台运营 | B站风格文案与投稿管理 |
| `youtube-operator` | 平台运营 | YouTube SEO 标题 + 全球化运营 |
| `platform-publisher` | 平台运营 | 多平台发布策略统筹与适配 |
| `script-writer` | 内容创作 | AI 视频脚本生成 |
| `copywriter` | 内容创作 | 多平台软文一键生成 |
| `video-editor` | 内容创作 | AI 混剪指令编排 |
| `media-expert` | 内容创作 | 媒体制作专业指导（分辨率、编码、格式） |
| `data-analyst` | 数据智能 | 播放量/完播率/互动率拆解与优化 |
| `game-trend-analyst` | 数据智能 | Steam/Epic/TapTap 热点提取与选题规划 |
| `last30days` | 数据智能 | 近30天多源调研（Reddit/X/YouTube/HN/Polymarket 等） |
| `seo-specialist` | 数据智能 | 平台长尾关键词挖掘与推荐权重优化 |
| `doc-writer` | 文档办公 | 技术文档/产品文档撰写 |
| `docx` | 文档办公 | Word 文档生成与排版 |
| `xlsx` | 文档办公 | Excel 表格生成与数据分析 |
| `pptx` | 文档办公 | PPT 演示文稿生成 |
| `pdf` | 文档办公 | PDF 文档生成与处理 |
| `internal-comms` | 文档办公 | 企业内部沟通文案（通知、周报、会议纪要） |
| `rag-expert` | 文档办公 | 知识库 RAG 全链路管理 |
| `frontend-design` | 设计前端 | Web 前端 UI 设计与组件建议 |
| `canvas-design` | 设计前端 | Canvas 图形设计与绘制 |
| `algorithmic-art` | 设计前端 | 算法生成艺术 |
| `theme-factory` | 设计前端 | 主题工厂（配色/字体/风格系统） |
| `brand-guidelines` | 设计前端 | 品牌规范文档生成 |
| `code-reviewer` | 技术工程 | 代码审查与质量建议 |
| `test-generator` | 技术工程 | 测试用例自动生成 |
| `mcp-builder` | 技术工程 | MCP 协议工具服务器构建 |
| `web-artifacts-builder` | 技术工程 | Web 组件/工件构建 |
| `project-architect` | 技术工程 | 项目架构设计与技术选型 |
| `prompt-engineer` | 基础设施 | 提示词工程优化（Midjourney/SD/Sora） |
| `moderation` | 基础设施 | 内容安全审核 |
| `electron-mac-packaging` | 基础设施 | Electron Mac/Windows 打包配置 |
| `skill-creator` | 基础设施 | 创建新技能的标准模板与流程 |

> **完整技能清单与分类统计** → [`docs/FEATURE_LIST.md`](docs/FEATURE_LIST.md)

---

## 📚 RAG 知识库

访问 `/knowledge` 上传私有文档（PDF、Word、Markdown、TXT、CSV）。

- 上传后文档会自动向量化，AI 对话时自动检索相关内容作为上下文
- 支持内容查看与编辑，一键 AI 优化内容质量
- 知识库状态、文档管理、批量操作全部可视化

## 🗂️ My context（知识图谱与记忆）

访问 **`/settings/context`**（侧栏 **My context**）：查看后端拼装的知识图谱，以及在「Memory」标签页检索、筛选与管理上下文记忆条目。

---

## 📖 技术文档

| 文档 | 说明 |
|------|------|
| [`docs/INSTALLATION.md`](docs/INSTALLATION.md) | 安装指南（v1.0.36 DMG / ZIP 桌面包） |
| [`docs/DEVELOPMENT_GUIDE.md`](docs/DEVELOPMENT_GUIDE.md) | 开发者快速上手指南 |
| [`docs/ARCHITECTURE_OVERVIEW.md`](docs/ARCHITECTURE_OVERVIEW.md) | 系统架构总览（V4 三语言协作） |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | 版本变更日志 |
| [`AGENTS.md`](AGENTS.md) | Agent 协作指南与开发规范（27+ Agent 注册清单） |
| [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) | 后端 API 接口参考手册 |
| [`docs/MCP_CLIENT.md`](docs/MCP_CLIENT.md) | MCP 协议客户端文档 |
| [`docs/MEMORY_SYSTEM.md`](docs/MEMORY_SYSTEM.md) | 记忆系统实现 |
| [`docs/SELF_LEARNING_SYSTEM.md`](docs/SELF_LEARNING_SYSTEM.md) | 自学习系统实现 |
| [`docs/SECURITY_ARCHITECTURE.md`](docs/SECURITY_ARCHITECTURE.md) | 安全架构：审批、沙箱、审计 |
| [`docs/FRONTEND_ARCHITECTURE.md`](docs/FRONTEND_ARCHITECTURE.md) | 前端架构：Next.js 16 + 主题系统 |
| [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) | 日志、Trace、监控与排障 |
| [`docs/FEATURE_LIST.md`](docs/FEATURE_LIST.md) | 全量功能清单（54+ 技能 / 14+ 平台 / 40+ 模块） |
| [`docs/INVESTOR_DECK.md`](docs/INVESTOR_DECK.md) | 投资路演文档 — 市场机会、商业模式、融资计划 |
| [`docs/WINDOWS_DEPLOYMENT.md`](docs/WINDOWS_DEPLOYMENT.md) | Windows 部署补充 |
| [`DOCKER_DEPLOY_GUIDE.md`](DOCKER_DEPLOY_GUIDE.md) | Docker 生产部署指南 |

### Labs 专业助手文档

| 文档 | 助手 |
|------|------|
| [`docs/LABS_PRODUCT_MANAGER.md`](docs/LABS_PRODUCT_MANAGER.md) | 产品经理助手 |
| [`docs/LABS_LEGAL_ADVISOR.md`](docs/LABS_LEGAL_ADVISOR.md) | 法务顾问助手 |
| [`docs/LABS_AD_CAMPAIGN.md`](docs/LABS_AD_CAMPAIGN.md) | 广告投放助手 |
| [`docs/LABS_BUSINESS_PARTNERSHIP.md`](docs/LABS_BUSINESS_PARTNERSHIP.md) | 商务合作助手 |
| [`docs/LABS_PROCUREMENT.md`](docs/LABS_PROCUREMENT.md) | 采购助手 |
| [`docs/LABS_GAME_ART.md`](docs/LABS_GAME_ART.md) | 游戏美术助手 |
| [`docs/LABS_GAME_DESIGN.md`](docs/LABS_GAME_DESIGN.md) | 游戏设计助手 |
| [`docs/LABS_PROGRAMMER.md`](docs/LABS_PROGRAMMER.md) | 编程助手 |
| [`docs/LABS_SYSTEM_ASSISTANT.md`](docs/LABS_SYSTEM_ASSISTANT.md) | 系统维护助手 |
| [`docs/LABS_DESKTOP_OPERATOR.md`](docs/LABS_DESKTOP_OPERATOR.md) | 桌面操作助手 |
| [`docs/LABS_CUSTOMER_SERVICE.md`](docs/LABS_CUSTOMER_SERVICE.md) | AI 客服助手 |
| [`docs/LABS_WORKFLOWS.md`](docs/LABS_WORKFLOWS.md) | 可视化工作流 |

---

## 🤝 贡献指南

欢迎 PR！常见贡献方向：

- 新增平台连接器（TikTok、Snapchat、LinkedIn 等）
- 接入更多 AI 模型/供应商
- 新增 Agent 技能（`.agent/skills/` 目录）
- 完善定时任务策略（如根据数据反馈自动调整发布时间）

```bash
# 开发流程
git fork + clone
git checkout -b feat/your-feature
# 开发 + 测试
git push origin feat/your-feature
# 提交 PR
```

---

## 📄 开源协议

本项目使用 **MIT License** 开源，可自由修改和商用。
