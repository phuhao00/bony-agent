# AI Media Agent — 开发者快速上手指南

> 面向开发者的集中式参考：环境启动、目录结构、添加功能、测试、调试与排障。

---

## 一、本地开发环境启动

### 1.1 一键启动（推荐）

```bash
./start_local.sh
```

该脚本自动完成以下工作：

| 步骤 | 说明 |
|------|------|
| 清理旧进程 | 释放端口 8000/3000/50051/50052/50053 |
| Proto 生成 | 检查并生成 Python gRPC stubs（`backend/generated/mediaagent/`） |
| Backend | 启动 FastAPI `:8000`（自动选择 `backend/.venv` → `.venv` → `venv`） |
| OCR Service | 启动 Python gRPC `:50051`（可选） |
| Parser Service | 编译/启动 Rust gRPC `:50052`（可选，降级为 Python fallback） |
| Directory Service | 编译/启动 Go gRPC `:50053`（可选） |
| Frontend | 启动 Next.js `:3000`（`npm run dev`） |

启动成功后访问：
- 前端：`http://localhost:3000`
- 后端 API：`http://localhost:8000`
- API 文档：`http://localhost:8000/docs`

### 1.2 手动启动各服务

```bash
# Backend (FastAPI)
cd backend
source ../venv/bin/activate  # 或 backend/.venv/bin/activate
export PYTHONPATH="$(pwd):${PYTHONPATH:-}"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (Next.js)
cd web
npm run dev -- -H 0.0.0.0

# Rust Parser Service (optional)
cd backend_safety
cargo build --release
PARSER_PORT=50052 ./target/release/parser-service

# Go Directory Service (optional)
cd backend_massive_concurrent
go build -o bin/directory-service ./cmd/server
DIRECTORY_PORT=50053 ./bin/directory-service
```

### 1.3 服务端口速查

| 服务 | 端口 | 协议 | 代码路径 |
|------|------|------|----------|
| FastAPI 主服务 | 8000 | HTTP/REST + SSE | `backend/main.py` |
| Next.js 前端 | 3000 | HTTP | `web/` |
| OCR Service | 50051 | gRPC | `services/ocr/server.py` |
| Rust Parser | 50052 | gRPC | `backend_safety/target/release/parser-service` |
| Go Directory | 50053 | gRPC | `backend_massive_concurrent/bin/directory-service` |

---

## 二、前后端目录结构速查

### 2.1 Python 后端 (`backend/`)

```
backend/
├── main.py                    # API 入口：所有路由、Agent 注册、配置加载
├── agents/                    # LangGraph Agent
│   ├── bot.py                 # ReAct Agent
│   ├── planning_bot.py        # Plan-and-Execute Agent
│   ├── orchestrator.py        # Supervisor 编排器
│   ├── router.py              # 意图路由（关键词 + LLM 兜底）
│   ├── registry.py            # Agent 注册表
│   └── ...
├── core/                      # 核心配置与业务规则
│   ├── llm_provider.py        # 多供应商 LLM 路由
│   ├── capabilities.py          # 能力注册表
│   ├── platform_capabilities.py # 平台能力矩阵
│   ├── execution_approval.py    # 执行审批门控
│   ├── media_pipeline.py        # 媒体生产流水线
│   ├── research_artifact.py     # 研究产物规范化
│   ├── local_computer.py        # 本地计算机动作
│   ├── companion_state.py       # AI 伙伴状态
│   └── ...
├── tools/                     # 原子工具层
│   ├── connectors/            # 平台连接器（飞书、Discord 等）
│   ├── content/               # 内容创作 facade
│   ├── media/                 # 媒体生成 facade
│   ├── multimodal_tools.py    # 多模态处理
│   └── ...
├── services/                  # 业务服务
│   ├── scheduler.py           # 定时调度
│   ├── approval_service.py    # 审批服务
│   ├── computer_service.py    # My Computer 索引
│   ├── computer_use_service.py # Computer Use 浏览器自动化
│   ├── mcp_client.py          # MCP 客户端
│   ├── grpc_client.py         # gRPC 客户端 (OCR:50051 / Parser:50052 / Directory:50053)
│   ├── memory_coordinator.py  # 记忆协调器
│   ├── memory_evaluation.py   # 记忆命中评估
│   ├── memory_quality.py      # 记忆质量评分
│   ├── learning_data_pipeline.py # 学习数据管道
│   ├── learning_curator.py    # 学习策展人
│   ├── evolution_signals.py   # 进化信号采集
│   ├── reflection_loop.py     # 任务复盘
│   ├── connections_summary.py # 连接摘要
│   ├── knowledge_layers.py    # 知识分层
│   ├── session_recall.py      # 会话召回
│   ├── wiki_compiler.py       # Wiki 编译器
│   ├── mcp_managed_launcher.py # MCP 托管启动器
│   ├── mcp_presets.py         # MCP 预设配置
│   └── context_knowledge_graph.py # 上下文知识图谱
├── routers/                   # API 路由模块
│   ├── auth_router.py
│   └── users_router.py
├── utils/                     # 通用工具
│   ├── task_manager.py        # 任务管理
│   ├── auth.py / auth_db.py   # 认证与数据库
│   ├── logger.py              # 统一日志
│   ├── rag_manager.py         # RAG 管理
│   ├── chroma_client.py       # ChromaDB 客户端
│   ├── trace_store.py         # Agent 执行追踪
│   ├── history_manager.py     # 历史记录管理
│   ├── media_resolver.py      # 媒体路径解析
│   ├── oauth_manager.py       # OAuth 管理
│   └── simple_ddg_search.py   # DuckDuckGo 搜索
├── admin/                     # 管理后台
├── assets/                    # 静态资源
├── memory_storage/            # 内存存储运行时数据
├── tests/                     # 后端单元测试
└── generated/                 # protobuf 生成的 Python 代码
```

