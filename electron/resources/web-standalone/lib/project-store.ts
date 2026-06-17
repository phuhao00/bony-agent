"use client";

import type { CanvasNode, ChatMessage } from "@/hooks/useCanvas";

export type ProjectType = "short-drama" | "music" | "podcast";

export interface ProjectAsset {
  id: string;
  name: string;
  type: "image" | "video" | "audio" | "text" | "reference";
  url: string;
  path?: string;
  size?: number;
  createdAt: number;
  metadata?: any;
}

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  createdAt: number;
  updatedAt: number;
  nodes: CanvasNode[];
  messages: ChatMessage[];
  assets: ProjectAsset[];
  brief?: any;
}

const INDEX_KEY = "ai-media-agent:projects";
const PROJECT_KEY = (id: string) => `ai-media-agent:project:${id}`;

export function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function listProjects(type?: ProjectType): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const index: string[] = JSON.parse(localStorage.getItem(INDEX_KEY) || "[]");
    return index
      .map((id) => {
        const raw = localStorage.getItem(PROJECT_KEY(id));
        if (!raw) return null;
        try {
          return JSON.parse(raw) as Project;
        } catch {
          return null;
        }
      })
      .filter((p): p is Project => !!p)
      .filter((p) => !type || p.type === type)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function getProject(id: string): Project | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROJECT_KEY(id));
    return raw ? (JSON.parse(raw) as Project) : null;
  } catch {
    return null;
  }
}

export function saveProject(project: Project) {
  if (typeof window === "undefined") return;
  const updated = { ...project, updatedAt: Date.now() };
  localStorage.setItem(PROJECT_KEY(updated.id), JSON.stringify(updated));
  const index = new Set(JSON.parse(localStorage.getItem(INDEX_KEY) || "[]") as string[]);
  index.add(updated.id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(Array.from(index)));
}

export function deleteProject(id: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PROJECT_KEY(id));
  const index = new Set(JSON.parse(localStorage.getItem(INDEX_KEY) || "[]") as string[]);
  index.delete(id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(Array.from(index)));
}

export function createProject(type: ProjectType, name: string): Project {
  const project: Project = {
    id: generateId(),
    name,
    type,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nodes: [],
    messages: [],
    assets: [],
  };
  saveProject(project);
  return project;
}

export function renameProject(id: string, name: string) {
  const project = getProject(id);
  if (project) saveProject({ ...project, name });
}

export async function uploadAsset(file: File): Promise<ProjectAsset> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/backend/upload", { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "上传失败");
  }
  const data = await res.json();
  const type: ProjectAsset["type"] = data.type === "video" ? "video" : data.type === "audio" ? "audio" : "image";
  return {
    id: generateId(),
    name: file.name,
    type,
    url: data.url,
    path: data.filepath,
    size: data.size,
    createdAt: Date.now(),
  };
}

export function addTextAsset(name: string, content: string): ProjectAsset {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  return {
    id: generateId(),
    name,
    type: "text",
    url,
    createdAt: Date.now(),
  };
}

export function assetIconType(type: ProjectAsset["type"]) {
  switch (type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "text":
      return "text";
    default:
      return "file";
  }
}
