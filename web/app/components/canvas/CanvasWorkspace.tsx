"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Menu,
  Minus,
  Plus,
  Compass,
  Home,
  FolderOpen,
  BarChart3,
  Settings2,
  Maximize,
  List,
  ChevronDown,
  Circle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Minimap } from "./Minimap";
import type { CanvasNode, CanvasBounds, CanvasViewport } from "@/hooks/useCanvas";

export interface CanvasWorkspaceProps {
  projectPath: string;
  projectName?: string;
  projectAvatar?: React.ReactNode;
  leftExtraIcons?: { icon: React.ReactNode; active?: boolean; title: string; onClick?: () => void }[];
  children: React.ReactNode;
  rightPanel: React.ReactNode;
  drawer?: React.ReactNode;
  showMinimap?: boolean;
  onToggleMinimap?: () => void;
  viewport?: { scale: number; x: number; y: number };
  setViewport?: (v: { scale: number; x: number; y: number }) => void;
  resetViewport?: () => void;
  nodes?: CanvasNode[];
  bounds?: CanvasBounds;
  onTidy?: () => void;
  onFitView?: () => void;
  onFocusNode?: (node: CanvasNode) => void;
  activeTool?: string | null;
  onToolChange?: (tool: string | null) => void;
  layout?: "vertical" | "horizontal";
}

