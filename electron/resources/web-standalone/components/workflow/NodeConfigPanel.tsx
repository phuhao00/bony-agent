"use client";

import { NODE_TYPE_REGISTRY, NodeType } from "@/types/workflow";
import type { Edge, Node } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { WorkflowNodeData } from "./BaseNode";

interface NodeConfigPanelProps {
  node: Node | null;
  onChange: (nodeId: string, updates: Partial<WorkflowNodeData>) => void;
  nodes?: Node[];
  edges?: Edge[];
  /** 点击面板内删除按钮时移除画布节点（含连线由调用方处理） */
  onDeleteNode?: (nodeId: string) => void;
}

interface UpstreamVar {
  ref: string;       // e.g. {{node_123.analysis}}
  nodeLabel: string;
  portLabel: string;
}

function getUpstreamVars(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
): UpstreamVar[] {
  const vars: UpstreamVar[] = [];
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const src = nodes.find((n) => n.id === edge.source);
    if (!src) continue;
    const srcData = src.data as unknown as WorkflowNodeData;
    const srcInfo = NODE_TYPE_REGISTRY[srcData.node_type];
    if (!srcInfo) continue;
    const handle = edge.sourceHandle ?? "output";
    const port = srcInfo.outputs.find((p) => p.id === handle) ?? {
      id: handle,
      label: handle,
    };
    vars.push({
      ref: `{{${edge.source}.${port.id}}}`,
      nodeLabel: srcData.label || srcInfo.label,
      portLabel: port.label,
    });
  }
  return vars;
}

type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "slider"
  | "toggle"
  | "tags";

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: { value: string; label: string }[];
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: unknown;
}

interface SectionDef {
  title: string;
  icon: string;
  fields: FieldDef[];
  collapsed?: boolean;
}

// Agent schemas use SectionDef[] (sectioned); tool schemas use FieldDef[] (flat)
type AgentSchema = SectionDef[];
type ToolSchema = FieldDef[];

