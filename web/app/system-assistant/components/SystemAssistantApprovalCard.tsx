"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type ApprovalInfo = {
  id?: string;
  proposed_action?: string;
  capability_id?: string;
  risk_level?: string;
};

export function SystemAssistantApprovalCard({
  taskId,
  command,
  approval,
  onApprove,
  onDeny,
}: {
  taskId?: string;
  command?: string | null;
  approval?: ApprovalInfo | null;
  onApprove: () => Promise<void>;
  onDeny: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);

  if (!approval?.id) return null;

  return (
    <div className="mb-4 rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--nav-active-fill)] p-4 text-sm text-[color:var(--foreground)]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
          <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">操作等待审批</h2>
          <p className="mt-1 text-xs leading-relaxed text-[color:var(--label-secondary)]">
            {approval.proposed_action || "System Assistant 操作"}
            {approval.capability_id ? ` · ${approval.capability_id}` : ""}
            {approval.risk_level ? ` · 风险 ${approval.risk_level}` : ""}
            {taskId ? ` · task ${taskId.slice(0, 8)}` : ""}
          </p>
          {command && (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--card-bg)] px-3 py-2 font-mono text-[11px]">
              {command}
            </pre>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setBusy("approve");
                void onApprove().finally(() => setBusy(null));
              }}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
            >
              {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              批准并继续
            </button>
            <button
              type="button"
              onClick={() => {
                setBusy("deny");
                void onDeny().finally(() => setBusy(null));
              }}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
            >
              {busy === "deny" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              拒绝
            </button>
            <Link
              href="/settings/capabilities?tab=approvals"
              className="inline-flex items-center rounded-xl px-3 py-2 text-xs text-[color:var(--label-secondary)] hover:text-[color:var(--accent)] hover:underline"
            >
              在审批中心查看
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
