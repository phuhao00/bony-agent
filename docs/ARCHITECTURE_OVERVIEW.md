# AI Media Agent — 系统架构总览

> 面向开发者的完整架构指南，涵盖前端、Python 主服务、Go 高并发引擎、Rust 安全引擎及所有子系统。

---

## 一、架构演进

```mermaid
flowchart LR
    V1["V1: Python 单体<br/>FastAPI + Next.js"]
    V2["V2: + Agent 协作<br/>LangGraph + 14+ Agents"]
    V3["V3: + 多模态 + MCP<br/>图片/音频/视频输入"]
    V4["V4: + 多语言 + 微服务<br/>Go + Rust + gRPC"]

    V1 --> V2 --> V3 --> V4

    style V1 fill:#E3F2FD
    style V2 fill:#E8F5E9
    style V3 fill:#FFF3E0
    style V4 fill:#FFEBEE
```

当前版本：**V4** — 三语言协作架构

---

## 二、整体架构图

```mermaid
flowchart TB
    subgraph Users["用户层"]
        U1[Web 浏览器]
        U2[API 客户端]
    end

    subgraph Frontend["前端层 (Next.js 16) — 37+ 页面"]
        F1[AI 对话 /page.tsx]
        F2[工作台 /workbench/]
        F3[创作中心 /create/]
        F4[媒体生成 /media/]
        F5[知识库 /knowledge/]
        F6[平台管理 /platforms/]
        F7[定时发布 /scheduler/]
        F8[游戏热点 /trending/]
        F9[AI 伙伴 /companion/]
        F10[爆款流水线 /pipeline/]
        F11[Computer Use /computer-use/]
        F12[Hermes Agent /hermes-agent/]
        F13[Lark CLI /lark-cli/]
        F14[历史记录 /history/]
        F15[内容审核 /moderation/]
        F16[OpenClaw /openclaw/]
        F17[架构图 /architecture/]
        F18[My Computer /settings/my-computer/]
        F19[Capabilities /settings/capabilities/]
        F20[AI 资讯日报 /ai-news/]
        F21[Claude Code /claude-code/]
        F22[Labs /labs/]
        F23[Financial News /financial-news/]
        F24[Game Art /game-art/]
        F25[Game Design /game-design/]
        F26[System Assistant /system-assistant/]
        F27[Desktop Operator /desktop-operator/]
        F28[Customer Service /customer-service/]
        F29[Programmer /programmer/]
        F30[Desktop Pet /desktop-pet/]
        F31[Product Manager /product-manager/]
        F32[Legal Advisor /legal-advisor/]
        F33[Ad Campaign /ad-campaign/]
        F34[Business Partnership /business-partnership/]
        F35[Procurement Assistant /procurement-assistant/]
        F36[Workflows /workflows/]
        F37[Meal /meal/]
    end

    subgraph Backend["后端层 (FastAPI)"]
        API[API Router / main.py]

        subgraph Core["核心层"]
            C1[LLM Provider]
            C2[Media Models]
            C3[Prompts 多语言]
            C4[Capabilities · Platform · Execution Approval]
            C5[Media Pipeline · Research Artifact]
            C6[Workflow Engine · Recipe Modules]
            C7[System / Desktop Profiles]
        end

        subgraph Agents["Agent 层 (LangGraph) — 23 个注册 Agent"]
            A_Runtime[运行时 / 路由<br/>Planning · Orchestrator · Router]
            A_Media[媒体创作<br/>media · image_edit · video_editor · opencut · long_video]
            A_Content[内容创作<br/>creative · copywriter · script_writer · trend_analyst · reviewer]
            A_Labs[专业助手 Labs<br/>PM · Legal · Ad · BD · Procurement · GameArt · GameDesign · Programmer]
            A_System[系统 / 桌面 / 代码<br/>system_assistant · desktop_operator · code_analyst · architect]
            A_Lobster[Lobster 分布式流水线]
        end

        subgraph Tools["工具层"]
            T1[内容 · 媒体 · 社交 facade]
            T2[multimodal_tools · RAG]
            T3[连接器 connectors]
        end

        subgraph Services["服务层"]
            S1[Scheduler]
            S2[Computer Service · Use]
            S3[MCP Client]
            S4[gRPC Client → Go/Rust/OCR]
            S5[Approval · Task · Capabilities]
            S6[Memory · Evolution · Reflection]
            S7[Labs Services<br/>PM · Legal · Ad · BD · Procurement · Game]
            S8[Native Desktop · System Assistant]
            S9[Customer Service · Workflows]
        end
    end

    subgraph Microservices["微服务层 (gRPC)"]
        subgraph GoSvc["Go 高并发引擎 (:50053)"]
            G1[Directory Service]
        end

        subgraph RustSvc["Rust 安全引擎 (:50052)"]
            R1[Document Parser]
            R2[Video Parser]
            R3[Crypto Service]
            R4[Keystore]
        end

        subgraph OCRSvc["OCR Service (:50051)"]
            O1[图片文字识别]
        end
    end

    subgraph External["外部服务"]
        LLM[LLM 供应商<br/>智谱 · Gemini · DeepSeek · OpenRouter …]
        Media[媒体生成<br/>即梦 · SeaDance · CogVideoX …]
        MCP[MCP 服务器]
    end

    subgraph Storage["存储层"]
        DB1[ChromaDB 向量库]
        DB2[SQLite auth.db]
        DB3[JSON 配置]
        DB4[本地文件系统]
    end

    U1 --> Frontend
    Frontend -->|HTTP/REST| API

    API --> Agents
    API --> Tools
    API --> Services

    Agents --> Core
    Agents --> Tools

    S3 -->|MCP 协议| MCP
    S4 -->|gRPC| GoSvc
    S4 -->|gRPC| RustSvc
    S4 -->|gRPC| OCRSvc

    Tools -->|调用| LLM
    Tools -->|调用| Media

    Services --> Storage
    Tools --> Storage
    RustSvc --> Storage
    OCRSvc --> Storage

    style Frontend fill:#E3F2FD
    style Backend fill:#E8F5E9
    style Microservices fill:#FFEBEE
    style External fill:#FFF3E0
    style Storage fill:#E0F7FA
```

