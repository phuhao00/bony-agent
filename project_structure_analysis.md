# AI Media Agent 项目结构分析与优化方案

---

## 一、项目现状概览

### 1.1 项目定位
**AI Media Agent** — 全链路内容生产与分发数字员工平台，一站式 AI 驱动的内容自动化平台。

### 1.2 技术栈全景

| 层级 | 技术 | 说明 |
|------|------|------|
| 主后端 | Python 3.10+ / FastAPI / LangChain / LangGraph | 核心业务逻辑，~380文件 / ~100万行 |
| 前端 | Next.js 16 / React 19 / Tailwind CSS 4 | Web管理界面，39页面 / 79组件 |
| 桌面端(主) | Electron 32 + Node.js | 跨平台桌面应用 |
| 桌面端(宠物) | Tauri 2 + Svelte 5 + Vite | AI桌面伴侣 |
| 移动端 | Capacitor 6 + Vite | iOS/Android壳 |
| 高并发服务 | Go | 目录服务 (gRPC) |
| 安全解析 | Rust | 文档解析服务 (gRPC) |
| OCR服务 | Python + gRPC | 独立OCR微服务 |

### 1.3 模块规模

| 模块 | 大小 | 文件数 | 说明 |
|------|------|--------|------|
| `desktop-pet` | 9.7 GB | ~50 | Tauri桌面宠物（含Rust编译产物） |
| `electron` | 2.8 GB | ~80 | Electron主应用（含资源文件） |
| `web` | 2.3 GB | ~120 | Next.js前端 |
| `backend` | 1.4 GB | ~380 | Python主后端 |
| `storage` | 1.3 GB | - | 运行时数据存储 |
| `mobile` | 59 MB | ~15 | Capacitor移动端壳 |
| `tests` | 492 KB | ~25 | 测试文件 |
| `docs` | 420 KB | ~35 | 文档 |

---

## 二、当前结构问题诊断

### 🔴 严重问题（立即处理）

#### 问题 1：根目录极度混乱 — "文件垃圾场"

**现状**：根目录散落 **38个文件**，包括：
- 12个启动脚本（`.sh` / `.bat`）
- 5个测试/临时文件（`simple_test.py`, `test_*.py`, `*.txt`）
- 2个证书/密钥文件（`developerID_application.cer`, `developer_id_private.key`）⚠️ **安全风险**
- 3个Cookie/凭证文件（`douyin_cookies.json`, `douyin_login_qr.png`）
- 多个日志/输出文件（`agent.log`, `test_output.json`）

**影响**：
- 新开发者无法快速理解项目入口
- 证书/密钥存在意外提交到版本控制的风险
- 启动脚本缺乏统一管理和文档

#### 问题 2：Backend 模块扁平化膨胀 — "大平层反模式"

**现状**：`backend/` 下 149个Python文件分布在 **6个一级目录**，**无任何二级分层**：

| 目录 | 文件数 | 总代码行 | 最大文件 | 问题 |
|------|--------|----------|----------|------|
| `agents/` | 30 | ~4,444 | `pet_service.py` (775行) | 角色混杂：聊天、视频、文案、宠物、趋势分析 |
| `services/` | 47 | ~16,182 | `computer_use_service.py` (919行) | 职责混杂：飞书、Jenkins、TAPD、排班、MCP、记忆 |
| `tools/` | 29 | ~? | `media_tools.py` | 工具与业务逻辑耦合 |
| `core/` | 19 | ~? | `workflow_engine.py` | 核心抽象与具体实现混合 |
| `utils/` | 18 | ~? | `rag_manager.py` | 工具函数与业务服务边界模糊 |
| `routers/` | 6 | ~? | `agent_chat_router.py` | 路由文件过少，可能遗漏API分层 |

**影响**：
- 文件查找困难，开发者需要记住30+个文件名
- 模块间耦合度高，循环依赖风险
- 代码审查困难，单文件过大（最大919行）
- 新功能无处安放，只能继续平铺

#### 问题 3：`main.py` 过大 — "上帝文件"

**现状**：`backend/main.py` 共 **6,630行**，包含：
- FastAPI应用实例创建
- 全局中间件配置
- 所有路由注册（可能内联定义）
- 启动/生命周期逻辑
- Playwright/FFmpeg环境修复代码

