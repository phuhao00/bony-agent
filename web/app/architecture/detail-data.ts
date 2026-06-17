/** 架构页逐项说明（中英文）。供 copy.ts 引用，避免单文件过长。 */

export type ArchDetailRow = {
  label: string;
  path?: string;
  detail?: string;
};

export type ArchInfraRow = { label: string; detail?: string };

/* ─── 中文 · 前端 ─── */
export const ZH_FRONTEND_ROWS: ArchDetailRow[] = [
  {
    label: "AI 主对话",
    path: "/",
    detail:
      "主聊天界面：流式回复、会话历史、生成内容预览；支持 MultimodalInput 上传图片/音频/视频引用；经 Next Route Handlers（如 /api/chat）转发 FastAPI。",
  },
  {
    label: "工作台",
    path: "/workbench",
    detail: "聚合常用创作入口（脚本、媒体、发布、知识库等快捷卡片），降低功能发现成本。",
  },
  {
    label: "AI 伙伴",
    path: "/companion",
    detail: "数字人 / 陪伴式交互界面，与主对话区分的独立体验与角色设定。",
  },
  {
    label: "爆款流水线",
    path: "/pipeline",
    detail: "按流水线步骤组织「选题 → 创作 → 素材 → 发布」等多阶段任务的可视化入口。",
  },
  {
    label: "视频脚本",
    path: "/create/script",
    detail: "脚本结构化生成：话题、平台风格、分镜要点；对接 POST /tools/script。",
  },
  {
    label: "文案创作",
    path: "/create/copywriting",
    detail: "多平台软文 / 营销文案；对接 POST /tools/copywriting、标题 POST /tools/titles。",
  },
  {
    label: "图文文章",
    path: "/create/article",
    detail: "长文 / 图文排版向创作；与文案工具链共用后端生成能力。",
  },
  {
    label: "文生图",
    path: "/media/image",
    detail: "调用配置的图像模型（智谱 CogView、即梦、Gemini Image 等）；POST /tools/image。",
  },
  {
    label: "视频生成",
    path: "/media/video",
    detail: "文生视频、参数与模型选择；POST /tools/video、图生视频 /tools/video/from-image。",
  },
  {
    label: "长视频任务",
    path: "/media/long-video",
    detail: "异步长视频管线：创建任务 POST /tools/video/long，轮询 GET /tools/video/long/{task_id}。",
  },
  {
    label: "故事板",
    path: "/media/storyboard",
    detail: "分镜级编排：经由 BFF /api/tools/storyboard 等对接脚本生成与视频段落生成接口。",
  },
  {
    label: "Computer Use",
    path: "/computer-use",
    detail: "浏览器 GUI 自动化：用户描述任务 → LLM 规划步骤 → Playwright 执行；POST /computer-use/run（及 /api/computer-use 代理）。",
  },
  {
    label: "Hermes Agent",
    path: "/hermes-agent",
    detail: "Hermes 品牌独立 Agent 控制台页面（与主 Orchestrator 并存的多入口之一）。",
  },
  {
    label: "Lark CLI 助手",
    path: "/lark-cli",
    detail: "飞书/Lark 命令行能力的前端壳：流式调用 /api/lark-cli、/api/lark-cli/stream。",
  },
  {
    label: "平台管理",
    path: "/platforms",
    detail: "绑定抖音/B 站/小红书等账号；OAuth / Cookie / 浏览器登录状态；对接 GET /connectors/platforms、POST /connectors/connect。",
  },
  {
    label: "知识库",
    path: "/knowledge",
    detail: "文档上传与索引、RAG 问答；对接 /knowledge/upload、/knowledge/query、/knowledge/documents、ChromaDB。",
  },
  {
    label: "内容审核",
    path: "/moderation",
    detail: "合规检测与自动修正建议；POST /tools/moderation/check、/tools/moderation/fix、GET /tools/moderation/rules。",
  },
  {
    label: "定时发布",
    path: "/scheduler",
    detail: "APScheduler 任务 CRUD 与执行日志；GET/POST /scheduler/jobs、POST …/run、logs 批量删除等。",
  },
  {
    label: "历史记录",
    path: "/history",
    detail: "生成与对话历史列表、下载导出；GET /history、DELETE、POST /chat/history；摘要导出 DOCX 走 /api/summary-export/docx。",
  },
  {
    label: "游戏热点",
    path: "/trending",
    detail: "Steam/Epic/TapTap 等缓存榜单；GET /trending/gaming、POST refresh。",
  },
  {
    label: "AI 资讯日报",
    path: "/ai-news",
    detail: "HF Models / GitHub AI / 𝕏 AI 热点聚合；支持海报与短视频生成；对接内部缓存与生成工具链。",
  },
  {
    label: "OpenClaw / Lobster",
    path: "/openclaw",
    detail: "分布式流水线控制台：节点发现、配置、群聊、趋势同步；对接 /api/lobster/*。",
  },
  {
    label: "Capabilities（能力中心）",
    path: "/settings/capabilities",
    detail: "Skills 开关、MCP 服务器注册与 Ping、外部连接、定时任务摘要等多 Tab；对齐 storage/skills_enabled.json、mcp_servers.json。",
  },
  {
    label: "My Computer",
    path: "/settings/my-computer",
    detail: "本地文件夹纳入索引：浏览目录树、触发重建索引；对接 GET /computer/folders、POST reindex、PUT index-prefs。",
  },
  {
    label: "My context",
    path: "/settings/context",
    detail: "上下文知识图谱与 Agent Memory 面板；GET /context/knowledge-graph、/context/memory、search。",
  },
  {
    label: "个性化",
    path: "/settings/customization",
    detail: "主题、语言（zh/en）、偏好项；与 web/contexts/Prefs、messages/zh.json·en.json 联动。",
  },
  {
    label: "用户管理",
    path: "/settings/users",
    detail: "管理员：用户列表与重置密码；代理 /api/users*。",
  },
  {
    label: "设置首页",
    path: "/settings",
    detail: "设置分区入口路由（转发到 capabilities / customization 等子页）。",
  },
  {
    label: "登录",
    path: "/login",
    detail: "认证入口；对接 POST /auth/login 等（经 BFF /api/auth/[action]）。",
  },
  {
    label: "架构图（本页）",
    path: "/architecture",
    detail: "双语架构说明与仓库层级对照；数据来自 architecture/copy.ts + detail-data.ts。",
  },
];