### 2.2 Next.js 前端 (`web/`)

```
web/
├── app/                       # App Router
│   ├── page.tsx               # 主聊天界面
│   ├── workbench/             # 工作台
│   ├── settings/              # 设置中心
│   │   ├── capabilities/      # 能力配置（6 个 Tab）
│   │   ├── context/           # My context（知识图谱 + Memory）
│   │   └── my-computer/       # My Computer 设置
│   ├── api/                   # API 代理路由（对应后端每个端点）
│   └── ...
├── components/                # React 组件
│   ├── MarkdownSummaryPreview.tsx
│   ├── Sidebar.tsx
│   └── ...
└── contexts/                  # React Context
```

---

## 三、如何添加新功能

### 3.1 添加新 Agent

1. **创建 Agent 模块**：`backend/agents/my_agent.py`
   - 继承 `BaseAgent` 或实现 `as_node()` / `get_executor()`
2. **注册到 Registry**：在 `backend/main.py` 中找到 Agent 注册区（约 332 行）
   ```python
   _registry.register("my_agent", get_my_base_agent, description="...", capabilities=["..."])
   ```
3. **添加路由关键词**（可选）：在 `backend/agents/router.py` 的 `_KEYWORD_RULES` 中添加匹配规则
4. **添加系统提示词**（可选）：在 `backend/core/prompts/` 下创建 `zh/` 和 `en/` 版本

### 3.2 添加新工具

1. **创建工具函数**：`backend/tools/my_tools.py`
   ```python
   from langchain.tools import tool
   from utils.logger import setup_logger
   logger = setup_logger("my_tools")

   @tool
   def my_tool(param: str) -> str:
       """工具描述 - 用于 Agent 理解"""
       return result
   ```
2. **暴露给 Agent**：在对应 Agent 的工厂函数中将工具传入 `extra_tools`

### 3.3 添加新 API 端点

1. **后端**：在 `backend/main.py` 中添加 FastAPI 路由
   ```python
   @app.post("/my-endpoint")
   async def my_endpoint(req: MyRequest):
       return {"success": True}
   ```
2. **前端代理**：在 `web/app/api/my-endpoint/route.ts` 中添加 Next.js API Route
   ```typescript
   export async function POST(request: Request) {
     const body = await request.json();
     const res = await fetch(`${BACKEND_URL}/my-endpoint`, {...});
     return NextResponse.json(await res.json());
   }
   ```
3. **前端调用**：在对应组件中调用 `fetch('/api/my-endpoint')`

