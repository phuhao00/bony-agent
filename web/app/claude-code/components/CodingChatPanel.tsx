"use client";

import { MarkdownSummaryPreview } from "@/components/MarkdownSummaryPreview";
import { Loader2, MessageSquarePlus, Send, Sparkles, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  filterSlashCommands,
  isCompleteSlashInput,
  parseSlashInput,
  slashCommandRunsOnPick,
  sortSlashCommands,
  type SlashCommandDef,
} from "../lib/slash-commands";
import { scopeSummary, type CodingScope } from "../lib/scope";
import type { CodingChatMessage } from "../lib/types";
import { SlashCommandPalette } from "./SlashCommandPalette";

type CodingChatPanelProps = {
  messages: CodingChatMessage[];
  prompt: string;
  onPromptChange: (v: string) => void;
  running: boolean;
  disabled: boolean;
  scope: CodingScope;
  workspaceRoot: string | null;
  slashCommands: SlashCommandDef[];
  onSend: () => void;
  onExecuteSlash?: (text: string) => void;
  onCancel: () => void;
  onNewChat: () => void;
};

const PLACEHOLDERS: Record<CodingScope["type"], string> = {
  workspace: "继续对话，或输入 / 唤起命令…",
  project: "在此项目范围内继续对话，输入 / 命令…",
  folder: "在此文件夹范围内继续对话，输入 / 命令…",
  file: "针对已选文件继续提问，输入 / 命令…",
};

function isStopSlashCommand(text: string): boolean {
  return /^\/(stop|cancel)(\s|$)/i.test(text.trim());
}

export function CodingChatPanel({
  messages,
  prompt,
  onPromptChange,
  running,
  disabled,
  scope,
  workspaceRoot,
  slashCommands,
  onSend,
  onExecuteSlash,
  onCancel,
  onNewChat,
}: CodingChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [menuActiveIndex, setMenuActiveIndex] = useState(0);

  const slashState = useMemo(() => parseSlashInput(prompt), [prompt]);
  const showSlashMenu = useMemo(() => {
    if (!slashState.isSlash) return false;
    const trimmed = prompt.trimStart();
    const body = trimmed.slice(1);
    return body.length === 0 || !body.includes(" ");
  }, [prompt, slashState.isSlash]);

  const filteredCommands = useMemo(
    () => sortSlashCommands(filterSlashCommands(slashCommands, slashState.commandQuery)),
    [slashCommands, slashState.commandQuery],
  );

  useEffect(() => {
    setMenuActiveIndex(0);
  }, [slashState.commandQuery, showSlashMenu]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, running]);

  const resizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    resizeInput();
  }, [prompt, resizeInput]);

  const canSubmit = useMemo(() => {
    const text = prompt.trim();
    if (!text) return false;
    if (isStopSlashCommand(text)) return true;
    if (running) return false;
    return !disabled;
  }, [disabled, prompt, running]);

  const applySlashCommand = useCallback(
    (cmd: SlashCommandDef) => {
      const suffix = cmd.argumentHint ? " " : "";
      onPromptChange(`/${cmd.name}${suffix}`);
      setMenuActiveIndex(0);
      inputRef.current?.focus();
    },
    [onPromptChange],
  );

  const pickSlashCommand = useCallback(
    (cmd: SlashCommandDef) => {
      if (slashCommandRunsOnPick(cmd) && onExecuteSlash) {
        onExecuteSlash(`/${cmd.name}`);
        return;
      }
      applySlashCommand(cmd);
    },
    [applySlashCommand, onExecuteSlash],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && filteredCommands.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuActiveIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuActiveIndex(
          (i) => (i - 1 + filteredCommands.length) % filteredCommands.length,
        );
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        pickSlashCommand(filteredCommands[menuActiveIndex]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onPromptChange("");
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isCompleteSlashInput(slashCommands, prompt)) {
        if (canSubmit) onSend();
        return;
      }
      if (showSlashMenu && filteredCommands.length) {
        pickSlashCommand(filteredCommands[menuActiveIndex]!);
        return;
      }
      if (canSubmit) onSend();
    }
  };

  const footerHint = useMemo(() => {
    if (slashState.isShell) return "Shell 模式 · Enter 发送";
    if (showSlashMenu) return "↑↓ 选择 · Enter 执行 · Tab 填入参数 · Esc 关闭";
    return "Enter 发送 · Shift+Enter 换行 · / 命令 · ! Shell";
  }, [showSlashMenu, slashState.isShell]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--foreground)]">
          <Sparkles className="h-3 w-3 shrink-0 text-[color:var(--accent)]" strokeWidth={2} />
          <span className="truncate">{scopeSummary(scope, workspaceRoot)}</span>
        </span>
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={onNewChat}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[color:var(--separator-subtle)] px-2 py-1 text-[10px] font-semibold text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
          >
            <MessageSquarePlus className="h-3 w-3" />
            新对话
          </button>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-3 py-3 sm:px-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-[color:var(--foreground)]">
              像聊天一样继续追问
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-[color:var(--label-secondary)]">
              左侧选文件或文件夹限定范围，在下方输入任务。输入 <code className="font-mono">/</code>{" "}
              可唤起 Claude Code 斜杠命令。
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>

      <div className="relative mt-2 shrink-0 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] shadow-sm transition focus-within:ring-2 focus-within:ring-[color:rgba(255,149,0,0.2)]">
        {showSlashMenu ? (
          <SlashCommandPalette
            commands={filteredCommands}
            activeIndex={menuActiveIndex}
            onPick={pickSlashCommand}
            onHover={setMenuActiveIndex}
          />
        ) : null}
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={PLACEHOLDERS[scope.type]}
          className="max-h-[120px] min-h-[44px] w-full resize-none rounded-t-xl bg-transparent px-3 py-2.5 text-sm leading-relaxed text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--label-secondary)]"
        />
        <div className="flex items-center justify-between gap-2 border-t border-[color:var(--separator-subtle)] px-2.5 py-1.5">
          <span className="text-[10px] text-[color:var(--label-secondary)]">{footerHint}</span>
          <div className="flex gap-1.5">
            {running ? (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--separator-subtle)] px-2.5 py-1.5 text-xs font-semibold"
              >
                <Square className="h-3.5 w-3.5" />
                停止
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canSubmit}
              onClick={onSend}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--accent)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-45"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {running ? "回复中" : "发送"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: CodingChatMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[color:var(--accent)] px-3.5 py-2.5 text-sm leading-relaxed text-white">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3.5 py-2.5">
        {message.streaming && !message.content ? (
          <div className="flex items-center gap-2 text-xs text-[color:var(--label-secondary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            思考中…
          </div>
        ) : message.content ? (
          <MarkdownSummaryPreview markdown={message.content} />
        ) : (
          <span className="text-xs text-[color:var(--label-secondary)]">（空回复）</span>
        )}
        {message.streaming && message.content ? (
          <span className="mt-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[color:var(--accent)]" />
        ) : null}
      </div>
    </div>
  );
}
