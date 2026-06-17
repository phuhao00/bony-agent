"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type AgentMessage = {
  id: number;
  agent: string;
  avatar: string;
  content: string;
  time: string;
};

const SUB_WORKFLOWS: Record<string, Omit<AgentMessage, "id" | "time">[]> = {
  "trending:epic": [
    {
      agent: "🤖 定时调度中心",
      avatar: "⏰",
      content: "『Epic 免费雷达』触发：开始扫描本周免费游戏...",
    },
    {
      agent: "📡 数据采集器",
      avatar: "🕸️",
      content: "成功绕过 Epic 防盗链拦截，获取到本周限免《Ghostrunner 2》。",
    },
    {
      agent: "🧐 游戏分析师",
      avatar: "📊",
      content: "跑酷+赛博朋克，视觉冲击力极强，热度评级 S+！",
    },
    {
      agent: "📽️ 视频混剪专家",
      avatar: "✂️",
      content: "画面、字幕、赛博朋克BGM 整合完毕！高燃混剪渲染中... (45秒)",
    },
  ],
  "trending:steam_hot": [
    {
      agent: "🤖 定时调度中心",
      avatar: "⏰",
      content: "『Steam 畅销风向标』触发：抓取 Global Top 100 数据...",
    },
    {
      agent: "📡 数据采集器",
      avatar: "🕸️",
      content: "Steam 官方 API 数据接入成功，整理实时在线人数与销量排行。",
    },
    {
      agent: "🧐 游戏分析师",
      avatar: "📊",
      content:
        "发现异动：《黑神话：悟空》DLC 爆料引发老玩家回归，在线人数拉升！",
    },
    {
      agent: "📺 B站运营专家",
      avatar: "🚀",
      content: "生成 #黑神话悟空 深度专栏与视频，推送到 B站单机区预热排版。",
    },
  ],
  "trending:steam_new": [
    {
      agent: "🤖 定时调度中心",
      avatar: "⏰",
      content: "『Steam 独立新品挖掘机』触发：扫描过去 24h 高好评新作...",
    },
    {
      agent: "🧐 游戏分析师",
      avatar: "📊",
      content:
        "发现宝藏独立游戏：《Balatro (小丑牌)》，好评率 98%，成瘾性极强！",
    },
    {
      agent: "🍠 小红书运营",
      avatar: "📱",
      content: "图文笔记自动发布，绑定 #Steam游戏推荐 #肉鸽游戏 话题。",
    },
  ],
  "trending:taptap": [
    {
      agent: "🤖 定时调度中心",
      avatar: "⏰",
      content: "『TapTap 手游雷达』触发：绕过 WAF 抓取全网二游热榜...",
    },
    {
      agent: "📡 数据采集器",
      avatar: "🕸️",
      content: "Playwright 无头节点模拟 Googlebot，成功提取最新舆情热度。",
    },
    {
      agent: "📉 爆款数据分析",
      avatar: "📊",
      content: "10分钟跑完初审，完播率超 45%，正在自动追投豆荚并置顶互动评论。",
    },
  ],
};