/* ─── 中文 · FastAPI 路由（按域拆分） ─── */
export const ZH_API_ROWS: ArchDetailRow[] = [
  {
    label: "健康检查",
    detail: "GET /health — 探活与网关编排依赖检测。",
  },
  {
    label: "对话与多模态",
    detail:
      "POST /multimodal/analyze、POST /multimodal/chat — 解析上传媒体并与 LLM 组装上下文；前端常经 /api/multimodal/* 代理。",
  },
  {
    label: "多 Agent",
    detail:
      "GET /multi-agent/agents、POST /multi-agent/invoke、POST /multi-agent/stream（SSE）、GET /multi-agent/traces、GET …/traces/{trace_id} — Orchestrator + LangGraph。",
  },
  {
    label: "内容与脚本工具",
    detail:
      "POST /tools/script、/tools/copywriting、/tools/titles — 脚本、文案、标题批量生成。",
  },
  {
    label: "趋势分析",
    detail: "POST /tools/trends/analyze、/tools/trends/hashtags — 话题与标签建议。",
  },
  {
    label: "审核",
    detail: "POST /tools/moderation/check、/tools/moderation/fix、GET /tools/moderation/rules。",
  },
  {
    label: "图像",
    detail: "POST /tools/image — 文生图及模型路由（media_models）。",
  },
  {
    label: "视频主链路",
    detail:
      "POST /tools/video、/tools/video/long、GET /tools/video/long/{task_id}、/tools/video/from-image、/tools/video/from-upload、/tools/video/remix、/tools/video/ai-remix（含异步状态查询）。",
  },
  {
    label: "参考素材上传",
    detail: "POST /upload、POST /tools/media/upload-reference — 图生视频等前置素材。",
  },
  {
    label: "音频",
    detail: "GET /tools/audio/config、POST /tools/audio/tts — TTS/配音配置与合成。",
  },
  {
    label: "发布",
    detail:
      "POST /tools/publish、/tools/publish/all、GET /tools/publish/accounts — 连接器统一发布与账号列表。",
  },
  {
    label: "Computer Use",
    detail: "POST /computer-use/run — Playwright 闭环执行与 Markdown 报告。",
  },
  {
    label: "My Computer（HTTP）",
    detail:
      "GET /computer/browse、/computer/status、/computer/folders、POST /computer/folders、DELETE …/{folder_id}、POST …/reindex、GET/PUT /computer/index-prefs。",
  },
  {
    label: "知识库",
    detail:
      "POST /knowledge/upload、GET /knowledge/documents、DELETE …/{doc_id}、POST /knowledge/query、GET /knowledge/status、DELETE /knowledge/clear。",
  },
  {
    label: "历史",
    detail:
      "GET /history、POST /chat/history、DELETE /history、DELETE /history/{record_id}、GET …/download。",
  },
  {
    label: "上下文记忆与图谱",
    detail:
      "GET /context/memory、DELETE …/{memory_id}、POST /context/memory/search、GET /context/knowledge-graph。",
  },
  {
    label: "连接器元数据与绑定",
    detail:
      "GET /connectors/platforms、GET …/{platform_id}、POST /connectors/connect、POST /connectors/disconnect/{platform_id}、GET /connectors/oauth/authorize/{platform}、POST /connectors/oauth/callback。",
  },
  {
    label: "浏览器登录辅助",
    detail: "POST /connectors/browser/start、/connectors/browser/status、/connectors/browser/cancel — Cookie 会话采集。",
  },
  {
    label: "调度",
    detail:
      "GET /scheduler/jobs、POST /scheduler/jobs、PUT …/{job_id}、DELETE …、POST …/run、GET /scheduler/logs、DELETE …、POST /scheduler/logs/batch-delete。",
  },
  {
    label: "游戏热点 API",
    detail: "GET /trending/gaming、POST /trending/gaming/refresh。",
  },
  {
    label: "配置",
    detail: "GET/POST /config/provider、GET/POST /config/media-models — 运行时切换模型与密钥槽位。",
  },
  {
    label: "Skills API",
    detail:
      "GET /api/skills、POST /api/skills/toggle、/api/skills/import、/api/skills/import-file — .agent/skills 开关与导入。",
  },
  {
    label: "MCP API",
    detail:
      "GET/POST /api/mcp/servers、DELETE …/{server_id}、POST …/ping、GET …/tools — 外部 MCP 工具接入。",
  },
  {
    label: "Lobster / OpenClaw API",
    detail:
      "GET/POST /api/lobster/config、GET /api/lobster/detect、POST /api/lobster/run、GET /api/lobster/status、GET/POST trending、POST chat、GET nodes、POST group-chat。",
  },
  {
    label: "Wiki 编译",
    detail:
      "POST /wiki/compile、GET /wiki/pages、GET /wiki/pages/{page_id}、POST /wiki/index/rebuild、GET /wiki/graph、GET /wiki/health — 本地 Markdown Wiki 编译、索引与健康检查。",
  },
  {
    label: "MCP 预设",
    detail:
      "GET /api/mcp/presets、POST …/{preset_id}/install、DELETE …/{preset_id}/uninstall — 托管 MCP Server 预设安装与卸载。",
  },
  {
    label: "连接摘要",
    detail: "GET /connections/summary、/settings/connections/summary — 各平台连接器状态总览。",
  },
  {
    label: "进化链路",
    detail:
      "POST/GET /evolution/signals、/evolution/events、POST /evolution/session-recall/search、POST /evolution/memory-usage/outcome、GET …/memory-usage、…/hits、GET/POST /evolution/knowledge-layers*、POST /evolution/reflections*、POST/GET /evolution/curator/* — 信号采集、记忆评估、会话召回、知识分层与策展。",
  },
];

