import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { parseKnowledgeScope } from '@/lib/knowledge-scope';
import {
  searchKnowledgeBase,
  searchMemory,
  prefetchMemoryContext,
  generateImage,
  editImage,
  generateVideo,
  generateVideoFromImage,
  analyzeTrends,
  publishContent,
  runLobsterPipeline,
  searchWeb,
  fetchWebContent,
} from './tools';
import { buildA2uiLinesFromToolText } from '@/lib/a2uiMedia';
import {
  AGENT_MODEL_TRACE_END,
  AGENT_MODEL_TRACE_START,
  buildParticipationItems,
  type MediaModelsBlock,
} from '@/lib/agentModelTrace';

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// Ensure we have a timeout for long generations
export const maxDuration = 300;

// Retrieve Configuration dynamically from backend
async function getProviderConfig() {
  try {
    const res = await fetch(`${BACKEND_URL}/config/provider`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const envApiKey = process.env.OPENROUTER_API_KEY;
      const envModel = process.env.LLM_MODEL || 'openai/gpt-4o';
      return {
        provider: 'openrouter',
        apiKey: envApiKey,
        model: envModel,
        baseUrl: 'https://openrouter.ai/api/v1',
        providerName: 'OpenRouter',
      };
    }
    const data = await res.json();

    const currentId = data.current?.id || 'openrouter';
    const providerInfo = data.available?.find((p: any) => p.id === currentId);

    const dashFromExtras =
      currentId === "alibaba" && Array.isArray(providerInfo?.extra_keys)
        ? (
            providerInfo.extra_keys.find(
              (e: { env_var?: string; value?: string }) =>
                e?.env_var === "DASHSCOPE_API_KEY",
            )?.value || ""
          ).trim()
        : "";

    const apiKey =
      (providerInfo?.api_key_value || "").trim() ||
      dashFromExtras ||
      process.env[providerInfo?.env_var || ""] ||
      (currentId === "alibaba"
        ? process.env.DASHSCOPE_API_KEY || process.env.ALIBABA_API_KEY
        : undefined) ||
      process.env.OPENROUTER_API_KEY;

    let model = data.current?.model;
    if (!model || model === '<default>') {
      model = providerInfo?.default_model || 'openai/gpt-4o';
    }

    const baseUrl = providerInfo?.base_url || 'https://openrouter.ai/api/v1';

    return {
      provider: currentId,
      apiKey,
      model,
      baseUrl,
      providerName: typeof providerInfo?.name === "string" ? providerInfo.name : undefined,
    };
  } catch (e) {
    console.error("Failed to fetch config from backend, falling back to env", e);
    return {
      provider: 'openrouter',
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.LLM_MODEL || 'openai/gpt-4o',
      baseUrl: 'https://openrouter.ai/api/v1',
      providerName: 'OpenRouter',
    };
  }
}

/** 上游 LLM 密钥无效/过期等，不应伪装成 500「服务没响应」 */
function isLikelyLlmAuthFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    msg.includes("身份验证失败") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid_api_key") ||
    /\b401\b/.test(msg) ||
    (lower.includes("api key") &&
      (lower.includes("invalid") || lower.includes("expired")))
  );
}

