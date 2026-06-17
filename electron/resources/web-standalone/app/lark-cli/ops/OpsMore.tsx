"use client";

import { OpsCard, OpsSectionTitle, useOpsToast } from "@/app/lark-cli/ops/ui";
import { useState } from "react";

type Props = {
  defaultChatId?: string;
};

export default function OpsMore({ defaultChatId = "" }: Props) {
  const { push, ToastStack } = useOpsToast();
  const [chatId, setChatId] = useState(defaultChatId);
  const [busy, setBusy] = useState(false);

  const broadcast = async () => {
    const cid = chatId.trim();
    if (!cid.startsWith("oc_")) {
      push("info", "请填写 oc_ 开头的群 chat_id");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/feishu/ops/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cid }),
      });
      const d = await res.json();
      if (d.ok) push("ok", "已推送运维摘要到飞书群");
      else push("error", d.detail || d.error || "推送失败");
    } catch (e) {
      push("error", String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <OpsSectionTitle
        title="飞书快捷能力"
        hint="群内 @机器人 也可直接使用下列指令（需 ops 管理员权限）。"
      />

      <OpsCard>
        <p className="text-xs font-medium mb-2" style={{ color: "var(--label-secondary)" }}>
          推送运维快照到群
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="oc_ 群 chat_id"
            className="flex-1 min-w-[12rem] rounded-lg border border-[var(--separator-subtle)] px-3 py-2 text-sm bg-transparent"
            style={{ color: "var(--foreground)" }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={broadcast}
            className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "发送中…" : "推送"}
          </button>
        </div>
      </OpsCard>

      <OpsCard>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--label-secondary)" }}>
          常用指令
        </p>
        <dl className="space-y-3 text-sm">
          {[
            ["运维状态", "服务 / 飞书 / 餐费 / Jenkins 快照"],
            ["运维 Jenkins", "白名单流水线与最近构建"],
            ["运维部署 <说明>", "AI 生成计划 → 运维确认 <ID>"],
            ["运维日志 30", "查看 agent 日志末尾"],
          ].map(([cmd, desc]) => (
            <div key={cmd} className="flex gap-3">
              <dt className="shrink-0">
                <code className="text-xs px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 font-mono">
                  {cmd}
                </code>
              </dt>
              <dd style={{ color: "var(--label-secondary)" }}>{desc}</dd>
            </div>
          ))}
        </dl>
      </OpsCard>

      <ToastStack />
    </div>
  );
}
