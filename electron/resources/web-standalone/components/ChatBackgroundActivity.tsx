"use client";

import { ClaudeCodePermissionBanner } from "@/components/ClaudeCodePermissionBanner";
import { useChatSession } from "@/contexts/ChatSessionContext";
import { useClaudeCodeSession } from "@/contexts/ClaudeCodeSessionContext";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function ChatBackgroundActivity() {
  const pathname = usePathname();
  const {
    isLoading: chatLoading,
    stopGeneration: stopChat,
    claudePermission: chatPermission,
    claudePermissionBusy: chatPermBusy,
    respondClaudePermission: respondChatPermission,
  } = useChatSession();
  const {
    state: ccState,
    cancel: cancelClaudeCode,
    respondPermission: respondCcPermission,
  } = useClaudeCodeSession();

  const onChatPage = pathname === "/";
  const onClaudeCodePage = pathname.startsWith("/claude-code");

  const chatBusyOffPage = chatLoading && !onChatPage;
  const ccBusyOffPage = ccState.running && !onClaudeCodePage;
  const chatPermOffPage = Boolean(chatPermission) && !onChatPage;
  const ccPermOffPage = Boolean(ccState.pendingPermission) && !onClaudeCodePage;

  if (!chatBusyOffPage && !ccBusyOffPage && !chatPermOffPage && !ccPermOffPage) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {chatBusyOffPage ? (
        <div className="pointer-events-auto card-surface flex items-center gap-3 rounded-xl border border-[color:var(--separator-subtle)] px-3 py-2.5 shadow-lg">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[color:var(--accent)]" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-[color:var(--foreground)]">
              对话仍在生成中
            </p>
            <Link href="/" className="text-xs text-[color:var(--accent)] hover:underline">
              返回对话页查看
            </Link>
          </div>
          <button
            type="button"
            onClick={stopChat}
            className="shrink-0 rounded-lg border border-[color:var(--separator-subtle)] px-2 py-1 text-xs font-medium"
          >
            停止
          </button>
        </div>
      ) : null}

      {ccBusyOffPage ? (
        <div className="pointer-events-auto card-surface flex items-center gap-3 rounded-xl border border-[color:var(--separator-subtle)] px-3 py-2.5 shadow-lg">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[color:var(--accent)]" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-[color:var(--foreground)]">
              Claude Code 仍在运行
            </p>
            <Link
              href="/claude-code"
              className="text-xs text-[color:var(--accent)] hover:underline"
            >
              返回 Claude Code
            </Link>
          </div>
          <button
            type="button"
            onClick={cancelClaudeCode}
            className="shrink-0 rounded-lg border border-[color:var(--separator-subtle)] px-2 py-1 text-xs font-medium"
          >
            停止
          </button>
        </div>
      ) : null}

      {chatPermOffPage ? (
        <div className="pointer-events-auto card-surface rounded-xl border border-[color:var(--separator-subtle)] p-2 shadow-lg">
          <ClaudeCodePermissionBanner
            pending={chatPermission}
            busy={chatPermBusy}
            onAllow={() => void respondChatPermission(true)}
            onDeny={() => void respondChatPermission(false)}
          />
        </div>
      ) : null}

      {ccPermOffPage ? (
        <div className="pointer-events-auto card-surface rounded-xl border border-[color:var(--separator-subtle)] p-2 shadow-lg">
          <ClaudeCodePermissionBanner
            pending={ccState.pendingPermission}
            onAllow={() => void respondCcPermission(true)}
            onDeny={() => void respondCcPermission(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