---

## 四、测试

### 4.1 后端测试

```bash
# 运行超级 Agent 基础测试（行为测试 + 审批/任务/能力/Computer Use）
/Users/tutu/Documents/agent/venv/bin/python /Users/tutu/Documents/agent/tests/test_super_agent_foundation.py

# Computer Use API 集成测试
/Users/tutu/Documents/agent/venv/bin/python /Users/tutu/Documents/agent/tests/test_computer_use_api.py

# 其他测试
python -m unittest tests/test_multi_agent.py
python -m unittest tests/test_mixed_routing.py
python -m unittest tests/test_lobster.py
```

### 4.2 前端 ESLint

```bash
cd web
npx eslint app/settings/capabilities/CapabilitiesApprovalsTab.tsx
npx eslint app/computer-use/page.tsx
# 或全量（有历史 lint 债务）
npm run lint
```

### 4.3 健康检查

```bash
curl http://localhost:8000/health
```

---

## 五、关键环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `ZHIPUAI_API_KEY` | 智谱 AI API Key | `sk-xxx` |
| `GOOGLE_API_KEY` | Google Gemini API Key | `AIza...` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | `sk-xxx` |
| `BYTEDANCE_API_KEY` | 字节豆包 API Key | `Bearer xxx` |
| `OPENROUTER_API_KEY` | OpenRouter API Key | `sk-or-xxx` |
| `JIMENG_ACCESS_KEY` + `SECRET_KEY` | 即梦 AI 密钥 | — |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright 浏览器路径 | `./.browsers` |
| `BACKEND_URL` | 后端地址 | `http://127.0.0.1:8000` |
| `PARSER_SERVICE_ADDR` | Rust 解析 gRPC | `localhost:50052` |
| `DIRECTORY_SERVICE_ADDR` | Go 目录 gRPC | `localhost:50053` |

---

## 六、调试与日志

### 6.1 日志文件位置

| 日志 | 路径 | 内容 |
|------|------|------|
| 启动总日志 | `logs/start.log` | `start_local.sh` 输出 |
| 后端主日志 | `logs/backend.log` | FastAPI 运行日志 |
| 调试日志 | `logs/backend_debug.log` | 详细调试 |
| OCR 服务 | `logs/ocr.log` | OCR gRPC 服务 |
| 解析服务 | `logs/parser.log` | Rust Parser 服务 |
| 目录服务 | `logs/directory.log` | Go Directory 服务 |
| Agent 日志 | `logs/agent.log` | Agent 执行日志 |

### 6.2 各模块 Logger 名

```python
# 在代码中使用
from utils.logger import setup_logger
logger = setup_logger("module_name")

# 常用 logger 名
"multimodal_tools"   # 多模态工具
"grpc_client"        # gRPC 客户端
"mcp_client"         # MCP 客户端
"approval_service"   # 审批服务
"computer_service"   # My Computer
"memory_coordinator" # 记忆协调器
"media_pipeline"     # 媒体流水线
```

### 6.3 实时查看日志

```bash
# 后端
tail -f logs/backend.log

# 启动总控
tail -f logs/start.log

# 所有日志（多窗口）
tail -f logs/*.log
```

---

## 七、故障排查速查表

