"use client";

import { formatFileSize, triggerBrowserDownload } from "@/lib/image-export";
import { CheckCircle2, Layers, Loader2, RefreshCw, Upload, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface LayerMeta {
  name: string;
  type: string;
  description?: string;
  replaceable?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SplitResult {
  download_url: string;
  filename: string;
  layer_count: number;
  layers: LayerMeta[];
  size_bytes?: number;
  engine?: string;
  analysis?: {
    engine?: string;
    provider?: string;
    paper?: string;
    paper_url?: string;
    image_blocks?: number;
    text_blocks?: number;
    ocr_blocks?: number;
    elements?: number;
    iterations?: number;
    include_ocr?: boolean;
    design_draft?: boolean;
    circular_mask?: boolean;
    replaceable_main?: number;
    qr?: number;
    icons?: number;
    vision_layout?: number;
    hybrid_pipeline?: boolean;
    high_quality?: boolean;
    refined_blocks?: number;
    total_api_calls?: number;
    qr_blocks?: number;
    icon_blocks?: number;
    vlm_blocks?: number;
    api_calls?: Record<string, number>;
  };
  progress?: Array<{ stage: string; status: string }>;
}

async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/tools/upload-bg", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || !data.public_url) {
    throw new Error(data.error || "上传失败");
  }
  return data.public_url as string;
}

interface VisionLayoutStatus {
  ready?: boolean;
  provider?: string;
  provider_name?: string;
  model?: string;
  dashscope_key?: boolean;
  alibaba_key?: boolean;
  vision_provider_override?: string | null;
  vision_model_override?: string | null;
  message?: string;
}

interface QwenLayeredStatus {
  available?: boolean;
  ready?: boolean;
  provider?: string;
  provider_name?: string;
  model?: string;
  message?: string;
  dashscope_key?: boolean;
  estimated_seconds?: string;
  pipeline_stages?: string[];
  paper?: string;
  paper_url?: string;
}

interface SplitEngineStatus {
  primary_engine: string;
  active_engine: string;
  can_split: boolean;
  qwen_layered?: QwenLayeredStatus;
  vision?: VisionLayoutStatus;
}

const PIPELINE_STAGE_LABELS: Record<string, string> = {
  detect: "语义检测",
  refine: "框选精修",
  extract: "逐元素抠图",
  background: "背景修复",
  export: "导出 PSD",
};

const LAYER_TYPE_LABELS: Record<string, string> = {
  background: "背景",
  image: "图片块",
  replaceable_main: "主图可换",
  qr: "二维码",
  icon: "图标",
  subject: "图片块",
  text: "文字块",
  decoration: "装饰",
  overlay: "叠加",
};

