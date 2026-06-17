# AI Media Agent — 文档中心

> 本文档索引帮助开发者快速定位所需技术文档。所有文档按主题分类，建议新开发者按「快速开始 → 架构理解 → 开发实践」顺序阅读。

---

## 📖 阅读指南

| 读者 | 推荐阅读顺序 |
|------|-------------|
| **新用户** | [README.md](../README.md) → [INSTALLATION.md](./INSTALLATION.md) → [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) |
| **开发者** | [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) → [ARCHITECTURE_OVERVIEW.md](./ARCHITECTURE_OVERVIEW.md) → [API_REFERENCE.md](./API_REFERENCE.md) |
| **架构师** | [ARCHITECTURE_OVERVIEW.md](./ARCHITECTURE_OVERVIEW.md) → [SECURITY_ARCHITECTURE.md](./SECURITY_ARCHITECTURE.md) → [STORAGE_ARCHITECTURE.md](./STORAGE_ARCHITECTURE.md) |
| **运维人员** | [DOCKER_DEPLOY_GUIDE.md](../DOCKER_DEPLOY_GUIDE.md) → [JENKINS_OPS.md](./JENKINS_OPS.md) → [OBSERVABILITY.md](./OBSERVABILITY.md) |
| **Agent 开发者** | [AGENTS.md](../AGENTS.md) → [AGENT_ROUTING_COLLABORATION.md](./AGENT_ROUTING_COLLABORATION.md) → [AGENT_ROUTING_DIAGRAMS.md](./AGENT_ROUTING_DIAGRAMS.md) |
| **投资人/管理层** | [INVESTOR_DECK.md](./INVESTOR_DECK.md) → [PROJECT_INTRO.md](./PROJECT_INTRO.md) → [ARCHITECTURE_OVERVIEW.md](./ARCHITECTURE_OVERVIEW.md) |

---

## 🚀 快速开始

| 文档 | 说明 | 目标读者 |
|------|------|----------|
| [README.md](../README.md) | 项目主文档：功能介绍、快速启动、技术栈 | 所有人 |
| [INSTALLATION.md](./INSTALLATION.md) | 安装指南：桌面安装包（DMG/ZIP）、环境配置 | 终端用户 |
| [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) | 开发者上手指南：启动、目录结构、添加功能、调试 | 开发者 |
| [PROJECT_INTRO.md](./PROJECT_INTRO.md) | 管理层版项目介绍 | 产品经理/管理层 |
| [FEATURE_LIST.md](./FEATURE_LIST.md) | **全量功能清单** — 54+ 技能、14+ 平台、42+ 模块的精确数据 | 所有人 |

---

## 🏗️ 架构文档

### 系统架构

| 文档 | 说明 | 关键内容 |
|------|------|----------|
| [ARCHITECTURE_OVERVIEW.md](./ARCHITECTURE_OVERVIEW.md) | **系统架构总览**（核心文档） | V4 三语言协作架构、整体架构图、子系统详解、数据流、部署架构 |
| [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md) | 前端架构 | Next.js 16、主题系统、组件分层、CSS 变量令牌 |
| [SECURITY_ARCHITECTURE.md](./SECURITY_ARCHITECTURE.md) | 安全架构 | 审批门控、沙箱、SSRF、加密、审计 |
| [STORAGE_ARCHITECTURE.md](./STORAGE_ARCHITECTURE.md) | 存储架构 | 文件系统、SQLite、ChromaDB、JSONL |

### 子系统架构

| 文档 | 说明 | 所属模块 |
|------|------|----------|
| [MEMORY_SYSTEM.md](./MEMORY_SYSTEM.md) | 记忆系统：生命周期、图文记录、命中审计、自学习闭环 | `backend/services/memory_*.py` |
| [SELF_LEARNING_SYSTEM.md](./SELF_LEARNING_SYSTEM.md) | 自学习系统：任务复盘、反馈信号、curator 报告 | `backend/services/learning_*.py` |
| [COMPUTER_SERVICE.md](./COMPUTER_SERVICE.md) | My Computer 本地索引服务 | `backend/services/computer_service.py` |
| [MCP_CLIENT.md](./MCP_CLIENT.md) | MCP 协议客户端 | `backend/services/mcp_client.py` |
| [DOCUMENT_PARSING_FLOW.md](./DOCUMENT_PARSING_FLOW.md) | 文档上传解析流程（Python/Rust 降级路径） | `backend/tools/multimodal_tools.py` |

