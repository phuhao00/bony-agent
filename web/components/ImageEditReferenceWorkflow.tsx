"use client";

import {
  getReferenceIntent,
  primaryReferenceIntents,
  REFERENCE_ROLES,
  referenceWorkflowReady,
  secondaryReferenceIntents,
  type ReferenceImageRole,
  type ReferenceIntent,
} from "@/lib/image-edit-reference-intents";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

export interface ReferenceImageItem {
  id: string;
  displayUrl: string;
  publicUrl: string;
  role: ReferenceImageRole;
}

interface ImageEditReferenceWorkflowProps {
  sourcePreviewUrl: string | null;
  intent: ReferenceIntent;
  onIntentChange: (intent: ReferenceIntent) => void;
  target: string;
  onTargetChange: (target: string) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  items: ReferenceImageItem[];
  maxCount?: number;
  onAdd: (displayUrl: string, publicUrl: string, role: ReferenceImageRole) => void;
  onRemove: (id: string) => void;
  onRoleChange: (id: string, role: ReferenceImageRole) => void;
  onSubmit: () => void;
  loading?: boolean;
  showAdvanced?: boolean;
  onToggleAdvanced?: () => void;
  advancedSlot?: React.ReactNode;
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

function PipelineThumb({
  label,
  src,
  emptyLabel,
  onClick,
  onDropFiles,
  accent = false,
}: {
  label: string;
  src?: string | null;
  emptyLabel: string;
  onClick?: () => void;
  onDropFiles?: (files: FileList) => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files?.length && onDropFiles) {
          onDropFiles(e.dataTransfer.files);
        }
      }}
      className={`group relative flex aspect-square w-full flex-col overflow-hidden rounded-xl border-2 transition-all ${
        accent
          ? "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_6%,var(--card-bg))]"
          : src
            ? "border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)]"
            : "border-dashed border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] hover:border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
      }`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-2 text-[color:var(--label-secondary)] group-hover:text-[color:var(--foreground)]">
          <ImagePlus className="h-5 w-5 opacity-70" />
          <span className="text-center text-[10px] leading-tight">{emptyLabel}</span>
        </div>
      )}
      <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-left text-[10px] font-medium text-white">
        {label}
      </span>
    </button>
  );
}

