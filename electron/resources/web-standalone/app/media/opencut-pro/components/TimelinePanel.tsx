"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, Volume2, VolumeX, Trash2, Scissors } from "lucide-react";
import type { Scene, TimelineElement, Track } from "../lib/types";

interface TimelinePanelProps {
  scene: Scene;
  currentTime: number;
  duration: number;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onSeek: (time: number) => void;
  onMoveElement: (elementId: string, trackId: string, newStart: number) => void;
  onSplitElement: (elementId: string, splitTime: number) => void;
  onDeleteElements: (ids: string[]) => void;
  onToggleTrackMute?: (trackId: string) => void;
  onToggleTrackVisibility?: (trackId: string) => void;
}

const TRACK_HEIGHT = 52;
const ZOOM_PX_PER_SECOND = 40;

export default function TimelinePanel({
  scene,
  currentTime,
  duration,
  selectedIds,
  onSelect,
  onSeek,
  onMoveElement,
  onSplitElement,
  onDeleteElements,
  onToggleTrackMute,
  onToggleTrackVisibility,
}: TimelinePanelProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const tracks: { track: Track; type: string }[] = useMemo(
    () => [
      ...scene.tracks.overlay.map((t) => ({ track: t, type: "overlay" })),
      { track: scene.tracks.main, type: "main" },
      ...scene.tracks.audio.map((t) => ({ track: t, type: "audio" })),
    ],
    [scene.tracks]
  );

  const elementsByTrack = useMemo(() => {
    const map: Record<string, TimelineElement[]> = {};
    for (const el of scene.elements) {
      (map[el.trackId] ||= []).push(el);
    }
    return map;
  }, [scene.elements]);

  const width = Math.max((duration || 1) * ZOOM_PX_PER_SECOND, 800);

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setDraggingId(id);
    onSelect([id]);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over, delta } = event;
    if (!over) return;

    const elementId = String(active.id);
    const el = scene.elements.find((e) => e.id === elementId);
    if (!el) return;

    let targetTrackId = String(over.id);
    // 如果放置目标是片段，则取该片段所在轨道
    const overElement = scene.elements.find((e) => e.id === targetTrackId);
    if (overElement) {
      targetTrackId = overElement.trackId;
    }
    if (!tracks.some(({ track }) => track.id === targetTrackId)) return;

    const newStart = Math.max(0, el.startTime + delta.x / ZOOM_PX_PER_SECOND);
    onMoveElement(elementId, targetTrackId, newStart);
  };

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
    onSeek(Math.max(0, x / ZOOM_PX_PER_SECOND));
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full flex-col border-t border-[var(--separator)] bg-[var(--card-bg)]">
        <div className="flex h-10 items-center justify-between border-b border-[var(--separator)] px-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--foreground)]">时间轴</span>
            <span className="text-xs text-[var(--label-secondary)]">
              {scene.elements.length} 个片段
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onSplitElement(selectedIds[0], currentTime)}
              disabled={selectedIds.length !== 1}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--shell-bg)] disabled:opacity-40"
            >
              <Scissors size={14} />
              分割
            </button>
            <button
              onClick={() => onDeleteElements(selectedIds)}
              disabled={selectedIds.length === 0}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 size={14} />
              删除
            </button>
          </div>
        </div>

        <div className="relative flex flex-1 overflow-hidden">
          {/* Track headers */}
          <div className="w-48 shrink-0 border-r border-[var(--separator)] bg-[var(--shell-bg)]">
            <div className="h-8 border-b border-[var(--separator)]" />
            {tracks.map(({ track, type }) => (
              <div
                key={track.id}
                className="flex items-center justify-between border-b border-[var(--separator)] px-3"
                style={{ height: TRACK_HEIGHT }}
              >
                <span className="truncate text-xs font-medium text-[var(--foreground)]">
                  {track.name || `${type} ${track.id.slice(0, 4)}`}
                </span>
                <div className="flex items-center gap-1">
                  {type !== "audio" && (
                    <button
                      onClick={() => onToggleTrackVisibility?.(track.id)}
                      className="rounded p-1 text-[var(--label-secondary)] hover:text-[var(--foreground)]"
                    >
                      {track.visible ?? true ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  )}
                  <button
                    onClick={() => onToggleTrackMute?.(track.id)}
                    className="rounded p-1 text-[var(--label-secondary)] hover:text-[var(--foreground)]"
                  >
                    {track.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Timeline ruler + tracks */}
          <div className="relative flex-1 overflow-auto" onClick={handleRulerClick}>
            <div style={{ width }}>
              <Ruler duration={duration} currentTime={currentTime} />

              {tracks.map(({ track }) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  elements={elementsByTrack[track.id] || []}
                  selectedIds={selectedIds}
                  onSelect={onSelect}
                  draggingId={draggingId}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </DndContext>
  );
}

function Ruler({ duration, currentTime }: { duration: number; currentTime: number }) {
  return (
    <div className="relative h-8 border-b border-[var(--separator)] bg-[var(--shell-bg)]">
      {Array.from({ length: Math.ceil((duration || 1) / 5) + 1 }).map((_, i) => {
        const t = i * 5;
        return (
          <div
            key={i}
            className="absolute top-0 h-full border-l border-[var(--separator)] pl-1 text-[10px] text-[var(--label-secondary)]"
            style={{ left: t * ZOOM_PX_PER_SECOND }}
          >
            {Math.floor(t / 60)}:{(t % 60).toString().padStart(2, "0")}
          </div>
        );
      })}
      <div
        className="absolute top-0 h-full w-px bg-blue-500"
        style={{ left: currentTime * ZOOM_PX_PER_SECOND }}
      />
    </div>
  );
}

function TrackRow({
  track,
  elements,
  selectedIds,
  onSelect,
  draggingId,
}: {
  track: Track;
  elements: TimelineElement[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  draggingId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: track.id });

  return (
    <div
      ref={setNodeRef}
      className={`relative border-b border-[var(--separator)] transition-colors ${
        isOver ? "bg-blue-500/10" : ""
      }`}
      style={{ height: TRACK_HEIGHT, width: "100%", minWidth: 800 }}
    >
      {elements.map((el) => (
        <ElementBlock
          key={el.id}
          element={el}
          selected={selectedIds.includes(el.id)}
          isDragging={draggingId === el.id}
          onSelect={(e) => {
            e.stopPropagation();
            onSelect([el.id]);
          }}
        />
      ))}
    </div>
  );
}

function ElementBlock({
  element,
  selected,
  isDragging,
  onSelect,
}: {
  element: TimelineElement;
  selected: boolean;
  isDragging: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: element.id,
    data: { element },
  });

  const left = element.startTime * ZOOM_PX_PER_SECOND;
  const width = Math.max(element.duration * ZOOM_PX_PER_SECOND, 4);

  const style: React.CSSProperties = {
    left,
    width,
    transform: CSS.Transform.toString(transform),
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onMouseDown={onSelect}
      className={`absolute top-1 h-[calc(100%-8px)] cursor-move select-none overflow-hidden rounded border px-1.5 py-1 text-[10px] ${
        selected
          ? "border-blue-500 bg-blue-500/20 text-blue-200"
          : "border-[var(--separator)] bg-[var(--shell-bg)] text-[var(--foreground)] hover:bg-[var(--hover-bg)]"
      } ${isDragging ? "z-10 opacity-90" : ""}`}
      style={style}
      title={element.name}
    >
      <div className="truncate">{element.name}</div>
    </div>
  );
}
