"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
import { Scissors, Copy, Trash2, Magnet, Plus, Eye, EyeOff, Volume2, VolumeX, Layers } from "lucide-react";
import type { MediaAsset, Scene, TimelineElement, Track } from "../lib/types";

interface TimelineProps {
  scene: Scene;
  currentTime: number;
  duration: number;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onSeek: (time: number) => void;
  onMoveElement: (elementId: string, trackId: string, newStart: number) => void;
  onSplitElement: (elementId: string, splitTime: number) => void;
  onDeleteElements: (ids: string[]) => void;
  draggingAsset?: MediaAsset | null;
  onAssetDrop?: (asset: MediaAsset, trackId: string, time: number) => void;
}

const TRACK_HEIGHT = 42;
const ZOOM_PX_PER_SECOND = 50;

export default function Timeline({
  scene,
  currentTime,
  duration,
  selectedIds,
  onSelect,
  onSeek,
  onMoveElement,
  onSplitElement,
  onDeleteElements,
  draggingAsset,
  onAssetDrop,
}: TimelineProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [assetOverTrackId, setAssetOverTrackId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ignoreNextClickRef = useRef(false);
  const scrollStartRef = useRef(0);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const tracks = useMemo(
    () => [
      ...scene.tracks.overlay.map((t) => ({ track: t, type: "overlay" as const })),
      { track: scene.tracks.main, type: "main" as const },
      ...scene.tracks.audio.map((t) => ({ track: t, type: "audio" as const })),
    ],
    [scene.tracks]
  );

  const elementsByTrack = useMemo(() => {
    const map: Record<string, TimelineElement[]> = {};
    for (const el of scene.elements) (map[el.trackId] ||= []).push(el);
    return map;
  }, [scene.elements]);

  const width = Math.max((duration || 1) * ZOOM_PX_PER_SECOND, 800);

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setDraggingId(id);
    scrollStartRef.current = scrollRef.current?.scrollLeft ?? 0;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over, delta } = event;
    if (!over) return;

    const elementId = String(active.id);
    const el = scene.elements.find((e) => e.id === elementId);
    if (!el) return;

    let targetTrackId = String(over.id);
    const overElement = scene.elements.find((e) => e.id === targetTrackId);
    if (overElement) targetTrackId = overElement.trackId;
    if (!tracks.some(({ track }) => track.id === targetTrackId)) return;

    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const scrollDelta = (scrollLeft - scrollStartRef.current) / ZOOM_PX_PER_SECOND;
    const newStart = Math.max(0, el.startTime + delta.x / ZOOM_PX_PER_SECOND + scrollDelta);
    onSelect([elementId]);
    onMoveElement(elementId, targetTrackId, newStart);
  };

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
    onSeek(Math.max(0, x / ZOOM_PX_PER_SECOND));
  };

  const handleTrackDragOver = (trackId: string) => (e: React.DragEvent) => {
    if (!draggingAsset) return;
    e.preventDefault();
    setAssetOverTrackId(trackId);
  };

  const handleTrackDrop = (trackId: string) => (e: React.DragEvent) => {
    if (!draggingAsset || !scrollRef.current || !onAssetDrop) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    const time = Math.max(0, x / ZOOM_PX_PER_SECOND);
    onAssetDrop(draggingAsset, trackId, time);
    ignoreNextClickRef.current = true;
    setTimeout(() => {
      ignoreNextClickRef.current = false;
    }, 100);
    setAssetOverTrackId(null);
  };

  const handleTrackDragLeave = (trackId: string) => (e: React.DragEvent) => {
    if (!draggingAsset) return;
    e.preventDefault();
    setAssetOverTrackId((prev) => (prev === trackId ? null : prev));
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} autoScroll>
      <div className="flex h-72 shrink-0 flex-col border-t border-[var(--separator-subtle)] bg-[var(--shell-bg)]">
        <div className="flex h-11 items-center gap-1 border-b border-[var(--separator-subtle)] px-3">
          <ToolButton icon={<Scissors size={16} strokeWidth={1.5} />} onClick={() => selectedIds.length === 1 && onSplitElement(selectedIds[0], currentTime)} disabled={selectedIds.length !== 1} />
          <ToolButton icon={<Copy size={16} strokeWidth={1.5} />} disabled />
          <ToolButton icon={<Trash2 size={16} strokeWidth={1.5} />} onClick={() => onDeleteElements(selectedIds)} disabled={selectedIds.length === 0} />
          <div className="mx-1 h-5 w-px bg-[var(--separator)]" />
          <ToolButton icon={<Magnet size={16} strokeWidth={1.5} />} disabled />
          <ToolButton icon={<Plus size={16} strokeWidth={1.5} />} disabled />
          <div className="flex-1" />
          <button className="flex items-center gap-2 rounded-lg bg-[var(--card-bg)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--shell-bg)] border border-[var(--separator-subtle)]">
            <Layers size={14} strokeWidth={1.5} className="text-[var(--foreground)]/70" />
            Main scene
          </button>
        </div>

        <div className="relative flex flex-1 overflow-hidden">
          <div className="chrome-rail chrome-rail-edge-right w-52 shrink-0">
            <div className="h-7 border-b border-[var(--separator-subtle)]" />
            {tracks.map(({ track, type }) => (
              <div
                key={track.id}
                className="flex items-center justify-between border-b border-[var(--separator-subtle)] px-3"
                style={{ height: TRACK_HEIGHT }}
              >
                <span className="truncate text-xs font-medium text-[var(--foreground)]">{track.name || type}</span>
                <div className="flex items-center gap-1.5 text-[var(--foreground)]/80">
                  {type !== "audio" && <button className="rounded p-0.5 hover:bg-[var(--nav-active-fill)] hover:text-[var(--foreground)]">{track.visible ?? true ? <Eye size={13} strokeWidth={1.5} /> : <EyeOff size={13} strokeWidth={1.5} />}</button>}
                  <button className="rounded p-0.5 hover:bg-[var(--nav-active-fill)] hover:text-[var(--foreground)]">{track.muted ? <VolumeX size={13} strokeWidth={1.5} /> : <Volume2 size={13} strokeWidth={1.5} />}</button>
                </div>
              </div>
            ))}
          </div>

          <div
            ref={scrollRef}
            className="relative flex-1 overflow-auto bg-[var(--card-bg)]"
            onClick={handleRulerClick}
            onDragOver={(e) => {
              if (draggingAsset) e.preventDefault();
            }}
          >
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
                  draggingAsset={draggingAsset}
                  isAssetOver={assetOverTrackId === track.id}
                  onDragOver={handleTrackDragOver(track.id)}
                  onDrop={handleTrackDrop(track.id)}
                  onDragLeave={handleTrackDragLeave(track.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </DndContext>
  );
}