/* ─── 中文 · Agents ─── */
export const ZH_AGENT_ROWS: ArchDetailRow[] = [
  {
    label: "bot.py · media_agent",
    detail: "ReAct 循环 + 多媒体创作（图/视频/发布/记忆/知识库）；注册表 ID 为 media_agent。",
  },
  {
    label: "long_video_agent.py",
    detail: "长视频分镜级编排与异步任务状态管理。",
  },
  {
    label: "planning_bot.py",
    detail: "Planner → Executor → Replan；复杂多步创作流水线（脚本→分镜→媒体）。",
  },
  {
    label: "orchestrator.py",
    detail: "LangGraph Supervisor：多 Agent 注册、路由、迭代直至任务完成。",
  },
  {
    label: "router.py",
    detail: "两级意图路由：关键词表 + LLM 兜底分类 → RouteResult。",
  },
  {
    label: "copywriter_agent.py",
    detail: "营销向长文案与平台口吻适配。",
  },
  {
    label: "script_writer_agent.py",
    detail: "短视频/分镜脚本结构化输出。",
  },
  {
    label: "trend_analyst_agent.py",
    detail: "热点解读、话题簇与传播角度建议。",
  },
  {
    label: "reviewer_bot.py",
    detail: "合规与平台规则初审（可接 moderation_tools）。",
  },
  {
    label: "video_editor_agent.py",
    detail: "剪辑意图解析并与 remix/subtitle 等工具衔接。",
  },
  {
    label: "lobster_bot.py",
    detail: "OpenClaw 分布式节点上的任务编排与回调。",
  },
  {
    label: "architect.py",
    detail: "仓库/模块级架构问答与规范建议（对接 project-architect skill）。",
  },
  {
    label: "general_agent.py",
    detail: "泛化入口 Agent，承接未细分领域的请求。",
  },
  {
    label: "registry.py",
    detail: "Agent 清单与元数据注册，供 orchestrator 动态装载。",
  },
  {
    label: "agents/base/*",
    detail: "bot 基类与消息结构复用（非顶层路由入口）。",
  },
];

/* ─── 中文 · Services ─── */
export const ZH_SERVICE_ROWS: ArchDetailRow[] = [
  {
    label: "scheduler.py",
    detail: "APScheduler：定时生成与发布任务持久化到 storage/scheduler。",
  },
  {
    label: "grpc_client.py",
    detail: "gRPC 客户端：OCR :50051 / Rust Parser :50052 / Go Directory :50053；TLS/mTLS 调用。",
  },
  {
    label: "mcp_client.py",
    detail: "MCP Streamable HTTP / SSE：列举工具、调用远端 MCP Server。",
  },
  {
    label: "computer_service.py",
    detail: "My Computer：本地路径索引、gRPC Directory、增量重建与 prefs。",
  },
  {
    label: "computer_use_service.py",
    detail: "Playwright 生命周期、步骤上限、截图回灌 LLM、Markdown 报告产出。",
  },
  {
    label: "context_knowledge_graph.py",
    detail: "从 Memory/RAG/会话抽取实体关系，拼装 knowledge-graph API 响应。",
  },
  {
    label: "approval_service.py",
    detail: "审批生命周期：创建/批准/拒绝/过期；args_preview 脱敏；对接高风险能力门控。",
  },
  {
    label: "memory_coordinator.py",
    detail: "记忆生命周期：initialize → prefetch → after_turn → on_pre_compress → shutdown。",
  },
  {
    label: "learning_data_pipeline.py",
    detail: "统一接收 trace / history / feedback / skill_usage 事件，写入 storage/evolution/。",
  },
  {
    label: "reflection_loop.py",
    detail: "trace finalize 后轻量复盘与反思事件生成。",
  },
  {
    label: "wiki_compiler.py",
    detail: "将 trace / research / text 编译为本地 Markdown Wiki；frontmatter、wikilink、健康检查。",
  },
  {
    label: "evolution_signals.py",
    detail: "采集 trace、skill_usage、feedback 等进化信号并持久化。",
  },
  {
    label: "knowledge_layers.py",
    detail: "知识分层 taxonomy 与自动分类、元数据补全。",
  },
  {
    label: "memory_evaluation.py",
    detail: "记忆命中结果记录与使用统计（outcome / hits / usage）。",
  },
  {
    label: "memory_quality.py",
    detail: "记忆写入前的质量评分与摘要优化。",
  },
  {
    label: "mcp_managed_launcher.py",
    detail: "托管 MCP Server 预设的生命周期管理（启动/停止/快照）。",
  },
  {
    label: "mcp_presets.py",
    detail: "内置 MCP 预设清单与元数据（如 filesystem、sqlite、fetch）。",
  },
  {
    label: "session_recall.py",
    detail: "基于关键词与向量的历史会话召回检索。",
  },
  {
    label: "connections_summary.py",
    detail: "连接器状态聚合摘要，供设置页与监控使用。",
  },
  {
    label: "learning_curator.py",
    detail: "idle 触发学习策展与整理建议（dry-run 可切换）。",
  },
];

