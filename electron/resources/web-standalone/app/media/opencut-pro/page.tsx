"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import EditorHeader from "./components/EditorHeader";
import AssetsPanel from "./components/AssetsPanel";
import PreviewPanel from "./components/PreviewPanel";
import PropertiesPanel from "./components/PropertiesPanel";
import TimelinePanel from "./components/TimelinePanel";
import {
  createProject,
  loadProject,
  listAssets,
  uploadAsset,
  addElement,
  exportProject,
  moveElements,
  splitElements,
  deleteElements,
  undoProject,
  redoProject,
} from "./lib/api";
import type { MediaAsset, Project, Scene, TimelineElement } from "./lib/types";

export default function OpenCutProPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [p, a] = await Promise.all([
          createProject("未命名项目").catch(async (err) => {
            try {
              return await loadProject("default");
            } catch {
              throw err;
            }
          }),
          listAssets(),
        ]);
        if (!mounted) return;
        setProject(p);
        setAssets(a);
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const scene = useMemo<Scene | null>(() => {
    if (!project) return null;
    return (
      project.scenes.find((s) => s.id === project.currentSceneId) ||
      project.scenes[0] ||
      null
    );
  }, [project]);

  const selectedElements = useMemo(() => {
    if (!scene) return [];
    return scene.elements.filter((el) => selectedIds.includes(el.id));
  }, [scene, selectedIds]);

  const duration = scene?.duration || 0;

  const frameUrl = useMemo(() => {
    if (!project || !scene || duration <= 0) return null;
    const t = Math.max(0, Math.min(currentTime, duration));
    return `/api/backend/opencut/projects/${project.projectId}/frame?time=${t.toFixed(2)}&width=${project.width}&height=${project.height}`;
  }, [project, scene, currentTime, duration]);

  const updateLocalScene = useCallback((updater: (scene: Scene) => Scene) => {
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map((s) =>
          s.id === prev.currentSceneId ? updater(s) : s
        ),
        updatedAt: new Date().toISOString(),
      };
    });
  }, []);

  const handleUpload = useCallback(async (file: File) => {
    const asset = await uploadAsset(file);
    setAssets((prev) => [...prev, asset]);
  }, []);

  const handleAddToTimeline = useCallback(
    async (asset: MediaAsset, trackId?: string) => {
      if (!project || !scene) return;
      const targetTrack = trackId || scene.tracks.main.id;
      await addElement(project.projectId, scene.id, {
        trackId: targetTrack,
        assetId: asset.assetId,
        startTime: currentTime,
        duration: asset.duration,
      });
      const refreshed = await loadProject(project.projectId);
      setProject(refreshed);
    },
    [project, scene, currentTime]
  );

  const handleMoveElement = useCallback(
    async (elementId: string, trackId: string, newStart: number) => {
      if (!project) return;
      await moveElements(project.projectId, [
        { elementId, newTrackId: trackId, newStartTime: newStart },
      ]);
      const refreshed = await loadProject(project.projectId);
      setProject(refreshed);
    },
    [project]
  );

  const handleDeleteElements = useCallback(
    async (ids: string[]) => {
      if (!project || !scene) return;
      const refs = scene.elements
        .filter((el) => ids.includes(el.id))
        .map((el) => ({ trackId: el.trackId, elementId: el.id }));
      await deleteElements(project.projectId, refs);
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
      const refreshed = await loadProject(project.projectId);
      setProject(refreshed);
    },
    [project, scene]
  );

  const handleSplitElement = useCallback(
    async (elementId: string, splitTime: number) => {
      if (!project || !scene) return;
      const el = scene.elements.find((e) => e.id === elementId);
      if (!el) return;
      await splitElements(project.projectId, [{ trackId: el.trackId, elementId }], splitTime);
      const refreshed = await loadProject(project.projectId);
      setProject(refreshed);
    },
    [project, scene]
  );

  const handleUndo = useCallback(async () => {
    if (!project) return;
    const refreshed = await undoProject(project.projectId);
    setProject(refreshed);
  }, [project]);

  const handleRedo = useCallback(async () => {
    if (!project) return;
    const refreshed = await redoProject(project.projectId);
    setProject(refreshed);
  }, [project]);

  const handleExport = useCallback(async () => {
    if (!project) return;
    setExporting(true);
    try {
      const result = await exportProject(project.projectId);
      setPreviewUrl(result.url);
    } finally {
      setExporting(false);
    }
  }, [project]);

  if (loading || !project || !scene) {
    return (
      <div className="flex h-screen items-center justify-center text-[var(--foreground)]">
        加载编辑器...
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[var(--background)] text-[var(--foreground)]">
      <EditorHeader
        projectName={project.name}
        onNameChange={(name) => setProject((p) => (p ? { ...p, name } : p))}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExport={handleExport}
        exporting={exporting}
      />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 shrink-0">
          <AssetsPanel
            assets={assets}
            onUpload={handleUpload}
            onDragStart={(asset) => handleAddToTimeline(asset)}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-1 overflow-hidden">
            <div className="min-w-0 flex-1">
              <PreviewPanel
                currentTime={currentTime}
                duration={duration}
                playing={playing}
                onPlayPause={() => setPlaying((p) => !p)}
                onSeek={setCurrentTime}
                frameUrl={frameUrl}
                previewUrl={previewUrl}
              />
            </div>
            <div className="w-72 shrink-0">
              <PropertiesPanel
                selectedElements={selectedElements}
                currentTime={currentTime}
                onUpdateElement={(updated) =>
                  updateLocalScene((s) => ({
                    ...s,
                    elements: s.elements.map((el) =>
                      el.id === updated.id ? updated : el
                    ),
                  }))
                }
              />
            </div>
          </div>
          <div className="h-64 shrink-0">
            <TimelinePanel
              scene={scene}
              currentTime={currentTime}
              duration={duration}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              onSeek={setCurrentTime}
              onMoveElement={handleMoveElement}
              onSplitElement={handleSplitElement}
              onDeleteElements={handleDeleteElements}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
