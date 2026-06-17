"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { ComputerUseApproval, ComputerUseResult } from "../lib/types";

export function ComputerUseApprovalCard({
  result,
  onApproved,
  onDenied,
}: {
  result: ComputerUseResult;
  onApproved: () => Promise<void>;
  onDenied: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const approval = result.approval;

  if (result.status !== "waiting_approval" || !result.requires_approval) {
    return null;
  }

  const handleApprove = async () => {
    if (!approval?.id) return;
    setBusy("approve");
    try {
      await onApproved();
    } finally {
      setBusy(null);
    }
  };

  const handleDeny = async () => {
    if (!approval?.id) return;
    setBusy("deny");
    try {
      await onDenied();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--nav-active-fill)] p-4 text-sm text-[color:var(--foreground)]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
          <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">任务已暂停，等待审批</h2>
          <p className="mt-1 text-xs leading-relaxed text-[color:var(--label-secondary)]">
            拦截动作：{approval?.proposed_action || "高风险浏览器操作"}
            {approval?.capability_id ? ` · ${approval.capability_id}` : ""}
            {approval?.risk_level ? ` · 风险 ${approval.risk_level}` : ""}
            {result.task_id ? ` · task ${result.task_id.slice(0, 8)}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleApprove()}
              disabled={busy !== null || !approval?.id}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
            >
              {busy === "approve" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              批准并继续
            </button>
            <button
              type="button"
              onClick={() => void handleDeny()}
              disabled={busy !== null || !approval?.id}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-xs font-medium text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
            >
              {busy === "deny" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
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