function ToolButton({ icon, onClick, disabled }: { icon: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-[var(--foreground)] transition hover:bg-[var(--nav-active-fill)] disabled:opacity-40"
    >
      {icon}
    </button>
  );
}

function Ruler({ duration, currentTime }: { duration: number; currentTime: number }) {
  return (
    <div className="chrome-bar relative h-7 border-b border-[var(--separator-subtle)]">
      {Array.from({ length: Math.ceil((duration || 1) * 2) + 1 }).map((_, i) => {
        const t = i / 2;
        const isSecond = Number.isInteger(t);
        return (
          <div
            key={i}
            className={`absolute bottom-0 border-l ${isSecond ? "h-2 border-[var(--foreground)]/50" : "h-1 border-[var(--separator)]"}`}
            style={{ left: t * ZOOM_PX_PER_SECOND }}
          >
            {isSecond && <span className="absolute -top-4 left-0.5 text-[9px] text-[var(--foreground)]/60">{t.toFixed(0)}s</span>}
          </div>
        );
      })}
      <div className="absolute top-0 h-full w-px bg-[var(--accent)]" style={{ left: currentTime * ZOOM_PX_PER_SECOND }} />
    </div>
  );
}

function TrackRow({
  track,
  elements,
  selectedIds,
  onSelect,
  draggingId,
  draggingAsset,
  isAssetOver,
  onDragOver,
  onDrop,
  onDragLeave,
}: {
  track: Track;
  elements: TimelineElement[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  draggingId: string | null;
  draggingAsset?: MediaAsset | null;
  isAssetOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: track.id });
  const acceptsAsset = !!draggingAsset && (draggingAsset.assetType === "audio" ? track.type === "audio" : track.type !== "audio");
  return (
    <div
      ref={setNodeRef}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      className={`relative border-b border-[var(--separator-subtle)] transition ${
        isOver ? "bg-[var(--accent)]/10" : ""
      } ${acceptsAsset && isAssetOver ? "bg-[var(--accent)]/10" : ""}`}
      style={{ height: TRACK_HEIGHT, width: "100%", minWidth: 800 }}
    >
      {elements.map((el) => (
        <ElementBlock
          key={el.id}
          element={el}
          selected={selectedIds.includes(el.id)}
          isDragging={draggingId === el.id}
          onSelect={() => onSelect([el.id])}
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
  onSelect?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: element.id, data: { element } });
  const left = element.startTime * ZOOM_PX_PER_SECOND;
  const width = Math.max(element.duration * ZOOM_PX_PER_SECOND, 4);
  const draggedRef = useRef(false);

  useEffect(() => {
    if (transform) draggedRef.current = true;
  }, [transform]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        draggedRef.current = false;
        listeners?.onPointerDown?.(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!draggedRef.current) onSelect?.();
        draggedRef.current = false;
      }}
      className={`absolute top-1 h-[calc(100%-8px)] cursor-move select-none overflow-hidden rounded-md border px-2 py-1 text-[10px] transition-colors ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--foreground)]"
          : "border-[var(--separator)] bg-[var(--shell-bg)] text-[var(--foreground)] hover:border-[var(--label-secondary)] hover:bg-[var(--card-bg)]"
      } ${isDragging ? "z-10 opacity-90" : ""}`}
      style={{ left, width, transform: CSS.Transform.toString(transform) }}
      title={element.name}
    >
      <div className="truncate font-medium">{element.name}</div>
      <div className="truncate text-[9px] text-[var(--foreground)]/60">{element.type}</div>
    </div>
  );
}
