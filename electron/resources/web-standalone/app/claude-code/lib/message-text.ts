/** Extract human-readable text from Claude Agent SDK serialized messages. */

type ContentBlock = Record<string, unknown>;

function blockText(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  const b = block as ContentBlock;
  if (typeof b.text === "string" && b.text.trim()) return b.text;
  if (typeof b.thinking === "string" && b.thinking.trim()) return b.thinking;
  if (b.type === "text" && typeof b.text === "string") return b.text;
  return "";
}

export function extractMessageText(payload?: Record<string, unknown>): string {
  if (!payload) return "";

  if (typeof payload.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }

  const content = payload.content;
  if (typeof content === "string" && content.trim()) return content.trim();

  if (Array.isArray(content)) {
    return content
      .map(blockText)
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof payload.result === "string" && payload.result.trim()) {
    return payload.result.trim();
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  return "";
}

export function messageType(payload?: Record<string, unknown>): string {
  return String(payload?._type || payload?.type || "message");
}