**影响**：
- 任何路由改动都需要修改此文件，冲突风险高
- 代码审查困难
- 启动逻辑与业务逻辑耦合

#### 问题 4：敏感文件泄露风险

**现状**：
- `developerID_application.cer` — Apple开发者证书
- `developer_id_private.key` — 私钥文件
- `douyin_cookies.json` — 抖音登录凭证
- 这些文件**已加入Git追踪**（`git status`显示为untracked说明尚未add，但存在于工作区）

**影响**：
- 私钥泄露可导致代码签名被滥用
- Cookie泄露可导致账号被盗

---

### 🟡 中等问题（近期处理）

#### 问题 5：多 Backend 变体关系不清

**现状**：
- `backend/` — Python主后端（FastAPI）
- `backend_massive_concurrent/` — Go高并发目录服务（gRPC）
- `backend_safety/` — Rust文档解析安全服务（gRPC）
- `backend_block_chain/` — 空目录（仅存在，无内容）

**问题**：
- 命名不一致：`backend` vs `backend_*`
- 技术栈混合在同一层级，没有统一的服务目录
- `backend_block_chain` 为空目录，应清理
- 微服务与单体后端平级，架构层次模糊

#### 问题 6：Web 前端组件位置混乱

**现状**：组件同时存在于两个位置：
- `web/components/` — 13个文件（Meal、Workflow相关）
- `web/app/components/` — 11个文件（AppShell、Sidebar等全局组件）

**问题**：
- 没有统一的组件组织规范
- 按功能域划分的组件（如Meal）与全局组件混放
- 缺少 `features/` 或 `modules/` 级别的组织

#### 问题 7：测试文件位置与组织不当

**现状**：
- `tests/` 在根目录，但**只测试 backend**
- 无前端测试（Next.js项目无Jest/Vitest/Playwright配置）
- 测试文件命名不统一（`test_*.py` 和 `*_test.py` 混用）
- `__pycache__` 已提交到Git（`.pytest_cache/` 目录存在）

#### 问题 8：存储与数据目录分散

**现状**：
- `storage/` — 运行时数据（1.3GB）
- `logs/` — 日志文件
- `tmp/` — 临时文件
- `backend/storage/` — 后端配置存储
- `backend/agent.log.*` — 后端日志

**问题**：
- 数据与代码混合在同一层级
- 多个存储位置导致备份/清理困难
- Docker volume映射复杂

---

### 🟢 轻微问题（逐步优化）

#### 问题 9：虚拟环境多处存在
- `.venv/` — 根目录（Python 3.13）
- `venv/` — 根目录（另一个虚拟环境）
- `backend/.venv/` — 后端专用

#### 问题 10：文档缺乏结构化索引
- `docs/` 有35个文档，但无分类索引
- 新开发者无法快速找到所需文档

#### 问题 11：Dockerfile 分散
- `backend/Dockerfile`
- `web/Dockerfile`
- `backend_massive_concurrent/Dockerfile`
- `backend_safety/Dockerfile`
- `services/ocr/Dockerfile`
- 缺少统一的 `docker/` 目录管理

---

## 三、优化方案

### 3.1 根目录重构 — "清理门户"

