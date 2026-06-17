"use client";

import { ShieldCheck } from "lucide-react";

export function ProgrammerApprovalCard({
  approvalId,
  taskId,
  command,
  onApprove,
  loading,
}: {
  approvalId: string;
  taskId: string;
  command?: string;
  onApprove: (approvalId: string, taskId: string) => void;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <ShieldCheck className="h-4 w-4" />
        需要审批后继续执行
      </div>
      {command ? (
        <pre className="mb-3 overflow-x-auto rounded-lg bg-[var(--page-canvas)] p-2 text-xs text-[color:var(--foreground)]">
          {command}
        </pre>
      ) : null}
      <button
        type="button"
        disabled={loading}
        onClick={() => onApprove(approvalId, taskId)}
        className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        批准并执行
      </button>
    </div>
  );
}
