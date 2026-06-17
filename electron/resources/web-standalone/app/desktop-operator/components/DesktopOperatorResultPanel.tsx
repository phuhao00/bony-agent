"use client";

import { AssistantMarkdownPreview } from "@/app/components/AssistantMarkdownPreview";
import {
  assistantEmptyStateClass,
  assistantResultCardClass,
} from "@/app/components/assistantUi";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import type { AutomationPlanResult, DesktopTask } from "../hooks/useDesktopOperatorRunner";
import { DesktopOperatorApprovalCard } from "./DesktopOperatorApprovalCard";
import { isTaskApprovedPendingResume, isTaskAwaitingApproval } from "../lib/taskUtils";

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
      cls: "border-[color:var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[color:var(--status-warning-text)]",
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

function PlanView({ plan }: { plan: AutomationPlanResult | null }) {
  if (!plan) return null;
  const strategy = plan.strategy;
  const inner = plan.plan;
  return (
    <div className="space-y-3">
      {strategy && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--nav-active-fill)]/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
            策略
          </p>
          <p className="mt-1 text-sm font-medium text-[color:var(--foreground)]">
            {strategy.strategy || "—"}
          </p>
          {strategy.reason && (
            <p className="mt-1 text-xs text-[color:var(--label-secondary)]">{strategy.reason}</p>
          )}
        </div>
      )}
      {inner && (
        <pre className="max-h-64 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--page-canvas)] p-3 font-mono text-[11px] leading-relaxed text-[color:var(--foreground)]">
          {JSON.stringify(inner, null, 2)}
        </pre>
      )}
      {typeof inner?.shell_suggestion === "string" && inner.shell_suggestion && (
        <div className="rounded-xl border border-[var(--border-subtle)] p-3">
          <p className="mb-1 text-xs text-[color:var(--label-secondary)]">Shell 命令预览</p>
          <pre className="overflow-x-auto font-mono text-[11px]">{inner.shell_suggestion}</pre>
        </div>
      )}
    </div>
  );
}

