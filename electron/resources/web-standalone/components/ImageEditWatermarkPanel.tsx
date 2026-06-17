"use client";

import { Eraser, Loader2, ScanText, Sparkles, Target } from "lucide-react";

import { looksLikeWatermarkTarget } from "@/lib/image-edit-watermark";

export type WatermarkMethod = "auto" | "area" | "text";

interface ImageEditWatermarkPanelProps {
  method: WatermarkMethod;
  onMethodChange: (method: WatermarkMethod) => void;
  targetText: string;
  onTargetTextChange: (text: string) => void;
  includeAliases: boolean;
  onIncludeAliasesChange: (value: boolean) => void;
  supplement: string;
  onSupplementChange: (text: string) => void;
  loading?: boolean;
  showAdvanced?: boolean;
  onToggleAdvanced?: () => void;
  advancedSlot?: React.ReactNode;
  onSubmit: () => void;
}

export default function ImageEditWatermarkPanel({
  method,
  onMethodChange,
  targetText,
  onTargetTextChange,
  includeAliases,
  onIncludeAliasesChange,
  supplement,
  onSupplementChange,
  loading = false,
  showAdvanced,
  onToggleAdvanced,
  advancedSlot,
  onSubmit,
}: ImageEditWatermarkPanelProps) {
  const autoUsesTextMode =
    method === "auto" &&
    Boolean(targetText.trim() || looksLikeWatermarkTarget(supplement));

  const ready =
    method === "auto" ||
    method === "area" ||
    (method === "text" && Boolean(targetText.trim() || looksLikeWatermarkTarget(supplement)));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onMethodChange("auto")}
          className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
            method === "auto"
              ? "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--card-bg))]"
              : "border-[color:var(--separator-subtle)] hover:bg-[var(--nav-active-fill)]"
          }`}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--foreground)]">
            <Sparkles className="h-3.5 w-3.5" /> 智能全图
          </span>
          <span className="text-[11px] leading-snug text-[color:var(--label-secondary)]">
            AI 全图去水印；若补充说明里写了具体文字，会自动改用精准本地修复
          </span>
        </button>
        <button
          type="button"
          onClick={() => onMethodChange("area")}
          className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
            method === "area"
              ? "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--card-bg))]"
              : "border-[color:var(--separator-subtle)] hover:bg-[var(--nav-active-fill)]"
          }`}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--foreground)]">
            <Target className="h-3.5 w-3.5" /> 指定区域
          </span>
          <span className="text-[11px] leading-snug text-[color:var(--label-secondary)]">
            涂抹水印所在区域，只处理选区
          </span>
        </button>
        <button
          type="button"
          onClick={() => onMethodChange("text")}
          className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
            method === "text"
              ? "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--card-bg))]"
              : "border-[color:var(--separator-subtle)] hover:bg-[var(--nav-active-fill)]"
          }`}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--foreground)]">
            <ScanText className="h-3.5 w-3.5" /> 指定文字
          </span>
          <span className="text-[11px] leading-snug text-[color:var(--label-secondary)]">
            OCR 精准定位目标文字，本地修复（推荐）
          </span>
        </button>
      </div>

      {method === "text" && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-[color:var(--foreground)]">
            水印文字 *
          </label>
          <input
            type="text"
            value={targetText}
            onChange={(e) => onTargetTextChange(e.target.value)}
            placeholder="例如：一泽达、©2024、sample.com"
            className="w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_40%,transparent)]"
          />
          <label className="flex cursor-pointer items-start gap-2 text-xs text-[color:var(--label-secondary)]">
            <input
              type="checkbox"
              checked={includeAliases}
              onChange={(e) => onIncludeAliasesChange(e.target.checked)}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              同时匹配英文/拼音变体（如 YIZEDA）。默认只去除与输入完全一致的文字，避免误删。
            </span>
          </label>
        </div>
      )}

      {method === "area" && (
        <p className="flex items-start gap-2 rounded-lg bg-[var(--nav-active-fill)] px-3 py-2 text-xs text-[color:var(--label-secondary)]">
          <Eraser className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          在左侧图片上用画笔/矩形/套索<strong className="font-medium">贴紧水印</strong>
          涂抹，支持 ⌘Z 撤销。
        </p>
      )}

      {autoUsesTextMode && (
        <p className="rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_25%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--card-bg))] px-3 py-2 text-xs text-[color:var(--label-secondary)]">
          检测到具体水印文字，将使用<strong className="font-medium text-[color:var(--foreground)]">指定文字 + 本地修复</strong>
          ，不会全图 AI 重绘。
        </p>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium text-[color:var(--foreground)]">
          补充说明（可选）
        </label>
        <textarea
          value={supplement}
          onChange={(e) => onSupplementChange(e.target.value)}
          placeholder={
            method === "area"
              ? "例如：保留周围金色边框纹理，不要模糊二维码以外的文字"
              : method === "text"
                ? "例如：只处理顶部横幅，保留正文"
                : "留空则 AI 全图去水印；若填写具体文字（如「一泽达」）将自动精准本地修复"
          }
          rows={3}
          className="w-full resize-none rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_40%,transparent)]"
        />
      </div>

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
        开始去水印
      </button>
    </div>
  );
}
