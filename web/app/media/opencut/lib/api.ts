import type { MediaAsset, Project, Track } from "./types";

const API_PREFIX = "/api/backend/opencut";

export async function createProject(name: string): Promise<Project> {
  const res = await fetch(`${API_PREFIX}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("创建项目失败");
  const data = await res.json();
  return normalizeProject(data.project);
}

export async function loadProject(projectId: string): Promise<Project> {
  const res = await fetch(`${API_PREFIX}/projects/${projectId}`);
  if (!res.ok) throw new Error("加载项目失败");
  const data = await res.json();
  return normalizeProject(data.project);
}

export async function saveProject(project: Project): Promise<void> {
  const res = await fetch(`${API_PREFIX}/projects/${project.projectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toBackendProject(project)),
  });
  if (!res.ok) throw new Error("保存项目失败");
}

export function toBackendProject(project: Project): any {
  const settings = {
    fps: { numerator: Math.round(project.fps) || 30, denominator: 1 },
    canvasSize: { width: project.width, height: project.height },
    canvasSizeMode: "preset",
    background: { type: "color", color: "#000000" },
  };
  return {
    metadata: {
      id: project.projectId,
      name: project.name,
      duration: project.scenes[0]?.duration || 0,
      createdAt: project.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    scenes: project.scenes.map((s) => {
      const emptyTrack = (t: Track) => ({
        id: t.id,
        name: t.name,
        type: t.trackType,
        muted: t.muted ?? false,
        hidden: !(t.visible ?? true),
        elements: [] as any[],
      });
      const tracks: any = {
        overlay: s.tracks.overlay.map(emptyTrack),
        main: emptyTrack(s.tracks.main),
        audio: s.tracks.audio.map(emptyTrack),
      };
      for (const el of s.elements) {
        const track =
          (s.tracks.main.id === el.trackId ? tracks.main : null) ||
          tracks.overlay.find((t: any) => t.id === el.trackId) ||
          tracks.audio.find((t: any) => t.id === el.trackId);
        if (!track) continue;
        track.elements.push({
          id: el.id,
          type: el.type,
          name: el.name,
          duration: el.duration,
          startTime: el.startTime,
          trimStart: el.trimStart ?? 0,
          trimEnd: el.trimEnd ?? 0,
          mediaId: el.assetId,
          params: { ...el.placement, ...el.params },
        });
      }
      return {
        id: s.id,
        name: s.name,
        isMain: true,
        tracks,
        bookmarks: [],
        createdAt: s.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }),
    currentSceneId: project.currentSceneId,
    settings,
    version: 1,
  };
}

export async function renameProject(projectId: string, name: string): Promise<Project> {
  const res = await fetch(`${API_PREFIX}/projects/${projectId}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("重命名项目失败");
  return normalizeProject((await res.json()).project);
}

export async function listAssets(): Promise<MediaAsset[]> {
  const res = await fetch(`${API_PREFIX}/assets`);
  if (!res.ok) throw new Error("加载资源失败");
  const data = await res.json();
  return data.assets;
}

export async function deleteAsset(assetId: string): Promise<void> {
  const res = await fetch(`${API_PREFIX}/media/${assetId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除素材失败");
}

export async function uploadAsset(file: File): Promise<MediaAsset> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_PREFIX}/assets/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error("上传资源失败");
  const data = await res.json();
  return data.asset;
}

export async function addElement(
  projectId: string,
  sceneId: string,
  payload: {
    trackId: string;
    assetId: string;
    startTime: number;
    duration?: number;
  }
): Promise<{ elementId: string }> {
  const res = await fetch(`${API_PREFIX}/projects/${projectId}/scenes/${sceneId}/elements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("添加片段失败");
  return res.json();
}

export async function exportProject(
  projectId: string,
  options?: { width?: number; height?: number; fps?: number }
): Promise<{ url: string; path: string }> {
  const res = await fetch(`${API_PREFIX}/projects/${projectId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: options ? JSON.stringify(options) : undefined,
  });
  if (!res.ok) throw new Error("导出失败");
  return res.json();
}

export async function executeCommand(
  projectId: string,
  commandType: string,
  params: Record<string, any>
): Promise<{ project: Project; result?: any }> {
  const res = await fetch(`${API_PREFIX}/projects/${projectId}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command_type: commandType, params }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`命令执行失败: ${res.status} ${text}`);
  }
  const data = await res.json();
  return { project: normalizeProject(data.project), result: data.result };
}

export async function undoProject(projectId: string): Promise<Project> {
  const res = await fetch(`${API_PREFIX}/projects/${projectId}/undo`, { method: "POST" });
  if (!res.ok) throw new Error("撤销失败");
  return normalizeProject((await res.json()).project);
}

export async function redoProject(projectId: string): Promise<Project> {
  const res = await fetch(`${API_PREFIX}/projects/${projectId}/redo`, { method: "POST" });
  if (!res.ok) throw new Error("重做失败");
  return normalizeProject((await res.json()).project);
}

export async function moveElements(
  projectId: string,
  moves: { elementId: string; newTrackId?: string; newStartTime?: number }[]
): Promise<Project> {
  const { project } = await executeCommand(projectId, "moveElements", { moves });
  return project;
}

export async function splitElements(
  projectId: string,
  refs: { trackId: string; elementId: string }[],
  splitTime: number
): Promise<Project> {
  const { project } = await executeCommand(projectId, "splitElements", {
    elementRefs: refs,
    splitTime,
  });
  return project;
}

export async function deleteElements(
  projectId: string,
  refs: { trackId: string; elementId: string }[]
): Promise<Project> {
  const { project } = await executeCommand(projectId, "deleteElements", { elementRefs: refs });
  return project;
}

function normalizeProject(data: any): Project {
  const metadata = data.metadata || {};
  const settings = data.settings || {};
  const canvasSize = settings.canvasSize || {};
  const scenes: any[] = data.scenes || [];
  return {
    projectId: metadata.id || data.projectId,
    name: metadata.name || data.name || "未命名项目",
    width: canvasSize.width || 1280,
    height: canvasSize.height || 720,
    fps: settings.fps?.numerator / (settings.fps?.denominator || 1) || 30,
    scenes: scenes.map((s) => ({
      id: s.id,
      name: s.name || "Main scene",
      tracks: {
        overlay: (s.tracks?.overlay || []).map((t: any) => ({
          id: t.id,
          name: t.name || "Overlay",
          type: "overlay",
          trackType: t.type || "video",
          visible: !(t.hidden ?? false),
          muted: t.muted ?? false,
        })),
        main: {
          id: s.tracks?.main?.id,
          name: s.tracks?.main?.name || "Main",
          type: "main",
          trackType: "video",
          visible: !(s.tracks?.main?.hidden ?? false),
          muted: s.tracks?.main?.muted ?? false,
        },
        audio: (s.tracks?.audio || []).map((t: any) => ({
          id: t.id,
          name: t.name || "Audio",
          type: "audio",
          trackType: "audio",
          visible: true,
          muted: t.muted ?? false,
        })),
      },
      elements: extractElements(s.tracks || {}),
      duration: data.metadata?.duration || 0,
      width: canvasSize.width || 1280,
      height: canvasSize.height || 720,
      fps: settings.fps?.numerator / (settings.fps?.denominator || 1) || 30,
    })),
    currentSceneId: data.currentSceneId || data.current_scene_id,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  };
}

function extractElements(tracks: any): any[] {
  const elements: any[] = [];
  const append = (track: any, trackType: string) => {
    if (!track || !track.elements) return;
    for (const el of track.elements) {
      elements.push({
        id: el.id,
        trackId: track.id,
        name: el.name || "Element",
        type: el.type || trackType,
        assetId: el.mediaId,
        startTime: el.startTime ?? 0,
        duration: el.duration ?? 0,
        trimStart: el.trimStart ?? 0,
        trimEnd: el.trimEnd ?? 0,
        placement: normalizePlacement(el.params),
      });
    }
  };
  append(tracks.main, "video");
  for (const t of tracks.overlay || []) append(t, t.type || "video");
  for (const t of tracks.audio || []) append(t, "audio");
  return elements;
}

function normalizePlacement(params: any) {
  if (!params) return {};
  return {
    x: params.x,
    y: params.y,
    width: params.width,
    height: params.height,
    rotation: params.rotation,
    opacity: params.opacity,
  };
}