export function DesktopOperatorResultPanel({
  task,
  lastPlan,
  lastResult,
  loading,
  streamText,
  onApprove,
  onDeny,
  onResume,
}: {
  task: DesktopTask | null;
  lastPlan: AutomationPlanResult | null;
  lastResult: unknown;
  loading: boolean;
  streamText?: string;
  onApprove?: () => Promise<void>;
  onDeny?: () => Promise<void>;
  onResume?: () => Promise<void>;
}) {
  const payload = (task?.result ?? lastResult) as Record<string, unknown> | null;
  const resultInner = payload?.result as Record<string, unknown> | undefined;
  const stdout =
    (typeof resultInner?.stdout === "string" && resultInner.stdout) ||
    (typeof payload?.stdout === "string" && payload.stdout) ||
    "";
  const stderr =
    (typeof resultInner?.stderr === "string" && resultInner.stderr) ||
    (typeof payload?.stderr === "string" && payload.stderr) ||
    "";

  const approval =
    (payload?.approval as { id?: string; proposed_action?: string; capability_id?: string; risk_level?: string }) ||
    ((lastResult as Record<string, unknown> | null)?.approval as
      | { id?: string; proposed_action?: string; capability_id?: string; risk_level?: string }
      | undefined) ||
    (task?.metadata?.last_approval_id
      ? {
          id: task.metadata.last_approval_id as string,
          proposed_action: task.message,
          capability_id: task.metadata.capability_id as string | undefined,
        }
      : null);

  const awaitingApproval = isTaskAwaitingApproval(task, lastResult) && Boolean(approval?.id);
  const approvedPendingResume = isTaskApprovedPendingResume(task) && Boolean(task?.id);

  const commandPreview =
    (typeof payload?.command === "string" && payload.command) ||
    (typeof resultInner?.command === "string" && resultInner.command) ||
    (lastPlan?.plan?.shell_suggestion as string | undefined) ||
    null;

  const hasContent = Boolean(task || lastPlan || lastResult || streamText);

  if (!hasContent) {
    return (
      <div className={assistantEmptyStateClass}>
        <div className="max-w-md space-y-2">
          <p className="font-medium text-[color:var(--foreground)]">执行结果将显示在这里</p>
          <p>
            选择左侧预设或填写参数后执行；也可在底部输入自然语言指令，Agent 会规划并操作本地应用。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pb-2">
      {approvedPendingResume && onResume && (
        <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--nav-active-fill)] p-4">
          <p className="text-sm font-medium text-[color:var(--foreground)]">审批已通过，等待执行</p>
          <p className="mt-1 text-xs text-[color:var(--label-secondary)]">
            上次批准后应用可能未自动启动，请点击下方按钮继续执行。
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={() => void onResume()}
            className="mt-3 inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            继续执行
          </button>
        </div>
      )}

      {awaitingApproval && onApprove && onDeny && (
        <DesktopOperatorApprovalCard
          taskId={task?.id}
          command={commandPreview}
          approval={approval}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      )}

      {task && (
        <div className={assistantResultCardClass}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[color:var(--foreground)]">任务状态</h3>
            {task.status ? (
              <StatusBadge status={awaitingApproval ? "waiting_approval" : task.status} />
            ) : null}
          </div>
          {task.message ? (
            <p className="text-sm text-[color:var(--label-secondary)]">{task.message}</p>
          ) : null}
          {task.error ? (
            <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {task.error}
            </p>
          ) : null}
          {(() => {
            const meta = task.metadata || {};
            const visionModel = meta.vision_model as string | undefined;
            const engine = meta.engine as string | undefined;
            const focusWarning = meta.focus_warning as string | undefined;
            const focusInfo = meta.focus_info as { foreground?: string; success?: boolean } | undefined;
            const previewPath = meta.preview_screenshot as string | undefined;
            const infoLines = [
              engine && `引擎: ${engine}`,
              visionModel && `视觉模型: ${visionModel}`,
              focusInfo?.foreground && `前台应用: ${focusInfo.foreground}`,
            ].filter(Boolean);
            if (!infoLines.length && !focusWarning && !previewPath) return null;
            return (
              <div className="mt-2 space-y-2">
                {infoLines.length ? (
                  <p className="text-[10px] text-[color:var(--label-secondary)]">{infoLines.join(" · ")}</p>
                ) : null}
                {focusWarning ? (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    {focusWarning}
                  </p>
                ) : null}
                {previewPath ? (
                  <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
                    <p className="border-b border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[color:var(--label-secondary)]">
                      最新截图
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/native-use/media/${previewPath}`}
                      alt="自动化截图预览"
                      className="max-h-48 w-full object-contain bg-[var(--page-canvas)]"
                    />
                  </div>
                ) : null}
              </div>
            );
          })()}
          {(() => {
            const resultPayload = task.result as Record<string, unknown> | undefined;
            const steps = (
              resultPayload?.steps ||
              (task.metadata?.steps as unknown[] | undefined)
            ) as Array<Record<string, unknown>> | undefined;
            const reflection =
              (typeof resultPayload?.reflection === "string" && resultPayload.reflection) ||
              (typeof task.metadata?.reflection === "string" && task.metadata.reflection) ||
              "";
            const sessionLog =
              (typeof resultPayload?.session_log === "string" && resultPayload.session_log) ||
              "";
            if (!steps?.length && !reflection) return null;
            return (
              <div className="mt-3 space-y-2">
                {reflection ? (
                  <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--page-canvas)] px-3 py-2 text-xs text-[color:var(--label-secondary)]">
                    {reflection}
                  </p>
                ) : null}
                {sessionLog ? (
                  <p className="text-[10px] text-[color:var(--label-secondary)]">
                    会话日志: storage/{sessionLog}
                  </p>
                ) : null}
                {steps?.length ? (
                  <ul className="max-h-64 space-y-2 overflow-auto text-xs">
                    {steps.map((step, idx) => {
                      const label =
                        String(step.plan_detail || step.plan || step.action || `步骤 ${idx + 1}`);
                      const reason = typeof step.reason === "string" ? step.reason : "";
                      const err = typeof step.error === "string" ? step.error : "";
                      const ok = step.ok;
                      const target = typeof step.target === "string" ? step.target : "";
                      const keys = Array.isArray(step.keys) ? (step.keys as string[]).join("+") : "";
                      const coords =
                        step.x != null && step.y != null ? `(${step.x}, ${step.y})` : "";
                      const shotAfter =
                        typeof step.screenshot_after === "string" ? step.screenshot_after : "";
                      return (
                        <li
                          key={idx}
                          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--page-canvas)] px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-medium text-[color:var(--foreground)]">
                              步骤 {(step.index as number ?? idx) + 1}: {label}
                            </span>
                            <span>
                              {ok === false ? "✗" : ok === true ? "✓" : ""}
                            </span>
                          </div>
                          {reason && reason !== label ? (
                            <p className="mt-1 text-[color:var(--label-secondary)]">{reason}</p>
                          ) : null}
                          {(target || keys || coords) ? (
                            <p className="mt-0.5 font-mono text-[10px] text-[color:var(--label-secondary)]">
                              {[
                                target && `target: ${target}`,
                                keys && `keys: ${keys}`,
                                coords && `coord: ${coords}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                          {shotAfter ? (
                            <div className="mt-2 overflow-hidden rounded border border-[var(--border-subtle)]">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/native-use/media/${shotAfter}`}
                                alt={`步骤 ${idx + 1} 截图`}
                                className="max-h-32 w-full object-contain bg-[var(--page-canvas)]"
                              />
                            </div>
                          ) : null}
                          {err ? (
                            <p className="mt-1 text-red-600 dark:text-red-400">{err}</p>
                          ) : null}
                          {step.no_progress === true ? (
                            <p className="mt-1 text-amber-600 dark:text-amber-400">
                              界面无明显变化
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })()}
          {task.progress != null && task.progress > 0 && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--nav-active-fill)]">
              <div
                className="h-full bg-[var(--accent)] transition-all"
                style={{ width: `${Math.min(100, task.progress)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {streamText ? (
        <div className={assistantResultCardClass}>
          <h3 className="mb-2 text-sm font-semibold text-[color:var(--foreground)]">Agent 回复</h3>
          <AssistantMarkdownPreview markdown={streamText} loading={loading} />
        </div>
      ) : null}

      {lastPlan ? (
        <div className={assistantResultCardClass}>
          <h3 className="mb-2 text-sm font-semibold text-[color:var(--foreground)]">自动化规划</h3>
          <PlanView plan={lastPlan} />
        </div>
      ) : null}

      {(stdout || stderr) && (
        <div className={`${assistantResultCardClass} space-y-3`}>
          {stdout && (
            <div>
              <p className="mb-1 text-xs font-medium text-[color:var(--label-secondary)]">stdout</p>
              <pre className="max-h-64 overflow-auto rounded-xl bg-[var(--page-canvas)] p-3 font-mono text-[11px]">
                {stdout.slice(0, 8000)}
              </pre>
            </div>
          )}
          {stderr && (
            <div>
              <p className="mb-1 text-xs font-medium text-red-600 dark:text-red-400">stderr</p>
              <pre className="max-h-48 overflow-auto rounded-xl border border-red-500/20 bg-red-500/5 p-3 font-mono text-[11px] text-red-700 dark:text-red-300">
                {stderr.slice(0, 4000)}
              </pre>
            </div>
          )}
        </div>
      )}

      {payload && !stdout && !stderr && !lastPlan && !streamText && !task && (
        <div className={assistantResultCardClass}>
          <h3 className="mb-2 text-sm font-semibold text-[color:var(--foreground)]">最近结果</h3>
          <pre className="max-h-96 overflow-auto rounded-xl bg-[var(--page-canvas)] p-3 font-mono text-[11px]">
            {JSON.stringify(payload, null, 2).slice(0, 12000)}
          </pre>
        </div>
      )}
    </div>
  );
}