| 问题 | 诊断 | 解决方案 |
|------|------|----------|
| 端口 8000/3000 被占用 | `lsof -ti:8000,3000` | `lsof -ti:8000,3000 \| xargs kill -9` |
| Backend 启动后立即退出 | 查看 `logs/backend.log` 末尾 | 检查 Python 依赖、环境变量、端口冲突 |
| Proto stubs 缺失 | `backend/generated/mediaagent/` 为空 | 运行 `bash scripts/gen_proto.sh` |
| Rust Parser 未启动 | `logs/parser.log` 无输出 | 检查 `cargo` 是否安装，或手动 `cargo build --release` |
| Go Directory 未启动 | `logs/directory.log` 无输出 | 检查 `go` 是否安装，或手动 `go build` |
| Playwright 浏览器缺失 | `playwright install chromium` | `python -m playwright install chromium` |
| 前端 `npm run dev` 失败 | 检查 `node_modules` | `cd web && npm install` |
| gRPC 调用降级 | Python 日志出现 `falling back` | Rust/Go 服务未启动时会自动降级到 Python 实现 |
| MCP 服务器连接失败 | `POST /api/mcp/servers/{id}/ping` | 检查 MCP 服务器是否运行、URL 是否正确 |
| 审批通过后未恢复 | 查看 `storage/tasks/` 状态 | 确认 `auto_resume_*` 参数或手动 Resume |
| 记忆写入失败 | 检查 ChromaDB 状态 | Chroma 不可用时自动降级到 JSON 存储 |
| SSE 长视频流中断（UND_ERR_BODY_TIMEOUT） | Next.js `fetch(undici)` 默认 300s 超时 | 已改用原生 `http(s).request` 代理，`maxDuration = 800` |
| 前端无法播放 `/media/xxx.mp4` | FastAPI 静态路由在 Next.js :3000 不可用 | 走 `/api/media/{filename}` 磁盘代理（`normaliseMediaUrl` 自动映射） |
| 长视频默认时长不符预期 | 检查 `LongVideoRequest.duration_sec` | 默认 30 秒（范围 30–120），用户明确表达长度时才传入自定义值 |

---

## 八、常用开发命令

```bash
# 安装单个 Python 包（严禁 rm -rf venv）
pip install <package>

# 生成 protobuf stubs
bash scripts/gen_proto.sh

# 格式化 Python 代码（如项目已配置）
python -m black backend/

# 前端依赖更新
cd web && npm install

# 查看所有运行中的服务进程
ps aux | grep -E "uvicorn|next|parser-service|directory-service|ocr"

# 清理 storage 临时文件（谨慎）
rm -rf storage/temp/*
```

---

## 八、Cursor Canvas 工作区速览

IDE 内可打开 **`ai-media-agent-overview`** Canvas，与本文档互补：含彩色饼/柱/折线图、架构 SVG、路由与 API 速查、Electron/iOS 打包说明。

| 要点 | 说明 |
|------|------|
| 源码（Git） | `canvases/ai-media-agent-overview.canvas.tsx` |
| IDE 渲染 | `~/.cursor/projects/<workspace>/canvases/`（修改后需 `cp` 同步） |
| 完整说明 | [`docs/CANVAS_OVERVIEW.md`](CANVAS_OVERVIEW.md) |

```bash
cp canvases/ai-media-agent-overview.canvas.tsx \
  ~/.cursor/projects/Users-tutu-Documents-agent/canvases/
```

---

## 九、相关文档

| 文档 | 说明 |
|------|------|
| `README.md` | 项目主文档与快速开始 |
| `AGENTS.md` | Agent 协作指南与开发规范 |
| `docs/ARCHITECTURE_OVERVIEW.md` | 系统架构总览（含运行时四层） |
| `docs/CANVAS_OVERVIEW.md` | Cursor Canvas 工作区速览（彩色图、IDE 同步） |
| `docs/API_REFERENCE.md` | 后端 API 接口参考手册 |
| `docs/SECURITY_ARCHITECTURE.md` | 安全架构：审批、沙箱、SSRF、加密与审计 |
| `docs/STORAGE_ARCHITECTURE.md` | 存储架构：文件系统、SQLite、ChromaDB、JSONL |
| `docs/FRONTEND_ARCHITECTURE.md` | 前端架构：Next.js 16、主题系统、组件分层 |
| `docs/TESTING_GUIDE.md` | 测试分层：行为测试、集成测试、Mock 策略 |
| `docs/OBSERVABILITY.md` | 可观测性：日志、Trace、监控、告警与排障 |
| `docs/AGENT_ROUTING_DIAGRAMS.md` | 路由与协作流程图（Mermaid） |
| `docs/SUPER_AGENT_TODO.md` | 超级 Agent 实施进度与验证命令 |
| `docs/HERMES_ALIGNMENT_TODO.md` | Hermes 范式对齐实施清单 |
| `DOCKER_DEPLOY_GUIDE.md` | Docker 生产部署指南（含 HTTPS/Nginx） |

---

_文档版本：2026-05-31 · 与当前代码库同步（增补 §八 Cursor Canvas）_
