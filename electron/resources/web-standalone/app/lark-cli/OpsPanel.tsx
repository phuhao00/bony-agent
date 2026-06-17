"use client";

import OpsDeployPlan from "@/app/lark-cli/ops/OpsDeployPlan";
import JenkinsJobSettings from "@/app/lark-cli/ops/JenkinsJobSettings";
import JenkinsPipeline from "@/app/lark-cli/ops/JenkinsPipeline";
import OpsMore from "@/app/lark-cli/ops/OpsMore";
import OpsOverview, { type OpsStatus } from "@/app/lark-cli/ops/OpsOverview";
import { OpsTab } from "@/app/lark-cli/ops/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

type OpsTabId = "overview" | "pipeline" | "settings" | "plan" | "more";

export default function OpsPanel() {
  const [tab, setTab] = useState<OpsTabId>("pipeline");
  const [loading, setLoading] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [status, setStatus] = useState<OpsStatus | null>(null);

  const defaultChatId = useMemo(() => {
    const id = status?.meal?.reminder_chat_id;
    return typeof id === "string" && id.startsWith("oc_") ? id : "";
  }, [status?.meal?.reminder_chat_id]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/feishu/ops/status", { cache: "no-store" });
      const d = await res.json();
      if (d.ok) {
        setStatus(d.status || null);
        setMarkdown(d.markdown || "");
      }
    } catch {
      /* 各子面板自行 toast */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const jenkinsBadge =
    status?.jenkins?.configured && status.jenkins.ok
      ? String(status.jenkins.allowed_jobs ?? "")
      : undefined;

  return (
    <div className="space-y-4 max-w-5xl">
      <header>
        <h2 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
          运维中心
        </h2>
        <p className="text-xs mt-1" style={{ color: "var(--label-secondary)" }}>
          发布流水线、智能计划与系统快照 — 与飞书机器人共用白名单，无任意 shell。
        </p>
      </header>

      <nav
        className="flex flex-wrap gap-1 p-1 rounded-xl card-surface w-fit"
        role="tablist"
        aria-label="运维分区"
      >
        <OpsTab active={tab === "pipeline"} onClick={() => setTab("pipeline")} badge={jenkinsBadge}>
          发布流水线
        </OpsTab>
        <OpsTab active={tab === "settings"} onClick={() => setTab("settings")}>
          流水线配置
        </OpsTab>
        <OpsTab active={tab === "plan"} onClick={() => setTab("plan")}>
          智能计划
        </OpsTab>
        <OpsTab active={tab === "overview"} onClick={() => setTab("overview")}>
          系统快照
        </OpsTab>
        <OpsTab active={tab === "more"} onClick={() => setTab("more")}>
          飞书
        </OpsTab>
      </nav>

      <div role="tabpanel" className="min-h-[360px]">
        {tab === "overview" && (
          <OpsOverview
            status={status}
            markdown={markdown}
            loading={loading}
            onRefresh={refresh}
          />
        )}
        {tab === "pipeline" && (
          <JenkinsPipeline onOpenSettings={() => setTab("settings")} />
        )}
        {tab === "settings" && (
          <JenkinsJobSettings onSaved={refresh} />
        )}
        {tab === "plan" && (
          <OpsDeployPlan defaultChatId={defaultChatId} onExecuted={refresh} />
        )}
        {tab === "more" && <OpsMore defaultChatId={defaultChatId} />}
      </div>
    </div>
  );
}