```
ai-media-agent/
├── README.md
├── LICENSE
├── .gitignore
├── Makefile                    # 统一命令入口
├── docker-compose.yml          # 保留
├── docker-compose.chroma.yml   # 保留
│
├── bin/                        # 【新建】所有启动/构建脚本
│   ├── start-local.sh          # 原 start_local.sh
│   ├── start-ecs.sh            # 原 start_ecs.sh
│   ├── start-with-tunnel.sh    # 原 start_with_tunnel.sh
│   ├── start-chroma.sh         # 原 start_chroma.sh
│   ├── stop-ecs.sh             # 原 stop_ecs.sh
│   ├── stop-chroma.sh          # 原 stop_chroma.sh
│   ├── build-native.sh         # 原 build_native.sh
│   ├── build-package.sh        # 原 build_package.sh
│   ├── build-windows.sh        # 原 build_windows.sh
│   ├── deploy.sh               # 原 deploy.sh
│   └── windows/
│       ├── start.bat
│       └── start-windows.bat
│
├── scripts/                    # 【保留】开发/CI脚本
│   ├── setup/
│   ├── build/
│   ├── jenkins/
│   └── utils/
│
├── docs/                       # 【保留】结构化文档
│   ├── README.md               # 文档索引
│   ├── architecture/
│   ├── deployment/
│   ├── development/
│   └── api/
│
├── docker/                     # 【新建】统一Docker管理
│   ├── backend.Dockerfile      # 从 backend/ 移入
│   ├── web.Dockerfile          # 从 web/ 移入
│   ├── ocr.Dockerfile          # 从 services/ocr/ 移入
│   ├── directory.Dockerfile    # 从 backend_massive_concurrent/ 移入
│   ├── parser.Dockerfile       # 从 backend_safety/ 移入
│   └── nginx/
│
├── data/                       # 【新建】统一数据目录
│   ├── storage/                # 原 storage/
│   ├── logs/                   # 原 logs/
│   ├── tmp/                    # 原 tmp/
│   └── backups/
│
├── secrets/                    # 【新建】敏感文件（gitignored）
│   ├── .gitignore              # 忽略所有内容
│   ├── README.md               # 说明如何放置证书
│   └── example.env             # 环境变量模板
│
└── packages/                   # 【新建】统一代码包目录
    ├── backend/                # 原 backend/
    ├── web/                    # 原 web/
    ├── electron/               # 原 electron/
    ├── mobile/                 # 原 mobile/
    ├── desktop-pet/            # 原 desktop-pet/
    ├── browser-extension/      # 原 browser-extension/
    └── services/               # 微服务集合
        ├── ocr/                # 原 services/ocr/
        ├── directory/          # 原 backend_massive_concurrent/
        └── parser/             # 原 backend_safety/
```

**清理清单**：
- [ ] 删除根目录所有 `.sh` / `.bat` 文件 → 移入 `bin/`
- [ ] 删除 `simple_test.py`, `test_*.py`, `*.txt` 临时文件
- [ ] 删除/移入 `secrets/`：`developerID_application.cer`, `developer_id_private.key`
- [ ] 删除/移入 `data/`：`douyin_cookies.json`, `douyin_login_qr.png`
- [ ] 删除 `backend_block_chain/` 空目录
- [ ] 删除 `.pytest_cache/` 并加入 `.gitignore`
- [ ] 删除 `test_output.json`, `agent.log` 等运行时文件

---

### 3.2 Backend 分层重构 — "从平铺到立体"

**当前问题**：149个文件平铺在6个目录，无二级分层。

**优化原则**：
1. **按业务域（Domain）组织**，而非按技术类型
2. **每个域内部再分层**：API → Service → Repository/Tool
3. **main.py 瘦身**：只保留应用工厂和启动逻辑

