"use client";

import { Play, Pause, SkipBack, SkipForward, Volume2, Maximize } from "lucide-react";
import { useEffect, useRef } from "react";

interface PreviewPanelProps {
  currentTime: number;
  duration: number;
  playing: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  frameUrl: string | null;
  previewUrl?: string | null;
}

export default function PreviewPanel({
  currentTime,
  duration,
  playing,
  onPlayPause,
  onSeek,
  frameUrl,
  previewUrl,
}: PreviewPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // 导出视频存在时：播放/暂停同步到 video 元素
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewUrl) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing, previewUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewUrl) return;
    if (Math.abs(video.currentTime - currentTime) > 0.5) {
      video.currentTime = currentTime;
    }
  }, [currentTime, previewUrl]);

  // 未导出时：模拟播放，每 100ms 推进时间
  useEffect(() => {
    if (!playing || !duration || previewUrl) return undefined;
    const timer = setInterval(() => {
      onSeek(Math.min(duration, currentTime + 0.1));
    }, 100);
    return () => clearInterval(timer);
  }, [playing, duration, currentTime, onSeek, previewUrl]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    onSeek(video.currentTime);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex h-full flex-col bg-[var(--shell-bg)]">
      <div className="flex h-12 items-center justify-between border-b border-[var(--separator)] px-4">
        <span className="font-medium text-[var(--foreground)]">预览</span>
        <div className="flex items-center gap-2 text-sm text-[var(--label-secondary)]">
          <Volume2 size={16} />
          <Maximize size={16} className="cursor-pointer hover:text-[var(--foreground)]" />
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center bg-black p-4">
        {previewUrl ? (
          <video
            ref={videoRef}
            src={previewUrl}
            className="max-h-full max-w-full rounded-md shadow-2xl"
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => onSeek(0)}
          />
        ) : frameUrl ? (
          <img
            src={frameUrl}
            alt="preview"
            className="max-h-full max-w-full rounded-md shadow-2xl object-contain"
          />
        ) : (
          <div className="text-center text-[var(--label-secondary)]">
            <Play size={48} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">添加片段并渲染预览</p>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--separator)] bg-[var(--card-bg)] p-3">
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={currentTime || 0}
          onChange={(e) => {
            const t = parseFloat(e.target.value);
            if (videoRef.current) videoRef.current.currentTime = t;
            onSeek(t);
          }}
          className="w-full"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSeek(Math.max(0, currentTime - 5))}
              className="rounded p-1 text-[var(--foreground)] hover:bg-[var(--shell-bg)]"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={onPlayPause}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700"
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button
              onClick={() => onSeek(Math.min(duration, currentTime + 5))}
              className="rounded p-1 text-[var(--foreground)] hover:bg-[var(--shell-bg)]"
            >
              <SkipForward size={18} />
            </button>
          </div>
          <span className="text-xs font-mono text-[var(--label-secondary)]">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
