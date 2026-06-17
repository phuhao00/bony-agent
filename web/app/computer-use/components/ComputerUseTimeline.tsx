"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { actionLabel } from "../lib/progressStages";
import type { Round } from "../lib/types";
import { ZoomableScreenshot } from "./ZoomableScreenshot";

export function ComputerUseTimeline({ rounds }: { rounds: Round[] }) {
  if (!rounds.length) return null;

  return (
    <ol className="ml-2 space-y-4 border-l-2 border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] pl-4">
      {rounds.map((r, idx) => (
        <li key={idx} className="relative">
          <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-[var(--accent)] ring-4 ring-[color:color-mix(in_srgb,var(--accent)_18%,transparent)]" />
          <div className="card-surface rounded-2xl p-4">
            <div className="mb-2 text-xs font-semibold text-[color:var(--accent)]">
              {r.bootstrap_auto_search
                ? "自动提交搜索（服务端）"
                : `第 ${r.round ?? idx + 1} 轮`}
              {r.parse_error && (
                <span className="ml-2 font-normal text-red-500">
                  模型输出解析失败
                </span>
              )}
            </div>
            {r.parse_error && (
              <pre className="mb-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-red-500/25 bg-red-500/10 p-2 text-[11px] text-red-700">
                {r.parse_error}
                {r.raw_preview ? `\n${r.raw_preview}` : ""}
              </pre>
            )}
            {r.steps_logs && r.steps_logs.length > 0 && (
              <ul className="space-y-1.5">
                {r.steps_logs.map((log, i) => {
                  const act = (log.action as string) || "?";
                  const ok = log.ok !== false;
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs text-[color:var(--foreground)]"
                    >
                      {ok ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                      )}
                      <span>
                        <span className="font-medium text-[color:var(--foreground)]">
                          {actionLabel(act)}
                        </span>
                        {act === "goto" && typeof log.url === "string" && (
                          <span className="ml-1 break-all text-[color:var(--label-secondary)]">
                            {log.url}
                          </span>
                        )}
                        {typeof log.error === "string" && (
                          <span className="mt-0.5 block text-red-500">
                            {log.error}
                          </span>
                        )}
                        {typeof log.screenshot_base64 === "string" && (
                          <div className="mt-2 rounded-xl border border-white/10 bg-zinc-900 p-2">
                            <ZoomableScreenshot
                              src={`data:image/png;base64,${log.screenshot_base64}`}
                              alt="步骤截图"
                              compact
                            />
                          </div>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {r.planned_steps && r.planned_steps.length > 0 && (
              <details className="mt-3 text-[11px] text-[color:var(--label-secondary)]">
                <summary className="cursor-pointer hover:text-[color:var(--foreground)]">
                  查看原始 JSON 步骤
                </summary>
                <pre className="mt-2 max-h-32 overflow-x-auto rounded-lg bg-[var(--chrome-rail-bg)] p-2 font-mono text-[color:var(--foreground)] ring-1 ring-[color:var(--separator-subtle)]">
                  {JSON.stringify(r.planned_steps, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