/* ─── 中文 · Tools（原子模块） ─── */
export const ZH_TOOL_ROWS: ArchDetailRow[] = [
  {
    label: "facade · content/",
    detail: "面向 Agent 的内容生成门面，聚合 script / copywriting 等原子工具。",
  },
  {
    label: "facade · media/",
    detail: "图像/视频/长视频门面，统一媒体模型解析与错误封装。",
  },
  {
    label: "facade · social/",
    detail: "发布与触达门面，对接 publisher_tools、reach_tools。",
  },
  {
    label: "facade · knowledge/",
    detail: "RAG 查询与文档生命周期门面。",
  },
  {
    label: "multimodal_tools.py",
    detail: "图片 OCR、音频 ASR、视频抽帧/摘要；可走 Rust 解析 + LLM。",
  },
  {
    label: "image_tools.py · video_tools.py · long_video_tools.py",
    detail: "各供应商文生图、文生视频、长视频异步任务封装。",
  },
  {
    label: "audio_tools.py · subtitle_tools.py",
    detail: "TTS、字幕生成与时间轴处理（常配合 FFmpeg）。",
  },
  {
    label: "remix_tools.py",
    detail: "模板化混剪、BGM、配音轨合成。",
  },
  {
    label: "script_tools.py · copywriting_tools.py",
    detail: "脚本与文案 LLM 调用与平台模板。",
  },
  {
    label: "publisher_tools.py · reach_tools.py",
    detail: "单平台/全平台发布与触达辅助（标题、标签、定时字段）。",
  },
  {
    label: "lobster_tools.py",
    detail: "Lobster 网络 discovered nodes、流水线 RPC 封装。",
  },
  {
    label: "rag_tools.py · memory_tools.py",
    detail: "LlamaIndex + Chroma 检索与 Conversation memory CRUD。",
  },
  {
    label: "trend_tools.py · gaming_trending.py · social_trending.py",
    detail: "通用趋势分析 + 游戏榜单抓取 + 社媒热点缓存。",
  },
  {
    label: "moderation_tools.py · exceptions.py",
    detail: "审核原子操作与工具层异常类型。",
  },
  {
    label: "media_common.py · media_tools.py · _envelope.py",
    detail: "媒体请求 envelope、通用下载与路径解析辅助。",
  },
];

/* ─── 中文 · Connectors ─── */
export const ZH_CONNECTOR_ROWS: ArchDetailRow[] = [
  {
    label: "base.py · manager.py",
    detail: "连接器抽象：connect/publish_video、统一注册表与凭据读写 storage/profiles。",
  },
  {
    label: "interactive_login.py · browser_login.py",
    detail: "人机协同扫码/短信验证与 Playwright 会话持久化。",
  },
  {
    label: "douyin.py · kuaishou.py · xiaohongshu.py · weibo.py",
    detail: "短视频与图文国内平台发布适配层。",
  },
  {
    label: "bilibili.py · video_channel.py",
    detail: "中长视频与微信视频号（Channels）投稿封装。",
  },
  {
    label: "youtube.py · twitter.py · tiktok.py",
    detail: "海外长短视频与图文动态发布；各平台 OAuth/Cookie 差异隔离在实现内。",
  },
  {
    label: "mock.py",
    detail: "离线或 CI 使用的假连接器，避免真实网络。",
  },
];

/* ─── 中文 · 微服务 ─── */
export const ZH_MICRO_GO: ArchInfraRow[] = [
  {
    label: "Directory Service",
    detail: "大规模目录遍历与关键词检索；供 computer_service 与批量索引。",
  },
  {
    label: "Scraper",
    detail: "批量 HTTP 抓取 Worker Pool + 令牌桶限流。",
  },
  {
    label: "Watcher",
    detail: "文件系统变更订阅，触发增量索引。",
  },
  {
    label: "Aggregator",
    detail: "多源结果 fan-in 与时间窗口聚合查询。",
  },
  {
    label: "运维要点",
    detail: "默认 gRPC :50051，protobuf 定义于 proto/mediaagent/；Python 侧 grpc_client 发起 TLS 调用。",
  },
];

export const ZH_MICRO_RUST: ArchInfraRow[] = [
  {
    label: "Document Parser",
    detail: "PDF / DOCX / 纯文本二进制安全解析（nom），避免 Python 解析漏洞面。",
  },
  {
    label: "Video Parser",
    detail: "MP4/MKV 盒结构与流式读取，供抽帧与元数据。",
  },
  {
    label: "Crypto · Keystore",
    detail: "密钥信封、本地安全存储（与 OCR/传输链路可选 mTLS）。",
  },
  {
    label: "OCR Service",
    detail: "图像文字识别流水线，供 multimodal 与知识库附图。",
  },
  {
    label: "运维要点",
    detail: "gRPC :50052，Tonic gRPC；二进制解析器（MP4/PDF/DOCX）；与 Go/OCR 路径区分。",
  },
];

