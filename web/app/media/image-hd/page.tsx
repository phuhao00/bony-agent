"use client";

import { Sparkles, Upload, ZoomIn, ChevronDown, ChevronUp, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/tools/upload-bg", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || !data.public_url) throw new Error(data.error || "上传失败");
  return data.public_url as string;
}

const RESOLUTION_OPTIONS = [
  { value: "1K", label: "1K 标准", desc: "速度最快，适合普通用途" },
  { value: "2K", label: "2K 高清", desc: "细节显著提升，适合展示" },
  { value: "4K", label: "4K 超高清", desc: "最高画质，适合专业输出" },
];

const PROMPT_PRESETS = [
  { label: "通用增强", prompt: "enhance details, ultra sharp, high definition, realistic textures, 4K quality" },
  { label: "人像写真", prompt: "enhance facial details, sharp skin texture, clear eyes, high definition portrait, realistic" },
  { label: "风景建筑", prompt: "enhance architectural details, sharp edges, vivid colors, ultra high resolution landscape" },
  { label: "产品商业", prompt: "enhance product details, sharp texture, professional quality, high definition commercial photography" },
  { label: "插画/动漫", prompt: "enhance artistic details, vibrant colors, sharp lines, high resolution illustration, crisp" },
  { label: "文字/文档", prompt: "enhance text clarity, sharp characters, high contrast, ultra sharp document scan" },
];

