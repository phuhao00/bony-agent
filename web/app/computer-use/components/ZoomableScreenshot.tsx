"use client";

import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useRef, useState } from "react";

export function ZoomableScreenshot({
  src,
  alt,
  compact = false,
}: {
  src: string;
  alt: string;
  compact?: boolean;
}) {
  const [zoomPct, setZoomPct] = useState(100);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const fitViewport = useCallback(() => {
    const c = containerRef.current;
    const img = imgRef.current;
    if (!c || !img?.naturalWidth) return;
    const cw = Math.max(1, c.clientWidth - 4);
    const ch = Math.max(1, c.clientHeight - 4);
    if (cw < 48 || ch < 48) return;
    const nw = img.naturalWidth;
    const nhReal = img.naturalHeight;
    const hAtFullWidth = (nhReal / nw) * cw;
    if (hAtFullWidth <= ch) {
      setZoomPct(100);
      return;
    }
    const z = Math.floor(((ch * nw) / (nhReal * cw)) * 100 * 0.98);
    setZoomPct(Math.max(25, Math.min(100, z)));
  }, []);

  const onImgLoad = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitViewport());
    });
  }, [fitViewport]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setZoomPct((z) => Math.max(25, z - 15))}
          className="rounded-lg border border-white/10 bg-white/10 p-1.5 text-white hover:bg-white/20"
          title="缩小"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <input
          type="range"
          min={25}
          max={300}
          step={5}
          value={zoomPct}
          onChange={(e) => setZoomPct(Number(e.target.value))}
          className={`min-w-[120px] flex-1 accent-[var(--accent)] ${compact ? "max-w-[160px]" : "max-w-[280px]"}`}
        />
        <span className="w-11 text-center text-xs tabular-nums text-[color:var(--label-secondary)]">
          {zoomPct}%
        </span>
        <button
          type="button"
          onClick={() => setZoomPct((z) => Math.min(300, z + 15))}
          className="rounded-lg border border-white/10 bg-white/10 p-1.5 text-white hover:bg-white/20"
          title="放大"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setZoomPct(100)}
          className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-xs text-white/90 hover:bg-white/20"
        >
          宽度 100%
        </button>
        <button
          type="button"
          onClick={fitViewport}
          className="flex items-center gap-1 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_55%,white)] bg-[color-mix(in_srgb,var(--accent)_75%,#4c1d95)] px-2 py-1 text-xs text-white hover:opacity-90"
          title="在可视区域内完整显示整张图（不裁切）"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          一屏完整
        </button>
      </div>
      <div
        ref={containerRef}
        className={`overflow-auto overscroll-contain scroll-smooth rounded-xl border border-white/10 bg-zinc-950/90 touch-pan-x touch-pan-y ${
          compact ? "max-h-56" : "max-h-[min(88vh,920px)]"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          onLoad={onImgLoad}
          draggable={false}
          className="block h-auto select-none rounded-lg"
          style={{ width: `${zoomPct}%`, maxWidth: "none" }}
        />
      </div>
      {!compact && (
        <p className="text-[11px] text-[color:var(--label-secondary)]">
          宽度为容器百分比：缩小可一屏看全图；放大后拖拽滚动看细节，不会裁掉画面外内容。
        </p>
      )}
    </div>
  );
}
