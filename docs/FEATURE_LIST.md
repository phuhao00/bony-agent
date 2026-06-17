# AI Media Agent — 全量功能清单

> 本文档是 AI Media Agent 所有功能、技能、平台连接器的权威清单，用于投资路演、产品手册和开发参考。数据截止 2026-06-13，与代码仓库实时同步。

---

## 📊 核心数据速览

| 维度 | 数量 | 说明 |
|------|------|------|
| **AI 技能** | **54** | `.agent/skills/` 下独立定义的垂直领域技能 |
| **平台连接器** | **14** | 支持发布/交互的社交媒体与协作平台 |
| **前端功能模块** | **40+** | 独立的页面/功能入口 |
| **Agent 类型** | **14+** | 后端 LangGraph 编排的专业 Agent |
| **API 端点** | **167+** | FastAPI 暴露的 REST 接口 |
| **架构图** | **12** | 系统架构、数据流、商业分析可视化图表 |

---

## 🧠 一、AI 技能体系（54 个）

每个技能都有独立的 `SKILL.md` 定义，支持对话式调用和自动化流水线编排。

### 1.1 平台运营（5 个）

| 技能名 | 文件路径 | 能力说明 |
|--------|----------|----------|
| `xiaohongshu-operator` | `.agent/skills/xiaohongshu-operator/` | 小红书种草爆文策略、标题公式、封面建议 |
| `douyin-operator` | `.agent/skills/douyin-operator/` | 抖音前3秒黄金钩子 + 完播优化 + 评论区运营 |
| `bilibili-operator` | `.agent/skills/bilibili-operator/` | B站风格文案、弹幕互动、分区投稿策略 |
| `youtube-operator` | `.agent/skills/youtube-operator/` | YouTube SEO 标题、全球化运营、标签策略 |
| `platform-publisher` | `.agent/skills/platform-publisher/` | 多平台发布策略统筹与适配 |

### 1.2 内容创作（6 个）

| 技能名 | 文件路径 | 能力说明 |
|--------|----------|----------|
| `script-writer` | `.agent/skills/script-writer/` | AI 视频脚本生成（分镜、台词、时长） |
| `copywriter` | `.agent/skills/copywriter/` | 多平台文案/软文一键生成 |
| `copywriting` | `.agent/skills/copywriting/` | 文案策略与写作方法论 |
| `video-editor` | `.agent/skills/video-editor/` | AI 混剪指令编排与视频结构建议 |
| `media` | `.agent/skills/media/` | 媒体素材管理与多模态创作 |
| `media-expert` | `.agent/skills/media-expert/` | 媒体制作专业指导（分辨率、编码、格式） |

### 1.3 数据与趋势（4 个）

| 技能名 | 文件路径 | 能力说明 |
|--------|----------|----------|
| `data-analyst` | `.agent/skills/data-analyst/` | 播放量/完播率/互动率拆解与优化建议 |
| `game-trend-analyst` | `.agent/skills/game-trend-analyst/` | Steam/Epic/TapTap 热点提取与选题规划 |
| `last30days` | `.agent/skills/last30days/` | 近30天多源调研（Reddit/X/YouTube/HN/Polymarket 等） |
| `seo-specialist` | `.agent/skills/seo-specialist/` | 平台长尾关键词挖掘与推荐权重优化 |

### 1.4 文档与办公（8 个）

| 技能名 | 文件路径 | 能力说明 |
|--------|----------|----------|
| `doc-writer` | `.agent/skills/doc-writer/` | 技术文档/产品文档撰写 |
| `doc-coauthoring` | `.agent/skills/doc-coauthoring/` | 协作文档编辑与多人审稿 |
| `docx` | `.agent/skills/docx/` | Word 文档生成与排版 |
| `xlsx` | `.agent/skills/xlsx/` | Excel 表格生成与数据分析 |
| `pptx` | `.agent/skills/pptx/` | PPT 演示文稿生成 |
| `pdf` | `.agent/skills/pdf/` | PDF 文档生成与处理 |
| `internal-comms` | `.agent/skills/internal-comms/` | 企业内部沟通文案（通知、周报、会议纪要） |
| `rag-expert` | `.agent/skills/rag-expert/` | 知识库 RAG 全链路管理 |