/* ─── 中文 · 基础设施卡片 ─── */
export const ZH_LL_INFRA: ArchInfraRow[] = [
  {
    label: "智谱 GLM / Zhipu",
    detail: "glm-* 对话与部分媒体路由；环境变量 ZHIPUAI_API_KEY。",
  },
  {
    label: "阿里通义 · DashScope",
    detail: "qwen 系列；ALIBABA_API_KEY 或 DASHSCOPE_API_KEY（见 llm_provider 映射）。",
  },
  {
    label: "Google Gemini",
    detail: "gemini-* 多模态；GOOGLE_API_KEY。",
  },
  {
    label: "DeepSeek",
    detail: "deepseek-chat 等；DEEPSEEK_API_KEY。",
  },
  {
    label: "字节豆包 Doubao",
    detail: "doubao-*；BYTEDANCE_API_KEY。",
  },
  {
    label: "即梦 Jimeng",
    detail: "图像/视频供应商证书 JIMENG_ACCESS_KEY + SECRET_KEY（可走独立路由）。",
  },
  {
    label: "OpenAI GPT",
    detail: "OPENAI_API_KEY OpenAI 兼容端点，用于部分模型或中转。",
  },
  {
    label: "OpenRouter",
    detail: "聚合上百模型 slug；OPENROUTER_API_KEY，一处切换多厂商。",
  },
];

export const ZH_MEDIA_INFRA: ArchInfraRow[] = [
  {
    label: "图像",
    detail: "CogView（智谱）、即梦、Gemini Image；由 core/media_models 映射至具体供应商 SDK。",
  },
  {
    label: "视频",
    detail: "CogVideoX、即梦、豆包 SeaDance（ARK_API_KEY）、Jimeng 视频能力。",
  },
  {
    label: "音频与字幕",
    detail: "TTS 供应商 + FFmpeg 生成配音轨；subtitle_tools 对齐 ASR。",
  },
  {
    label: "混剪",
    detail: "remix_tools / ai-remix：脚本驱动的多轨 FFmpeg 合成与可选 AI 分段。",
  },
  {
    label: "存储产出",
    detail: "生成物默认落 storage/outputs，上传中间件走 storage/uploads / temp。",
  },
];

export const ZH_COMPUTER_INFRA: ArchInfraRow[] = [
  {
    label: "运行时",
    detail: "Playwright Chromium；PLAYWRIGHT_BROWSERS_PATH 可指向项目 .browsers。",
  },
  {
    label: "策略参数",
    detail: "computer_use_service 内 MAX_STEPS_PER_ROUND、MAX_TOTAL_STEPS、页面等待超时控制幻觉循环。",
  },
  {
    label: "产出形态",
    detail: "步骤日志 + 截图序列 + Markdown 总结，便于回放与审计。",
  },
];