---

## 三、三语言协作详解

### 3.1 职责划分

| 语言       | 服务           | 核心职责                                 | 性能目标                        |
| ---------- | -------------- | ---------------------------------------- | ------------------------------- |
| **Python** | FastAPI 主服务 | Agent 编排、LLM 调用、业务逻辑、API 网关 | 快速迭代、生态丰富              |
| **Go**     | 高并发引擎     | 目录检索、批量抓取、文件监控、聚合查询   | ≥500 URL/s 抓取吞吐             |
| **Rust**   | 安全引擎       | 二进制解析、加密、私钥存储、OCR          | 流式解析 GB 级文件，内存 <128MB |

### 3.2 通信方式

```mermaid
flowchart LR
    PY["Python FastAPI"]
    GO["Go (:50053)"]
    RS["Rust (:50052)"]
    OCR["OCR (:50051)"]

    PY -->|gRPC + TLS| GO
    PY -->|gRPC + mTLS| RS
    PY -->|gRPC| OCR

    style PY fill:#E3F2FD
    style GO fill:#E8F5E9
    style RS fill:#FFEBEE
```

**Protocol Buffers** 定义在 `proto/mediaagent/` 目录：

| Proto 文件        | 用途                     |
| ----------------- | ------------------------ |
| `common.proto`    | 通用类型、错误码         |
| `directory.proto` | 目录搜索、文件监控       |
| `document.proto`  | 文档解析（PDF/DOCX/TXT） |
| `video.proto`     | 视频解析（MP4/MKV）      |
| `ocr.proto`       | 图片文字识别             |

---

## 四、核心子系统

### 4.1 Agent 协作系统

基于 LangGraph StateGraph 的 Supervisor 模式：

```mermaid
flowchart TB
    User["用户输入"] --> Router{IntentRouter}

    Router -->|简单任务| Single["单步 Agent<br/>ReAct 模式"]
    Router -->|复杂任务| Multi["多步规划<br/>Plan-and-Execute"]
    Router -->|审核任务| Review["Reviewer Agent"]

    Multi --> Supervisor["Supervisor 决策"]
    Supervisor --> Agent1["Agent A"]
    Agent1 --> Supervisor
    Supervisor --> Agent2["Agent B"]
    Agent2 --> Supervisor
    Supervisor -->|完成| Output["最终结果"]

    Single --> Output
    Review --> Output
```

### 4.2 多模态输入系统

**文档类上传（PDF/DOCX 等）的端到端解析流程**（含 Rust gRPC 与降级路径）见专文：[DOCUMENT_PARSING_FLOW.md](./DOCUMENT_PARSING_FLOW.md)。

```mermaid
flowchart LR
    Input["用户上传"] --> Detect{类型检测}

    Detect -->|图片| Img["图片处理"]
    Detect -->|音频| Aud["音频处理"]
    Detect -->|视频| Vid["视频处理"]

    Img --> OCR["Rust OCR"]
    Img --> Vision["LLM Vision"]

    Aud --> ASR["ASR 转录"]

    Vid --> Frame["帧提取"]
    Vid --> Audio["音频分离"]
    Vid --> Rust["Rust Video Parser"]

    OCR & Vision & ASR & Frame & Audio --> Context["LLM 上下文组装"]
```

### 4.3 RAG 知识库系统

```mermaid
flowchart LR
    Doc["文档上传"] --> Parse["解析 (Python/Rust)"]
    Parse --> Chunk["文本分块"]
    Chunk --> Embed["向量化"]
    Embed --> Chroma[(ChromaDB)]

    Query["用户查询"] --> QEmbed["查询向量化"]
    QEmbed --> Search["相似度检索"]
    Chroma --> Search
    Search --> Rank["重排序"]
    Rank --> LLM["LLM 生成回答"]
```

### 4.4 定时发布系统

```mermaid
flowchart TB
    Scheduler["APScheduler"] --> Trigger{触发器}

    Trigger -->|Cron| Job1["定时任务"]
    Trigger -->|Interval| Job2["间隔任务"]

    Job1 --> Agent["Agent 生成内容"]
    Job2 --> Agent

    Agent --> Media["媒体生成"]
    Agent --> Text["文案生成"]

    Media --> Publish["平台发布"]
    Text --> Publish

    Publish --> Log["执行日志"]
```

### 4.5 前端界面层：主题令牌与关键页面

主应用在 **`web/app/globals.css`** 中通过 CSS 变量统一明暗壳层（根节点 `:root`、`html.theme-dark`、`html.theme-light`），避免页面各处硬编码 `slate-*` / `bg-white` 导致深色模式下对比度崩溃。

| 变量 / 类                                            | 用途                                  |
| ---------------------------------------------------- | ------------------------------------- |
| `--shell-bg`                                         | 应用工作区底色                        |
| `--foreground` / `--label-secondary`                 | 主文案 / 次级标签                     |
| `--card-bg`、`--chrome-rail-bg`、`--nav-active-fill` | 卡片、侧栏轨、列表 hover              |
| `--separator` / `--separator-subtle`                 | 分割线                                |
| `--accent`                                           | 品牌强调（按钮、聚焦环等）            |
| `--status-danger-*` / `--status-success-*`           | 错误 / 成功提示文字与衬底（深浅可读） |
| `.page-canvas`                                       | 内页画布（继承 `--foreground`）       |
| `.card-surface`                                      | 实心卡片 + 发丝边框 + 轻阴影          |
| `.popover-vibrant`                                   | 对话框 / 浮层磨砂底                   |

**约定：**列表、表单、对话 Markdown 等用户可读正文优先使用 `text-[color:var(--foreground)]`（或等价令牌），勿在同一个深色卡片上再叠浅色主题的 `text-slate-800`。