const AGENT_SCHEMAS: Partial<Record<NodeType, AgentSchema>> = {
  agent_media: [
    {
      title: "任务",
      icon: "✦",
      fields: [
        {
          key: "prompt",
          label: "创作指令",
          type: "textarea",
          placeholder: "生成一段关于…的视频",
          hint: "支持 {{变量名}} 引用上游节点输出",
        },
        {
          key: "system_prompt",
          label: "系统角色设定",
          type: "textarea",
          placeholder:
            "你是专业的多媒体内容创作者，擅长生成高质量的图片和视频…",
          hint: "定义 Agent 的人设与专业背景，影响创作风格",
        },
        {
          key: "output_format",
          label: "输出格式",
          type: "select",
          options: [
            { value: "markdown", label: "Markdown（含媒体链接）" },
            { value: "json", label: "JSON 结构化" },
            { value: "text", label: "纯文本" },
          ],
        },
      ],
    },
    {
      title: "模型",
      icon: "⚡",
      collapsed: true,
      fields: [
        {
          key: "model",
          label: "LLM 模型",
          type: "select",
          options: [
            { value: "", label: "使用全局默认" },
            { value: "glm-4-plus", label: "智谱 GLM-4 Plus" },
            { value: "glm-4-flash", label: "智谱 GLM-4 Flash（快速）" },
            { value: "gemini-2.0-flash", label: "Google Gemini 2.0 Flash" },
            { value: "deepseek-chat", label: "DeepSeek Chat" },
            { value: "doubao-1.5-pro-32k", label: "豆包 1.5 Pro 32K" },
          ],
        },
        {
          key: "temperature",
          label: "创意度 (Temperature)",
          type: "slider",
          min: 0,
          max: 1,
          step: 0.05,
          defaultValue: 0.7,
          hint: "0 = 精确/保守  ·  1 = 多样/创意",
        },
        {
          key: "max_tokens",
          label: "最大 Token 数",
          type: "number",
          placeholder: "4096",
          hint: "输出长度上限，留空使用默认值",
        },
        {
          key: "max_steps",
          label: "最大步骤数",
          type: "number",
          placeholder: "10",
          hint: "Agent 最多执行几轮工具调用后强制结束",
        },
      ],
    },
    {
      title: "上下文 & 记忆",
      icon: "🧠",
      collapsed: true,
      fields: [
        {
          key: "memory_type",
          label: "记忆类型",
          type: "select",
          options: [
            { value: "none", label: "无记忆（单次对话）" },
            { value: "buffer", label: "滚动窗口（最近 N 条）" },
            { value: "summary", label: "自动摘要（超出时压缩）" },
            { value: "vector", label: "向量检索（语义相关段落）" },
          ],
          hint: "控制 Agent 对历史对话的记忆方式",
        },
        {
          key: "memory_window",
          label: "记忆窗口大小",
          type: "number",
          placeholder: "10",
          hint: "buffer 模式：保留最近 N 条消息；summary 模式：超过 N 条时摘要",
        },
        {
          key: "context_injection",
          label: "注入上下文",
          type: "textarea",
          placeholder:
            "品牌调性：活泼、年轻化\n受众：18-35 岁女性\n禁用词：竞品名称",
          hint: "每次调用时固定注入的背景知识，如品牌规范、专有术语",
        },
        {
          key: "rag_enabled",
          label: "启用知识库 (RAG)",
          type: "toggle",
          hint: "开启后自动检索项目知识库增强回答",
        },
        {
          key: "rag_top_k",
          label: "RAG 召回条数",
          type: "number",
          placeholder: "5",
          hint: "从知识库中检索最相关的 N 个片段",
        },
      ],
    },
    {
      title: "工具权限",
      icon: "🔧",
      collapsed: true,
      fields: [
        {
          key: "tools_allowed",
          label: "允许的工具",
          type: "tags",
          placeholder: "generate_image, generate_video, search_knowledge_base",
          hint: "留空 = 允许所有工具；填写工具名称白名单（逗号分隔）",
        },
        {
          key: "tools_blocked",
          label: "禁用的工具",
          type: "tags",
          placeholder: "publish_content",
          hint: "黑名单优先级高于白名单",
        },
      ],
    },
    {
      title: "可靠性",
      icon: "🛡",
      collapsed: true,
      fields: [
        {
          key: "timeout_seconds",
          label: "超时时间 (秒)",
          type: "number",
          placeholder: "300",
          hint: "超过此时间自动中断并返回错误",
        },
        {
          key: "retry_count",
          label: "失败重试次数",
          type: "number",
          placeholder: "2",
          hint: "工具调用失败时的重试次数",
        },
        {
          key: "fallback_message",
          label: "失败兜底回复",
          type: "text",
          placeholder: "很抱歉，媒体生成暂时不可用，请稍后重试",
          hint: "所有重试失败后返回的固定消息",
        },
      ],
    },
  ],

  agent_general: [
    {
      title: "任务",
      icon: "✦",
      fields: [
        {
          key: "prompt",
          label: "用户指令",
          type: "textarea",
          placeholder: "{{input}}",
          hint: "支持 {{变量名}} 引用上游节点输出",
        },
        {
          key: "system_prompt",
          label: "系统角色设定",
          type: "textarea",
          placeholder: "你是一个专业的助手，负责…",
          hint: "定义 Agent 的角色、能力边界和回复风格",
        },
        {
          key: "output_format",
          label: "输出格式",
          type: "select",
          options: [
            { value: "text", label: "纯文本" },
            { value: "markdown", label: "Markdown" },
            { value: "json", label: "JSON 结构化" },
            { value: "bullet", label: "要点列表" },
          ],
        },
      ],
    },
    {
      title: "模型",
      icon: "⚡",
      collapsed: true,
      fields: [
        {
          key: "model",
          label: "LLM 模型",
          type: "select",
          options: [
            { value: "", label: "使用全局默认" },
            { value: "glm-4-plus", label: "智谱 GLM-4 Plus" },
            { value: "glm-4-flash", label: "智谱 GLM-4 Flash（快速）" },
            { value: "gemini-2.0-flash", label: "Google Gemini 2.0 Flash" },
            { value: "deepseek-chat", label: "DeepSeek Chat" },
            { value: "doubao-1.5-pro-32k", label: "豆包 1.5 Pro 32K" },
          ],
        },
        {
          key: "temperature",
          label: "创意度 (Temperature)",
          type: "slider",
          min: 0,
          max: 1,
          step: 0.05,
          defaultValue: 0.7,
          hint: "0 = 精确/保守  ·  1 = 多样/创意",
        },
        {
          key: "max_tokens",
          label: "最大 Token 数",
          type: "number",
          placeholder: "4096",
        },
        {
          key: "max_steps",
          label: "最大步骤数",
          type: "number",
          placeholder: "10",
        },
      ],
    },
    {
      title: "上下文 & 记忆",
      icon: "🧠",
      collapsed: true,
      fields: [
        {
          key: "memory_type",
          label: "记忆类型",
          type: "select",
          options: [
            { value: "none", label: "无记忆（单次对话）" },
            { value: "buffer", label: "滚动窗口（最近 N 条）" },
            { value: "summary", label: "自动摘要（超出时压缩）" },
            { value: "vector", label: "向量检索（语义相关段落）" },
          ],
        },
        {
          key: "memory_window",
          label: "记忆窗口大小",
          type: "number",
          placeholder: "10",
        },
        {
          key: "context_injection",
          label: "注入上下文",
          type: "textarea",
          placeholder: "固定知识、品牌规范、专有术语…",
          hint: "每次调用时固定注入的背景信息",
        },
        {
          key: "rag_enabled",
          label: "启用知识库 (RAG)",
          type: "toggle",
          hint: "开启后自动检索项目知识库增强回答",
        },
        {
          key: "rag_top_k",
          label: "RAG 召回条数",
          type: "number",
          placeholder: "5",
        },
      ],
    },
    {
      title: "工具权限",
      icon: "🔧",
      collapsed: true,
      fields: [
        {
          key: "tools_allowed",
          label: "允许的工具",
          type: "tags",
          placeholder: "search_knowledge_base, trend_analysis…",
          hint: "留空 = 允许所有工具",
        },
        {
          key: "tools_blocked",
          label: "禁用的工具",
          type: "tags",
          placeholder: "publish_content",
        },
      ],
    },
    {
      title: "可靠性",
      icon: "🛡",
      collapsed: true,
      fields: [
        {
          key: "timeout_seconds",
          label: "超时时间 (秒)",
          type: "number",
          placeholder: "120",
        },
        {
          key: "retry_count",
          label: "失败重试次数",
          type: "number",
          placeholder: "2",
        },
        {
          key: "fallback_message",
          label: "失败兜底回复",
          type: "text",
          placeholder: "请求处理失败，请稍后重试",
        },
      ],
    },
  ],

  agent_script_writer: [
    {
      title: "脚本",
      icon: "✦",
      fields: [
        {
          key: "user_prompt_template",
          label: "主题模板",
          type: "textarea",
          placeholder: "{{topic}}",
          hint: "用 {{变量名}} 引用上游输出",
        },
        {
          key: "platform",
          label: "目标平台",
          type: "select",
          options: [
            { value: "douyin", label: "抖音" },
            { value: "kuaishou", label: "快手" },
            { value: "bilibili", label: "B站" },
            { value: "xiaohongshu", label: "小红书" },
            { value: "youtube", label: "YouTube" },
          ],
        },
        {
          key: "duration",
          label: "时长 (秒)",
          type: "number",
          placeholder: "60",
        },
        {
          key: "style",
          label: "内容风格",
          type: "select",
          options: [
            { value: "口播带货", label: "口播带货" },
            { value: "知识分享", label: "知识分享" },
            { value: "剧情演绎", label: "剧情演绎" },
            { value: "产品测评", label: "产品测评" },
            { value: "vlog", label: "Vlog" },
          ],
        },
        {
          key: "industry",
          label: "行业",
          type: "text",
          placeholder: "通用 / 美妆 / 科技 / 游戏…",
        },
      ],
    },
    {
      title: "模型",
      icon: "⚡",
      collapsed: true,
      fields: [
        {
          key: "model",
          label: "LLM 模型",
          type: "select",
          options: [
            { value: "", label: "使用全局默认" },
            { value: "glm-4-plus", label: "智谱 GLM-4 Plus" },
            { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
            { value: "deepseek-chat", label: "DeepSeek Chat" },
          ],
        },
        {
          key: "temperature",
          label: "创意度",
          type: "slider",
          min: 0,
          max: 1,
          step: 0.05,
          defaultValue: 0.8,
        },
      ],
    },
  ],

  agent_copywriter: [
    {
      title: "文案",
      icon: "✦",
      fields: [
        {
          key: "user_prompt_template",
          label: "主题模板",
          type: "textarea",
          placeholder: "{{topic}}",
          hint: "用 {{变量名}} 引用上游输出",
        },
        {
          key: "platform",
          label: "目标平台",
          type: "select",
          options: [
            { value: "xiaohongshu", label: "小红书" },
            { value: "weibo", label: "微博" },
            { value: "douyin", label: "抖音" },
            { value: "twitter", label: "Twitter" },
          ],
        },
        {
          key: "content_type",
          label: "文案类型",
          type: "select",
          options: [
            { value: "种草推荐", label: "种草推荐" },
            { value: "标题优化", label: "标题优化" },
            { value: "广告文案", label: "广告文案" },
            { value: "产品描述", label: "产品描述" },
            { value: "评论回复", label: "评论回复" },
          ],
        },
        {
          key: "target_audience",
          label: "目标受众",
          type: "text",
          placeholder: "年轻女性 / 科技爱好者…",
        },
      ],
    },
    {
      title: "模型",
      icon: "⚡",
      collapsed: true,
      fields: [
        {
          key: "model",
          label: "LLM 模型",
          type: "select",
          options: [
            { value: "", label: "使用全局默认" },
            { value: "glm-4-plus", label: "智谱 GLM-4 Plus" },
            { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
          ],
        },
        {
          key: "temperature",
          label: "创意度",
          type: "slider",
          min: 0,
          max: 1,
          step: 0.05,
          defaultValue: 0.75,
        },
      ],
    },
  ],

  agent_trend_analyst: [
    {
      title: "分析范围",
      icon: "📊",
      fields: [
        {
          key: "platforms",
          label: "数据平台",
          type: "tags",
          placeholder: "douyin, xiaohongshu",
          hint: "多个平台可用逗号或空格分隔",
          defaultValue: ["douyin", "xiaohongshu"],
        },
        {
          key: "depth",
          label: "分析深度",
          type: "select",
          options: [
            { value: "low", label: "快速概览" },
            { value: "medium", label: "标准分析" },
            { value: "high", label: "深度洞察" },
          ],
          defaultValue: "medium",
        },
        {
          key: "lookback_hours",
          label: "回看时长（小时）",
          type: "number",
          placeholder: "24",
          hint: "统计近 N 小时内的热点变化",
        },
      ],
    },
    {
      title: "输出偏好",
      icon: "🧾",
      collapsed: true,
      fields: [
        {
          key: "focus",
          label: "重点方向",
          type: "select",
          options: [
            { value: "all", label: "综合" },
            { value: "growth", label: "增长机会" },
            { value: "risk", label: "风险预警" },
            { value: "content_angles", label: "内容选题" },
          ],
        },
        {
          key: "include_hashtags",
          label: "输出推荐话题标签",
          type: "toggle",
          defaultValue: true,
        },
        {
          key: "include_competitor_examples",
          label: "附带竞品案例",
          type: "toggle",
          defaultValue: false,
        },
      ],
    },
  ],

  agent_reviewer: [
    {
      title: "审核规则",
      icon: "🛡",
      fields: [
        {
          key: "platforms",
          label: "审核平台",
          type: "tags",
          placeholder: "all 或 douyin, xiaohongshu",
          hint: "按平台规则审核，留空默认 all",
          defaultValue: ["all"],
        },
        {
          key: "level",
          label: "审核强度",
          type: "select",
          options: [
            { value: "relaxed", label: "宽松" },
            { value: "standard", label: "标准" },
            { value: "strict", label: "严格" },
          ],
          defaultValue: "standard",
        },
        {
          key: "auto_fix",
          label: "自动修正文案",
          type: "toggle",
          defaultValue: true,
          hint: "发现风险时自动给出可发布版本",
        },
      ],
    },
    {
      title: "输出策略",
      icon: "📤",
      collapsed: true,
      fields: [
        {
          key: "block_on_risk",
          label: "高风险时阻断下游",
          type: "toggle",
          defaultValue: true,
        },
        {
          key: "risk_threshold",
          label: "风险阈值",
          type: "select",
          options: [
            { value: "low", label: "低风险即拦截" },
            { value: "medium", label: "中风险及以上拦截" },
            { value: "high", label: "仅高风险拦截" },
          ],
          defaultValue: "medium",
        },
      ],
    },
  ],

  agent_video_editor: [
    {
      title: "剪辑设置",
      icon: "🎞️",
      fields: [
        {
          key: "style",
          label: "剪辑风格",
          type: "select",
          options: [
            { value: "auto", label: "自动" },
            { value: "cinematic", label: "电影感" },
            { value: "fast", label: "快节奏" },
            { value: "story", label: "叙事" },
          ],
          defaultValue: "auto",
        },
        {
          key: "add_subtitle",
          label: "自动添加字幕",
          type: "toggle",
          defaultValue: true,
        },
        {
          key: "add_bgm",
          label: "自动添加背景音乐",
          type: "toggle",
          defaultValue: false,
        },
      ],
    },
    {
      title: "输出参数",
      icon: "⚙",
      collapsed: true,
      fields: [
        {
          key: "aspect_ratio",
          label: "画幅比例",
          type: "select",
          options: [
            { value: "9:16", label: "竖屏 9:16" },
            { value: "16:9", label: "横屏 16:9" },
            { value: "1:1", label: "方屏 1:1" },
          ],
        },
        {
          key: "target_duration",
          label: "目标时长（秒）",
          type: "number",
          placeholder: "30",
          hint: "留空表示按素材与脚本自动决定",
        },
      ],
    },
  ],

  agent_planning: [
    {
      title: "规划目标",
      icon: "🗺️",
      fields: [
        {
          key: "goal_template",
          label: "目标模板",
          type: "textarea",
          placeholder: "围绕 {{topic}} 生成脚本、素材并发布",
          hint: "支持 {{变量名}} 引用上游输入",
        },
        {
          key: "max_steps",
          label: "最大步骤数",
          type: "number",
          placeholder: "5",
        },
        {
          key: "replan",
          label: "执行中自动重规划",
          type: "toggle",
          defaultValue: true,
        },
      ],
    },
    {
      title: "执行策略",
      icon: "🚦",
      collapsed: true,
      fields: [
        {
          key: "parallel_enabled",
          label: "允许并行子任务",
          type: "toggle",
          defaultValue: false,
        },
        {
          key: "stop_on_error",
          label: "遇错立即停止",
          type: "toggle",
          defaultValue: true,
        },
      ],
    },
  ],

  agent_long_video: [
    {
      title: "长视频任务",
      icon: "🎬",
      fields: [
        {
          key: "prompt",
          label: "选题与创作指令",
          type: "textarea",
          placeholder: "围绕 {{topic}} 产出分镜大纲与分段脚本…",
          hint: "支持 {{变量名}}；可与上游热点/剧本节点衔接",
        },
        {
          key: "target_duration_minutes",
          label: "目标总时长（分钟）",
          type: "number",
          placeholder: "10",
        },
        {
          key: "style",
          label: "叙事风格",
          type: "text",
          placeholder: "纪录片 / 口播带货 / Vlog",
        },
      ],
    },
  ],

  agent_architect: [
    {
      title: "架构与方案",
      icon: "🏗️",
      fields: [
        {
          key: "prompt",
          label: "需求说明",
          type: "textarea",
          placeholder: "描述内容管线、交付物、约束与依赖…",
          hint: "输出结构化蓝图与风险清单，适合复杂流水线前置规划",
        },
        {
          key: "depth",
          label: "分析深度",
          type: "select",
          options: [
            { value: "light", label: "精简" },
            { value: "standard", label: "标准" },
            { value: "deep", label: "深入" },
          ],
        },
        {
          key: "audience",
          label: "受众 / 读者",
          type: "text",
          placeholder: "创作者 / 技术团队 / 商务",
        },
      ],
    },
  ],

  // ── 内容发布 ─────────────────────────────────────────────────
  tool_publish: [
    {
      title: "发布平台",
      icon: "🚀",
      fields: [
        {
          key: "platform",
          label: "发布到哪个平台？",
          type: "select",
          options: [
            { value: "xiaohongshu", label: "📕 小红书" },
            { value: "douyin", label: "🎵 抖音" },
            { value: "bilibili", label: "📺 B站" },
            { value: "kuaishou", label: "🟡 快手" },
            { value: "weibo", label: "🔴 微博" },
            { value: "youtube", label: "▶️ YouTube" },
            { value: "twitter", label: "🐦 Twitter/X" },
            { value: "tiktok", label: "🎶 TikTok" },
          ],
        },
        {
          key: "publish_mode",
          label: "发布方式",
          type: "select",
          options: [
            { value: "immediate", label: "立即发布" },
            { value: "scheduled", label: "定时发布" },
            { value: "draft", label: "存为草稿（不发布）" },
          ],
          hint: "选【草稿】可以先预览再手动点发布",
        },
        {
          key: "scheduled_time",
          label: "定时发布时间",
          type: "text",
          placeholder: "2026-05-20 09:00",
          hint: "选【定时发布】时填写，格式：年-月-日 时:分",
        },
      ],
    },
    {
      title: "内容设置",
      icon: "✍️",
      fields: [
        {
          key: "title_template",
          label: "标题",
          type: "text",
          placeholder: "{{script.title}}  或直接写标题",
          hint: "💡 {{script.title}} 会自动读取上游脚本生成的标题；也可以直接写死固定标题",
        },
        {
          key: "description_template",
          label: "正文 / 描述",
          type: "textarea",
          placeholder: "{{copy}}  或直接填写内容",
          hint: "💡 {{copy}} 会读取上游文案节点的输出；也可以直接填写固定文案",
        },
        {
          key: "tags",
          label: "话题标签",
          type: "text",
          placeholder: "科技 AI 创作",
          hint: "多个标签用空格隔开，会自动加 # 号",
        },
        {
          key: "cover_source",
          label: "封面来源",
          type: "select",
          options: [
            { value: "auto", label: "自动截取视频首帧" },
            { value: "generated", label: "使用 AI 生成的图片" },
            { value: "upload", label: "手动上传封面" },
          ],
        },
      ],
    },
    {
      title: "发布选项",
      icon: "⚙️",
      collapsed: true,
      fields: [
        {
          key: "visibility",
          label: "可见范围",
          type: "select",
          options: [
            { value: "public", label: "公开（所有人可见）" },
            { value: "followers", label: "仅粉丝可见" },
            { value: "private", label: "私密（仅自己可见）" },
          ],
        },
        {
          key: "first_comment",
          label: "发布后自动评论",
          type: "text",
          placeholder: "关注我，每天更新～",
          hint: "发布成功后会自动在评论区留下这条文字（可留空）",
        },
        {
          key: "add_watermark",
          label: "添加平台水印",
          type: "toggle",
          defaultValue: true,
          hint: "关闭后视频不带平台水印标识",
        },
        {
          key: "allow_duet",
          label: "允许合拍 / 转载",
          type: "toggle",
          defaultValue: false,
        },
      ],
    },
    {
      title: "通知与推广",
      icon: "🔔",
      collapsed: true,
      fields: [
        {
          key: "notify_followers",
          label: "通知粉丝",
          type: "toggle",
          defaultValue: true,
          hint: "发布后推送通知给关注你的粉丝",
        },
        {
          key: "pin_to_top",
          label: "置顶到主页",
          type: "toggle",
          defaultValue: false,
        },
        {
          key: "promote_budget",
          label: "推广预算（元，可选）",
          type: "number",
          placeholder: "0",
          hint: "填写大于 0 的金额会自动开启平台付费推广",
        },
      ],
    },
  ],
};

const TOOL_SCHEMAS: Partial<Record<NodeType, ToolSchema>> = {
  trigger_trending: [
    {
      key: "platform",
      label: "热点来源平台",
      type: "select",
      options: [
        { value: "all", label: "全平台" },
        { value: "douyin", label: "抖音" },
        { value: "xiaohongshu", label: "小红书" },
        { value: "bilibili", label: "B站" },
      ],
    },
    {
      key: "top_n",
      label: "监控榜单前 N 条",
      type: "number",
      placeholder: "10",
    },
    {
      key: "check_interval_minutes",
      label: "检查间隔（分钟）",
      type: "number",
      placeholder: "30",
    },
  ],
  trigger_rss: [
    {
      key: "feed_url",
      label: "RSS 地址",
      type: "text",
      placeholder: "https://example.com/rss.xml",
    },
    {
      key: "check_interval_minutes",
      label: "检查间隔（分钟）",
      type: "number",
      placeholder: "60",
    },
  ],
  trigger_schedule: [
    {
      key: "cron",
      label: "Cron 表达式",
      type: "text",
      placeholder: "0 9 * * 1-5",
      hint: "工作日9点: 0 9 * * 1-5  每小时: 0 * * * *",
    },
    {
      key: "timezone",
      label: "时区",
      type: "select",
      options: [
        { value: "Asia/Shanghai", label: "中国标准时间 (UTC+8)" },
        { value: "UTC", label: "UTC" },
        { value: "America/New_York", label: "纽约 (UTC-5/4)" },
      ],
    },
  ],
  trigger_webhook: [
    {
      key: "path",
      label: "路径",
      type: "text",
      placeholder: "/webhook/my-trigger",
    },
    {
      key: "secret",
      label: "验证密钥 (可选)",
      type: "text",
      placeholder: "your-secret-key",
    },
  ],
  tool_image: [
    {
      key: "prompt",
      label: "图片描述",
      type: "textarea",
      placeholder: "一幅写实风格的城市夜景…",
      hint: "支持 {{变量名}} 引用",
    },
    {
      key: "model",
      label: "模型",
      type: "select",
      options: [
        { value: "cogview-3-plus", label: "CogView-3 Plus" },
        { value: "cogview-3", label: "CogView-3" },
      ],
    },
    {
      key: "size",
      label: "尺寸",
      type: "select",
      options: [
        { value: "1024x1024", label: "1:1  (1024×1024)" },
        { value: "1280x720", label: "16:9 (1280×720)" },
        { value: "720x1280", label: "9:16 (720×1280)" },
        { value: "1280x960", label: "4:3  (1280×960)" },
      ],
    },
  ],
  tool_video: [
    {
      key: "prompt",
      label: "视频描述",
      type: "textarea",
      placeholder: "一段 6 秒飞鸟视角航拍…",
    },
    {
      key: "duration_seconds",
      label: "时长 (秒)",
      type: "number",
      placeholder: "6",
    },
    {
      key: "model",
      label: "模型",
      type: "select",
      options: [
        { value: "cogvideox", label: "CogVideoX" },
        { value: "seadance", label: "豆包 SeaDance" },
        { value: "jimeng", label: "即梦 AI" },
      ],
    },
  ],
  tool_audio: [
    {
      key: "text",
      label: "文本内容",
      type: "textarea",
      placeholder: "{{script}}",
      hint: "可引用上游脚本输出",
    },
    {
      key: "voice",
      label: "声音",
      type: "select",
      options: [
        { value: "default", label: "默认" },
        { value: "male", label: "男声" },
        { value: "female", label: "女声" },
      ],
    },
    {
      key: "speed",
      label: "语速 (0.5–2.0)",
      type: "number",
      placeholder: "1.0",
    },
  ],
  tool_rag: [
    {
      key: "query",
      label: "查询模板",
      type: "text",
      placeholder: "{{topic}}",
      hint: "支持变量引用",
    },
    { key: "top_k", label: "返回条数", type: "number", placeholder: "5" },
  ],
  tool_memory_search: [
    {
      key: "query",
      label: "检索关键词",
      type: "textarea",
      placeholder: "例如：{{topic}} 相关往期脚本风格",
      hint: "写入向量记忆库语义检索",
    },
    {
      key: "top_k",
      label: "最多返回条数",
      type: "number",
      placeholder: "5",
    },
  ],
  tool_memory_save: [
    {
      key: "content",
      label: "记忆正文",
      type: "textarea",
      placeholder: "用户偏好：成片时长控制在 60s 内…",
    },
    {
      key: "memory_type",
      label: "类型",
      type: "select",
      options: [
        { value: "fact", label: "事实 / 偏好" },
        { value: "workflow", label: "流程经验" },
        { value: "style", label: "风格参考" },
      ],
    },
    {
      key: "source",
      label: "来源",
      type: "text",
      placeholder: "workflow",
    },
  ],
  tool_http: [
    {
      key: "url",
      label: "URL",
      type: "text",
      placeholder: "https://api.example.com/v1/…",
    },
    {
      key: "method",
      label: "方法",
      type: "select",
      options: [
        { value: "GET", label: "GET" },
        { value: "POST", label: "POST" },
        { value: "PUT", label: "PUT" },
        { value: "DELETE", label: "DELETE" },
      ],
    },
  ],
  tool_moderation: [
    {
      key: "level",
      label: "审核等级",
      type: "select",
      options: [
        { value: "relaxed", label: "宽松" },
        { value: "standard", label: "标准" },
        { value: "strict", label: "严格" },
      ],
    },
    {
      key: "platforms",
      label: "平台规则",
      type: "tags",
      placeholder: "all 或 douyin, xiaohongshu",
      hint: "多个平台可用逗号或空格分隔",
    },
  ],
  tool_subtitle: [
    {
      key: "language",
      label: "字幕语言",
      type: "select",
      options: [
        { value: "zh", label: "中文" },
        { value: "en", label: "英文" },
        { value: "auto", label: "自动识别" },
      ],
    },
    {
      key: "burn_in",
      label: "直接烧录到视频",
      type: "toggle",
      defaultValue: true,
    },
  ],
  tool_remix: [
    {
      key: "style",
      label: "混剪风格",
      type: "select",
      options: [
        { value: "auto", label: "自动" },
        { value: "story", label: "叙事" },
        { value: "highlight", label: "高能剪辑" },
        { value: "montage", label: "蒙太奇" },
      ],
    },
    {
      key: "add_bgm",
      label: "自动添加背景音乐",
      type: "toggle",
      defaultValue: true,
    },
    {
      key: "add_subtitle",
      label: "自动添加字幕",
      type: "toggle",
      defaultValue: true,
    },
  ],
  tool_trending: [
    {
      key: "platform",
      label: "查询平台",
      type: "select",
      options: [
        { value: "all", label: "全平台" },
        { value: "douyin", label: "抖音" },
        { value: "xiaohongshu", label: "小红书" },
        { value: "bilibili", label: "B站" },
      ],
    },
    {
      key: "top_n",
      label: "返回条数",
      type: "number",
      placeholder: "10",
    },
  ],
  tool_web_search: [
    {
      key: "max_results",
      label: "最多返回结果数",
      type: "number",
      placeholder: "5",
    },
    {
      key: "region",
      label: "搜索区域",
      type: "select",
      options: [
        { value: "zh-cn", label: "中国" },
        { value: "en-us", label: "美国" },
        { value: "global", label: "全球" },
      ],
    },
  ],
  tool_template: [
    {
      key: "template",
      label: "模板内容",
      type: "textarea",
      placeholder: "标题：{{title}}\n正文：{{content}}",
      hint: "支持 {{变量名}} 模板语法",
    },
  ],
  tool_transform: [
    {
      key: "mode",
      label: "转换方式",
      type: "select",
      options: [
        { value: "jsonpath", label: "JSONPath 提取" },
        { value: "regex", label: "正则提取" },
        { value: "mapping", label: "字段映射" },
      ],
    },
    {
      key: "expression",
      label: "表达式",
      type: "text",
      placeholder: "$.data.items[0]",
    },
  ],
  control_condition: [
    {
      key: "expression",
      label: "条件表达式",
      type: "text",
      placeholder: "{{value}} == 'true'",
      hint: "支持 ==、!=、>、< 及字符串比较",
    },
  ],
  control_loop: [
    {
      key: "items_path",
      label: "循环数据路径",
      type: "text",
      placeholder: "$.items",
      hint: "从输入里取哪个数组进行循环",
    },
    {
      key: "max_iterations",
      label: "最大循环次数",
      type: "number",
      placeholder: "100",
    },
  ],
  control_parallel: [
    {
      key: "branches",
      label: "并行分支数",
      type: "number",
      placeholder: "2",
    },
    {
      key: "fail_fast",
      label: "任一分支失败即停止",
      type: "toggle",
      defaultValue: false,
    },
  ],
  control_merge: [
    {
      key: "strategy",
      label: "合并策略",
      type: "select",
      options: [
        { value: "all", label: "等待所有分支" },
        { value: "any", label: "任一分支完成即继续" },
        { value: "first_success", label: "首个成功分支" },
      ],
    },
    {
      key: "timeout_seconds",
      label: "最长等待时间（秒）",
      type: "number",
      placeholder: "300",
    },
  ],
  control_switch: [
    {
      key: "cases",
      label: "Case 列表",
      type: "textarea",
      placeholder: "例如：\npaid=付费用户\ntrial=试用用户",
      hint: "每行一个条件，格式：值=分支说明",
    },
    {
      key: "default_case",
      label: "默认分支",
      type: "text",
      placeholder: "default",
    },
  ],
  control_wait: [
    {
      key: "seconds",
      label: "等待秒数",
      type: "number",
      placeholder: "5",
    },
    {
      key: "jitter_seconds",
      label: "随机抖动（秒，可选）",
      type: "number",
      placeholder: "0",
      hint: "用于避免高并发时同一时刻同时触发",
    },
  ],
  output_save_history: [
    {
      key: "save_to_knowledge",
      label: "同步保存到知识库",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "tags",
      label: "历史标签",
      type: "tags",
      placeholder: "品牌A, 视频脚本, 爆款",
    },
  ],
  output_notify: [
    {
      key: "channel",
      label: "通知渠道",
      type: "select",
      options: [
        { value: "feishu", label: "飞书" },
        { value: "email", label: "邮件" },
        { value: "webhook", label: "Webhook" },
      ],
    },
    {
      key: "recipients",
      label: "接收人",
      type: "tags",
      placeholder: "alice, bob 或 xxx@example.com",
      hint: "多个接收人可用逗号或空格分隔",
    },
    {
      key: "webhook_url",
      label: "Webhook 地址（可选）",
      type: "text",
      placeholder: "https://open.feishu.cn/…",
    },
  ],
};

const CAT_ACCENT: Record<string, string> = {
  trigger: "#00c37f",
  agent: "#a78bfa",
  tool: "#60a5fa",
  control: "#fbbf24",
  output: "#9ca3af",
};

export function NodeConfigPanel({
  node,
  onChange,
  nodes = [],
  edges = [],
  onDeleteNode,
}: NodeConfigPanelProps) {
  const upstreamVars = node ? getUpstreamVars(node.id, nodes, edges) : [];
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [showRaw, setShowRaw] = useState(false);
  const [rawStr, setRawStr] = useState("{}");
  const [rawErr, setRawErr] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(320);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  function onResizeHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartW.current = panelWidth;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onResizeHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.buttons !== 1) return;
    const delta = dragStartX.current - e.clientX; // drag left → wider
    const next = Math.min(560, Math.max(260, dragStartW.current + delta));
    setPanelWidth(next);
  }
  function onResizeHandlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }

  useEffect(() => {
    if (!node) return;
    const d = node.data as unknown as WorkflowNodeData;
    setLabel(d.label ?? "");
    setConfig(d.config ?? {});
    setRawStr(JSON.stringify(d.config ?? {}, null, 2));
    setRawErr(null);
    setShowRaw(false);
  }, [node?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!node) {
    return (
      <aside
        style={{ width: panelWidth }}
        className="bg-[var(--chrome-rail-bg)] flex flex-col items-center justify-center shrink-0 relative"
      >
        {/* left-edge resize handle */}
        <div
          onPointerDown={onResizeHandlePointerDown}
          onPointerMove={onResizeHandlePointerMove}
          onPointerUp={onResizeHandlePointerUp}
          className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize z-20 group select-none"
          style={{ touchAction: "none" }}
        >
          {/* Separator line — subtle → accent on hover */}
          <div className="absolute inset-y-0 left-0 w-px bg-[var(--separator)] group-hover:w-[2px] group-hover:bg-[var(--accent)] group-active:bg-[var(--accent)] transition-all duration-150" />
          {/* Grip dots — always dimly visible, accent on hover */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-[3px]">
            <div className="w-[3px] h-[3px] rounded-full bg-[var(--label-secondary)] opacity-25 group-hover:opacity-100 group-hover:bg-[var(--accent)] transition-all duration-150" />
            <div className="w-[3px] h-[3px] rounded-full bg-[var(--label-secondary)] opacity-25 group-hover:opacity-100 group-hover:bg-[var(--accent)] transition-all duration-150" />
            <div className="w-[3px] h-[3px] rounded-full bg-[var(--label-secondary)] opacity-25 group-hover:opacity-100 group-hover:bg-[var(--accent)] transition-all duration-150" />
            <div className="w-[3px] h-[3px] rounded-full bg-[var(--label-secondary)] opacity-25 group-hover:opacity-100 group-hover:bg-[var(--accent)] transition-all duration-150" />
            <div className="w-[3px] h-[3px] rounded-full bg-[var(--label-secondary)] opacity-25 group-hover:opacity-100 group-hover:bg-[var(--accent)] transition-all duration-150" />
          </div>
        </div>
        <div className="text-center px-6">
          <div className="w-12 h-12 rounded-2xl card-surface flex items-center justify-center mx-auto mb-3">
            <svg
              className="w-5 h-5 text-[var(--label-secondary)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <p className="text-[12px] font-medium text-[var(--label-secondary)]">
            选择画布上的节点
          </p>
          <p className="text-[10px] text-[var(--label-secondary)] opacity-60 mt-1">
            以查看和编辑配置
          </p>
        </div>
      </aside>
    );
  }

  const nodeData = node.data as unknown as WorkflowNodeData;
  const info = NODE_TYPE_REGISTRY[nodeData.node_type];
  const accent = CAT_ACCENT[info?.category ?? "output"] ?? "#9ca3af";
  const agentSections = AGENT_SCHEMAS[nodeData.node_type];
  const toolFields = TOOL_SCHEMAS[nodeData.node_type] ?? [];

  function setField(key: string, value: unknown) {
    const next = { ...config, [key]: value };
    setConfig(next);
    setRawStr(JSON.stringify(next, null, 2));
    onChange(node!.id, { config: next });
  }

  function applyRaw() {
    try {
      const parsed = JSON.parse(rawStr);
      setRawErr(null);
      setConfig(parsed);
      onChange(node!.id, { config: parsed });
    } catch {
      setRawErr("JSON 格式错误");
    }
  }

  return (
    <aside
      style={{ width: panelWidth }}
      className="bg-[var(--chrome-rail-bg)] flex flex-col shrink-0 overflow-hidden relative"
    >
      {/* left-edge resize handle */}
      <div
        onPointerDown={onResizeHandlePointerDown}
        onPointerMove={onResizeHandlePointerMove}
        onPointerUp={onResizeHandlePointerUp}
        className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize z-20 group select-none"
        style={{ touchAction: "none" }}
      >
        {/* Separator line — subtle → accent on hover */}
        <div className="absolute inset-y-0 left-0 w-px bg-[var(--separator)] group-hover:w-[2px] group-hover:bg-[var(--accent)] group-active:bg-[var(--accent)] transition-all duration-150" />
        {/* Grip dots — always dimly visible, accent on hover */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-[3px]">
          <div className="w-[3px] h-[3px] rounded-full bg-[var(--label-secondary)] opacity-25 group-hover:opacity-100 group-hover:bg-[var(--accent)] transition-all duration-150" />
          <div className="w-[3px] h-[3px] rounded-full bg-[var(--label-secondary)] opacity-25 group-hover:opacity-100 group-hover:bg-[var(--accent)] transition-all duration-150" />
          <div className="w-[3px] h-[3px] rounded-full bg-[var(--label-secondary)] opacity-25 group-hover:opacity-100 group-hover:bg-[var(--accent)] transition-all duration-150" />
          <div className="w-[3px] h-[3px] rounded-full bg-[var(--label-secondary)] opacity-25 group-hover:opacity-100 group-hover:bg-[var(--accent)] transition-all duration-150" />
          <div className="w-[3px] h-[3px] rounded-full bg-[var(--label-secondary)] opacity-25 group-hover:opacity-100 group-hover:bg-[var(--accent)] transition-all duration-150" />
        </div>
      </div>
      {/* Header */}
      <div
        style={{ borderBottomColor: `${accent}20` }}
        className="px-4 py-3 border-b flex items-center gap-2.5 shrink-0"
      >
        <div
          style={{ backgroundColor: `${accent}18`, borderColor: `${accent}30` }}
          className="w-8 h-8 flex items-center justify-center rounded-lg border text-[15px] shrink-0"
        >
          {info?.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p
            style={{ color: accent }}
            className="text-[9px] font-bold uppercase tracking-[0.12em]"
          >
            {info?.category}
          </p>
          <p className="text-[13px] font-semibold text-[var(--foreground)] truncate">
            {info?.label}
          </p>
        </div>
        {onDeleteNode ? (
          <button
            type="button"
            title="删除该节点"
            onClick={() => {
              const title = label.trim() || info?.label || node.id;
              if (!confirm(`确定删除节点「${title}」？关联连线将一并移除。`))
                return;
              onDeleteNode(node.id);
            }}
            className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/[0.08] transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
          </button>
        ) : null}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-[var(--separator)]">
        <div className="px-4 py-4 space-y-4">
          {/* Node name */}
          <div>
            <label className="block text-[10px] font-semibold text-[var(--label-secondary)] uppercase tracking-[0.08em] mb-1.5">
              节点名称
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => onChange(node.id, { label })}
              className="w-full bg-[var(--separator-subtle)] border border-[var(--separator-subtle)] rounded-lg px-3 py-1.5
                         text-[12px] outline-none focus:border-[var(--separator)] transition-all"
            />
          </div>

          {/* Smart fields / JSON toggle */}
          {agentSections ? (
            /* ── Sectioned agent config ── */
            <div className="space-y-1">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-semibold text-[var(--label-secondary)] uppercase tracking-[0.08em]">
                  节点配置
                </label>
                <button
                  onClick={() => setShowRaw(!showRaw)}
                  className="text-[9px] text-[var(--label-secondary)] hover:text-[var(--foreground)] transition-colors px-1.5 py-0.5 rounded border border-[var(--separator-subtle)] hover:border-[var(--separator)]"
                >
                  {showRaw ? "表单" : "JSON"}
                </button>
              </div>
              {!showRaw ? (
                agentSections.map((section) => (
                  <ConfigSection
                    key={section.title}
                    section={section}
                    config={config}
                    accent={accent}
                    onFieldChange={setField}
                    upstreamVars={upstreamVars}
                  />
                ))
              ) : (
                <RawEditor
                  value={rawStr}
                  error={rawErr}
                  onChange={setRawStr}
                  onApply={applyRaw}
                  accent={accent}
                />
              )}
            </div>
          ) : toolFields.length > 0 ? (
            /* ── Flat tool config ── */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-semibold text-[var(--label-secondary)] uppercase tracking-[0.08em]">
                  节点配置
                </label>
                <button
                  onClick={() => setShowRaw(!showRaw)}
                  className="text-[9px] text-[var(--label-secondary)] hover:text-[var(--foreground)] transition-colors px-1.5 py-0.5 rounded border border-[var(--separator-subtle)] hover:border-[var(--separator)]"
                >
                  {showRaw ? "表单" : "JSON"}
                </button>
              </div>
              {!showRaw ? (
                <div className="space-y-3">
                  {toolFields.map((f) => (
                    <SmartField
                      key={f.key}
                      field={f}
                      value={(config[f.key] as string | number) ?? ""}
                      onChange={(v) => setField(f.key, v)}
                      accent={accent}
                      upstreamVars={upstreamVars}
                    />
                  ))}
                </div>
              ) : (
                <RawEditor
                  value={rawStr}
                  error={rawErr}
                  onChange={setRawStr}
                  onApply={applyRaw}
                  accent={accent}
                />
              )}
            </div>
          ) : (
            /* No schema — show raw JSON editor directly */
            <div>
              <label className="block text-[10px] font-semibold text-[var(--label-secondary)] uppercase tracking-[0.08em] mb-2">
                配置 (JSON)
              </label>
              <RawEditor
                value={rawStr}
                error={rawErr}
                onChange={setRawStr}
                onApply={applyRaw}
                accent={accent}
              />
            </div>
          )}

          {/* Port info */}
          {info && (info.inputs.length > 0 || info.outputs.length > 0) && (
            <div>
              <label className="block text-[10px] font-semibold text-[var(--label-secondary)] uppercase tracking-[0.08em] mb-2">
                连接端口
              </label>
              <div className="bg-[var(--separator-subtle)] rounded-lg border border-[var(--separator-subtle)] px-3 py-2.5 space-y-2">
                {info.inputs.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 text-[10px]"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--label-secondary)] opacity-40 shrink-0" />
                    <span className="text-[var(--label-secondary)]">
                      ← {p.label}
                    </span>
                    {p.required && (
                      <span className="ml-auto text-red-400/60 text-[9px]">
                        必填
                      </span>
                    )}
                  </div>
                ))}
                {info.outputs.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 text-[10px]"
                  >
                    <span
                      style={{ backgroundColor: accent }}
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                    />
                    <span className="text-[var(--label-secondary)]">
                      → {p.label}
                    </span>
                    <span className="ml-auto text-[var(--label-secondary)] opacity-50 text-[9px] font-mono">
                      {p.type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Node ID */}
          <p className="text-[9px] text-[var(--label-secondary)] opacity-40 font-mono break-all">
            {node.id}
          </p>
        </div>
      </div>
    </aside>
  );
}

/* ─── Sub-components ───────────────────────────────────────────── */

function ConfigSection({
  section,
  config,
  accent,
  onFieldChange,
  upstreamVars = [],
}: {
  section: SectionDef;
  config: Record<string, unknown>;
  accent: string;
  onFieldChange: (key: string, value: unknown) => void;
  upstreamVars?: UpstreamVar[];
}) {
  const [open, setOpen] = useState(!section.collapsed);

  return (
    <div className="rounded-xl border border-[var(--separator-subtle)] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--separator-subtle)] transition-colors"
      >
        <span className="text-[13px]">{section.icon}</span>
        <span className="flex-1 text-[11px] font-semibold text-[var(--foreground)]">
          {section.title}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-[var(--label-secondary)] transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-[var(--separator-subtle)]">
          {section.fields.map((f) => (
            <SmartField
              key={f.key}
              field={f}
              value={
                (config[f.key] as string | number | boolean) ??
                f.defaultValue ??
                ""
              }
              onChange={(v) => onFieldChange(f.key, v)}
              accent={accent}
              upstreamVars={upstreamVars}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SmartField({
  field,
  value,
  onChange,
  accent,
  upstreamVars = [],
}: {
  field: FieldDef;
  value: string | number | boolean | string[];
  onChange: (v: unknown) => void;
  accent: string;
  upstreamVars?: UpstreamVar[];
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Insert a variable reference at the current cursor position */
  function insertVar(varRef: string) {
    const strVal = String(value ?? "");
    const el = textareaRef.current ?? inputRef.current;
    if (el) {
      const start = el.selectionStart ?? strVal.length;
      const end = el.selectionEnd ?? strVal.length;
      const newVal = strVal.slice(0, start) + varRef + strVal.slice(end);
      onChange(newVal);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + varRef.length, start + varRef.length);
      });
    } else {
      onChange(strVal + varRef);
    }
  }

  /** Upstream var chips — rendered below text/textarea fields */
  const varChips =
    upstreamVars.length > 0 &&
    (field.type === "text" || field.type === "textarea") ? (
      <div className="mt-1.5">
        <p className="text-[9px] text-[var(--label-secondary)] opacity-60 mb-1">
          插入上游输出：
        </p>
        <div className="flex flex-wrap gap-1">
          {upstreamVars.map((v) => (
            <button
              key={v.ref}
              type="button"
              title={v.ref}
              onClick={() => insertVar(v.ref)}
              style={{ borderColor: accent, color: accent }}
              className="inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border bg-transparent hover:opacity-80 transition-opacity leading-snug"
            >
              <span className="font-sans font-medium not-italic">
                {v.nodeLabel}
              </span>
              <span className="opacity-50">·</span>
              {v.portLabel}
            </button>
          ))}
        </div>
      </div>
    ) : null;

  const base =
    "w-full bg-[var(--separator-subtle)] border border-[var(--separator-subtle)] rounded-lg px-3 py-1.5 text-[12px] text-[var(--foreground)] " +
    "outline-none focus:border-[var(--separator)] transition-all placeholder-[var(--label-secondary)]/50";

  // Toggle
  if (field.type === "toggle") {
    const checked = Boolean(value);
    return (
      <div>
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-[var(--label-secondary)]">
            {field.label}
          </label>
          <button
            onClick={() => onChange(!checked)}
            style={checked ? { backgroundColor: accent } : {}}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
              checked ? "" : "bg-[var(--separator)]"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                checked ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        {field.hint && (
          <p className="text-[9px] text-[var(--label-secondary)] opacity-60 mt-1 leading-snug">
            {field.hint}
          </p>
        )}
      </div>
    );
  }

  // Slider
  if (field.type === "slider") {
    const num =
      typeof value === "number"
        ? value
        : parseFloat(String(value)) || (field.defaultValue as number) || 0;
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] font-medium text-[var(--label-secondary)]">
            {field.label}
          </label>
          <span
            style={{ color: accent }}
            className="text-[11px] font-mono font-semibold tabular-nums w-8 text-right"
          >
            {num.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={field.min ?? 0}
          max={field.max ?? 1}
          step={field.step ?? 0.01}
          value={num}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ accentColor: accent }}
          className="w-full h-1.5 rounded-full appearance-none bg-[var(--separator)] cursor-pointer"
        />
        {field.hint && (
          <p className="text-[9px] text-[var(--label-secondary)] opacity-60 mt-1 leading-snug flex justify-between">
            <span>{String(field.min ?? 0)}</span>
            <span>{field.hint}</span>
            <span>{String(field.max ?? 1)}</span>
          </p>
        )}
      </div>
    );
  }

  // Tags (comma-separated chips)
  if (field.type === "tags") {
    const displayValue = Array.isArray(value)
      ? value.join(", ")
      : String(value ?? "");
    return (
      <div>
        <label className="block text-[11px] font-medium text-[var(--label-secondary)] mb-1">
          {field.label}
        </label>
        <input
          type="text"
          value={displayValue}
          onChange={(e) => {
            const parts = e.target.value
              .split(/[,\s]+/)
              .map((item) => item.trim())
              .filter(Boolean);
            onChange(parts);
          }}
          placeholder={field.placeholder}
          className={base}
        />
        {field.hint && (
          <p className="text-[9px] text-[var(--label-secondary)] opacity-60 mt-1 leading-snug">
            {field.hint}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <label className="block text-[11px] font-medium text-[var(--label-secondary)] mb-1">
        {field.label}
      </label>

      {field.type === "textarea" ? (
        <textarea
          ref={textareaRef}
          rows={3}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={`${base} resize-y text-[12px] leading-relaxed`}
        />
      ) : field.type === "select" ? (
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={`${base} cursor-pointer`}
          style={{ colorScheme: "auto" }}
        >
          <option value="">— 请选择 —</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "number" ? (
        <input
          type="number"
          value={String(value ?? "")}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
          placeholder={field.placeholder}
          className={base}
        />
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={base}
        />
      )}

      {varChips}

      {field.hint && (
        <p className="text-[9px] text-[var(--label-secondary)] opacity-60 mt-1 leading-snug">
          {field.hint}
        </p>
      )}
    </div>
  );
}

function RawEditor({
  value,
  error,
  onChange,
  onApply,
  accent,
}: {
  value: string;
  error: string | null;
  onChange: (v: string) => void;
  onApply: () => void;
  accent: string;
}) {
  return (
    <div>
      <textarea
        rows={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[var(--background)] border border-[var(--separator-subtle)] rounded-lg px-3 py-2
                   text-[10px] font-mono text-[var(--label-secondary)] outline-none
                   focus:border-[var(--separator)] resize-y"
      />
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
      <button
        onClick={onApply}
        style={{
          backgroundColor: `${accent}1a`,
          borderColor: `${accent}33`,
          color: accent,
        }}
        className="mt-2 w-full text-[11px] font-semibold border rounded-lg py-1.5 transition-opacity hover:opacity-80"
      >
        应用 JSON
      </button>
    </div>
  );
}
