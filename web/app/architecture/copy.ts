import type { Locale } from "@/lib/i18n";

import {
  EN_AGENT_ROWS,
  EN_API_ROWS,
  EN_COMPUTER_INFRA,
  EN_CONNECTOR_ROWS,
  EN_FRONTEND_ROWS,
  EN_LL_INFRA,
  EN_MEDIA_INFRA,
  EN_MICRO_GO,
  EN_MICRO_RUST,
  EN_SERVICE_ROWS,
  EN_STORAGE_INFRA,
  EN_TOOL_ROWS,
  ZH_AGENT_ROWS,
  ZH_API_ROWS,
  ZH_COMPUTER_INFRA,
  ZH_CONNECTOR_ROWS,
  ZH_FRONTEND_ROWS,
  ZH_LL_INFRA,
  ZH_MEDIA_INFRA,
  ZH_MICRO_GO,
  ZH_MICRO_RUST,
  ZH_SERVICE_ROWS,
  ZH_STORAGE_INFRA,
  ZH_TOOL_ROWS,
} from "./detail-data";

export type ArchNodeKey =
  | "frontend"
  | "api"
  | "agents"
  | "services"
  | "tools"
  | "connectors"
  | "llm"
  | "media"
  | "computeruse"
  | "storage"
  | "micro_go"
  | "micro_rust"
  | null;

/** 系统层级条目：path 为前端路由或标识；detail 为功能说明（架构页展开可见） */
export type ArchLayerItem = {
  label: string;
  path?: string;
  detail?: string;
};

/** 微服务 / 基础设施卡片内的条目 */
export type ArchDetailItem = { label: string; detail?: string };

export type ArchLayerStyle = {
  key: ArchNodeKey;
  color: string;
  bg: string;
  border: string;
  textColor: string;
  badgeColor: string;
  icon: string;
};

export type ArchLayer = ArchLayerStyle & {
  title: string;
  subtitle: string;
  items: ArchLayerItem[];
};

export type ArchFlowStep = { icon: string; label: string; sub: string };

export type ArchBottomLayer = ArchLayerStyle & {
  title: string;
  subtitle: string;
  items: ArchDetailItem[];
};

export type ArchMicroLayer = ArchLayerStyle & {
  title: string;
  subtitle: string;
  items: ArchDetailItem[];
};

export type ArchTechColumn = {
  category: string;
  icon: string;
  techs: string[];
  color: string;
  label: string;
};

export type ArchStat = {
  label: string;
  value: string;
  unit: string;
  icon: string;
  color: string;
  bg: string;
};

export type ArchTreePanel = {
  title: string;
  icon: string;
  code: string;
};

export type ArchitecturePageCopy = {
  title: string;
  subtitle: string;
  hintBadge: string;
    sections: {
      requestFlow: string;
      systemLayers: string;
      microservices: string;
      infra: string;
      techStack: string;
      scale: string;
      tree: string;
      detailHint: string;
    };
  componentsCount: (n: number) => string;
  mainLayers: ArchLayer[];
  microLayers: ArchMicroLayer[];
  bottomLayers: ArchBottomLayer[];
  flowSteps: ArchFlowStep[];
  techStack: ArchTechColumn[];
  stats: ArchStat[];
  treePanels: ArchTreePanel[];
};

const STYLE_MAIN: Record<
  Exclude<
    ArchNodeKey,
    | null
    | "llm"
    | "media"
    | "computeruse"
    | "storage"
    | "micro_go"
    | "micro_rust"
  >,
  ArchLayerStyle
