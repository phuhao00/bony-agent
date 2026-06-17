"use client";

import PublishModal from "@/app/components/PublishModal";
import UnifiedMediaSelector from "@/app/components/UnifiedMediaSelector";
import {
  CheckCircle2,
  ChevronLeft,
  Clapperboard,
  Cpu,
  Film,
  Layers,
  Lightbulb,
  Megaphone,
  Sparkles,
  Video,
  Wand2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface LongVideoSegment {
  index: number;
  title: string;
  duration_sec: number;
  prompt: string;
  status: string;
  video_url?: string | null;
  local_path?: string | null;
  error?: string | null;
  attempts?: number;
  retry_count?: number;
  placeholder?: boolean;
  final_prompt?: string | null;
  evaluator?: {
    enabled: boolean;
    mode?: string | null;
    score?: number | null;
    issues?: string[];
    refined_prompt?: string | null;
  } | null;
}

interface LongVideoTask {
  id: string;
  status: string;
  progress: number;
  error?: string | null;
  message?: string;
  result?: {
    provider: string;
    model: string;
    style?: string;
    duration_sec?: number;
    final_video?: string | null;
    final_video_url?: string | null;
    degraded?: boolean;
    failed_segments?: number;
    placeholder_segments?: number;
    segments: LongVideoSegment[];
  };
}

const presets = [
  {
    name: "品牌叙事",
    prompt:
      "一支 60 秒品牌宣传短片：年轻主理人在清晨开门营业，镜头穿过店内细节、产品制作过程、顾客互动和夜晚收店时刻，整体保持暖金色纪实电影感。",
  },
  {
    name: "产品种草",
    prompt:
      "一个 1 分钟产品种草视频：从开箱特写开始，展示产品材质、核心卖点、真实使用场景和用户表情反馈，镜头节奏利落，适合电商投放。",
  },
  {
    name: "剧情短片",
    prompt:
      "制作一支 90 秒微剧情：主角在雨夜城市中寻找失散的朋友，从街头霓虹、奔跑、回忆闪回到最终重逢，保持赛博都市氛围和连续人物形象。",
  },
];

const styleOptions = [
  {
    id: "cinematic",
    label: "电影感叙事",
    desc: "强调镜头语言、氛围光线和情绪推进",
    icon: Clapperboard,
  },
  {
    id: "documentary",
    label: "纪实镜头",
    desc: "更真实的观察式画面，适合品牌与纪录内容",
    icon: Video,
  },
  {
    id: "advertising",
    label: "广告大片",
    desc: "高对比、高质感，突出产品与记忆点",
    icon: Megaphone,
  },
  {
    id: "fantasy",
    label: "幻想美学",
    desc: "夸张视觉和超现实叙事，更适合创意短片",
    icon: Sparkles,
  },
];

const pipelineSteps = [
  {
    label: "拆解剧情与分镜",
    desc: "LLM 将长视频叙事拆分为连续 Wan 分镜",
    icon: Layers,
  },
  {
    label: "并行生成片段",
    desc: "Wan 同时生成多个约 5 秒的视频片段",
    icon: Cpu,
  },
  {
    label: "评估与拼接",
    desc: "评估提示词质量、重试并 FFmpeg 合并成片",
    icon: Film,
  },
];

const tips = [
  "明确主角身份，避免人物漂移",
  "描述镜头推进，而不是只写主题词",
  "默认建议先试 30 秒；需要更长叙事再选 60–90 秒通常更稳",
];

const errorName = (error: unknown) =>
  error !== null &&
  typeof error === "object" &&
  "name" in error &&
  typeof (error as { name: unknown }).name === "string"
    ? (error as { name: string }).name
    : "";

const isRetryablePollError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  const isTypeError =
    error instanceof TypeError || errorName(error) === "TypeError";
  if (
    isTypeError &&
    (normalized.length === 0 ||
      normalized.includes("fetch") ||
      normalized.includes("network") ||
      normalized.includes("load failed") ||
      normalized.includes("aborted") ||
      normalized.includes("failed to fetch"))
  ) {
    return true;
  }
  return (
    normalized.includes("failed to fetch") ||
    normalized.includes("fetch failed") ||
    normalized.includes("networkerror") ||
    normalized.includes("load failed") ||
    normalized.includes("econnreset") ||
    normalized.includes("network") ||
    normalized.includes("socket") ||
    normalized.includes("timeout") ||
    normalized.includes("503") ||
    normalized.includes("502") ||
    normalized.includes("504")
  );
};

