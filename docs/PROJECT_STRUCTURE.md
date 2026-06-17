# AI Media Agent — 项目结构速查

> 快速了解项目目录组织，帮助新开发者定位代码。

---

## 根目录一览

```
ai-media-agent/
├── README.md                   # 项目主文档
├── docs/                       # 技术文档中心
│   ├── README.md               # 文档索引
│   ├── ARCHITECTURE_OVERVIEW.md    # 系统架构总览
│   ├── diagrams/               # 架构图
│   │   ├── generate_diagrams.py    # 架构图生成脚本
│   │   └── *.png               # 架构图文件
│   └── ...                     # 其他技术文档
├── backend/                    # Python FastAPI 主服务
├── web/                        # Next.js 16 前端
├── backend_massive_concurrent/ # Go 高并发引擎 (gRPC)
├── backend_safety/             # Rust 安全引擎 (gRPC)
├── services/                   # 独立微服务 (OCR)
├── proto/                      # Protocol Buffers 定义
├── scripts/                    # 脚本工具
├── storage/                    # 运行时数据 (gitignore)
├── tests/                      # 集成测试
├── desktop-pet/                # Tauri 桌面宠物
├── electron/                   # Electron 桌面应用
├── mobile/                     # Capacitor 移动端
├── browser-extension/          # 浏览器扩展
├── canvases/                   # Cursor Canvas 源码
├── .agent/skills/              # 18+ 专业技能定义
├── start_local.sh              # 一键本地启动
└── docker-compose.yml          # Docker 部署
```

---

## 后端目录详解 (`backend/`)

```
backend/
├── main.py                     # API 入口（所有路由、Agent 注册）
├── agents/                     # LangGraph Agent 编排
│   ├── bot.py                  # ReAct Agent
│   ├── planning_bot.py         # Plan-and-Execute Agent
│   ├── orchestrator.py         # Supervisor 编排器
│   ├── router.py               # 意图路由
│   ├── registry.py             # Agent 注册表
│   └── checkpoint.py           # 状态持久化
├── core/                       # 核心配置与业务规则
│   ├── llm_provider.py         # 多供应商 LLM 路由
│   ├── capabilities.py           # 能力注册表
│   ├── platform_capabilities.py  # 平台能力矩阵
│   ├── execution_approval.py   # 执行审批门控
│   ├── media_pipeline.py         # 媒体生产流水线
│   ├── research_artifact.py      # 研究产物规范化
│   ├── local_computer.py         # 本地计算机动作
│   └── companion_state.py        # AI 伙伴状态
├── tools/                      # 原子工具层
│   ├── connectors/             # 平台连接器
│   │   ├── feishu.py           # 飞书
│   │   ├── discord.py          # Discord
│   │   └── ...                 # 其他平台
│   ├── content/                # 内容创作 facade
│   ├── media/                  # 媒体生成 facade
│   └── multimodal_tools.py     # 多模态处理
├── services/                   # 业务服务
│   ├── scheduler.py            # 定时调度
│   ├── approval_service.py     # 审批服务
│   ├── computer_service.py     # My Computer 索引
│   ├── mcp_client.py           # MCP 客户端
│   ├── grpc_client.py          # gRPC 客户端
│   ├── memory_coordinator.py   # 记忆协调器
│   └── learning_data_pipeline.py # 学习数据管道
├── routers/                    # API 路由模块
│   ├── auth_router.py
│   └── users_router.py
├── utils/                      # 通用工具
│   ├── task_manager.py         # 任务管理
│   ├── auth.py / auth_db.py    # 认证与数据库
│   ├── logger.py               # 统一日志
│   ├── rag_manager.py          # RAG 管理
│   ├── chroma_client.py        # ChromaDB 客户端
│   └── trace_store.py          # Agent 执行追踪
├── admin/                      # 管理后台
├── assets/                     # 静态资源
├── tests/                      # 后端单元测试
└── generated/                  # protobuf 生成的 Python 代码
```

