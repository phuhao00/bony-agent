"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearCodingChatSession,
  readCodingChatSession,
  writeCodingChatSession,
} from "@/lib/coding-chat-session-storage";
import { extractMessageText, messageType } from "../lib/message-text";
import type { CodingScope } from "../lib/scope";
import type {
  ClaudeCodeRunState,
  ClaudeCodeSseEvent,
  ClaudeCodeTimelineItem,
  CodingChatMessage,
} from "../lib/types";

function parseSse(buffer: string, onEvent: (e: ClaudeCodeSseEvent) => void): string {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() || "";
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => l.slice(6));
    if (!lines.length) continue;
    try {
      onEvent(JSON.parse(lines.join("\n")) as ClaudeCodeSseEvent);
    } catch {
      /* ignore */
    }
  }
  return rest;
}

function messageTitle(payload?: Record<string, unknown>): string {
  const text = extractMessageText(payload);
  if (text) return text.slice(0, 120);
  if (!payload) return "Claude Code 消息";
  return messageType(payload);
}

export function useClaudeCodeRunner() {
  const [state, setState] = useState<ClaudeCodeRunState>(() => ({
    running: false,
    error: "",
    runId: "",
    cwd: "",
    sessionId: null,
    messages: [],
    timeline: [],
    finalResponse: "",
    pendingPermission: null,
  }));
  const abortRef = useRef<AbortController | null>(null);
  const timelineRef = useRef<ClaudeCodeTimelineItem[]>([]);
  const timelineFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assistantTextRef = useRef("");
  const sessionIdRef = useRef<string | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const saved = readCodingChatSession();
    if (saved && saved.messages.length > 0) {
      sessionIdRef.current = saved.sessionId;
      setState((s) => ({
        ...s,
        sessionId: saved.sessionId,
        messages: saved.messages,
        finalResponse:
          saved.messages.filter((m) => m.role === "assistant").at(-1)?.content ||
          "",
      }));
    }
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (state.messages.length === 0 && !state.sessionId) {
        clearCodingChatSession();
        return;
      }
      writeCodingChatSession({
        messages: state.messages.map((m) => ({ ...m, streaming: false })),
        sessionId: state.sessionId,
        updatedAt: new Date().toISOString(),
      });
    }, 300);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state.messages, state.sessionId]);

  const flushTimeline = useCallback(() => {
    if (timelineFlushRef.current != null) {
      clearTimeout(timelineFlushRef.current);
      timelineFlushRef.current = null;
    }
    setState((s) => ({ ...s, timeline: [...timelineRef.current] }));
  }, []);

  const pushTimeline = useCallback(
    (item: ClaudeCodeTimelineItem) => {
      timelineRef.current.push(item);
      if (timelineFlushRef.current == null) {
        timelineFlushRef.current = setTimeout(() => {
          timelineFlushRef.current = null;
          flushTimeline();
        }, 200);
      }
    },
    [flushTimeline],
  );

  const updateAssistantMessage = useCallback((content: string, streaming: boolean) => {
    const id = activeAssistantIdRef.current;
    if (!id) return;
    setState((s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content, streaming } : m,
      ),
      finalResponse: content,
    }));
  }, []);

  const appendAssistantText = useCallback(
    (text: string) => {
      const chunk = text.trim();
      if (!chunk) return;
      const prev = assistantTextRef.current;
      assistantTextRef.current = prev ? `${prev}\n${chunk}` : chunk;
      updateAssistantMessage(assistantTextRef.current, true);
    },
    [updateAssistantMessage],
  );

  const captureSessionId = useCallback((sid?: string) => {
    const next = sid?.trim();
    if (!next) return;
    sessionIdRef.current = next;
    setState((s) => ({ ...s, sessionId: next }));
  }, []);

  const run = useCallback(
    async (
      prompt: string,
      options?: {
        workspaceRoot?: string;
        scope?: CodingScope;
      },
    ) => {
      const text = prompt.trim();
      if (!text) return;

      const scope = options?.scope;
      const workspaceRoot = options?.workspaceRoot?.trim() || undefined;
      const scopeType = scope?.type || "workspace";
      const scopePath =
        scopeType === "workspace"
          ? undefined
          : scope?.relPath?.trim() || undefined;

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      assistantTextRef.current = "";
      const userId = `user-${Date.now()}`;
      const assistantId = `asst-${Date.now()}`;
      activeAssistantIdRef.current = assistantId;

      const userMsg: CodingChatMessage = {
        id: userId,
        role: "user",
        content: text,
        at: Date.now(),
      };
      const assistantMsg: CodingChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        at: Date.now(),
        streaming: true,
      };

      setState((s) => ({
        ...s,
        running: true,
        error: "",
        messages: [...s.messages, userMsg, assistantMsg],
        finalResponse: "",
        pendingPermission: null,
      }));

      try {
        const res = await fetch("/api/claude-code/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            workspace_root: workspaceRoot,
            scope_type: scopeType,
            scope_path: scopePath,
            scope_label: scope?.label,
            session_id: sessionIdRef.current || undefined,
          }),
          signal: ac.signal,
        });

        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            (err as { detail?: string; error?: string }).detail ||
              (err as { error?: string }).error ||
              `HTTP ${res.status}`,
          );
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;

        while (!done) {
          const { value, done: dr } = await reader.read();
          done = dr;
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
          buffer = parseSse(buffer, (event) => {
            if (event.type === "start") {
              captureSessionId(event.session_id);
              setState((s) => ({
                ...s,
                runId: event.run_id || s.runId,
                cwd: event.cwd || s.cwd,
              }));
              pushTimeline({
                id: `start-${Date.now()}`,
                kind: "start",
                title: "开始执行",
                detail: event.cwd,
                at: Date.now(),
              });
              return;
            }

            if (event.type === "permission_request" && event.permission_id) {
              setState((s) => ({
                ...s,
                pendingPermission: {
                  permission_id: event.permission_id!,
                  tool_name: event.tool_name,
                  title: event.title,
                  description: event.description,
                },
              }));
              pushTimeline({
                id: event.permission_id,
                kind: "permission",
                title: event.title || event.tool_name || "等待审批",
                detail: event.description,
                at: Date.now(),
              });
              return;
            }

            if (event.type === "message") {
              captureSessionId(event.session_id);
              const payload = event.payload;
              const msgText =
                (typeof event.text === "string" && event.text) ||
                extractMessageText(payload);
              const msgKind = messageType(payload);

              pushTimeline({
                id: `msg-${Date.now()}-${Math.random()}`,
                kind: "message",
                title: messageTitle(payload),
                detail: msgText || JSON.stringify(payload || {}).slice(0, 400),
                at: Date.now(),
              });

              if (msgText && msgKind === "AssistantMessage") {
                appendAssistantText(msgText);
              }
              return;
            }

            if (event.type === "final") {
              captureSessionId(event.session_id);
              const finalText =
                (typeof event.response === "string" && event.response.trim()) ||
                assistantTextRef.current;
              if (finalText) {
                assistantTextRef.current = finalText;
              }
              updateAssistantMessage(
                assistantTextRef.current || "（无文本回复）",
                false,
              );
              setState((s) => ({
                ...s,
                pendingPermission: null,
              }));
              pushTimeline({
                id: `final-${Date.now()}`,
                kind: "final",
                title: "完成",
                at: Date.now(),
              });
              flushTimeline();
              return;
            }

            if (event.type === "error") {
              const detail = event.detail || "未知错误";
              setState((s) => ({ ...s, error: detail }));
              updateAssistantMessage(`错误：${detail}`, false);
              pushTimeline({
                id: `err-${Date.now()}`,
                kind: "error",
                title: detail,
                at: Date.now(),
              });
              flushTimeline();
            }
          });
        }
        flushTimeline();
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") {
          setState((s) => ({ ...s, error: "已取消" }));
          updateAssistantMessage("（已停止）", false);
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          setState((s) => ({ ...s, error: msg }));
          updateAssistantMessage(`错误：${msg}`, false);
        }
        flushTimeline();
      } finally {
        activeAssistantIdRef.current = null;
        setState((s) => ({ ...s, running: false, pendingPermission: null }));
        abortRef.current = null;
      }
    },
    [
      appendAssistantText,
      captureSessionId,
      flushTimeline,
      pushTimeline,
      updateAssistantMessage,
    ],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const resetConversation = useCallback(() => {
    abortRef.current?.abort();
    sessionIdRef.current = null;
    activeAssistantIdRef.current = null;
    localAssistantIdRef.current = null;
    assistantTextRef.current = "";
    timelineRef.current = [];
    if (timelineFlushRef.current != null) {
      clearTimeout(timelineFlushRef.current);
      timelineFlushRef.current = null;
    }
    clearCodingChatSession();
    setState({
      running: false,
      error: "",
      runId: "",
      cwd: "",
      sessionId: null,
      messages: [],
      timeline: [],
      finalResponse: "",
      pendingPermission: null,
    });
  }, []);

  const localAssistantIdRef = useRef<string | null>(null);

  const replyLocally = useCallback((userText: string, assistantText: string) => {
    const at = Date.now();
    const userMsg: CodingChatMessage = {
      id: `user-${at}`,
      role: "user",
      content: userText,
      at,
    };
    const assistantMsg: CodingChatMessage = {
      id: `asst-${at}`,
      role: "assistant",
      content: assistantText,
      at,
    };
    setState((s) => ({
      ...s,
      messages: [...s.messages, userMsg, assistantMsg],
      finalResponse: assistantText,
    }));
  }, []);

  const startLocalExchange = useCallback((userText: string, statusText = "处理中…") => {
    const at = Date.now();
    const assistantId = `asst-${at}`;
    localAssistantIdRef.current = assistantId;
    setState((s) => ({
      ...s,
      running: true,
      error: "",
      messages: [
        ...s.messages,
        { id: `user-${at}`, role: "user", content: userText, at },
        {
          id: assistantId,
          role: "assistant",
          content: statusText,
          at,
          streaming: true,
        },
      ],
    }));
  }, []);

  const updateLocalExchange = useCallback((content: string) => {
    const id = localAssistantIdRef.current;
    if (!id) return;
    setState((s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content, streaming: true } : m,
      ),
      finalResponse: content,
    }));
  }, []);

  const finishLocalExchange = useCallback((content: string) => {
    const id = localAssistantIdRef.current;
    localAssistantIdRef.current = null;
    setState((s) => ({
      ...s,
      running: false,
      messages: id
        ? s.messages.map((m) =>
            m.id === id ? { ...m, content, streaming: false } : m,
          )
        : s.messages,
      finalResponse: content,
    }));
  }, []);

  const respondPermission = useCallback(async (allow: boolean) => {
    const pid = state.pendingPermission?.permission_id;
    if (!pid) return;
    await fetch("/api/claude-code/permission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        permission_id: pid,
        allow,
        message: allow ? "" : "用户拒绝",
      }),
    });
    setState((s) => ({ ...s, pendingPermission: null }));
  }, [state.pendingPermission]);

  return {
    state,
    run,
    cancel,
    resetConversation,
    replyLocally,
    startLocalExchange,
    updateLocalExchange,
    finishLocalExchange,
    respondPermission,
    setState,
  };
}