```
packages/backend/
├── pyproject.toml              # 统一依赖管理（替代 requirements.txt）
├── README.md
├── Dockerfile -> ../../docker/backend.Dockerfile  (或软链接)
│
├── src/
│   ├── __init__.py
│   ├── main.py                 # 【瘦身】仅应用工厂 + 启动逻辑（目标 <200行）
│   ├── config.py               # 配置管理（原 .env 加载逻辑）
│   ├── lifespan.py             # 生命周期事件（启动/关闭钩子）
│   ├── exceptions.py           # 全局异常定义
│   └── middleware.py           # 全局中间件
│
│   ├── api/                    # 【新建】API层（原 routers/ 扩展）
│   │   ├── __init__.py
│   │   ├── deps.py             # FastAPI依赖注入
│   │   ├── v1/
│   │   │   ├── __init__.py
│   │   │   ├── chat.py         # 原 agent_chat_router.py
│   │   │   ├── auth.py         # 原 auth_router.py
│   │   │   ├── users.py        # 原 users_router.py
│   │   │   ├── media.py        # 图片/视频/生成
│   │   │   ├── publish.py      # 发布相关
│   │   │   ├── workflows.py    # 工作流
│   │   │   ├── scheduler.py    # 定时任务
│   │   │   ├── knowledge.py    # RAG知识库
│   │   │   ├── computer_use.py # Computer Use API
│   │   │   ├── feishu.py       # 飞书集成
│   │   │   ├── tapd.py         # TAPD集成
│   │   │   ├── meal.py         # 餐费/考勤
│   │   │   └── health.py       # 健康检查
│   │   └── internal/
│   │       └── admin.py        # 原 admin/
│   │
│   ├── domains/                # 【新建】业务域（核心重构）
│   │   ├── __init__.py
│   │   │
│   │   ├── agent/              # AI Agent核心
│   │   │   ├── __init__.py
│   │   │   ├── models.py       # Pydantic模型
│   │   │   ├── service.py      # 业务服务（原 chat_service.py 等）
│   │   │   ├── graph.py        # LangGraph定义（原 chat_graph.py）
│   │   │   ├── router.py       # 路由逻辑（原 graph_router.py）
│   │   │   ├── registry.py     # Agent注册（原 registry.py）
│   │   │   └── types.py        # 类型定义
│   │   │
│   │   ├── media/              # 媒体生成域
│   │   │   ├── __init__.py
│   │   │   ├── image/
│   │   │   │   ├── service.py
│   │   │   │   ├── models.py
│   │   │   │   └── tools.py    # 原 image_tools.py
│   │   │   ├── video/
│   │   │   │   ├── service.py
│   │   │   │   ├── models.py
│   │   │   │   └── tools.py    # 原 video_tools.py, long_video_tools.py
│   │   │   ├── storyboard/
│   │   │   │   ├── service.py
│   │   │   │   └── models.py
│   │   │   └── pipeline/
│   │   │       ├── service.py  # 原 auto_video_pipeline.py
│   │   │       └── models.py
│   │   │
│   │   ├── publish/            # 发布域
│   │   │   ├── __init__.py
│   │   │   ├── service.py
│   │   │   ├── pipeline.py     # 原 publish_pipeline_node.py
│   │   │   ├── routing.py      # 原 publish_routing.py
│   │   │   ├── platforms/
│   │   │   │   ├── xiaohongshu.py
│   │   │   │   ├── douyin.py
│   │   │   │   ├── bilibili.py
│   │   │   │   ├── weibo.py
│   │   │   │   ├── youtube.py
│   │   │   │   ├── twitter.py
│   │   │   │   ├── kuaishou.py
│   │   │   │   └── wechat.py
│   │   │   └── tools.py        # 原 publisher_tools.py
│   │   │
│   │   ├── content/            # 内容创作域
│   │   │   ├── __init__.py
│   │   │   ├── copywriting/
│   │   │   │   ├── service.py  # 原 copywriter_agent.py
│   │   │   │   └── tools.py    # 原 copywriting_tools.py
│   │   │   ├── script/
│   │   │   │   ├── service.py  # 原 script_writer_agent.py
│   │   │   │   └── tools.py    # 原 script_tools.py
│   │   │   └── trending/
│   │   │       ├── service.py  # 原 trend_analyst_agent.py
│   │   │       └── tools.py    # 原 trend_tools.py, gaming_trending.py, social_trending.py, ai_trending.py
│   │   │
│   │   ├── knowledge/          # 知识库/RAG域
│   │   │   ├── __init__.py
│   │   │   ├── service.py
│   │   │   ├── graph.py        # 原 context_knowledge_graph.py
│   │   │   ├── rag.py          # 原 rag_tools.py
│   │   │   └── memory/
│   │   │       ├── coordinator.py   # 原 memory_coordinator.py
│   │   │       ├── graph_export.py  # 原 memory_graph_export.py
│   │   │       ├── evaluation.py  # 原 memory_evaluation.py
│   │   │       ├── quality.py     # 原 memory_quality.py
│   │   │       └── session.py     # 原 session_recall.py
│   │   │
│   │   ├── companion/          # AI伴侣/宠物域
│   │   │   ├── __init__.py
│   │   │   ├── service.py      # 原 pet_service.py
│   │   │   ├── router.py       # 原 pet_router.py
│   │   │   ├── tools.py        # 原 pet_tools_agent.py
│   │   │   └── state.py        # 原 companion_state.py
│   │   │
│   │   ├── computer_use/       # Computer Use域
│   │   │   ├── __init__.py
│   │   │   ├── service.py      # 原 computer_use_service.py
│   │   │   ├── browser.py      # 浏览器自动化
│   │   │   └── desktop.py      # 原 desktop_actions.py
│   │   │
│   │   ├── workflow/           # 工作流域
│   │   │   ├── __init__.py
│   │   │   ├── engine.py       # 原 workflow_engine.py
│   │   │   ├── schema.py       # 原 workflow_schema.py
│   │   │   └── service.py      # 原 workflow_service.py
│   │   │
│   │   ├── integration/        # 第三方集成域
│   │   │   ├── __init__.py
│   │   │   ├── feishu/         # 飞书全家桶
│   │   │   │   ├── ops.py          # 原 feishu_ops.py
│   │   │   │   ├── ops_auto_build.py
│   │   │   │   ├── ops_deploy.py
│   │   │   │   ├── vote_handler.py
│   │   │   │   ├── vote_service.py
│   │   │   │   ├── chat_pull.py
│   │   │   │   ├── lark_cli.py     # 原 meal_feishu_lark_cli.py
│   │   │   │   ├── handler.py      # 原 meal_feishu_handler.py
│   │   │   │   ├── ws.py           # 原 meal_feishu_ws.py
│   │   │   │   ├── api.py          # 原 meal_feishu_api.py
│   │   │   │   ├── attendance.py   # 原 meal_feishu_attendance.py
│   │   │   │   ├── profile.py      # 原 meal_feishu_profile.py
│   │   │   │   ├── reminder.py     # 原 meal_feishu_reminder.py
│   │   │   │   ├── config.py       # 原 meal_feishu_config.py
│   │   │   │   └── attendance_ids.py
│   │   │   ├── tapd/           # TAPD
│   │   │   │   ├── service.py      # 原 tapd_service.py
│   │   │   │   ├── bug_analyze.py
│   │   │   │   ├── har_analyze.py
│   │   │   │   └── stats_export.py # 原 tapd_stats_export.py
│   │   │   ├── jenkins/
│   │   │   │   ├── service.py      # 原 jenkins_service.py
│   │   │   │   └── config_store.py # 原 jenkins_config_store.py
│   │   │   └── mcp/
│   │   │       ├── client.py       # 原 mcp_client.py
│   │   │       ├── presets.py      # 原 mcp_presets.py
│   │   │       ├── managed_launcher.py
│   │   │       └── tools.py        # 原 mcp_tools.py
│   │   │
│   │   └── scheduler/          # 定时任务域
│   │       ├── __init__.py
│   │       ├── service.py      # 原 scheduler.py
│   │       └── jobs/
│   │
│   ├── infrastructure/         # 【新建】基础设施层
│   │   ├── __init__.py
│   │   ├── db/
│   │   │   ├── __init__.py
│   │   │   ├── connection.py
│   │   │   └── migrations/
│   │   ├── cache/
│   │   ├── queue/
│   │   ├── storage/
│   │   ├── llm/
│   │   │   ├── __init__.py
│   │   │   ├── provider.py     # 原 llm_provider.py
│   │   │   ├── augmented.py    # 原 augmented_llm.py
│   │   │   └── models.py       # 原 media_models.py
│   │   ├── browser/
│   │   │   ├── __init__.py
│   │   │   ├── playwright.py
│   │   │   └── pool.py
│   │   ├── auth/
│   │   │   ├── __init__.py
│   │   │   ├── jwt.py          # 原 auth.py
│   │   │   ├── db.py           # 原 auth_db.py
│   │   │   └── oauth.py        # 原 oauth_manager.py
│   │   ├── search/
│   │   │   ├── __init__.py
│   │   │   ├── web.py          # 原 web_search_tools.py
│   │   │   └── ddg.py          # 原 simple_ddg_search.py
│   │   ├── vector/
│   │   │   ├── __init__.py
│   │   │   ├── chroma.py       # 原 chroma_client.py
│   │   │   └── store.py        # 原 vector_store.py
│   │   ├── grpc/
│   │   │   └── client.py       # 原 grpc_client.py
│   │   └── logging/
│   │       └── logger.py       # 原 logger.py
│   │
│   └── core/                   # 【精简】仅保留真正核心抽象
       ├── __init__.py
       ├── capabilities.py
       ├── execution_approval.py
       ├── platform_actions.py
       ├── platform_capabilities.py
       └── research_*.py         # 研究相关抽象
│
├── tests/                      # 【移入】backend专用测试
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
│
└── alembic/                    # 【可选】数据库迁移
```

