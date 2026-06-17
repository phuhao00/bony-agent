"use client";

import { useRef, useState } from "react";
import {
  Film,
  Music,
  Type,
  Sparkles,
  Wand2,
  Settings,
  Upload,
  List,
  Grid3X3,
  FileVideo,
  Image as ImageIcon,
  Headphones,
  Trash2,
  X,
  Check,
  AlertTriangle,
} from "lucide-react";
import type { MediaAsset } from "../lib/types";

type Tab = "media" | "audio" | "text" | "transitions" | "effects" | "settings";

interface AssetsSidebarProps {
  assets: MediaAsset[];
  onUpload: (file: File) => void;
  onDragStart?: (asset: MediaAsset) => void;
  onDragEnd?: () => void;
  onDeleteAssets?: (assetIds: string[]) => void | Promise<void>;
  usedAssetIds?: Set<string>;
}

const TABS: { key: Tab; icon: React.ReactNode; label: string }[] = [
  { key: "media", icon: <Film size={18} strokeWidth={1.5} />, label: "媒体" },
  { key: "audio", icon: <Music size={18} strokeWidth={1.5} />, label: "音频" },
  { key: "text", icon: <Type size={18} strokeWidth={1.5} />, label: "文字" },
  { key: "transitions", icon: <Sparkles size={18} strokeWidth={1.5} />, label: "转场" },
  { key: "effects", icon: <Wand2 size={18} strokeWidth={1.5} />, label: "特效" },
  { key: "settings", icon: <Settings size={18} strokeWidth={1.5} />, label: "设置" },
];