export default function ImageEditReferenceWorkflow({
  sourcePreviewUrl,
  intent,
  onIntentChange,
  target,
  onTargetChange,
  prompt,
  onPromptChange,
  items,
  maxCount = 2,
  onAdd,
  onRemove,
  onRoleChange,
  onSubmit,
  loading = false,
  showAdvanced,
  onToggleAdvanced,
  advancedSlot,
}: ImageEditReferenceWorkflowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showMoreIntents, setShowMoreIntents] = useState(
    () => !getReferenceIntent(intent).primary,
  );
  const [showTargetField, setShowTargetField] = useState(
    () => intent === "partial_replace" || Boolean(target.trim()),
  );

  const intentDef = getReferenceIntent(intent);
  const primary = primaryReferenceIntents();
  const secondary = secondaryReferenceIntents();
  const canAdd = items.length < maxCount;

  const readiness = referenceWorkflowReady({
    hasSource: Boolean(sourcePreviewUrl),
    refCount: items.length,
    intent,
    target,
    prompt,
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || !canAdd) return;
    const remaining = maxCount - items.length;
    const list = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, remaining);

    const defaultRole: ReferenceImageRole =
      intent === "style_transfer" ? "style" : "material";

    setUploading(true);
    for (const file of list) {
      try {
        const publicUrl = await uploadReferenceFile(file);
        const displayUrl = URL.createObjectURL(file);
        onAdd(displayUrl, publicUrl, defaultRole);
      } catch (err) {
        alert(String(err));
        break;
      }
    }
    setUploading(false);
  };

  const pickIntent = (id: ReferenceIntent) => {
    onIntentChange(id);
    if (id === "partial_replace") setShowTargetField(true);
    if (!getReferenceIntent(id).primary) setShowMoreIntents(true);
  };

  const slots = Array.from({ length: maxCount }, (_, i) => items[i] ?? null);

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-[color:var(--foreground)]">想做什么？</h3>
          <span className="text-[10px] text-[color:var(--label-secondary)]">选一种最接近的方式</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {primary.map((item) => {
            const Icon = item.icon;
            const active = intent === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => pickIntent(item.id)}
                className={`flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-all ${
                  active
                    ? "border-[color:color-mix(in_srgb,var(--accent)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--card-bg))] shadow-sm"
                    : "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] hover:border-[color:color-mix(in_srgb,var(--accent)_25%,transparent)]"
                }`}
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    active
                      ? "bg-[color:color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)]"
                      : "bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className={`text-sm ${active ? "font-semibold" : "font-medium"} text-[color:var(--foreground)]`}>
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-[color:var(--label-secondary)]">
                    {item.tagline}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setShowMoreIntents((v) => !v)}
          className="flex w-full items-center justify-center gap-1 py-1 text-xs text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
        >
          {showMoreIntents ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showMoreIntents ? "收起更多方式" : "更多方式：只换材质 / 指定区域…"}
        </button>

        {showMoreIntents && (
          <div className="grid grid-cols-2 gap-2">
            {secondary.map((item) => {
              const Icon = item.icon;
              const active = intent === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => pickIntent(item.id)}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--card-bg))]"
                      : "border-[color:var(--separator-subtle)] hover:bg-[var(--nav-active-fill)]"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? "text-[var(--accent)]" : "text-[color:var(--label-secondary)]"}`} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[color:var(--foreground)]">{item.label}</p>
                    <p className="truncate text-[10px] text-[color:var(--label-secondary)]">{item.tagline}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <p className="rounded-lg bg-[var(--nav-active-fill)] px-3 py-2 text-xs leading-relaxed text-[color:var(--label-secondary)]">
          {intentDef.hint}
          <span className="mx-1.5 text-[color:var(--separator-subtle)]">·</span>
          {intentDef.lockLayout && intentDef.lockShape
            ? "保持原图形状与布局"
            : intentDef.lockShape
              ? "保持形状，布局可调整"
              : "形状与布局均可调整"}
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[color:var(--foreground)]">图片怎么配？</h3>
        <div className="flex items-center gap-2">
          <div className="w-[72px] shrink-0 sm:w-[80px]">
            <PipelineThumb label="原图" src={sourcePreviewUrl} emptyLabel="左侧上传" accent />
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)] opacity-50" />
          <div className="grid flex-1 grid-cols-2 gap-2">
            {slots.map((slot, index) =>
              slot ? (
                <div key={slot.id} className="space-y-1.5">
                  <div className="group relative aspect-square overflow-hidden rounded-xl border border-[color:var(--separator-subtle)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={slot.displayUrl} alt={`参考${index + 1}`} className="h-full w-full object-cover" />
                    <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[10px] text-white">
                      参考 {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemove(slot.id)}
                      className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="移除"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {REFERENCE_ROLES.map((role) => (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => onRoleChange(slot.id, role.id)}
                        className={`rounded-md px-1.5 py-0.5 text-[10px] transition-colors ${
                          slot.role === role.id
                            ? "bg-[color:color-mix(in_srgb,var(--accent)_18%,var(--card-bg))] font-medium text-[color:var(--foreground)]"
                            : "text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
                        }`}
                      >
                        {role.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <PipelineThumb
                  key={`empty-${index}`}
                  label={`参考 ${index + 1}`}
                  emptyLabel={uploading ? "上传中…" : "点击添加"}
                  onClick={() => !uploading && inputRef.current?.click()}
                  onDropFiles={(files) => void handleFiles(files)}
                />
              ),
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-[11px] text-[color:var(--label-secondary)]">
          左侧画布是你的原图；这里添加 1–{maxCount} 张参考素材，点标签说明每张图的用途。
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[color:var(--foreground)]">具体怎么改？</h3>

        {intentDef.examples.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {intentDef.examples.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  if (ex.target) {
                    onTargetChange(ex.target);
                    setShowTargetField(true);
                  }
                  onPromptChange(ex.prompt);
                }}
                className="rounded-full border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[color:var(--label-secondary)] transition-colors hover:border-[color:color-mix(in_srgb,var(--accent)_30%,transparent)] hover:text-[color:var(--foreground)]"
              >
                试试：{ex.label}
              </button>
            ))}
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder={intentDef.promptPlaceholder}
          rows={3}
          className="w-full resize-none rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
        />

        {(intent === "partial_replace" || showTargetField) && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[color:var(--foreground)]">
              {intentDef.targetLabel}
              {intent === "partial_replace" ? " *" : ""}
            </span>
            <input
              type="text"
              value={target}
              onChange={(e) => onTargetChange(e.target.value)}
              placeholder={intentDef.targetPlaceholder}
              className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
            />
          </label>
        )}

        {intent !== "partial_replace" && !showTargetField && (
          <button
            type="button"
            onClick={() => setShowTargetField(true)}
            className="text-xs text-[color:var(--label-secondary)] underline-offset-2 hover:text-[color:var(--foreground)] hover:underline"
          >
            + 指定要改的对象（可选）
          </button>
        )}
      </section>

      <div className="space-y-3 border-t border-[color:var(--separator-subtle)] pt-4">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {[
            { ok: Boolean(sourcePreviewUrl), label: "原图" },
            { ok: items.length > 0, label: "参考素材" },
            {
              ok:
                intent === "partial_replace"
                  ? Boolean(target.trim())
                  : Boolean(prompt.trim() || target.trim()),
              label: "编辑描述",
            },
          ].map(({ ok, label }) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1 ${
                ok ? "text-emerald-600 dark:text-emerald-400" : "text-[color:var(--label-secondary)]"
              }`}
            >
              <Check className={`h-3.5 w-3.5 ${ok ? "opacity-100" : "opacity-30"}`} />
              {label}
            </span>
          ))}
        </div>

        {onToggleAdvanced && (
          <button
            type="button"
            onClick={onToggleAdvanced}
            className="flex w-full items-center justify-between rounded-lg bg-[var(--nav-active-fill)] px-3 py-2 text-xs text-[color:var(--label-secondary)]"
          >
            高级参数
            {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
        {showAdvanced && advancedSlot}

        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || !readiness.ready || !sourcePreviewUrl}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              生成中…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {readiness.ready ? "开始生成" : `还差：${readiness.missing.join("、")}`}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
