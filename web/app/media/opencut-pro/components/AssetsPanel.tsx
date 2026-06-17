"use client";

import { Upload, Image, Music, Film } from "lucide-react";
import { useState, useRef } from "react";
import type { MediaAsset } from "../lib/types";

interface AssetsPanelProps {
  assets: MediaAsset[];
  onUpload: (file: File) => Promise<void>;
  onDragStart?: (asset: MediaAsset) => void;
}

export default function AssetsPanel({ assets, onUpload, onDragStart }: AssetsPanelProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      await onUpload(file);
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const getIcon = (type: string) => {
    if (type === "image") return <Image size={16} />;
    if (type === "audio") return <Music size={16} />;
    return <Film size={16} />;
  };

  return (
    <div className="flex h-full flex-col border-r border-[var(--separator)] bg-[var(--card-bg)]">
      <div className="flex h-12 items-center justify-between border-b border-[var(--separator)] px-4">
        <span className="font-medium text-[var(--foreground)]">资源库</span>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Upload size={12} />
          {uploading ? "上传中" : "导入"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,image/*,audio/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {assets.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--separator)] p-6 text-center text-sm text-[var(--label-secondary)]">
            拖入或导入视频、图片、音频
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {assets.map((asset) => (
            <div
              key={asset.assetId}
              draggable
              onDragStart={() => onDragStart?.(asset)}
              className="group cursor-grab rounded-lg border border-[var(--separator)] bg-[var(--shell-bg)] p-2 hover:border-blue-500 active:cursor-grabbing"
            >
              <div className="relative aspect-video overflow-hidden rounded bg-black">
                {asset.thumbnailPath ? (
                  <img
                    src={`/api/backend/opencut/media-file?path=${encodeURIComponent(asset.thumbnailPath)}`}
                    alt={asset.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[var(--label-secondary)]">
                    {getIcon(asset.assetType)}
                  </div>
                )}
              </div>
              <div className="mt-1.5 truncate text-xs text-[var(--foreground)]">
                {asset.name}
              </div>
              <div className="text-[10px] text-[var(--label-secondary)]">
                {asset.assetType} · {Math.round(asset.duration)}s
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