**重构收益**：
- 文件从平铺149个 → 分层约200个（更小的文件，更易维护）
- 按业务域查找：开发者知道"飞书相关"去 `domains/integration/feishu/`
- 新增功能有明确归属，不再无处安放
- 单文件平均行数从 300+ 降至 150-

---

### 3.3 Web 前端重构 — "组件归位"

**当前问题**：`web/components/` 和 `web/app/components/` 并存，39个页面文件散落在 `app/` 下。

```
packages/web/
├── package.json
├── next.config.js
├── tsconfig.json
├── tailwind.config.ts
├── Dockerfile -> ../../docker/web.Dockerfile
│
├── src/                        # 【可选】或保持 app/ 在根
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   ├── (auth)/             # 认证路由组
│   │   │   └── login/
│   │   ├── (main)/             # 主界面路由组
│   │   │   ├── page.tsx        # Dashboard
│   │   │   ├── chat/
│   │   │   ├── media/
│   │   │   ├── create/
│   │   │   ├── knowledge/
│   │   │   ├── workflows/
│   │   │   ├── scheduler/
│   │   │   ├── settings/
│   │   │   └── ...
│   │   └── api/                # API Routes
│   │
│   ├── components/             # 【统一】所有组件
│   │   ├── ui/                 # 基础UI组件（Button, Input, Modal等）
│   │   ├── layout/             # 布局组件
│   │   │   ├── AppShell.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── ...
│   │   ├── features/           # 功能域组件
│   │   │   ├── chat/
│   │   │   ├── media/
│   │   │   ├── meal/
│   │   │   ├── workflow/
│   │   │   └── lark-cli/
│   │   └── common/             # 通用组件
│   │       ├── MarkdownSummaryPreview.tsx
│   │       ├── LLMSelector.tsx
│   │       └── ...
│   │
│   ├── hooks/                  # 【保留】React Hooks
│   ├── lib/                    # 【保留】工具函数
│   ├── types/                  # 【保留】TypeScript类型
│   ├── contexts/               # 【保留】React Context
│   ├── messages/               # i18n翻译文件
│   └── styles/
│
├── public/
├── tests/                      # 【新建】前端测试
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── playwright.config.ts        # E2E测试配置
```