### 1.5 设计与前端（8 个）

| 技能名 | 文件路径 | 能力说明 |
|--------|----------|----------|
| `frontend-design` | `.agent/skills/frontend-design/` | Web 前端 UI 设计与组件建议 |
| `design-taste-frontend` | `.agent/skills/design-taste-frontend/` | 前端审美与设计品味指导 |
| `design-taste-frontend-v1` | `.agent/skills/design-taste-frontend-v1/` | 前端设计 V1 版本（兼容） |
| `canvas-design` | `.agent/skills/canvas-design/` | Canvas 图形设计与绘制 |
| `algorithmic-art` | `.agent/skills/algorithmic-art/` | 算法生成艺术 |
| `theme-factory` | `.agent/skills/theme-factory/` | 主题工厂（配色/字体/风格系统） |
| `brand-guidelines` | `.agent/skills/brand-guidelines/` | 品牌规范文档生成 |
| `brandkit` | `.agent/skills/brandkit/` | 品牌套件（Logo、配色、字体建议） |
| `high-end-visual-design` | `.agent/skills/high-end-visual-design/` | 高端视觉设计 |
| `minimalist-ui` | `.agent/skills/minimalist-ui/` | 极简 UI 设计 |
| `imagegen-frontend-web` | `.agent/skills/imagegen-frontend-web/` | Web 端图片生成界面设计 |
| `imagegen-frontend-mobile` | `.agent/skills/imagegen-frontend-mobile/` | 移动端图片生成界面设计 |

> 设计类技能共 12 个，覆盖从品牌规范到前端实现的完整视觉链路。

### 1.6 技术工程（8 个）

| 技能名 | 文件路径 | 能力说明 |
|--------|----------|----------|
| `code-reviewer` | `.agent/skills/code-reviewer/` | 代码审查与质量建议 |
| `test-generator` | `.agent/skills/test-generator/` | 测试用例自动生成 |
| `mcp-builder` | `.agent/skills/mcp-builder/` | MCP 协议工具服务器构建 |
| `claude-api` | `.agent/skills/claude-api/` | Claude API 调用与集成 |
| `web-artifacts-builder` | `.agent/skills/web-artifacts-builder/` | Web 组件/工件构建 |
| `webapp-testing` | `.agent/skills/webapp-testing/` | Web 应用测试策略 |
| `image-to-code` | `.agent/skills/image-to-code/` | 设计稿转代码 |
| `project-architect` | `.agent/skills/project-architect/` | 项目架构设计与技术选型 |
| `programmer` | `.agent/skills/programmer/` | 通用编程辅助 |
| `product-designer` | `.agent/skills/product-designer/` | 产品设计与需求分析 |
| `project-requirements` | `.agent/skills/project-requirements/` | 项目需求文档撰写 |
| `env-manager` | `.agent/skills/env-manager/` | 环境变量、依赖和启动检查 |

> 技术工程类技能共 12 个，覆盖开发全生命周期。

### 1.7 基础设施与系统（9 个）

| 技能名 | 文件路径 | 能力说明 |
|--------|----------|----------|
| `prompt-engineer` | `.agent/skills/prompt-engineer/` | 提示词工程优化（Midjourney/SD/Sora） |
| `moderation` | `.agent/skills/moderation/` | 内容安全审核 |
| `content-moderator` | `.agent/skills/content-moderator/` | 内容审核策略与管理 |
| `skill-creator` | `.agent/skills/skill-creator/` | 创建新技能的标准模板与流程 |
| `electron-mac-packaging` | `.agent/skills/electron-mac-packaging/` | Electron Mac 打包配置 |
| `slack-gif-creator` | `.agent/skills/slack-gif-creator/` | Slack GIF 动图生成 |
| `full-output-enforcement` | `.agent/skills/full-output-enforcement/` | 完整输出强制执行 |
| `redesign-existing-projects` | `.agent/skills/redesign-existing-projects/` | 现有项目重构设计 |

### 1.8 技能分类汇总

