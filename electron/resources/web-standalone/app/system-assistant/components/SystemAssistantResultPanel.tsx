"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import { AssistantMarkdownPreview } from "@/app/components/AssistantMarkdownPreview";
import type { SystemTask } from "../hooks/useSystemAssistantRunner";
import { SystemAssistantApprovalCard } from "./SystemAssistantApprovalCard";

type DiagnosticsData = {
  platform?: string;
  checks?: Array<{
    name?: string;
    success?: boolean;
    command?: string;
    stdout?: string;
    stderr?: string;
    error?: string;
  }>;
  dev_tools?: Array<{ command?: string; success?: boolean; stdout?: string; stderr?: string }>;
};

type OrganizeResult = {
  plan_id?: string;
  move_count?: number;
  moves?: Array<{ source: string; dest: string; category?: string }>;
};

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
    completed: {
      label: "已完成",
      cls: "border-[color:var(--status-success-border)] bg-[var(--status-success-bg)] text-[color:var(--status-success-text)]",
      Icon: CheckCircle2,
    },
    running: {
      label: "执行中",
      cls: "border-[color:color-mix(in_srgb,var(--accent)_42%,transparent)] bg-[var(--nav-active-fill)] text-[color:var(--accent)]",
      Icon: Loader2,
    },
    waiting_approval: {
      label: "等待审批",
      cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      Icon: Clock,
    },
    failed: {
      label: "失败",
      cls: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
      Icon: XCircle,
    },
  };
  const item = map[status] || {
    label: status,
    cls: "border-[var(--border-subtle)] bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]",
    Icon: AlertTriangle,
  };
  const Icon = item.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${item.cls}`}
    >
      <Icon className={`h-3.5 w-3.5 ${status === "running" ? "animate-spin" : ""}`} />
      {item.label}
    </span>
  );
}

function DiagnosticsView({ data }: { data: DiagnosticsData }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(data.checks || []).map((check, i) => (
          <div
            key={`${check.name}-${i}`}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--nav-active-fill)]/40 p-3"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[color:var(--foreground)]">
                {check.name || "检查"}
              </span>
              {check.success ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
            </div>
            {(check.stdout || check.stderr || check.error) && (
              <pre className="mt-2 max-h-24 overflow-auto text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
                {(check.stdout || check.stderr || check.error || "").slice(0, 400)}
              </pre>
            )}
          </div>
        ))}
      </div>
      {data.dev_tools && data.dev_tools.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
            开发工具
          </h4>
          <div className="flex flex-wrap gap-2">
            {data.dev_tools.map((tool, i) => (
              <span
                key={i}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  tool.success
                    ? "border-[color:var(--status-success-border)] bg-[var(--status-success-bg)] text-[color:var(--status-success-text)]"
                    : "border-[var(--border-subtle)] bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]"
                }`}
              >
                {(tool.stdout || tool.command || "unknown").trim().slice(0, 40)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type MediaOrganizeResult = {
  image_count?: number;
  applied_count?: number;
  saved_bytes?: number;
  output_path?: string;
  output_dir?: string;
  duration_sec?: number;
  estimated_saved_bytes?: number;
  estimated_duration_sec?: number;
  duplicate_group_count?: number;
  duplicate_file_count?: number;
  has_bgm?: boolean;
  sort_by?: string;
  items?: Array<{ source?: string; dest?: string; saved_bytes?: number }>;
  errors?: string[];
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function MediaOrganizeView({ data }: { data: MediaOrganizeResult }) {
  return (
    <div className="space-y-3">
      {data.image_count != null && (
        <p className="text-sm text-[color:var(--label-secondary)]">扫描到 {data.image_count} 张图片</p>
      )}
      {data.duplicate_group_count != null && (
        <p className="text-sm text-[color:var(--foreground)]">
          发现 {data.duplicate_group_count} 组重复
          {data.duplicate_file_count != null ? `，可移动 ${data.duplicate_file_count} 个副本` : ""}
        </p>
      )}
      {data.has_bgm && (
        <p className="text-sm text-[color:var(--label-secondary)]">将合成背景音乐</p>
      )}
      {data.applied_count != null && (
        <p className="text-sm text-[color:var(--foreground)]">已处理 {data.applied_count} 个文件</p>
      )}
      {data.saved_bytes != null && data.saved_bytes > 0 && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          节省约 {formatBytes(data.saved_bytes)}
        </p>
      )}
      {data.estimated_saved_bytes != null && data.estimated_saved_bytes > 0 && (
        <p className="text-sm text-[color:var(--label-secondary)]">
          预计可节省约 {formatBytes(data.estimated_saved_bytes)}
        </p>
      )}
      {data.estimated_duration_sec != null && (
        <p className="text-sm text-[color:var(--label-secondary)]">
          预计视频时长约 {data.estimated_duration_sec} 秒
        </p>
      )}
      {(data.output_path || data.output_dir) && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--nav-active-fill)]/40 px-3 py-2">
          <p className="text-xs text-[color:var(--label-secondary)]">输出位置</p>
          <p className="mt-1 break-all font-mono text-xs text-[color:var(--foreground)]">
            {data.output_path || data.output_dir}
          </p>
        </div>
      )}
      {data.items && data.items.length > 0 && (
        <div className="max-h-48 overflow-auto rounded-xl border border-[var(--border-subtle)] text-xs">
          {data.items.slice(0, 20).map((item, i) => (
            <div key={i} className="border-b border-[var(--border-subtle)] px-3 py-2 last:border-0">
              <div className="truncate font-mono">{item.dest || item.source}</div>
              {item.saved_bytes != null && item.saved_bytes > 0 && (
                <div className="text-[color:var(--label-secondary)]">-{formatBytes(item.saved_bytes)}</div>
              )}
            </div>
          ))}
        </div>
      )}
      {data.errors && data.errors.length > 0 && (
        <p className="text-xs text-red-600 dark:text-red-400">{data.errors.join("; ")}</p>
      )}
    </div>
  );
}

