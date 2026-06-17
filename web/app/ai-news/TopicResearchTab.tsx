"use client";

import { MarkdownSummaryPreview } from "@/components/MarkdownSummaryPreview";
import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type ResearchMode = "quick" | "deep";
type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface ProgressStep {
  stage: string;
  status: string;
}

interface ResearchItem {
  title?: string;
  url?: string;
  snippet?: string;
  quote?: string;
  extra?: { source?: string; engagement_label?: string };
}

interface ResearchArtifact {
  id?: string;
  query?: string;
  title?: string;
  summary?: string;
  items?: ResearchItem[];
}

interface TaskPayload {
  task_id: string;
  status: TaskStatus;
  progress?: ProgressStep[];
  progress_pct?: number;
  message?: string;
  error?: string;
  artifact?: ResearchArtifact;
  summary?: string;
  item_count?: number;
  local_paths?: Record<string, string>;
}

interface HistoryEntry {
  task_id: string;
  query: string;
  mode: ResearchMode;
  platform?: string;
  title?: string;
  created_at?: number;
  item_count?: number;
}

interface ContentPlan {
  topic_ideas?: Array<{ title?: string; angle?: string; audience?: string }>;
  script_direction?: {
    hook?: string;
    structure?: string[];
    cta?: string;
  };
  publish_plan?: Array<{
    platform?: string;
    format?: string;
    schedule_hint?: string;
    caption_outline?: string;
  }>;
}

const STAGE_LABELS: Record<string, string> = {
  start: "启动",
  fetch: "多源抓取",
  rank: "聚类排序",
  convert: "结构化",
  done: "完成",
};

const PLATFORMS = [
  { id: "douyin", label: "抖音" },
  { id: "bilibili", label: "B站" },
  { id: "xiaohongshu", label: "小红书" },
  { id: "youtube", label: "YouTube" },
  { id: "weibo", label: "微博" },
];

function formatTime(ts?: number) {
  if (!ts) return "—";
  try {
    return new Date(ts * 1000).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "—";
  }
}