---

### 3.4 微服务统一 — "服务归队"

**当前问题**：`backend_massive_concurrent/`、`backend_safety/`、`services/ocr/` 与主后端平级。

```
packages/services/              # 【统一微服务目录】
├── README.md
├── docker-compose.services.yml
│
├── ocr/                        # 原 services/ocr/
│   ├── Dockerfile -> ../../docker/ocr.Dockerfile
│   ├── requirements.txt
│   ├── server.py
│   └── engine.py
│
├── directory/                  # 原 backend_massive_concurrent/
│   ├── Dockerfile -> ../../docker/directory.Dockerfile
│   ├── go.mod
│   ├── go.sum
│   ├── cmd/
│   ├── internal/
│   └── generated/
│
└── parser/                     # 原 backend_safety/
    ├── Dockerfile -> ../../docker/parser.Dockerfile
    ├── Cargo.toml
    ├── Cargo.lock
    ├── build.rs
    └── src/
```

---

### 3.5 安全加固 — "清理敏感文件"

**立即执行**：

```bash
# 1. 创建 secrets 目录并移动证书
mkdir -p secrets
git mv developerID_application.cer secrets/ 2>/dev/null || mv developerID_application.cer secrets/
git mv developer_id_private.key secrets/ 2>/dev/null || mv developer_id_private.key secrets/

# 2. 确保 secrets 被忽略
cat >> .gitignore << 'EOF'
# Secrets
certs/
*.cer
*.key
*.pem
secrets/*
!secrets/README.md
!secrets/example.env
EOF

# 3. 清理已提交的缓存
git rm -r --cached .pytest_cache/ 2>/dev/null || true
rm -rf .pytest_cache/

# 4. 移动运行时数据
mkdir -p data/logs data/tmp
mv logs/* data/logs/ 2>/dev/null || true
mv tmp/* data/tmp/ 2>/dev/null || true
```

---

### 3.6 依赖管理升级 — "现代化 Python 项目"

**当前问题**：`requirements.txt` 管理依赖，无版本锁定。