export const ZH_STORAGE_INFRA: ArchInfraRow[] = [
  {
    label: "ChromaDB",
    detail: "向量集合持久化在 storage/rag/；LlamaIndex VectorStore 封装于 utils/chroma_client、rag_manager。",
  },
  {
    label: "SQLite auth.db",
    detail: "用户、会话摘要字段；勿提交密钥至仓库。",
  },
  {
    label: "storage/outputs · uploads · temp",
    detail: "产物、用户上传与临时文件；禁止使用系统 /tmp（项目规范）。",
  },
  {
    label: "memory · traces · scheduler · profiles · trending · computer",
    detail: "Agent 记忆、执行追踪 JSON、定时配置、平台账号凭据、热点缓存、My Computer 索引元数据。",
  },
  {
    label: "根目录配置 JSON",
    detail: "skills_enabled.json、mcp_servers.json、scheduler job store 等可由 UI 与 API 双向修改。",
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * English rows (mirror structure)
 * ═══════════════════════════════════════════════════════════════════════════ */

export const EN_FRONTEND_ROWS: ArchDetailRow[] = [
  {
    label: "AI chat (home)",
    path: "/",
    detail:
      "Primary assistant UI with streaming, history, previews; MultimodalInput for images/audio/video; proxied via Next routes such as /api/chat to FastAPI.",
  },
  {
    label: "Workbench",
    path: "/workbench",
    detail: "Hub of shortcuts into scripting, media, publishing, knowledge—less hunting in the sidebar.",
  },
  {
    label: "AI companion",
    path: "/companion",
    detail: "Companion / digital-human style experience separate from the main chat shell.",
  },
  {
    label: "Viral pipeline",
    path: "/pipeline",
    detail: "Stage-based workflow UI (idea → produce → assets → publish).",
  },
  {
    label: "Video script",
    path: "/create/script",
    detail: "Structured scripts by topic/platform tone; POST /tools/script.",
  },
  {
    label: "Copywriting",
    path: "/create/copywriting",
    detail: "Marketing copy; POST /tools/copywriting and /tools/titles.",
  },
  {
    label: "Article",
    path: "/create/article",
    detail: "Long-form article layout workflows sharing backend generators.",
  },
  {
    label: "Image generation",
    path: "/media/image",
    detail: "Configured image backends (CogView, Jimeng, Gemini Image…); POST /tools/image.",
  },
  {
    label: "Video generation",
    path: "/media/video",
    detail: "Text/image-to-video; POST /tools/video, /tools/video/from-image, etc.",
  },
  {
    label: "Long video jobs",
    path: "/media/long-video",
    detail: "Async jobs: POST /tools/video/long, poll GET /tools/video/long/{task_id}.",
  },
  {
    label: "Storyboard",
    path: "/media/storyboard",
    detail: "Shot-level planning via BFF /api/tools/storyboard* bridging script/video segments.",
  },
  {
    label: "Computer Use",
    path: "/computer-use",
    detail: "Natural-language browser automation: planned steps → Playwright; POST /computer-use/run.",
  },
  {
    label: "Hermes Agent",
    path: "/hermes-agent",
    detail: "Standalone Hermes console alongside the main orchestrator entry.",
  },
  {
    label: "Lark CLI",
    path: "/lark-cli",
    detail: "Feishu/Lark CLI shell with streaming /api/lark-cli and /api/lark-cli/stream.",
  },
  {
    label: "Platforms",
    path: "/platforms",
    detail: "Bind Douyin/Bilibili/XHS… OAuth, cookie, browser login; GET /connectors/platforms, POST connect.",
  },
  {
    label: "Knowledge base",
    path: "/knowledge",
    detail: "Upload, index, query RAG; /knowledge/* + ChromaDB under storage/rag/.",
  },
  {
    label: "Moderation",
    path: "/moderation",
    detail: "Safety check and auto-fix suggestions; /tools/moderation/*.",
  },
  {
    label: "Scheduler",
    path: "/scheduler",
    detail: "APScheduler jobs and logs CRUD; /scheduler/jobs*, logs batch-delete.",
  },
  {
    label: "History",
    path: "/history",
    detail: "Generation/chat history, export; /history*, /chat/history; DOCX via /api/summary-export/docx.",
  },
  {
    label: "Gaming trends",
    path: "/trending",
    detail: "Steam/Epic/TapTap cache; GET /trending/gaming, refresh POST.",
  },
  {
    label: "AI News",
    path: "/ai-news",
    detail: "HF Models / GitHub AI / 𝕏 AI trending aggregator; poster and video generation; internal cache + generation toolchain.",
  },
  {
    label: "OpenClaw / Lobster",
    path: "/openclaw",
    detail: "Distributed pipeline UI: detect, config, group chat, trending—/api/lobster/*.",
  },
  {
    label: "Capabilities",
    path: "/settings/capabilities",
    detail: "Skills toggles, MCP register/ping, connections, scheduled summaries—skills_enabled.json, mcp_servers.json.",
  },
  {
    label: "My Computer",
    path: "/settings/my-computer",
    detail: "Folder index UI; /computer/folders*, reindex, index-prefs.",
  },
  {
    label: "My context",
    path: "/settings/context",
    detail: "Knowledge graph + memory panels; /context/knowledge-graph, /context/memory*.",
  },
  {
    label: "Customization",
    path: "/settings/customization",
    detail: "Theme, locale (zh/en), prefs—Prefs context + messages/*.json.",
  },
  {
    label: "Users (admin)",
    path: "/settings/users",
    detail: "User admin and password reset via /api/users*.",
  },
  {
    label: "Settings index",
    path: "/settings",
    detail: "Router entry to capability sub-pages.",
  },
  {
    label: "Login",
    path: "/login",
    detail: "Auth; POST /auth/login via /api/auth/[action].",
  },
  {
    label: "Architecture (this page)",
    path: "/architecture",
    detail: "Bilingual architecture reference fed by copy.ts + detail-data.ts.",
  },
];

export const EN_API_ROWS: ArchDetailRow[] = [
  { label: "Health", detail: "GET /health — liveness." },
  {
    label: "Multimodal",
    detail: "POST /multimodal/analyze, /multimodal/chat — media understanding + chat context.",
  },
  {
    label: "Multi-agent",
    detail:
      "GET /multi-agent/agents; POST /multi-agent/invoke, /multi-agent/stream (SSE); traces GET /multi-agent/traces, …/{trace_id}.",
  },
  {
    label: "Script & copy",
    detail: "POST /tools/script, /tools/copywriting, /tools/titles.",
  },
  {
    label: "Trends",
    detail: "POST /tools/trends/analyze, /tools/trends/hashtags.",
  },
  {
    label: "Moderation",
    detail: "POST /tools/moderation/check, /tools/moderation/fix; GET /tools/moderation/rules.",
  },
  { label: "Image", detail: "POST /tools/image." },
  {
    label: "Video stack",
    detail:
      "POST /tools/video, /tools/video/long, GET …/{task_id}, /from-image, /from-upload, /remix, /ai-remix (+ status routes).",
  },
  {
    label: "Uploads",
    detail: "POST /upload, /tools/media/upload-reference.",
  },
  {
    label: "Audio",
    detail: "GET /tools/audio/config; POST /tools/audio/tts.",
  },
  {
    label: "Publish",
    detail: "POST /tools/publish, /tools/publish/all; GET /tools/publish/accounts.",
  },
  {
    label: "Computer Use",
    detail: "POST /computer-use/run.",
  },
  {
    label: "My Computer HTTP",
    detail:
      "GET /computer/browse, /status, /folders; POST folders; DELETE folder; POST reindex; GET/PUT index-prefs.",
  },
  {
    label: "Knowledge",
    detail: "POST /knowledge/upload; GET documents; DELETE doc; POST query; GET status; DELETE clear.",
  },
  {
    label: "History",
    detail: "GET /history; POST /chat/history; DELETE history; GET download.",
  },
  {
    label: "Context",
    detail: "GET/DELETE/POST /context/memory*; GET /context/knowledge-graph.",
  },
  {
    label: "Connectors",
    detail:
      "GET /connectors/platforms, …/{id}; POST connect, disconnect; OAuth authorize/callback.",
  },
  {
    label: "Browser login",
    detail: "POST /connectors/browser/start, /status, /cancel.",
  },
  {
    label: "Scheduler",
    detail: "CRUD /scheduler/jobs*, run now, logs list/delete/batch-delete.",
  },
  {
    label: "Gaming trending",
    detail: "GET /trending/gaming; POST refresh.",
  },
  {
    label: "Config",
    detail: "GET/POST /config/provider; GET/POST /config/media-models.",
  },
  {
    label: "Skills",
    detail: "GET /api/skills; POST toggle, import, import-file.",
  },
  {
    label: "MCP",
    detail: "CRUD /api/mcp/servers*; ping; list tools.",
  },
  {
    label: "Lobster",
    detail: "GET/POST /api/lobster/config; detect; run; status; trending; chat; nodes; group-chat.",
  },
  {
    label: "Wiki",
    detail: "POST /wiki/compile; GET /wiki/pages, /wiki/pages/{page_id}; POST /wiki/index/rebuild; GET /wiki/graph, /wiki/health — markdown wiki compiler.",
  },
  {
    label: "MCP presets",
    detail: "GET /api/mcp/presets; POST …/{preset_id}/install; DELETE …/{preset_id}/uninstall.",
  },
  {
    label: "Connections summary",
    detail: "GET /connections/summary, /settings/connections/summary.",
  },
  {
    label: "Evolution",
    detail: "POST/GET /evolution/signals, /events; POST /session-recall/search; POST /memory-usage/outcome; GET …/memory-usage, …/hits; GET/POST /knowledge-layers*; POST /reflections*; POST/GET /curator/*.",
  },
];

export const EN_AGENT_ROWS: ArchDetailRow[] = [
  {
    label: "bot.py · media_agent",
    detail: "ReAct loop + multimedia creation (image/video/publish/memory/RAG); registry ID is media_agent.",
  },
  {
    label: "long_video_agent.py",
    detail: "Long-form video storyboard orchestration and async task state.",
  },
  {
    label: "planning_bot.py",
    detail: "Plan–execute–replan for long workflows.",
  },
  {
    label: "orchestrator.py",
    detail: "LangGraph supervisor over registered agents.",
  },
  {
    label: "router.py",
    detail: "Keyword routing plus LLM fallback to RouteResult.",
  },
  {
    label: "copywriter_agent.py",
    detail: "Marketing copy tone per platform.",
  },
  {
    label: "script_writer_agent.py",
    detail: "Short-video/storyboard scripts.",
  },
  {
    label: "trend_analyst_agent.py",
    detail: "Trend narratives and angles.",
  },
  {
    label: "reviewer_bot.py",
    detail: "Policy-oriented review; ties to moderation tools.",
  },
  {
    label: "video_editor_agent.py",
    detail: "Editing intent → remix/subtitle tools.",
  },
  {
    label: "lobster_bot.py",
    detail: "OpenClaw distributed workers orchestration.",
  },
  {
    label: "architect.py",
    detail: "Repo/architecture Q&A (project-architect skill).",
  },
  {
    label: "general_agent.py",
    detail: "Catch-all agent for uncategorized tasks.",
  },
  {
    label: "registry.py",
    detail: "Agent registry metadata for orchestrator.",
  },
  {
    label: "agents/base/*",
    detail: "Shared bot base classes and message helpers.",
  },
];

export const EN_SERVICE_ROWS: ArchDetailRow[] = [
  {
    label: "scheduler.py",
    detail: "APScheduler persisted under storage/scheduler.",
  },
  {
    label: "grpc_client.py",
    detail: "gRPC clients: OCR :50051 / Rust Parser :50052 / Go Directory :50053.",
  },
  {
    label: "mcp_client.py",
    detail: "MCP Streamable HTTP / SSE tool invocation.",
  },
  {
    label: "computer_service.py",
    detail: "Local folder index + Directory gRPC + reindex.",
  },
  {
    label: "computer_use_service.py",
    detail: "Playwright loop with caps and screenshot feedback.",
  },
  {
    label: "context_knowledge_graph.py",
    detail: "Assembles knowledge-graph API from memory/RAG/session signals.",
  },
  {
    label: "approval_service.py",
    detail: "Approval lifecycle: create/approve/reject/expire; args_preview sanitization; high-risk capability gating.",
  },
  {
    label: "memory_coordinator.py",
    detail: "Memory lifecycle: initialize → prefetch → after_turn → on_pre_compress → shutdown.",
  },
  {
    label: "learning_data_pipeline.py",
    detail: "Unified ingestion of trace/history/feedback/skill_usage events into storage/evolution/.",
  },
  {
    label: "reflection_loop.py",
    detail: "Post-trace reflection and event generation.",
  },
  {
    label: "wiki_compiler.py",
    detail: "Compile trace / research / text into local Markdown Wiki; frontmatter, wikilink, health checks.",
  },
  {
    label: "evolution_signals.py",
    detail: "Capture trace, skill_usage, feedback signals into evolution storage.",
  },
  {
    label: "knowledge_layers.py",
    detail: "Knowledge taxonomy, auto-classify, metadata enrichment.",
  },
  {
    label: "memory_evaluation.py",
    detail: "Record memory hit outcomes and usage stats.",
  },
  {
    label: "memory_quality.py",
    detail: "Quality scoring and summary optimization before memory write.",
  },
  {
    label: "mcp_managed_launcher.py",
    detail: "Managed MCP preset lifecycle (start/stop/snapshot).",
  },
  {
    label: "mcp_presets.py",
    detail: "Built-in MCP preset catalog and metadata (filesystem, sqlite, fetch, etc).",
  },
  {
    label: "session_recall.py",
    detail: "Keyword and vector-based historical session retrieval.",
  },
  {
    label: "connections_summary.py",
    detail: "Connector status aggregation for settings and monitoring.",
  },
  {
    label: "learning_curator.py",
    detail: "Idle-triggered learning curation (dry-run toggleable).",
  },
];

export const EN_TOOL_ROWS: ArchDetailRow[] = [
  {
    label: "facade · content/",
    detail: "Facade over script/copy atomic tools.",
  },
  {
    label: "facade · media/",
    detail: "Facade for image/video/long-video backends.",
  },
  {
    label: "facade · social/",
    detail: "Facade for publish/reach.",
  },
  {
    label: "facade · knowledge/",
    detail: "Facade for RAG document/query lifecycle.",
  },
  {
    label: "multimodal_tools.py",
    detail: "Image/audio/video understanding; optional Rust parsers.",
  },
  {
    label: "image_tools · video_tools · long_video_tools",
    detail: "Vendor-specific generation wrappers.",
  },
  {
    label: "audio_tools · subtitle_tools",
    detail: "TTS and subtitle pipelines (often FFmpeg).",
  },
  {
    label: "remix_tools.py",
    detail: "Template remix and multi-track merge.",
  },
  {
    label: "script_tools · copywriting_tools",
    detail: "LLM templates for script and copy.",
  },
  {
    label: "publisher_tools · reach_tools",
    detail: "Connector-facing publish and reach helpers.",
  },
  {
    label: "lobster_tools.py",
    detail: "Lobster network RPC helpers.",
  },
  {
    label: "rag_tools · memory_tools",
    detail: "LlamaIndex/Chroma retrieval and memory CRUD.",
  },
  {
    label: "trend_tools · gaming_trending · social_trending",
    detail: "Trend analytics plus scrapers/caches.",
  },
  {
    label: "moderation_tools · exceptions",
    detail: "Moderation atoms and tool-layer errors.",
  },
  {
    label: "media_common · media_tools · _envelope",
    detail: "Shared media helpers and request envelopes.",
  },
];

export const EN_CONNECTOR_ROWS: ArchDetailRow[] = [
  {
    label: "base.py · manager.py",
    detail: "Abstract connector + registry; credentials under storage/profiles.",
  },
  {
    label: "interactive_login · browser_login",
    detail: "Human-in-the-loop auth and Playwright session capture.",
  },
  {
    label: "douyin · kuaishou · xiaohongshu · weibo",
    detail: "Domestic short-video / feed publishers.",
  },
  {
    label: "bilibili · video_channel",
    detail: "Mid/long video and WeChat Channels.",
  },
  {
    label: "youtube · twitter · tiktok",
    detail: "International video/social publishers.",
  },
  {
    label: "mock.py",
    detail: "Stub connector for offline/CI.",
  },
];

export const EN_MICRO_GO: ArchInfraRow[] = [
  {
    label: "Directory",
    detail: "Large-scale directory listing/search for indexing.",
  },
  {
    label: "Scraper",
    detail: "Worker pool + token-bucket batch fetch.",
  },
  {
    label: "Watcher",
    detail: "Filesystem notifications for incremental sync.",
  },
  {
    label: "Aggregator",
    detail: "Fan-in queries across workers.",
  },
  {
    label: "Ops",
    detail: "gRPC :50053, proto/mediaagent/*; grpc_client uses TLS.",
  },
];

export const EN_MICRO_RUST: ArchInfraRow[] = [
  {
    label: "Document parser",
    detail: "Safe PDF/DOCX/text parsing (nom).",
  },
  {
    label: "Video parser",
    detail: "MP4/MKV structure and streaming reads.",
  },
  {
    label: "Crypto · keystore",
    detail: "Envelope crypto and secure key storage.",
  },
  {
    label: "OCR",
    detail: "Image text extraction for multimodal/RAG.",
  },
  {
    label: "Ops",
    detail: "gRPC :50052 Tonic; binary parsers (MP4/PDF/DOCX); optional mTLS."
  },
];

export const EN_LL_INFRA: ArchInfraRow[] = [
  { label: "Zhipu GLM", detail: "glm-* chat/media routing; ZHIPUAI_API_KEY." },
  {
    label: "Alibaba Qwen · DashScope",
    detail: "ALIBABA_API_KEY or DASHSCOPE_API_KEY.",
  },
  { label: "Google Gemini", detail: "GOOGLE_API_KEY." },
  { label: "DeepSeek", detail: "DEEPSEEK_API_KEY." },
  { label: "ByteDance Doubao", detail: "BYTEDANCE_API_KEY." },
  {
    label: "Jimeng",
    detail: "JIMENG_ACCESS_KEY + SECRET_KEY.",
  },
  { label: "OpenAI GPT", detail: "OPENAI_API_KEY compatible endpoints." },
  { label: "OpenRouter", detail: "OPENROUTER_API_KEY multi-model hub." },
];

export const EN_MEDIA_INFRA: ArchInfraRow[] = [
  {
    label: "Images",
    detail: "CogView, Jimeng, Gemini Image via media_models.",
  },
  {
    label: "Video",
    detail: "CogVideoX, Jimeng, SeaDance (ARK_API_KEY).",
  },
  {
    label: "Audio & subtitles",
    detail: "TTS backends + FFmpeg mux; ASR in subtitle_tools.",
  },
  {
    label: "Remix",
    detail: "remix_tools / ai-remix FFmpeg pipelines.",
  },
  {
    label: "Artifacts",
    detail: "storage/outputs; uploads/temp per project rules.",
  },
];

export const EN_COMPUTER_INFRA: ArchInfraRow[] = [
  {
    label: "Runtime",
    detail: "Playwright Chromium; PLAYWRIGHT_BROWSERS_PATH.",
  },
  {
    label: "Guards",
    detail: "Step caps and timeouts in computer_use_service.",
  },
  {
    label: "Artifacts",
    detail: "Logs, screenshots, Markdown reports.",
  },
];

export const EN_STORAGE_INFRA: ArchInfraRow[] = [
  {
    label: "ChromaDB",
    detail: "Vectors under storage/rag/ via chroma_client/rag_manager.",
  },
  {
    label: "auth.db",
    detail: "SQLite users/sessions.",
  },
  {
    label: "outputs · uploads · temp",
    detail: "Generated assets and scratch; never system /tmp.",
  },
  {
    label: "memory · traces · scheduler · profiles · trending · computer",
    detail: "Agent memory JSON, trace_store, jobs, platform creds, trend cache, computer metadata.",
  },
  {
    label: "JSON config",
    detail: "skills_enabled.json, mcp_servers.json, scheduler stores.",
  },
];
