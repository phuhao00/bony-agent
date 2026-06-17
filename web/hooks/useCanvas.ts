"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface CanvasNode {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: NodeStatus;
  data?: any;
}

export type NodeStatus = "idle" | "generating" | "ready" | "approved" | "error";

export interface CanvasViewport {
  x: number;
  y: number;
  scale: number;
}

export interface CanvasBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  nodeId?: string;
  actions?: ChatAction[];
}

export interface ChatAction {
  id: string;
  label: string;
  variant?: "primary" | "secondary";
}

const CANVAS_WIDTH = 4000;
const CANVAS_HEIGHT = 4000;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export interface UseCanvasOptions {
  layout?: "vertical" | "horizontal";
}

export function useCanvas(options: UseCanvasOptions = {}) {
  const layout = options.layout ?? "vertical";
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [viewport, setViewport] = useState<CanvasViewport>({ x: -CANVAS_WIDTH / 2 + 400, y: 120, scale: 0.75 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number; button: number } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  const addNode = useCallback((node: CanvasNode) => {
    setNodes((ns) => [...ns, node]);
  }, []);

  const updateNode = useCallback((id: string, patch: Partial<CanvasNode>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const removeNode = useCallback((id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
  }, []);

  const relayout = useCallback(
    (
      ns: CanvasNode[],
      opts?: {
        startY?: number;
        gapY?: number;
        gridCols?: number;
        sceneWidth?: number;
        sceneGap?: number;
        flowStartX?: number;
        gapX?: number;
        centerY?: number;
      }
    ) => {
      const gapX = opts?.gapX ?? 80;
      const centerX = CANVAS_WIDTH / 2 - 320;
      const flowStartX = opts?.flowStartX ?? centerX;
      const gapY = opts?.gapY ?? 120;
      const centerY = opts?.centerY ?? CANVAS_HEIGHT / 2;
      const result: CanvasNode[] = [];

      if (layout === "horizontal") {
        let x = flowStartX;
        const flowNodes = ns.filter((n) => n.type !== "scene");
        flowNodes.forEach((n) => {
          result.push({ ...n, x, y: centerY - n.height / 2 });
          x += n.width + gapX;
        });
      } else {
        let y = opts?.startY ?? 120;
        const flowNodes = ns.filter((n) => n.type !== "scene");
        flowNodes.forEach((n) => {
          result.push({ ...n, x: flowStartX, y });
          y += n.height + gapY;
        });
      }

      // Scene child nodes attach after storyboard
      const storyboard = result.find((n) => n.type === "storyboard");
      if (storyboard) {
        const sceneNodes = ns.filter((n) => n.type === "scene");
        const cols = opts?.gridCols ?? 3;
        const sceneW = opts?.sceneWidth ?? 360;
        const sceneGap = opts?.sceneGap ?? 60;
        const belowY = storyboard.y + storyboard.height + (layout === "horizontal" ? 80 : 120);
        sceneNodes.forEach((n, idx) => {
          result.push({
            ...n,
            x: CANVAS_WIDTH / 2 - (cols * sceneW + (cols - 1) * sceneGap) / 2 + (idx % cols) * (sceneW + sceneGap),
            y: belowY + Math.floor(idx / cols) * (n.height + sceneGap),
          });
        });
      }

      return result;
    },
    [layout]
  );

  const bounds = useMemo<CanvasBounds>(() => {
    if (!nodes.length) return { x: 0, y: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT };
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    });
    const padding = 200;
    return { x: minX - padding, y: minY - padding, w: maxX - minX + padding * 2, h: maxY - minY + padding * 2 };
  }, [nodes]);

  const getContainerSize = useCallback((panelW = 0) => {
    const parent = canvasRef.current?.parentElement;
    const width = parent?.clientWidth ?? window.innerWidth - 56 - 460;
    const height = parent?.clientHeight ?? window.innerHeight;
    return { width, height, panelW };
  }, []);

  const fitView = useCallback(
    (containerW?: number, containerH?: number, padding = 80, panelW = 0) => {
      const size = containerW == null || containerH == null ? getContainerSize(panelW) : { width: containerW, height: containerH, panelW };
      const availableW = Math.max(200, size.width - padding * 2 - size.panelW);
      const availableH = Math.max(200, size.height - padding * 2);
      const scale = clamp(Math.min(availableW / bounds.w, availableH / bounds.h, 1), 0.35, 1);
      const x = -bounds.x * scale + (size.width - size.panelW - bounds.w * scale) / 2 + size.panelW / 2;
      const y = -bounds.y * scale + (size.height - bounds.h * scale) / 2;
      setViewport({ x, y, scale });
    },
    [bounds, getContainerSize]
  );

  const focusNode = useCallback(
    (node: CanvasNode, containerW?: number, containerH?: number, panelW = 0) => {
      const size = containerW == null || containerH == null ? getContainerSize(panelW) : { width: containerW, height: containerH, panelW };
      const scale = clamp(viewport.scale, 0.5, 1);
      const x = -node.x * scale + (size.width - size.panelW - node.width * scale) / 2 + size.panelW / 2;
      const y = -node.y * scale + (size.height - node.height * scale) / 2;
      setViewport({ x, y, scale });
    },
    [viewport.scale, getContainerSize]
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = canvasRef.current!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = clamp(viewport.scale * delta, 0.2, 2);
      setViewport((v) => ({
        scale: newScale,
        x: mx - (mx - v.x) * (newScale / v.scale),
        y: my - (my - v.y) * (newScale / v.scale),
      }));
    },
    [viewport.scale]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      const target = e.target as HTMLElement;
      const forcePan = spacePressed || e.button === 1;
      if (!forcePan && target.closest("[data-node]")) return;
      if (forcePan) e.preventDefault();
      setPanning({ x: e.clientX - viewport.x, y: e.clientY - viewport.y, button: e.button });
    },
    [viewport, spacePressed]
  );

  const onNodeMouseDown = useCallback(
    (e: React.MouseEvent, node: CanvasNode) => {
      if (spacePressed || e.button === 1 || e.button !== 0) return;
      e.stopPropagation();
      setSelectedNodeId(node.id);
      setDragging({
        nodeId: node.id,
        offsetX: e.clientX - node.x * viewport.scale - viewport.x,
        offsetY: e.clientY - node.y * viewport.scale - viewport.y,
      });
    },
    [viewport, spacePressed]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (panning) {
        setViewport((v) => ({ ...v, x: e.clientX - panning.x, y: e.clientY - panning.y }));
      }
      if (dragging) {
        setNodes((ns) =>
          ns.map((n) =>
            n.id === dragging.nodeId
              ? {
                  ...n,
                  x: (e.clientX - dragging.offsetX - viewport.x) / viewport.scale,
                  y: (e.clientY - dragging.offsetY - viewport.y) / viewport.scale,
                }
              : n
          )
        );
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (panning && panning.button === e.button) setPanning(null);
      if (dragging) setDragging(null);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [panning, dragging, viewport]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !spacePressed) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePressed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [spacePressed]);

  const resetViewport = useCallback(
    (focusNode?: CanvasNode) => {
      const target = focusNode || nodes[0];
      if (target) {
        setViewport({ x: -target.x + 120, y: 120, scale: 0.8 });
      } else {
        setViewport({ x: -CANVAS_WIDTH / 2 + 400, y: 80, scale: 0.75 });
      }
    },
    [nodes]
  );

  useEffect(() => {
    if (nodes.length === 1) resetViewport(nodes[0]);
  }, [nodes.length, resetViewport]);

  return {
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    layout,
    nodes,
    setNodes,
    viewport,
    setViewport,
    selectedNodeId,
    setSelectedNodeId,
    selectedNode,
    dragging,
    panning,
    spacePressed,
    canvasRef,
    addNode,
    updateNode,
    removeNode,
    relayout,
    bounds,
    fitView,
    focusNode,
    onWheel,
    onMouseDown,
    onNodeMouseDown,
    resetViewport,
  };
}
