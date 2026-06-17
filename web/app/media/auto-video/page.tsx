"use client";

import PublishModal from "@/app/components/PublishModal";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface VoiceOption {
  id: string;
  name: string;
  gender?: string;
}

interface BgmOption {
  id: string;
  name: string;
  available?: boolean;
}

interface AutoVideoTask {
  id?: string;
  status: string;
  progress: number;
  message?: string;
  error?: string | null;
  result?: {
    video_url?: string | null;
    script?: string;
    search_terms?: string[];
    duration_sec?: number;
    material_mode?: "stock" | "synthetic";
  };
}

const TOPIC_PRESETS = [
  "今日 AI 行业热点解读",
  "生活好物种草推荐",
  "健身减脂小技巧",
  "科技数码新品评测",
  "旅行 vlog 灵感分享",
  "职场效率提升秘诀",
];

const STEP_LABELS = [
  { key: "script", label: "生成旁白文案", icon: "📝" },
  { key: "terms", label: "提取素材关键词", icon: "🔍" },
  { key: "tts", label: "合成配音", icon: "🎙️" },
  { key: "material", label: "下载素材", icon: "📥" },
  { key: "combine", label: "拼接视频", icon: "🎬" },
  { key: "mix", label: "混音 BGM", icon: "🎵" },
  { key: "subtitle", label: "烧录字幕", icon: "💬" },
];

function progressToStep(progress: number): number {
  if (progress < 15) return 0;
  if (progress < 25) return 1;
  if (progress < 40) return 2;
  if (progress < 55) return 3;
  if (progress < 70) return 4;
  if (progress < 85) return 5;
  return 6;
}

