import type { Scene, TimelineElement, Track } from "./types";

export type MediaTime = number;

export function formatTime(time: MediaTime): string {
  const totalSeconds = Math.max(0, time);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frames = Math.floor((totalSeconds % 1) * 30);

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
}

export function getTrackDuration(scene: Scene): MediaTime {
  let maxEnd = 0;
  for (const el of scene.elements) {
    maxEnd = Math.max(maxEnd, el.startTime + el.duration);
  }
  return maxEnd || 1;
}

export function getElementEnd(el: TimelineElement): MediaTime {
  return el.startTime + el.duration;
}

export function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 11)}`;
}

export function findTrack(scene: Scene, trackId: string): Track | null {
  if (scene.tracks.main.id === trackId) return scene.tracks.main;
  const overlay = scene.tracks.overlay.find((t) => t.id === trackId);
  if (overlay) return overlay;
  return scene.tracks.audio.find((t) => t.id === trackId) || null;
}
