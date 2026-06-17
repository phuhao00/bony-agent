"use client";

import { ImagePlus, Loader2, Sparkles, Type, X } from "lucide-react";
import { useRef, useState } from "react";

export type InpaintMethod = "generate" | "replace";

export interface InpaintReferenceImage {
  displayUrl: string;
  publicUrl: string;
}

interface ImageEditInpaintPanelProps {
  method: InpaintMethod;
  onMethodChange: (method: InpaintMethod) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  reference: InpaintReferenceImage | null;
  onReferenceChange: (ref: InpaintReferenceImage | null) => void;
  aiBlend?: boolean;
  onAiBlendChange?: (enabled: boolean) => void;
  presets: { label: string; prompt: string }[];
  loading?: boolean;
  showAdvanced?: boolean;
  onToggleAdvanced?: () => void;
  advancedSlot?: React.ReactNode;
  onSubmit: () => void;
}

async function uploadReferenceFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/tools/upload-bg", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok || !data.public_url) {
    throw new Error(data.error || "上传失败");
  }
  return data.public_url as string;
}

export default function ImageEditInpaintPanel({
  method,
  onMethodChange,
  prompt,
  onPromptChange,
  reference,
  onReferenceChange,
  aiBlend = false,
  onAiBlendChange,
  presets,
  loading = false,
  showAdvanced,
  onToggleAdvanced,
  advancedSlot,
  onSubmit,
}: ImageEditInpaintPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const publicUrl = await uploadReferenceFile(file);
      const displayUrl = URL.createObjectURL(file);
      onReferenceChange({ displayUrl, publicUrl });
      onMethodChange("replace");
    } catch {
      alert("参考图上传失败");
    } finally {
      setUploading(false);
    }
  };

  const ready =
    method === "generate" ? Boolean(prompt.trim()) : Boolean(reference?.publicUrl);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onMethodChange("generate")}
          className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
            method === "generate"
              ? "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--card-bg))]"
              : "border-[color:var(--separator-subtle)] hover:bg-[var(--nav-active-fill)]"
          }`}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--foreground)]">
            <Type className="h-3.5 w-3.5" /> AI 文字生成
          </span>
          <span className="text-[11px] leading-snug text-[color:var(--label-secondary)]">
            涂抹选区后，用文字描述要生成的内容
          </span>
        </button>
        <button
          type="button"
          onClick={() => onMethodChange("replace")}
          className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
            method === "replace"
              ? "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--card-bg))]"
              : "border-[color:var(--separator-subtle)] hover:bg-[var(--nav-active-fill)]"
          }`}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--foreground)]">
            <ImagePlus className="h-3.5 w-3.5" /> 参考图替换
          </span>
          <span className="text-[11px] leading-snug text-[color:var(--label-secondary)]">
            将参考图直接贴入选区（默认所见即所得）
          </span>
        </button>
      </div>

      {method === "replace" && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[color:var(--foreground)]">替换素材 *</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          {reference ? (
            <div className="relative overflow-hidden rounded-lg border border-[color:var(--separator-subtle)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={reference.displayUrl} alt="参考素材" className="max-h-36 w-full object-contain bg-[var(--chrome-rail-bg)]" />
              <button
                type="button"
                onClick={() => onReferenceChange(null)}
                className="absolute right-2 top-2 rounded-full bg-black/55 p-1 text-white hover:bg-black/70"
                aria-label="移除参考图"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-6 text-sm text-[color:var(--label-secondary)] hover:border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
            >
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ImagePlus className="h-5 w-5" />
              )}
              上传要替换进去的素材图
            </button>
          )}
          {onAiBlendChange && (
            <label className="flex items-start gap-2 text-xs text-[color:var(--label-secondary)]">
              <input
                type="checkbox"
                checked={aiBlend}
                onChange={(e) => onAiBlendChange(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <span>
                AI 边缘融合（可选，需 Google API）
                <span className="mt-0.5 block text-[10px] opacity-80">
                  不勾选则直接贴图，不会整区 AI 重绘
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium text-[color:var(--foreground)]">
          {method === "generate" ? "编辑描述 *" : "补充说明（可选）"}
        </label>
        {presets.length > 0 && method === "generate" && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onPromptChange(p.prompt)}
                className="rounded-full border border-[color:var(--separator-subtle)] px-2.5 py-1 text-xs text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder={
            method === "generate"
              ? "描述局部重绘的效果，例如：换成红色连帽卫衣…"
              : "建议填写：匹配原图插画风/写实风格，保留周围透视与光照…"
          }
          rows={4}
          className="w-full resize-none rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_40%,transparent)]"
        />
      </div>

      <p className="text-xs text-[color:var(--label-secondary)]">
        先用画笔/矩形/套索<strong className="font-medium">贴紧</strong>要
        {method === "replace" ? "替换" : "重绘"}的区域。参考图替换=把素材图贴进选区。
      </p>

      {onToggleAdvanced && (
        <button
          type="button"
          onClick={onToggleAdvanced}
          className="flex w-full items-center justify-between rounded-lg bg-[var(--nav-active-fill)] px-3 py-2 text-xs text-[color:var(--label-secondary)]"
        >
          高级参数
          {showAdvanced ? "▲" : "▼"}
        </button>
      )}

      {showAdvanced && advancedSlot}

      <button
        type="button"
        disabled={loading || !ready}
        onClick={onSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        开始编辑
      </button>
    </div>
  );
}
