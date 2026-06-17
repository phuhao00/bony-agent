// web/types/workflow.ts — 工作流前端类型定义

// ── 节点类型 ─────────────────────────────────────────────────────

export type NodeType =
  // 触发器
  | "trigger_manual"
  | "trigger_schedule"
  | "trigger_webhook"
  | "trigger_trending"
  | "trigger_rss"
  // AI Agent
  | "agent_script_writer"
  | "agent_copywriter"
  | "agent_media"
  | "agent_general"
  | "agent_trend_analyst"
  | "agent_reviewer"
  | "agent_video_editor"
  | "agent_planning"
  | "agent_long_video"
  | "agent_architect"
  // 工具
  | "tool_image"
  | "tool_video"
  | "tool_audio"
  | "tool_publish"
  | "tool_rag"
  | "tool_http"
  | "tool_moderation"
  | "tool_subtitle"
  | "tool_remix"
  | "tool_trending"
  | "tool_web_search"
  | "tool_template"
  | "tool_transform"
  | "tool_memory_search"
  | "tool_memory_save"
  // 流程控制
  | "control_condition"
  | "control_loop"
  | "control_parallel"
  | "control_merge"
  | "control_switch"
  | "control_wait"
  // 输出
  | "output_preview"
  | "output_save_history"
  | "output_notify"

export type NodeCategory = "trigger" | "agent" | "tool" | "control" | "output"

export interface NodeTypeInfo {
  type: NodeType
  label: string
  category: NodeCategory
  description: string
  icon: string          // emoji or icon name
  color: string         // tailwind bg color class
  inputs: PortDef[]
  outputs: PortDef[]
  defaultConfig: Record<string, unknown>
  /** 调色板内二级分组标题（同分类下相邻相同分组的节点会归类展示） */
  paletteGroup?: string
}

export interface PortDef {
  id: string
  label: string
  type: "string" | "image_url" | "video_url" | "audio_url" | "any"
  required: boolean
}

// ── 工作流定义 ────────────────────────────────────────────────────

export interface WorkflowNodePosition {
  x: number
  y: number
}

/** React Flow 节点 data 字段 */
export interface WorkflowNodeData {
  label: string
  node_type: NodeType
  config: Record<string, unknown>
  input_map: Record<string, string>   // param → "$nodeId.outputKey"
  output_map: Record<string, string>  // outputKey → description
}

/** 存储格式的节点定义 */
export interface WorkflowNodeDef {
  node_id: string
  node_type: NodeType
  config_json: string           // JSON serialized config
  input_map: Record<string, string>
  output_map: Record<string, string>
  position: WorkflowNodePosition
  label: string
}

/** 边（连接）定义 */
export interface WorkflowEdgeDef {
  source: string
  target: string
  source_handle: string
  target_handle: string
}

/** 完整工作流定义 */
export interface WorkflowDef {
  id: string
  name: string
  description: string
  nodes: WorkflowNodeDef[]
  edges: WorkflowEdgeDef[]
  created_at: number            // Unix timestamp seconds
  updated_at: number
  version: number
}

/** 列表摘要 */
export interface WorkflowSummary {
  id: string
  name: string
  description: string
  node_count: number
  created_at: number
  updated_at: number
}

// ── 运行状态 ─────────────────────────────────────────────────────

export type NodeRunStatus = "pending" | "running" | "completed" | "failed" | "skipped"
export type WorkflowRunStatus = "running" | "completed" | "failed" | "cancelled"

export interface NodeRunRecord {
  node_id: string
  node_type: NodeType
  status: NodeRunStatus
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  error: string
  started_at: number | null   // Unix ms
  finished_at: number | null
}

export interface WorkflowRunRecord {
  run_id: string
  workflow_id: string
  status: WorkflowRunStatus
  node_records: Record<string, NodeRunRecord>
  variables: Record<string, string>
  initial_variables: Record<string, string>
  started_at: number
  finished_at: number | null
  error: string
}

export interface RunSummary {
  run_id: string
  workflow_id: string
  status: WorkflowRunStatus
  started_at: number
  finished_at: number | null
}

// ── SSE 事件 ─────────────────────────────────────────────────────

export type WorkflowSSEEventType =
  | "step_start"
  | "step_done"
  | "step_error"
  | "workflow_done"
  | "workflow_error"
  | "heartbeat"