---

## 前端目录详解 (`web/`)

```
web/
├── app/                        # App Router
│   ├── page.tsx                # 主聊天界面
│   ├── workbench/              # 工作台
│   ├── settings/               # 设置中心
│   │   ├── capabilities/       # 能力配置
│   │   ├── context/            # My context（知识图谱 + Memory）
│   │   └── my-computer/        # My Computer 设置
│   ├── api/                    # API 代理路由
│   ├── companion/              # AI 伙伴（数字人）
│   ├── pipeline/               # 爆款流水线
│   ├── scheduler/              # 定时发布
│   ├── trending/               # 游戏热点
│   ├── create/                 # 内容创作
│   ├── media/                  # 媒体生成
│   ├── computer-use/           # Computer Use
│   ├── knowledge/              # 知识库
│   └── ...                     # 其他页面
├── components/                 # React 组件
│   ├── MarkdownSummaryPreview.tsx
│   ├── Sidebar.tsx
│   └── ...
├── contexts/                   # React Context
├── hooks/                      # 自定义 Hooks
├── lib/                        # 工具库（含 i18n）
├── messages/                   # 国际化文案
└── types/                      # TypeScript 类型
```

---

## 微服务目录

### Go 高并发引擎 (`backend_massive_concurrent/`)

```
backend_massive_concurrent/
├── cmd/server/                 # 入口
├── internal/directory/         # 目录检索服务
├── generated/                  # protobuf 生成的 Go 代码
└── docs/DESIGN.md              # Go 引擎架构设计
```

### Rust 安全引擎 (`backend_safety/`)

```
backend_safety/
├── src/                        # 源码
│   ├── grpc/                   # gRPC 服务
│   ├── parser/                 # 文档/视频解析
│   └── generated/              # protobuf 生成的 Rust 代码
└── docs/DESIGN.md              # Rust 引擎架构设计
```

### OCR 服务 (`services/ocr/`)

```
services/ocr/
├── server.py                   # gRPC 服务入口
└── engine.py                   # OCR 引擎
```

---

## 存储目录 (`storage/`)

```
storage/
├── outputs/                    # 生成的媒体文件
├── scheduler/                  # 定时任务配置和日志
├── traces/                     # Agent 执行追踪
├── approvals/                  # 审批记录
├── tasks/                      # 任务持久化
├── computer/                   # 本地动作审计
├── companion/                  # AI 伙伴状态
└── trending/                   # 热点数据缓存
```

---

## 技能目录 (`.agent/skills/`)

```
.agent/skills/
├── xiaohongshu-operator/       # 小红书运营
├── douyin-operator/            # 抖音运营
├── bilibili-operator/          # B站运营
├── youtube-operator/           # YouTube 运营
├── script-writer/            # 脚本生成
├── copywriting/                # 文案创作
├── video-editor/             # 视频编辑
├── media-production/           # 媒体生产
├── prompt-engineer/            # 提示词工程
├── seo-specialist/             # SEO 优化
├── data-analyst/             # 数据分析
├── game-trend-analyst/         # 游戏热点分析
├── rag-expert/                 # RAG 专家
└── moderation/                 # 内容审核
```

---

## 快速定位指南

| 我要找... | 去这里 |
|-----------|--------|
| 添加新 API 端点 | `backend/main.py` |
| 添加新 Agent | `backend/agents/` + `backend/main.py` 注册 |
| 添加新工具 | `backend/tools/` |
| 添加新页面 | `web/app/` |
| 添加新组件 | `web/components/` |
| 修改主题/样式 | `web/app/globals.css` |
| 查看日志 | `logs/` 或 `storage/` |
| 查看生成文件 | `storage/outputs/` |
| 查看架构图 | `docs/diagrams/` |

---

_文档版本：2026-06-10 · 与架构 V4 同步_