export default function AssetsSidebar({
  assets,
  onUpload,
  onDragStart,
  onDragEnd,
  onDeleteAssets,
  usedAssetIds,
}: AssetsSidebarProps) {
  const [activeTab, setActiveTab] = useState<Tab>("media");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered =
    activeTab === "media" || activeTab === "audio"
      ? assets.filter((a) => (activeTab === "audio" ? a.assetType === "audio" : a.assetType !== "audio"))
      : [];

  const toggleSelect = (assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filtered.map((a) => a.assetId)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    clearSelection();
  };

  const requestDelete = (ids: string[]) => {
    if (ids.length === 0) return;
    setConfirmIds(ids);
  };

  const handleConfirmDelete = async () => {
    if (!confirmIds || !onDeleteAssets) return;
    setDeleting(true);
    try {
      await onDeleteAssets(confirmIds);
    } finally {
      setDeleting(false);
      setConfirmIds(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of confirmIds) next.delete(id);
        return next;
      });
    }
  };

  const confirmUsedCount = confirmIds ? confirmIds.filter((id) => usedAssetIds?.has(id)).length : 0;
  const confirmNames = confirmIds
    ? assets
        .filter((a) => confirmIds.includes(a.assetId))
        .slice(0, 3)
        .map((a) => a.name)
    : [];

  return (
    <div className="chrome-rail chrome-rail-edge-right flex h-full w-72 shrink-0">
      <div className="flex w-14 flex-col items-center gap-0.5 border-r border-[var(--separator-subtle)] py-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex h-11 w-11 flex-col items-center justify-center rounded-lg text-[10px] transition ${
              activeTab === tab.key
                ? "bg-[var(--nav-active-fill)] text-[var(--foreground)]"
                : "text-[var(--foreground)]/60 hover:bg-[var(--nav-active-fill)] hover:text-[var(--foreground)]"
            }`}
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      <div className="flex flex-1 flex-col">
        <div className="flex h-11 items-center justify-between border-b border-[var(--separator-subtle)] px-3">
          {selectMode ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  onClick={exitSelectMode}
                  className="rounded p-1 text-[var(--foreground)]/70 hover:bg-[var(--nav-active-fill)] hover:text-[var(--foreground)]"
                  title="退出多选"
                >
                  <X size={14} strokeWidth={1.5} />
                </button>
                <span className="text-xs font-semibold text-[var(--foreground)]">已选 {selectedIds.size}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={selectedIds.size === filtered.length ? clearSelection : selectAll}
                  className="rounded px-2 py-1 text-[11px] font-medium text-[var(--foreground)]/70 hover:bg-[var(--nav-active-fill)] hover:text-[var(--foreground)]"
                >
                  {selectedIds.size === filtered.length ? "取消全选" : "全选"}
                </button>
                <button
                  onClick={() => requestDelete(Array.from(selectedIds))}
                  disabled={selectedIds.size === 0}
                  className="flex items-center gap-1 rounded-md bg-[var(--status-danger-bg)] px-2 py-1 text-[11px] font-medium text-[var(--status-danger-text)] transition hover:opacity-80 disabled:opacity-30"
                >
                  <Trash2 size={12} strokeWidth={1.5} />
                  删除
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-xs font-semibold text-[var(--foreground)]">Assets</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSelectMode(true)}
                  className="rounded px-2 py-1 text-[11px] font-medium text-[var(--foreground)]/70 hover:bg-[var(--nav-active-fill)] hover:text-[var(--foreground)]"
                >
                  多选
                </button>
                <div className="flex items-center gap-1 rounded-md bg-[var(--shell-bg)] p-0.5">
                  <button
                    onClick={() => setViewMode("list")}
                    className={`rounded p-1 transition ${viewMode === "list" ? "bg-[var(--card-bg)] text-[var(--foreground)]" : "text-[var(--foreground)]/60 hover:text-[var(--foreground)]"}`}
                  >
                    <List size={13} />
                  </button>
                  <button
                    onClick={() => setViewMode("grid")}
                    className={`rounded p-1 transition ${viewMode === "grid" ? "bg-[var(--card-bg)] text-[var(--foreground)]" : "text-[var(--foreground)]/60 hover:text-[var(--foreground)]"}`}
                  >
                    <Grid3X3 size={13} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {activeTab === "media" || activeTab === "audio" ? (
            <>
              <button
                onClick={() => inputRef.current?.click()}
                className="mb-3 flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--separator)] bg-[var(--card-bg)] py-6 text-[var(--foreground)]/60 transition hover:border-[var(--label-secondary)] hover:text-[var(--foreground)]"
              >
                <Upload size={22} strokeWidth={1.5} />
                <span className="text-xs font-medium">Import</span>
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept="video/*,image/*,audio/*"
                onChange={(e) => {
                  for (const file of Array.from(e.target.files || [])) onUpload(file);
                  if (inputRef.current) inputRef.current.value = "";
                }}
                className="hidden"
              />
              {filtered.length === 0 && (
                <p className="px-2 text-center text-xs leading-relaxed text-[var(--foreground)]/60">
                  Drag and drop videos, photos, and audio files here
                </p>
              )}
              <div className={viewMode === "grid" ? "grid grid-cols-2 gap-2" : "space-y-2"}>
                {filtered.map((asset) => (
                  <AssetCard
                    key={asset.assetId}
                    asset={asset}
                    viewMode={viewMode}
                    selected={selectMode && selectedIds.has(asset.assetId)}
                    selectMode={selectMode}
                    onDragStart={() => onDragStart?.(asset)}
                    onDragEnd={() => onDragEnd?.()}
                    onToggleSelect={() => toggleSelect(asset.assetId)}
                    onRequestDelete={() => requestDelete([asset.assetId])}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center text-[var(--foreground)]/60">
              <Sparkles size={32} strokeWidth={1.5} className="mb-2 opacity-50" />
              <p className="text-xs">{activeTab} panel</p>
            </div>
          )}
        </div>
      </div>

      {confirmIds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="popover-surface w-full max-w-sm rounded-2xl p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]">
                <AlertTriangle size={20} strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--foreground)]">删除素材</h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--label-secondary)]">
                  确定删除 <span className="font-medium text-[var(--foreground)]">{confirmIds.length}</span> 个素材吗？
                  {confirmNames.length > 0 && (
                    <span className="block truncate text-[10px] opacity-80">{confirmNames.join(", ")}{confirmIds.length > 3 ? " …" : ""}</span>
                  )}
                  此操作不可撤销。
                </p>
                {confirmUsedCount > 0 && (
                  <p className="mt-2 text-xs leading-relaxed text-[var(--status-danger-text)]">
                    其中 {confirmUsedCount} 个素材已在时间轴中使用，删除后相关片段将无法渲染。
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmIds(null)}
                disabled={deleting}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--foreground)]/70 transition hover:bg-[var(--nav-active-fill)] hover:text-[var(--foreground)]"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--status-danger-bg)] px-3 py-1.5 text-xs font-medium text-[var(--status-danger-text)] transition hover:opacity-80 disabled:opacity-50"
              >
                {deleting ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    删除中…
                  </>
                ) : (
                  <>
                    <Trash2 size={12} strokeWidth={1.5} />
                    删除
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssetCard({
  asset,
  viewMode,
  selected,
  selectMode,
  onDragStart,
  onDragEnd,
  onToggleSelect,
  onRequestDelete,
}: {
  asset: MediaAsset;
  viewMode: "grid" | "list";
  selected: boolean;
  selectMode: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onToggleSelect: () => void;
  onRequestDelete: () => void;
}) {
  const Icon = asset.assetType === "audio" ? Headphones : asset.assetType === "image" ? ImageIcon : FileVideo;
  const isGrid = viewMode === "grid";

  return (
    <div
      draggable={!selectMode}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => selectMode && onToggleSelect()}
      className={`group relative cursor-grab overflow-hidden rounded-xl border transition active:cursor-grabbing ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/10"
          : "border-[var(--separator-subtle)] bg-[var(--card-bg)] hover:border-[var(--separator)] hover:bg-[var(--shell-bg)]"
      } ${isGrid ? "" : "flex items-center gap-3 p-2"}`}
    >
      {selectMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          className={`absolute left-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded border transition ${
            selected
              ? "border-[var(--accent)] bg-[var(--accent)] text-white"
              : "border-[var(--separator)] bg-[var(--card-bg)] text-transparent hover:border-[var(--label-secondary)]"
          }`}
          aria-label={selected ? "取消选择" : "选择"}
        >
          {selected && <Check size={12} strokeWidth={2.5} />}
        </button>
      )}

      {!selectMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
          onDragStart={(e) => e.stopPropagation()}
          className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-[var(--card-bg)] text-[var(--status-danger-text)] opacity-0 shadow-sm transition hover:bg-[var(--status-danger-bg)] group-hover:opacity-100"
          title="删除素材"
          aria-label="删除素材"
        >
          <Trash2 size={12} strokeWidth={1.5} />
        </button>
      )}

      <div
        className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-[var(--shell-bg)] ${
          isGrid ? "aspect-video w-full" : "h-11 w-16 rounded-lg"
        }`}
      >
        <Icon size={isGrid ? 20 : 16} className="text-[var(--foreground)]" strokeWidth={1.5} />
        {asset.thumbnailPath && (
          <img
            src={`/api/backend/opencut/media-file?path=${encodeURIComponent(asset.thumbnailPath)}`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-0 transition group-hover:opacity-40"
          />
        )}
      </div>
      {isGrid ? (
        <div className="px-2 pb-2 pt-1.5">
          <div className="truncate text-[11px] font-medium text-[var(--foreground)]">{asset.name}</div>
          <div className="text-[10px] text-[var(--foreground)]/60">
            {asset.assetType} · {Math.round(asset.duration)}s
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-[var(--foreground)]">{asset.name}</div>
          <div className="text-[10px] text-[var(--foreground)]/60">{Math.round(asset.duration)}s</div>
        </div>
      )}
    </div>
  );
}
