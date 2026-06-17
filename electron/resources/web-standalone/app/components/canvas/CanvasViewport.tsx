"use client";

import type { CanvasNode, CanvasViewport as Viewport } from "@/hooks/useCanvas";

interface CanvasViewportProps {
  canvasRef: React.RefObject<HTMLDivElement | null>;
  viewport: Viewport;
  nodes: CanvasNode[];
  selectedNodeId: string | null;
  CANVAS_WIDTH: number;
  CANVAS_HEIGHT: number;
  layout?: "vertical" | "horizontal";
  spacePressed?: boolean;
  onWheel: (e: React.WheelEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onNodeMouseDown: (e: React.MouseEvent, node: CanvasNode) => void;
  renderNode: (node: CanvasNode) => React.ReactNode;
}

function classNames(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function CanvasViewport({
  canvasRef,
  viewport,
  nodes,
  selectedNodeId,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  layout = "vertical",
  spacePressed,
  onWheel,
  onMouseDown,
  onNodeMouseDown,
  renderNode,
}: CanvasViewportProps) {
  const isHorizontal = layout === "horizontal";

  return (
    <div
      className={classNames(
        "relative flex-1 overflow-hidden bg-[var(--background)]",
        spacePressed && "cursor-grab active:cursor-grabbing"
      )}
      ref={canvasRef}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
    >
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: "top left",
          position: "relative",
          zIndex: 0,
        }}
      >
        {isHorizontal && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: 0,
              top: CANVAS_HEIGHT / 2 - 1,
              width: CANVAS_WIDTH,
              height: 2,
              background: "linear-gradient(90deg, transparent, var(--border-subtle) 5%, var(--border-subtle) 95%, transparent)",
              opacity: 0.4,
            }}
          />
        )}

        {/* Connection lines */}
        <svg className="absolute inset-0 pointer-events-none" width={CANVAS_WIDTH} height={CANVAS_HEIGHT}>
          <defs>
            <marker
              id="canvas-arrow"
              markerWidth="10"
              markerHeight="10"
              refX="9"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,6 L9,3 z" fill="var(--accent)" />
            </marker>
          </defs>
          {nodes.slice(0, -1).map((n, i) => {
            const next = nodes[i + 1];
            if (!next || n.type === "scene" || next.type === "scene") return null;
            let x1: number, y1: number, x2: number, y2: number;
            if (isHorizontal) {
              x1 = n.x + n.width;
              y1 = n.y + n.height / 2;
              x2 = next.x;
              y2 = next.y + next.height / 2;
              return (
                <g key={`line-${n.id}`}>
                  <path
                    d={`M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="var(--accent)"
                    strokeOpacity={0.5}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    markerEnd="url(#canvas-arrow)"
                  />
                </g>
              );
            }
            x1 = n.x + n.width / 2;
            y1 = n.y + n.height;
            x2 = next.x + next.width / 2;
            y2 = next.y;
            return (
              <g key={`line-${n.id}`}>
                <path
                  d={`M ${x1} ${y1} C ${x1} ${y1 + 60}, ${x2} ${y2 - 60}, ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--accent)"
                  strokeOpacity={0.5}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  markerEnd="url(#canvas-arrow)"
                />
              </g>
            );
          })}
        </svg>

        {(() => {
          let flowIndex = 0;
          return nodes.map((node) => {
            const isFlow = node.type !== "scene";
            if (isFlow) flowIndex += 1;
            return (
              <NodeWrapper
                key={node.id}
                node={node}
                index={isFlow ? flowIndex : undefined}
                selectedNodeId={selectedNodeId}
                onNodeMouseDown={onNodeMouseDown}
                renderNode={renderNode}
              />
            );
          });
        })()}
      </div>
    </div>
  );
}

function NodeWrapper({
  node,
  index,
  selectedNodeId,
  onNodeMouseDown,
  renderNode,
}: {
  node: CanvasNode;
  index?: number;
  selectedNodeId: string | null;
  onNodeMouseDown: (e: React.MouseEvent, node: CanvasNode) => void;
  renderNode: (node: CanvasNode) => React.ReactNode;
}) {
  return (
    <div
      data-node
      onMouseDown={(e) => onNodeMouseDown(e, node)}
      className={classNames(
        "absolute rounded-2xl border bg-[var(--card-bg)] shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md",
        selectedNodeId === node.id
          ? "border-[color:var(--accent)] ring-1 ring-[color:var(--accent)]/30 shadow-lg"
          : "border-[var(--border-subtle)]"
      )}
      style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
    >
      {typeof index === "number" && (
        <div className="absolute -top-2.5 -left-2.5 h-5 min-w-[20px] px-1 rounded-full bg-[color:var(--accent)] text-white text-[10px] font-bold flex items-center justify-center shadow-sm z-10 ring-2 ring-[var(--card-bg)]">
          {index}
        </div>
      )}
      {renderNode(node)}
      {node.status === "generating" && (
        <div className="absolute inset-0 bg-[var(--card-bg)]/80 rounded-2xl flex items-center justify-center z-10">
          <div className="w-6 h-6 border-2 border-[color:var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
