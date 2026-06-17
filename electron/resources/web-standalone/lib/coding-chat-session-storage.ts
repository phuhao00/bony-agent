import type { CodingChatMessage } from "@/app/claude-code/lib/types";

export const CODING_CHAT_SESSION_KEY = "agent.claude-code.session.v1";

export type CodingChatSessionSnapshot = {
  messages: CodingChatMessage[];
  sessionId: string | null;
  updatedAt: string;
};

export function readCodingChatSession(): CodingChatSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CODING_CHAT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CodingChatSessionSnapshot;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return {
      messages: parsed.messages.map((m) => ({ ...m, streaming: false })),
      sessionId:
        typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeCodingChatSession(
  snapshot: CodingChatSessionSnapshot,
): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CODING_CHAT_SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
}

export function clearCodingChatSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(CODING_CHAT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
