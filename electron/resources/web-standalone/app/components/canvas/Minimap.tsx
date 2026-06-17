"use client";

import { useEffect, useState } from "react";
import type { CanvasBounds, CanvasNode, CanvasViewport } from "@/hooks/useCanvas";

interface MinimapProps {
  nodes: CanvasNode[];
  bounds: CanvasBounds;
  viewport: CanvasViewport;
  setViewport: (v: CanvasViewport) => void;
  className?: string;
  showLabel?: boolean;
  size?: number;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function statusColor(status: CanvasNode["status"], accent: string) {
  switch (status) {
    case "approved":
      return "#22c55e";
    case "ready":
      return accent;
    case "generating":
      return "#f59e0b";
    case "error":
      return "#ef4444";
    default:
      return "#9ca3af";
  }
}

export function Minimap({ nodes, bounds, viewport, setViewport, className, showLabel = true, size = 160 }: MinimapProps) {
  const [winSize, setWinSize] = useState({ width: 1200, height: 800 });

  useEffect(() => {
    const update = () => setWinSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const safeW = bounds.w || 1;
  const safeH = bounds.h || 1;
  const aspect = safeW / safeH;
  const width = aspect > 1 ? size : size * aspect;
  const height = aspect > 1 ? size / aspect : size;

  const toMinimap = (x: number, y: number) => ({
    x: ((x - bounds.x) / safeW) * width,
    y: ((y - bounds.y) / safeH) * height,
  });

  const vpRect = {
    x: ((-viewport.x) / viewport.scale - bounds.x) / safeW * width,
    y: ((-viewport.y) / viewport.scale - bounds.y) / safeH * height,
    w: (winSize.width / viewport.scale) / safeW * width,
    h: (winSize.height / viewport.scale) / safeH * height,
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / width;
    const ry = (e.clientY - rect.top) / height;
    const worldX = bounds.x + rx * bounds.w;
    const worldY = bounds.y + ry * bounds.h;
    setViewport({
      ...viewport,
      x: -worldX * viewport.scale + rect.width * 0.3,
      y: -worldY * viewport.scale + rect.height * 0.3,
    });
  };

  return (
    <div className={className || "absolute bottom-4 right-4 bg-[var(--card-bg)] border border-[var(--border-subtle)] rounded-xl shadow-lg p-2 select-none z-20"}>
      <div
        className="relative bg-[var(--nav-active-fill)] rounded-lg overflow-hidden cursor-crosshair"
        style={{ width, height }}
        onClick={onClick}
      >
        {nodes.map((n) => {
          const p = toMinimap(n.x, n.y);
          const dim = toMinimap(n.x + n.width, n.y + n.height);
          return (
            <div
              key={n.id}
              className="absolute rounded-sm"
              style={{
                left: p.x,
                top: p.y,
                width: Math.max(4, dim.x - p.x),
                height: Math.max(4, dim.y - p.y),
                backgroundColor: statusColor(n.status, "var(--accent)"),
                opacity: 0.85,
              }}
            />
          );
        })}
        <div
          className="absolute border border-[color:var(--accent)] bg-[color:var(--accent)]/10 rounded"
          style={{
            left: clamp(vpRect.x, 0, width - 4),
            top: clamp(vpRect.y, 0, height - 4),
            width: Math.max(4, Math.min(vpRect.w, width - vpRect.x)),
            height: Math.max(4, Math.min(vpRect.h, height - vpRect.y)),
          }}
        />
      </div>
      {showLabel && <p className="text-[10px] text-center text-[color:var(--label-secondary)] mt-1">Minimap</p>}
    </div>
  );
}
