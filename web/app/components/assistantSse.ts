export function parseSseChunk(
  buffer: string,
  onEvent: (event: Record<string, unknown>) => void,
): string {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() || "";
  for (const part of parts) {
    const lines = part.split("\n");
    let dataLine = "";
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLine += line.slice(5).trim();
      }
    }
    if (!dataLine) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataLine) as Record<string, unknown>;
    } catch {
      continue;
    }
    onEvent(parsed);
  }
  return rest;
}

export type AssistantSseReduceResult = {
  text: string;
  error?: string;
};

export function reduceAssistantSseEvent(
  event: Record<string, unknown>,
  accumulated: string,
): AssistantSseReduceResult {
  const type = event.type as string | undefined;

  if (type === "token" && typeof event.content === "string") {
    return { text: accumulated + event.content };
  }

  if (type === "message" && typeof event.content === "string") {
    return { text: event.content };
  }

  if (type === "final" && typeof event.response === "string") {
    const response = event.response.trim();
    return { text: response || accumulated };
  }

  if (type === "agent_result" && typeof event.content === "string") {
    const content = event.content.trim();
    if (!content) return { text: accumulated };
    return { text: accumulated ? `${accumulated}\n\n${content}` : content };
  }

  if (type === "decision") {
    return { text: accumulated || "正在分析请求，路由到合适的 Agent…" };
  }

  if (type === "tool_start") {
    return { text: accumulated || "正在调用工具，请稍候…" };
  }

  if (type === "start" && !accumulated) {
    return { text: "思考中…" };
  }

  if (type === "error") {
    return {
      text: accumulated,
      error: String(
        event.detail || event.message || event.content || event.error || "对话失败",
      ),
    };
  }

  return { text: accumulated };
}
