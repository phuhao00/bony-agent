import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export type TextGenerateMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

async function getProviderConfig() {
  try {
    const res = await fetch(`${BACKEND_URL}/config/provider`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        provider: "openrouter",
        apiKey: process.env.OPENROUTER_API_KEY,
        model: process.env.LLM_MODEL || "openai/gpt-4o",
        baseUrl: "https://openrouter.ai/api/v1",
        providerName: "OpenRouter",
      };
    }
    const data = await res.json();
    const currentId = data.current?.id || "openrouter";
    const providerInfo = data.available?.find((p: { id?: string }) => p.id === currentId);

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
    if (!model || model === "<default>") {
      model = providerInfo?.default_model || "openai/gpt-4o";
    }

    return {
      provider: currentId,
      apiKey,
      model,
      baseUrl: providerInfo?.base_url || "https://openrouter.ai/api/v1",
      providerName:
        typeof providerInfo?.name === "string" ? providerInfo.name : undefined,
    };
  } catch {
    return {
      provider: "openrouter",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.LLM_MODEL || "openai/gpt-4o",
      baseUrl: "https://openrouter.ai/api/v1",
      providerName: "OpenRouter",
    };
  }
}

/** Direct LLM text completion — no agent tools, no image/video side effects. */
export async function generateTextOnly(
  messages: TextGenerateMessage[],
  options?: { maxOutputTokens?: number; temperature?: number },
): Promise<string> {
  const config = await getProviderConfig();
  if (!config.apiKey) {
    const label =
      config.providerName ||
      (config.provider === "alibaba" ? "阿里通义千问（DashScope）" : config.provider);
    throw new Error(
      `${label} 的 API Key 未配置。请在「设置 → 模型」中保存密钥后重试。`,
    );
  }

  let aiSdkProvider;
  if (config.provider === "openrouter") {
    aiSdkProvider = createOpenRouter({ apiKey: config.apiKey });
  } else {
    aiSdkProvider = createOpenAI({
      name: config.provider,
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  const modelConfig =
    typeof aiSdkProvider.chat === "function"
      ? aiSdkProvider.chat(config.model)
      : aiSdkProvider(config.model);

  const systemMsg = messages.find((m) => m.role === "system");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const result = await generateText({
    model: modelConfig as never,
    messages: chatMessages,
    maxOutputTokens: options?.maxOutputTokens ?? 4096,
    temperature: options?.temperature ?? 0.4,
    system: systemMsg?.content?.trim() || undefined,
  });

  return (result.text || "").trim();
}