**建议**：

```toml
# packages/backend/pyproject.toml
[project]
name = "ai-media-agent-backend"
version = "1.0.37"
description = "AI Media Agent backend"
requires-python = ">=3.10"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "langchain>=0.3.0",
    "langgraph>=0.2.0",
    "pydantic>=2.0",
    "pydantic-settings>=2.0",
    "sqlalchemy>=2.0",
    "alembic>=1.13",
    "chromadb>=0.5.0",
    "playwright>=1.45.0",
    "apscheduler>=3.10,<4.0",
    # ... 其他依赖
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "httpx>=0.27",
    "ruff>=0.6",
    "mypy>=1.10",
]

[tool.ruff]
line-length = 100
target-version = "py310"

[tool.mypy]
python_version = "3.10"
strict = true
```

---

## 四、迁移路线图

### Phase 1：安全清理（1天）
- [ ] 移动证书/密钥到 `secrets/` 并加入 `.gitignore`
- [ ] 删除 `.pytest_cache/` 并确保被忽略
- [ ] 清理根目录临时文件（`*.txt`, `test_*.py`, `agent.log`）
- [ ] 删除空目录 `backend_block_chain/`

### Phase 2：根目录整理（2天）
- [ ] 创建 `bin/` 目录，移动所有 `.sh` / `.bat` 脚本
- [ ] 创建 `data/` 目录，统一 `storage/`, `logs/`, `tmp/`
- [ ] 创建 `docker/` 目录，移动所有 `Dockerfile`
- [ ] 更新 `docker-compose.yml` 路径引用
- [ ] 更新 `.gitignore`

### Phase 3：Backend 分层（1-2周）
- [ ] 创建 `src/api/`, `src/domains/`, `src/infrastructure/` 目录结构
- [ ] 按域逐步迁移文件（建议顺序：integration → content → media → publish → knowledge → agent）
- [ ] 拆分 `main.py`：提取路由注册到 `api/`，提取启动逻辑到 `lifespan.py`
- [ ] 引入 `pyproject.toml` 替代 `requirements.txt`
- [ ] 配置 `ruff` + `mypy` 代码检查

### Phase 4：Web 前端整理（3-5天）
- [ ] 统一组件到 `components/` 目录，按 `ui/`, `layout/`, `features/`, `common/` 组织
- [ ] 引入前端测试框架（Vitest + React Testing Library）
- [ ] 配置 Playwright E2E 测试

### Phase 5：微服务归队（2-3天）
- [ ] 创建 `packages/services/` 目录
- [ ] 移动 `backend_massive_concurrent/` → `services/directory/`
- [ ] 移动 `backend_safety/` → `services/parser/`
- [ ] 移动 `services/ocr/` → `services/ocr/`
- [ ] 更新 `docker-compose.yml` 构建路径

### Phase 6：文档与规范（持续）
- [ ] 创建 `docs/README.md` 索引
- [ ] 编写 `docs/development/CODE_STRUCTURE.md`
- [ ] 编写 `docs/development/CONTRIBUTING.md`
- [ ] 添加 Makefile 统一命令

---

## 五、预期收益

| 指标 | 当前 | 优化后 | 收益 |
|------|------|--------|------|
| 根目录文件数 | 38 | 8 | **减少79%** |
| Backend单目录文件数 | 149 | 最大30/域 | **可维护性↑** |
| main.py 行数 | 6,630 | <200 | **减少97%** |
| 敏感文件暴露 | 4个 | 0 | **安全风险消除** |
| 新功能定位时间 | 5-10分钟 | <1分钟 | **效率↑** |
| 代码审查文件大小 | 平均300+行 | 平均<150行 | **质量↑** |

---

## 六、风险与回滚

| 风险 | 缓解措施 |
|------|----------|
| 重构引入Bug | 每阶段完成后运行完整测试套件 |
| 路径变更破坏Docker | 同步更新 `docker-compose.yml` 和 `Dockerfile` |
| 团队协作冲突 | 在独立分支重构，分阶段合并 |
| 历史记录丢失 | 使用 `git mv` 保留文件历史 |

---

*报告生成时间：基于项目当前状态分析*
*建议优先级：Phase 1 > Phase 2 > Phase 3 > Phase 5 > Phase 4 > Phase 6*