export interface WorkflowSSEEvent {
  run_id: string
  node_id?: string
  node_type?: string
  data?: Record<string, unknown>
  ts: number    // Unix ms
}

// ── API 请求 / 响应 ──────────────────────────────────────────────

export interface CreateWorkflowRequest {
  name: string
  description?: string
  nodes?: WorkflowNodeDef[]
  edges?: WorkflowEdgeDef[]
}

export interface UpdateWorkflowRequest {
  name?: string
  description?: string
  nodes?: WorkflowNodeDef[]
  edges?: WorkflowEdgeDef[]
}

export interface RunWorkflowRequest {
  initial_variables?: Record<string, string>
}

// ── 节点类型注册表（前端常量）────────────────────────────────────

export const NODE_TYPE_REGISTRY: Record<NodeType, NodeTypeInfo> = {
  trigger_manual: {
    type: "trigger_manual",
    label: "手动触发",
    category: "trigger",
    description: "手动点击运行工作流",
    icon: "▶",
    color: "bg-green-500",
    inputs: [],
    outputs: [{ id: "output", label: "输出", type: "any", required: false }],
    defaultConfig: {},
    paletteGroup: "时间与手动",
  },
  trigger_schedule: {
    type: "trigger_schedule",
    label: "定时触发",
    category: "trigger",
    description: "按 Cron 表达式定时运行",
    icon: "⏰",
    color: "bg-green-600",
    inputs: [],
    outputs: [{ id: "output", label: "输出", type: "any", required: false }],
    defaultConfig: { cron: "0 9 * * 1-5", timezone: "Asia/Shanghai" },
    paletteGroup: "时间与手动",
  },
  trigger_webhook: {
    type: "trigger_webhook",
    label: "Webhook 触发",
    category: "trigger",
    description: "接收 HTTP 请求触发运行",
    icon: "🔗",
    color: "bg-green-700",
    inputs: [],
    outputs: [{ id: "output", label: "Payload", type: "any", required: false }],
    defaultConfig: { path: "", secret: "" },
    paletteGroup: "Webhook 与集成",
  },
  trigger_trending: {
    type: "trigger_trending",
    label: "热点触发",
    category: "trigger",
    description: "当热点榜单更新时自动触发",
    icon: "🔥",
    color: "bg-green-500",
    inputs: [],
    outputs: [
      { id: "topic", label: "热点话题", type: "string", required: false },
      { id: "rank", label: "排名", type: "string", required: false },
    ],
    defaultConfig: { platform: "all", top_n: 10, check_interval_minutes: 30 },
    paletteGroup: "热点与资讯",
  },
  trigger_rss: {
    type: "trigger_rss",
    label: "RSS 触发",
    category: "trigger",
    description: "监控 RSS/Atom 订阅源，有新条目时触发",
    icon: "📡",
    color: "bg-green-600",
    inputs: [],
    outputs: [
      { id: "title", label: "标题", type: "string", required: false },
      { id: "link", label: "链接", type: "string", required: false },
      { id: "summary", label: "摘要", type: "string", required: false },
    ],
    defaultConfig: { feed_url: "", check_interval_minutes: 60 },
    paletteGroup: "热点与资讯",
  },
  agent_script_writer: {
    type: "agent_script_writer",
    label: "剧本撰写",
    category: "agent",
    description: "AI 生成视频剧本/脚本",
    icon: "✍️",
    color: "bg-purple-500",
    inputs: [{ id: "topic", label: "主题", type: "string", required: true }],
    outputs: [{ id: "script", label: "剧本", type: "string", required: false }],
    defaultConfig: { user_prompt_template: "请为以下主题创作视频脚本：{{topic}}" },
    paletteGroup: "剧本与脚本",
  },
  agent_copywriter: {
    type: "agent_copywriter",
    label: "文案撰写",
    category: "agent",
    description: "AI 生成营销文案/标题",
    icon: "📝",
    color: "bg-purple-600",
    inputs: [{ id: "topic", label: "主题", type: "string", required: true }],
    outputs: [{ id: "copy", label: "文案", type: "string", required: false }],
    defaultConfig: { user_prompt_template: "请为以下主题生成吸引人的文案：{{topic}}" },
    paletteGroup: "文案与标题",
  },
  agent_media: {
    type: "agent_media",
    label: "媒体创作 Agent",
    category: "agent",
    description: "多模态媒体创作 Agent",
    icon: "🎨",
    color: "bg-purple-700",
    inputs: [{ id: "prompt", label: "指令", type: "string", required: true }],
    outputs: [{ id: "output", label: "结果", type: "any", required: false }],
    defaultConfig: { max_steps: 10 },
    paletteGroup: "综合媒体",
  },
  agent_general: {
    type: "agent_general",
    label: "通用 Agent",
    category: "agent",
    description: "通用 AI Agent，支持多种任务",
    icon: "🤖",
    color: "bg-purple-400",
    inputs: [{ id: "prompt", label: "指令", type: "string", required: true }],
    outputs: [{ id: "output", label: "结果", type: "string", required: false }],
    defaultConfig: { max_steps: 10 },
    paletteGroup: "通用推理",
  },
  agent_trend_analyst: {
    type: "agent_trend_analyst",
    label: "热点分析 Agent",
    category: "agent",
    description: "分析热点趋势，提炼内容角度与话题标签",
    icon: "📊",
    color: "bg-purple-500",
    inputs: [{ id: "topic", label: "话题/关键词", type: "string", required: true }],
    outputs: [
      { id: "analysis", label: "分析结果", type: "string", required: false },
      { id: "hashtags", label: "话题标签", type: "string", required: false },
    ],
    defaultConfig: { platforms: ["douyin", "xiaohongshu"], depth: "medium" },
    paletteGroup: "热点与趋势",
  },
  agent_reviewer: {
    type: "agent_reviewer",
    label: "审核 Agent",
    category: "agent",
    description: "合规检测与平台规则审核，自动修正违规内容",
    icon: "🛡️",
    color: "bg-purple-600",
    inputs: [{ id: "content", label: "待审内容", type: "string", required: true }],
    outputs: [
      { id: "passed", label: "是否通过", type: "string", required: false },
      { id: "fixed", label: "修正后内容", type: "string", required: false },
      { id: "issues", label: "问题列表", type: "string", required: false },
    ],
    defaultConfig: { platforms: ["all"], auto_fix: true },
    paletteGroup: "审核与合规",
  },
  agent_video_editor: {
    type: "agent_video_editor",
    label: "视频剪辑 Agent",
    category: "agent",
    description: "AI 智能混剪、字幕添加、配音合成",
    icon: "🎞️",
    color: "bg-purple-700",
    inputs: [
      { id: "video_url", label: "视频素材", type: "video_url", required: true },
      { id: "script", label: "剪辑脚本", type: "string", required: false },
    ],
    outputs: [{ id: "output_video", label: "成品视频", type: "video_url", required: false }],
    defaultConfig: { add_subtitle: true, add_bgm: false, style: "auto" },
    paletteGroup: "剪辑与后期",
  },
  agent_planning: {
    type: "agent_planning",
    label: "规划 Agent",
    category: "agent",
    description: "Plan-and-Execute 模式，将复杂任务拆解为子步骤并执行",
    icon: "🗺️",
    color: "bg-purple-800",
    inputs: [{ id: "goal", label: "目标描述", type: "string", required: true }],
    outputs: [
      { id: "result", label: "执行结果", type: "string", required: false },
      { id: "plan", label: "执行计划", type: "string", required: false },
    ],
    defaultConfig: { max_steps: 5, replan: true },
    paletteGroup: "规划与拆解",
  },
  agent_long_video: {
    type: "agent_long_video",
    label: "长视频工坊 Agent",
    category: "agent",
    description: "长视频分镜、章节结构与多段脚本规划",
    icon: "🎬",
    color: "bg-purple-900",
    inputs: [{ id: "prompt", label: "选题与要求", type: "string", required: true }],
    outputs: [
      { id: "outline", label: "分镜大纲", type: "string", required: false },
      { id: "segments", label: "分段脚本", type: "string", required: false },
    ],
    defaultConfig: { target_duration_minutes: 10, style: "纪录片" },
    paletteGroup: "长视频",
  },
  agent_architect: {
    type: "agent_architect",
    label: "架构规划 Agent",
    category: "agent",
    description: "内容管线、技术方案与结构化产出规划",
    icon: "🏗️",
    color: "bg-violet-700",
    inputs: [{ id: "prompt", label: "需求说明", type: "string", required: true }],
    outputs: [
      { id: "blueprint", label: "方案蓝图", type: "string", required: false },
      { id: "risks", label: "风险与依赖", type: "string", required: false },
    ],
    defaultConfig: { depth: "standard", audience: "创作者" },
    paletteGroup: "架构与设计",
  },
  tool_image: {
    type: "tool_image",
    label: "图片生成",
    category: "tool",
    description: "文生图 AI 工具",
    icon: "🖼️",
    color: "bg-blue-500",
    inputs: [{ id: "prompt", label: "描述词", type: "string", required: true }],
    outputs: [{ id: "image_url", label: "图片 URL", type: "image_url", required: false }],
    defaultConfig: { model: "cogview-3-plus", size: "1024x1024" },
    paletteGroup: "媒体生成",
  },
  tool_video: {
    type: "tool_video",
    label: "视频生成",
    category: "tool",
    description: "文生视频 / 图生视频",
    icon: "🎬",
    color: "bg-blue-600",
    inputs: [
      { id: "prompt", label: "描述词", type: "string", required: true },
      { id: "image_url", label: "参考图 (可选)", type: "image_url", required: false },
    ],
    outputs: [{ id: "video_url", label: "视频 URL", type: "video_url", required: false }],
    defaultConfig: { model: "cogvideox", duration_seconds: 6, from_image: false },
    paletteGroup: "媒体生成",
  },
  tool_audio: {
    type: "tool_audio",
    label: "语音合成",
    category: "tool",
    description: "文字转语音 TTS",
    icon: "🎙️",
    color: "bg-blue-400",
    inputs: [{ id: "text", label: "文本", type: "string", required: true }],
    outputs: [{ id: "audio_url", label: "音频 URL", type: "audio_url", required: false }],
    defaultConfig: { voice: "default", speed: 1.0 },
    paletteGroup: "媒体生成",
  },
  tool_publish: {
    type: "tool_publish",
    label: "内容发布",
    category: "tool",
    description: "发布内容到社交媒体平台",
    icon: "📤",
    color: "bg-orange-500",
    inputs: [
      { id: "content", label: "内容", type: "string", required: true },
      { id: "media_url", label: "媒体 URL", type: "any", required: false },
    ],
    outputs: [{ id: "result", label: "发布结果", type: "string", required: false }],
    defaultConfig: { platforms: ["xiaohongshu"], title_template: "", description_template: "" },
    paletteGroup: "发布与分发",
  },
  tool_rag: {
    type: "tool_rag",
    label: "知识库查询",
    category: "tool",
    description: "从 RAG 知识库检索相关内容",
    icon: "🔍",
    color: "bg-cyan-500",
    inputs: [{ id: "query", label: "查询", type: "string", required: true }],
    outputs: [{ id: "result", label: "检索结果", type: "string", required: false }],
    defaultConfig: {},
    paletteGroup: "知识与记忆",
  },
  tool_memory_search: {
    type: "tool_memory_search",
    label: "记忆检索",
    category: "tool",
    description: "向量检索历史记忆与会话沉淀",
    icon: "🧠",
    color: "bg-teal-600",
    inputs: [{ id: "query", label: "检索关键词", type: "string", required: true }],
    outputs: [{ id: "memories", label: "记忆片段", type: "string", required: false }],
    defaultConfig: { top_k: 5 },
    paletteGroup: "知识与记忆",
  },
  tool_memory_save: {
    type: "tool_memory_save",
    label: "记忆写入",
    category: "tool",
    description: "将结论或偏好写入长期记忆库",
    icon: "💾",
    color: "bg-teal-500",
    inputs: [{ id: "content", label: "要记住的内容", type: "string", required: true }],
    outputs: [{ id: "status", label: "写入结果", type: "string", required: false }],
    defaultConfig: { memory_type: "fact", source: "workflow" },
    paletteGroup: "知识与记忆",
  },
  tool_http: {
    type: "tool_http",
    label: "HTTP 请求",
    category: "tool",
    description: "发起 HTTP 请求，集成外部 API",
    icon: "🌐",
    color: "bg-cyan-600",
    inputs: [{ id: "body", label: "请求体", type: "string", required: false }],
    outputs: [
      { id: "status_code", label: "状态码", type: "string", required: false },
      { id: "body", label: "响应体", type: "string", required: false },
    ],
    defaultConfig: { url: "", method: "GET", headers: {} },
    paletteGroup: "集成与自动化",
  },
  tool_moderation: {
    type: "tool_moderation",
    label: "内容审核",
    category: "tool",
    description: "检测内容是否违规（敏感词/政策/平台规则）",
    icon: "🔒",
    color: "bg-red-500",
    inputs: [{ id: "content", label: "待检内容", type: "string", required: true }],
    outputs: [
      { id: "safe", label: "是否安全", type: "string", required: false },
      { id: "issues", label: "风险标签", type: "string", required: false },
    ],
    defaultConfig: { level: "standard", platforms: ["all"] },
    paletteGroup: "内容安全",
  },
  tool_subtitle: {
    type: "tool_subtitle",
    label: "字幕生成",
    category: "tool",
    description: "ASR 语音识别，自动生成 SRT 字幕并烧入视频",
    icon: "💬",
    color: "bg-blue-400",
    inputs: [{ id: "video_url", label: "视频 URL", type: "video_url", required: true }],
    outputs: [
      { id: "srt", label: "字幕文本 (SRT)", type: "string", required: false },
      { id: "video_url", label: "带字幕视频", type: "video_url", required: false },
    ],
    defaultConfig: { language: "zh", burn_in: true },
    paletteGroup: "字幕与混剪",
  },
  tool_remix: {
    type: "tool_remix",
    label: "视频混剪",
    category: "tool",
    description: "将多段素材智能拼接并输出混剪视频",
    icon: "✂️",
    color: "bg-blue-600",
    inputs: [
      { id: "clips", label: "素材列表 (JSON)", type: "string", required: true },
      { id: "script", label: "剪辑脚本", type: "string", required: false },
    ],
    outputs: [{ id: "video_url", label: "混剪视频", type: "video_url", required: false }],
    defaultConfig: { style: "auto", add_bgm: true, add_subtitle: true },
    paletteGroup: "字幕与混剪",
  },
  tool_trending: {
    type: "tool_trending",
    label: "热点查询",
    category: "tool",
    description: "获取各平台实时热点榜单与趋势数据",
    icon: "📈",
    color: "bg-orange-500",
    inputs: [],
    outputs: [
      { id: "topics", label: "热点列表 (JSON)", type: "string", required: false },
      { id: "top1", label: "第一热点", type: "string", required: false },
    ],
    defaultConfig: { platform: "all", top_n: 10 },
    paletteGroup: "热点与检索",
  },
  tool_web_search: {
    type: "tool_web_search",
    label: "联网搜索",
    category: "tool",
    description: "DuckDuckGo / Bing 联网检索，获取最新资讯",
    icon: "🔎",
    color: "bg-cyan-500",
    inputs: [{ id: "query", label: "搜索词", type: "string", required: true }],
    outputs: [
      { id: "results", label: "搜索摘要", type: "string", required: false },
      { id: "links", label: "来源链接", type: "string", required: false },
    ],
    defaultConfig: { max_results: 5, region: "zh-cn" },
    paletteGroup: "热点与检索",
  },
  tool_template: {
    type: "tool_template",
    label: "文本模板",
    category: "tool",
    description: "使用 Jinja2 模板渲染结构化文本",
    icon: "📄",
    color: "bg-gray-500",
    inputs: [{ id: "variables", label: "变量 (JSON)", type: "string", required: false }],
    outputs: [{ id: "text", label: "渲染结果", type: "string", required: false }],
    defaultConfig: { template: "{{content}}" },
    paletteGroup: "数据与模板",
  },
  tool_transform: {
    type: "tool_transform",
    label: "数据转换",
    category: "tool",
    description: "通过 JSONPath / 正则提取或转换上游数据",
    icon: "⚙️",
    color: "bg-gray-600",
    inputs: [{ id: "input", label: "输入数据", type: "any", required: true }],
    outputs: [{ id: "output", label: "转换结果", type: "any", required: false }],
    defaultConfig: { mode: "jsonpath", expression: "$.data" },
    paletteGroup: "数据与模板",
  },
  control_condition: {
    type: "control_condition",
    label: "条件判断",
    category: "control",
    description: "根据条件走不同分支",
    icon: "↔️",
    color: "bg-yellow-500",
    inputs: [{ id: "input", label: "输入", type: "any", required: true }],
    outputs: [
      { id: "true", label: "True", type: "any", required: false },
      { id: "false", label: "False", type: "any", required: false },
    ],
    defaultConfig: { expression: "" },
    paletteGroup: "分支与合并",
  },
  control_loop: {
    type: "control_loop",
    label: "循环",
    category: "control",
    description: "对列表中每个元素重复执行",
    icon: "🔄",
    color: "bg-yellow-600",
    inputs: [{ id: "items", label: "列表", type: "any", required: true }],
    outputs: [{ id: "item", label: "当前项", type: "any", required: false }],
    defaultConfig: {},
    paletteGroup: "迭代",
  },
  control_parallel: {
    type: "control_parallel",
    label: "并行分支",
    category: "control",
    description: "同时启动多条分支并行执行",
    icon: "⑃",
    color: "bg-yellow-500",
    inputs: [{ id: "input", label: "输入", type: "any", required: false }],
    outputs: [
      { id: "branch_1", label: "分支 1", type: "any", required: false },
      { id: "branch_2", label: "分支 2", type: "any", required: false },
    ],
    defaultConfig: { branches: 2 },
    paletteGroup: "并行",
  },
  control_merge: {
    type: "control_merge",
    label: "聚合合并",
    category: "control",
    description: "等待所有并行分支完成后汇聚结果",
    icon: "⑂",
    color: "bg-yellow-700",
    inputs: [
      { id: "branch_1", label: "分支 1", type: "any", required: false },
      { id: "branch_2", label: "分支 2", type: "any", required: false },
    ],
    outputs: [{ id: "merged", label: "合并结果", type: "any", required: false }],
    defaultConfig: { strategy: "all" },
    paletteGroup: "分支与合并",
  },
  control_switch: {
    type: "control_switch",
    label: "多路分支",
    category: "control",
    description: "根据值匹配走不同 case 分支（Switch/Case）",
    icon: "🔀",
    color: "bg-amber-500",
    inputs: [{ id: "value", label: "匹配值", type: "any", required: true }],
    outputs: [
      { id: "case_1", label: "Case 1", type: "any", required: false },
      { id: "case_2", label: "Case 2", type: "any", required: false },
      { id: "default", label: "Default", type: "any", required: false },
    ],
    defaultConfig: { cases: [] },
    paletteGroup: "分支与合并",
  },
  control_wait: {
    type: "control_wait",
    label: "等待延迟",
    category: "control",
    description: "暂停执行指定时长后继续",
    icon: "⏳",
    color: "bg-amber-600",
    inputs: [{ id: "input", label: "输入", type: "any", required: false }],
    outputs: [{ id: "output", label: "输出", type: "any", required: false }],
    defaultConfig: { seconds: 5 },
    paletteGroup: "时机控制",
  },
  output_preview: {
    type: "output_preview",
    label: "预览输出",
    category: "output",
    description: "在执行面板中预览最终结果",
    icon: "👁️",
    color: "bg-gray-500",
    inputs: [{ id: "content", label: "内容", type: "any", required: true }],
    outputs: [],
    defaultConfig: {},
    paletteGroup: "交付",
  },
  output_save_history: {
    type: "output_save_history",
    label: "保存历史",
    category: "output",
    description: "将生成结果保存到历史记录与知识库",
    icon: "💾",
    color: "bg-gray-600",
    inputs: [{ id: "content", label: "内容", type: "any", required: true }],
    outputs: [{ id: "record_id", label: "记录 ID", type: "string", required: false }],
    defaultConfig: { save_to_knowledge: false, tags: [] },
    paletteGroup: "归档",
  },
  output_notify: {
    type: "output_notify",
    label: "发送通知",
    category: "output",
    description: "通过飞书/邮件/Webhook 发送完成通知",
    icon: "🔔",
    color: "bg-gray-400",
    inputs: [{ id: "message", label: "通知内容", type: "string", required: true }],
    outputs: [],
    defaultConfig: { channel: "feishu", webhook_url: "" },
    paletteGroup: "通知",
  },
}

export const NODE_CATEGORIES: { id: NodeCategory; label: string; color: string }[] = [
  { id: "trigger", label: "触发器", color: "text-green-600" },
  { id: "agent", label: "AI Agent", color: "text-purple-600" },
  { id: "tool", label: "工具", color: "text-blue-600" },
  { id: "control", label: "流程控制", color: "text-yellow-600" },
  { id: "output", label: "输出", color: "text-gray-600" },
]
