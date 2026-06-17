"use client";

import { useEffect, useRef } from "react";
import { Play, Pause, Loader2 } from "lucide-react";

interface PreviewCanvasProps {
  currentTime: number;
  duration: number;
  playing: boolean;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  frameUrl: string | null;
  previewUrl?: string | null;
  previewLoading?: boolean;
  onRenderPreview?: () => void | Promise<void>;
}

export default function PreviewCanvas({
  currentTime,
  duration,
  playing,
  onPlayPause,
  onSeek,
  frameUrl,
  previewUrl,
  previewLoading,
  onRenderPreview,
}: PreviewCanvasProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isSeekingRef = useRef(false);
  const pendingPlayRef = useRef(false);

  useEffect(() => {
    console.log("[Preview] state", { playing, previewUrl: previewUrl || null, previewLoading, currentTime, duration });
  });

  // 当 previewUrl/playing 变化时控制播放/暂停
  useEffect(() => {
    const video = videoRef.current;
    console.log("[Preview] play effect", { hasVideo: !!video, previewUrl: previewUrl || null, playing, readyState: video?.readyState, paused: video?.paused });
    if (!video || !previewUrl) return;

    if (playing) {
      if (video.paused) {
        const play = () => {
          console.log("[Preview] calling video.play()");
          video.play().then(() => {
            console.log("[Preview] video.play() resolved");
            pendingPlayRef.current = false;
          }).catch((err) => {
            console.error("[Preview] video.play() rejected", err);
            pendingPlayRef.current = true;
          });
        };
        if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
          play();
        } else {
          console.log("[Preview] video not ready, pending play");
          pendingPlayRef.current = true;
        }
      }
    } else {
      pendingPlayRef.current = false;
      console.log("[Preview] pausing video");
      video.pause();
    }
  }, [playing, previewUrl]);

  // 外部 currentTime 变化时同步到视频（仅在非视频自身驱动时）
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewUrl || isSeekingRef.current) return;
    const diff = Math.abs(video.currentTime - currentTime);
    console.log("[Preview] currentTime effect", { videoTime: video.currentTime, currentTime, diff });
    if (diff > 0.5) {
      console.log("[Preview] seek video to", currentTime);
      isSeekingRef.current = true;
      video.currentTime = currentTime;
    }
  }, [currentTime, previewUrl]);

  // 没有预览视频时，点击播放自动渲染
  useEffect(() => {
    console.log("[Preview] render trigger effect", { playing, previewUrl: previewUrl || null, previewLoading });
    if (!playing || previewUrl || previewLoading) return;
    console.log("[Preview] calling onRenderPreview");
    onRenderPreview?.();
  }, [playing, previewUrl, previewLoading, onRenderPreview]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * 30);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
  };

  const handleVideoTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || isSeekingRef.current) return;
    const t = video.currentTime;
    if (Math.abs(t - currentTime) > 0.03) {
      onSeek(t);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
        {previewUrl ? (
          <video
            key={previewUrl}
            ref={videoRef}
            src={previewUrl}
            muted
            playsInline
            preload="auto"
            className="max-h-full max-w-full"
            onLoadedData={() => {
              console.log("[Preview] video loadeddata", { readyState: videoRef.current?.readyState, pendingPlay: pendingPlayRef.current, playing });
              if (pendingPlayRef.current && playing && videoRef.current) {
                pendingPlayRef.current = false;
                videoRef.current.play().catch((err) => console.error("[Preview] pending play failed", err));
              }
            }}
            onSeeking={() => {
              console.log("[Preview] video seeking");
              isSeekingRef.current = true;
            }}
            onSeeked={() => {
              console.log("[Preview] video seeked", { currentTime: videoRef.current?.currentTime });
              isSeekingRef.current = false;
            }}
            onTimeUpdate={handleVideoTimeUpdate}
            onEnded={() => {
              console.log("[Preview] video ended");
              onSeek(0);
            }}
            onError={(e) => {
              console.error("[Preview] video error", e);
            }}
          />
        ) : frameUrl ? (
          <img src={frameUrl} alt="preview" className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center text-white/70">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-white/10 backdrop-blur-sm">
              <Play size={28} fill="currentColor" className="ml-1" />
            </div>
            <p className="text-sm font-medium">Import media to start editing</p>
          </div>
        )}
      </div>

      <div className="chrome-bar flex h-12 items-center justify-center gap-4 px-4">
        <div className="font-mono text-xs tracking-wide text-[var(--accent)]">
          {formatTime(currentTime)} <span className="text-[var(--foreground)]/50">/ {formatTime(duration)}</span>
        </div>

        <button
          onClick={onPlayPause}
          disabled={previewLoading}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-sm transition hover:bg-gray-100 disabled:opacity-50"
        >
          {previewLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : playing ? (
            <Pause size={14} fill="currentColor" />
          ) : (
            <Play size={14} fill="currentColor" className="ml-0.5" />
          )}
        </button>
      </div>
    </div>
  );
}