> = {
  frontend: {
    key: "frontend",
    color: "from-blue-500 to-indigo-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
    textColor: "text-blue-900",
    badgeColor: "bg-blue-100 text-blue-800",
    icon: "🖥️",
  },
  api: {
    key: "api",
    color: "from-violet-500 to-purple-600",
    bg: "bg-violet-50",
    border: "border-violet-200",
    textColor: "text-violet-900",
    badgeColor: "bg-violet-100 text-violet-800",
    icon: "⚡",
  },
  agents: {
    key: "agents",
    color: "from-emerald-500 to-teal-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    textColor: "text-emerald-900",
    badgeColor: "bg-emerald-100 text-emerald-800",
    icon: "🤖",
  },
  services: {
    key: "services",
    color: "from-teal-500 to-cyan-600",
    bg: "bg-teal-50",
    border: "border-teal-200",
    textColor: "text-teal-900",
    badgeColor: "bg-teal-100 text-teal-800",
    icon: "⚙️",
  },
  tools: {
    key: "tools",
    color: "from-amber-500 to-orange-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    textColor: "text-amber-900",
    badgeColor: "bg-amber-100 text-amber-800",
    icon: "🔧",
  },
  connectors: {
    key: "connectors",
    color: "from-pink-500 to-rose-600",
    bg: "bg-pink-50",
    border: "border-pink-200",
    textColor: "text-pink-900",
    badgeColor: "bg-pink-100 text-pink-800",
    icon: "🔗",
  },
};

const STYLE_BOTTOM: Record<
  "llm" | "media" | "computeruse" | "storage",
  ArchLayerStyle
> = {
  llm: {
    key: "llm",
    color: "from-cyan-500 to-sky-600",
    bg: "bg-cyan-50",
    border: "border-cyan-200",
    textColor: "text-cyan-900",
    badgeColor: "bg-cyan-100 text-cyan-800",
    icon: "🧠",
  },
  media: {
    key: "media",
    color: "from-fuchsia-500 to-purple-600",
    bg: "bg-fuchsia-50",
    border: "border-fuchsia-200",
    textColor: "text-fuchsia-900",
    badgeColor: "bg-fuchsia-100 text-fuchsia-800",
    icon: "🎨",
  },
  computeruse: {
    key: "computeruse",
    color: "from-indigo-500 to-blue-600",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
    textColor: "text-indigo-900",
    badgeColor: "bg-indigo-100 text-indigo-800",
    icon: "🌐",
  },
  storage: {
    key: "storage",
    color: "from-slate-500 to-gray-600",
    bg: "bg-slate-50",
    border: "border-slate-200",
    textColor: "text-slate-900",
    badgeColor: "bg-slate-100 text-slate-800",
    icon: "🗄️",
  },
};

const STYLE_MICRO: Record<"micro_go" | "micro_rust", ArchLayerStyle> = {
  micro_go: {
    key: "micro_go",
    color: "from-green-600 to-emerald-700",
    bg: "bg-green-50",
    border: "border-green-200",
    textColor: "text-green-900",
    badgeColor: "bg-green-100 text-green-800",
    icon: "🐹",
  },
  micro_rust: {
    key: "micro_rust",
    color: "from-orange-600 to-red-700",
    bg: "bg-orange-50",
    border: "border-orange-200",
    textColor: "text-orange-900",
    badgeColor: "bg-orange-100 text-orange-800",
    icon: "🦀",
  },
};

