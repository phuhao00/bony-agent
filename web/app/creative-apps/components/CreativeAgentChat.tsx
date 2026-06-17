"use client";

import { useTranslation } from "@/hooks/useTranslation";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

export type ChatMessageRole = "user" | "assistant" | "thinking" | "error";

export interface ApprovalInfo {
  taskId?: string;
  approvalId?: string;
  capabilityId?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  approval?: ApprovalInfo;
  approvalStatus?: "pending" | "approved" | "denied";
}

interface CreativeAgentChatProps {
  appName: string;
  logo: string;
  messages: ChatMessage[];
  onApprove?: (info: ApprovalInfo, messageId: string) => void;
  onDeny?: (info: ApprovalInfo, messageId: string) => void;
}

function extractApprovalInfo(content: string): ApprovalInfo {
  const taskMatch = content.match(/task[`'"]*\s*[:=]?\s*[`'"]*([a-f0-9-]{8,})/i);
  const approvalMatch = content.match(/approval[`'"]*\s*[:=]?\s*[`'"]*([a-f0-9-]{8,})/i);
  const idMatch = content.match(/(?:批准任务|审批|approval).*?([a-f0-9-]{36})/i);
  return {
    taskId: taskMatch?.[1] || idMatch?.[1] || undefined,
    approvalId: approvalMatch?.[1] || idMatch?.[1] || undefined,
  };
}

export function CreativeAgentChat({ appName, logo, messages, onApprove, onDeny }: CreativeAgentChatProps) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const isEmpty = messages.length === 0;

  const enrichedMessages = useMemo(() => {
    return messages.map((msg) => {
      if (msg.role !== "assistant" || msg.approval || msg.approvalStatus) return msg;
      const info = extractApprovalInfo(msg.content);
      if (info.taskId || info.approvalId) {
        return { ...msg, approval: info };
      }
      return msg;
    });
  }, [messages]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-8">
      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--card-bg)] shadow-sm">
            <img src={logo} alt={appName} className="h-9 w-9 object-contain" />
          </div>
          <h2 className="mb-1 text-lg font-semibold text-[color:var(--foreground)]">
            {t("creativeAgent.emptyTitle", { app: appName })}
          </h2>
          <p className="max-w-sm text-[13px] leading-relaxed text-[color:var(--label-secondary)]">
            {t("creativeAgent.emptySubtitle", { app: appName })}
          </p>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-3xl space-y-5">
          {enrichedMessages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-[20px] rounded-tr-md bg-[color:var(--accent)] px-4 py-2.5 text-[14px] leading-relaxed text-white">
                    {msg.content}
                  </div>
                </div>
              );
            }

            if (msg.role === "thinking") {
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className="flex max-w-[85%] items-center gap-2 rounded-[20px] rounded-tl-md border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-4 py-2.5 text-[14px] leading-relaxed text-[color:var(--label-secondary)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("creativeAgent.thinking")}
                  </div>
                </div>
              );
            }

            if (msg.role === "error") {
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className="max-w-[85%] rounded-[20px] rounded-tl-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-2.5 text-[14px] leading-relaxed text-[var(--status-danger-text)]">
                    {msg.content}
                  </div>
                </div>
              );
            }

            const showApproval = msg.approval && msg.approvalStatus !== "approved" && msg.approvalStatus !== "denied";

            return (
              <div key={msg.id} className="flex justify-start gap-3">
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--card-bg)] shadow-sm">
                  <Sparkles className="h-3.5 w-3.5 text-[color:var(--accent)]" />
                </div>
                <div className="max-w-[85%] space-y-2">
                  <div className="rounded-[20px] rounded-tl-md border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-4 py-2.5 text-[14px] leading-relaxed text-[color:var(--foreground)] whitespace-pre-wrap">
                    {msg.content}
                  </div>
                  {showApproval && onApprove && onDeny && (
                    <div className="flex items-center gap-2 rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2">
                      <span className="text-[12px] text-[color:var(--label-secondary)]">
                        {t("creativeAgent.approvalPrompt")}
                      </span>
                      <button
                        type="button"
                        onClick={() => onApprove(msg.approval!, msg.id)}
                        className="inline-flex items-center gap-1 rounded-full bg-[color:var(--accent)] px-3 py-1 text-[12px] font-medium text-white hover:opacity-90"
                      >
                        <Check className="h-3 w-3" />
                        {t("creativeAgent.approve")}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeny(msg.approval!, msg.id)}
                        className="inline-flex items-center gap-1 rounded-full border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] px-3 py-1 text-[12px] font-medium text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]/80"
                      >
                        <X className="h-3 w-3" />
                        {t("creativeAgent.deny")}
                      </button>
                    </div>
                  )}
                  {msg.approvalStatus === "approved" && (
                    <div className="text-[12px] text-[var(--status-success-text)]">
                      {t("creativeAgent.approved")}
                    </div>
                  )}
                  {msg.approvalStatus === "denied" && (
                    <div className="text-[12px] text-[var(--status-danger-text)]">
                      {t("creativeAgent.denied")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