**关键路径：**

| 路径                                        | 说明                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `web/app/page.tsx`                          | 主对话；助手气泡用 `card-surface`，正文 Markdown 由 `MarkdownSummaryPreview` 渲染                                            |
| `web/components/MarkdownSummaryPreview.tsx` | 对话内 Markdown 组件映射（标题、段落、表格等），已与令牌对齐                                                                 |
| `web/app/settings/capabilities/`            | **能力配置**：能力矩阵、审批与任务、`args_preview` 预览；Computer Use 相关入口与代理 API                                     |
| `web/app/settings/context/`                 | **My context**：知识图谱（`KnowledgeGraphPanel.tsx`）+ 上下文记忆列表（`MemoryPanel.tsx`），面板工具条与条目卡片同上令牌体系 |
| `web/app/ai-news/page.tsx`                  | AI 资讯日报：HF Models / GitHub AI / 𝕏 AI 热点聚合；支持海报与短视频生成                                              |
| `web/app/labs/page.tsx`                     | **专业助手实验室入口**：聚合 PM、法务、广告投放、商务合作、采购、游戏美术/策划、程序员等助手 |
| `web/app/product-manager/page.tsx`          | 产品经理助手：市场洞察、产品创意、Discovery、路线图、用户故事 |
| `web/app/legal-advisor/page.tsx`            | 法务顾问助手：合同审查、法规解读、合规体检、金融风险分析 |
| `web/app/ad-campaign/page.tsx`              | 广告投放助手：投放策略、创意文案、受众定向、预算分配、效果复盘 |
| `web/app/business-partnership/page.tsx`     | 商务合作助手：合作 outreach、方案撰写、条款要点、伙伴评估 |
| `web/app/procurement-assistant/page.tsx`    | 采购助手：供应商评估、RFQ 起草、报价比对、合同审查、成本优化 |
| `web/app/game-art/page.tsx`                 | 游戏美术助手：视觉风格、角色/场景 Brief、UI 规范与竞品视觉分析 |
| `web/app/game-design/page.tsx`              | 游戏设计助手：概念案、核心循环、系统设计、关卡规划、数值框架 |
| `web/app/system-assistant/page.tsx`         | 系统维护助手：软件安装/卸载、网络修复、环境配置、文件整理 |
| `web/app/desktop-operator/page.tsx`         | 桌面操作助手：本机任意软件 CLI/GUI 自动化 |
| `web/app/programmer/page.tsx`               | 编程助手：Git/SSH、中间件运维、测试与代码工具 |
| `web/app/customer-service/page.tsx`         | AI 客服助手：客服工作区与对话界面 |
| `web/app/workflows/page.tsx`                | 可视化工作流：创建/查看/管理工作流 |
| `web/app/financial-news/page.tsx`           | 金融资讯日报 |
| `web/app/claude-code/page.tsx`              | Claude Code 工作区：代码聊天、资源管理器、Slash 命令面板 |
| `web/app/meal/page.tsx`                     | 内部工具：餐费/考勤相关 |
| `web/app/login/page.tsx`                    | 认证入口；对接 BFF `/api/auth/*`                                                                                          |
| `web/contexts/AuthContext.tsx`              | 认证上下文占位类型（`AuthUser` / `login` 签名）；真实接入时需替换 Provider                                                   |

前端通过 **`web/app/api/context/*`** 代理调用后端上下文记忆与知识图谱拼装接口。

**SSE 流式代理（统一 LangGraph 入口）**：

| 路径 | 说明 |
|------|------|
| `web/app/api/agent/chat/stream/route.ts` | **主入口**：原生 `http(s).request` 代理 `POST /agent/chat/stream`（SSE v2） |
| `web/app/api/multi-agent/stream/route.ts` | 遗留代理，行为等价 |
| `web/app/api/chat/route.ts` | 默认转发 LangGraph；`CHAT_LEGACY_AI_SDK=1` 时走旧 Vercel AI SDK 工具循环 |

`maxDuration = 800` 以支持长视频等慢工具。Direct 与 Multi 均在 `page.tsx` 解析同一 SSE 协议（`token` / `decision` / `agent_result` / `final` 等）。

**Checkpoint**：LangGraph 状态持久化于 `storage/checkpoints/langgraph.db`（`backend/agents/checkpoint.py`），`thread_id` 与 `trace_store` 的 `trace_id` 对齐，支持多轮续跑基础能力。

**媒体路径规范化**：
- 后端 `_extract_media_url_from_messages` 支持从 `/media/<file>`、`/storage/outputs/`、外链等路径提取媒体 URL
- `/multi-agent/stream` 在 SSE 事件中自动推断 `media_url`（从 `agent_result` / `final` 的 content/response 中提取 Markdown 图片/链接、本地路径、外链）
- 前端 `companion/page.tsx` 复用 `extractCompanionMediaUrlFromText` 统一提取逻辑
- `OfficeBackground.tsx` 的 `normaliseMediaUrl` 将 `/media/<file>` 映射到 `/api/media/<file>` 磁盘代理（FastAPI 静态路由在 Next.js dev 端口不可用）

### 4.6 超级 Agent 与安全执行面（能力 · 审批 · 任务）

在「对话驱动数字员工」方向上，对 **高风险能力**（浏览器敏感步骤、本地写入/Shell、平台侧发送与文档写入等）采用统一注册、可选审批、任务持久化与可追溯执行；与既有 Playwright / Connector 能力互补，而不是替代多 Agent 编排。

```mermaid
flowchart LR
    subgraph Entry["入口"]
        UI[Capabilities 页 / API]
        CU[Computer Use]
        PA[platform-actions]
        LC[computer/actions]
    end

    subgraph Reg["注册与策略"]
        CAP[capabilities.py]
        PPC[platform_capabilities.py]
    end

    subgraph Gate["门控与持久化"]
        APP[approval_service]
        TM[task_manager]
        EX[execution_approval]
        PACT[platform_actions]
        LCOM[local_computer]
    end

    subgraph Resume["批准后执行"]
        AR[approve + BackgroundTasks<br/>auto_resume_*]
        R1[resume Computer Use]
        R2[resume platform_action]
        R3[resume local_computer]
    end

    UI --> CAP
    CU --> EX --> APP
    PA --> PACT --> APP
    LC --> APP
    APP --> TM
    AR --> R1 & R2 & R3
```

