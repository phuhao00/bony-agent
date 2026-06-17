"use client";

import { OpsCard, OpsSectionTitle, StatusPill, useOpsToast } from "@/app/lark-cli/ops/ui";
import { useState } from "react";

export type PlanAction = {
  action: string;
  label?: string;
  reason?: string;
  params?: Record<string, unknown>;
};

export type DeployPlan = {
  plan_id?: string;
  summary?: string;
  confidence?: number;
  actions?: PlanAction[];
  confirm_hint?: string;
};

type Props = {
  defaultChatId?: string;
  onExecuted?: () => void;
};

export default function OpsDeployPlan({ defaultChatId = "", onExecuted }: Props) {
  const { push, ToastStack } = useOpsToast();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [chatId, setChatId] = useState(defaultChatId);
  const [hours, setHours] = useState("2");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<DeployPlan | null>(null);

  const canGenerate =
    instruction.trim().length > 0 || chatId.trim().startsWith("oc_");

  const generate = async () => {
    if (!canGenerate) {
      push("info", "请填写部署说明，或展开高级选项填写群 chat_id");
      return;
    }
    setBusy(true);
    setPlan(null);
    try {
      const res = await fetch("/api/feishu/ops/plan-from-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId.trim(),
          hours_back: parseFloat(hours) || 2,
          instruction: instruction.trim(),
          as_who: "bot",
        }),
      });
      const d = await res.json();
      if (d.ok) {
        setPlan(d);
        push("ok", `已生成计划 ${d.plan_id}`);
      } else {
        push("error", d.error || "生成失败");
      }
    } catch (e) {
      push("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    const pid = plan?.plan_id;
    if (!pid) return;
    const hasJenkins = (plan.actions || []).some((a) =>
      (a.action || "").startsWith("jenkins_trigger"),
    );
    if (
      hasJenkins &&
      !window.confirm(
        "本计划包含 Jenkins 构建触发，确认在服务器上执行？",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/feishu/ops/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: pid }),
      });
      const d = await res.json();
      if (d.ok) {
        push("ok", `计划 ${pid} 已执行`);
        setPlan(null);
        setInstruction("");
        onExecuted?.();
      } else {
        push("error", d.error || "执行失败");
      }
    } catch (e) {
      push("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  const riskLevel = (action: string) => {
    if (action.startsWith("jenkins_trigger")) return "high" as const;
    if (action.includes("disconnect") || action.includes("reconnect")) {
      return "medium" as const;
    }
    return "low" as const;
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <OpsSectionTitle
        title="智能发布计划"
        hint="用自然语言描述要做的运维/发布；AI 只会映射到白名单动作（含 Jenkins），不会执行任意 shell。"
      />

      <OpsCard>
        <label
          className="text-xs font-medium block mb-2"
          style={{ color: "var(--label-secondary)" }}
        >
          你想做什么？
        </label>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="例如：把后端 deploy-agent-backend 发到 hh/super-agent 分支，完成后把运维状态推到本群"
          rows={3}
          className="w-full rounded-xl border border-[var(--separator-subtle)] px-3 py-2.5 text-sm bg-transparent resize-y min-h-[88px]"
          style={{ color: "var(--foreground)" }}
        />

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="mt-3 text-xs hover:underline"
          style={{ color: "var(--label-secondary)" }}
        >
          {showAdvanced ? "收起" : "展开"}高级：从飞书群聊上下文解析
        </button>

        {showAdvanced && (
          <div className="mt-3 pt-3 border-t border-[var(--separator-subtle)] space-y-2">
            <input
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="oc_ 群 chat_id（可选，与说明二选一或并用）"
              className="w-full rounded-lg border border-[var(--separator-subtle)] px-3 py-2 text-sm bg-transparent"
              style={{ color: "var(--foreground)" }}
            />
            <div className="flex items-center gap-2">
              <label className="text-xs shrink-0" style={{ color: "var(--label-secondary)" }}>
                拉取最近
              </label>
              <input
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="w-16 rounded-lg border border-[var(--separator-subtle)] px-2 py-1.5 text-sm bg-transparent text-center"
                style={{ color: "var(--foreground)" }}
              />
              <span className="text-xs" style={{ color: "var(--label-secondary)" }}>
                小时群消息
              </span>
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={busy || !canGenerate}
          onClick={generate}
          className="mt-4 w-full sm:w-auto px-5 py-2.5 text-sm rounded-xl font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {busy && !plan ? "解析中…" : "生成执行计划"}
        </button>
      </OpsCard>

      {plan && (
        <OpsCard className="border-indigo-500/20">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                {plan.summary || "执行计划"}
              </p>
              <p className="text-[11px] mt-1" style={{ color: "var(--label-secondary)" }}>
                计划 ID <code className="font-mono">{plan.plan_id}</code>
                {plan.confidence != null && ` · 置信度 ${Math.round(Number(plan.confidence) * 100)}%`}
              </p>
            </div>
            <StatusPill
              tone={
                (plan.actions || []).some((a) =>
                  (a.action || "").startsWith("jenkins_trigger"),
                )
                  ? "warn"
                  : "neutral"
              }
            >
              {(plan.actions || []).length} 步
            </StatusPill>
          </div>

          <ol className="space-y-2">
            {(plan.actions || []).map((a, i) => {
              const risk = riskLevel(a.action || "");
              const job = String(
                (a.params as Record<string, unknown>)?.job_name ?? "",
              ).trim();
              const bp = (a.params as Record<string, unknown>)?.build_params;
              return (
                <li
                  key={i}
                  className="flex gap-3 rounded-xl px-3 py-2.5 bg-black/[0.03] dark:bg-white/[0.04]"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                        {a.label || a.action}
                      </span>
                      {risk === "high" && <StatusPill tone="warn">高风险</StatusPill>}
                      {risk === "medium" && <StatusPill tone="warn">注意</StatusPill>}
                    </div>
                    {job ? (
                      <p className="text-xs font-mono mt-0.5" style={{ color: "var(--label-secondary)" }}>
                        Job: {job}
                        {bp && typeof bp === "object"
                          ? ` · ${JSON.stringify(bp)}`
                          : ""}
                      </p>
                    ) : null}
                    {a.reason && (
                      <p className="text-xs mt-1" style={{ color: "var(--label-secondary)" }}>
                        {a.reason}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={execute}
              className="px-5 py-2.5 text-sm rounded-xl font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? "执行中…" : "确认并执行"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPlan(null)}
              className="px-4 py-2.5 text-sm rounded-xl border border-[var(--separator-subtle)]"
              style={{ color: "var(--foreground)" }}
            >
              放弃
            </button>
          </div>
          <p className="text-[11px] mt-3" style={{ color: "var(--label-secondary)" }}>
            飞书群内也可回复：{plan.confirm_hint || `运维确认 ${plan.plan_id}`}
          </p>
        </OpsCard>
      )}

      <ToastStack />
    </div>
  );
}
