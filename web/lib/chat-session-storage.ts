import type { ChatSessionSnapshot } from "@/lib/chat-message";

export const MAIN_CHAT_SESSION_KEY = "agent.main-chat.session.v1";

export function readMainChatSession(): ChatSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MAIN_CHAT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatSessionSnapshot;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return {
      messages: parsed.messages,
      input: typeof parsed.input === "string" ? parsed.input : "",
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeMainChatSession(snapshot: ChatSessionSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(MAIN_CHAT_SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota or private mode */
  }
}

export function clearMainChatSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(MAIN_CHAT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
