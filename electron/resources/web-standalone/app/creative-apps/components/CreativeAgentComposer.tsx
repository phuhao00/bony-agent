"use client";

import { useTranslation } from "@/hooks/useTranslation";
import { ArrowUp, Loader2, Plus } from "lucide-react";
import { useCallback, useState } from "react";

interface CreativeAgentComposerProps {
  placeholder: string;
  streaming: boolean;
  showReset: boolean;
  onSend: (text: string) => void;
  onReset: () => void;
}

export function CreativeAgentComposer({
  placeholder,
  streaming,
  showReset,
  onSend,
  onReset,
}: CreativeAgentComposerProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    onSend(text);
    setInput("");
  }, [input, onSend, streaming]);

  return (
    <div className="border-t border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] p-3 sm:p-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-2 shadow-sm transition-shadow focus-within:shadow-md">
        {showReset && (
          <button
            type="button"
            onClick={onReset}
            className="mb-2 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
            aria-label={t("creativeAgent.newChat")}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={1}
          placeholder={placeholder}
          disabled={streaming}
          className="max-h-[160px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--label-secondary)]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="button"
          disabled={streaming || !input.trim()}
          onClick={submit}
          className="mb-1 mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          aria-label={t("creativeAgent.send")}
        >
          {streaming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-[color:var(--label-secondary)]">
        {t("creativeAgent.composerHint")}
      </p>
    </div>
  );
}
