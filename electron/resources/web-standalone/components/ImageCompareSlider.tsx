"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";

interface ImageCompareSliderProps {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
}

export default function ImageCompareSlider({
  beforeSrc,
  afterSrc,
  beforeLabel = "原图",
  afterLabel = "结果",
}: ImageCompareSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [containerWidth, setContainerWidth] = useState(0);
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setContainerWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, []);

  const updatePosition = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.max(4, Math.min(96, pct)));
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updatePosition(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    updatePosition(e.clientX);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-xl overflow-hidden border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] select-none touch-none cursor-ew-resize"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <img
        src={afterSrc}
        alt={afterLabel}
        className="w-full h-auto block pointer-events-none"
        draggable={false}
      />

      <div
        className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none"
        style={{ width: `${position}%` }}
      >
        <img
          src={beforeSrc}
          alt={beforeLabel}
          className="absolute inset-y-0 left-0 h-full max-w-none object-cover"
          style={{ width: containerWidth || "100%" }}
          draggable={false}
        />
      </div>

      <div
        className="absolute inset-y-0 z-10 flex items-center pointer-events-none"
        style={{ left: `${position}%`, transform: "translateX(-50%)" }}
      >
        <div className="h-full w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
        <div className="absolute top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-[var(--card-bg)] shadow-lg">
          <GripVertical className="h-4 w-4 text-[color:var(--foreground)]" />
        </div>
      </div>

      <span className="absolute top-3 left-3 rounded-md bg-black/55 px-2 py-1 text-xs text-white pointer-events-none">
        {beforeLabel}
      </span>
      <span className="absolute top-3 right-3 rounded-md bg-black/55 px-2 py-1 text-xs text-white pointer-events-none">
        {afterLabel}
      </span>
    </div>
  );
}