function classNames(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function CanvasWorkspace({
  projectPath,
  projectName,
  projectAvatar,
  leftExtraIcons,
  children,
  rightPanel,
  drawer,
  showMinimap,
  onToggleMinimap,
  viewport,
  setViewport,
  resetViewport,
  nodes,
  bounds,
  onTidy,
  onFitView,
  onFocusNode,
  activeTool: activeToolProp,
  onToolChange,
  layout = "vertical",
}: CanvasWorkspaceProps) {
  const router = useRouter();
  const [activeToolState, setActiveToolState] = useState<string | null>(null);
  const isControlled = activeToolProp !== undefined;
  const activeTool = isControlled ? activeToolProp : activeToolState;
  const setActiveTool = (tool: string | null) => {
    if (!isControlled) setActiveToolState(tool);
    onToolChange?.(tool);
  };

  const scale = viewport?.scale ?? 1;
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setNavigatorOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const flowNodes = (nodes || []).filter((n) => n.type !== "scene");

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[var(--background)]">
      {/* Left icon sidebar */}
      <aside className="w-14 shrink-0 flex flex-col items-center py-3 gap-2 border-r border-[var(--border-subtle)] bg-[var(--card-bg)] z-20">
        <button
          className={classNames(
            "w-9 h-9 rounded-xl flex items-center justify-center transition-colors mb-1",
            activeTool === "home" ? "bg-[color:var(--accent)]/10 text-[color:var(--accent)]" : "hover:bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]"
          )}
          title="返回首页"
          onClick={() => router.push("/")}
        >
          <Home className="w-4 h-4" />
        </button>

        <div className="w-6 h-px bg-[var(--border-subtle)] my-1" />

        <SidebarIcon icon={<FolderOpen className="w-4 h-4" />} active={activeTool === "files"} title="Files" onClick={() => setActiveTool("files")} />
        <SidebarIcon icon={<BarChart3 className="w-4 h-4" />} active={activeTool === "analytics"} title="Analytics" onClick={() => setActiveTool("analytics")} />
        <SidebarIcon icon={<Settings2 className="w-4 h-4" />} active={activeTool === "settings"} title="Settings" onClick={() => setActiveTool("settings")} />

        {leftExtraIcons?.map((item, idx) => (
          <SidebarIcon key={idx} icon={item.icon} active={item.active} title={item.title} onClick={item.onClick} />
        ))}

        <div className="mt-auto" />
      </aside>

      {/* Left drawer */}
      {drawer && (
        <div className="w-72 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--card-bg)] flex flex-col z-10">
          {drawer}
        </div>
      )}

      {/* Main workspace */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Floating top toolbar */}
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-30">
          <div className="flex items-center gap-1 bg-[var(--card-bg)]/90 backdrop-blur border border-[var(--border-subtle)] rounded-full px-2 py-1.5 shadow-sm">
            <button
              onClick={onTidy}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full hover:bg-[var(--nav-active-fill)] text-xs font-medium"
              title="整理布局"
            >
              <Menu className="w-3.5 h-3.5" /> Tidy
            </button>

            <div className="w-px h-3.5 bg-[var(--border-subtle)]" />

            <button
              onClick={onFitView}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full hover:bg-[var(--nav-active-fill)] text-xs font-medium"
              title="适应画布"
            >
              <Maximize className="w-3.5 h-3.5" /> Fit
            </button>

            <div className="relative" ref={navRef}>
              <button
                onClick={() => setNavigatorOpen((s) => !s)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full hover:bg-[var(--nav-active-fill)] text-xs font-medium"
                title="节点导航"
              >
                <List className="w-3.5 h-3.5" /> 节点 <ChevronDown className={classNames("w-3 h-3 transition-transform", navigatorOpen && "rotate-180")} />
              </button>
              {navigatorOpen && flowNodes.length > 0 && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-52 bg-[var(--card-bg)] border border-[var(--border-subtle)] rounded-2xl shadow-xl overflow-hidden py-1 z-50">
                  {flowNodes.map((node, idx) => (
                    <button
                      key={node.id}
                      onClick={() => {
                        onFocusNode?.(node);
                        setNavigatorOpen(false);
                      }}
                      className="w-full px-3 py-2 flex items-center gap-2 hover:bg-[var(--nav-active-fill)] text-left text-xs"
                    >
                      <span className="w-4 h-4 rounded-full bg-[color:var(--accent)] text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="flex-1 truncate">{node.title}</span>
                      <NodeStatusIcon status={node.status} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="w-px h-3.5 bg-[var(--border-subtle)]" />

            <button
              onClick={() => setViewport?.({ ...viewport!, scale: clamp(scale * 0.9, 0.2, 2) })}
              className="p-1.5 rounded-full hover:bg-[var(--nav-active-fill)]"
              title="缩小"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs text-[color:var(--label-secondary)] w-10 text-center">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => setViewport?.({ ...viewport!, scale: clamp(scale * 1.1, 0.2, 2) })}
              className="p-1.5 rounded-full hover:bg-[var(--nav-active-fill)]"
              title="放大"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-3.5 bg-[var(--border-subtle)]" />

            <button
              onClick={onToggleMinimap}
              className={classNames(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                showMinimap ? "bg-[color:var(--accent)]/10 text-[color:var(--accent)]" : "hover:bg-[var(--nav-active-fill)]"
              )}
              title="小地图"
            >
              <Compass className="w-3.5 h-3.5" /> Minimap
            </button>
          </div>

          <p className="text-[10px] text-center text-[color:var(--label-secondary)] mt-1.5 opacity-80">
            {layout === "horizontal" ? "Space / 中键拖拽画布" : "Space / 中键拖拽画布"}
          </p>
        </div>

        {/* Canvas area */}
        <div className="flex-1 relative overflow-hidden">
          {children}

          {showMinimap && nodes && bounds && viewport && setViewport && (
            <div className="absolute bottom-4 right-4 w-52 h-36 rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-bg)]/90 backdrop-blur shadow-xl overflow-hidden z-30">
              <Minimap nodes={nodes} bounds={bounds} viewport={viewport} setViewport={setViewport} showLabel={false} size={208} className="!static !shadow-none !border-0 !bg-transparent !p-0 w-full h-full" />
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <aside className="w-[460px] shrink-0 flex flex-col border-l border-[var(--border-subtle)] bg-[var(--card-bg)]">
        {rightPanel}
      </aside>
    </div>
  );
}

function NodeStatusIcon({ status }: { status: CanvasNode["status"] }) {
  if (status === "approved") return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
  if (status === "generating") return <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />;
  if (status === "ready") return <Circle className="w-3.5 h-3.5 text-[color:var(--accent)]" />;
  return <Circle className="w-3.5 h-3.5 text-[var(--border-subtle)]" />;
}

function SidebarIcon({
  icon,
  active,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  active?: boolean;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={classNames(
        "w-9 h-9 rounded-xl flex items-center justify-center transition-colors",
        active ? "bg-[var(--nav-active-fill)] text-[color:var(--accent)]" : "hover:bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]"
      )}
    >
      {icon}
    </button>
  );
}