async function saveToHistory(prompt: string, result: string, type: string) {
  try {
    await fetch(`${BACKEND_URL}/chat/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, result, type }),
    });
  } catch (error) {
    console.error("Failed to save chat history:", error);
  }
}

type ChatPrefsBody = {
  onlineSearchMode?: string;
  unboundMode?: boolean;
  chatMemoryEnabled?: boolean;
  chatKnowledgeMode?: string;
  chatKnowledgeScope?: string;
  chatMemoryRecall?: boolean;
};

function knowledgePreferenceOn(prefs: ChatPrefsBody | undefined): boolean {
  return prefs?.chatKnowledgeMode !== "off";
}

function resolveKnowledgeQueryScope(prefs: ChatPrefsBody | undefined): {
  category?: string;
  doc_id?: string;
} {
  if (!knowledgePreferenceOn(prefs)) return {};
  if (prefs?.chatKnowledgeMode !== "scoped") return {};
  return parseKnowledgeScope(prefs.chatKnowledgeScope ?? "all");
}

function knowledgeScopePromptLine(prefs: ChatPrefsBody | undefined): string {
  if (!knowledgePreferenceOn(prefs)) return "";
  if (prefs?.chatKnowledgeMode === "scoped") {
    const scope = prefs.chatKnowledgeScope ?? "all";
    if (scope.startsWith("doc:")) {
      return `Knowledge scope: search ONLY document id ${scope.slice(4)} in the private knowledge base; cite its filename in answers.`;
    }
    if (scope.startsWith("cat:")) {
      return `Knowledge scope: search ONLY category id "${scope.slice(4)}" in the private knowledge base.`;
    }
  }
  return "Knowledge scope: search all indexed private documents when relevant.";
}

function memoryRecallPreferenceOn(prefs: ChatPrefsBody | undefined): boolean {
  return prefs?.chatMemoryRecall !== false;
}

function buildStreamChatSystemCore(opts: {
  knowledgeOn: boolean;
  memoryOn: boolean;
  knowledgeScopeLine?: string;
}): string {
  const toolParts = [
    "generateImage",
    "editImage (precise image editing: 12 modes incl. reference/style/upscale/watermark)",
    "generateVideo",
    "generateVideoFromImage (image-to-video)",
  ];
  if (opts.knowledgeOn) {
    toolParts.push("searchKnowledgeBase");
  }
  if (opts.memoryOn) {
    toolParts.push("searchMemory");
  }
  toolParts.push(
    "optionally searchWeb and fetchWebContent when web search preference is enabled",
    "analyzeTrends",
    "publishContent",
    "runLobsterPipeline",
  );

  const knowledgeRule = !opts.knowledgeOn
    ? "Do not call searchKnowledgeBase; rely on model knowledge and other enabled tools only."
    : opts.knowledgeScopeLine ||
      "When factual questions may be answered from uploaded docs, call searchKnowledgeBase first and cite source filenames/snippets in your final answer when relevant.";

  const memoryRule = opts.memoryOn
    ? "searchMemory recalls past user preferences, generated assets, and workflow facts. Use it when continuity matters. Treat memory hits as internal reference only—do not dump raw memory blocks to the user."
    : "Do not call searchMemory.";

  return `You're an AI Media Agent. Tools: ${toolParts.join(", ")}.
1. VISUALS FIRST: Call tool instantly if video/image requested. No confirmation.
2. IMAGE-TO-VIDEO: When user provides an image URL (http/https) OR message says uploaded reference URLs, MUST use generateVideoFromImage with image_url copied exactly + short prompt describing motion/style. Prefer this over plain generateVideo whenever a stable image URL exists.
3. VERY IMPORTANT: keep 'prompt' parameters for video/image generation EXTREMELY SHORT (1-2 sentences max) to save AI tokens, unless user explicitly demands length.
4. DO NOT output conversational fluff ("Generating your image now..."). Just call tools.
5. In your final answer, copy the tool result lines verbatim, including any substring "storage/outputs/<filename>.png" (or .jpg/.webp) or full https image URL, so the UI can render. Never use empty markdown links like ![](\\/).
6. IF the user asks to run the OpenClaw / Lobster pipeline for trend collection, cloning, and publishing, IMMEDIATELY call the runLobsterPipeline tool.
7. KNOWLEDGE: ${knowledgeRule}
8. MEMORY: ${memoryRule}`;
}

function preferenceSystemTail(prefs: ChatPrefsBody | undefined): string {
  if (!prefs) return "";
  const lines: string[] = [];

  if (prefs.onlineSearchMode === "off") {
    lines.push(
      "Web: Never claim live open-web browsing or fabricate dated real-time web citations.",
    );
  } else if (prefs.onlineSearchMode === "smart") {
    lines.push(
      "Web: When recency-sensitive facts matter, briefly note cutoff and suggest verifying high-stakes details from trustworthy sources.",
    );
  }

  if (prefs.unboundMode === true) {
    lines.push(
      "Style: Prefer flexible, imaginative help where user intent is clearly creative; keep core safety intact.",
    );
  } else   if (prefs.unboundMode === false) {
    lines.push(
      "Style: Use standard calibrated assistant tone and refusal patterns.",
    );
  }

  if (prefs.chatKnowledgeMode === "off") {
    lines.push(
      "Knowledge: Do not use the private knowledge base tool for this conversation.",
    );
  } else if (prefs.chatKnowledgeMode === "scoped") {
    lines.push(
      `Knowledge: ${knowledgeScopePromptLine(prefs).replace(/^Knowledge scope: /, "Use searchKnowledgeBase within scope — ")}`,
    );
  } else if (prefs.chatKnowledgeMode === "smart") {
    lines.push(
      "Knowledge: Prefer searchKnowledgeBase when the user asks about uploaded docs, internal specs, or domain facts that may live in the knowledge base.",
    );
  }

  if (prefs.chatMemoryRecall === false) {
    lines.push("Memory recall: Do not call searchMemory for this conversation.");
  } else if (prefs.chatMemoryRecall === true) {
    lines.push(
      "Memory recall: When user preferences, prior outputs, or long-running project facts matter, call searchMemory before answering.",
    );
  }

  if (!lines.length) return "";
  return `\n\nConversation preferences:\n• ${lines.join("\n• ")}`;
}

/** 仅在首轮提示内：明显「需要联网」的请求，强制第一轮走 searchWeb，避免模型空答 */
function textLooksLikeMandatoryWebLookup(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  return /天气|气温|降水|刮风|寒潮|热浪|forecast|temperature|precip|\bweather\b|\bAQI\b|空气质量/u.test(t);
}

const STREAM_CHAT_WEB_TOOLS =
  `\nAdditional tools when web search preference is enabled: searchWeb (DuckDuckGo web query), fetchWebContent (readable text from https URL). Use searchWeb whenever up-to-date or external factual information is needed and not found via searchKnowledgeBase. Then synthesize briefly and cite snippets/URLs returned by tools; never invent links.\nMandatory: For weather/stock/news/exchange-rate questions or Chinese queries like 「今天」「最新」「实时」, you MUST call searchWeb first unless the answer is clearly timeless — then summarize from snippets/URLs returned.`;

async function proxyAgentChatInvoke(body: Record<string, unknown>) {
  const res = await fetch(`${BACKEND_URL}/agent/chat/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: body.messages ?? [],
      preferences: body.preferences,
      mode: "multi",
      stream: false,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    let error = `Backend chat failed: ${res.status}`;
    try {
      const parsed = JSON.parse(raw) as { detail?: string; error?: string };
      error = parsed.detail || parsed.error || error;
    } catch {
      if (raw.trim()) error = raw.trim().slice(0, 500);
    }
    return Response.json({ error }, { status: res.status });
  }
  try {
    const data = JSON.parse(raw) as { response?: string; content?: string };
    const text = (data.response ?? data.content ?? "").trim();
    return Response.json({ content: text });
  } catch {
    return Response.json({ content: raw.trim() });
  }
}

async function proxyAgentChatStream(body: Record<string, unknown>) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const input =
    typeof body.input === "string" && body.input.trim()
      ? body.input.trim()
      : [...messages]
          .reverse()
          .find(
            (m: { role?: string; content?: string }) =>
              m?.role === "user" && typeof m.content === "string" && m.content.trim(),
          )
          ?.content?.trim() || "";

  const res = await fetch(`${BACKEND_URL}/agent/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      messages: messages.length > 0 ? messages : input ? [{ role: "user", content: input }] : [],
      input: input || undefined,
      preferences: body.preferences,
      mode: "multi",
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      { error: `Backend chat stream failed: ${res.status}`, detail },
      { status: res.status },
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let fullText = "";

  const stream = new ReadableStream({
    async pull(controller) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          controller.enqueue(encoder.encode(fullText));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const line = block.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const event = JSON.parse(line.slice(6)) as { type?: string; content?: string; response?: string };
            if (event.type === "token" && event.content) {
              fullText += event.content;
              controller.enqueue(encoder.encode(event.content));
            } else if (event.type === "final" && event.response) {
              if (!fullText) fullText = event.response;
            }
          } catch {
            /* ignore malformed SSE */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const useLegacy = process.env.CHAT_LEGACY_AI_SDK === "1";
    if (!useLegacy) {
      const enableStream = (body as { stream?: boolean }).stream !== false;
      if (!enableStream) {
        return proxyAgentChatInvoke(body);
      }
      return proxyAgentChatStream(body);
    }
    const {
      messages = [],
      stream: enableStream = true,
      preferences,
    } = body as {
      messages?: unknown[];
      stream?: boolean;
      preferences?: ChatPrefsBody;
    };
    const webSearchPreferenceOn =
      preferences?.onlineSearchMode !== "off";
    const knowledgePreferenceOnFlag = knowledgePreferenceOn(preferences);
    const memoryRecallPreferenceOnFlag = memoryRecallPreferenceOn(preferences);

    // 对话模型严格以后端「模型设置」(/config/provider) 为准，忽略请求体中的 provider/model
    const config = await getProviderConfig();

    const provider = config.provider;
    const model = config.model;
    const { apiKey, baseUrl, providerName } = config;

    // Convert simple {role, content} messages to ModelMessage format
    const modelMessages = messages.map((m: any) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: typeof m.content === 'string'
        ? [{ type: 'text' as const, text: m.content }]
        : m.content,
    }));

    console.log(`[Chat] Using provider: ${provider}, model: ${model}, baseUrl: ${baseUrl}`);
    console.info(
      "[Chat]",
      JSON.stringify({
        tag: "request_prefs",
        stream: enableStream,
        onlineSearchMode: preferences?.onlineSearchMode ?? "(unset)",
        webToolsRegistered: preferences?.onlineSearchMode !== "off",
        chatMemoryEnabled: preferences?.chatMemoryEnabled,
        chatKnowledgeMode: preferences?.chatKnowledgeMode ?? "(unset)",
        chatKnowledgeScope: preferences?.chatKnowledgeScope ?? "(unset)",
        knowledgeToolsRegistered: knowledgePreferenceOnFlag,
        chatMemoryRecall: preferences?.chatMemoryRecall,
        memoryToolsRegistered: memoryRecallPreferenceOnFlag,
      }),
    );

    if (!apiKey) {
      const label =
        providerName ||
        (provider === "alibaba" ? "阿里通义千问（DashScope）" : provider);
      return Response.json(
        {
          error: `${label} 的 API Key 未读到。请在「设置」中配置 ALIBABA_API_KEY 或 DASHSCOPE_API_KEY（通义），保存后重试；并确认后端已重启且能访问 ${BACKEND_URL}/config/provider。`,
        },
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    let aiSdkProvider;
    if (provider === 'openrouter') {
      aiSdkProvider = createOpenRouter({ apiKey });
    } else {
      aiSdkProvider = createOpenAI({
        name: provider,
        apiKey: apiKey,
        baseURL: baseUrl
      });
    }

    const modelConfig = typeof aiSdkProvider.chat === 'function'
      ? aiSdkProvider.chat(model)
      : aiSdkProvider(model);

    // 非流式响应（用于 AI 自动补全等场景）
    if (!enableStream) {
      // 分离 system 消息和 user/assistant 消息
      const systemMsg = messages.find(
        (m: any) => m.role === "system",
      ) as { role: string; content?: unknown } | undefined;
      const chatMessages = messages
        .filter((m: any) => m.role !== 'system')
        .map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: typeof m.content === 'string' ? m.content : String(m.content),
        }));

      const extraTail = preferenceSystemTail(preferences);
      const mergedSystemPieces: string[] = [];
      const sysRaw = systemMsg?.content;
      if (sysRaw != null && `${sysRaw}`.trim() !== "")
        mergedSystemPieces.push(`${sysRaw}`.trim());
      if (extraTail.trim())
        mergedSystemPieces.push(extraTail.trim());

      const result = await generateText({
        model: modelConfig as any,
        messages: chatMessages,
        // 智能助手（Lark CLI 等）需要足够长度输出总结/待办，150 易截断或触发异常
        maxOutputTokens: 4096,
        system:
          mergedSystemPieces.length > 0
            ? mergedSystemPieces.join("\n\n")
            : undefined,
      });

      const participation = buildParticipationItems(new Set(), {
        provider,
        model,
        providerName,
      }, null);

      return new Response(
        JSON.stringify({ content: result.text, participation }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const lastUserPlain = [...messages]
      .reverse()
      .find((m: unknown) => (m as { role?: string }).role === "user") as
      | { content?: unknown }
      | undefined;
    const lastUserText =
      lastUserPlain?.content != null ? String(lastUserPlain.content) : "";

    let memoryPrefetchContext = "";
    let memoryPrefetchHitCount = 0;
    if (memoryRecallPreferenceOnFlag && lastUserText.trim()) {
      const prefetched = await prefetchMemoryContext(lastUserText);
      memoryPrefetchContext = prefetched.context;
      memoryPrefetchHitCount = prefetched.hitCount;
      if (memoryPrefetchHitCount > 0) {
        console.info(
          "[Chat]",
          JSON.stringify({
            tag: "memory_prefetch",
            hitCount: memoryPrefetchHitCount,
          }),
        );
      }
    }

    const streamSystemJoined =
      buildStreamChatSystemCore({
        knowledgeOn: knowledgePreferenceOnFlag,
        memoryOn: memoryRecallPreferenceOnFlag,
        knowledgeScopeLine:
          knowledgePreferenceOnFlag &&
          preferences?.chatKnowledgeMode === "scoped"
            ? knowledgeScopePromptLine(preferences)
            : undefined,
      }) +
      (webSearchPreferenceOn ? STREAM_CHAT_WEB_TOOLS : "") +
      preferenceSystemTail(preferences) +
      (memoryPrefetchContext ? `\n\n${memoryPrefetchContext}` : "");

    const webToolsBlock = webSearchPreferenceOn
      ? {
          searchWeb: tool({
            description:
              "Search the live public web via project MCP server (typically DuckDuckGo). Best for timely facts, releases, verification; not for secrets or paywalled content.",
            inputSchema: z.object({
              query: z.string(),
              max_results: z.number().optional(),
              region: z
                .string()
                .optional()
                .describe(
                  'Optional DuckDuckGo region e.g. "us-en", "cn-zh", empty for default.',
                ),
            }),
            execute: async ({ query, max_results, region }) => {
              return await searchWeb({ query, max_results, region });
            },
          }),
          fetchWebContent: tool({
            description:
              "Fetch readable main text from a public https URL returned by web search.",
            inputSchema: z.object({
              url: z.string().describe("Fully qualified http/https URL."),
              max_length: z.number().optional(),
              start_index: z.number().optional(),
            }),
            execute: async ({ url, max_length, start_index }) => {
              return await fetchWebContent({ url, max_length, start_index });
            },
          }),
        }
      : {};

    const knowledgeToolsBlock = knowledgePreferenceOnFlag
      ? {
          searchKnowledgeBase: tool({
            description:
              preferences?.chatKnowledgeMode === "scoped"
                ? `Search the private knowledge base within the user's selected scope (${preferences.chatKnowledgeScope ?? "all"}). Cite source filenames/snippets.`
                : "Search the private knowledge base (uploaded docs). Use for internal specs, product facts, or user-uploaded reference material.",
            inputSchema: z.object({
              query: z
                .string()
                .describe("The search query to match indexed documents."),
            }),
            execute: async ({ query }) => {
              return await searchKnowledgeBase({
                query,
                ...resolveKnowledgeQueryScope(preferences),
              });
            },
          }),
        }
      : {};

    const memoryToolsBlock = memoryRecallPreferenceOnFlag
      ? {
          searchMemory: tool({
            description:
              "Search long-term agent memory for user preferences, prior outputs, and workflow facts. Internal reference only.",
            inputSchema: z.object({
              query: z
                .string()
                .describe("Semantic query, e.g. prior image style or user preference."),
            }),
            execute: async ({ query }) => {
              return await searchMemory({ query });
            },
          }),
        }
      : {};

    const allChatTools = {
      runLobsterPipeline: tool({
        description: 'Trigger the full automated Lobster pipeline: collect social media trends, clone content via OpenClaw, and auto-publish.',
        inputSchema: z.object({
          trend_platforms: z.array(z.string()).optional(),
          publish_platforms: z.array(z.string()).optional(),
          limit: z.number().optional()
        }),
        execute: async ({ trend_platforms, publish_platforms, limit }) => {
          return await runLobsterPipeline({ trend_platforms, publish_platforms, limit });
        }
      }),
      ...knowledgeToolsBlock,
      ...memoryToolsBlock,
      generateImage: tool({
        description: 'Generate an image based on a text prompt.',
        inputSchema: z.object({
          prompt: z.string().describe('Detailed description for the image generation model.'),
        }),
        execute: async ({ prompt }) => {
          return await generateImage({ prompt });
        },
      }),
      editImage: tool({
        description:
          'Precisely edit an existing image: instruction, inpaint, remove, outpaint, style transfer, reference-based edit, upscale, watermark removal, colorize, sketch, cartoon. Requires source_image_url.',
        inputSchema: z.object({
          source_image_url: z
            .string()
            .describe('URL or /api/media/ path of the source image to edit.'),
          prompt: z
            .string()
            .optional()
            .describe('Edit instruction. Optional for remove/watermark/upscale.'),
          mode: z
            .enum([
              'instruction',
              'inpaint',
              'remove',
              'outpaint',
              'style_global',
              'style_local',
              'watermark',
              'upscale',
              'colorize',
              'sketch',
              'cartoon',
              'reference',
            ])
            .optional()
            .describe('Edit mode. Default instruction. Use reference with reference_image_urls.'),
          mask_image_url: z
            .string()
            .optional()
            .describe('Mask image URL for inpaint/remove (white=edit region).'),
          reference_image_urls: z
            .array(z.string())
            .optional()
            .describe('Reference image URLs for reference mode (图2+). Max 2. Required when mode=reference.'),
          reference_intent: z
            .enum([
              'replace_material',
              'preserve_shape',
              'recompose_layout',
              'style_transfer',
              'partial_replace',
            ])
            .optional()
            .describe(
              'Reference edit strategy: replace_material (swap content, keep shape/layout), preserve_shape (texture only), recompose_layout (allow new layout), style_transfer, partial_replace.',
            ),
          reference_target: z
            .string()
            .optional()
            .describe('What in 图1 to replace or process, e.g. "the vase on the table".'),
          reference_roles: z
            .array(z.enum(['material', 'style', 'background', 'subject']))
            .optional()
            .describe('Role per reference image, aligned with reference_image_urls order.'),
          expand_top: z.number().optional(),
          expand_bottom: z.number().optional(),
          expand_left: z.number().optional(),
          expand_right: z.number().optional(),
          strength: z.number().optional(),
          n: z.number().optional(),
          seed: z.number().optional(),
          upscale_factor: z.number().optional(),
          is_sketch: z.boolean().optional(),
        }),
        execute: async (args) => {
          return await editImage(args);
        },
      }),
      generateVideoFromImage: tool({
        description:
          'Generate a video animated from an existing INPUT image URL (image-to-video / 图生视频). Use when user attaches an image URL or uploads a reference.',
        inputSchema: z.object({
          image_url: z
            .string()
            .describe(
              'Full http(s) URL of the reference image reachable by backend (often from user message uploads).',
            ),
          prompt: z
            .string()
            .optional()
            .describe('Short motion or scene description in one or two clauses.'),
        }),
        execute: async ({ image_url, prompt }) => {
          return await generateVideoFromImage({
            image_url,
            prompt: prompt ?? '',
          });
        },
      }),
      generateVideo: tool({
        description: 'Generate a video based on a text prompt.',
        inputSchema: z.object({
          prompt: z.string().describe('Detailed description for the video generation model.'),
        }),
        execute: async ({ prompt }) => {
          return await generateVideo({ prompt });
        },
      }),
      analyzeTrends: tool({
        description: 'Analyze trends on a specific platform.',
        inputSchema: z.object({
          category: z.string(),
          platform: z.enum(['douyin', 'xiaohongshu', 'bilibili']).optional(),
        }),
        execute: async ({ category, platform }) => {
          return await analyzeTrends({ category, platform });
        }
      }),
      publishContent: tool({
        description: 'Publish content to a social media platform.',
        inputSchema: z.object({
          platform: z.string().describe('Platform ID (douyin, xiaohongshu).'),
          content: z.string(),
          title: z.string().optional(),
          media_urls: z.array(z.string()).optional(),
        }),
        execute: async ({ platform, content, title, media_urls }) => {
          return await publishContent({ platform, content, title, media_urls });
        }
      }),
    };

    const mergedChatTools = { ...allChatTools, ...webToolsBlock };

    const result = streamText({
      model: modelConfig as any,
      messages: modelMessages,
      maxOutputTokens: 4096,
      stopWhen: stepCountIs(webSearchPreferenceOn ? 10 : 6),
      system: streamSystemJoined,
      tools: mergedChatTools as any,
      prepareStep: webSearchPreferenceOn
        ? ({ steps }) => {
            if (steps.length > 0) return {};
            if (!textLooksLikeMandatoryWebLookup(lastUserText)) return {};
            console.info(
              "[Chat]",
              JSON.stringify({
                tag: "prepare_step_force_tool",
                tool: "searchWeb",
                userTextPreview: lastUserText.slice(0, 200),
              }),
            );
            return {
              toolChoice: { type: "tool", toolName: "searchWeb" },
              activeTools: ["searchWeb"],
            };
          }
        : undefined,
      onStepFinish: (step) => {
        const s = step as {
          finishReason?: string;
          toolCalls?: Array<{ toolName?: string }>;
          warnings?: unknown[];
          text?: string;
        };
        const names =
          s.toolCalls
            ?.map((c) => c.toolName)
            .filter(
              (n): n is string => typeof n === "string" && n.length > 0,
            ) ?? [];
        console.info(
          "[Chat]",
          JSON.stringify({
            tag: "stream_step_finish",
            finishReason: s.finishReason,
            tools: names,
            textChars: typeof s.text === "string" ? s.text.length : 0,
            warningCount: Array.isArray(s.warnings) ? s.warnings.length : 0,
          }),
        );
      },
      onError: ({ error }) => {
        console.error(
          "[Chat]",
          JSON.stringify({
            tag: "stream_error",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      },
      onFinish: async ({ text }) => {
        const hasImage =
          (text.includes("storage/outputs/") &&
            /\.(jpg|png|jpeg|gif|webp)/i.test(text)) ||
          /A2UI_MEDIA:image:/.test(text);
        const hasVideo =
          (text.includes("storage/outputs/") &&
            /\.(mp4|webm|mov)/i.test(text)) ||
          /A2UI_MEDIA:video:/.test(text);

        const memoryAllowsHistory =
          preferences?.chatMemoryEnabled !== false;
        if (memoryAllowsHistory && (hasImage || hasVideo)) {
          const type = hasVideo ? "video" : "image";
          const lastUserMsg = messages
            .filter((m: any) => m.role === 'user')
            .pop() as { role: string; content?: unknown } | undefined;
          if (lastUserMsg != null && lastUserMsg.content != null) {
            await saveToHistory(String(lastUserMsg.content), text, type);
          }
        }
      },
    });

    // toTextStreamResponse 只包含模型文本，不包含工具输出；在流末尾注入 A2UI 哨兵行，前端才能稳定出图
    const encoder = new TextEncoder();
    const injected = new Set<string>();
    const mediaAugmentedStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const toolsUsed = new Set<string>();
        try {
          for await (const part of result.fullStream) {
            const rec = part as Record<string, unknown>;
            if (typeof rec.toolName === "string" && rec.toolName.length > 0) {
              toolsUsed.add(rec.toolName);
            }
            if (part.type === "text-delta") {
              const p = part as Record<string, unknown>;
              const delta =
                typeof p.textDelta === "string"
                  ? p.textDelta
                  : typeof p.text === "string"
                    ? p.text
                    : typeof p.delta === "string"
                      ? p.delta
                      : "";
              if (delta) controller.enqueue(encoder.encode(delta));
            }
            if (part.type === "tool-result") {
              const out = (part as { output?: unknown }).output;
              const s =
                typeof out === "string" ? out : JSON.stringify(out ?? "");
              for (const line of buildA2uiLinesFromToolText(s)) {
                injected.add(line);
              }
            }
          }
          if (injected.size > 0) {
            controller.enqueue(
              encoder.encode("\n\n" + [...injected].join("\n") + "\n"),
            );
          }

          let mediaData: Record<string, MediaModelsBlock> | null = null;
          const needsMedia =
            toolsUsed.has("generateImage") ||
            toolsUsed.has("generateVideo") ||
            toolsUsed.has("generateVideoFromImage");
          if (needsMedia) {
            try {
              const mr = await fetch(`${BACKEND_URL}/config/media-models`, {
                cache: "no-store",
              });
              if (mr.ok) {
                mediaData = (await mr.json()) as Record<
                  string,
                  MediaModelsBlock
                >;
              }
            } catch {
              mediaData = null;
            }
          }

          if (memoryPrefetchHitCount > 0) {
            toolsUsed.add("memoryPrefetch");
          }

          const participationItems = buildParticipationItems(
            toolsUsed,
            { provider, model, providerName },
            mediaData,
            { memoryPrefetchHits: memoryPrefetchHitCount },
          );
          const tracePayload = { items: participationItems };
          const b64 = Buffer.from(JSON.stringify(tracePayload), "utf-8").toString(
            "base64",
          );
          controller.enqueue(
            encoder.encode(
              `\n\n${AGENT_MODEL_TRACE_START}${b64}${AGENT_MODEL_TRACE_END}\n`,
            ),
          );

          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(mediaAugmentedStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error: unknown) {
    console.error("Error in chat route:", error);
    const message = error instanceof Error ? error.message : String(error);
    const status = isLikelyLlmAuthFailure(error) ? 401 : 500;
    return Response.json(
      { error: message },
      { status, headers: { "Content-Type": "application/json" } },
    );
  }
}