**核心后端模块（节选）**

| 职责              | 路径                                    | 说明                                                                                        |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| 能力注册表        | `backend/core/capabilities.py`          | `Capability`：风险等级、`requires_approval`、关联 tool 等                                   |
| 平台矩阵          | `backend/core/platform_capabilities.py` | 各平台 `PlatformProfile` / `PlatformAction`（飞书、Discord、半自动 IM 等）                  |
| 审批              | `backend/services/approval_service.py`  | 创建/批准/拒绝/过期；`args_preview` 脱敏；`batch_updates` / `requests` 等大数组在预览中摘要 |
| 任务              | `backend/utils/task_manager.py`         | `storage/tasks/` JSON 持久化                                                                |
| API 组装          | `backend/core/super_agent_api.py`       | capabilities / tasks / approvals 响应；批准后与任务 metadata 联动                           |
| Computer Use 门控 | `backend/core/execution_approval.py`    | 步骤映射能力、创建审批（轻量、易测）                                                        |
| 平台动作          | `backend/core/platform_actions.py`      | `request_platform_action`；`resume_approved_platform_action`（失败则任务 `failed`）         |
| 本地电脑          | `backend/core/local_computer.py`        | 目录沙箱、读写删与 Shell（白名单+审批）、回滚快照与审计                                     |
| 桌面元数据        | `backend/core/desktop_actions.py`       | 屏幕/键鼠/窗口等画像与计划 API（本机 native 桥接为 planned）                                |
| 多媒体流水线      | `backend/core/media_pipeline.py`        | 多步状态机、闸口审批、可选落历史/知识库                                                     |
| 研究产物          | `backend/core/research_artifact.py`     | 研究条目/摘要规范化与合并                                                                   |
| 陪伴状态          | `backend/core/companion_state.py`       | `storage/companion/state.json`；调度器可 `companion_nudge`                                  |

**持久化位置（节选）**

| 数据         | 目录或文件                             |
| ------------ | -------------------------------------- |
| 审批         | `storage/approvals/approvals.json`     |
| 任务         | `storage/tasks/*.json`                 |
| 本地动作审计 | `storage/computer/local_actions.jsonl` |
| 文件回滚快照 | `storage/computer/rollback/`           |
| 伙伴状态     | `storage/companion/state.json`         |

**与连接器协同（示例：飞书）** `backend/tools/connectors/feishu.py`：`read_docs`（`raw_content`、可选 `include_blocks` / `blocks_page_token`）；`write_docs`（新建/追加、`batch_updates` 或原生 `requests` → docx `batch_update`）。

**前端**：`web/app/settings/capabilities/` — 能力矩阵、待审批、任务、本地审计摘要；`args_preview` 折叠与 JSON 截断；批准时可勾选「批准后后台自动继续」，对应 `POST /approvals/{id}/approve` 的 `auto_resume_computer_use` / `auto_resume_platform_action` / `auto_resume_local_computer`（与审批 `metadata.source` 匹配时由 `BackgroundTasks` 调度）。

**实施清单与已知约束**：`docs/SUPER_AGENT_TODO.md`。

---

## 四（续）、新增子系统架构

### 4.7 媒体生产流水线

`backend/core/media_pipeline.py` 提供八步状态机，将脚本、分镜、图片、视频、配音、字幕、混剪、发布串联为可恢复任务：

```mermaid
flowchart TB
    subgraph Pipeline["Media Pipeline 八步状态机"]
        direction TB
        S1[script<br/>脚本生成] --> S2[storyboard<br/>分镜规划]
        S2 --> S3[images<br/>图片生成]
        S3 --> S4[video<br/>视频生成]
        S4 --> S5[audio<br/>配音/TTS]
        S5 --> S6[subtitles<br/>字幕生成]
        S6 --> S7[remix<br/>混剪合成]
        S7 --> S8[publish<br/>平台发布]
    end

    subgraph Gate["闸口审批"]
        G1{关键节点<br/>人工审批?} -->|批准| SNext[进入下一步]
        G1 -->|拒绝| GFail[步骤失败]
    end

    subgraph Persist["产物持久化"]
        P1[storage/tasks/<br/>任务 JSON]
        P2[storage/outputs/<br/>媒体文件]
        P3[可选落库<br/>history / knowledge]
    end

    S3 & S4 & S7 --> Gate
    SNext --> S4 & S5 & S6 & S7 & S8
    Pipeline --> Persist

    style Pipeline fill:#E3F2FD
    style Gate fill:#FFF3E0
    style Persist fill:#E8F5E9
```

每个步骤写入任务进度、trace 事件、产物路径和失败原因；关键节点支持 `POST /media-pipeline/{id}/gate` 人工审批。

**长视频默认参数**：`POST /tools/video/long` 默认 `duration_sec = 30`（原为 60），风格 `cinematic`，用户明确表达长度时才传入自定义秒数（范围 30–120）。

### 4.8 研究链路

`backend/core/research_artifact.py` 统一联网检索结果格式，支撑从搜索到知识沉淀的闭环：

```mermaid
flowchart LR
    Input["用户课题 / 流水线调研"] --> Search["DuckDuckGo<br/>结构化搜索"]
    Search --> Artifact["research_artifact<br/>规范化条目"]
    Artifact --> Save["save-to-knowledge<br/>存入知识库"]
    Artifact --> Plan["content-plan<br/>生成内容计划"]
    Save --> RAG[(ChromaDB)]
    Plan --> Output["选题 / 脚本 / 发布计划"]

    style Search fill:#E3F2FD
    style Artifact fill:#FFF3E0
    style Save fill:#E8F5E9
```