function OrganizePreviewView({
  data,
  loading,
  onApply,
}: {
  data: OrganizeResult;
  loading: boolean;
  onApply?: (planId: string) => void;
}) {
  const moves = data.moves || [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-[color:var(--label-secondary)]">
        共 {data.move_count ?? moves.length} 项待整理
        {data.plan_id ? ` · 计划 ID: ${data.plan_id.slice(0, 8)}…` : ""}
      </p>
      {moves.length > 0 ? (
        <div className="max-h-72 overflow-auto rounded-xl border border-[var(--border-subtle)]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--card-bg)] text-[color:var(--label-secondary)]">
              <tr>
                <th className="px-3 py-2 font-medium">源文件</th>
                <th className="px-3 py-2 font-medium">目标</th>
                <th className="px-3 py-2 font-medium">分类</th>
              </tr>
            </thead>
            <tbody>
              {moves.slice(0, 50).map((m, i) => (
                <tr key={i} className="border-t border-[var(--border-subtle)]">
                  <td className="max-w-[180px] truncate px-3 py-2 font-mono">{m.source}</td>
                  <td className="max-w-[180px] truncate px-3 py-2 font-mono">{m.dest}</td>
                  <td className="px-3 py-2 text-[color:var(--label-secondary)]">{m.category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-[color:var(--label-secondary)]">无需移动的文件</p>
      )}
      {data.plan_id && moves.length > 0 && onApply && (
        <button
          type="button"
          disabled={loading}
          onClick={() => onApply(data.plan_id!)}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          确认执行整理
        </button>
      )}
    </div>
  );
}

export function SystemAssistantResultPanel({
  task,
  lastResult,
  loading,
  streamText,
  onApprove,
  onDeny,
  onApplyOrganize,
}: {
  task: SystemTask | null;
  lastResult: unknown;
  loading: boolean;
  streamText?: string;
  onApprove?: () => Promise<void>;
  onDeny?: () => Promise<void>;
  onApplyOrganize?: (planId: string) => void;
}) {
  const payload = (task?.result ?? lastResult) as Record<string, unknown> | null;
  const resultInner = payload?.result as Record<string, unknown> | undefined;
  const diagnostics = (resultInner?.checks ? resultInner : payload?.checks ? payload : null) as
    | DiagnosticsData
    | null;
  const organize = (resultInner?.moves ? resultInner : (payload?.result as OrganizeResult)) as
    | OrganizeResult
    | undefined;
  const mediaResult = (
    resultInner?.output_path ||
    resultInner?.applied_count != null ||
    resultInner?.estimated_saved_bytes != null ||
    resultInner?.duplicate_group_count != null ||
    (resultInner?.image_count != null && !resultInner?.moves)
      ? (resultInner as MediaOrganizeResult)
      : undefined
  );

  const hasContent = Boolean(task || lastResult || streamText);
  const commandPreview =
    payload && typeof payload.command === "string"
      ? payload.command
      : typeof task?.metadata?.pending_command === "string"
        ? task.metadata.pending_command
        : null;

  const approvalRaw =
    (lastResult as Record<string, unknown> | null)?.approval ||
    (payload?.approval as Record<string, unknown> | undefined);
  const approval = approvalRaw
    ? (approvalRaw as { id?: string; proposed_action?: string; capability_id?: string; risk_level?: string })
    : task?.metadata?.last_approval_id
      ? { id: task.metadata.last_approval_id as string }
      : null;

  return (
    <div className="flex h-full min-h-[320px] flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[color:var(--foreground)]">执行面板</h2>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="flex items-center gap-1 text-xs text-[color:var(--label-secondary)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              运行中
            </span>
          )}
          <StatusBadge status={task?.status} />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!hasContent && !loading && (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--nav-active-fill)] text-2xl">
              🛠️
            </div>
            <p className="text-sm font-medium text-[color:var(--foreground)]">尚无执行任务</p>
            <p className="mt-1 max-w-xs text-xs text-[color:var(--label-secondary)]">
              选择推荐或左侧功能后运行，或使用自然语言描述你的需求
            </p>
          </div>
        )}

        {streamText && (
          <div className="mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--nav-active-fill)]/40 p-3">
            <h4 className="mb-2 text-xs font-semibold text-[color:var(--label-secondary)]">助手回复</h4>
            <AssistantMarkdownPreview markdown={streamText} loading={loading} />
          </div>
        )}

        {task?.status === "waiting_approval" && onApprove && onDeny && (
          <SystemAssistantApprovalCard
            taskId={task.id}
            command={commandPreview}
            approval={approval as { id?: string; proposed_action?: string }}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        )}

        {task?.message && hasContent && (
          <p className="mb-3 text-sm text-[color:var(--label-secondary)]">{task.message}</p>
        )}

        {task?.progress != null && task.progress > 0 && task.progress < 100 && (
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-xs text-[color:var(--label-secondary)]">
              <span>进度</span>
              <span>{task.progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--separator-subtle)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          </div>
        )}

        {diagnostics?.checks && <DiagnosticsView data={diagnostics} />}

        {organize?.moves && (
          <OrganizePreviewView
            data={organize}
            loading={loading}
            onApply={onApplyOrganize}
          />
        )}

        {mediaResult && <MediaOrganizeView data={mediaResult} />}

        {commandPreview && task?.status !== "waiting_approval" && (
          <div className="mb-3 rounded-xl bg-[var(--nav-active-fill)] px-3 py-2 font-mono text-xs text-[color:var(--foreground)]">
            {commandPreview}
          </div>
        )}

        {hasContent && !diagnostics?.checks && !organize?.moves && !mediaResult && !streamText && (
          <details className="group">
            <summary className="cursor-pointer text-xs text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]">
              查看原始输出
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-[var(--nav-active-fill)] p-3 text-[11px] text-[color:var(--foreground)]">
              {JSON.stringify(task || lastResult, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