### 微服务架构

| 文档 | 说明 | 路径 |
|------|------|------|
| [backend_massive_concurrent/docs/DESIGN.md](../backend_massive_concurrent/docs/DESIGN.md) | Go 高并发引擎架构 | `backend_massive_concurrent/` |
| [backend_safety/docs/DESIGN.md](../backend_safety/docs/DESIGN.md) | Rust 安全引擎架构 | `backend_safety/` |

---

## 🤖 Agent 与 AI 系统

| 文档 | 说明 | 关键内容 |
|------|------|----------|
| [AGENTS.md](../AGENTS.md) | Agent 协作指南与开发规范 | Agent 注册、编排模式、开发规范 |
| [AGENT_ROUTING_COLLABORATION.md](./AGENT_ROUTING_COLLABORATION.md) | Agent 路由协作详细说明 | 意图路由、Supervisor 模式、协作流程 |
| [AGENT_ROUTING_DIAGRAMS.md](./AGENT_ROUTING_DIAGRAMS.md) | 路由与协作流程图（Mermaid） | 可视化流程图 |
| [SUPER_AGENT_TODO.md](./SUPER_AGENT_TODO.md) | 超级 Agent / 安全执行面实施进度 | 能力注册、审批、任务、平台动作 |
| [HERMES_ALIGNMENT_TODO.md](./HERMES_ALIGNMENT_TODO.md) | Hermes 范式对齐实施清单 | 架构对齐、运行时四层 |
| [HERMES_INTEGRATION.md](./HERMES_INTEGRATION.md) | Hermes 集成说明 | 集成要点与状态 |

---

## 🔌 平台与集成

| 文档 | 说明 | 关键内容 |
|------|------|----------|
| [PLATFORM_CONNECTION_GUIDE.md](./PLATFORM_CONNECTION_GUIDE.md) | 平台连接用户指南 | OAuth、扫码、插件方式获取凭证 |
| [PLATFORM_CONNECTION_IMPLEMENTATION.md](./PLATFORM_CONNECTION_IMPLEMENTATION.md) | 平台连接实现说明 | 连接器实现、认证流程 |
| [GITHUB_OAUTH_QUICKSTART.md](./GITHUB_OAUTH_QUICKSTART.md) | GitHub OAuth 快速配置 | GitHub App 配置步骤 |
| [OAUTH_IMPLEMENTATION_GUIDE.md](./OAUTH_IMPLEMENTATION_GUIDE.md) | OAuth 实现指南 | 通用 OAuth 流程 |

---

## 🛠️ 开发运维

| 文档 | 说明 | 关键内容 |
|------|------|----------|
| [API_REFERENCE.md](./API_REFERENCE.md) | 后端 API 接口参考手册 | 167+ 端点、请求/响应格式 |
| [TESTING_GUIDE.md](./TESTING_GUIDE.md) | 测试分层与 Mock 策略 | 单元测试、集成测试、E2E |
| [OBSERVABILITY.md](./OBSERVABILITY.md) | 可观测性：日志、Trace、监控 | 日志结构、追踪系统、告警 |
| [CANVAS_OVERVIEW.md](./CANVAS_OVERVIEW.md) | Cursor Canvas 工作区速览 | IDE 彩色图表、双路径、维护指南 |
| [NEXTJS15_PARAMS_FIX.md](./NEXTJS15_PARAMS_FIX.md) | Next.js 15 参数修复 | 动态路由参数处理 |
| [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) | 项目结构速查 | 目录详解与快速定位指南 |

---

## 🚀 部署与运维

| 文档 | 说明 | 关键内容 |
|------|------|----------|
| [DOCKER_DEPLOY_GUIDE.md](../DOCKER_DEPLOY_GUIDE.md) | Docker 生产部署指南 | Docker Compose、Nginx、HTTPS |
| [WINDOWS_DEPLOYMENT.md](./WINDOWS_DEPLOYMENT.md) | Windows 部署指南 | Windows 环境特殊配置 |
| [JENKINS_OPS.md](./JENKINS_OPS.md) | Jenkins 运维 | CI/CD 流水线 |
| [LOCAL_JENKINS_SETUP.md](./LOCAL_JENKINS_SETUP.md) | 本地 Jenkins 搭建 | 开发环境 CI |

