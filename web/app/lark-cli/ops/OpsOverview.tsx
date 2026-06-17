"use client";

import { MarkdownSummaryPreview } from "@/components/MarkdownSummaryPreview";
import { OpsCard, StatusPill } from "@/app/lark-cli/ops/ui";
import { useState } from "react";

export type OpsStatus = {
  checked_at?: string;
  ports?: {
    backend?: { port?: number; open?: boolean };
    web?: { port?: number; open?: boolean };
  };
  feishu?: Record<string, unknown>;
  meal?: Record<string, unknown> & { reminder_chat_id?: string };
  jenkins?: Record<string, unknown> & { ok?: boolean; allowed_jobs?: number };
  reminder_job?: Record<string, unknown>;
  disk_free_gb?: number;
  storage_mb?: Record<string, number | null>;
};

function Metric({
  label,
  value,
  ok,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  ok?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-xl px-3 py-3 bg-black/[0.03] dark:bg-white/[0.04]">
      <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--label-secondary)" }}>
        {label}
      </p>
      <div className="flex items-center gap-2 mt-1">
        <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
          {value}
        </p>
        {ok !== undefined && (
          <StatusPill tone={ok ? "ok" : "error"}>{ok ? "正常" : "异常"}</StatusPill>
        )}
      </div>
      {hint && (
        <p className="text-[11px] mt-1 truncate" style={{ color: "var(--label-secondary)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

type Props = {
  status: OpsStatus | null;
  markdown: string;
  loading: boolean;
  onRefresh: () => void;
};

export default function OpsOverview({
  status,
  markdown,
  loading,
  onRefresh,
}: Props) {
  const [showMd, setShowMd] = useState(false);
  const fei = status?.feishu as Record<string, boolean | string> | undefined;
  const meal = status?.meal;
  const jenkins = status?.jenkins;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs" style={{ color: "var(--label-secondary)" }}>
          {status?.checked_at ? `上次巡检 ${status.checked_at}` : "尚未巡检"}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[#fff] disabled:opacity-50"
        >
          {loading ? "刷新中…" : "刷新快照"}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          label="后端 API"
          value={`:${status?.ports?.backend?.port ?? 8000}`}
          ok={status?.ports?.backend?.open}
        />
        <Metric
          label="前端"
          value={`:${status?.ports?.web?.port ?? 3000}`}
          ok={status?.ports?.web?.open}
        />
        <Metric
          label="飞书消息"
          value={fei?.ws_connected ? "已连接" : "未连接"}
          ok={Boolean(fei?.ws_connected)}
          hint={String(fei?.connection_mode || "")}
        />
        <Metric
          label="餐费库"
          value={`${meal?.record_count ?? 0} 条`}
          ok={!meal?.error}
          hint={meal?.db_mb != null ? `${meal.db_mb} MB` : undefined}
        />
        <Metric
          label="Jenkins"
          value={
            jenkins?.configured
              ? jenkins?.ok
                ? "已连接"
                : "配置异常"
              : "未配置"
          }
          ok={jenkins?.configured ? Boolean(jenkins?.ok) : undefined}
          hint={
            jenkins?.allowed_jobs != null
              ? `${jenkins.allowed_jobs} 条流水线`
              : undefined
          }
        />
        <Metric
          label="磁盘剩余"
          value={`${status?.disk_free_gb ?? "—"} GB`}
          hint={`storage ${status?.storage_mb?.storage ?? "—"} MB`}
        />
      </div>

      {markdown && (
        <OpsCard className="p-0 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowMd((v) => !v)}
            className="w-full px-4 py-3 text-left text-sm font-medium flex justify-between items-center hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: "var(--foreground)" }}
          >
            完整运维报告（Markdown）
            <span className="text-xs" style={{ color: "var(--label-secondary)" }}>
              {showMd ? "收起" : "展开"}
            </span>
          </button>
          {showMd && (
            <div className="px-4 pb-4 text-sm prose prose-sm max-w-none border-t border-[var(--separator-subtle)] pt-3">
              <MarkdownSummaryPreview markdown={markdown} />
            </div>
          )}
        </OpsCard>
      )}
    </div>
  );
}
