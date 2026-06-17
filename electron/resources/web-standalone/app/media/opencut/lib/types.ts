export interface MediaAsset {
  assetId: string;
  name: string;
  path: string;
  assetType: "video" | "image" | "audio";
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  thumbnailPath?: string;
  waveformPath?: string;
}

export interface ElementPlacement {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  scaleX?: number;
  scaleY?: number;
}

export interface Keyframe {
  time: number;
  value: number;
}

export interface TimelineElement {
  id: string;
  trackId: string;
  name: string;
  type: "video" | "image" | "audio" | "text" | "effect" | "sticker" | "graphic";
  assetId?: string;
  startTime: number;
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  placement: ElementPlacement;
  params?: Record<string, any>;
  keyframes?: Record<string, Keyframe[]>;
}

export interface Track {
  id: string;
  name: string;
  type: "overlay" | "main" | "audio";
  trackType: "video" | "text" | "audio" | "graphic" | "effect";
  visible?: boolean;
  muted?: boolean;
}

export interface SceneTracks {
  overlay: Track[];
  main: Track;
  audio: Track[];
}

export interface Scene {
  id: string;
  name: string;
  tracks: SceneTracks;
  elements: TimelineElement[];
  duration: number;
  width: number;
  height: number;
  fps: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Project {
  projectId: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  scenes: Scene[];
  currentSceneId: string;
  createdAt?: string;
  updatedAt?: string;
}
