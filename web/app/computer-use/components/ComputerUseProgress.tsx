"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import {
  buildProgressFromMetadata,
  type ProgressStage,
} from "../lib/progressStages";
import type { ComputerUseProgressMeta } from "../lib/types";

function StageIcon({ status }: { status: ProgressStage["status"] }) {
  if (status === "done") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />;
  }
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[color:var(--accent)]" />;
  }
  return (
    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-[color:var(--separator-subtle)]" />
  );
}

export function ComputerUseProgress({
  computerUse,
  taskStatus,
  elapsedSec,
}: {
  computerUse?: ComputerUseProgressMeta;
  taskStatus?: string;
  elapsedSec: number;
}) {
  const stages = buildProgressFromMetadata(computerUse, taskStatus);
  const reflection = computerUse?.last_reflection;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[color:var(--accent)]">
          执行进度
          {computerUse?.current_step
            ? ` · ${computerUse.current_step}/${computerUse.max_steps ?? "?"}` 
            : ""}
        </p>
        <span className="text-xs tabular-nums text-[color:var(--label-secondary)]">
          {elapsedSec}s
        </span>
      </div>
      <ul className="space-y-2">
        {stages.map((stage) => (
          <li
            key={stage.id}
            className="flex items-center gap-2 text-[12px] text-[color:var(--label-secondary)]"
          >
            <StageIcon status={stage.status} />
            <span
              className={
                stage.status === "running"
                  ? "font-medium text-[color:var(--foreground)]"
                  : stage.status === "done"
                    ? "text-[color:var(--foreground)]"
                    : ""
              }
            >
              {stage.label}
            </span>
          </li>
        ))}
      </ul>
      {reflection ? (
        <details className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-medium text-[color:var(--label-secondary)]">
            Reflection（上一步复盘）
          </summary>
          <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--foreground)]">
            {reflection}
          </p>
        </details>
      ) : null}
      <p className="text-[11px] leading-snug text-[color:var(--label-secondary)]">
        每 2 秒从任务状态同步真实步骤与截图预览；首次冷启动 Chromium 常见 15–45s。
      </p>
    </div>
  );
}