- `POST /research/web-search`：结构化搜索并返回 `summary_preview` + `items_preview`
- `POST /research/save-to-knowledge`：将研究结论转 Markdown 并入 RAG
- `POST /research/content-plan`：从研究 artifact 生成选题、脚本方向、发布计划

### 4.9 进化学习与数据管道

`backend/services/learning_data_pipeline.py` 统一接收 chat_turn、agent_trace、tool_call、feedback_signal、skill_usage 等事件，为自我学习提供数据底座：

```mermaid
flowchart TB
    subgraph Sources["事件来源"]
        T1[trace_store<br/>Agent 追踪]
        T2[history_manager<br/>对话历史]
        T3[evolution_signals<br/>用户反馈]
        T4[memory_evaluation<br/>记忆使用结果]
    end

    subgraph Pipeline["learning-data-pipeline"]
        P1[统一事件 schema] --> P2[storage/evolution/<br/>events.jsonl]
        P2 --> P3[reflection-loop<br/>任务复盘]
        P2 --> P4[curator-worker<br/>后台整理]
        P2 --> P5[session-recall<br/>会话检索]
    end

    subgraph Outputs["产出"]
        O1[save_memory<br/>长期记忆]
        O2[curator_report<br/>整理报告]
        O3[session_summary<br/>会话摘要]
    end

    Sources --> Pipeline
    P3 & P4 & P5 --> Outputs

    style Sources fill:#E3F2FD
    style Pipeline fill:#FFF3E0
    style Outputs fill:#E8F5E9
```

- **reflection-loop**：trace finalize 后触发轻量复盘，摘要写入记忆；只增加 companion XP，不再将复盘摘要写入伙伴档案 `recent_feedback`（避免档案页出现无关长文/链接）
- **curator-worker**：idle / interval 触发，读取事件与候选记忆，输出整理建议（默认 dry-run）
- **session-recall**：FTS/索引检索历史会话，返回聚焦摘要而非全文注入

### 4.10 记忆协调器

`backend/services/memory_coordinator.py` 提供记忆生命周期管理，避免工具层直接依赖底层向量存储：

```mermaid
flowchart LR
    subgraph Lifecycle["记忆生命周期"]
        L1[initialize<br/>会话初始化]
        L2[prefetch<br/>预取相关记忆]
        L3[after_turn<br/>回合后处理]
        L4[on_pre_compress<br/>压缩前抽取]
        L5[shutdown<br/>会话结束]
    end

    subgraph Storage["存储后端"]
        S1[ChromaDB<br/>向量检索]
        S2[JSON fallback<br/>降级存储]
    end

    L1 --> L2 --> L3 --> L4 --> L5
    L2 & L4 --> Storage
    L3 -->|save_reflection| Storage

    style Lifecycle fill:#E3F2FD
    style Storage fill:#E8F5E9
```

**约束**：prefetch 只注入短摘要与来源，使用固定 fence `<memory-context>` 标记；流式输出不泄漏 fence 原文。

**记忆命中可视化**：`backend/services/memory_evaluation.py` 新增 `list_memory_hit_records`，为每个 recall 记录关联记忆内容与媒体引用：

| 字段 | 说明 |
|------|------|
| `memory.content` | 当前记忆内容（若记忆仍在库中） |
| `memory_snapshot` | prefetch 时刻的快照（记忆被删除时用于降级展示） |
| `memory.missing` | 标记记忆是否已从当前库中移除 |
| `memory.media_refs` | 关联的媒体引用（封面图、缩略图等） |

前端 `MemoryPanel.tsx` 提供「Memories / Hits」双视图：Memories 展示记忆库列表，Hits 展示 recall 轨迹（查询语句、命中排名、记忆内容、媒体引用）。** Hits 视图支持 missing + snapshot_available 状态提示，便于排查记忆失效或存储切换场景。**

### 4.11 平台连接器矩阵

`backend/core/platform_capabilities.py` 定义各平台的接入方式、动作风险与审批策略：

| 平台 | 接入方式 | 读类动作 | 写类动作 | 审批策略 |
|------|----------|----------|----------|----------|
| 飞书 | 官方 API / Webhook | 读文档/日历/Base | 发消息/写文档/创建日程 | 写类默认审批 |
| Discord | Bot REST | 读频道/消息 | 发消息/管理频道 | 管理频道需审批 |
| 微信/QQ/钉钉 | SemiAutoIM | — | 返回操作手册 | 不直接执行 |

```mermaid
flowchart TB
    subgraph Matrix["platform_capabilities"]
        M1[PlatformProfile] --> M2[PlatformAction]
        M2 --> M3[risk_level<br/>low/medium/high]
        M2 --> M4[requires_approval]
    end

    subgraph Actions["动作执行"]
        A1[request_platform_action] --> A2[approval_service<br/>审批门控]
        A2 -->|批准| A3[resume_approved_platform_action]
        A2 -->|拒绝| A4[任务标记 failed]
    end

    subgraph Feishu["飞书 Connector"]
        F1[read_docs<br/>raw_content / blocks]
        F2[write_docs<br/>新建/追加/batch_update]
        F3[calendar_read<br/>事件列表]
        F4[base_read<br/>多维表格记录]
    end

    M2 --> Actions
    Actions --> Feishu

    style Matrix fill:#E3F2FD
    style Actions fill:#FFF3E0
    style Feishu fill:#E8F5E9
```

### 4.12 专业助手 Labs

除媒体与内容创作 Agent 外，系统新增一组面向垂直业务场景的**专业助手 Labs Agent**。每个 Agent 都有独立前端页面、后端 Recipe/Analysis 模块和专属 Service，形成"页面 → Agent → Recipe → Service → 外部 API/工具"的闭环：

