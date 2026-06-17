"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import PublishModal from "../components/PublishModal";

type StepStatus = "pending" | "running" | "completed" | "error";

interface PipelineStep {
  id: "script" | "image" | "video" | "publish";
  name: string;
  icon: string;
  status: StepStatus;
  output?: string;
}

const PLATFORMS = [
  { id: "douyin", name: "抖音", icon: "🎵" },
  { id: "xiaohongshu", name: "小红书", icon: "📕" },
  { id: "bilibili", name: "B站", icon: "📺" },
  { id: "youtube", name: "YouTube", icon: "▶️" },
];

const STYLES = ["口播带货", "剧情演绎", "干货讲解", "种草测评"];

const TOPIC_PRESETS = [
  "今日热门商品推荐",
  "生活好物种草",
  "美食探店打卡",
  "健身减脂技巧",
  "科技数码评测",
  "美妆护肤教程",
];

const INITIAL_STEPS: PipelineStep[] = [
  { id: "script", name: "生成脚本", icon: "📝", status: "pending" },
  { id: "image", name: "生成封面图", icon: "🖼️", status: "pending" },
  { id: "video", name: "生成视频", icon: "🎬", status: "pending" },
  { id: "publish", name: "发布内容", icon: "🚀", status: "pending" },
];

function extractImageUrl(result: string): string | null {
  const localMatch = result?.match(
    /storage\/outputs\/([a-f0-9\-]+\.(jpg|png|jpeg|gif|webp))/i,
  );
  if (localMatch) return `/api/media/${localMatch[1]}`;
  const urlMatch = result?.match(
    /https?:\/\/[^\s\n\]]+\.(jpg|png|jpeg|webp|gif)(\?[^\s\n\]]*)?/i,
  );
  return urlMatch ? urlMatch[0] : null;
}

function extractVideoUrl(result: string): string | null {
  const localMatch = result?.match(
    /storage\/outputs\/([a-f0-9\-]+\.(mp4|webm|mov))/i,
  );
  if (localMatch) return `/api/media/${localMatch[1]}`;
  const urlMatch = result?.match(/https?:\/\/[^\s]+\.(mp4|webm|mov)/i);
  return urlMatch ? urlMatch[0] : null;
}