---

## 🎨 产品功能

| 文档 | 说明 | 关键内容 |
|------|------|----------|
| [DESKTOP_PET.md](./DESKTOP_PET.md) | 桌面宠物（AI 伴侣） | Tauri + Svelte 实现 |
| [LLM_WIKI_LAYER.md](./LLM_WIKI_LAYER.md) | LLM Wiki 分层 | 知识分层设计 |
| [MEMORY_EVOLUTION_ROADMAP.md](./MEMORY_EVOLUTION_ROADMAP.md) | 记忆系统演进路线图 | 未来规划 |

---

## 💼 投资与商业

| 文档 | 说明 | 目标读者 |
|------|------|----------|
| [INVESTOR_DECK.md](./INVESTOR_DECK.md) | **投资路演文档** — 市场机会、商业模式、发展路线图、融资计划 | 投资人、管理层、战略合作伙伴 |
| [PROJECT_INTRO.md](./PROJECT_INTRO.md) | 管理层版项目介绍 — 人力成本与效率分析 | 产品经理/管理层 |
| [FEATURE_LIST.md](./FEATURE_LIST.md) | **全量功能清单** — 54+ 技能、14+ 平台、42+ 模块的精确数据与分类 | 投资人、产品经理、开发者 |

---

## 📊 架构图目录

可视化架构图存放于 `docs/diagrams/` 目录：

### 系统架构图

| 图表 | 文件 | 说明 |
|------|------|------|
| 系统整体架构图 | `diagrams/system_architecture.png` | 五层架构：用户层 → 前端 → 后端 → 微服务 → 存储 |
| 数据流图 | `diagrams/data_flow.png` | 典型请求：生成视频并发布 |
| 三语言协作图 | `diagrams/multi_language_arch.png` | Python + Go + Rust 协作关系 |
| 部署架构图 | `diagrams/deployment_arch.png` | 本地开发 vs Docker 生产部署 |
| 模块关系图 | `diagrams/module_relations.png` | 核心模块依赖关系 |

### 投资与商业图表

| 图表 | 文件 | 说明 |
|------|------|------|
| 市场增长趋势 | `diagrams/market_growth.png` | 全球 AIGC 市场规模（2020-2032） |
| 商业模式 | `diagrams/business_model.png` | 收入结构预测 + 目标客户分布 |
| 竞争格局 | `diagrams/competitive_landscape.png` | 全链路能力对比分析 |
| 发展路线图 | `diagrams/roadmap_timeline.png` | 三阶段战略规划时间轴 |
| 技能体系分布 | `diagrams/skills_distribution.png` | 54+ 垂直技能分类统计 |
| 平台连接器覆盖 | `diagrams/platform_connectors.png` | 14+ 社交媒体平台连接状态 |
| 功能模块全景 | `diagrams/feature_modules.png` | 42+ 前端功能模块分组展示 |

**维护脚本**：`docs/diagrams/generate_diagrams.py`

```bash
# 重新生成所有架构图
python docs/diagrams/generate_diagrams.py
```

> 架构图使用 Python matplotlib 生成，依赖：`pip install matplotlib numpy`。字体优先使用 PingFang HK / Arial Unicode MS 确保中文显示。

---

## 📝 文档维护规范

1. **新增文档**：按主题放入对应分类，并更新本文档索引
2. **文档命名**：使用大写蛇形命名（如 `API_REFERENCE.md`）
3. **版本标记**：文档末尾标注版本日期，如 `_文档版本：2026-05-31_`
4. **交叉引用**：引用其他文档时使用相对路径，如 `[ARCHITECTURE_OVERVIEW.md](./ARCHITECTURE_OVERVIEW.md)`
5. **Mermaid 图表**：架构文档优先使用 Mermaid 语法，便于版本控制

---

_文档索引版本：2026-06-13 · 与架构 V4 同步 · 新增全量功能清单（FEATURE_LIST.md）与商业图表（12 张）_
