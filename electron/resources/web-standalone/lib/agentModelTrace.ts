/** 对话结束后展示的「参与模型 / 能力」溯源（与 /api/chat 尾缀载荷共用类型） */

export const AGENT_MODEL_TRACE_START = "<<<AGENT_MODEL_TRACE>>>";
export const AGENT_MODEL_TRACE_END = "<<<END>>>";

export type ParticipationItem = {
  kind: string;
  title: string;
  detail: string;
};

export type AgentModelTracePayload = {
  items: ParticipationItem[];
};

export type ProviderConfigLite = {
  provider: string;
  model: string;
  providerName?: string;
};

export type MediaModelsBlock = {
  current?: string;
  models?: Array<{ id: string; name?: string }>;
};

/** 根据本次实际调用的工具 + 当前配置，拼装展示行（服务端或客户端均可调用） */
export function buildParticipationItems(
  toolsUsed: Set<string>,
  cfg: ProviderConfigLite,
  mediaData: Record<string, MediaModelsBlock> | null | undefined,
  extras?: { memoryPrefetchHits?: number },
): ParticipationItem[] {
  const items: ParticipationItem[] = [];
  const provLabel = cfg.providerName || cfg.provider;
  items.push({
    kind: "dialogue",
    title: "对话大模型",
    detail: `${cfg.model}（${provLabel}）`,
  });

  const pickName = (mod: string): string => {
    const block = mediaData?.[mod];
    const curId = block?.current;
    const m = block?.models?.find((x) => x.id === curId);
    return (m?.name as string) || curId || "—";
  };

  const needsImage = toolsUsed.has("generateImage");
  const needsVideo =
    toolsUsed.has("generateVideo") ||
    toolsUsed.has("generateVideoFromImage");

  if (needsImage) {
    items.push({
      kind: "image",
      title: "图片生成",
      detail: mediaData ? pickName("image") : "（当前图片模型配置）",
    });
  }
  if (needsVideo) {
    items.push({
      kind: "video",
      title: toolsUsed.has("generateVideoFromImage")
        ? "视频生成（图生视频）"
        : "视频生成",
      detail: mediaData ? pickName("video") : "（当前视频模型配置）",
    });
  }
  if (toolsUsed.has("searchKnowledgeBase")) {
    items.push({
      kind: "rag",
      title: "知识库检索",
      detail: `向量检索 + 对话模型归纳（${cfg.model}）`,
    });
  }
  if (toolsUsed.has("searchMemory") || toolsUsed.has("memoryPrefetch")) {
    const prefetchNote =
      extras?.memoryPrefetchHits && extras.memoryPrefetchHits > 0
        ? `预取 ${extras.memoryPrefetchHits} 条`
        : toolsUsed.has("searchMemory")
          ? "工具检索"
          : "";
    items.push({
      kind: "memory",
      title: "记忆检索",
      detail: prefetchNote
        ? `${prefetchNote} + 向量记忆库`
        : "向量记忆库",
    });
  }
  if (toolsUsed.has("analyzeTrends")) {
    items.push({
      kind: "trends",
      title: "趋势分析",
      detail: `热点数据 + ${cfg.model} 解读`,
    });
  }
  if (toolsUsed.has("publishContent")) {
    items.push({
      kind: "publish",
      title: "内容发布",
      detail: "连接器 / 浏览器自动化（按平台）",
    });
  }
  if (toolsUsed.has("runLobsterPipeline")) {
    items.push({
      kind: "lobster",
      title: "爆款流水线",
      detail: "Lobster / OpenClaw 后端流水线",
    });
  }

  return items;
}

function decodeUtf8Base64(b64: string): string {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** 从助手正文末尾剥离溯源载荷（仅浏览器侧解码） */
export function stripAgentModelTrace(content: string): {
  content: string;
  trace: AgentModelTracePayload | null;
} {
  const idx = content.lastIndexOf(AGENT_MODEL_TRACE_START);
  if (idx === -1) return { content, trace: null };
  const after = content.slice(idx + AGENT_MODEL_TRACE_START.length);
  const endIdx = after.indexOf(AGENT_MODEL_TRACE_END);
  if (endIdx === -1) return { content, trace: null };
  const b64 = after.slice(0, endIdx);
  const main = content.slice(0, idx).trimEnd();
  try {
    const raw = decodeUtf8Base64(b64);
    const parsed = JSON.parse(raw) as AgentModelTracePayload;
    if (!parsed || !Array.isArray(parsed.items)) return { content: main, trace: null };
    return { content: main, trace: parsed };
  } catch {
    return { content: main, trace: null };
  }
}

/** 流式输出过程中隐藏尚未闭合的溯源尾缀，避免闪屏 */
export function stripIncompleteAgentTraceDisplay(raw: string): string {
  const i = raw.lastIndexOf(AGENT_MODEL_TRACE_START);
  if (i === -1) return raw;
  const after = raw.slice(i + AGENT_MODEL_TRACE_START.length);
  if (after.includes(AGENT_MODEL_TRACE_END)) {
    return stripAgentModelTrace(raw).content;
  }
  return raw.slice(0, i).trimEnd();
}
