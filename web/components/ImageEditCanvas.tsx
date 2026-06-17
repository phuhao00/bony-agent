"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import type { EditCanvasMode } from "@/lib/image-edit-modes";

export type { EditCanvasMode };

export type MaskTool = "brush" | "eraser" | "rectangle" | "lasso";

export interface ImageEditCanvasHandle {
  getMaskBlob: () => Promise<Blob | null>;
  clearMask: () => void;
  hasMask: () => boolean;
  undoMask: () => void;
  redoMask: () => void;
  canUndoMask: () => boolean;
  canRedoMask: () => boolean;
}

interface ImageEditCanvasProps {
  imageUrl: string | null;
  mode: EditCanvasMode;
  brushSize?: number;
  tool?: MaskTool;
  loading?: boolean;
  expandTop?: number;
  expandBottom?: number;
  expandLeft?: number;
  expandRight?: number;
  dragActive?: boolean;
  onFileDrop?: (file: File) => void;
  onUploadClick?: () => void;
  onMaskChange?: (hasMask: boolean) => void;
  /** When set, overrides default inpaint/remove mask layer visibility */
  maskLayerEnabled?: boolean;
}

const ImageEditCanvas = forwardRef<ImageEditCanvasHandle, ImageEditCanvasProps>(
  function ImageEditCanvas(
    {
      imageUrl,
      mode,
      brushSize = 24,
      tool = "brush",
      loading = false,
      expandTop = 1,
      expandBottom = 1,
      expandLeft = 1,
      expandRight = 1,
      dragActive = false,
      onFileDrop,
      onUploadClick,
      onMaskChange,
      maskLayerEnabled,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const previewRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
    const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);
    const dragDepthRef = useRef(0);
    const undoStackRef = useRef<ImageData[]>([]);
    const redoStackRef = useRef<ImageData[]>([]);
    const [localDragActive, setLocalDragActive] = useState(false);
    const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
    const [hasDrawn, setHasDrawn] = useState(false);

    const showMaskLayer =
      maskLayerEnabled ?? (mode === "inpaint" || mode === "remove" || mode === "watermark");
    const isDragHighlight = dragActive || localDragActive;

    const syncDisplaySize = useCallback(() => {
      const img = imgRef.current;
      const container = containerRef.current;
      if (!img || !container || !img.complete || !img.naturalWidth) return;
      const rect = img.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      setDisplaySize({ w: rect.width, h: rect.height });
      const canvas = canvasRef.current;
      if (canvas) {
        const newW = Math.round(rect.width);
        const newH = Math.round(rect.height);
        const oldW = canvas.width;
        const oldH = canvas.height;
        if (oldW > 0 && oldH > 0 && (oldW !== newW || oldH !== newH)) {
          const snapshot = document.createElement("canvas");
          snapshot.width = oldW;
          snapshot.height = oldH;
          const sctx = snapshot.getContext("2d");
          if (sctx) {
            sctx.drawImage(canvas, 0, 0);
            canvas.width = newW;
            canvas.height = newH;
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(snapshot, 0, 0, oldW, oldH, 0, 0, newW, newH);
            }
          }
        } else {
          canvas.width = newW;
          canvas.height = newH;
          canvas.style.width = `${rect.width}px`;
          canvas.style.height = `${rect.height}px`;
        }
      }
      const preview = previewRef.current;
      if (preview) {
        preview.width = Math.round(rect.width);
        preview.height = Math.round(rect.height);
        preview.style.width = `${rect.width}px`;
        preview.style.height = `${rect.height}px`;
      }
    }, []);

    useEffect(() => {
      if (!imageUrl) return;
      const resetFrame = requestAnimationFrame(() => setHasDrawn(false));
      lastPointRef.current = null;
      undoStackRef.current = [];
      redoStackRef.current = [];
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      const preview = previewRef.current;
      if (preview) {
        const pctx = preview.getContext("2d");
        if (pctx) pctx.clearRect(0, 0, preview.width, preview.height);
      }
      shapeStartRef.current = null;
      lassoPointsRef.current = [];
      return () => cancelAnimationFrame(resetFrame);
    }, [imageUrl]);

    const pushUndoSnapshot = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas || !canvas.width || !canvas.height) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      try {
        const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
        undoStackRef.current.push(snapshot);
        if (undoStackRef.current.length > 30) undoStackRef.current.shift();
        redoStackRef.current = [];
      } catch {
        // canvas may be tainted in edge cases
      }
    }, []);

    useEffect(() => {
      window.addEventListener("resize", syncDisplaySize);
      return () => window.removeEventListener("resize", syncDisplaySize);
    }, [syncDisplaySize]);

    /** Sync mask canvas when layer appears or image is already cached (no onLoad). */
    useEffect(() => {
      if (!showMaskLayer || !imageUrl) return;
      const img = imgRef.current;
      if (!img) return;

      const runSync = () => {
        requestAnimationFrame(() => {
          syncDisplaySize();
          requestAnimationFrame(syncDisplaySize);
        });
      };

      if (img.complete && img.naturalWidth) {
        runSync();
      } else {
        img.addEventListener("load", runSync, { once: true });
        return () => img.removeEventListener("load", runSync);
      }
    }, [showMaskLayer, imageUrl, syncDisplaySize]);

    useEffect(() => {
      if (!showMaskLayer || !imageUrl) return;
      const img = imgRef.current;
      if (!img || typeof ResizeObserver === "undefined") return;

      const observer = new ResizeObserver(() => syncDisplaySize());
      observer.observe(img);
      return () => observer.disconnect();
    }, [showMaskLayer, imageUrl, syncDisplaySize]);

    /** After canvas mounts, apply bitmap dimensions (refs were null on first sync). */
    useEffect(() => {
      if (!showMaskLayer || displaySize.w < 1 || displaySize.h < 1) return;
      syncDisplaySize();
    }, [showMaskLayer, displaySize.w, displaySize.h, syncDisplaySize]);

    const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return { x: 0, y: 0 };
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const clearPreview = useCallback(() => {
      const preview = previewRef.current;
      if (!preview) return;
      const pctx = preview.getContext("2d");
      if (pctx) pctx.clearRect(0, 0, preview.width, preview.height);
    }, []);

    const applyMaskFill = useCallback(
      (draw: (ctx: CanvasRenderingContext2D) => void) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        if (tool === "eraser") {
          ctx.globalCompositeOperation = "destination-out";
          ctx.fillStyle = "rgba(0,0,0,1)";
          ctx.strokeStyle = "rgba(0,0,0,1)";
        } else {
          ctx.globalCompositeOperation = "source-over";
          ctx.fillStyle = "rgba(255, 60, 60, 0.55)";
          ctx.strokeStyle = "rgba(255, 60, 60, 0.55)";
        }
        draw(ctx);
        ctx.globalCompositeOperation = "source-over";
      },
      [tool],
    );

    const drawPreviewRect = useCallback(
      (x1: number, y1: number, x2: number, y2: number) => {
        const preview = previewRef.current;
        if (!preview) return;
        const pctx = preview.getContext("2d");
        if (!pctx) return;
        pctx.clearRect(0, 0, preview.width, preview.height);
        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        pctx.strokeStyle = "rgba(255, 200, 60, 0.95)";
        pctx.lineWidth = 2;
        pctx.setLineDash([6, 4]);
        pctx.strokeRect(x, y, w, h);
        pctx.setLineDash([]);
      },
      [],
    );

    const drawPreviewLasso = useCallback((points: { x: number; y: number }[]) => {
      const preview = previewRef.current;
      if (!preview || points.length < 2) return;
      const pctx = preview.getContext("2d");
      if (!pctx) return;
      pctx.clearRect(0, 0, preview.width, preview.height);
      pctx.strokeStyle = "rgba(255, 200, 60, 0.95)";
      pctx.lineWidth = 2;
      pctx.setLineDash([6, 4]);
      pctx.beginPath();
      pctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        pctx.lineTo(points[i].x, points[i].y);
      }
      pctx.closePath();
      pctx.stroke();
      pctx.setLineDash([]);
    }, []);

    const strokeBetween = useCallback(
      (from: { x: number; y: number }, to: { x: number; y: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = brushSize;

        if (tool === "eraser") {
          ctx.globalCompositeOperation = "destination-out";
          ctx.strokeStyle = "rgba(0,0,0,1)";
        } else {
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = "rgba(255, 60, 60, 0.55)";
        }

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      },
      [brushSize, tool],
    );

    const drawDot = useCallback(
      (x: number, y: number) => {
        strokeBetween({ x, y }, { x: x + 0.01, y: y + 0.01 });
      },
      [strokeBetween],
    );

    const commitRectangle = useCallback(
      (x1: number, y1: number, x2: number, y2: number) => {
        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        if (w < 2 || h < 2) return;
        applyMaskFill((ctx) => ctx.fillRect(x, y, w, h));
        setHasDrawn(true);
        onMaskChange?.(true);
      },
      [applyMaskFill, onMaskChange],
    );

    const commitLasso = useCallback(
      (points: { x: number; y: number }[]) => {
        if (points.length < 2) return;
        applyMaskFill((ctx) => {
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
          }
          ctx.closePath();
          ctx.fill();
        });
        setHasDrawn(true);
        onMaskChange?.(true);
      },
      [applyMaskFill, onMaskChange],
    );

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!showMaskLayer || loading) return;
      e.preventDefault();
      e.stopPropagation();
      syncDisplaySize();
      e.currentTarget.setPointerCapture(e.pointerId);
      const point = getCanvasPoint(e);

      if (tool === "rectangle") {
        pushUndoSnapshot();
        drawingRef.current = true;
        shapeStartRef.current = point;
        drawPreviewRect(point.x, point.y, point.x, point.y);
        return;
      }

      if (tool === "lasso") {
        pushUndoSnapshot();
        drawingRef.current = true;
        lassoPointsRef.current = [point];
        drawPreviewLasso(lassoPointsRef.current);
        return;
      }

      pushUndoSnapshot();
      drawingRef.current = true;
      lastPointRef.current = point;
      drawDot(point.x, point.y);
      setHasDrawn(true);
      onMaskChange?.(true);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current || !showMaskLayer || loading) return;
      const point = getCanvasPoint(e);

      if (tool === "rectangle" && shapeStartRef.current) {
        drawPreviewRect(shapeStartRef.current.x, shapeStartRef.current.y, point.x, point.y);
        return;
      }

      if (tool === "lasso") {
        const pts = lassoPointsRef.current;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 4) {
          pts.push(point);
          drawPreviewLasso(pts);
        }
        return;
      }

      const last = lastPointRef.current;
      if (last) {
        strokeBetween(last, point);
      } else {
        drawDot(point.x, point.y);
      }
      lastPointRef.current = point;
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;

      if (tool === "rectangle" && shapeStartRef.current) {
        const end = getCanvasPoint(e);
        commitRectangle(shapeStartRef.current.x, shapeStartRef.current.y, end.x, end.y);
        shapeStartRef.current = null;
        clearPreview();
        return;
      }

      if (tool === "lasso") {
        commitLasso(lassoPointsRef.current);
        lassoPointsRef.current = [];
        clearPreview();
        return;
      }

      lastPointRef.current = null;
    };

    const clearMask = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      pushUndoSnapshot();
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasDrawn(false);
      lastPointRef.current = null;
      onMaskChange?.(false);
    }, [onMaskChange, pushUndoSnapshot]);

    const undoMask = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx || undoStackRef.current.length === 0) return;
      try {
        const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
        redoStackRef.current.push(current);
        const prev = undoStackRef.current.pop()!;
        ctx.putImageData(prev, 0, 0);
        const hasContent = prev.data.some((v, i) => i % 4 === 3 && v > 20);
        setHasDrawn(hasContent);
        onMaskChange?.(hasContent);
      } catch {
        // ignore
      }
    }, [onMaskChange]);

    const redoMask = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx || redoStackRef.current.length === 0) return;
      try {
        const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
        undoStackRef.current.push(current);
        const next = redoStackRef.current.pop()!;
        ctx.putImageData(next, 0, 0);
        const hasContent = next.data.some((v, i) => i % 4 === 3 && v > 20);
        setHasDrawn(hasContent);
        onMaskChange?.(hasContent);
      } catch {
        // ignore
      }
    }, [onMaskChange]);

    const getMaskBlob = useCallback(async (): Promise<Blob | null> => {
      const src = canvasRef.current;
      const img = imgRef.current;
      if (!showMaskLayer || !hasDrawn || !src || !img?.naturalWidth || !img.naturalHeight) {
        return null;
      }

      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const srcW = src.width || 1;
      const srcH = src.height || 1;

      const mask = document.createElement("canvas");
      mask.width = nw;
      mask.height = nh;
      const mctx = mask.getContext("2d");
      if (!mctx) return null;

      // Transparent base — only stroke pixels from overlay count as mask
      mctx.clearRect(0, 0, nw, nh);
      mctx.drawImage(src, 0, 0, srcW, srcH, 0, 0, nw, nh);

      const maskData = mctx.getImageData(0, 0, nw, nh);
      let painted = false;
      for (let i = 0; i < maskData.data.length; i += 4) {
        const strokeAlpha = maskData.data[i + 3];
        const isStroke = strokeAlpha > 20;
        const v = isStroke ? 255 : 0;
        maskData.data[i] = v;
        maskData.data[i + 1] = v;
        maskData.data[i + 2] = v;
        maskData.data[i + 3] = 255;
        if (isStroke) painted = true;
      }
      if (!painted) return null;
      mctx.putImageData(maskData, 0, 0);

      return new Promise((resolve) => {
        mask.toBlob((blob) => resolve(blob), "image/png");
      });
    }, [hasDrawn, showMaskLayer]);

    useImperativeHandle(ref, () => ({
      getMaskBlob,
      clearMask,
      hasMask: () => hasDrawn,
      undoMask,
      redoMask,
      canUndoMask: () => undoStackRef.current.length > 0,
      canRedoMask: () => redoStackRef.current.length > 0,
    }));

    const handleDragEnter = (e: React.DragEvent) => {
      e.preventDefault();
      dragDepthRef.current += 1;
      setLocalDragActive(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setLocalDragActive(false);
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setLocalDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file?.type.startsWith("image/")) {
        onFileDrop?.(file);
      }
    };

    const outpaintPadding = {
      top: `${Math.max(0, (expandTop - 1) * 50)}%`,
      bottom: `${Math.max(0, (expandBottom - 1) * 50)}%`,
      left: `${Math.max(0, (expandLeft - 1) * 50)}%`,
      right: `${Math.max(0, (expandRight - 1) * 50)}%`,
    };

    if (!imageUrl) {
      return (
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onUploadClick?.();
            }
          }}
          onClick={onUploadClick}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className={`flex min-h-[clamp(520px,68vh,760px)] flex-col items-center justify-center rounded-3xl border-2 border-dashed transition-all ${
            isDragHighlight
              ? "border-[color:color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--card-bg))] scale-[1.01]"
              : "border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] hover:border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
          } cursor-pointer`}
        >
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--nav-active-fill)]">
            <ImagePlus className="h-8 w-8 text-[color:var(--label-secondary)]" />
          </div>
          <p className="text-base font-medium text-[color:var(--foreground)]">
            拖拽图片到此处，或点击上传
          </p>
          <p className="mt-2 text-sm text-[color:var(--label-secondary)]">
            支持 JPG、PNG、WebP · 建议 1024px 以上
          </p>
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-3xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] shadow-sm"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {mode === "outpaint" && (
          <div
            className="absolute inset-0 z-0 pointer-events-none"
            style={{
              paddingTop: outpaintPadding.top,
              paddingBottom: outpaintPadding.bottom,
              paddingLeft: outpaintPadding.left,
              paddingRight: outpaintPadding.right,
            }}
          >
            <div className="h-full w-full rounded-lg border-2 border-dashed border-[color:color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_6%,transparent)]" />
          </div>
        )}

        <div className="relative w-full leading-[0]">
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Source"
            className={`relative z-[1] block h-auto w-full select-none ${
              showMaskLayer ? "pointer-events-none" : ""
            }`}
            draggable={false}
            onLoad={() => {
              requestAnimationFrame(() => {
                syncDisplaySize();
                requestAnimationFrame(syncDisplaySize);
              });
            }}
          />

          {showMaskLayer && (
            <>
              <canvas
                ref={canvasRef}
                className="absolute inset-0 z-[2] h-full w-full touch-none cursor-crosshair"
                style={{ touchAction: "none" }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />
              <canvas
                ref={previewRef}
                className="pointer-events-none absolute inset-0 z-[3] h-full w-full"
              />
            </>
          )}
        </div>

        {showMaskLayer && !hasDrawn && !loading && (
          <div className="pointer-events-none absolute inset-x-0 bottom-16 z-[4] flex justify-center">
            <span className="rounded-full bg-black/60 px-4 py-1.5 text-xs text-white backdrop-blur-sm">
              {tool === "rectangle"
                ? "拖拽绘制矩形选区"
                : tool === "lasso"
                  ? "点击并拖动绘制套索选区"
                  : `在图片上涂抹要${
                      mode === "remove"
                        ? "移除"
                        : mode === "watermark"
                          ? "去水印"
                          : "重绘"
                    }的区域`}
            </span>
          </div>
        )}

        {mode === "outpaint" && !loading && (
          <div className="pointer-events-none absolute bottom-3 left-3 z-[3] rounded-lg bg-black/55 px-3 py-1.5 text-xs text-white">
            虚线框为 AI 将补全的扩展区域
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-3 bg-black/45 backdrop-blur-[2px]">
            <Loader2 className="h-10 w-10 animate-spin text-white" />
            <p className="text-sm font-medium text-white">AI 编辑中，约 30–60 秒…</p>
          </div>
        )}

        {isDragHighlight && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)] backdrop-blur-[1px]">
            <p className="rounded-xl bg-[var(--card-bg)] px-5 py-3 text-sm font-medium shadow-lg">
              松开以替换图片
            </p>
          </div>
        )}
      </div>
    );
  },
);

export default ImageEditCanvas;