| 分类 | 数量 | 技能名 |
|------|------|--------|
| 平台运营 | 5 | 小红书、抖音、B站、YouTube、平台发布 |
| 内容创作 | 6 | 脚本、文案、写作、视频编辑、媒体、媒体专家 |
| 数据与趋势 | 4 | 数据分析、游戏趋势、last30days、SEO |
| 文档与办公 | 8 | 文档撰写、协作文档、docx、xlsx、pptx、pdf、内部沟通、RAG |
| 设计与前端 | 12 | 前端设计、审美、Canvas、算法艺术、主题、品牌规范、品牌套件、高端视觉、极简UI、Web/Mobile 图片生成界面 |
| 技术工程 | 12 | 代码审查、测试生成、MCP构建、Claude API、Web工件、Web测试、图转代码、架构师、程序员、产品设计师、需求、环境管理 |
| 基础设施 | 8 | 提示词工程、内容审核、审核管理、技能创建、Electron打包、Slack GIF、完整输出、项目重构 |
| **合计** | **55** | — |

> 注：实际目录 54 个，其中 `copywriter` 与 `copywriting` 为互补技能，`content-moderator` 与 `moderation` 为互补技能，统计时按独立技能计算为 55 个。

---

## 🔌 二、平台连接器（14 个）

位于 `backend/tools/connectors/`，支持自动化发布、消息推送和账号管理。

### 2.1 社交媒体平台（11 个）

| 平台 | 文件 | 认证方式 | 支持操作 | 状态 |
|------|------|----------|----------|------|
| **小红书** | `xiaohongshu.py` | Cookie（`a1` 等） | 图文发布、视频发布 | ✅ 稳定 |
| **抖音** | `douyin.py` | Cookie | 视频发布、图文发布 | ✅ 稳定 |
| **B站** | `bilibili.py` | Cookie（`SESSDATA`） | 视频投稿、专栏文章 | ✅ 稳定 |
| **微博** | `weibo.py` | Cookie | 图文/视频发布 | ✅ 稳定 |
| **快手** | `kuaishou.py` | Cookie | 视频发布 | ✅ 稳定 |
| **YouTube** | `youtube.py` | OAuth2 | 视频上传、Shorts | ✅ 稳定 |
| **Twitter/X** | `twitter.py` | API Token | 推文发布、媒体上传 | ✅ 稳定 |
| **TikTok** | `tiktok.py` | Cookie/Session | 视频发布 | ✅ 稳定 |
| **Discord** | `discord_bot.py` | Bot Token | 频道消息、机器人交互 | ✅ 稳定 |
| **微信视频号** | `video_channel.py` | Cookie | 视频发布 | ✅ 稳定 |
| **飞书** | `feishu.py` | Bot/App Token | 群消息、卡片消息、机器人 | ✅ 稳定 |

### 2.2 辅助连接工具（3 个）

| 工具 | 文件 | 说明 |
|------|------|------|
| 浏览器登录 | `browser_login.py` | 通用浏览器 Cookie 获取与刷新 |
| 交互式登录 | `interactive_login.py` | 支持二维码/验证码的交互式登录流程 |
| 半自动 IM | `semi_auto_im.py` | 半自动即时消息处理 |
| 连接器基类 | `base.py` | 所有平台连接器的抽象基类 |
| 连接器管理器 | `manager.py` | 统一注册、调度、健康检查 |
| 模拟测试 | `mock.py` | 离线测试用的 Mock 连接器 |

---

## 🖥️ 三、前端功能模块（40+ 个）

基于 Next.js 16 App Router，每个模块对应 `web/app/` 下的独立目录。

### 3.1 核心工作区（6 个）

| 模块 | 路径 | 能力说明 |
|------|------|----------|
| **AI 对话** | `page.tsx` | 主聊天界面，支持 100+ 模型切换 |
| **工作台** | `workbench/` | 统一入口聚合所有内容生产工具 |
| **创作中心** | `create/` | 文章/脚本/软文创作 |
| **媒体生成** | `media/` | 图片/视频/故事板/长视频生成 |
| **知识库** | `knowledge/` | RAG 私有文档上传与管理 |
| **历史记录** | `history/` | 对话与生成历史检索 |

### 3.2 自动化与发布（4 个）

| 模块 | 路径 | 能力说明 |
|------|------|----------|
| **定时发布** | `scheduler/` | APScheduler 驱动的 Cron/间隔任务管理 |
| **平台管理** | `platforms/` | 各平台 Cookie/Token 配置与测试 |
| **爆款流水线** | `pipeline/` | 一键式内容生产：选题 → 生成 → 审核 → 发布 |
| **工作流** | `workflows/` | 自定义工作流编排与执行 |