```mermaid
flowchart TB
    subgraph Frontend["前端 Labs 页面"]
        P1[/product-manager/]
        P2[/legal-advisor/]
        P3[/ad-campaign/]
        P4[/business-partnership/]
        P5[/procurement-assistant/]
        P6[/game-art/]
        P7[/game-design/]
        P8[/programmer/]
    end

    subgraph Agents["专业助手 Agent"]
        A1[product_manager_agent]
        A2[legal_agent]
        A3[ad_campaign_agent]
        A4[business_partnership_agent]
        A5[procurement_agent]
        A6[game_art_agent]
        A7[game_design_agent]
        A8[programmer_agent]
    end

    subgraph Core["core/ Recipe & Analysis"]
        R1[product_manager_recipes.py]
        R2[legal_analysis.py · legal_recipes.py]
        R3[ad_campaign_analysis.py · ad_campaign_recipes.py]
        R4[business_partnership_analysis.py · business_partnership_recipes.py]
        R5[procurement_analysis.py · procurement_recipes.py]
        R6[game_art_analysis.py · game_art_recipes.py]
        R7[game_design_analysis.py · game_design_recipes.py]
        R8[programmer_recipes.py · programmer_command_policy.py]
    end

    subgraph Services["services/"]
        S1[product_manager_service.py]
        S2[legal_service.py]
        S3[ad_campaign_service.py]
        S4[business_partnership_service.py]
        S5[procurement_service.py]
        S6[game_art_service.py]
        S7[game_design_service.py]
        S8[programmer_service.py]
    end

    Frontend --> Agents
    Agents --> Core
    Core --> Services
    Services -->|调用| LLM[LLM / 搜索 / 工具]

    style Frontend fill:#E3F2FD
    style Agents fill:#E8F5E9
    style Core fill:#FFF3E0
    style Services fill:#F3E5F5
```

**Agent 与前端/后端的对应关系**

| agent_id | 前端页面 | core/ 模块 | services/ 模块 |
|----------|----------|------------|----------------|
| `product_manager_agent` | `/product-manager/` | `product_manager_recipes.py`, `product_analysis.py` | `product_manager_service.py` |
| `legal_agent` | `/legal-advisor/` | `legal_analysis.py`, `legal_recipes.py` | `legal_service.py` |
| `ad_campaign_agent` | `/ad-campaign/` | `ad_campaign_analysis.py`, `ad_campaign_recipes.py` | `ad_campaign_service.py` |
| `business_partnership_agent` | `/business-partnership/` | `business_partnership_analysis.py`, `business_partnership_recipes.py` | `business_partnership_service.py` |
| `procurement_agent` | `/procurement-assistant/` | `procurement_analysis.py`, `procurement_recipes.py` | `procurement_service.py` |
| `game_art_agent` | `/game-art/` | `game_art_analysis.py`, `game_art_recipes.py` | `game_art_service.py` |
| `game_design_agent` | `/game-design/` | `game_design_analysis.py`, `game_design_recipes.py` | `game_design_service.py` |
| `programmer_agent` | `/programmer/` | `programmer_recipes.py`, `programmer_command_policy.py` | `programmer_service.py` |

### 4.13 工作流引擎与客服系统

`backend/core/workflow_engine.py` + `workflow_schema.py` 提供可视化工作流支撑：`web/app/workflows/` 可创建、编辑、执行多 Agent 协作流程，节点支持条件分支、循环、子图调用与审批闸口。

`backend/services/customer_service_*.py` 提供 AI 客服能力：

| 模块 | 职责 |
|------|------|
| `customer_service_engine.py` | 客服对话引擎与意图分发 |
| `customer_service_retrieval.py` | 基于 RAG 的 FAQ/知识检索 |
| `customer_service_store.py` | 客服会话与工单存储 |
| `customer_service_workspace.py` | 客服工作区状态管理 |

---

## 五、数据流

### 5.1 典型请求：生成视频并发布

```mermaid
sequenceDiagram
    actor User as 用户
    participant FE as 前端
    participant API as FastAPI
    participant Agent as Agent 编排器
    participant Tool as 工具层
    participant Media as 媒体生成服务
    participant Platform as 平台连接器

    User->>FE: "生成猫咪视频，发布到B站"
    FE->>API: POST /multi-agent/stream
    API->>Agent: 创建任务 + Trace

    Agent->>Agent: Supervisor 决策 → media_agent
    Agent-->>FE: SSE: decision

    Agent->>Tool: generate_video("猫咪视频")
    Tool->>Media: 调用视频生成 API
    Media-->>Tool: 返回视频 URL
    Tool-->>Agent: 视频生成完成
    Agent-->>FE: SSE: agent_result

    Agent->>Agent: Supervisor 决策 → 发布
    Agent->>Tool: publish_to_platform(bilibili)
    Tool->>Platform: Playwright 自动化发布
    Platform-->>Tool: 发布成功，返回链接
    Tool-->>Agent: 发布完成
    Agent-->>FE: SSE: agent_result

    Agent-->>FE: SSE: final + done
    FE-->>User: 展示结果 + 链接
```

**media_url 自动推断**：`/multi-agent/stream` 在返回 SSE 事件时，若 `agent_result` / `final` 的 content/response 中包含媒体路径（Markdown 图片 `![alt](url)`、本地 `/media/` 或 `/storage/outputs/` 路径、外链），后端自动提取并注入 `media_url` 字段，前端无需二次解析即可直接渲染视频/图片。

### 5.2 多模态请求：上传图片并分析

```mermaid
sequenceDiagram
    actor User as 用户
    participant FE as 前端
    participant API as FastAPI
    participant Multimodal as 多模态工具
    participant Rust as Rust OCR
    participant LLM as LLM

    User->>FE: 上传图片 + "提取文字并总结"
    FE->>API: POST /chat (带图片)
    API->>API: 保存上传文件

    API->>Multimodal: process_image(path)
    Multimodal->>Rust: gRPC OCR 请求
    Rust-->>Multimodal: 提取文本

    Multimodal->>LLM: 文本 + 用户指令
    LLM-->>Multimodal: 总结结果

    Multimodal-->>API: 多模态结果
    API-->>FE: SSE 流式返回
    FE-->>User: 展示总结
```