function zhCopy(): ArchitecturePageCopy {
  return {
    title: "项目架构图",
    subtitle: "AI Media Agent · 全链路内容生产与分发平台（Python · Next.js · Go · Rust）",
    hintBadge: "点击卡片查看逐项说明",
    sections: {
      requestFlow: "核心请求流",
      systemLayers: "系统层级架构",
      microservices: "微服务层 · gRPC（可选加速路径）",
      infra: "基础设施层",
      techStack: "技术栈一览",
      scale: "项目规模",
      tree: "目录结构",
      detailHint: "展开卡片后每条含路径（如有）与职责说明，便于对照代码与页面。",
    },
    componentsCount: (n) => `${n} 个组件`,
    mainLayers: [
      {
        ...STYLE_MAIN.frontend,
        title: "前端 · Frontend",
        subtitle: "Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Prefs zh/en",
        items: ZH_FRONTEND_ROWS,
      },
      {
        ...STYLE_MAIN.api,
        title: "后端 API · FastAPI",
        subtitle: "Python 3.10+ · LangChain / LangGraph · uvicorn",
        items: ZH_API_ROWS,
      },
      {
        ...STYLE_MAIN.agents,
        title: "Agent 层 · LangGraph",
        subtitle: "Supervisor · Plan-and-Execute · ReAct · 意图路由",
        items: ZH_AGENT_ROWS,
      },
      {
        ...STYLE_MAIN.services,
        title: "服务层 · Services",
        subtitle: "调度 · gRPC · MCP · My Computer · 浏览器自动化 · 上下文图谱",
        items: ZH_SERVICE_ROWS,
      },
      {
        ...STYLE_MAIN.tools,
        title: "工具层 · Tools",
        subtitle: "原子工具 · @tool · facade（content / media / social / knowledge）",
        items: ZH_TOOL_ROWS,
      },
      {
        ...STYLE_MAIN.connectors,
        title: "平台连接器 · Connectors",
        subtitle: "Playwright RPA · Cookie / OAuth · 浏览器登录",
        items: ZH_CONNECTOR_ROWS,
      },
    ],
    microLayers: [
      {
        ...STYLE_MICRO.micro_go,
        title: "Go 高并发引擎",
        subtitle: "backend_massive_concurrent · gRPC :50053（TLS）",
        items: ZH_MICRO_GO,
      },
      {
        ...STYLE_MICRO.micro_rust,
        title: "Rust 安全引擎",
        subtitle: "backend_safety · gRPC :50052（mTLS）",
        items: ZH_MICRO_RUST,
      },
    ],
    bottomLayers: [
      {
        ...STYLE_BOTTOM.llm,
        title: "LLM 供应商",
        subtitle: "core/llm_provider.py · OpenAI 兼容路由",
        items: ZH_LL_INFRA,
      },
      {
        ...STYLE_BOTTOM.media,
        title: "媒体生成",
        subtitle: "core/media_models.py · 即梦 / 豆包 / CogVideoX / Gemini…",
        items: ZH_MEDIA_INFRA,
      },
      {
        ...STYLE_BOTTOM.computeruse,
        title: "Computer Use",
        subtitle: "Playwright · 步骤规划 · 截图闭环",
        items: ZH_COMPUTER_INFRA,
      },
      {
        ...STYLE_BOTTOM.storage,
        title: "存储层",
        subtitle: "ChromaDB · SQLite · storage/ 约定目录",
        items: ZH_STORAGE_INFRA,
      },
    ],
    flowSteps: [
      { icon: "💬", label: "用户输入", sub: "Next.js · /api 代理" },
      { icon: "⚡", label: "FastAPI", sub: "路由 / 鉴权" },
      { icon: "🔀", label: "意图路由", sub: "router.py" },
      { icon: "🤖", label: "Agent 编排", sub: "LangGraph" },
      { icon: "🔧", label: "工具调用", sub: "原子工具并行" },
      { icon: "🔌", label: "gRPC（可选）", sub: "Go / Rust 解析加速" },
      { icon: "🧠", label: "LLM 推理", sub: "多供应商路由" },
      { icon: "🎨", label: "媒体生成", sub: "图 / 视频 / 音频" },
      { icon: "🌐", label: "Computer Use", sub: "浏览器自动化" },
      { icon: "🔗", label: "平台发布", sub: "Playwright RPA" },
      { icon: "📊", label: "向量 / 记忆", sub: "ChromaDB · RAG" },
      { icon: "✅", label: "流式响应", sub: "SSE / 前端渲染" },
    ],
    techStack: [
      {
        category: "前端",
        icon: "🖥️",
        techs: ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS 4", "next/font"],
        color: "bg-blue-50 border-blue-100",
        label: "bg-blue-100 text-blue-800",
      },
      {
        category: "后端",
        icon: "⚡",
        techs: [
          "Python 3.10+",
          "FastAPI",
          "LangChain",
          "LangGraph",
          "APScheduler",
          "gRPC / protobuf",
        ],
        color: "bg-violet-50 border-violet-100",
        label: "bg-violet-100 text-violet-800",
      },
      {
        category: "微服务",
        icon: "🔌",
        techs: ["Go 1.22+", "Rust / Tokio", "Tonic gRPC", "nom 解析"],
        color: "bg-green-50 border-green-100",
        label: "bg-green-100 text-green-800",
      },
      {
        category: "AI · 自动化 · 存储",
        icon: "🧠",
        techs: ["智谱 / Gemini / DeepSeek / OpenRouter", "LlamaIndex · ChromaDB", "Playwright", "FFmpeg"],
        color: "bg-cyan-50 border-cyan-100",
        label: "bg-cyan-100 text-cyan-800",
      },
    ],
    stats: [
      { label: "架构页·前端条目", value: "31", unit: "条", icon: "🖥️", color: "text-blue-600", bg: "bg-blue-50" },
      { label: "架构页·API 分组", value: "28", unit: "组", icon: "⚡", color: "text-violet-600", bg: "bg-violet-50" },
      { label: "架构页·Agent 条目", value: "15", unit: "条", icon: "🤖", color: "text-emerald-600", bg: "bg-emerald-50" },
      { label: "架构页·服务条目", value: "20", unit: "条", icon: "⚙️", color: "text-teal-600", bg: "bg-teal-50" },
      { label: "架构页·工具条目", value: "15", unit: "条", icon: "🔧", color: "text-amber-600", bg: "bg-amber-50" },
      { label: "上架平台连接器", value: "9", unit: "家", icon: "🔗", color: "text-pink-600", bg: "bg-pink-50" },
    ],
    treePanels: [
      {
        title: "backend/",
        icon: "⚡",
        code: `backend/
├── main.py                 # FastAPI 入口（REST 路由聚合）
├── agents/                 # LangGraph：bot(media_agent) · planning · orchestrator · router …
│   └── base/               # BaseAgent · message.py
├── core/                   # llm_provider · media_models · capabilities · platform_capabilities
│                           # execution_approval · media_pipeline · research_artifact · prompts/
├── tools/
│   ├── content/ · media/ · social/ · knowledge/  # facade
│   ├── connectors/         # 16 家平台 + manager · base · browser_login · discord · feishu …
│   └── *.py                # 原子 @tool（约 30+ 文件含子目录）
├── routers/                # auth_router · users_router
├── services/               # scheduler · grpc · mcp · computer* · approval_service · wiki_compiler
│                           # memory_coordinator · learning_data_pipeline · reflection_loop · context_kg
│                           # evolution_signals · knowledge_layers · memory_eval/quality · session_recall
│                           # connections_summary · learning_curator · mcp_presets · mcp_managed_launcher
├── utils/                  # rag_manager · chroma · trace_store · auth · task_manager …
├── admin/                  # 管理后台
├── assets/                 # 静态资源
├── memory_storage/         # 内存存储运行时数据
├── tests/                  # 后端单元测试
└── generated/              # protobuf 生成的 Python 代码`,
      },
      {
        title: "web/",
        icon: "🖥️",
        code: `web/
├── app/
│   ├── page.tsx            # 主对话 + MultimodalInput
│   ├── workbench/ · pipeline/ · companion/
│   ├── create/{script,copywriting,article}
│   ├── media/{image,video,long-video,storyboard}
│   ├── platforms/ · knowledge/ · moderation/ · scheduler/
│   ├── history/ · trending/ · computer-use/ · openclaw/
│   ├── hermes-agent/ · lark-cli/ · login/
│   ├── architecture/       # 本页（copy + detail-data）
│   ├── settings/{capabilities,customization,my-computer,context,users}
│   └── api/                # Route Handlers → 后端（83+ 路由文件）
├── contexts/ · hooks/ · lib/i18n.ts
├── messages/zh.json · en.json
└── app/components/ · Sidebar …`,
      },
      {
        title: "proto/ · 微服务仓库",
        icon: "🔌",
        code: `proto/mediaagent/           # gRPC 契约（common · directory · document · video · ocr …）

backend_massive_concurrent/     # Go · :50053 TLS
├── cmd/server/                # 服务入口
└── internal/
    └── directory/              # 目录检索

backend_safety/                 # Rust · Tokio · Tonic · :50052
├── src/grpc/                   # gRPC 实现
└── src/parser/formats/        # PDF · DOCX · MP4/MKV …`,
      },
    ],
  };
}