const PAGE_WORKFLOWS: Record<string, Omit<AgentMessage, "id" | "time">[]> = {
  "/": [
    {
      agent: "🤖 AI 对话中枢",
      avatar: "💬",
      content: "欢迎进入数字员工主控台，我是您的 AI 协作助手。",
    },
    {
      agent: "🧠 意图理解引擎",
      avatar: "🔍",
      content: "已加载自然语言理解模型，可识别创作、生成、发布等多类指令。",
    },
    {
      agent: "🛠️ 工具调度中心",
      avatar: "🔧",
      content: "剧本生成、文案创作、媒体生成、平台发布等工具已就绪。",
    },
  ],
  "/trending": [
    {
      agent: "🕵️ 趋势扫描器",
      avatar: "🔎",
      content: "正在同步 Epic、Steam、TapTap 三方平台热榜...",
    },
    {
      agent: "📊 聚合分析节点",
      avatar: "📈",
      content: "今日全网游戏热度均值为 8.5/10，建议关注限免与大厂 DLC 动态。",
    },
  ],
  "/scheduler": [
    {
      agent: "🤖 定时调度中心",
      avatar: "⏰",
      content: "任务队列检查：发现待发布任务到达了计划时间。",
    },
    {
      agent: "📺 全平台发布",
      avatar: "🚀",
      content: "正在唤醒各平台发布 Agent... 开始执行定时投递任务。",
    },
  ],
  "/create/article": [
    {
      agent: "✍️ 平台文案专家",
      avatar: "📝",
      content: "编辑器感应到新内容。正在待命准备进行语法校对与风格调整。",
    },
    {
      agent: "🛡️ 内容合规审核",
      avatar: "✅",
      content: "实时执行边写边审引擎，确保无违禁与敏感词。",
    },
  ],
  "/create/script": [
    {
      agent: "✍️ 视频脚本专家",
      avatar: "📄",
      content: "切换至短视频脚本创作模式，加载【完播率最大化】公式框架。",
    },
  ],
  "/create/copywriting": [
    {
      agent: "✍️ 社交媒体专家",
      avatar: "📝",
      content: "加载小红书、朋友圈、微博三重文案模板引擎...",
    },
  ],
  "/media/image-edit": [
    {
      agent: "✂️ 图像精修师",
      avatar: "🎯",
      content: "支持局部重绘、指令编辑、物体移除与扩图，请上传图片并选择编辑模式。",
    },
  ],
  "/media/image": [
    {
      agent: "🎨 视觉美术设计",
      avatar: "🖼️",
      content: "图像生成引擎已启动，支持即梦 AI、Gemini Image 等多供应商。",
    },
    {
      agent: "🧠 Prompt 优化师",
      avatar: "✨",
      content: "正在分析您的描述，自动扩展为专业级英文 Prompt...",
    },
    {
      agent: "🎭 风格迁移专家",
      avatar: "🌈",
      content: "检测到风格关键词，预加载 LoRA 模型以增强艺术表现力。",
    },
    {
      agent: "📐 构图顾问",
      avatar: "📏",
      content: "建议采用 9:16 竖版构图，更适合短视频封面和社交媒体传播。",
    },
  ],
  "/media/video": [
    {
      agent: "🎥 AI 视频生成",
      avatar: "🎬",
      content: "视频生成引擎就绪，支持文生视频、图生视频两种模式。",
    },
    {
      agent: "📽️ 视频混剪专家",
      avatar: "✂️",
      content: "智能混剪模块已加载，可自动分析素材并生成创意视频。",
    },
    {
      agent: "🎵 音频工程师",
      avatar: "🎧",
      content: "配音与 BGM 合成引擎待命，支持多语种 TTS 与版权音乐库。",
    },
    {
      agent: "📝 字幕生成器",
      avatar: "📄",
      content: "ASR 语音识别与字幕同步模块已初始化，可自动生成精准字幕。",
    },
  ],
  "/media/happyhorse": [
    {
      agent: "🐴 欢乐马导演",
      avatar: "🎬",
      content: "HappyHorse 工坊已就绪，固定使用 happyhorse-1.0 模型生成短视频。",
    },
    {
      agent: "🎵 音画同步师",
      avatar: "🎧",
      content: "欢乐马支持音画联合生成，适合短视频、广告与社交媒体内容。",
    },
  ],
  "/media/long-video": [
    {
      agent: "🎞️ 长视频导演",
      avatar: "🎬",
      content: "长视频工坊已就绪，正在把创意拆解为 Wan 可执行分镜。",
    },
    {
      agent: "🧠 分镜规划师",
      avatar: "🗂️",
      content: "会先统一主角、场景和情绪锚点，再顺序生成多段镜头。",
    },
    {
      agent: "🛠️ 成片装配器",
      avatar: "⚙️",
      content: "FFmpeg 拼接与交付链路待命，完成后可直接预览、下载和发布。",
    },
  ],
  "/media/storyboard": [
    {
      agent: "📋 分镜规划师",
      avatar: "🎬",
      content: "故事板模式启动，可将脚本自动拆解为可视化分镜序列。",
    },
    {
      agent: "🎨 视觉预览师",
      avatar: "🖼️",
      content: "每个分镜可快速生成预览图，帮助您提前可视化成片效果。",
    },
    {
      agent: "⏱️ 时长估算器",
      avatar: "⏰",
      content: "根据分镜数量与描述复杂度，预估成片时长约 45-60 秒。",
    },
    {
      agent: "💡 镜头语言顾问",
      avatar: "🎥",
      content: "建议使用特写镜头增强情绪表达，配合背景音乐节奏切换场景。",
    },
  ],
  "/moderation": [
    {
      agent: "🛡️ 内容合规审核",
      avatar: "✅",
      content: "多维度内容审核系统启动，覆盖文本、图片、视频全媒介。",
    },
    {
      agent: "🔍 敏感词检测器",
      avatar: "⚠️",
      content: "已加载最新敏感词库，支持上下文语义分析，降低误判率。",
    },
    {
      agent: "🧠 AI 内容理解",
      avatar: "🤖",
      content: "深度学习模型正在分析内容语义，识别潜在违规风险...",
    },
    {
      agent: "📊 审核报告生成",
      avatar: "📈",
      content: "审核完成后将自动生成合规报告，标注风险点与修改建议。",
    },
  ],
  "/knowledge": [
    {
      agent: "📚 知识库管理员",
      avatar: "🗄️",
      content: "RAG 向量数据库已连接，当前收录文档 1,247 篇。",
    },
    {
      agent: "🔍 语义检索引擎",
      avatar: "🔎",
      content: "支持基于 LlamaIndex 的智能检索，理解意图而非简单匹配关键词。",
    },
    {
      agent: "📤 文档处理器",
      avatar: "📑",
      content: "支持 PDF、Word、Markdown、TXT 等多种格式自动解析与向量化。",
    },
    {
      agent: "🧠 知识增强助手",
      avatar: "✨",
      content: "上传您的私有文档，AI 将在创作时自动引用相关知识。",
    },
  ],
  "/history": [
    {
      agent: "🕐 历史记录管家",
      avatar: "📜",
      content: "已加载您的创作历史，共记录 328 次生成任务。",
    },
    {
      agent: "🔍 智能检索助手",
      avatar: "🔎",
      content: "支持按类型、时间、关键词检索历史内容，快速找到过往作品。",
    },
    {
      agent: "📊 创作数据分析",
      avatar: "📈",
      content: "本月生成文章 45 篇、图片 128 张、视频 23 个，效率提升 35%。",
    },
    {
      agent: "💡 相似内容推荐",
      avatar: "✨",
      content: "根据您的历史偏好，推荐复用过往优质素材与模板。",
    },
  ],
  "/settings": [
    {
      agent: "⚙️ 系统配置中心",
      avatar: "🔧",
      content: "模型配置界面已加载，支持多供应商 LLM 切换与参数调优。",
    },
    {
      agent: "🤖 LLM 供应商管理",
      avatar: "🌐",
      content:
        "当前可用：智谱 GLM、Google Gemini、DeepSeek、OpenRouter 等 8 家供应商。",
    },
    {
      agent: "🔑 API 密钥管理",
      avatar: "🔐",
      content: "您的 API 密钥已加密存储，安全隔离，支持动态切换。",
    },
    {
      agent: "💾 配置持久化",
      avatar: "💾",
      content: "所有配置更改将自动保存，下次启动时自动恢复。",
    },
  ],
  "/platforms": [
    {
      agent: "📱 平台管理中心",
      avatar: "🌐",
      content: "社交媒体账号管理界面已加载，支持 6 大平台统一管理。",
    },
    {
      agent: "🔐 授权状态监控",
      avatar: "🔑",
      content: "正在检查各平台授权状态：抖音 ✓ 快手 ✓ 小红书 ✓ B站 ✗ YouTube ✓",
    },
    {
      agent: "🤖 自动化连接器",
      avatar: "⚡",
      content: "Playwright 浏览器自动化引擎就绪，支持模拟登录与内容发布。",
    },
    {
      agent: "📊 账号健康度",
      avatar: "📈",
      content: "各平台账号状态正常，近期无违规警告，可正常发布内容。",
    },
  ],
  "/companion": [
    {
      agent: "✨ Nova · 多 Agent 编排",
      avatar: "🌟",
      content:
        "可以说「长视频」或描述多分镜叙事，路由到长视频工坊 Agent 走 Wan 分段管线；短视频、混剪也会自动匹配对应专家。",
    },
    {
      agent: "🎞️ 长视频工坊",
      avatar: "🎬",
      content: "通义 Wan 分镜规划 + 并行片段 + FFmpeg 成片，已在多 Agent 注册表就绪。",
    },
  ],
  "/sync": [
    {
      agent: "🤖 自动化爬虫代理",
      avatar: "🕷️",
      content: "探针检测到同步库指令，准备链接 Steam DB 底层数据接口。",
    },
    {
      agent: "📡 数据清洗节点",
      avatar: "🧹",
      content: "正在剥离脏数据、反转义 HTML 并提取有效游戏元数据...",
    },
    {
      agent: "🗄️ 数据库管理员",
      avatar: "💾",
      content: "对比本地记录，执行事务增量插入。进度条更新完毕。",
    },
  ],
  default: [
    {
      agent: "🤖 全局巡检守护者",
      avatar: "🛡️",
      content: "系统运行稳定。内存占用优良。守护进程监听中...",
    },
    {
      agent: "📊 流量观察员",
      avatar: "🔭",
      content: "检测全域矩阵号最新一小时的点赞数据和完播波动情况。",
    },
  ],
};