---

### 5.3 运行时架构四层

对应 Hermes 对齐中的 `arch-doc-runtime`，将运行时抽象为四个协作平面：

```mermaid
flowchart TB
    subgraph Runtime["运行时四层"]
        direction TB

        subgraph AR["AgentRuntime<br/>Agent 执行平面"]
            A1[LangGraph<br/>StateGraph]
            A2[Orchestrator<br/>Supervisor]
            A3[AgentRegistry]
            A4[Router]
        end

        subgraph TR["ToolRuntime<br/>工具执行平面"]
            T1[原子工具层]
            T2[MCP Client]
            T3[Connectors]
            T4[gRPC Client]
        end

        subgraph LS["LearningSignals<br/>学习信号平面"]
            L1[trace_store]
            L2[learning_data_pipeline]
            L3[reflection_loop]
            L4[curator_worker]
            L5[evolution_signals]
        end

        subgraph CF["ConnectionsFacade<br/>连接摘要平面"]
            C1[connections_summary]
            C2[platform_capabilities]
            C3[channel_directory]
            C4[runtime_health]
        end
    end

    AR -->|调用| TR
    AR -->|产生事件| LS
    TR -->|产生事件| LS
    CF -->|为 Agent 提供上下文| AR
    CF -->|为审批提供平台状态| TR

    style AR fill:#E3F2FD
    style TR fill:#E8F5E9
    style LS fill:#FFF3E0
    style CF fill:#F3E5F5
```

| 平面 | 职责 | 关键模块 |
|------|------|----------|
| **AgentRuntime** | 多 Agent 编排、路由、状态管理 | `orchestrator.py`、`router.py`、`registry.py` |
| **ToolRuntime** | 原子工具、MCP、连接器、微服务调用 | `tools/*`、`mcp_client.py`、`grpc_client.py` |
| **LearningSignals** | 事件采集、复盘、curator、会话召回 | `learning_data_pipeline.py`、`reflection_loop.py`、`curator_worker` |
| **ConnectionsFacade** | 连接摘要、平台能力矩阵、Channel 目录 | `connections_summary.py`、`platform_capabilities.py` |

---

## 六、部署架构

### 6.1 本地开发

```mermaid
flowchart LR
    User["开发者"] --> Script["./start_local.sh"]
    Script --> Web["Next.js :3000"]
    Script --> API["FastAPI :8000"]
    Script --> GoSvc["Go :50053"]
    Script --> RustSvc["Rust :50052"]
    Script --> OCRSvc["OCR :50051"]
```

### 6.2 Docker Compose 生产部署

```mermaid
flowchart TB
    subgraph Docker["Docker Compose"]
        NGINX["Nginx 反向代理"]
        WEB["web 容器<br/>Next.js"]
        API["api 容器<br/>FastAPI"]
        GO["go 容器<br/>高并发引擎"]
        RUST["rust 容器<br/>安全引擎"]
        CHROMA["chroma 容器<br/>向量数据库"]
    end

    User["用户"] --> NGINX
    NGINX --> WEB
    NGINX --> API
    API --> GO
    API --> RUST
    API --> CHROMA
```

---

## 七、目录结构速查

```
ai-media-agent/
├── backend/                    # Python FastAPI 主服务
│   ├── main.py                 # API 入口（含 capabilities / approvals / tasks / platform-actions 等）
│   ├── agents/                 # LangGraph Agent（含 base/ 基类，已注册 23 个 Agent）
│   ├── core/                   # LLM、能力注册、审批门控、平台动作、流水线、研究、陪伴、桌面画像、工作流、专业助手 Recipe …
│   ├── tools/                  # 原子工具层（含 connectors/ 飞书、Discord 等）
│   ├── services/               # Scheduler、审批、Computer、MCP、gRPC Client、进化学习、Native Desktop、客服、工作流、专业助手 Service …
│   ├── routers/                # auth_router、users_router
│   ├── utils/                  # rag_manager、chroma、trace_store、task_manager、auth …
│   ├── admin/                  # 管理后台
│   ├── assets/                 # 静态资源
│   ├── memory_storage/         # 内存存储运行时数据
│   ├── tests/                  # 后端单元测试
│   └── generated/              # protobuf 生成的 Python 代码
│
├── web/                        # Next.js 16 前端
│   ├── app/                    # App Router 页面（37+ 页面）
│   │   ├── page.tsx            # 主对话
│   │   ├── workbench/          # 工作台
│   │   ├── create/             # 创作中心
│   │   ├── media/              # 媒体生成
│   │   ├── labs/               # 专业助手实验室
│   │   ├── product-manager/    # 产品经理助手
│   │   ├── legal-advisor/      # 法务顾问
│   │   ├── ad-campaign/        # 广告投放
│   │   ├── business-partnership/ # 商务合作
│   │   ├── procurement-assistant/ # 采购助手
│   │   ├── game-art/           # 游戏美术
│   │   ├── game-design/        # 游戏设计
│   │   ├── programmer/         # 编程助手
│   │   ├── system-assistant/   # 系统维护
│   │   ├── desktop-operator/   # 桌面操作
│   │   ├── customer-service/   # AI 客服
│   │   ├── workflows/          # 可视化工作流
│   │   └── settings/context/   # My context（图谱 + Memory）
│   ├── components/             # React 组件（含 MarkdownSummaryPreview）
│   ├── contexts/               # React Context（Prefs、Auth 占位等）
│   ├── hooks/                  # 自定义 Hooks
│   ├── lib/                    # 工具库（含 i18n）
│   ├── messages/               # 国际化文案（zh.json / en.json）
│   └── types/                  # TypeScript 类型定义
│
├── backend_massive_concurrent/ # Go 高并发引擎 (gRPC :50053)
│   ├── cmd/server/             # 入口
│   ├── internal/directory/     # 目录检索服务
│   ├── generated/              # protobuf 生成的 Go 代码
│   └── docs/DESIGN.md          # Go 引擎架构设计
│
├── backend_safety/             # Rust 安全引擎 (gRPC :50052)
│   ├── src/                    # 源码（grpc / parser / generated）
│   └── docs/DESIGN.md          # Rust 引擎架构设计
│
├── backend_block_chain/        # 区块链相关后端（独立模块）
├── proto/                      # Protocol Buffers 定义
├── scripts/                    # 脚本工具
├── services/                   # 独立服务 (OCR :50051)
├── storage/                    # 运行时数据 (gitignore)
├── tests/                      # 集成测试
├── docs/                       # 技术文档
└── start_local.sh              # 一键启动脚本
```

