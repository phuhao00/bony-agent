"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Header from "./components/Header";
import AssetsSidebar from "./components/AssetsSidebar";
import PreviewCanvas from "./components/PreviewCanvas";
import PropertiesSidebar from "./components/PropertiesSidebar";
import Timeline from "./components/Timeline";
import {
  createProject,
  loadProject,
  listAssets,
  uploadAsset,
  deleteAsset,
  addElement,
  exportProject,
  moveElements,
  splitElements,
  deleteElements,
  undoProject,
  redoProject,
  renameProject,
} from "./lib/api";
import type { MediaAsset, Project, Scene } from "./lib/types";

export default function OpenCutPage() {
  const [project, setProject] = useState<Project | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewGeneration, setPreviewGeneration] = useState(0);
  const [draggingAsset, setDraggingAsset] = useState<MediaAsset | null>(null);

  useEffect(() => {
    setPreviewUrl(null);
  }, [previewGeneration]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [p, a] = await Promise.all([
          createProject("New project").catch(async () => loadProject("default")),
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
    return project.scenes.find((s) => s.id === project.currentSceneId) || project.scenes[0] || null;
  }, [project]);

  const selectedElements = useMemo(() => {
    if (!scene) return [];
    return scene.elements.filter((el) => selectedIds.includes(el.id));
  }, [scene, selectedIds]);

  const duration = scene?.duration || 0;

  const usedAssetIds = useMemo(() => {
    if (!scene) return new Set<string>();
    return new Set(scene.elements.map((el) => el.assetId).filter(Boolean) as string[]);
  }, [scene]);

  const frameUrl = useMemo(() => {
    if (!project || !scene || duration <= 0) return null;
    const t = Math.max(0, Math.min(currentTime, duration));
    const previewWidth = 640;
    const previewHeight = Math.round((previewWidth * project.height) / project.width) || 360;
    return `/api/backend/opencut/projects/${project.projectId}/frame?time=${t.toFixed(2)}&width=${previewWidth}&height=${previewHeight}`;
  }, [project, scene, currentTime, duration]);

  const handleUpload = useCallback(async (file: File) => {
    const asset = await uploadAsset(file);
    setAssets((prev) => [...prev, asset]);
  }, []);

  const handleDeleteAssets = useCallback(
    async (assetIds: string[]) => {
      if (!project || !scene || assetIds.length === 0) return;
      await Promise.all(assetIds.map((id) => deleteAsset(id)));
      setAssets((prev) => prev.filter((a) => !assetIds.includes(a.assetId)));
      setPreviewGeneration((g) => g + 1);
    },
    [project, scene]
  );

  const handleAssetDrop = useCallback(
    async (asset: MediaAsset, trackId: string, startTime: number) => {
      if (!project || !scene) return;
      await addElement(project.projectId, scene.id, {
        trackId,
        assetId: asset.assetId,
        startTime,
        duration: asset.duration,
      });
      setProject(await loadProject(project.projectId));
      setPreviewGeneration((g) => g + 1);
    },
    [project, scene]
  );

  const handleMoveElement = useCallback(
    async (elementId: string, trackId: string, newStart: number) => {
      if (!project) return;
      await moveElements(project.projectId, [{ elementId, newTrackId: trackId, newStartTime: newStart }]);
      setProject(await loadProject(project.projectId));
      setPreviewGeneration((g) => g + 1);
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
      setProject(await loadProject(project.projectId));
      setPreviewGeneration((g) => g + 1);
    },
    [project, scene]
  );

  const handleSplitElement = useCallback(
    async (elementId: string, splitTime: number) => {
      if (!project || !scene) return;
      const el = scene.elements.find((e) => e.id === elementId);
      if (!el) return;
      await splitElements(project.projectId, [{ trackId: el.trackId, elementId }], splitTime);
      setProject(await loadProject(project.projectId));
      setPreviewGeneration((g) => g + 1);
    },
    [project, scene]
  );

  const handleUndo = useCallback(async () => {
    if (!project) return;
    setProject(await undoProject(project.projectId));
    setPreviewGeneration((g) => g + 1);
  }, [project]);

  const handleRedo = useCallback(async () => {
    if (!project) return;
    setProject(await redoProject(project.projectId));
    setPreviewGeneration((g) => g + 1);
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

  const handleRenderPreview = useCallback(async () => {
    if (!project || previewLoading) {
      console.log("[Preview] skip render", { project: !!project, previewLoading });
      return;
    }
    const maxPreviewWidth = 640;
    const previewWidth = Math.min(project.width, maxPreviewWidth);
    const previewHeight = Math.round((previewWidth * project.height) / project.width) || 360;
    const options = {
      width: previewWidth,
      height: previewHeight,
      fps: Math.min(project.fps, 24),
    };
    console.log("[Preview] start render", options);
    setPreviewLoading(true);
    try {
      const result = await exportProject(project.projectId, options);
      console.log("[Preview] render success", result.url);
      setPreviewUrl(result.url);
    } catch (e) {
      console.error("[Preview] render failed", e);
      setPlaying(false);
    } finally {
      setPreviewLoading(false);
    }
  }, [project, previewLoading]);

  if (loading || !project || !scene) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--label-secondary)]">
        Loading editor...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--shell-bg)] text-[var(--foreground)]">
      <Header
        projectName={project.name}
        onRename={async (name) => {
          if (!project || name === project.name) return;
          const next = await renameProject(project.projectId, name);
          setProject(next);
        }}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExport={handleExport}
        exporting={exporting}
      />

      <div className="flex flex-1 overflow-hidden">
        <AssetsSidebar
          assets={assets}
          onUpload={handleUpload}
          onDragStart={setDraggingAsset}
          onDragEnd={() => setDraggingAsset(null)}
          onDeleteAssets={handleDeleteAssets}
          usedAssetIds={usedAssetIds}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <PreviewCanvas
            currentTime={currentTime}
            duration={duration}
            playing={playing}
            onPlayPause={() => setPlaying((p) => !p)}
            onSeek={setCurrentTime}
            frameUrl={frameUrl}
            previewUrl={previewUrl}
            previewLoading={previewLoading}
            onRenderPreview={handleRenderPreview}
          />
          <Timeline
            scene={scene}
            currentTime={currentTime}
            duration={duration}
            selectedIds={selectedIds}
            onSelect={setSelectedIds}
            onSeek={setCurrentTime}
            onMoveElement={handleMoveElement}
            onSplitElement={handleSplitElement}
            onDeleteElements={handleDeleteElements}
            draggingAsset={draggingAsset}
            onAssetDrop={handleAssetDrop}
          />
        </div>

        <PropertiesSidebar selectedElements={selectedElements} />
      </div>
    </div>
  );
}