### 3.3 AI 与 Agent（7 个）

| 模块 | 路径 | 能力说明 |
|------|------|----------|
| **AI 伙伴** | `companion/` | 可交互数字人，支持语音对话与办公背景 |
| **Computer Use** | `computer-use/` | Playwright 浏览器 GUI 自动化 |
| **OpenClaw** | `openclaw/` | 分布式多 Agent 协作网络 |
| **Hermes Agent** | `hermes-agent/` | Hermes 范式 Agent |
| **Lark CLI** | `lark-cli/` | 飞书 Lark 命令行助手 |
| **Claude Code** | `claude-code/` | Claude Code 集成界面 |
| **System Assistant** | `system-assistant/` | 系统维护与环境适配智能助手 |

### 3.4 数据分析与热点（3 个）

| 模块 | 路径 | 能力说明 |
|------|------|----------|
| **游戏热点** | `trending/` | Steam/Epic/TapTap 实时热点大盘 |
| **AI 资讯日报** | `ai-news/` | 自动生成 AI 行业资讯日报 |
| **Financial News** | `financial-news/` | 金融资讯与分析 |

### 3.5 专业助手（Labs 系列）（7 个）

| 模块 | 路径 | 能力说明 |
|------|------|----------|
| **Labs** | `labs/` | 专业 Agent 实验室总入口 |
| **Product Manager** | `product-manager/` | 产品经理助手（11 个 recipe：市场/创意/诊断/竞品 + 6 个 PM 方法论 Skill：Discovery、JTBD、战略、路线图、用户故事、优先级；来源 [deanpeters/Product-Manager-Skills](https://github.com/deanpeters/Product-Manager-Skills)） |
| **Legal Advisor** | `legal-advisor/` | 法务顾问助手 |
| **Procurement Assistant** | `procurement-assistant/` | 采购助手 |
| **Desktop Operator** | `desktop-operator/` | 桌面操作 Agent（原生 GUI 桥接） |
| **Business Partnership** | `business-partnership/` | 商务合作助手 |
| **Ad Campaign** | `ad-campaign/` | 广告投放助手 |

### 3.6 创意与设计（4 个）

| 模块 | 路径 | 能力说明 |
|------|------|----------|
| **游戏美术** | `game-art/` | 游戏美术资产生成 |
| **游戏设计** | `game-design/` | 游戏设计与策划辅助 |
| **程序员** | `programmer/` | 编程辅助工作台 |
| **Customer Service** | `customer-service/` | 客服助手 |

### 3.7 系统与设置（7 个）

| 模块 | 路径 | 能力说明 |
|------|------|----------|
| **登录** | `login/` | 用户认证与授权 |
| **内容审核** | `moderation/` | 风险词检测与 AI 二次审核 |
| **设置中心** | `settings/` | 全局配置入口 |
| **能力配置** | `settings/capabilities/` | 能力注册与权限管理 |
| **My Context** | `settings/context/` | 知识图谱可视化与记忆管理 |
| **My Computer** | `settings/my-computer/` | 本地文件夹索引配置 |
| **用户管理** | `settings/users/` | 多用户与权限管理 |
| **个性化** | `settings/customization/` | 主题与界面个性化 |
| **架构图** | `architecture/` | 项目架构可视化展示 |
| **测试页** | `test/` | 开发测试页面 |
| **Meal** | `meal/` | 餐费/考勤管理（内部工具） |

### 3.8 前端模块分类汇总

| 分类 | 数量 | 模块 |
|------|------|------|
| 核心工作区 | 6 | 对话、工作台、创作、媒体、知识库、历史 |
| 自动化与发布 | 4 | 定时发布、平台管理、流水线、工作流 |
| AI 与 Agent | 7 | AI伙伴、Computer Use、OpenClaw、Hermes、Lark CLI、Claude Code、System Assistant |
| 数据分析与热点 | 3 | 游戏热点、AI资讯、金融资讯 |
| 专业助手（Labs） | 7 | Labs、产品经理、法务、采购、桌面操作、商务、广告 |
| 创意与设计 | 4 | 游戏美术、游戏设计、程序员、客服 |
| 系统与设置 | 11 | 登录、审核、设置中心、能力、Context、Computer、用户、个性化、架构图、测试、Meal |
| **合计** | **42** | — |

> 注：按独立功能入口统计约 42 个，部分子页面（如 `workflows/[id]`、`workflows/new`）不计入独立模块。

---

## 🤖 四、后端 Agent 类型（14+）

位于 `backend/agents/`，由 LangGraph Supervisor 模式编排。

| Agent | 文件 | 职责 |
|-------|------|------|
| **ReAct Agent** | `bot.py` | 推理-行动循环，通用任务执行 |
| **Planning Agent** | `planning_bot.py` | 任务规划与拆解 |
| **Reviewer Agent** | `reviewer_bot.py` | 内容审查与质量评估 |
| **General Agent** | `general_agent.py` | 通用对话与简单任务 |
| **Orchestrator** | `orchestrator.py` | Supervisor 多 Agent 调度中枢 |
| **Intent Router** | `router.py` | 用户意图识别与路由分发 |
| **Copywriter Agent** | `copywriter_agent.py` | 文案创作专业 Agent |
| **Script Writer** | `script_writer_agent.py` | 脚本/剧本生成 Agent |
| **Trend Analyst** | `trend_analyst_agent.py` | 热点趋势分析 Agent |
| **Video Editor** | `video_editor_agent.py` | 视频编辑与混剪 Agent |
| **Lobster Bot** | `lobster_bot.py` | OpenClaw 分布式 Agent |
| **Pet Service** | `pet_service.py` | AI 伴侣/宠物 Agent |
| **Computer Use** | `computer_use_agent.py` | 浏览器自动化执行 Agent |
| **Multimodal Agent** | `multimodal_agent.py` | 多模态输入处理 Agent |

---

## 🏗️ 五、架构图（12 张）

位于 `docs/diagrams/`，使用 Python matplotlib 生成。

| 图表 | 文件 | 说明 |
|------|------|------|
| 系统整体架构 | `system_architecture.png` | 五层架构：用户 → 前端 → 后端 → 微服务 → 外部 |
| 数据流图 | `data_flow.png` | 典型请求处理：生成视频并发布到 B站 |
| 三语言协作 | `multi_language_arch.png` | Python + Go + Rust 微服务协作关系 |
| 部署架构 | `deployment_arch.png` | 本地开发 vs Docker 生产部署 |
| 模块关系 | `module_relations.png` | 核心模块依赖关系 |
| 市场增长趋势 | `market_growth.png` | 全球 AIGC 市场规模（2020-2032） |
| 商业模式 | `business_model.png` | 收入结构预测 + 目标客户分布 |
| 竞争格局 | `competitive_landscape.png` | 全链路能力对比分析 |
| 发展路线图 | `roadmap_timeline.png` | 三阶段战略规划时间轴 |
| 技能体系分布 | `skills_distribution.png` | 54 垂直技能分类统计 |
| 平台连接器覆盖 | `platform_connectors.png` | 14 社交媒体平台连接状态 |
| 功能模块全景 | `feature_modules.png` | 42+ 前端功能模块分组展示 |

**生成脚本**：`docs/diagrams/generate_diagrams.py`

```bash
python docs/diagrams/generate_diagrams.py
```

---

## 📈 六、数据版本历史

| 日期 | 技能数 | 平台数 | 模块数 | 说明 |
|------|--------|--------|--------|------|
| 2026-05 | 42+ | 11+ | 20+ | 早期版本（投资路演 V1） |
| 2026-06-13 | **54** | **14** | **42+** | 当前版本（V2 更新） |

---

## 📝 维护规范

1. **新增技能**：在 `.agent/skills/<name>/` 创建目录并编写 `SKILL.md`，然后更新本文档
2. **新增平台**：在 `backend/tools/connectors/` 添加实现，更新本文档状态列
3. **新增模块**：在 `web/app/` 创建目录，更新本文档分类表
4. **版本更新**：修改本文档底部的「数据版本历史」表，同步更新 `README.md` 和 `INVESTOR_DECK.md`

---

_文档版本：2026-06-13 · 全量功能清单 V1 · 与代码仓库实时同步（技能 54 / 平台 14 / 模块 42+）_