function enCopy(): ArchitecturePageCopy {
  return {
    title: "Architecture",
    subtitle: "AI Media Agent · End-to-end content stack (Python · Next.js · Go · Rust)",
    hintBadge: "Click a card to expand",
    sections: {
      requestFlow: "Core request flow",
      systemLayers: "System layers",
      microservices: "Microservices · gRPC (optional hot path)",
      infra: "Infrastructure",
      techStack: "Technology stack",
      scale: "Scale",
      tree: "Repository layout",
      detailHint:
        "Expand a card: each row shows an optional path plus what it does, mapped to routes and modules.",
    },
    componentsCount: (n) => `${n} items`,
    mainLayers: [
      {
        ...STYLE_MAIN.frontend,
        title: "Frontend",
        subtitle: "Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Prefs zh/en",
        items: EN_FRONTEND_ROWS,
      },
      {
        ...STYLE_MAIN.api,
        title: "Backend API · FastAPI",
        subtitle: "Python 3.10+ · LangChain / LangGraph · uvicorn",
        items: EN_API_ROWS,
      },
      {
        ...STYLE_MAIN.agents,
        title: "Agents · LangGraph",
        subtitle: "Supervisor · Plan-and-Execute · ReAct · routing",
        items: EN_AGENT_ROWS,
      },
      {
        ...STYLE_MAIN.services,
        title: "Services",
        subtitle: "Scheduler · gRPC · MCP · My Computer · browser automation · context graph",
        items: EN_SERVICE_ROWS,
      },
      {
        ...STYLE_MAIN.tools,
        title: "Tools",
        subtitle: "Atomic @tool modules · facades (content / media / social / knowledge)",
        items: EN_TOOL_ROWS,
      },
      {
        ...STYLE_MAIN.connectors,
        title: "Platform connectors",
        subtitle: "Playwright RPA · cookie / OAuth · browser login",
        items: EN_CONNECTOR_ROWS,
      },
    ],
    microLayers: [
      {
        ...STYLE_MICRO.micro_go,
        title: "Go concurrent engine",
        subtitle: "backend_massive_concurrent · gRPC :50053 (TLS)",
        items: EN_MICRO_GO,
      },
      {
        ...STYLE_MICRO.micro_rust,
        title: "Rust safety engine",
        subtitle: "backend_safety · gRPC :50052 (mTLS)",
        items: EN_MICRO_RUST,
      },
    ],
    bottomLayers: [
      {
        ...STYLE_BOTTOM.llm,
        title: "LLM providers",
        subtitle: "core/llm_provider.py · OpenAI-compatible routing",
        items: EN_LL_INFRA,
      },
      {
        ...STYLE_BOTTOM.media,
        title: "Media generation",
        subtitle: "core/media_models.py · Jimeng / Doubao / CogVideoX / Gemini…",
        items: EN_MEDIA_INFRA,
      },
      {
        ...STYLE_BOTTOM.computeruse,
        title: "Computer Use",
        subtitle: "Playwright · planning · screenshot loop",
        items: EN_COMPUTER_INFRA,
      },
      {
        ...STYLE_BOTTOM.storage,
        title: "Storage",
        subtitle: "ChromaDB · SQLite · storage/ layout",
        items: EN_STORAGE_INFRA,
      },
    ],
    flowSteps: [
      { icon: "💬", label: "User input", sub: "Next.js · /api proxy" },
      { icon: "⚡", label: "FastAPI", sub: "Routing · auth" },
      { icon: "🔀", label: "Intent routing", sub: "router.py" },
      { icon: "🤖", label: "Agent orchestration", sub: "LangGraph" },
      { icon: "🔧", label: "Tool calls", sub: "Parallel tools" },
      { icon: "🔌", label: "gRPC (optional)", sub: "Go / Rust parsers" },
      { icon: "🧠", label: "LLM inference", sub: "Multi-provider" },
      { icon: "🎨", label: "Media gen", sub: "Image / video / audio" },
      { icon: "🌐", label: "Computer Use", sub: "Browser automation" },
      { icon: "🔗", label: "Publishing", sub: "Playwright RPA" },
      { icon: "📊", label: "Vectors · memory", sub: "ChromaDB · RAG" },
      { icon: "✅", label: "Stream back", sub: "SSE · UI" },
    ],
    techStack: [
      {
        category: "Frontend",
        icon: "🖥️",
        techs: ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS 4", "next/font"],
        color: "bg-blue-50 border-blue-100",
        label: "bg-blue-100 text-blue-800",
      },
      {
        category: "Backend",
        icon: "⚡",
        techs: ["Python 3.10+", "FastAPI", "LangChain", "LangGraph", "APScheduler", "gRPC / protobuf"],
        color: "bg-violet-50 border-violet-100",
        label: "bg-violet-100 text-violet-800",
      },
      {
        category: "Microservices",
        icon: "🔌",
        techs: ["Go 1.22+", "Rust / Tokio", "Tonic gRPC", "nom parsers"],
        color: "bg-green-50 border-green-100",
        label: "bg-green-100 text-green-800",
      },
      {
        category: "AI · automation · storage",
        icon: "🧠",
        techs: ["Zhipu / Gemini / DeepSeek / OpenRouter", "LlamaIndex · ChromaDB", "Playwright", "FFmpeg"],
        color: "bg-cyan-50 border-cyan-100",
        label: "bg-cyan-100 text-cyan-800",
      },
    ],
    stats: [
      { label: "FE rows on this page", value: "31", unit: "", icon: "🖥️", color: "text-blue-600", bg: "bg-blue-50" },
      { label: "API groups described", value: "28", unit: "", icon: "⚡", color: "text-violet-600", bg: "bg-violet-50" },
      { label: "Agent rows (incl. base)", value: "15", unit: "", icon: "🤖", color: "text-emerald-600", bg: "bg-emerald-50" },
      { label: "Service rows", value: "20", unit: "", icon: "⚙️", color: "text-teal-600", bg: "bg-teal-50" },
      { label: "Tool / facade rows", value: "15", unit: "", icon: "🔧", color: "text-amber-600", bg: "bg-amber-50" },
      { label: "Platforms shipped", value: "9", unit: "", icon: "🔗", color: "text-pink-600", bg: "bg-pink-50" },
    ],
    treePanels: [
      {
        title: "backend/",
        icon: "⚡",
        code: `backend/
├── main.py                 # FastAPI entry (REST surface)
├── agents/                 # LangGraph: bot(media_agent) · planning · orchestrator · router …
│   └── base/               # BaseAgent · message.py
├── core/                   # llm_provider · media_models · capabilities · platform_capabilities
│                           # execution_approval · media_pipeline · research_artifact · prompts/
├── tools/
│   ├── content/ · media/ · social/ · knowledge/  # facades
│   ├── connectors/         # 16 platforms + manager · base · browser_login · discord · feishu …
│   └── *.py                # atomic @tools (~30+ files incl. subdirs)
├── routers/                # auth_router · users_router
├── services/               # scheduler · grpc · mcp · computer* · approval_service · wiki_compiler
│                           # memory_coordinator · learning_data_pipeline · reflection_loop · context_kg
│                           # evolution_signals · knowledge_layers · memory_eval/quality · session_recall
│                           # connections_summary · learning_curator · mcp_presets · mcp_managed_launcher
├── utils/                  # rag_manager · chroma · trace_store · auth · task_manager …
├── admin/                  # Admin dashboard
├── assets/                 # Static assets
├── memory_storage/         # Memory runtime data
├── tests/                  # Backend unit tests
└── generated/              # protobuf generated Python code`,
      },
      {
        title: "web/",
        icon: "🖥️",
        code: `web/
├── app/
│   ├── page.tsx            # Main chat + MultimodalInput
│   ├── workbench/ · pipeline/ · companion/
│   ├── create/{script,copywriting,article}
│   ├── media/{image,video,long-video,storyboard}
│   ├── platforms/ · knowledge/ · moderation/ · scheduler/
│   ├── history/ · trending/ · computer-use/ · openclaw/
│   ├── hermes-agent/ · lark-cli/ · login/
│   ├── architecture/       # This page (copy + detail-data)
│   ├── settings/{capabilities,customization,my-computer,context,users}
│   └── api/                # Route Handlers → backend (83+ route files)
├── contexts/ · hooks/ · lib/i18n.ts
├── messages/zh.json · en.json
└── app/components/ · Sidebar …`,
      },
      {
        title: "proto/ · microservices",
        icon: "🔌",
        code: `proto/mediaagent/           # gRPC contracts (common · directory · document · video · ocr …)

backend_massive_concurrent/     # Go · :50053 TLS
├── cmd/server/                # binaries
└── internal/
    └── directory/

backend_safety/                 # Rust · Tokio · Tonic · :50052
├── src/grpc/
└── src/parser/formats/        # PDF · DOCX · MP4/MKV …`,
      },
    ],
  };
}

export function getArchitectureCopy(locale: Locale): ArchitecturePageCopy {
  return locale === "en" ? enCopy() : zhCopy();
}