export default function ImageHDPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayUrl, setDisplayUrl] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [prompt, setPrompt] = useState(PROMPT_PRESETS[0].prompt);
  const [resolution, setResolution] = useState("1K");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uploading, setUploading] = useState(false);

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    setError("");
    try {
      const pub = await uploadFile(file);
      setDisplayUrl(URL.createObjectURL(file));
      setPublicUrl(pub);
      setResultUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : JSON.stringify(e));
    } finally {
      setUploading(false);
    }
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
    e.target.value = "";
  };

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) await processFile(file);
    },
    [processFile],
  );

  const handleEnhance = async () => {
    const src = publicUrl || displayUrl;
    if (!src) {
      setError("请先上传图片");
      return;
    }
    setLoading(true);
    setError("");
    setResultUrl("");

    try {
      // Step 1: 提交任务，立即拿到 job_id（不会 ECONNRESET）
      const startRes = await fetch("/api/backend/tools/image/seedance-enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_image_url: src, prompt, resolution }),
      });
      const startRaw = await startRes.text();
      let startData: Record<string, unknown> = {};
      try { startData = JSON.parse(startRaw); } catch { /* ignore */ }
      if (!startRes.ok) {
        const msg = typeof startData.detail === "string" ? startData.detail
          : startRaw.slice(0, 300) || `HTTP ${startRes.status}`;
        throw new Error(msg);
      }
      const jobId = typeof startData.job_id === "string" ? startData.job_id : "";
      if (!jobId) throw new Error("服务端未返回 job_id");

      // Step 2: 每 4 秒轮询一次，最多等 10 分钟
      const MAX_POLLS = 150;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const pollRes = await fetch(`/api/backend/tools/image/seedance-enhance/${jobId}`);
        const pollRaw = await pollRes.text();
        let pollData: Record<string, unknown> = {};
        try { pollData = JSON.parse(pollRaw); } catch { /* ignore */ }

        const status = pollData.status;
        if (status === "success") {
          const resultImageUrl = typeof pollData.url === "string" ? pollData.url : "";
          if (resultImageUrl) {
            setResultUrl(resultImageUrl);
          } else {
            setError("增强完成，但未返回图片 URL，请查看后端日志");
          }
          return;
        }
        if (status === "failed") {
          throw new Error(typeof pollData.error === "string" ? pollData.error : "增强失败");
        }
        // status === "running" → continue polling
      }
      throw new Error("轮询超时，请稍后刷新查看结果");
    } catch (e) {
      setError(e instanceof Error ? e.message : JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  };

  const hasImage = Boolean(displayUrl);

  return (
    <div className="h-full overflow-y-auto page-canvas">
      <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
              <ZoomIn className="h-5 w-5 text-[var(--accent)]" />
              图片高清增强
            </h1>
            <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
              SeaDance GPT-Image-2 · AI 超分还原 · 支持 1K / 2K / 4K 输出
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
          {/* 左侧：图片预览区 */}
          <div className="space-y-4">
            {/* 上传 / 拖拽区 */}
            {!hasImage ? (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-[420px] cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-[color:var(--separator-subtle)] bg-[var(--card-bg)] text-center transition-colors hover:border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--accent)_3%,var(--card-bg))]"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--card-bg))]">
                  <Upload className="h-7 w-7 text-[var(--accent)]" />
                </div>
                <div>
                  <p className="text-base font-medium text-[color:var(--foreground)]">
                    {uploading ? "上传中..." : "点击或拖入图片"}
                  </p>
                  <p className="mt-1 text-sm text-[color:var(--label-secondary)]">
                    支持 JPG、PNG、WEBP 等格式
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* 原图 + 结果对比 */}
                <div
                  className={`grid gap-3 ${resultUrl ? "grid-cols-2" : "grid-cols-1"}`}
                >
                  <div className="overflow-hidden rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)]">
                    <div className="border-b border-[color:var(--separator-subtle)] px-4 py-2">
                      <p className="text-xs font-medium text-[color:var(--label-secondary)]">原图</p>
                    </div>
                    <img
                      src={displayUrl}
                      alt="原图"
                      className="w-full object-contain"
                      style={{ maxHeight: 480 }}
                    />
                  </div>
                  {resultUrl && (
                    <div className="overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_30%,var(--separator-subtle))] bg-[var(--card-bg)]">
                      <div className="border-b border-[color:var(--separator-subtle)] px-4 py-2">
                        <p className="text-xs font-medium text-[var(--accent)]">
                          高清增强结果（{resolution}）
                        </p>
                      </div>
                      <img
                        src={resultUrl}
                        alt="增强结果"
                        className="w-full object-contain"
                        style={{ maxHeight: 480 }}
                      />
                    </div>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-xl border border-[color:var(--separator-subtle)] px-4 py-2 text-sm text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  >
                    换图
                  </button>
                  {resultUrl && (
                    <>
                      <a
                        href={resultUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl border border-[color:var(--separator-subtle)] px-4 py-2 text-sm text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                      >
                        新窗口打开
                      </a>
                      <a
                        href={resultUrl}
                        download
                        className="rounded-xl border border-[color:var(--separator-subtle)] px-4 py-2 text-sm text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                      >
                        下载
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setDisplayUrl(resultUrl);
                          setPublicUrl(resultUrl);
                          setResultUrl("");
                        }}
                        className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                      >
                        继续增强此结果
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* 右侧：控制面板 */}
          <div className="card-surface space-y-4 rounded-3xl border border-[color:var(--separator-subtle)] p-4 shadow-sm xl:sticky xl:top-5 xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto xl:self-start">
            {/* Agent 信息 */}
            <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_18%,var(--separator-subtle))] bg-[color:color-mix(in_srgb,var(--accent)_5%,var(--card-bg))] p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-[color:var(--foreground)]">
                    SeaDance 高清增强 Agent
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[color:var(--label-secondary)]">
                    上传图片 → 选分辨率 → 点击增强，AI 自动提升细节与清晰度
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--nav-active-fill)] px-2.5 py-1 text-[10px] font-medium text-[color:var(--label-secondary)]">
                  GPT-Image-2
                </span>
              </div>
            </div>

            {/* 分辨率选择 */}
            <div>
              <p className="mb-2 text-sm font-medium text-[color:var(--foreground)]">输出分辨率</p>
              <div className="grid grid-cols-3 gap-2">
                {RESOLUTION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setResolution(opt.value)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                      resolution === opt.value
                        ? "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--card-bg))]"
                        : "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] hover:border-[color:color-mix(in_srgb,var(--accent)_25%,transparent)]"
                    }`}
                  >
                    <p className={`text-xs font-semibold ${resolution === opt.value ? "text-[var(--accent)]" : "text-[color:var(--foreground)]"}`}>
                      {opt.label}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-[color:var(--label-secondary)]">
                      {opt.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* 增强提示词预设 */}
            <div>
              <p className="mb-2 text-sm font-medium text-[color:var(--foreground)]">增强场景</p>
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setPrompt(p.prompt)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      prompt === p.prompt
                        ? "border-[color:color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--card-bg))] font-medium text-[color:var(--foreground)]"
                        : "border-[color:var(--separator-subtle)] text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 高级：自定义提示词 */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg bg-[var(--nav-active-fill)] px-3 py-2 text-xs text-[color:var(--label-secondary)]"
              >
                自定义增强提示词
                {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showAdvanced && (
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="输入英文增强提示词，例如：enhance facial details, ultra sharp, 4K"
                  rows={3}
                  className="mt-2 w-full resize-none rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2.5 text-xs leading-5 outline-none focus:border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)]"
                />
              )}
            </div>

            {/* 执行按钮 */}
            <button
              type="button"
              onClick={handleEnhance}
              disabled={loading || !hasImage || uploading}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {loading ? "SeaDance 增强中..." : uploading ? "上传中..." : "开始高清增强"}
            </button>

            {/* 错误提示 */}
            {error && (
              <div className="rounded-xl bg-[var(--status-danger-bg)] px-3 py-2.5 text-xs leading-5 text-[color:var(--status-danger-text)]">
                {error}
              </div>
            )}

            {/* 说明 */}
            <div className="rounded-xl bg-[var(--nav-active-fill)] p-3 text-xs leading-6 text-[color:var(--label-secondary)]">
              <p className="font-medium text-[color:var(--foreground)]">处理说明</p>
              <p>· 1K 约 30-60 秒，2K/4K 约 1-3 分钟</p>
              <p>· 图片将上传至服务器进行 AI 处理</p>
              <p>· 支持人像、风景、产品、插画等各类图片</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