export default function PipelinePage() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("douyin");
  const [style, setStyle] = useState("口播带货");
  const [publishPlatforms, setPublishPlatforms] = useState<string[]>([]);

  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS);
  const [isRunning, setIsRunning] = useState(false);

  // Results
  const [script, setScript] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [publishResults, setPublishResults] = useState<
    { platform: string; success: boolean; url?: string; error?: string }[]
  >([]);

  // Video progress bar state (only for video step)
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoMessage, setVideoMessage] = useState("");

  const updateStep = (
    id: PipelineStep["id"],
    updates: Partial<PipelineStep>,
  ) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    );
  };

  const togglePublishPlatform = (pid: string) => {
    setPublishPlatforms((prev) =>
      prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid],
    );
  };

  const runPipeline = async () => {
    if (!topic.trim()) {
      alert("请输入话题主题");
      return;
    }

    setIsRunning(true);
    setScript(null);
    setImageUrl(null);
    setVideoUrl(null);
    setPublishResults([]);
    setVideoProgress(0);
    setVideoMessage("");
    setSteps(INITIAL_STEPS.map((s) => ({ ...s })));

    try {
      // ── Step 1: 生成脚本 ──────────────────────────────────────────────
      updateStep("script", { status: "running" });

      const scriptRes = await fetch("/api/tools/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, platform, style, duration: 60 }),
      });
      const scriptData = await scriptRes.json();

      if (!scriptRes.ok || scriptData.error) {
        updateStep("script", {
          status: "error",
          output: scriptData.error || "脚本生成失败",
        });
        return;
      }

      const scriptText: string = scriptData.result || scriptData.script || "";
      setScript(scriptText);
      updateStep("script", { status: "completed", output: scriptText });

      // ── Step 2: 生成封面图 ────────────────────────────────────────────
      updateStep("image", { status: "running" });

      const platName =
        PLATFORMS.find((p) => p.id === platform)?.name || "短视频";
      const imagePrompt = `为主题「${topic}」生成一张吸引眼球的${platName}封面图，风格：${style}，构图精美，色彩鲜明`;

      const imageRes = await fetch("/api/tools/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imagePrompt }),
      });
      const imageData = await imageRes.json();

      if (!imageRes.ok || imageData.error) {
        updateStep("image", {
          status: "error",
          output: imageData.error || "图片生成失败",
        });
        return;
      }

      const imgUrl = extractImageUrl(imageData.result || "");
      setImageUrl(imgUrl);
      updateStep("image", {
        status: "completed",
        output: imageData.result || "",
      });

      // ── Step 3: 生成视频 (with progress bar) ─────────────────────────
      updateStep("video", { status: "running" });
      setVideoProgress(0);
      setVideoMessage("🎬 正在生成视频（约1-3分钟）...");

      const videoProgressMessages = [
        "🔍 AI 正在理解内容主题...",
        "✍️ 正在规划视频画面...",
        "🎨 正在渲染关键帧...",
        "🎬 正在合成视频片段...",
        "🎞️ 正在最终输出...",
      ];
      let msgIdx = 0;

      const startMs = Date.now();

      // Animate progress: 0 → 90% over ~100s (logistic curve)
      const progressTimer = setInterval(() => {
        const elapsed = Date.now() - startMs;
        const pct = Math.min(
          90,
          Math.round(90 * (1 - Math.exp(-elapsed / 70000))),
        );
        setVideoProgress(pct);

        // Rotate messages every ~20s
        const newIdx = Math.min(
          videoProgressMessages.length - 1,
          Math.floor(elapsed / 20000),
        );
        if (newIdx !== msgIdx) {
          msgIdx = newIdx;
          setVideoMessage(videoProgressMessages[newIdx]);
        }
      }, 800);

      let vidUrl: string | null = null;

      try {
        const videoPromptText = `${topic}，${style}风格短视频，画面生动`;
        const videoRes = await fetch("/api/tools/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: videoPromptText }),
        });
        const videoData = await videoRes.json();

        clearInterval(progressTimer);
        setVideoProgress(100);
        setVideoMessage("✅ 视频生成完成！");

        if (!videoRes.ok || videoData.error) {
          updateStep("video", {
            status: "error",
            output: videoData.error || "视频生成失败",
          });
          return;
        }

        vidUrl = extractVideoUrl(videoData.result || "");
        setVideoUrl(vidUrl);
        updateStep("video", {
          status: "completed",
          output: videoData.result || "",
        });
      } catch (err) {
        clearInterval(progressTimer);
        setVideoProgress(0);
        setVideoMessage("");
        updateStep("video", {
          status: "error",
          output: `视频生成异常: ${err}`,
        });
        return;
      }

      // ── Step 4: 发布 ──────────────────────────────────────────────────
      updateStep("publish", { status: "running" });

      if (publishPlatforms.length > 0) {
        const results: typeof publishResults = [];

        for (const plt of publishPlatforms) {
          // Playwright 发布最长可能需要 5 分钟
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 290_000);
          try {
            const pubRes = await fetch("/api/tools/publish", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                platform: plt,
                content: scriptText,
                title: topic,
                media_urls: vidUrl ? [vidUrl] : imgUrl ? [imgUrl] : [],
                content_type: vidUrl ? "video" : imgUrl ? "image" : "text",
              }),
              signal: controller.signal,
            });
            clearTimeout(timer);
            const pubData = await pubRes.json();
            results.push({
              platform: plt,
              success: pubData.success ?? false,
              url: pubData.url,
              error: pubData.error,
            });
          } catch (e: unknown) {
            clearTimeout(timer);
            const isAbort = (e as { name?: string })?.name === "AbortError";
            results.push({
              platform: plt,
              success: false,
              error: isAbort ? "发布超时，请稍后在平台手动确认" : String(e),
            });
          }
        }

        setPublishResults(results);
        updateStep("publish", { status: "completed" });
      } else {
        updateStep("publish", {
          status: "completed",
          output: "未选择发布平台，跳过发布",
        });
      }
    } catch (error) {
      console.error("Pipeline error:", error);
    } finally {
      setIsRunning(false);
    }
  };

  const allDone = steps.every(
    (s) => s.status === "completed" || s.status === "error",
  );

  return (
    <div className="page-canvas h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <button
            onClick={() => router.back()}
            className="mt-1 flex items-center justify-center w-8 h-8 rounded-xl text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] transition-colors shrink-0"
            aria-label="返回"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              🚀 自动爆款流水线
            </h1>
            <p className="text-gray-500 mt-1">
              一键完成：脚本生成 → 封面图 → 视频生成 → 多平台发布
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Left: Config Panel ── */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-5">
              <h2 className="font-semibold text-gray-800 text-sm uppercase tracking-wide text-gray-500">
                📋 流水线配置
              </h2>

              {/* Topic */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  话题主题 *
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && !isRunning && runPipeline()
                  }
                  placeholder="输入视频主题或关键词..."
                  disabled={isRunning}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {TOPIC_PRESETS.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTopic(t)}
                      disabled={isRunning}
                      className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-md hover:bg-blue-50 hover:text-blue-600 transition-colors disabled:opacity-50"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Platform */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  目标平台
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPlatform(p.id)}
                      disabled={isRunning}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                        platform === p.id
                          ? "border-blue-500 bg-blue-50 text-blue-700 font-medium"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      } disabled:opacity-50`}
                    >
                      <span>{p.icon}</span>
                      <span>{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Style */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  视频风格
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {STYLES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStyle(s)}
                      disabled={isRunning}
                      className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                        style === s
                          ? "border-purple-500 bg-purple-50 text-purple-700 font-medium"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      } disabled:opacity-50`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Publish platforms */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  发布平台{" "}
                  <span className="text-gray-400 font-normal">（可选）</span>
                </label>
                <div className="space-y-2">
                  {PLATFORMS.map((p) => (
                    <label
                      key={p.id}
                      className={`flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border transition-colors ${
                        publishPlatforms.includes(p.id)
                          ? "border-green-400 bg-green-50"
                          : "border-gray-200 hover:border-gray-300"
                      } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={publishPlatforms.includes(p.id)}
                        onChange={() => togglePublishPlatform(p.id)}
                        disabled={isRunning}
                        className="rounded accent-green-500"
                      />
                      <span className="text-sm text-gray-700">
                        {p.icon} {p.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Run button */}
              <button
                onClick={runPipeline}
                disabled={isRunning || !topic.trim()}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md shadow-blue-200"
              >
                {isRunning ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    流水线运行中...
                  </>
                ) : (
                  "🚀 启动爆款流水线"
                )}
              </button>
            </div>

            {/* Results quick actions */}
            {allDone && videoUrl && (
              <div className="bg-white rounded-xl shadow-sm border border-green-200 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">
                  ✅ 流水线完成
                </h3>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg border border-gray-300 hover:bg-gray-200"
                  >
                    🔗 查看视频
                  </a>
                  <PublishModal
                    content={script || topic}
                    mediaUrl={videoUrl}
                    mediaType="video"
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Pipeline Steps ── */}
          <div className="lg:col-span-2 space-y-3">
            {steps.map((step, index) => (
              <StepCard
                key={step.id}
                step={step}
                index={index}
                videoProgress={step.id === "video" ? videoProgress : undefined}
                videoMessage={step.id === "video" ? videoMessage : undefined}
                script={step.id === "script" ? script : undefined}
                imageUrl={step.id === "image" ? imageUrl : undefined}
                videoUrl={step.id === "video" ? videoUrl : undefined}
                publishResults={
                  step.id === "publish" ? publishResults : undefined
                }
              />
            ))}

            {/* Tip when idle */}
            {!isRunning && steps.every((s) => s.status === "pending") && (
              <div className="text-center py-12 text-gray-400">
                <div className="text-5xl mb-3">🏭</div>
                <p className="text-sm">
                  配置左侧参数，点击「启动爆款流水线」开始自动化内容生产
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Status Badge (outside render) ────────────────────────────────────────
function StatusBadge({ status, index }: { status: StepStatus; index: number }) {
  if (status === "pending")
    return (
      <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-500 font-bold flex-shrink-0">
        {index + 1}
      </span>
    );
  if (status === "running")
    return (
      <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin flex-shrink-0" />
    );
  if (status === "completed")
    return (
      <span className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs flex-shrink-0">
        ✓
      </span>
    );
  return (
    <span className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center text-white text-xs flex-shrink-0">
      ✕
    </span>
  );
}

// ── Step Card Component ────────────────────────────────────────────────────

function StepCard({
  step,
  index,
  videoProgress,
  videoMessage,
  script,
  imageUrl,
  videoUrl,
  publishResults,
}: {
  step: PipelineStep;
  index: number;
  videoProgress?: number;
  videoMessage?: string;
  script?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  publishResults?: {
    platform: string;
    success: boolean;
    url?: string;
    error?: string;
  }[];
}) {
  const borderClass = {
    pending: "border-gray-200",
    running: "border-blue-400",
    completed: "border-green-400",
    error: "border-red-400",
  }[step.status];

  const bgClass = {
    pending: "bg-white",
    running: "bg-blue-50",
    completed: "bg-white",
    error: "bg-red-50",
  }[step.status];

  const statusLabel = {
    pending: { label: "等待中", cls: "bg-gray-100 text-gray-500" },
    running: { label: "进行中", cls: "bg-blue-100 text-blue-700" },
    completed: { label: "已完成", cls: "bg-green-100 text-green-700" },
    error: { label: "出错", cls: "bg-red-100 text-red-700" },
  }[step.status];

  return (
    <div
      className={`rounded-xl border-2 ${borderClass} ${bgClass} transition-all duration-300 overflow-hidden`}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3">
        <StatusBadge status={step.status} index={index} />
        <span className="text-xl">{step.icon}</span>
        <span className="font-semibold text-gray-800">{step.name}</span>
        <span
          className={`ml-auto text-xs font-medium px-2.5 py-1 rounded-full ${statusLabel.cls}`}
        >
          {statusLabel.label}
        </span>
      </div>

      {/* ── Video Progress Bar (only for video step) ── */}
      {step.id === "video" &&
        step.status === "running" &&
        videoProgress !== undefined && (
          <div className="px-4 pb-4">
            <div className="flex justify-between text-xs text-blue-600 mb-1.5">
              <span>{videoMessage || "视频生成中..."}</span>
              <span className="font-semibold">{videoProgress}%</span>
            </div>
            <div className="h-2.5 bg-blue-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${videoProgress}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              ⏱️ 预计耗时 1-3 分钟，请耐心等待
            </p>
          </div>
        )}

      {/* ── Image loading indicator (spinner only, no progress bar) ── */}
      {step.id === "image" && step.status === "running" && (
        <div className="px-4 pb-4 flex items-center gap-2 text-sm text-blue-600">
          <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span>AI 正在生成封面图（约30秒）...</span>
        </div>
      )}

      {/* ── Script loading indicator ── */}
      {step.id === "script" && step.status === "running" && (
        <div className="px-4 pb-4 flex items-center gap-2 text-sm text-blue-600">
          <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span>AI 正在生成视频脚本...</span>
        </div>
      )}

      {/* ── Publish loading indicator ── */}
      {step.id === "publish" && step.status === "running" && (
        <div className="px-4 pb-4 flex items-center gap-2 text-sm text-blue-600">
          <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span>正在发布到平台...</span>
        </div>
      )}

      {/* ── Completed outputs ── */}
      {step.status === "completed" && (
        <div className="px-4 pb-4 space-y-3">
          {/* Script */}
          {step.id === "script" && script && (
            <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200">
                <span className="text-xs font-medium text-gray-600">
                  脚本预览
                </span>
              </div>
              <pre className="p-3 text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto">
                {script.slice(0, 500)}
                {script.length > 500 ? "\n..." : ""}
              </pre>
            </div>
          )}

          {/* Image */}
          {step.id === "image" && (
            <div className="flex items-start gap-3">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt="封面图"
                  className="h-28 rounded-lg border border-gray-200 object-cover"
                  onError={(e) =>
                    ((e.target as HTMLImageElement).style.display = "none")
                  }
                />
              ) : (
                <div className="h-28 w-28 rounded-lg border border-gray-200 bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                  无预览
                </div>
              )}
              <p className="text-xs text-green-600">✅ 封面图已生成</p>
            </div>
          )}

          {/* Video */}
          {step.id === "video" && (
            <div>
              {videoUrl ? (
                <video
                  src={videoUrl}
                  controls
                  className="w-full rounded-lg border border-gray-200 max-h-52 bg-black"
                />
              ) : (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2 border border-amber-200">
                  ⚠️ 视频已生成但无法预览，请查看 storage/outputs 目录
                </p>
              )}
              {videoProgress === 100 && (
                <div className="mt-2">
                  <div className="h-2 bg-green-100 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full w-full" />
                  </div>
                  <p className="text-xs text-green-600 mt-1">✅ 100% 完成</p>
                </div>
              )}
            </div>
          )}

          {/* Publish */}
          {step.id === "publish" && (
            <div>
              {publishResults && publishResults.length > 0 ? (
                <div className="space-y-1.5">
                  {publishResults.map((r, i) => {
                    const platName =
                      PLATFORMS.find((p) => p.id === r.platform)?.name ||
                      r.platform;
                    return (
                      <div
                        key={i}
                        className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
                          r.success
                            ? "bg-green-50 border-green-200 text-green-700"
                            : "bg-red-50 border-red-200 text-red-700"
                        }`}
                      >
                        {r.success ? "✅" : "❌"}
                        <span className="font-medium">{platName}</span>
                        <span>{r.success ? "发布成功" : r.error}</span>
                        {r.url && (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto underline"
                          >
                            查看
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400">
                  {step.output || "未选择发布平台"}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Error output ── */}
      {step.status === "error" && step.output && (
        <div className="px-4 pb-4">
          <p className="text-xs text-red-600 bg-red-50 rounded-lg p-2 border border-red-200">
            {step.output}
          </p>
        </div>
      )}
    </div>
  );
}
