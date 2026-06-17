/** Extracted chat composer toolbar for the main conversation page. */

"use client";

import { ArrowUp, Mic, MicOff, SlidersHorizontal, Square } from "lucide-react";
import type { RefObject } from "react";

import type { MultimodalInputHandle } from "@/components/MultimodalInput";

type Props = {
  inputRef: RefObject<MultimodalInputHandle | null>;
  isRecording: boolean;
  isStreaming: boolean;
  onToggleRecording: () => void;
  onStop: () => void;
  onSend: () => void;
  onOpenPrefs: () => void;
  sendDisabled?: boolean;
};

export function ChatComposerBar({
  isRecording,
  isStreaming,
  onToggleRecording,
  onStop,
  onSend,
  onOpenPrefs,
  sendDisabled,
}: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onOpenPrefs}
        className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
        aria-label="对话偏好"
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onToggleRecording}
        className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
        aria-label={isRecording ? "停止录音" : "语音输入"}
      >
        {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="rounded-full bg-[var(--destructive)] p-2.5 text-white"
          aria-label="停止生成"
        >
          <Square className="h-4 w-4 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onSend}
          disabled={sendDisabled}
          className="rounded-full bg-[var(--primary)] p-2.5 text-[var(--primary-foreground)] disabled:opacity-40"
          aria-label="发送"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