export default function AutoVideoPage() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState("zh-CN-XiaoxiaoNeural");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [materialSource, setMaterialSource] = useState("pexels");
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [bgm, setBgm] = useState("random");
  const [bgmVolume, setBgmVolume] = useState(0.25);

  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [bgmList, setBgmList] = useState<BgmOption[]>([]);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<AutoVideoTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/tools/video/auto/config")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.voices)) setVoices(data.voices);
        if (Array.isArray(data.bgm)) setBgmList(data.bgm.filter((b: BgmOption) => b.available !== false));
      })
      .catch(() => {
        setVoices([
          { id: "zh-CN-XiaoxiaoNeural", name: "晓晓（女声，温柔）" },
          { id: "zh-CN-YunxiNeural", name: "云希（男声，阳光）" },
        ]);
      });
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollTask = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/tools/video/auto?task_id=${encodeURIComponent(id)}`);
        const data: AutoVideoTask = await res.json();
        setTask(data);
        if (data.result?.script) setScript(data.result.script);
        if (data.result?.video_url) setVideoUrl(data.result.video_url);
        if (data.status === "completed" || data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setLoading(false);
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
  }, []);

  const startGeneration = async () => {
    if (!subject.trim()) {
      alert("请输入视频主题");
      return;
    }
    setLoading(true);
    setTask(null);
    setVideoUrl(null);
    setTaskId(null);

    try {
      const res = await fetch("/api/tools/video/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          script: script.trim(),
          voice,
          aspect_ratio: aspectRatio,
          material_source: materialSource,
          subtitle_enabled: subtitleEnabled,
          bgm,
          bgm_volume: bgmVolume,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        alert(data.error || data.detail || "任务提交失败");
        setLoading(false);
        return;
      }
      setTaskId(data.task_id);
      setTask({ status: "pending", progress: 0, message: data.message });
      pollTask(data.task_id);
    } catch (err) {
      alert(String(err));
      setLoading(false);
    }
  };

  const currentStep = task ? progressToStep(task.progress) : -1;
  const isDone = task?.status === "completed";
  const isFailed = task?.status === "failed";

  return (
    <div className="page-canvas h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6">
        <div className="mb-6 flex items-start gap-3">
          <button
            onClick={() => router.back()}
            className="mt-1 flex items-center justify-center w-8 h-8 rounded-xl text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] transition-colors shrink-0"
            aria-label="返回"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[color:var(--foreground)] flex items-center gap-2">
              🎬 一键短视频工厂
            </h1>
            <p className="text-[color:var(--label-secondary)] mt-1 text-sm">
              参考 MoneyPrinterTurbo：主题 → 旁白 → 素材检索 → 配音 → 字幕 → BGM → 成片
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 配置面板 */}
          <div className="lg:col-span-1 space-y-4">
            <div className="card-surface rounded-xl border border-[var(--border-subtle)] p-5 space-y-4">
              <h2 className="text-sm font-semibold text-[color:var(--label-secondary)] uppercase tracking-wide">
                视频配置
              </h2>

              <div>
                <label className="block text-sm font-medium mb-1.5">视频主题 *</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={loading}
                  placeholder="例如：2026 年 AI 助手如何改变工作方式"
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm disabled:opacity-50"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {TOPIC_PRESETS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSubject(t)}
                      disabled={loading}
                      className="px-2 py-1 text-xs rounded-md bg-[var(--nav-active-fill)] hover:opacity-80 disabled:opacity-50"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">
                  旁白文案 <span className="text-[color:var(--label-secondary)] font-normal">（可选，留空自动生成）</span>
                </label>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  disabled={loading}
                  rows={4}
                  placeholder="留空则 AI 根据主题自动生成旁白…"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm resize-none disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">画面比例</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "9:16", label: "竖屏 9:16" },
                    { id: "16:9", label: "横屏 16:9" },
                  ].map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAspectRatio(a.id)}
                      disabled={loading}
                      className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                        aspectRatio === a.id
                          ? "border-blue-500 bg-blue-500/10 font-medium"
                          : "border-[var(--border-subtle)]"
                      } disabled:opacity-50`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">素材来源</label>
                <select
                  value={materialSource}
                  onChange={(e) => setMaterialSource(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm disabled:opacity-50"
                >
                  <option value="pexels">Pexels 免版权视频</option>
                  <option value="pixabay">Pixabay 免版权视频</option>
                </select>
                <p className="text-xs text-[color:var(--label-secondary)] mt-1">
                  未配置 Key 时将自动使用本地合成 B-roll；配置 PEXELS_API_KEY 或 PIXABAY_API_KEY 可下载真实素材
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">配音音色</label>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm disabled:opacity-50"
                >
                  {(voices.length ? voices : [{ id: voice, name: voice }]).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">背景音乐</label>
                <select
                  value={bgm}
                  onChange={(e) => setBgm(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--input-bg)] text-sm disabled:opacity-50"
                >
                  <option value="random">随机 BGM</option>
                  <option value="none">无背景音乐</option>
                  {bgmList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {bgm !== "none" && (
                  <input
                    type="range"
                    min={0}
                    max={0.6}
                    step={0.05}
                    value={bgmVolume}
                    onChange={(e) => setBgmVolume(parseFloat(e.target.value))}
                    disabled={loading}
                    className="w-full mt-2"
                  />
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={subtitleEnabled}
                  onChange={(e) => setSubtitleEnabled(e.target.checked)}
                  disabled={loading}
                  className="rounded accent-blue-500"
                />
                <span className="text-sm">烧录字幕到成片</span>
              </label>

              <button
                type="button"
                onClick={startGeneration}
                disabled={loading || !subject.trim()}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    生成中…
                  </>
                ) : (
                  "🚀 一键生成短视频"
                )}
              </button>
            </div>
          </div>

          {/* 进度与预览 */}
          <div className="lg:col-span-2 space-y-4">
            {!task && !loading && (
              <div className="card-surface rounded-xl border border-dashed border-[var(--border-subtle)] p-12 text-center">
                <div className="text-5xl mb-3">🎞️</div>
                <p className="text-[color:var(--label-secondary)] text-sm">
                  输入主题并点击「一键生成短视频」，系统将自动完成文案、素材、配音与合成
                </p>
              </div>
            )}

            {(task || loading) && (
              <div className="card-surface rounded-xl border border-[var(--border-subtle)] p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">
                    {isDone ? "✅ 生成完成" : isFailed ? "❌ 生成失败" : "⏳ 流水线进行中"}
                  </span>
                  <span className="text-sm font-mono">{task?.progress ?? 0}%</span>
                </div>
                <div className="h-2.5 bg-[var(--nav-active-fill)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-700"
                    style={{ width: `${task?.progress ?? 0}%` }}
                  />
                </div>
                {task?.message && (
                  <p className="text-sm text-[color:var(--label-secondary)]">{task.message}</p>
                )}
                {isFailed && task?.error && (
                  <p className="text-sm text-red-600 bg-red-500/10 rounded-lg p-3 border border-red-500/20">
                    {task.error}
                  </p>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {STEP_LABELS.map((step, i) => {
                    let state: "pending" | "active" | "done" = "pending";
                    if (isDone || i < currentStep) state = "done";
                    else if (i === currentStep && !isFailed) state = "active";
                    return (
                      <div
                        key={step.key}
                        className={`rounded-lg px-2 py-2 text-xs border ${
                          state === "done"
                            ? "border-green-500/40 bg-green-500/10"
                            : state === "active"
                              ? "border-blue-500/40 bg-blue-500/10"
                              : "border-[var(--border-subtle)] opacity-60"
                        }`}
                      >
                        <span className="mr-1">{step.icon}</span>
                        {step.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {task?.result?.script && (
              <div className="card-surface rounded-xl border border-[var(--border-subtle)] p-4">
                <h3 className="text-sm font-semibold mb-2">旁白文案</h3>
                <pre className="text-xs whitespace-pre-wrap font-sans text-[color:var(--label-secondary)] max-h-40 overflow-y-auto">
                  {task.result.script}
                </pre>
                {task.result.search_terms && task.result.search_terms.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {task.result.search_terms.map((t) => (
                      <span key={t} className="px-2 py-0.5 text-xs rounded-full bg-[var(--nav-active-fill)]">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {videoUrl && (
              <div className="card-surface rounded-xl border border-green-500/30 p-4 space-y-3">
                <h3 className="text-sm font-semibold">成片预览</h3>
                {task?.result?.material_mode === "synthetic" && (
                  <p className="text-xs text-amber-700 bg-amber-500/10 rounded-lg px-3 py-2 border border-amber-500/20">
                    本次使用本地合成素材（未配置 Pexels/Pixabay Key）。在 backend/.env 添加 API Key 后可自动下载真实 B-roll。
                  </p>
                )}
                <video src={videoUrl} controls className="w-full rounded-lg max-h-80 bg-black" />
                <div className="flex flex-wrap gap-2">
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border-subtle)] hover:bg-[var(--nav-active-fill)]"
                  >
                    下载 / 新窗口打开
                  </a>
                  <PublishModal
                    content={task?.result?.script || subject}
                    mediaUrl={videoUrl}
                    mediaType="video"
                  />
                </div>
                {taskId && (
                  <p className="text-xs text-[color:var(--label-secondary)]">任务 ID: {taskId}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
