"use client";

import UnifiedMediaSelector from "@/app/components/UnifiedMediaSelector";
import ImageCompareSlider from "@/components/ImageCompareSlider";
import ImageEditBatchPanel, { type BatchEditItem } from "@/components/ImageEditBatchPanel";
import ImageEditCanvas, { type ImageEditCanvasHandle, type MaskTool } from "@/components/ImageEditCanvas";
import ImageEditExportMenu from "@/components/ImageEditExportMenu";
import ImageEditHistoryPicker from "@/components/ImageEditHistoryPicker";
import ImageEditSessionBar, { type EditSessionItem } from "@/components/ImageEditSessionBar";
import ImageEditInpaintPanel, {
  type InpaintMethod,
  type InpaintReferenceImage,
} from "@/components/ImageEditInpaintPanel";
import ImageEditWatermarkPanel, {
  type WatermarkMethod,
} from "@/components/ImageEditWatermarkPanel";
import ImageEditReferenceWorkflow, {
  type ReferenceImageItem,
} from "@/components/ImageEditReferenceWorkflow";
import ImageEditVariantPicker from "@/components/ImageEditVariantPicker";
import {
  EDIT_MODE_CATEGORIES,
  getEditMode,
  modesForCategory,
  type EditCanvasMode,
  type EditModeCategory,
} from "@/lib/image-edit-modes";
import {
  resolveImageEditPlan,
  type ImageEditPlan,
} from "@/lib/image-edit-intent";
import {
  type ReferenceIntent,
} from "@/lib/image-edit-reference-intents";
import { extractImageUrls } from "@/lib/image-edit-utils";
import { resolveWatermarkSubmit } from "@/lib/image-edit-watermark";
import {
  handleMaskShortcutKey,
  shortcutModLabel,
} from "@/lib/image-edit-mask-shortcuts";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Eraser,
  Lasso,
  Layers,
  Paintbrush,
  Redo2,
  Sparkles,
  Square,
  Undo2,
  Upload,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function newSessionId() {
  return `edit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function ImageEditPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canvasRef = useRef<ImageEditCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);

  const initialSrc = searchParams.get("src") || "";

  const [category, setCategory] = useState<EditModeCategory>("content");
  const [mode, setMode] = useState<EditCanvasMode>("instruction");
  const [sourceUrl, setSourceUrl] = useState<string>(initialSrc);
  const [sourcePublicUrl, setSourcePublicUrl] = useState<string>("");
  const [displayUrl, setDisplayUrl] = useState<string>(initialSrc);
  const [prompt, setPrompt] = useState("");
  const [brushSize, setBrushSize] = useState(28);
  const [tool, setTool] = useState<MaskTool>("brush");
  const [expandTop, setExpandTop] = useState(1.2);
  const [expandBottom, setExpandBottom] = useState(1.2);
  const [expandLeft, setExpandLeft] = useState(1.2);
  const [expandRight, setExpandRight] = useState(1.2);
  const [strength, setStrength] = useState(0.5);
  const [variantCount, setVariantCount] = useState(1);
  const [seed, setSeed] = useState<string>("");
  const [upscaleFactor, setUpscaleFactor] = useState(2);
  const [isSketch, setIsSketch] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultUrls, setResultUrls] = useState<string[]>([]);
  const [selectedVariant, setSelectedVariant] = useState(0);
  const [resultText, setResultText] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"edit" | "compare">("edit");
  const [hasMask, setHasMask] = useState(false);
  const [sessionItems, setSessionItems] = useState<EditSessionItem[]>(() =>
    initialSrc
      ? [{ id: newSessionId(), url: initialSrc, label: "原图", mode: "instruction" }]
      : [],
  );
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    initialSrc ? sessionItems[0]?.id ?? null : null,
  );
  const [sessionCursor, setSessionCursor] = useState(0);
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchEditItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [referenceImages, setReferenceImages] = useState<ReferenceImageItem[]>([]);
  const [referenceIntent, setReferenceIntent] = useState<ReferenceIntent>("replace_material");
  const [referenceTarget, setReferenceTarget] = useState("");
  const [inpaintMethod, setInpaintMethod] = useState<InpaintMethod>("generate");
  const [inpaintReference, setInpaintReference] = useState<InpaintReferenceImage | null>(null);
  const [inpaintAiBlend, setInpaintAiBlend] = useState(false);
  const [watermarkMethod, setWatermarkMethod] = useState<WatermarkMethod>("text");
  const [watermarkText, setWatermarkText] = useState("");
  const [watermarkIncludeAliases, setWatermarkIncludeAliases] = useState(false);
  const [lastMaskPublicUrl, setLastMaskPublicUrl] = useState("");

  const [logoMotionStyle, setLogoMotionStyle] = useState("subtle");
  const [logoMotionDuration, setLogoMotionDuration] = useState(1500);
  const [logoMotionResult, setLogoMotionResult] = useState<{
    html_url?: string;
    svg_url?: string;
    css_url?: string;
    render_url?: string;
    strip_url?: string;
    metrics?: { iou?: number };
    error?: string;
  } | null>(null);

  const modeDef = getEditMode(mode);
  const isReferenceMode = mode === "reference";
  const currentEditPlan = useMemo(
    () =>
      resolveImageEditPlan({
        prompt,
        selectedMode: mode,
        hasMask,
        hasReferenceImages: referenceImages.length > 0,
        inpaintMethod,
        hasInpaintReference: Boolean(inpaintReference?.publicUrl),
        watermarkMethod,
        hasWatermarkText: Boolean(watermarkText.trim()),
      }),
    [
      hasMask,
      inpaintMethod,
      inpaintReference?.publicUrl,
      mode,
      prompt,
      referenceImages.length,
      watermarkMethod,
      watermarkText,
    ],
  );
  const needsMaskNow = currentEditPlan.needsMask;
  const hasImage = Boolean(displayUrl);
  const resultUrl = resultUrls[selectedVariant] ?? null;
  const maskShortcutsEnabled =
    hasImage && needsMaskNow && !loading && viewMode === "edit";
  const modLabel = useMemo(() => shortcutModLabel(), []);

  useEffect(() => {
    if (!maskShortcutsEnabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      handleMaskShortcutKey(e, canvasRef, { setTool, setBrushSize });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maskShortcutsEnabled]);

  const resolveExportSourceUrl = useCallback((): string | undefined => {
    for (const url of [sourcePublicUrl, displayUrl, sourceUrl]) {
      if (url && !url.startsWith("blob:")) return url;
    }
    return undefined;
  }, [sourcePublicUrl, displayUrl, sourceUrl]);

  const compareBeforeSrc = resolveExportSourceUrl() || displayUrl || "";

  const pushSession = useCallback((url: string, label: string, editMode: EditCanvasMode) => {
    const id = newSessionId();
    setSessionCursor((cursor) => {
      setSessionItems((prev) => [...prev.slice(0, cursor + 1), { id, url, label, mode: editMode }]);
      setCurrentSessionId(id);
      return cursor + 1;
    });
    return id;
  }, []);

  const loadImage = useCallback(
    (url: string, publicUrl = "", sessionId?: string | null) => {
      setDisplayUrl(url);
      setSourceUrl(publicUrl || url);
      setSourcePublicUrl(publicUrl);
      if (sessionId) setCurrentSessionId(sessionId);
      setResultUrls([]);
      setResultText(null);
      setViewMode("edit");
      setHasMask(false);
      canvasRef.current?.clearMask();
      setInpaintReference(null);
      setWatermarkMethod("auto");
      setWatermarkText("");
    },
    [],
  );

  const processFile = useCallback(
    async (file: File, label = "原图") => {
      if (!file.type.startsWith("image/")) return;
      try {
        const publicUrl = await uploadFile(file);
        const blobUrl = URL.createObjectURL(file);
        const id = newSessionId();
        setSessionItems([{ id, url: blobUrl, label, mode: "instruction" }]);
        setSessionCursor(0);
        loadImage(blobUrl, publicUrl, id);
      } catch (err) {
        alert(String(err));
      }
    },
    [loadImage],
  );

  const loadFromHistory = useCallback(
    (url: string, label: string) => {
      const id = newSessionId();
      setSessionItems([{ id, url, label, mode: "instruction" }]);
      setSessionCursor(0);
      loadImage(url, url.startsWith("/api/media/") ? url : url, id);
    },
    [loadImage],
  );

  const addCurrentToBatch = useCallback(() => {
    if (!displayUrl) return;
    setBatchItems((prev) => {
      if (prev.some((i) => i.sourceUrl === (sourcePublicUrl || sourceUrl))) return prev;
      return [
        ...prev,
        {
          id: newSessionId(),
          displayUrl,
          sourceUrl: sourcePublicUrl || sourceUrl || displayUrl,
          label: `图片 ${prev.length + 1}`,
          status: "pending",
        },
      ];
    });
  }, [displayUrl, sourcePublicUrl, sourceUrl]);

  const processBatchFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    for (const file of list) {
      try {
        const publicUrl = await uploadFile(file);
        const blobUrl = URL.createObjectURL(file);
        setBatchItems((prev) => [
          ...prev,
          {
            id: newSessionId(),
            displayUrl: blobUrl,
            sourceUrl: publicUrl,
            label: file.name.slice(0, 24),
            status: "pending" as const,
          },
        ]);
      } catch {
        // skip failed uploads
      }
    }
  }, []);

  const buildEditBody = useCallback(
    (
      source: string,
      maskPublicUrl?: string,
      plan: ImageEditPlan = currentEditPlan,
    ): Record<string, unknown> => {
      const submitMode = plan.submitMode;
      const body: Record<string, unknown> = {
        source_image_url: source,
        prompt: prompt.trim(),
        mode: submitMode,
        mask_image_url: plan.needsMask ? maskPublicUrl : undefined,
        strength,
        n: variantCount,
        upscale_factor: upscaleFactor,
        is_sketch: isSketch,
        edit_intent: plan.submitMode,
        client_plan_reason: plan.reason,
      };
      if (plan.bodyPatch) Object.assign(body, plan.bodyPatch);
      if (seed.trim()) body.seed = Number(seed);
      if (submitMode === "reference" && referenceImages.length) {
        body.reference_image_urls = referenceImages.map((r) => r.publicUrl);
        body.reference_intent = referenceIntent;
        body.reference_target = referenceTarget.trim();
        body.reference_roles = referenceImages.map((r) => r.role);
      }
      if (submitMode === "inpaint" && inpaintMethod === "replace" && inpaintReference?.publicUrl) {
        body.reference_image_urls = [inpaintReference.publicUrl];
        body.inpaint_ai_blend = inpaintAiBlend;
      }
      if (submitMode === "watermark") {
        const wm = resolveWatermarkSubmit(
          watermarkMethod,
          watermarkText,
          prompt,
          watermarkIncludeAliases,
        );
        body.watermark_mode = wm.mode;
        if (wm.watermarkText) body.watermark_text = wm.watermarkText;
        if (wm.includeAliases) body.watermark_text_include_aliases = true;
        body.prompt = wm.prompt;
      }
      if (submitMode === "outpaint") {
        body.expand_top = expandTop;
        body.expand_bottom = expandBottom;
        body.expand_left = expandLeft;
        body.expand_right = expandRight;
      }
      return body;
    },
    [
      prompt,
      currentEditPlan,
      strength,
      variantCount,
      upscaleFactor,
      isSketch,
      seed,
      expandTop,
      expandBottom,
      expandLeft,
      expandRight,
      referenceImages,
      referenceIntent,
      referenceTarget,
      inpaintMethod,
      inpaintReference,
      inpaintAiBlend,
      watermarkMethod,
      watermarkText,
      watermarkIncludeAliases,
    ],
  );

  const handleBatchRun = useCallback(async () => {
    const batchPlan = resolveImageEditPlan({
      prompt,
      selectedMode: mode,
      hasMask: false,
      hasReferenceImages: false,
      inpaintMethod,
      hasInpaintReference: false,
      watermarkMethod,
      hasWatermarkText: Boolean(watermarkText.trim()),
    });
    if (batchPlan.needsMask || batchPlan.needsReference) {
      alert("批量编辑不支持涂抹选区或参考图，请直接写自然语言指令后再执行批量");
      return;
    }
    if (batchPlan.missingRequirement) {
      alert("请输入要批量执行的编辑指令");
      return;
    }
    const pending = batchItems.filter((i) => i.status === "pending");
    if (!pending.length) return;

    setBatchRunning(true);
    setBatchProgress({ done: 0, total: pending.length });

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      setBatchItems((prev) =>
        prev.map((b) => (b.id === item.id ? { ...b, status: "running" } : b)),
      );

      try {
        const response = await fetch("/api/tools/image/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildEditBody(item.sourceUrl, undefined, batchPlan)),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || data.error || "编辑失败");
        const urls = extractImageUrls(data.result || "", data.image_urls);
        setBatchItems((prev) =>
          prev.map((b) =>
            b.id === item.id
              ? { ...b, status: "done", resultUrl: urls[0] || b.displayUrl }
              : b,
          ),
        );
      } catch (err) {
        setBatchItems((prev) =>
          prev.map((b) =>
            b.id === item.id ? { ...b, status: "error", error: String(err) } : b,
          ),
        );
      }
      setBatchProgress({ done: i + 1, total: pending.length });
    }

    setBatchRunning(false);
  }, [
    batchItems,
    buildEditBody,
    inpaintMethod,
    mode,
    prompt,
    watermarkMethod,
    watermarkText,
  ]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
    e.target.value = "";
  };

  const resolveSourceForApi = useCallback(async (): Promise<string> => {
    // 需要蒙版时优先用已上传 URL，保证与蒙版像素坐标一致
    if (needsMaskNow && sourcePublicUrl) {
      return sourcePublicUrl;
    }
    if (needsMaskNow && displayUrl) {
      try {
        const res = await fetch(displayUrl);
        const blob = await res.blob();
        if (blob.size > 0) {
          return uploadFile(
            new File([blob], "source.png", { type: blob.type || "image/png" }),
          );
        }
      } catch {
        // fall through
      }
    }
    if (sourcePublicUrl) return sourcePublicUrl;
    if (sourceUrl.startsWith("/api/media/")) return sourceUrl;
    if (sourceUrl.startsWith("http")) return sourceUrl;
    if (displayUrl.startsWith("/api/media/") || displayUrl.startsWith("http")) {
      return displayUrl;
    }
    if (displayUrl.startsWith("blob:")) {
      const res = await fetch(displayUrl);
      const blob = await res.blob();
      return uploadFile(new File([blob], "source.png", { type: blob.type || "image/png" }));
    }
    return sourceUrl || displayUrl;
  }, [needsMaskNow, displayUrl, sourcePublicUrl, sourceUrl]);

  const handleEdit = async () => {
    if (!sourceUrl && !displayUrl) {
      alert("请先上传图片");
      return;
    }

    if (mode === "logoMotion") {
      await handleLogoMotion();
      return;
    }

    const hasCurrentMask = Boolean(canvasRef.current?.hasMask());
    const plan = resolveImageEditPlan({
      prompt,
      selectedMode: mode,
      hasMask: hasCurrentMask,
      hasReferenceImages: referenceImages.length > 0,
      inpaintMethod,
      hasInpaintReference: Boolean(inpaintReference?.publicUrl),
      watermarkMethod,
      hasWatermarkText: Boolean(watermarkText.trim()),
    });
    const submitMode = plan.submitMode;
    const submitModeDef = getEditMode(submitMode);
    const needsSubmitMask = plan.needsMask;

    if (plan.missingRequirement) {
      const messages: Record<string, string> = {
        prompt: "请输入你想怎么改，比如：帮我加一只小猫在图片上",
        mask: "请先涂抹要精准编辑的区域，或直接写自然语言指令由系统自由编辑",
        reference: "请上传参考图，或直接写自然语言指令由系统自由编辑",
        watermarkText: "请输入要去掉的水印文字，或切换到「智能全图」",
      };
      alert(messages[plan.missingRequirement]);
      return;
    }
    if (needsSubmitMask && !hasCurrentMask) {
      alert("请用画笔涂抹要编辑的区域");
      return;
    }
    if (plan.needsReference && referenceImages.length === 0) {
      alert("请至少上传 1 张参考图");
      return;
    }

    setLoading(true);
    setResultUrls([]);
    setResultText(null);

    try {
      let maskPublicUrl: string | undefined;
      if (needsSubmitMask) {
        const blob = await canvasRef.current?.getMaskBlob();
        if (!blob) {
          alert("无法导出 mask，请重新涂抹");
          setLoading(false);
          return;
        }
        maskPublicUrl = await uploadFile(new File([blob], "mask.png", { type: "image/png" }));
        setLastMaskPublicUrl(maskPublicUrl);
      } else {
        setLastMaskPublicUrl("");
      }

      const body = buildEditBody(await resolveSourceForApi(), maskPublicUrl, plan);

      const response = await fetch("/api/tools/image/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.error || "编辑失败");
      }

      setResultText(data.result || "");
      const urls = extractImageUrls(data.result || "", data.image_urls);
      if (urls.length) {
        setResultUrls(urls);
        setSelectedVariant(0);
        setViewMode("compare");
        const resultLabel =
          data.model === "local-inpaint"
            ? `${submitModeDef.label}（本地修复）`
            : plan.label || submitModeDef.label;
        pushSession(urls[0], resultLabel, submitMode);
      } else {
        alert("编辑完成但未返回结果图，请查看后端日志或重试");
      }
    } catch (err) {
      setResultText(`编辑失败: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoMotion = async () => {
    if (!sourceUrl && !displayUrl) {
      alert("请先上传图片");
      return;
    }
    const motionPrompt = prompt.trim() || "让 Logo 优雅地淡入并带有轻微的向上浮动感";
    setLoading(true);
    setResultText(null);
    setResultUrls([]);
    setLogoMotionResult(null);
    try {
      const source = await resolveSourceForApi();
      const response = await fetch("/api/tools/image/logo-motion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_image_url: source,
          motion_brief: motionPrompt,
          style: logoMotionStyle,
          duration_ms: logoMotionDuration,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        const detail = data.detail || data.error || "生成失败";
        console.error("[logo-motion] backend error:", data);
        setLogoMotionResult({ ...data, error: detail });
        setResultText(`❌ Logo 动画生成失败: ${detail}`);
        throw new Error(detail);
      }
      setLogoMotionResult(data);
      setResultText(data.success ? "✅ Logo 动画已生成" : `生成失败: ${data.error || ""}`);
      if (data.render_url) {
        setResultUrls([data.render_url]);
      }
      // Use the static render PNG as the session thumbnail so the history bar
      // shows a real image instead of a broken HTML icon.
      const sessionThumb = data.render_url || data.strip_url || data.html_url;
      if (sessionThumb) {
        pushSession(sessionThumb, "Logo 动画", "logoMotion");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResultText((prev) => prev || `❌ Logo 动画生成失败: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const selectSessionItem = (item: EditSessionItem, index: number) => {
    setSessionCursor(index);
    setCurrentSessionId(item.id);
    loadImage(item.url, item.url.startsWith("blob:") ? sourcePublicUrl : item.url, item.id);
    if (index > 0) setMode(item.mode);
  };

  const sessionUndo = () => {
    if (sessionCursor <= 0) return;
    const prev = sessionItems[sessionCursor - 1];
    selectSessionItem(prev, sessionCursor - 1);
  };

  const sessionRedo = () => {
    if (sessionCursor >= sessionItems.length - 1) return;
    const next = sessionItems[sessionCursor + 1];
    selectSessionItem(next, sessionCursor + 1);
  };

  const continueWithResult = () => {
    if (!resultUrl) return;
    setDisplayUrl(resultUrl);
    setSourceUrl(resultUrl);
    setSourcePublicUrl(resultUrl.startsWith("/api/media/") || resultUrl.startsWith("http") ? resultUrl : "");
    setResultUrls([]);
    setViewMode("edit");
    setHasMask(false);
    canvasRef.current?.clearMask();
  };

  const outpaintPresets = useMemo(
    () => [
      { label: "1:1", t: 1, b: 1, l: 1, r: 1 },
      { label: "16:9 横屏", t: 1, b: 1, l: 1.5, r: 1.5 },
      { label: "9:16 竖屏", t: 1.5, b: 1.5, l: 1, r: 1 },
      { label: "全方向", t: 1.3, b: 1.3, l: 1.3, r: 1.3 },
    ],
    [],
  );

  return (
    <div className="h-full overflow-y-auto page-canvas">
      <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-6">
        <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
              aria-label="返回"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">图片编辑工作台</h1>
              <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
                自然语言修图 · 局部选区 · 参考图 · 批量处理
              </p>
            </div>
          </div>
          <UnifiedMediaSelector modality="image_edit" />
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        <input
          ref={batchInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) processBatchFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <ImageEditHistoryPicker
          open={showHistoryPicker}
          onClose={() => setShowHistoryPicker(false)}
          onSelect={loadFromHistory}
        />

        <div
          className={`grid grid-cols-1 gap-5 xl:items-start ${
            isReferenceMode
              ? "xl:grid-cols-[minmax(0,1fr)_460px]"
              : "xl:grid-cols-[minmax(0,1fr)_420px]"
          }`}
        >
          <div className="min-w-0 space-y-3">
            <ImageEditSessionBar
              items={sessionItems}
              currentId={currentSessionId}
              onSelect={(item) => {
                const idx = sessionItems.findIndex((s) => s.id === item.id);
                if (idx >= 0) selectSessionItem(item, idx);
              }}
              onUndo={sessionUndo}
              onRedo={sessionRedo}
              canUndo={sessionCursor > 0}
              canRedo={sessionCursor < sessionItems.length - 1}
            />

            {logoMotionResult && (
              <div className="space-y-3 rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-4">
                {logoMotionResult.error ? (
                  <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-900/20">
                    <p className="text-sm font-medium text-red-700 dark:text-red-300">生成失败</p>
                    <p className="break-all text-xs text-red-600 dark:text-red-200">{logoMotionResult.error}</p>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(logoMotionResult.error || "")}
                      className="rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-200"
                    >
                      复制错误
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium text-[color:var(--foreground)]">Logo 动画预览</p>
                    {logoMotionResult.render_url && (
                      <div className="overflow-hidden rounded-xl border border-[color:var(--separator-subtle)]">
                        <img
                          src={logoMotionResult.render_url}
                          alt="Logo 静态渲染"
                          className="w-full bg-[var(--card-bg)]"
                        />
                      </div>
                    )}
                    {logoMotionResult.html_url && (
                      <div className="overflow-hidden rounded-xl border border-[color:var(--separator-subtle)]">
                        <iframe
                          src={logoMotionResult.html_url}
                          title="Logo Motion"
                          className="h-[360px] w-full"
                          sandbox="allow-scripts allow-same-origin"
                        />
                      </div>
                    )}
                    {logoMotionResult.strip_url && (
                      <div className="overflow-hidden rounded-xl border border-[color:var(--separator-subtle)]">
                        <img
                          src={logoMotionResult.strip_url}
                          alt="Logo 动画帧序列"
                          className="w-full bg-[var(--card-bg)]"
                        />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {logoMotionResult.html_url && (
                        <a
                          href={logoMotionResult.html_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                        >
                          新窗口打开
                        </a>
                      )}
                      {logoMotionResult.svg_url && (
                        <a
                          href={logoMotionResult.svg_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-[color:var(--separator-subtle)] px-4 py-2 text-sm hover:bg-[var(--nav-active-fill)]"
                        >
                          下载 SVG
                        </a>
                      )}
                      {logoMotionResult.strip_url && (
                        <a
                          href={logoMotionResult.strip_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-[color:var(--separator-subtle)] px-4 py-2 text-sm hover:bg-[var(--nav-active-fill)]"
                        >
                          帧序列
                        </a>
                      )}
                    </div>
                    {typeof logoMotionResult.metrics?.iou === "number" && (
                      <p className="text-xs text-[color:var(--label-secondary)]">
                        拟合 IoU: {logoMotionResult.metrics.iou.toFixed(4)}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {resultUrl && viewMode === "compare" ? (
              <div className="space-y-3">
                <ImageCompareSlider beforeSrc={compareBeforeSrc} afterSrc={resultUrl} />
                <ImageEditVariantPicker
                  urls={resultUrls}
                  selectedIndex={selectedVariant}
                  onSelect={setSelectedVariant}
                />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setViewMode("edit")} className="rounded-lg bg-[var(--nav-active-fill)] px-4 py-2 text-sm">
                    返回编辑
                  </button>
                  <ImageEditExportMenu
                    resultUrl={resultUrl}
                    sourceUrl={resolveExportSourceUrl()}
                    maskUrl={lastMaskPublicUrl || undefined}
                  />
                  <a href={resultUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-[var(--nav-active-fill)] px-4 py-2 text-sm">
                    新窗口打开
                  </a>
                  <button type="button" onClick={continueWithResult} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                    继续编辑此结果
                  </button>
                </div>
              </div>
            ) : (
              <>
                <ImageEditCanvas
                  ref={canvasRef}
                  imageUrl={displayUrl || null}
                  mode={mode}
                  maskLayerEnabled={needsMaskNow}
                  brushSize={brushSize}
                  tool={tool}
                  loading={loading}
                  expandTop={expandTop}
                  expandBottom={expandBottom}
                  expandLeft={expandLeft}
                  expandRight={expandRight}
                  onFileDrop={(f) => processFile(f)}
                  onUploadClick={() => fileInputRef.current?.click()}
                  onMaskChange={setHasMask}
                />

                {hasImage && needsMaskNow && !loading && (
                  <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-2">
                    <button type="button" title={`画笔 (B)`} onClick={() => setTool("brush")} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${tool === "brush" ? "bg-red-500/15 text-red-500" : "hover:bg-[var(--nav-active-fill)]"}`}>
                      <Paintbrush className="h-3.5 w-3.5" /> 画笔
                    </button>
                    <button type="button" title={`矩形 (R)`} onClick={() => setTool("rectangle")} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${tool === "rectangle" ? "bg-red-500/15 text-red-500" : "hover:bg-[var(--nav-active-fill)]"}`}>
                      <Square className="h-3.5 w-3.5" /> 矩形
                    </button>
                    <button type="button" title={`套索 (L)`} onClick={() => setTool("lasso")} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${tool === "lasso" ? "bg-red-500/15 text-red-500" : "hover:bg-[var(--nav-active-fill)]"}`}>
                      <Lasso className="h-3.5 w-3.5" /> 套索
                    </button>
                    <button type="button" title={`橡皮 (E)`} onClick={() => setTool("eraser")} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${tool === "eraser" ? "bg-red-500/15 text-red-500" : "hover:bg-[var(--nav-active-fill)]"}`}>
                      <Eraser className="h-3.5 w-3.5" /> 橡皮
                    </button>
                    <label className="flex items-center gap-2 text-xs text-[color:var(--label-secondary)]" title="调整笔刷大小 ([ / ])">
                      大小
                      <input type="range" min={8} max={80} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-20" />
                      {brushSize}
                    </label>
                    <button type="button" title={`撤销 (${modLabel}Z)`} onClick={() => canvasRef.current?.undoMask()} className="rounded-lg p-2 hover:bg-[var(--nav-active-fill)]" aria-label="撤销涂抹">
                      <Undo2 className="h-4 w-4" />
                    </button>
                    <button type="button" title={`重做 (${modLabel}${modLabel === "⌘" ? "⇧Z" : "Shift+Z"})`} onClick={() => canvasRef.current?.redoMask()} className="rounded-lg p-2 hover:bg-[var(--nav-active-fill)]" aria-label="重做涂抹">
                      <Redo2 className="h-4 w-4" />
                    </button>
                    <button type="button" title="清除选区 (Delete)" onClick={() => canvasRef.current?.clearMask()} className="rounded-lg px-3 py-2 text-sm hover:bg-[var(--nav-active-fill)]">
                      清除
                    </button>
                    <p className="w-full basis-full text-center text-[10px] text-[color:var(--label-secondary)]">
                      {modLabel}Z 撤销 · {modLabel}{modLabel === "⌘" ? "⇧Z" : "Shift+Z"} 重做 · Delete 清除 · B/R/L/E 切换工具 · [ ] 调整大小
                    </p>
                  </div>
                )}

                {resultUrls.length > 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button type="button" onClick={() => setViewMode("compare")} className="flex-1 rounded-lg border border-[color:var(--separator-subtle)] py-2 text-sm text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]">
                      查看前后对比
                    </button>
                    {resultUrl && (
                      <ImageEditExportMenu
                        resultUrl={resultUrl}
                        sourceUrl={resolveExportSourceUrl()}
                        maskUrl={lastMaskPublicUrl || undefined}
                        compact
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className={`card-surface space-y-4 rounded-3xl border border-[color:var(--separator-subtle)] p-4 shadow-sm xl:sticky xl:top-5 xl:self-start ${isReferenceMode ? "xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto" : "xl:max-h-[calc(100vh-2.5rem)] xl:overflow-y-auto"}`}>
            <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--accent)_18%,var(--separator-subtle))] bg-[color:color-mix(in_srgb,var(--accent)_5%,var(--card-bg))] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[color:var(--foreground)]">图片编辑 Agent</p>
                  <p className="mt-1 text-xs leading-5 text-[color:var(--label-secondary)]">
                    说清楚目标即可；需要精准局部时再在左侧涂抹。
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--nav-active-fill)] px-2.5 py-1 text-[10px] font-medium text-[color:var(--label-secondary)]">
                  {currentEditPlan.label}
                </span>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例如：把人物衣服换成黑色皮夹克，保持脸部和背景不变；去掉右下角水印并补齐背景"
                className="mt-3 min-h-[132px] w-full resize-none rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-3 text-sm leading-6 outline-none transition focus:border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)]"
              />
              {currentEditPlan.warning && (
                <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-600">
                  {currentEditPlan.warning}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleEdit()}
                  disabled={loading || !hasImage}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {loading ? "Agent 编辑中..." : "开始编辑"}
                </button>
                {hasImage && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-11 rounded-2xl border border-[color:var(--separator-subtle)] px-3 text-xs text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  >
                    换图
                  </button>
                )}
              </div>
              <p className="mt-2 truncate text-[10px] text-[color:var(--label-tertiary)]">
                plan: {currentEditPlan.reason}
              </p>
            </div>

            <details className="rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-3">
              <summary className="cursor-pointer text-sm font-medium text-[color:var(--foreground)]">
                精准工具与高级模式
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {EDIT_MODE_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setCategory(cat.id);
                      const first = modesForCategory(cat.id)[0];
                      if (first) setMode(first.id);
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                      category === cat.id
                        ? "bg-[color:color-mix(in_srgb,var(--accent)_15%,var(--card-bg))] font-medium text-[color:var(--foreground)]"
                        : "bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {modesForCategory(category).map((m) => {
                  const Icon = m.icon;
                  const active = mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setMode(m.id);
                        setViewMode("edit");
                        setHasMask(false);
                      }}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all ${
                        active
                          ? "border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--card-bg))]"
                          : "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] hover:border-[color:color-mix(in_srgb,var(--accent)_25%,transparent)]"
                      }`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-[var(--accent)]" : "text-[color:var(--label-secondary)]"}`} />
                      <span className={`text-xs ${active ? "font-medium text-[color:var(--foreground)]" : "text-[color:var(--label-secondary)]"}`}>
                        {m.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </details>
            {!isReferenceMode && (
              <>
                <div>
                  <p className="text-sm font-medium text-[color:var(--foreground)]">{modeDef.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[color:var(--label-secondary)]">{modeDef.hint}</p>
                </div>

                {mode === "logoMotion" && (
                  <div className="space-y-3 rounded-xl border border-[color:var(--separator-subtle)] p-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[color:var(--foreground)]">动画风格</label>
                      <select
                        value={logoMotionStyle}
                        onChange={(e) => setLogoMotionStyle(e.target.value)}
                        className="w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[color:var(--foreground)] outline-none focus:border-[var(--accent)]"
                      >
                        <option value="subtle">柔和 (subtle)</option>
                        <option value="energetic">活泼 (energetic)</option>
                        <option value="cinematic">电影感 (cinematic)</option>
                        <option value="loop">循环 (loop)</option>
                        <option value="reveal">描绘 (reveal)</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[color:var(--foreground)]">
                        时长: {logoMotionDuration}ms
                      </label>
                      <input
                        type="range"
                        min={500}
                        max={4000}
                        step={100}
                        value={logoMotionDuration}
                        onChange={(e) => setLogoMotionDuration(Number(e.target.value))}
                        className="w-full"
                      />
                      <p className="mt-1 text-[10px] text-[color:var(--label-secondary)]">
                        默认 1500ms；越长越适合复杂动画
                      </p>
                    </div>
                  </div>
                )}

                {hasImage && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowHistoryPicker(true)} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-sm text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]">
                      <Clock className="h-3.5 w-3.5" />
                      从历史选择图片
                    </button>
                  </div>
                )}

                <div className="space-y-2 rounded-lg border border-[color:var(--separator-subtle)] p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--foreground)]">
                    <Layers className="h-3.5 w-3.5" />
                    批量编辑
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={!hasImage}
                      onClick={addCurrentToBatch}
                      className="flex-1 rounded-lg bg-[var(--nav-active-fill)] py-1.5 text-xs disabled:opacity-50"
                    >
                      加入队列
                    </button>
                    <button
                      type="button"
                      onClick={() => batchInputRef.current?.click()}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[var(--nav-active-fill)] py-1.5 text-xs"
                    >
                      <Upload className="h-3 w-3" />
                      多图上传
                    </button>
                  </div>
                  {(modeDef.needsMask || modeDef.needsReferenceImages) && (
                    <p className="text-[10px] text-[color:var(--label-secondary)]">
                      批量模式不支持涂抹选区或参考图，请使用指令/风格/超分等模式
                    </p>
                  )}
                </div>

                <ImageEditBatchPanel
                  items={batchItems}
                  running={batchRunning}
                  progress={batchProgress}
                  onRemove={(id) => setBatchItems((prev) => prev.filter((b) => b.id !== id))}
                  onClear={() => setBatchItems([])}
                  onRun={handleBatchRun}
                  onSelectResult={(item) => {
                    if (item.resultUrl) {
                      loadImage(item.resultUrl, item.resultUrl);
                      setViewMode("compare");
                      setResultUrls([item.resultUrl]);
                    }
                  }}
                />
              </>
            )}

            {isReferenceMode && (
              <div className="border-b border-[color:var(--separator-subtle)] pb-3">
                <p className="text-base font-semibold text-[color:var(--foreground)]">参考图编辑</p>
                <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
                  选方式 → 配素材 → 说需求，三步完成
                </p>
              </div>
            )}

            {isReferenceMode && hasImage && (
              <div className="flex gap-2">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="flex-1 rounded-lg border border-dashed border-[color:var(--separator-subtle)] py-2 text-xs text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]">
                  换原图
                </button>
                <button type="button" onClick={() => setShowHistoryPicker(true)} className="flex items-center justify-center gap-1 rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-xs text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]">
                  <Clock className="h-3.5 w-3.5" />
                  历史
                </button>
              </div>
            )}

            {mode === "outpaint" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {outpaintPresets.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setExpandTop(p.t);
                        setExpandBottom(p.b);
                        setExpandLeft(p.l);
                        setExpandRight(p.r);
                      }}
                      className="rounded-full border border-[color:var(--separator-subtle)] px-2.5 py-1 text-xs hover:border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {(
                  [
                    ["上", expandTop, setExpandTop],
                    ["下", expandBottom, setExpandBottom],
                    ["左", expandLeft, setExpandLeft],
                    ["右", expandRight, setExpandRight],
                  ] as const
                ).map(([label, val, setter]) => (
                  <label key={label} className="block text-sm text-[color:var(--label-secondary)]">
                    <span className="flex justify-between"><span>{label}</span><span>{val.toFixed(1)}×</span></span>
                    <input type="range" min={1} max={2} step={0.1} value={val} onChange={(e) => setter(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
                  </label>
                ))}
              </div>
            )}

            {modeDef.supportsUpscale && (
              <label className="block text-sm text-[color:var(--label-secondary)]">
                <span className="flex justify-between"><span>放大倍数</span><span>{upscaleFactor}×</span></span>
                <input type="range" min={1} max={4} step={1} value={upscaleFactor} onChange={(e) => setUpscaleFactor(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
                <span className="mt-1 block text-xs">1× 仅高清增强，不放大尺寸</span>
              </label>
            )}

            {modeDef.supportsSketchFlag && (
              <label className="flex items-center gap-2 text-sm text-[color:var(--label-secondary)]">
                <input type="checkbox" checked={isSketch} onChange={(e) => setIsSketch(e.target.checked)} className="rounded" />
                输入图像已是线稿
              </label>
            )}

            {isReferenceMode ? (
              <ImageEditReferenceWorkflow
                sourcePreviewUrl={displayUrl || null}
                intent={referenceIntent}
                onIntentChange={setReferenceIntent}
                target={referenceTarget}
                onTargetChange={setReferenceTarget}
                prompt={prompt}
                onPromptChange={setPrompt}
                items={referenceImages}
                maxCount={modeDef.maxReferenceImages ?? 2}
                onAdd={(displayUrl, publicUrl, role) => {
                  setReferenceImages((prev) => [
                    ...prev,
                    { id: newSessionId(), displayUrl, publicUrl, role },
                  ]);
                }}
                onRemove={(id) => setReferenceImages((prev) => prev.filter((r) => r.id !== id))}
                onRoleChange={(id, role) =>
                  setReferenceImages((prev) =>
                    prev.map((r) => (r.id === id ? { ...r, role } : r)),
                  )
                }
                onSubmit={() => void handleEdit()}
                loading={loading}
                showAdvanced={showAdvanced}
                onToggleAdvanced={() => setShowAdvanced((v) => !v)}
                advancedSlot={
                  <div className="space-y-3 rounded-lg border border-[color:var(--separator-subtle)] p-3">
                    <label className="block text-sm text-[color:var(--label-secondary)]">
                      <span className="flex justify-between"><span>生成数量</span><span>{variantCount} 张</span></span>
                      <input type="range" min={1} max={4} step={1} value={variantCount} onChange={(e) => setVariantCount(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
                    </label>
                    <label className="block text-sm text-[color:var(--label-secondary)]">
                      随机种子（可选）
                      <input
                        type="number"
                        min={0}
                        max={2147483647}
                        value={seed}
                        onChange={(e) => setSeed(e.target.value)}
                        placeholder="留空则随机"
                        className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                }
              />
            ) : mode === "inpaint" ? (
              <ImageEditInpaintPanel
                method={inpaintMethod}
                onMethodChange={setInpaintMethod}
                prompt={prompt}
                onPromptChange={setPrompt}
                reference={inpaintReference}
                onReferenceChange={setInpaintReference}
                aiBlend={inpaintAiBlend}
                onAiBlendChange={setInpaintAiBlend}
                presets={modeDef.presets}
                loading={loading}
                showAdvanced={showAdvanced}
                onToggleAdvanced={() => setShowAdvanced((v) => !v)}
                onSubmit={() => void handleEdit()}
                advancedSlot={
                  <div className="space-y-3 rounded-lg border border-[color:var(--separator-subtle)] p-3">
                    <label className="block text-sm text-[color:var(--label-secondary)]">
                      <span className="flex justify-between"><span>生成数量</span><span>{variantCount} 张</span></span>
                      <input type="range" min={1} max={4} step={1} value={variantCount} onChange={(e) => setVariantCount(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
                    </label>
                    <label className="block text-sm text-[color:var(--label-secondary)]">
                      随机种子（可选）
                      <input
                        type="number"
                        min={0}
                        max={2147483647}
                        value={seed}
                        onChange={(e) => setSeed(e.target.value)}
                        placeholder="留空则随机"
                        className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                }
              />
            ) : mode === "watermark" ? (
              <ImageEditWatermarkPanel
                method={watermarkMethod}
                onMethodChange={(m) => {
                  setWatermarkMethod(m);
                  if (m !== "area") {
                    setHasMask(false);
                    canvasRef.current?.clearMask();
                  }
                }}
                targetText={watermarkText}
                onTargetTextChange={setWatermarkText}
                includeAliases={watermarkIncludeAliases}
                onIncludeAliasesChange={setWatermarkIncludeAliases}
                supplement={prompt}
                onSupplementChange={setPrompt}
                loading={loading}
                showAdvanced={showAdvanced}
                onToggleAdvanced={() => setShowAdvanced((v) => !v)}
                onSubmit={() => void handleEdit()}
                advancedSlot={
                  <div className="space-y-3 rounded-lg border border-[color:var(--separator-subtle)] p-3">
                    <label className="block text-sm text-[color:var(--label-secondary)]">
                      <span className="flex justify-between"><span>生成数量</span><span>{variantCount} 张</span></span>
                      <input type="range" min={1} max={4} step={1} value={variantCount} onChange={(e) => setVariantCount(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
                    </label>
                    <label className="block text-sm text-[color:var(--label-secondary)]">
                      随机种子（可选）
                      <input
                        type="number"
                        min={0}
                        max={2147483647}
                        value={seed}
                        onChange={(e) => setSeed(e.target.value)}
                        placeholder="留空则随机"
                        className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                }
              />
            ) : (
              <>
                {modeDef.presets.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-[color:var(--label-secondary)]">
                      灵感示例，会填入上方 Agent 指令，不是模板限制。
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {modeDef.presets.map((p) => (
                        <button key={p.label} type="button" onClick={() => setPrompt(p.prompt)} className="rounded-full border border-[color:var(--separator-subtle)] px-2.5 py-1 text-xs text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]">
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {modeDef.needsMask && mode === "remove" && (
                  <p className="text-xs text-[color:var(--label-secondary)]">
                    用画笔涂抹{mode === "remove" ? "要移除" : "要重绘"}的区域，支持撤销/重做。
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg bg-[var(--nav-active-fill)] px-3 py-2 text-xs text-[color:var(--label-secondary)]"
                >
                  高级参数
                  {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>

                {showAdvanced && (
                  <div className="space-y-3 rounded-lg border border-[color:var(--separator-subtle)] p-3">
                    {modeDef.supportsStrength && (
                      <label className="block text-sm text-[color:var(--label-secondary)]">
                        <span className="flex justify-between"><span>修改强度</span><span>{strength.toFixed(2)}</span></span>
                        <input type="range" min={0} max={1} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
                        <span className="mt-1 block text-xs">越低越接近原图</span>
                      </label>
                    )}
                    <label className="block text-sm text-[color:var(--label-secondary)]">
                      <span className="flex justify-between"><span>生成数量</span><span>{variantCount} 张</span></span>
                      <input type="range" min={1} max={4} step={1} value={variantCount} onChange={(e) => setVariantCount(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
                    </label>
                    <label className="block text-sm text-[color:var(--label-secondary)]">
                      随机种子（可选）
                      <input
                        type="number"
                        min={0}
                        max={2147483647}
                        value={seed}
                        onChange={(e) => setSeed(e.target.value)}
                        placeholder="留空则随机"
                        className="mt-1 w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                )}

              </>
            )}

            {(resultText?.startsWith("编辑失败") || resultText?.startsWith("❌ Logo 动画生成失败")) && (
              <p className="rounded-lg bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[color:var(--status-danger-text)]">{resultText}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ImageEditPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[color:var(--label-secondary)]">加载中…</div>}>
      <ImageEditPageInner />
    </Suspense>
  );
}