export default function TopicResearchTab() {
  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ResearchMode>("quick");
  const [platform, setPlatform] = useState("douyin");
  const [goal, setGoal] = useState("短视频选题与脚本方向");
  const [statusInfo, setStatusInfo] = useState<Record<string, unknown> | null>(null);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskPayload | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbMessage, setKbMessage] = useState<string | null>(null);
  const [selectedTopicIdx, setSelectedTopicIdx] = useState(0);

  const artifact = task?.artifact;
  const summaryMd = artifact?.summary || task?.summary || "";

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/research/last30days/status", { cache: "no-store" });
      if (res.ok) setStatusInfo(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/research/last30days/history?limit=10", {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(Array.isArray(data.history) ? data.history : []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadHistory();
  }, [loadStatus, loadHistory]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pollTask = useCallback(
    (id: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/research/last30days/${id}`, { cache: "no-store" });
          const data: TaskPayload = await res.json();
          if (!res.ok) {
            setError(data.error || "查询任务失败");
            setRunning(false);
            stopPolling();
            return;
          }
          setTask(data);
          if (data.status === "completed") {
            setRunning(false);
            stopPolling();
            loadHistory();
          } else if (data.status === "failed") {
            setError(data.error || "调研失败");
            setRunning(false);
            stopPolling();
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "轮询失败");
          setRunning(false);
          stopPolling();
        }
      }, 2000);
    },
    [loadHistory],
  );

  useEffect(() => () => stopPolling(), []);

  const startResearch = async () => {
    const q = query.trim();
    if (!q) {
      setError("请输入调研话题");
      return;
    }
    setError(null);
    setPlan(null);
    setKbMessage(null);
    setRunning(true);
    setTask(null);

    try {
      const res = await fetch("/api/research/last30days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, mode, platform, goal }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || "启动调研失败");
      }
      setTaskId(data.task_id);
      setTask({ task_id: data.task_id, status: "pending", progress_pct: 0 });
      pollTask(data.task_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败");
      setRunning(false);
    }
  };

  const generatePlan = async () => {
    if (!artifact) return;
    setPlanLoading(true);
    setPlan(null);
    setError(null);
    try {
      const res = await fetch("/api/research/content-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact, platform, goal }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : data.error || "内容计划生成失败",
        );
      }
      setPlan(data.plan as ContentPlan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "内容计划失败");
    } finally {
      setPlanLoading(false);
    }
  };

  const saveToKnowledge = async () => {
    if (!artifact) return;
    setKbLoading(true);
    setKbMessage(null);
    try {
      const res = await fetch("/api/research/save-to-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifact,
          filename_base: (artifact.query || query).slice(0, 40),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || "入库失败");
      }
      setKbMessage(data.message || `已入库：${data.filename || ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "入库失败");
    } finally {
      setKbLoading(false);
    }
  };

  const goToCreate = () => {
    const ideas = plan?.topic_ideas || [];
    const picked = ideas[selectedTopicIdx] || ideas[0];
    const topicTitle = picked?.title || artifact?.query || query;
    const briefParts = [
      summaryMd.slice(0, 3000),
      picked?.angle ? `切入角度：${picked.angle}` : "",
      plan?.script_direction?.hook ? `钩子：${plan.script_direction.hook}` : "",
    ].filter(Boolean);
    const brief = briefParts.join("\n\n");
    try {
      sessionStorage.setItem(
        "topic_research_brief",
        JSON.stringify({ topic: topicTitle, brief, platform, goal }),
      );
    } catch {
      /* ignore */
    }
    router.push(
      `/create/script?topic=${encodeURIComponent(topicTitle)}&platform=${encodeURIComponent(platform)}`,
    );
  };

  const sourceTags = Array.from(
    new Set(
      (artifact?.items || [])
        .map((it) => it.extra?.source)
        .filter(Boolean) as string[],
    ),
  );

  return (
    <div className="space-y-6">
      {/* Input bar */}
      <div className="card-surface rounded-2xl border border-[color:var(--separator-subtle)] p-5 space-y-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--label-secondary)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !running && startResearch()}
              placeholder="输入话题，例如：豆包视频生成 用户反馈、OpenClaw vs Cursor"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] text-[color:var(--foreground)] text-sm"
            />
          </div>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ResearchMode)}
            className="px-3 py-2.5 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] text-sm text-[color:var(--foreground)]"
          >
            <option value="quick">快速（Reddit/HN/GitHub 等）</option>
            <option value="deep">深度（更多源，较慢）</option>
          </select>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="px-3 py-2.5 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] text-sm text-[color:var(--foreground)]"
          >
            {PLATFORMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={startResearch}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[color:var(--foreground)] text-[color:var(--shell-bg)] text-sm font-semibold disabled:opacity-50"
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                调研中…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                开始调研
              </>
            )}
          </button>
        </div>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="创作目标（可选），如：3分钟口播短视频选题"
          className="w-full px-4 py-2 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] text-[color:var(--foreground)] text-sm"
        />
        {statusInfo && !(statusInfo as { python_ok?: boolean }).python_ok && (
          <p className="text-[12px] text-amber-600">
            last30days 需要 Python 3.12+（当前：{(statusInfo as { python_version?: string }).python_version || "未知"}）
          </p>
        )}
        {mode === "deep" && (
          <p className="text-[12px] text-[color:var(--label-secondary)]">
            深度模式默认使用通义 Qwen（DASHSCOPE_API_KEY）；解锁 X/YouTube/TikTok 等需额外配置
            SCRAPECREATORS_API_KEY，预计 2–5 分钟。
          </p>
        )}
        {statusInfo &&
          (statusInfo as { reasoning?: { configured?: boolean; planner_model?: string } }).reasoning
            ?.configured && (
            <p className="text-[12px] text-emerald-600">
              已检测到 DashScope Key，推理后端：通义{" "}
              {(statusInfo as { reasoning?: { planner_model?: string } }).reasoning?.planner_model ||
                "qwen-plus"}
            </p>
          )}
      </div>

      {error && (
        <p className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-[13px] text-red-500 flex items-start gap-2">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Sidebar: progress + history */}
        <div className="space-y-4">
          {(running || task) && (
            <div className="card-surface rounded-2xl border border-[color:var(--separator-subtle)] p-4">
              <p className="text-[13px] font-semibold text-[color:var(--foreground)] mb-3">
                调研进度
              </p>
              <ul className="space-y-2">
                {(task?.progress || []).map((step) => (
                  <li
                    key={step.stage}
                    className="flex items-center gap-2 text-[12px] text-[color:var(--label-secondary)]"
                  >
                    {step.status === "done" ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : step.status === "running" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border border-[color:var(--separator)]" />
                    )}
                    {STAGE_LABELS[step.stage] || step.stage}
                  </li>
                ))}
              </ul>
              {task?.message && (
                <p className="mt-3 text-[11px] text-[color:var(--label-secondary)]">
                  {task.message}
                </p>
              )}
            </div>
          )}

          <div className="card-surface rounded-2xl border border-[color:var(--separator-subtle)] p-4">
            <p className="text-[13px] font-semibold text-[color:var(--foreground)] mb-3">
              最近调研
            </p>
            {history.length === 0 ? (
              <p className="text-[12px] text-[color:var(--label-secondary)]">暂无记录</p>
            ) : (
              <ul className="space-y-2">
                {history.map((h) => (
                  <li key={h.task_id}>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery(h.query);
                        setMode(h.mode);
                        if (h.platform) setPlatform(h.platform);
                        setTaskId(h.task_id);
                        pollTask(h.task_id);
                        fetch(`/api/research/last30days/${h.task_id}`)
                          .then((r) => r.json())
                          .then((d) => setTask(d))
                          .catch(() => undefined);
                      }}
                      className="w-full text-left rounded-lg px-2 py-2 hover:bg-[var(--nav-active-fill)] transition-colors"
                    >
                      <p className="text-[12px] font-medium text-[color:var(--foreground)] line-clamp-2">
                        {h.query}
                      </p>
                      <p className="text-[10px] text-[color:var(--label-secondary)] mt-0.5">
                        {formatTime(h.created_at)} · {h.mode} · {h.item_count ?? 0} 条
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Main brief */}
        <div className="space-y-4">
          <div className="card-surface rounded-2xl border border-[color:var(--separator-subtle)] p-5 min-h-[360px]">
            {!summaryMd && !running ? (
              <div className="flex flex-col items-center justify-center py-16 text-[color:var(--label-secondary)] gap-2">
                <Search className="w-10 h-10 opacity-40" />
                <p className="text-sm font-medium">输入话题，查看近 30 天多源舆情简报</p>
                <p className="text-[12px]">Reddit · X · YouTube · HN · Polymarket · GitHub</p>
              </div>
            ) : running && !summaryMd ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-[color:var(--label-secondary)]">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                <p className="text-sm">正在抓取并合成，请稍候…</p>
              </div>
            ) : (
              <>
                {artifact?.title && (
                  <h2 className="text-lg font-bold text-[color:var(--foreground)] mb-3">
                    {artifact.title}
                  </h2>
                )}
                {sourceTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {sourceTags.map((s) => (
                      <span
                        key={s}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <MarkdownSummaryPreview markdown={summaryMd} />
                {(artifact?.items?.length || 0) > 0 && (
                  <div className="mt-6 space-y-2 border-t border-[color:var(--separator-subtle)] pt-4">
                    <p className="text-[12px] font-semibold text-[color:var(--foreground)]">
                      引用来源（{artifact?.items?.length}）
                    </p>
                    <ul className="space-y-2 max-h-64 overflow-y-auto">
                      {(artifact?.items || []).slice(0, 12).map((it, idx) => (
                        <li
                          key={`${it.url || idx}`}
                          className="text-[12px] text-[color:var(--label-secondary)] rounded-lg bg-[var(--nav-active-fill)] p-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-medium text-[color:var(--foreground)] line-clamp-1">
                              [{it.extra?.source || "?"}] {it.title}
                            </span>
                            {it.url && (
                              <a
                                href={it.url}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 text-indigo-500"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                          {it.snippet && (
                            <p className="mt-1 line-clamp-2">{it.snippet}</p>
                          )}
                          {it.extra?.engagement_label && (
                            <p className="mt-1 text-[10px] opacity-80">
                              {it.extra.engagement_label}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>

          {artifact && task?.status === "completed" && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveToKnowledge}
                disabled={kbLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl card-surface border border-[color:var(--separator-subtle)] text-sm font-semibold text-[color:var(--foreground)] disabled:opacity-50"
              >
                {kbLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <BookOpen className="w-4 h-4" />
                )}
                入库知识库
              </button>
              <button
                type="button"
                onClick={generatePlan}
                disabled={planLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                {planLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                生成内容计划
              </button>
              {plan && (
                <button
                  type="button"
                  onClick={goToCreate}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[color:var(--foreground)] text-[color:var(--shell-bg)] text-sm font-semibold"
                >
                  去创作中心写脚本
                </button>
              )}
            </div>
          )}

          {kbMessage && (
            <p className="text-[12px] text-emerald-600">{kbMessage}</p>
          )}

          {plan && (
            <div className="card-surface rounded-2xl border border-[color:var(--separator-subtle)] p-5 space-y-4">
              <h3 className="text-base font-bold text-[color:var(--foreground)]">
                内容计划
              </h3>
              {plan.topic_ideas && plan.topic_ideas.length > 0 && (
                <div>
                  <p className="text-[12px] font-semibold mb-2">选题方向</p>
                  <div className="space-y-2">
                    {plan.topic_ideas.map((idea, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedTopicIdx(idx)}
                        className={`w-full text-left rounded-xl p-3 border transition-colors ${
                          selectedTopicIdx === idx
                            ? "border-indigo-500 bg-indigo-500/10"
                            : "border-[color:var(--separator-subtle)] hover:bg-[var(--nav-active-fill)]"
                        }`}
                      >
                        <p className="text-[13px] font-semibold text-[color:var(--foreground)]">
                          {idea.title}
                        </p>
                        {idea.angle && (
                          <p className="text-[12px] text-[color:var(--label-secondary)] mt-1">
                            {idea.angle}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {plan.script_direction && (
                <div className="text-[12px] text-[color:var(--label-secondary)] space-y-1">
                  {plan.script_direction.hook && (
                    <p>
                      <span className="font-semibold text-[color:var(--foreground)]">钩子：</span>
                      {plan.script_direction.hook}
                    </p>
                  )}
                  {plan.script_direction.structure && (
                    <p>
                      <span className="font-semibold text-[color:var(--foreground)]">结构：</span>
                      {plan.script_direction.structure.join(" → ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
