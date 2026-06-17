"use client";

import { Loader2, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { ChatNewSessionButton } from "@/app/components/ChatNewSessionButton";
import { assistantComposerCardClass } from "@/app/components/assistantUi";
import { parseSseChunk, reduceAssistantSseEvent } from "@/app/components/assistantSse";

export function AssistantComposer({
  agentId,
  loading,
  onStreamText,
  onError,
  title = "自由对话",
  description,
  placeholder,
  hint,
  onReset,
  resetLabel = "新建对话",
  showReset = false,
}: {
  agentId: string;
  loading: boolean;
  onStreamText: (text: string) => void;
  onError: (msg: string) => void;
  title?: string;
  description: string;
  placeholder: string;
  hint?: string;
  onReset?: () => void;
  resetLabel?: string;
  showReset?: boolean;
}) {
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setStreaming(true);
    onStreamText("思考中…");
    try {
      const response = await fetch("/api/agent/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: text,
          messages: [{ role: "user", content: text }],
          agent_id: agentId,
          mode: "multi",
        }),
      });
      if (!response.ok || !response.body) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(
          (errData as { detail?: string; error?: string }).detail ||
            (errData as { error?: string }).error ||
            `Error ${response.status}`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let pendingError: string | undefined;
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        buffer = parseSseChunk(buffer, (event) => {
          const result = reduceAssistantSseEvent(event, accumulated);
          if (result.error) pendingError = result.error;
          if (result.text !== accumulated) {
            accumulated = result.text;
            onStreamText(accumulated);
          }
        });
        if (pendingError) {
          throw new Error(pendingError);
        }
      }

      if (!accumulated.trim() || accumulated.trim() === "思考中…") {
        throw new Error("未收到 Agent 回复，请检查后端服务或 LLM API Key 配置");
      }

      setInput("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "对话失败");
    } finally {
      setStreaming(false);
    }
  }, [agentId, input, onError, onStreamText, streaming]);

  return (
    <div className={assistantComposerCardClass}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-[color:var(--foreground)]">{title}</h3>
        {onReset && showReset ? (
          <ChatNewSessionButton
            onClick={onReset}
            label={resetLabel}
            variant="inline"
          />
        ) : null}
      </div>
      <p className="mb-3 text-xs text-[color:var(--label-secondary)]">{description}</p>
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          placeholder={placeholder}
          className="min-h-[72px] flex-1 resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--page-canvas)] px-3 py-2 text-sm text-[color:var(--foreground)] outline-none focus:border-[color:var(--accent)]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="button"
          disabled={streaming || loading || !input.trim()}
          onClick={() => void submit()}
          className="flex h-10 w-10 shrink-0 items-center justify-center self-end rounded-xl bg-[color:var(--accent)] text-white disabled:opacity-50"
          aria-label="发送"
        >
          {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      {hint ? (
        <p className="mt-2 text-[10px] text-[color:var(--label-tertiary)]">{hint}</p>
      ) : null}
    </div>
  );
}