export default function LongVideoPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(30);
  const [style, setStyle] = useState("cinematic");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<LongVideoTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const transientPollFailuresRef = useRef(0);
  const pollInFlightRef = useRef(false);

  const pollFetchStatus = async (url: string) => {
    try {
      return await fetch(url, { cache: "no-store" });
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      const msg = raw.trim() ? raw : "Failed to fetch";
      throw new Error(msg);
    }
  };

  const logPollSoft = (label: string, err: unknown) => {
    const text =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : String(err ?? "unknown");
    console.warn(`[long-video poll] ${label}: ${text}`);
  };

  const normalizeVideoUrl = useCallback((url?: string | null) => {
    if (!url) {
      return null;
    }

    if (url.startsWith("/api/media/")) {
      return url;
    }

    if (url.startsWith("/media/")) {
      return `/api/media/${url.replace("/media/", "")}`;
    }

    const localMatch = url.match(/storage\/outputs\/([^/]+\.(mp4|webm|mov))/i);
    if (localMatch) {
      return `/api/media/${localMatch[1]}`;
    }

    return url;
  }, []);

  const normalizeTaskPayload = useCallback(
    (payload: LongVideoTask) => ({
      ...payload,
      result: payload.result
        ? {
            ...payload.result,
            final_video_url: normalizeVideoUrl(payload.result.final_video_url),
            segments: payload.result.segments.map((segment) => ({
              ...segment,
              video_url: normalizeVideoUrl(segment.video_url),
            })),
          }
        : payload.result,
    }),
    [normalizeVideoUrl],
  );

  useEffect(() => {
    if (!taskId || !loading) return;

    const timer = setInterval(() => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      void (async () => {
        try {
          const response = await pollFetchStatus(
            `/api/tools/video/long?task_id=${encodeURIComponent(taskId)}`,
          );
          let data: LongVideoTask & { error?: string };
          try {
            data = await response.json();
          } catch {
            throw new Error(
              response.ok ? "服务器返回非 JSON" : `HTTP ${response.status}`,
            );
          }
          if (!response.ok) {
            const msg = data?.error || `HTTP ${response.status}`;
            if (
              isRetryablePollError(new Error(msg)) &&
              transientPollFailuresRef.current < 8
            ) {
              transientPollFailuresRef.current += 1;
              setLoadingMessage(
                `服务暂时不可用，正在重试 (${transientPollFailuresRef.current}/8)...`,
              );
              return;
            }
            throw new Error(msg);
          }

          transientPollFailuresRef.current = 0;
          const normalizedTask = normalizeTaskPayload(data);
          setTask(normalizedTask);
          setLoadingMessage(normalizedTask.message || "正在生成长视频...");

          if (normalizedTask.status === "completed") {
            setVideoUrl(normalizedTask.result?.final_video_url || null);
            setResult(
              `✅ 长视频生成成功！\n\n**供应商:** 阿里通义 Wan\n**Model:** ${normalizedTask.result?.model || "wan2.7-t2v"}\n**目标时长:** ${duration} 秒\n**实际时长:** ${normalizedTask.result?.duration_sec || "未知"} 秒${normalizedTask.result?.degraded ? `\n**降级片段:** ${normalizedTask.result?.placeholder_segments || 0} 段` : ""}`,
            );
            setLoading(false);
          } else if (normalizedTask.status === "failed") {
            setResult(
              `❌ 长视频生成失败: ${normalizedTask.error || "未知错误"}`,
            );
            setLoading(false);
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error ?? "");
          if (
            isRetryablePollError(error) &&
            transientPollFailuresRef.current < 8
          ) {
            transientPollFailuresRef.current += 1;
            setLoadingMessage(
              `网络波动，正在重试连接 (${transientPollFailuresRef.current}/8)...`,
            );
            return;
          }

          logPollSoft("gave up", error);
          setResult(
            `生成失败（轮询中断）: ${message}\n\n请确认后端已启动（默认 http://localhost:8000），或稍后重试。`,
          );
          setLoading(false);
        } finally {
          pollInFlightRef.current = false;
        }
      })().catch((err) => {
        pollInFlightRef.current = false;
        logPollSoft("unexpected", err);
      });
    }, 3000);

    return () => clearInterval(timer);
  }, [duration, loading, normalizeTaskPayload, taskId]);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      alert("请输入长视频描述");
      return;
    }

    setLoading(true);
    transientPollFailuresRef.current = 0;
    setLoadingMessage("正在规划长视频分镜...");
    setTask(null);
    setTaskId(null);
    setResult(null);
    setVideoUrl(null);

    try {
      const response = await fetch("/api/tools/video/long", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          duration_sec: duration,
          style,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "提交失败");
      }
      setTaskId(data.task_id);
      setResult(data.message || "长视频任务已提交");
    } catch (error) {
      setLoading(false);
      setResult(`生成失败: ${error}`);
    }
  };

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case "done":
        return "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20";
      case "running":
        return "bg-amber-500/10 text-amber-700 ring-amber-500/20";
      case "failed":
      case "placeholder":
        return "bg-rose-500/10 text-rose-700 ring-rose-500/20";
      default:
        return "bg-slate-500/10 text-slate-600 ring-slate-500/20";
    }
  };

  return (
    <div className="min-h-full overflow-y-auto brand-shell-bg">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-6">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--label-secondary)]">
            <span className="rounded-full border border-[var(--separator)] bg-[var(--card-bg)] px-2.5 py-1">
              WAN Long Video Studio
            </span>
            <span className="text-[var(--separator)]">·</span>
            <span>固定使用阿里通义 Wan</span>
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-start gap-3">
              <button
                onClick={() => router.back()}
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--separator)] bg-[var(--card-bg)] text-[var(--label-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--foreground)]"
                aria-label="返回"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
                  AI 长视频工坊
                </h1>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--label-secondary)]">
                  系统会将你的创意拆分为多个 Wan 分镜，顺序生成并自动拼接成
                  30–120 秒成片。
                </p>
              </div>
            </div>
            <UnifiedMediaSelector modality="video" />
          </div>
        </header>

        {/* Main grid */}
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          {/* Configuration */}
          <section className="rounded-2xl border border-[var(--separator)] bg-[var(--card-bg)] p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                创作设定
              </h2>
              <span className="rounded-lg border border-[var(--separator)] bg-[var(--shell-bg)] px-2 py-1 text-xs text-[var(--label-secondary)]">
                {duration}s · {styleOptions.find((s) => s.id === style)?.label}
              </span>
            </div>

            {/* Duration */}
            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--label-secondary)]">
                目标时长
              </label>
              <div className="grid grid-cols-4 gap-2 rounded-xl bg-[var(--shell-bg)] p-1">
                {[30, 60, 90, 120].map((item) => (
                  <button
                    key={item}
                    onClick={() => setDuration(item)}
                    className={`rounded-lg py-2.5 text-sm font-semibold transition-all ${
                      duration === item
                        ? "bg-[var(--card-bg)] text-[var(--foreground)] shadow-sm ring-1 ring-black/5"
                        : "text-[var(--label-secondary)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {item}s
                  </button>
                ))}
              </div>
            </div>

            {/* Style */}
            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[var(--label-secondary)]">
                视觉风格
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {styleOptions.map((option) => {
                  const Icon = option.icon;
                  const active = style === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => setStyle(option.id)}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                        active
                          ? "border-[var(--accent)] bg-[var(--accent)]/5 ring-1 ring-[var(--accent)]/20"
                          : "border-[var(--separator)] bg-[var(--card-bg)] hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/[0.02]"
                      }`}
                    >
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                          active
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--shell-bg)] text-[var(--label-secondary)]"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--foreground)]">
                          {option.label}
                        </div>
                        <div className="mt-0.5 text-xs leading-relaxed text-[var(--label-secondary)]">
                          {option.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Prompt */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--label-secondary)]">
                  长视频描述
                </label>
                <span className="text-xs tabular-nums text-[var(--label-secondary)]">
                  {prompt.length} 字
                </span>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder="例如：一支 60 秒咖啡品牌故事短片，清晨开店、咖啡豆研磨、手冲过程、顾客微笑和夜晚收店，保持暖金色电影纪实风格，主角始终是同一个年轻店主。"
                className="w-full resize-none rounded-xl border border-[var(--separator)] bg-[var(--shell-bg)] px-4 py-3 text-sm leading-relaxed text-[var(--foreground)] placeholder:text-[var(--placeholder-foreground)] transition-all focus:border-[var(--accent)] focus:bg-[var(--card-bg)] focus:outline-none focus:ring-4 focus:ring-[var(--accent)]/10"
              />
            </div>

            {/* Presets */}
            <div className="mb-5 flex flex-wrap gap-2">
              <span className="self-center text-xs text-[var(--label-secondary)]">
                快速填充:
              </span>
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => setPrompt(preset.prompt)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--separator)] bg-[var(--card-bg)] px-3 py-1.5 text-xs font-medium text-[var(--label-secondary)] transition-all hover:border-[var(--accent)]/50 hover:text-[var(--foreground)]"
                >
                  <Wand2 className="h-3 w-3" />
                  {preset.name}
                </button>
              ))}
            </div>

            {/* Generate */}
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  正在生成 Wan 长视频…
                </>
              ) : (
                <>
                  <Film className="h-4 w-4" />
                  开始生成独立长视频
                </>
              )}
            </button>
          </section>

          {/* Info sidebar */}
          <aside className="space-y-4">
            {/* Pipeline */}
            <section className="rounded-2xl border border-[var(--separator)] bg-[var(--card-bg)] p-5 shadow-sm">
              <h3 className="mb-4 text-sm font-semibold text-[var(--foreground)]">
                生成管线
              </h3>
              <div className="space-y-0">
                {pipelineSteps.map((step, index) => {
                  const Icon = step.icon;
                  const isLast = index === pipelineSteps.length - 1;
                  return (
                    <div key={step.label} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--separator)] bg-[var(--shell-bg)] text-xs font-semibold text-[var(--label-secondary)]">
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        {!isLast && (
                          <div className="my-1 w-px flex-1 bg-[var(--separator)]" />
                        )}
                      </div>
                      <div className={`pb-4 ${isLast ? "" : ""}`}>
                        <div className="text-sm font-medium text-[var(--foreground)]">
                          {index + 1}. {step.label}
                        </div>
                        <div className="mt-0.5 text-xs leading-relaxed text-[var(--label-secondary)]">
                          {step.desc}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Tips */}
            <section className="rounded-2xl border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-5">
              <div className="mb-3 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-[var(--status-warning-text)]" />
                <h3 className="text-sm font-semibold text-[var(--status-warning-text)]">
                  当前建议
                </h3>
              </div>
              <ul className="space-y-2.5">
                {tips.map((tip, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2 text-xs leading-relaxed text-[var(--status-warning-text)]"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--status-warning-text)]" />
                    {tip}
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

        {/* Progress */}
        {(loading || task) && (
          <section className="mt-5 rounded-2xl border border-[var(--separator)] bg-[var(--card-bg)] p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[var(--foreground)]">
                  任务进度
                </h2>
                <p className="mt-0.5 text-sm text-[var(--label-secondary)]">
                  {loadingMessage || task?.message || "等待任务启动"}
                </p>
              </div>
              <div className="text-right">
                <div className="text-xs font-medium uppercase tracking-wide text-[var(--label-secondary)]">
                  Progress
                </div>
                <div className="text-2xl font-semibold tabular-nums text-[var(--foreground)]">
                  {task?.progress || 0}%
                </div>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--shell-bg)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-700"
                style={{ width: `${task?.progress || 0}%` }}
              />
            </div>

            {task?.result?.segments?.length ? (
              <div className="mt-5 space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-[var(--separator)] bg-[var(--shell-bg)] p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-[var(--label-secondary)]">
                      Segment Count
                    </div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--foreground)]">
                      {task.result.segments.length}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--separator)] bg-[var(--shell-bg)] p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-[var(--label-secondary)]">
                      Retries
                    </div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--foreground)]">
                      {task.result.segments.reduce(
                        (total, segment) => total + (segment.retry_count || 0),
                        0,
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--separator)] bg-[var(--shell-bg)] p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-[var(--label-secondary)]">
                      Degraded
                    </div>
                    <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--foreground)]">
                      {task.result.placeholder_segments || 0}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {task.result.segments.map((segment) => (
                    <div
                      key={segment.index}
                      className="rounded-xl border border-[var(--separator)] bg-[var(--shell-bg)] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 text-sm font-semibold text-[var(--foreground)]">
                          {segment.title}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusBadgeClass(segment.status)}`}
                        >
                          {segment.status}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--label-secondary)]">
                        <span>约 {segment.duration_sec}s</span>
                        <span>尝试 {segment.attempts || 0}</span>
                        <span>重试 {segment.retry_count || 0}</span>
                        {typeof segment.evaluator?.score === "number" ? (
                          <span>评分 {segment.evaluator.score}</span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-[var(--label-secondary)] line-clamp-3">
                        {segment.prompt}
                      </p>
                      {segment.evaluator?.issues?.length ? (
                        <div className="mt-2 rounded-lg border border-[var(--separator)] bg-[var(--card-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--label-secondary)]">
                          {segment.evaluator.issues.join("；")}
                        </div>
                      ) : null}
                      {segment.final_prompt ? (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-[var(--label-secondary)] hover:text-[var(--foreground)]">
                            查看最终生成提示词
                          </summary>
                          <div className="mt-2 rounded-lg border border-[var(--separator)] bg-[var(--card-bg)] px-3 py-2 leading-relaxed text-[var(--label-secondary)]">
                            {segment.final_prompt}
                          </div>
                        </details>
                      ) : null}
                      {segment.error ? (
                        <div className="mt-2 text-xs text-[var(--status-danger-text)]">
                          {segment.error}
                        </div>
                      ) : null}
                      {segment.video_url ? (
                        <a
                          href={segment.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-xs font-medium text-[var(--accent)] hover:underline"
                        >
                          查看片段
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        )}

        {/* Result */}
        {(videoUrl || result) && (
          <section className="mt-5 rounded-2xl border border-[var(--separator)] bg-[var(--card-bg)] p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                成片结果
              </h2>
            </div>

            {videoUrl ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-xl bg-black">
                  <video
                    src={videoUrl}
                    controls
                    className="aspect-video w-full"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--separator)] bg-[var(--shell-bg)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--card-bg)]"
                  >
                    新窗口打开
                  </a>
                  <button
                    onClick={() => {
                      fetch(videoUrl)
                        .then((res) => res.blob())
                        .then((blob) => {
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `long_video_${Date.now()}.mp4`;
                          document.body.appendChild(a);
                          a.click();
                          window.URL.revokeObjectURL(url);
                          document.body.removeChild(a);
                        })
                        .catch(() => window.open(videoUrl, "_blank"));
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-105"
                  >
                    下载视频
                  </button>
                  <PublishModal
                    content={result || prompt || "Wan 长视频"}
                    mediaUrl={videoUrl}
                    mediaType="video"
                  />
                </div>
              </div>
            ) : null}

            <details className="mt-4" open={!videoUrl}>
              <summary className="cursor-pointer text-sm text-[var(--label-secondary)] hover:text-[var(--foreground)]">
                查看详细信息
              </summary>
              <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-[var(--separator)] bg-[var(--shell-bg)] p-4 text-sm leading-7 text-[var(--foreground)]">
                {result}
              </pre>
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
