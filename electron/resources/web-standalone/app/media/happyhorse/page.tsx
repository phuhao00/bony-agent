"use client";

import PublishModal from "@/app/components/PublishModal";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Mode = "t2v" | "i2v";

const PRESETS = [
  {
    name: "短视频种草",
    prompt:
      "产品特写镜头缓慢推进，柔光棚拍，材质细节清晰，背景虚化，适合电商短视频投放。",
  },
  {
    name: "电影感街拍",
    prompt:
      "雨夜城市街头，霓虹倒影，主角缓步走过斑马线，手持镜头轻微晃动，赛博氛围，24fps 电影感。",
  },
  {
    name: "自然纪实",
    prompt:
      "清晨山间薄雾，阳光穿过树林，溪流潺潺，镜头从远景缓慢推近到一朵野花特写。",
  },
  {
    name: "搞笑宠物",
    prompt:
      "一只橘猫从沙发跳下追着毛线球跑，夸张可爱动作，明亮室内光，竖屏短视频风格。",
  },
];

const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;

export default function HappyHorsePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("t2v");
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadPath, setUploadPath] = useState<string | null>(null);
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState<"720P" | "1080P">("720P");
  const [ratio, setRatio] = useState<(typeof RATIOS)[number]>("16:9");
  const [watermark, setWatermark] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [showPublish, setShowPublish] = useState(false);

  const handleUpload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "上传失败");
    const preview = `/api/uploads/${data.filename}`;
    const backendPath = `/uploads/${data.filename}`;
    setImageUrl("");
    setUploadPreview(preview);
    setUploadPath(backendPath);
  };

  const resolveImageUrl = () => {
    if (uploadPath) return uploadPath;
    return (imageUrl || "").trim();
  };

  const handleGenerate = async () => {
    setError(null);
    setVideoUrl(null);

    if (mode === "t2v" && !prompt.trim()) {
      alert("请输入视频描述");
      return;
    }
    if (mode === "i2v" && !resolveImageUrl()) {
      alert("请上传首帧图片或填写图片 URL");
      return;
    }

    setLoading(true);
    setLoadingMessage(
      mode === "t2v"
        ? "🐴 欢乐马正在生成视频（通常 1–5 分钟）..."
        : "🐴 欢乐马正在让图片动起来...",
    );

    try {
      const endpoint =
        mode === "t2v"
          ? "/api/tools/video/happyhorse"
          : "/api/tools/video/happyhorse/from-image";

      const payload =
        mode === "t2v"
          ? {
              prompt: prompt.trim(),
              duration,
              resolution,
              ratio,
              watermark,
            }
          : {
              image_url: resolveImageUrl(),
              prompt: prompt.trim(),
              duration,
              resolution,
              watermark,
            };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || data.detail || "生成失败");
      }

      const url = data.video_url || null;
      setVideoUrl(url);
      if (!url) {
        setError("生成完成但未返回可播放地址，请检查后端日志。");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setLoadingMessage("");
    }
  };

  return (
    <div className="page-canvas h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/60 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-300">
              HappyHorse Studio · 欢乐马专用
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={() => router.back()}
                className="flex items-center justify-center w-8 h-8 rounded-xl text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] transition-colors shrink-0"
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
              <h1 className="text-3xl font-bold tracking-tight text-[color:var(--foreground)]">
                🐴 欢乐马视频工坊
              </h1>
            </div>
            <p className="mt-2 max-w-3xl text-[color:var(--label-secondary)]">
              固定使用千问系 HappyHorse 1.0 模型，音画联合生成，运动流畅。支持
              3–15 秒、720P/1080P，不依赖全局视频模型设置。
            </p>
          </div>
          <div className="rounded-2xl border border-violet-300/40 bg-violet-500/5 px-4 py-3 text-xs text-violet-800 dark:text-violet-200">
            模型：happyhorse-1.0-t2v / happyhorse-1.0-i2v
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="card-surface rounded-3xl p-6">
            <div className="flex gap-2 rounded-2xl bg-[var(--nav-active-fill)] p-1">
              {(
                [
                  ["t2v", "文生视频"],
                  ["i2v", "图生视频"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                    mode === id
                      ? "bg-violet-600 text-white shadow"
                      : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "i2v" && (
              <div className="mt-6 space-y-4">
                <label className="block text-sm font-medium text-[color:var(--foreground)]">
                  首帧图片
                </label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="cursor-pointer rounded-2xl border-2 border-dashed border-[var(--border)] p-8 text-center hover:border-violet-400 transition"
                >
                  {uploadPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={uploadPreview}
                      alt="首帧预览"
                      className="mx-auto max-h-48 rounded-xl object-contain"
                    />
                  ) : (
                    <p className="text-sm text-[color:var(--label-secondary)]">
                      点击上传 JPG/PNG/WEBP（≤20MB）
                    </p>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      await handleUpload(f);
                    } catch (err) {
                      alert(String(err));
                    }
                  }}
                />
                <input
                  value={imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value);
                    if (e.target.value.trim()) {
                      setUploadPreview(null);
                      setUploadPath(null);
                    }
                  }}
                  placeholder="或粘贴公网图片 URL"
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-violet-400/40"
                />
              </div>
            )}

            <div className="mt-6">
              <label className="mb-2 block text-sm font-medium text-[color:var(--foreground)]">
                {mode === "t2v" ? "视频描述" : "动作描述（可选）"}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder={
                  mode === "t2v"
                    ? "描述镜头、主体动作、光线与氛围。欢乐马对自然语言理解较好，可写完整句子。"
                    : "描述希望画面如何动起来，例如：镜头缓慢推进，主体转头微笑。"
                }
                className="w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-[color:var(--foreground)] outline-none focus:ring-2 focus:ring-violet-400/40"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => setPrompt(p.prompt)}
                  className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[color:var(--label-secondary)] hover:border-violet-400 hover:text-violet-700 dark:hover:text-violet-300"
                >
                  {p.name}
                </button>
              ))}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">时长 {duration}s</label>
                <input
                  type="range"
                  min={3}
                  max={15}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full accent-violet-600"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">分辨率</label>
                <div className="flex gap-2">
                  {(["720P", "1080P"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setResolution(r)}
                      className={`flex-1 rounded-xl border px-3 py-2 text-sm ${
                        resolution === r
                          ? "border-violet-600 bg-violet-600 text-white"
                          : "border-[var(--border)]"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {mode === "t2v" && (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium">画幅比例</label>
                <div className="flex flex-wrap gap-2">
                  {RATIOS.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRatio(r)}
                      className={`rounded-lg border px-3 py-1.5 text-xs ${
                        ratio === r
                          ? "border-violet-600 bg-violet-600 text-white"
                          : "border-[var(--border)]"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="mt-4 flex items-center gap-2 text-sm text-[color:var(--label-secondary)]">
              <input
                type="checkbox"
                checked={watermark}
                onChange={(e) => setWatermark(e.target.checked)}
                className="accent-violet-600"
              />
              添加「Happy Horse」水印（默认关闭）
            </label>

            <button
              onClick={handleGenerate}
              disabled={loading}
              className="mt-6 w-full rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-4 font-semibold text-white shadow-lg transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? loadingMessage : "🚀 用欢乐马生成视频"}
            </button>

            {error && (
              <p className="mt-4 rounded-xl border border-red-300/50 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
            )}
          </section>

          <aside className="space-y-4">
            <section className="card-surface rounded-3xl p-6">
              <h3 className="font-semibold text-[color:var(--foreground)]">能力亮点</h3>
              <ul className="mt-3 space-y-2 text-sm text-[color:var(--label-secondary)]">
                <li>音画联合生成，口型与动作更自然</li>
                <li>8 步蒸馏推理，预览速度快</li>
                <li>图生视频自动跟随首帧画幅</li>
                <li>与万影 Wan 独立，互不影响</li>
              </ul>
            </section>

            <section className="card-surface rounded-3xl p-6">
              <h3 className="font-semibold text-[color:var(--foreground)]">预览</h3>
              {videoUrl ? (
                <div className="mt-4 space-y-3">
                  <video
                    src={videoUrl}
                    controls
                    className="w-full rounded-2xl bg-black"
                  />
                  <div className="flex gap-2">
                    <a
                      href={videoUrl}
                      download
                      className="flex-1 rounded-xl border border-[var(--border)] py-2 text-center text-sm"
                    >
                      下载
                    </a>
                    <button
                      onClick={() => setShowPublish(true)}
                      className="flex-1 rounded-xl bg-violet-600 py-2 text-sm text-white"
                    >
                      发布
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-[color:var(--label-secondary)]">
                  {loading
                    ? "生成中，请稍候..."
                    : "生成完成后在此预览成片。"}
                </p>
              )}
            </section>
          </aside>
        </div>
      </div>

      {showPublish && videoUrl && (
        <PublishModal
          isOpen={showPublish}
          onClose={() => setShowPublish(false)}
          content={prompt || "欢乐马视频"}
          mediaUrl={videoUrl}
          mediaType="video"
        />
      )}
    </div>
  );
}
