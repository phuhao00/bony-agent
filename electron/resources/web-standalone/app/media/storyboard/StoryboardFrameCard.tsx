import { useRef, useState } from "react";

export interface StoryboardFrame {
  id: string;
  prompt: string;
  description: string;
  duration: number;
  imageUrl?: string;
  generating?: boolean;
  error?: string;
  customImage?: File;
  customImagePreview?: string;
}

interface StoryboardFrameCardProps {
  frame: StoryboardFrame;
  index: number;
  totalFrames: number;
  onMove: (frameId: string, direction: "up" | "down") => void;
  onRemove: (frameId: string) => void;
  onGenerate: (frameId: string) => void;
  onUpload: (
    frameId: string,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => void;
  onUpdate: (frameId: string, updates: Partial<StoryboardFrame>) => void;
}

export default function StoryboardFrameCard({
  frame,
  index,
  totalFrames,
  onMove,
  onRemove,
  onGenerate,
  onUpload,
  onUpdate,
}: StoryboardFrameCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [syncingPrompt, setSyncingPrompt] = useState(false);

  // 根据中文场景描述自动生成英文图片提示词
  const handleSyncPromptFromDescription = async () => {
    if (!frame.description.trim()) return;
    setSyncingPrompt(true);
    try {
      const res = await fetch("/api/tools/storyboard/sync-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: frame.description }),
      });
      const data = await res.json();
      if (data.prompt) {
        onUpdate(frame.id, { prompt: data.prompt });
      }
    } catch {
      // 静默失败，用户可手动编辑
    } finally {
      setSyncingPrompt(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden hover:shadow-xl transition-shadow">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-4 py-3 flex items-center justify-between border-b border-gray-200">
        <span className="font-semibold text-gray-700">分镜 {index + 1}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onMove(frame.id, "up")}
            disabled={index === 0}
            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
            title="上移"
          >
            ↑
          </button>
          <button
            onClick={() => onMove(frame.id, "down")}
            disabled={index === totalFrames - 1}
            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
            title="下移"
          >
            ↓
          </button>
          <button
            onClick={() => onRemove(frame.id)}
            className="p-1 text-red-400 hover:text-red-600"
            title="删除"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Image Area */}
      <div className="p-4">
        <div className="aspect-video bg-gray-100 rounded-xl overflow-hidden mb-4 relative group">
          {frame.generating ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-100 to-blue-100">
              <div className="text-center">
                <div className="animate-spin text-4xl mb-2">⏳</div>
                <p className="text-gray-600">生成中...</p>
              </div>
            </div>
          ) : frame.customImagePreview ? (
            <img
              src={frame.customImagePreview}
              alt={frame.description}
              className="w-full h-full object-cover"
            />
          ) : frame.imageUrl ? (
            <img
              src={frame.imageUrl}
              alt={frame.description}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
              <span className="text-4xl mb-2">🖼️</span>
              <span>暂无图片</span>
            </div>
          )}

          {/* Hover Actions */}
          {!frame.generating && (
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
              <button
                onClick={() => onGenerate(frame.id)}
                className="px-4 py-2 bg-white text-gray-800 rounded-lg font-medium hover:bg-gray-100 transition-colors"
              >
                🎨 AI生成
              </button>
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={(e) => onUpload(frame.id, e)}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-white text-gray-800 rounded-lg font-medium hover:bg-gray-100 transition-colors"
              >
                📁 上传替换
              </button>
            </div>
          )}
        </div>

        {/* Error Message */}
        {frame.error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
            ⚠️ {frame.error}
          </div>
        )}

        {/* Description Input */}
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            场景描述
          </label>
          <input
            type="text"
            value={frame.description}
            onChange={(e) =>
              onUpdate(frame.id, { description: e.target.value })
            }
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:ring-2 focus:ring-purple-500"
            placeholder="简短描述这个场景..."
          />
        </div>

        {/* Prompt Input */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-gray-500">
              图片生成提示词
            </label>
            <button
              onClick={handleSyncPromptFromDescription}
              disabled={syncingPrompt || !frame.description.trim()}
              className="text-xs text-purple-500 hover:text-purple-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              title="根据场景描述自动生成提示词"
            >
              {syncingPrompt ? "同步中..." : "↻ 从描述同步"}
            </button>
          </div>
          <textarea
            value={frame.prompt}
            onChange={(e) => onUpdate(frame.id, { prompt: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:ring-2 focus:ring-purple-500 resize-none"
            placeholder="详细的图片生成提示词..."
          />
        </div>

        {/* Duration Input */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500">时长:</label>
          <input
            type="number"
            min={1}
            max={10}
            value={frame.duration}
            onChange={(e) =>
              onUpdate(frame.id, {
                duration: Number(e.target.value),
              })
            }
            className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm text-gray-800"
          />
          <span className="text-xs text-gray-500">秒</span>
        </div>
      </div>
    </div>
  );
}