export default function GlobalAgentChat() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const chatRef = useRef<HTMLDivElement>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const currentFlowLenRef = useRef(0);
  const pathname = usePathname();

  const runWorkflow = (flow: Omit<AgentMessage, "id" | "time">[]) => {
    setMessages([]);
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    currentFlowLenRef.current = flow.length;

    let delay = 0;
    flow.forEach((msg, idx) => {
      delay += idx === 0 ? 800 : 1500 + Math.random() * 2000;
      const timer = setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + idx,
            time: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
            ...msg,
          },
        ]);
      }, delay);
      timeoutsRef.current.push(timer);
    });
  };

  useEffect(() => {
    // Handle route-level triggers
    const currentPath = pathname || "/";
    let flowKey = "default";
    if (PAGE_WORKFLOWS[currentPath]) {
      flowKey = currentPath;
    } else {
      const matchedPre = Object.keys(PAGE_WORKFLOWS).find(
        (k) => k !== "default" && currentPath.startsWith(k),
      );
      if (matchedPre) flowKey = matchedPre;
    }

    runWorkflow(PAGE_WORKFLOWS[flowKey]);

    // Listen for internal triggers (e.g. sub-tabs)
    const handleTrigger = (e: any) => {
      const workflowId = e.detail?.workflowId;
      if (workflowId && SUB_WORKFLOWS[workflowId]) {
        setIsChatOpen(true);
        runWorkflow(SUB_WORKFLOWS[workflowId]);
      }
    };

    window.addEventListener("trigger-agent-workflow", handleTrigger);
    return () => {
      window.removeEventListener("trigger-agent-workflow", handleTrigger);
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, [pathname]);

  return (
    <>
      {/* Floating Agent Chat Panel - Premium Design */}
      <div
        className={`fixed bottom-24 right-6 w-[400px] bg-white/60 backdrop-blur-2xl rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] border border-white/50 transition-all duration-500 transform origin-bottom-right z-50 ${isChatOpen ? "scale-100 opacity-100 translate-y-0" : "scale-75 opacity-0 translate-y-10 pointer-events-none"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/40 bg-gradient-to-r from-blue-600/90 to-indigo-600/90 rounded-t-3xl backdrop-blur-md shadow-sm">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 bg-gradient-to-tr from-white/20 to-white/5 rounded-full flex items-center justify-center text-white text-xl shadow-inner border border-white/20 backdrop-blur-sm">
                🧠
              </div>
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 border-2 border-indigo-600 rounded-full shadow-[0_0_10px_rgba(74,222,128,0.5)]"></span>
            </div>
            <div>
              <h3 className="font-bold text-white text-[15px] tracking-tight text-shadow-sm">
                全域 AI Agent 协同网络
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-300 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-400"></span>
                </span>
                <span className="text-[10px] uppercase font-bold text-blue-100 tracking-wider">
                  实时执行中 / 全局节点
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsChatOpen(false)}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Chat Flow */}
        <div
          className="p-5 h-[420px] overflow-y-auto space-y-5 bg-gradient-to-b from-slate-50/50 to-white/50 flex flex-col custom-scrollbar rounded-b-3xl scroll-smooth"
          ref={chatRef}
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-3">
              <span className="text-4xl animate-pulse drop-shadow-sm">📡</span>
              <span className="text-sm font-medium">
                路由切换中，系统分析当前页面...
              </span>
            </div>
          )}
          {messages.map((msg) => {
            const isSystem =
              msg.agent.includes("中心") ||
              msg.agent.includes("节点") ||
              msg.agent.includes("守护者") ||
              msg.agent.includes("爬虫") ||
              msg.agent.includes("采集器");
            return (
              <div
                key={msg.id}
                className={`flex gap-3 animate-fade-in-up ${isSystem ? "justify-center my-6" : ""}`}
              >
                {isSystem ? (
                  <div className="bg-slate-800/80 backdrop-blur-md text-slate-200 text-xs px-4 py-2 rounded-full font-medium shadow-lg shadow-slate-900/10 border border-slate-700/50 text-center">
                    {msg.avatar} {msg.content}
                  </div>
                ) : (
                  <>
                    <div className="w-10 h-10 rounded-[14px] bg-gradient-to-br from-white to-slate-100 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.1)] border border-slate-200 flex items-center justify-center text-xl flex-shrink-0 z-10 relative mt-1">
                      {msg.avatar}
                    </div>
                    <div className="flex flex-col flex-1 items-start">
                      <div className="flex items-center gap-2 mb-1 px-1">
                        <span className="text-[13px] font-bold text-slate-700">
                          {msg.agent}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {msg.time}
                        </span>
                      </div>
                      <div className="bg-white/90 backdrop-blur-sm text-[13px] text-slate-700 p-3.5 rounded-2xl rounded-tl-sm shadow-sm border border-slate-200/60 leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {messages.length > 0 &&
            messages.length < currentFlowLenRef.current && (
              <div className="flex gap-3 animate-fade-in-up mt-2">
                <div className="w-10 h-10 rounded-[14px] bg-gradient-to-br from-white to-slate-100 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.1)] border border-slate-200 flex items-center justify-center text-xl flex-shrink-0 animate-pulse">
                  ...
                </div>
                <div className="bg-white/90 backdrop-blur-sm px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm border border-slate-200/60 flex items-center gap-1.5 self-start mt-1">
                  <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></span>
                  <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                </div>
              </div>
            )}
        </div>
      </div>

      {/* Chat Toggle Button - Outside panel */}
      <button
        onClick={() => setIsChatOpen(!isChatOpen)}
        className={`fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-2xl transition-all duration-500 z-50 ${isChatOpen ? "bg-slate-800 text-white rotate-180 scale-0 opacity-0 pointer-events-none" : "bg-gradient-to-br from-blue-600 to-indigo-600 text-white rotate-0 scale-100 opacity-100 shadow-indigo-500/40 hover:scale-110 hover:shadow-indigo-500/60"}`}
      >
        💬
        {!isChatOpen && messages.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-sm ring-2 ring-rose-500/20">
            {messages.length}
          </span>
        )}
      </button>
    </>
  );
}
