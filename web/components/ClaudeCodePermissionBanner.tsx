"use client";

import { ShieldCheck } from "lucide-react";

export type ClaudePermissionPending = {
  permission_id: string;
  tool_name?: string;
  title?: string;
  description?: string;
};

export function ClaudeCodePermissionBanner({
  pending,
  busy,
  onAllow,
  onDeny,
}: {
  pending: ClaudePermissionPending | null;
  busy?: boolean;
  onAllow: () => void;
  onDeny: () => void;
}) {
  if (!pending) return null;

  return (
    <div className="mb-2 rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--nav-active-fill)] px-3 py-2.5 text-sm text-[color:var(--foreground)]">
      <div className="flex items-start gap-2.5">
        <ShieldCheck
          className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--accent)]"
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Claude Code 等待工具审批</p>
          <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
            {pending.title ||
              pending.tool_name ||
              "Agent 请求执行本地文件/命令操作"}
            {pending.description ? ` · ${pending.description}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onAllow}
              className="rounded-lg bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              允许
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDeny}
              className="rounded-lg border border-[color:var(--separator-subtle)] px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
            >
              拒绝
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