---

## 八、相关文档

| 文档                                         | 说明                                              |
| -------------------------------------------- | ------------------------------------------------- |
| `README.md`                                  | 项目主文档与快速开始                              |
| `AGENTS.md`                                  | Agent 协作指南与开发规范                          |
| `docs/AGENT_ROUTING_DIAGRAMS.md`             | 路由与协作流程图（Mermaid）                       |
| `docs/AGENT_ROUTING_COLLABORATION.md`        | Agent 路由协作详细说明                            |
| `docs/DOCUMENT_PARSING_FLOW.md`              | 文档上传解析流程（Python/Rust）                   |
| `docs/MEMORY_SYSTEM.md`                      | 记忆系统实现、图文记录、命中审计与自学习闭环      |
| `docs/SELF_LEARNING_SYSTEM.md`               | 自学习系统实现、任务复盘、反馈信号与 curator 报告 |
| `docs/COMPUTER_SERVICE.md`                   | My Computer 本地索引文档                          |
| `docs/SUPER_AGENT_TODO.md`                   | 超级 Agent / 安全执行面实施进度与验证命令         |
| `docs/PLATFORM_CONNECTION_IMPLEMENTATION.md` | 平台连接（OAuth / 扫码 / 插件）实现说明           |
| `docs/MCP_CLIENT.md`                         | MCP 协议客户端文档                                |
| `docs/PROJECT_INTRO.md`                      | 管理层版项目介绍                                  |
| `docs/DEVELOPMENT_GUIDE.md`                  | 开发者快速上手指南（启动 / 测试 / 调试 / Canvas） |
| `docs/CANVAS_OVERVIEW.md`                    | Cursor Canvas 工作区速览（彩色图、双路径、维护）  |
| `docs/PLATFORM_CONNECTION_GUIDE.md`          | 平台连接用户指南（OAuth / 扫码 / 插件）           |
| `docs/HERMES_ALIGNMENT_TODO.md`              | Hermes 范式对齐实施清单                           |
| `docs/API_REFERENCE.md`                      | 后端 API 接口参考手册（167+ 端点）                |
| `docs/SECURITY_ARCHITECTURE.md`              | 安全架构：审批、沙箱、SSRF、加密与审计            |
| `docs/STORAGE_ARCHITECTURE.md`               | 存储架构：文件系统、SQLite、ChromaDB、JSONL       |
| `docs/FRONTEND_ARCHITECTURE.md`              | 前端架构：Next.js 16、主题系统、组件分层          |
| `docs/TESTING_GUIDE.md`                      | 测试分层：行为测试、集成测试、Mock 策略           |
| `docs/OBSERVABILITY.md`                      | 可观测性：日志、Trace、监控、告警与排障           |
| `DOCKER_DEPLOY_GUIDE.md`                     | Docker 生产部署指南（含 HTTPS/Nginx）             |
| `backend_massive_concurrent/docs/DESIGN.md`  | Go 引擎架构设计                                   |
| `backend_safety/docs/DESIGN.md`              | Rust 引擎架构设计                                 |
| `docs/LABS_PRODUCT_MANAGER.md`               | 产品经理助手（Recipe 化生成 PRD/路线图/用户故事） |
| `docs/LABS_LEGAL_ADVISOR.md`                 | 法务顾问助手（合同审查/法规解读/合规体检）        |
| `docs/LABS_AD_CAMPAIGN.md`                   | 广告投放助手（策略/创意/定向/复盘）               |
| `docs/LABS_BUSINESS_PARTNERSHIP.md`          | 商务合作助手（outreach/方案/Pipeline）            |
| `docs/LABS_PROCUREMENT.md`                   | 采购助手（RFQ/比价/供应商评估）                   |
| `docs/LABS_GAME_ART.md`                      | 游戏美术助手（风格指南/Brief/情绪板）             |
| `docs/LABS_GAME_DESIGN.md`                   | 游戏设计助手（概念案/系统设计/数值框架）          |
| `docs/LABS_PROGRAMMER.md`                    | 编程助手（环境/运维/代码分析）                    |
| `docs/LABS_SYSTEM_ASSISTANT.md`              | 系统维护助手（安装/修复/文件整理）                |
| `docs/LABS_DESKTOP_OPERATOR.md`              | 桌面操作助手（本机 CLI/GUI 自动化）               |
| `docs/LABS_CUSTOMER_SERVICE.md`              | AI 客服助手（RAG 检索/会话/工单）                 |
| `docs/LABS_WORKFLOWS.md`                     | 可视化工作流（多 Agent 编排引擎）                 |
| `docs/LABS_FINANCIAL_NEWS.md`                | 金融资讯日报（摘要/海报/短视频）                  |
| `docs/LABS_CLAUDE_CODE.md`                   | Claude Code 工作区（代码聊天/资源管理器）         |
| `docs/LABS_MEAL.md`                          | 内部餐费/考勤工具（飞书多维表格对接）             |

---

_文档版本：2026-06-14 · 架构 V4.2（补齐 22 个 Agent、37+ 前端页面、专业助手 Labs、15 个 Labs 独立文档；同步 AGENTS.md / AGENT_ROUTING_DIAGRAMS.md）_
