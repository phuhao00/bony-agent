export type CodingScopeType = "workspace" | "project" | "folder" | "file";

export type CodingScope = {
  type: CodingScopeType;
  /** 相对工作区根的路径，或项目 id（project 类型） */
  relPath: string;
  label: string;
};

export const SCOPE_META: Record<
  CodingScopeType,
  { label: string; hint: string; icon: "workspace" | "project" | "folder" | "file" }
> = {
  workspace: {
    label: "工作区",
    hint: "在整个工作区根目录下自由探索与修改",
    icon: "workspace",
  },
  project: {
    label: "项目",
    hint: "限定在已选项目目录内",
    icon: "project",
  },
  folder: {
    label: "文件夹",
    hint: "只处理所选文件夹及其子路径",
    icon: "folder",
  },
  file: {
    label: "文件",
    hint: "聚焦单个源文件",
    icon: "file",
  },
};

export function workspaceScope(label = "工作区"): CodingScope {
  return { type: "workspace", relPath: "", label };
}

export function projectScope(relPath: string, label: string): CodingScope {
  return { type: "project", relPath, label };
}

export function folderScope(relPath: string, label?: string): CodingScope {
  const name = label || relPath.split("/").filter(Boolean).pop() || relPath;
  return { type: "folder", relPath, label: name };
}

export function fileScope(relPath: string, label?: string): CodingScope {
  const name = label || relPath.split("/").filter(Boolean).pop() || relPath;
  return { type: "file", relPath, label: name };
}

export function scopeRequiresTarget(type: CodingScopeType): boolean {
  return type === "folder" || type === "file";
}

export function scopeSummary(scope: CodingScope, workspaceRoot?: string | null): string {
  if (scope.type === "workspace") {
    return workspaceRoot ? `工作区 · ${workspaceRoot}` : "工作区（未绑定路径）";
  }
  if (scope.type === "project") {
    return `项目 · ${scope.label}`;
  }
  return `${SCOPE_META[scope.type].label} · ${scope.relPath || scope.label}`;
}