export default function ImageToPsdPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imageUrl, setImageUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [maxLayers, setMaxLayers] = useState(8);
  const [includeOcr, setIncludeOcr] = useState(true);
  const [highQuality, setHighQuality] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [engineStatus, setEngineStatus] = useState<SplitEngineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SplitResult | null>(null);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/tools/image/split-psd/status", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "状态查询失败");
      setEngineStatus(data as SplitEngineStatus);
    } catch (err) {
      setEngineStatus(null);
      setError(err instanceof Error ? err.message : "无法获取引擎状态");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const qwenStatus = engineStatus?.qwen_layered;
  const qwenReady = qwenStatus?.ready ?? false;
  const visionStatus = engineStatus?.vision;
  const visionReady = visionStatus?.ready ?? false;

  const handleFileChange = async (file: File) => {
    setError(null);
    setResult(null);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    try {
      const url = await uploadFile(file);
      setImageUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    }
  };

  const handleSplit = async () => {
    if (!imageUrl.trim()) {
      setError("请先上传或选择一张图片");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/tools/image/split-psd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          max_layers: maxLayers,
          include_ocr: includeOcr,
          high_quality: highQuality,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || "拆分失败");
      }
      setResult(data as SplitResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "拆分失败");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result?.download_url || !result.filename) return;
    triggerBrowserDownload(result.download_url, result.filename);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
              aria-label="返回"
            >
              <svg
                className="h-4 w-4"
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
              <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
                图片拆层 · PSD
              </h1>
              <p className="text-[13px] text-[color:var(--label-secondary)]">
                百炼五阶段高精度拆层：语义布局 → 框选精修 → 逐元素抠图 → 掩膜背景修复
              </p>
            </div>
          </div>
        </div>

        <section className="card-surface mb-6 rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[14px] font-semibold text-[color:var(--foreground)]">
              引擎状态
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void fetchStatus()}
                disabled={statusLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-[color:var(--separator-subtle)] px-2.5 py-1 text-[11px] text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${statusLoading ? "animate-spin" : ""}`} />
                刷新
              </button>
            </div>
          </div>

          {statusLoading && !engineStatus ? (
            <p className="text-[12px] text-[color:var(--label-secondary)]">正在检查引擎状态…</p>
          ) : engineStatus ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  ok={qwenReady}
                  label={
                    qwenReady
                      ? `百炼拆层就绪 · ${qwenStatus?.model ?? "wan2.7-image"}`
                      : "百炼拆层未配置"
                  }
                />
                <StatusBadge
                  ok={visionReady}
                  label={
                    visionReady
                      ? `通义视觉 ${visionStatus?.model ?? "qwen-vl"}`
                      : "通义视觉未配置"
                  }
                />
              </div>

              <p className="text-[12px] text-[color:var(--foreground)]">
                {qwenStatus?.message ?? "正在检查百炼引擎状态…"}
              </p>

              <div className="grid gap-2 text-[11px] text-[color:var(--label-secondary)] sm:grid-cols-2">
                <p>
                  当前策略:{" "}
                  {qwenReady
                    ? "五阶段流水线（VLM 融合 + 逐元素百炼抠图）"
                    : "不可用（需配置百炼 Key）"}
                </p>
                <p>
                  百炼 Key:{" "}
                  {qwenStatus?.dashscope_key ? "DASHSCOPE ✓" : "未配置 DASHSCOPE_API_KEY"}
                </p>
                {qwenReady && (
                  <p>预计耗时: {qwenStatus?.estimated_seconds ?? "120–300"} 秒/次</p>
                )}
                <p>
                  视觉 Key:{" "}
                  {visionStatus?.dashscope_key
                    ? "DASHSCOPE ✓"
                    : visionStatus?.alibaba_key
                      ? "ALIBABA ✓"
                      : "未配置"}
                </p>
              </div>

              {qwenReady && qwenStatus?.pipeline_stages && (
                <p className="text-[11px] text-[color:var(--label-secondary)]">
                  流水线:{" "}
                  {qwenStatus.pipeline_stages
                    .map((s) => PIPELINE_STAGE_LABELS[s] ?? s)
                    .join(" → ")}
                </p>
              )}

              {qwenStatus && !qwenReady && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
                  {qwenStatus.message ??
                    "请在 backend/.env 设置 DASHSCOPE_API_KEY 或 ALIBABA_API_KEY，可选 QWEN_LAYERED_DASHSCOPE_MODEL=wan2.7-image-pro 或 qwen-image-2.0-pro"}
                </p>
              )}

              {visionStatus && !visionReady && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
                  {visionStatus.message ??
                    "请在 backend/.env 设置 DASHSCOPE_API_KEY，并可选 LLM_VISION_MODEL=qwen-vl-max"}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-red-500">无法连接后端引擎状态接口</p>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card-surface rounded-2xl p-5">
            <h2 className="mb-4 text-[14px] font-semibold text-[color:var(--foreground)]">
              上传图片
            </h2>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileChange(file);
              }}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mb-4 flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--separator)] bg-[var(--nav-active-fill)] px-4 py-10 transition-colors hover:border-[color:var(--accent)]"
            >
              <Upload className="h-6 w-6 text-[color:var(--label-secondary)]" />
              <span className="text-[13px] text-[color:var(--label-secondary)]">
                点击上传 JPG / PNG / WebP
              </span>
            </button>

            {(previewUrl || imageUrl) && (
              <div className="overflow-hidden rounded-xl border border-[color:var(--separator-subtle)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl || imageUrl}
                  alt="预览"
                  className="max-h-72 w-full object-contain bg-[var(--nav-active-fill)]"
                />
              </div>
            )}
          </section>

          <section className="card-surface rounded-2xl p-5">
            <h2 className="mb-4 text-[14px] font-semibold text-[color:var(--foreground)]">
              拆分设置
            </h2>

            <div className="mb-4">
              <label className="mb-1.5 block text-[12px] text-[color:var(--label-secondary)]">
                最大图层数
              </label>
              <input
                type="range"
                min={3}
                max={10}
                value={maxLayers}
                onChange={(e) => setMaxLayers(Number(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-[12px] text-[color:var(--label-secondary)]">
                {maxLayers} 层（百炼支持 3–10 层）
              </p>
            </div>

            <label className="mb-4 flex cursor-pointer items-center gap-2 text-[13px] text-[color:var(--foreground)]">
              <input
                type="checkbox"
                checked={highQuality}
                onChange={(e) => setHighQuality(e.target.checked)}
                className="rounded"
              />
              高质量模式（逐元素百炼抠图 + 二轮框选 + 掩膜背景精修，约 2–5 分钟）
            </label>

            <label className="mb-6 flex cursor-pointer items-center gap-2 text-[13px] text-[color:var(--foreground)]">
              <input
                type="checkbox"
                checked={includeOcr}
                onChange={(e) => setIncludeOcr(e.target.checked)}
                className="rounded"
              />
              识别文字块（Qwen-VL + OCR 检测文字区域并单独成层）
            </label>

            {qwenReady && loading && (
              <p className="mb-4 text-[11px] text-[color:var(--label-secondary)]">
                五阶段流水线运行中（检测 → 精修 → 抠图 → 背景 → 导出），请耐心等待约{" "}
                {highQuality ? "2–5 分钟" : qwenStatus?.estimated_seconds ?? "2–3 分钟"}…
              </p>
            )}

            <button
              type="button"
              onClick={() => void handleSplit()}
              disabled={loading || !imageUrl || !qwenReady}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--foreground)] px-4 py-3 text-[13px] font-medium text-[color:var(--shell-bg)] transition-opacity disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {highQuality
                    ? "高精度拆层中（约 2–5 分钟）…"
                    : `百炼拆层中（约 ${qwenStatus?.estimated_seconds ?? "120–300"} 秒）…`}
                </>
              ) : (
                <>
                  <Layers className="h-4 w-4" />
                  拆分为多图层 PSD
                </>
              )}
            </button>

            {error && (
              <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-500">
                {error}
              </p>
            )}

            {result && (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl bg-[var(--nav-active-fill)] px-4 py-3">
                  <p className="text-[13px] font-medium text-[color:var(--foreground)]">
                    已生成 {result.layer_count} 个图层
                    {result.size_bytes ? ` · ${formatFileSize(result.size_bytes)}` : ""}
                  </p>
                  {result.analysis && (
                    <p className="mt-1 text-[11px] text-[color:var(--label-secondary)]">
                      引擎 {result.engine ?? result.analysis.engine ?? "unknown"}
                      {result.analysis.provider ? ` · ${result.analysis.provider}` : ""}
                      {result.analysis.paper ? ` · ${result.analysis.paper}` : ""}
                      {result.analysis.high_quality ? " · 高质量" : ""}
                      {typeof result.analysis.refined_blocks === "number"
                        ? ` · 精修 ${result.analysis.refined_blocks} 块`
                        : ""}
                      {typeof result.analysis.total_api_calls === "number"
                        ? ` · API ${result.analysis.total_api_calls} 次`
                        : ""}
                      {typeof result.analysis.qr_blocks === "number" && result.analysis.qr_blocks > 0
                        ? ` · QR ${result.analysis.qr_blocks}`
                        : ""}
                      {typeof result.analysis.text_blocks === "number"
                        ? ` · 文字 ${result.analysis.text_blocks}`
                        : ""}
                      {typeof result.analysis.image_blocks === "number"
                        ? ` · 图片 ${result.analysis.image_blocks}`
                        : ""}
                    </p>
                  )}
                  {result.progress && result.progress.length > 0 && (
                    <p className="mt-1 text-[11px] text-[color:var(--label-secondary)]">
                      流水线:{" "}
                      {result.progress
                        .map((p) => `${PIPELINE_STAGE_LABELS[p.stage] ?? p.stage}✓`)
                        .join(" → ")}
                    </p>
                  )}
                  {result.analysis?.paper_url && (
                    <a
                      href={result.analysis.paper_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block text-[11px] text-[color:var(--accent)] hover:underline"
                    >
                      文档: {result.analysis.paper ?? "百炼图像编辑 API"}
                    </a>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleDownload}
                  className="w-full rounded-xl border border-[color:var(--separator)] px-4 py-2.5 text-[13px] font-medium text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
                >
                  下载 {result.filename}
                </button>

                <div className="space-y-2">
                  <p className="text-[12px] font-medium text-[color:var(--label-secondary)]">
                    图层列表
                  </p>
                  {result.layers.map((layer, index) => (
                    <div
                      key={`${layer.name}-${index}`}
                      className="flex items-start gap-3 rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--nav-active-fill)] text-[10px] font-semibold text-[color:var(--label-secondary)]">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-[color:var(--foreground)]">
                          {layer.name}
                          <span className="ml-2 text-[11px] font-normal text-[color:var(--label-secondary)]">
                            {LAYER_TYPE_LABELS[layer.type] || layer.type}
                          </span>
                          {layer.replaceable && (
                            <span className="ml-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                              可替换
                            </span>
                          )}
                        </p>
                        {layer.description && (
                          <p className="truncate text-[11px] text-[color:var(--label-secondary)]">
                            {layer.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        ok
          ? "bg-emerald-500/10 text-emerald-600"
          : "bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}
