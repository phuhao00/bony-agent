"use client";

import type { ChatMessage } from "@/lib/chat-message";
import {
  clearMainChatSession,
  readMainChatSession,
  writeMainChatSession,
} from "@/lib/chat-session-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

export type ClaudePermissionPending = {
  permission_id: string;
  tool_name?: string;
  title?: string;
  description?: string;
} | null;

type ChatSessionContextValue = {
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  clearSession: () => void;
  /** Increments whenever clearSession runs; use to reset page-local chat UI. */
  sessionEpoch: number;
  hydrated: boolean;
  isLoading: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  abortRef: MutableRefObject<AbortController | null>;
  stopGeneration: () => void;
  claudePermission: ClaudePermissionPending;
  setClaudePermission: Dispatch<SetStateAction<ClaudePermissionPending>>;
  claudePermissionBusy: boolean;
  setClaudePermissionBusy: Dispatch<SetStateAction<boolean>>;
  respondClaudePermission: (allow: boolean) => Promise<void>;
};

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

export function ChatSessionProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [claudePermission, setClaudePermission] =
    useState<ClaudePermissionPending>(null);
  const [claudePermissionBusy, setClaudePermissionBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const claudePermissionRef = useRef<ClaudePermissionPending>(null);

  useEffect(() => {
    claudePermissionRef.current = claudePermission;
  }, [claudePermission]);

  useEffect(() => {
    const saved = readMainChatSession();
    if (saved) {
      setMessages(saved.messages);
      setInput(saved.input);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (messages.length === 0 && !input.trim() && !isLoading) {
        clearMainChatSession();
        return;
      }
      writeMainChatSession({
        messages,
        input,
        updatedAt: new Date().toISOString(),
      });
    }, 300);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, input, hydrated, isLoading]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
  }, []);

  const respondClaudePermission = useCallback(async (allow: boolean) => {
    const pending = claudePermissionRef.current;
    if (!pending?.permission_id) return;
    setClaudePermissionBusy(true);
    try {
      await fetch("/api/claude-code/permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permission_id: pending.permission_id,
          allow,
          message: allow ? "" : "用户拒绝",
        }),
      });
      setClaudePermission(null);
    } finally {
      setClaudePermissionBusy(false);
    }
  }, []);

  const clearSession = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setClaudePermission(null);
    setClaudePermissionBusy(false);
    setMessages([]);
    setInput("");
    clearMainChatSession();
    setSessionEpoch((epoch) => epoch + 1);
  }, []);

  return (
    <ChatSessionContext.Provider
      value={{
        messages,
        setMessages,
        input,
        setInput,
        clearSession,
        sessionEpoch,
        hydrated,
        isLoading,
        setIsLoading,
        abortRef,
        stopGeneration,
        claudePermission,
        setClaudePermission,
        claudePermissionBusy,
        setClaudePermissionBusy,
        respondClaudePermission,
      }}
    >
      {children}
    </ChatSessionContext.Provider>
  );
}

export function useChatSession(): ChatSessionContextValue {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) {
    throw new Error("useChatSession must be used within ChatSessionProvider");
  }
  return ctx;
}
