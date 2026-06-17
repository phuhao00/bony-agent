"use client";

import { Terminal } from "lucide-react";
import { AssistantMarkdownPreview } from "@/app/components/AssistantMarkdownPreview";
import type { ProgrammerTask } from "../hooks/useProgrammerRunner";
import { ProgrammerApprovalCard } from "./ProgrammerApprovalCard";

function extractReport(task: ProgrammerTask | null, lastResult: unknown): string {
  const fromTask = (task?.result as { report?: unknown } | undefined)?.report;
  if (typeof fromTask === "string" && fromTask.trim()) return fromTask;
  const fromLast = (lastResult as { result?: { report?: string } })?.result?.report;
  return typeof fromLast === "string" ? fromLast : "";
}

export function ProgrammerResultPanel({
  task,
  streamText,
  lastResult,
  loading,
  onApprove,
}: {
  task: ProgrammerTask | null;
  streamText: string;
  lastResult: unknown;
  loading: boolean;
  onApprove: (approvalId: string, taskId: string) => void;
}) {
  const meta = task?.metadata as Record<string, unknown> | undefined;
  const approvalId = meta?.last_approval_id as string | undefined;
  const pendingCommand = meta?.pending_command as string | undefined;
  const report = extractReport(task, lastResult);

  const approvalBlock =
    task?.status === "waiting_approval" && approvalId && task.id ? (
      <ProgrammerApprovalCard
        approvalId={approvalId}
        taskId={task.id}
        command={pendingCommand}
        onApprove={onApprove}
        loading={loading}
      />
    ) : null;

  const jsonBlock =
    task?.result && !report ? (
      <pre className="overflow-auto rounded-2xl bg-[var(--page-canvas)] p-4 text-xs text-[color:var(--foreground)]">
        {JSON.stringify(task.result, null, 2)}
      </pre>
    ) : null;

  const lastResultBlock =
    lastResult && !task && !streamText ? (
      <pre className="overflow-auto rounded-2xl bg-[var(--page-canvas)] p-4 text-xs">
        {JSON.stringify(lastResult, null, 2)}
      </pre>
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] bg-[var(--card-surface)] shadow-sm ring-1 ring-[var(--border-subtle)]">
      {!task && !streamText && !lastResult ? (
        <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-b from-[var(--nav-active-fill)] to-[var(--page-canvas)]">
            <Terminal className="h-9 w-9 text-[color:var(--label-tertiary)]" strokeWidth={1.25} />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
            运维与开发输出
          </h2>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[color:var(--label-secondary)]">
            在左侧选择 Git、中间件或开发任务，点「开始执行」。结果与审批请求会显示在这里。
          </p>
        </div>
      ) : (
        <>
          <header className="shrink-0 border-b border-[var(--border-subtle)] px-5 py-4 sm:px-8">
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)]">
              {task?.status === "waiting_approval" ? "等待审批" : "执行结果"}
            </h1>
            {task?.message ? (
              <p className="mt-1.5 text-sm text-[color:var(--label-secondary)]">{task.message}</p>
            ) : null}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8 sm:py-8 space-y-4">
            {approvalBlock}
            {report ? (
              <AssistantMarkdownPreview markdown={report} loading={loading} />
            ) : null}
            {jsonBlock}
            {streamText ? (
              <section className={report || jsonBlock ? "border-t border-[var(--border-subtle)] pt-6" : ""}>
                <AssistantMarkdownPreview markdown={streamText} loading={loading} />
              </section>
            ) : null}
            {lastResultBlock}
          </div>
        </>
      )}
    </div>
  );
}
