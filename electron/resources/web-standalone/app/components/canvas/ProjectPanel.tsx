"use client";

import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Save,
  Plus,
  Trash2,
  Upload,
  FileText,
  ImageIcon,
  Film,
  Music,
  MoreHorizontal,
  ChevronDown,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import type { Project, ProjectAsset, ProjectType } from "@/lib/project-store";

interface ProjectPanelProps {
  project: Project | null;
  projects: Project[];
  onChangeProject: (p: Project) => void;
  type: ProjectType;
  typeLabel: string;
  createProject: (type: ProjectType, name: string) => Promise<Project> | Project;
  saveProject: (p: Project) => Promise<void> | void;
  deleteProject: (id: string) => Promise<void> | void;
  renameProject: (id: string, name: string) => Promise<void> | void;
  getProject: (id: string) => Promise<Project | null> | Project | null;
  uploadAsset: (file: File) => Promise<ProjectAsset>;
  addTextAsset: (name: string, content: string) => ProjectAsset;
  refresh?: () => void | Promise<void>;
  loading?: boolean;
}

function classNames(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function ProjectPanel({
  project,
  projects,
  onChangeProject,
  type,
  typeLabel,
  createProject,
  saveProject,
  deleteProject,
  renameProject,
  getProject,
  uploadAsset,
  addTextAsset,
  refresh,
  loading,
}: ProjectPanelProps) {
  const [showProjects, setShowProjects] = useState(false);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState<ProjectAsset | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(project?.name || "");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNameValue(project?.name || "");
  }, [project?.name]);

  const handleNew = async () => {
    const name = prompt(`新建 ${typeLabel} 项目名称`, `未命名${typeLabel}`);
    if (!name) return;
    const p = await createProject(type, name);
    onChangeProject(p);
    if (refresh) await refresh();
  };

  const handleSave = async () => {
    if (!project) return;
    await saveProject(project);
    if (refresh) await refresh();
  };

  const handleOpen = async (id: string) => {
    const p = await getProject(id);
    if (p) onChangeProject(p);
    setShowProjects(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除该项目？素材和节点将无法恢复。")) return;
    await deleteProject(id);
    if (project?.id === id) {
      const p = await createProject(type, `未命名${typeLabel}`);
      onChangeProject(p);
    }
    if (refresh) await refresh();
  };

  const handleRename = async (id: string, newName?: string) => {
    const p = projects.find((x) => x.id === id);
    const name = newName ?? prompt("重命名项目", p?.name || "");
    if (!name || name === p?.name) return;
    await renameProject(id, name);
    if (project?.id === id) onChangeProject({ ...project, name });
    if (refresh) await refresh();
  };

  const commitNameEdit = async () => {
    if (!project) return;
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === project.name) {
      setNameValue(project.name);
      setEditingName(false);
      return;
    }
    await handleRename(project.id, trimmed);
    setEditingName(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    setUploading(true);
    try {
      const asset = await uploadAsset(file);
      const updated = { ...project, assets: [...project.assets, asset] };
      await saveProject(updated);
      onChangeProject(updated);
    } catch (err) {
      alert(String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleAddText = async () => {
    if (!project) return;
    const name = prompt("素材名称", "备注.txt");
    const content = prompt("素材内容", "");
    if (!name || content === null) return;
    const asset = addTextAsset(name, content);
    const updated = { ...project, assets: [...project.assets, asset] };
    await saveProject(updated);
    onChangeProject(updated);
  };

  const handleDeleteAsset = async (assetId: string) => {
    if (!project) return;
    const updated = { ...project, assets: project.assets.filter((a) => a.id !== assetId) };
    await saveProject(updated);
    onChangeProject(updated);
  };

  const filteredAssets = (project?.assets || []).filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  const onDragStart = (asset: ProjectAsset) => (e: React.DragEvent) => {
    setDragging(asset);
    e.dataTransfer.setData("application/json", JSON.stringify(asset));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="flex flex-col h-full bg-[var(--card-bg)] border-r border-[var(--border-subtle)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FolderOpen className="w-4 h-4 text-[color:var(--accent)] shrink-0" />
          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={commitNameEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitNameEdit();
                if (e.key === "Escape") {
                  setNameValue(project?.name || "");
                  setEditingName(false);
                }
              }}
              autoFocus
              className="flex-1 min-w-0 text-sm font-semibold bg-transparent outline-none border-b border-[color:var(--accent)]"
            />
          ) : (
            <button
              onClick={() => {
                setEditingName(true);
                setNameValue(project?.name || "");
                setTimeout(() => nameInputRef.current?.focus(), 10);
              }}
              className="text-sm font-semibold truncate hover:text-[color:var(--accent)] transition-colors text-left"
              title="点击编辑项目名称"
            >
              {project?.name || `未命名${typeLabel}`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleNew} title="新建" className="p-1.5 rounded-md hover:bg-[var(--nav-active-fill)]">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleSave} title="保存" className="p-1.5 rounded-md hover:bg-[var(--nav-active-fill)]">
            <Save className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setShowProjects(!showProjects)} title="项目列表" className="p-1.5 rounded-md hover:bg-[var(--nav-active-fill)]">
            {showProjects ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Project list */}
      {showProjects && (
        <div className="border-b border-[var(--border-subtle)] max-h-48 overflow-y-auto">
          {projects.map((p) => (
            <div
              key={p.id}
              className={classNames(
                "flex items-center justify-between px-3 py-2 text-xs hover:bg-[var(--nav-active-fill)] cursor-pointer",
                p.id === project?.id && "bg-[color:var(--accent)]/5"
              )}
              onClick={() => handleOpen(p.id)}
            >
              <span className="truncate flex-1">{p.name}</span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRename(p.id);
                  }}
                  className="p-1 rounded hover:bg-[var(--card-bg)]"
                >
                  <MoreHorizontal className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(p.id);
                  }}
                  className="p-1 rounded hover:bg-red-50 text-red-500"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
          {projects.length === 0 && <div className="px-3 py-2 text-xs text-[color:var(--label-secondary)]">暂无项目</div>}
        </div>
      )}

      {/* Assets */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--label-secondary)]">素材库</span>
          <div className="flex items-center gap-1">
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="p-1.5 rounded-md hover:bg-[var(--nav-active-fill)] disabled:opacity-50">
              <Upload className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleAddText} className="p-1.5 rounded-md hover:bg-[var(--nav-active-fill)]">
              <FileText className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />

        <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 bg-[var(--input-bg)] rounded-lg px-2 py-1.5 border border-[var(--border-subtle)]">
            <Search className="w-3 h-3 text-[color:var(--label-secondary)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索素材..."
              className="flex-1 bg-transparent text-xs outline-none"
            />
            {query && <X className="w-3 h-3 text-[color:var(--label-secondary)] cursor-pointer" onClick={() => setQuery("")} />}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredAssets.map((asset) => (
            <div
              key={asset.id}
              draggable
              onDragStart={onDragStart(asset)}
              className="group flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--nav-active-fill)] cursor-grab active:cursor-grabbing"
            >
              <AssetIcon type={asset.type} />
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate">{asset.name}</p>
                <p className="text-[10px] text-[color:var(--label-secondary)] truncate">{asset.type}</p>
              </div>
              <button
                onClick={() => handleDeleteAsset(asset.id)}
                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-red-500"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {filteredAssets.length === 0 && (
            <div className="text-center py-6 text-xs text-[color:var(--label-secondary)]">
              <p>暂无素材</p>
              <p className="mt-1">点击上传按钮导入</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssetIcon({ type }: { type: ProjectAsset["type"] }) {
  const className = "w-4 h-4 text-[color:var(--label-secondary)] shrink-0";
  switch (type) {
    case "image":
      return <ImageIcon className={className} />;
    case "video":
      return <Film className={className} />;
    case "audio":
      return <Music className={className} />;
    default:
      return <FileText className={className} />;
  }
}
