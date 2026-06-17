"use client";

import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  Monitor,
  MoreVertical,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  Shield,
  Sparkles,
  Square,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

type FolderStatus = "pending" | "indexing" | "indexed" | "error" | "paused" | "partial";

type FolderEntry = {
  id: string;
  name: string;
  path: string;
  file_count: number;
  total_to_index?: number;
  indexed_count?: number;
  processed_count?: number;
  added_at: string;
  last_indexed_at: string | null;
  status: FolderStatus;
  doc_ids: string[];
  error_msg: string | null;
};

function folderProgress(f: FolderEntry): { done: number; total: number; pct: number; indexed: number } {
  const total = f.total_to_index ?? f.file_count ?? 0;
  const done = f.processed_count ?? f.indexed_count ?? 0;
  const indexed = f.indexed_count ?? f.doc_ids.length ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return { done, total, pct, indexed };
}

type DiskStats = { totalGiB: number; freeGiB: number; usedGiB: number };
type IndexStats = { usedMiB: number; limitGiB: number };
type IndexPrefs = { storageLimitGiB: number; maxFileMiB: number };

function formatRelative(
  ts: string | null,
  tr: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (!ts) return tr("settings.myComputer.relativeNever");
  const sec = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (sec < 60) return tr("settings.myComputer.relativeSeconds", { n: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return tr("settings.myComputer.relativeMinutes", { n: min });
  const h = Math.floor(min / 60);
  if (h < 48) return tr("settings.myComputer.relativeHours", { n: h });
  return tr("settings.myComputer.relativeDays", { n: Math.floor(h / 24) });
}

const sliderCls =
  "w-full h-1.5 rounded-full bg-[var(--separator-subtle)] accent-[var(--accent)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-[0_1px_4px_color-mix(in_srgb,var(--accent)_45%,transparent)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--card-bg)]";

function StatusBadge({ status }: { status: FolderStatus }) {
  const { t } = useTranslation();
  if (status === "indexing") {
    return (
      <span className="flex items-center gap-1 rounded-md border border-[color:color-mix(in_srgb,var(--accent)_42%,transparent)] bg-[var(--nav-active-fill)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--accent)]">
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />
        {t("settings.myComputer.statusIndexing")}
      </span>
    );
  }
  if (status === "indexed") {
    return (
      <span className="flex items-center gap-1 rounded-md border border-[color:var(--status-success-border)] bg-[var(--status-success-bg)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--status-success-text)]">
        <Check className="h-3 w-3" strokeWidth={2.5} />
        {t("settings.myComputer.statusIndexed")}
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className="flex items-center gap-1 rounded-md border border-[color:color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[var(--chrome-rail-bg)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--accent)]">
        <Pause className="h-3 w-3" strokeWidth={2.5} />
        {t("settings.myComputer.statusPaused")}
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="flex items-center gap-1 rounded-md border border-[color:color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[var(--nav-active-fill)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--accent)]">
        <AlertCircle className="h-3 w-3" strokeWidth={2.5} />
        {t("settings.myComputer.statusPartial")}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 rounded-md border border-[color:var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--status-danger-text)]">
        <AlertCircle className="h-3 w-3" strokeWidth={2.5} />
        {t("settings.myComputer.statusError")}
      </span>
    );
  }
  return (
    <span className="rounded-md border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--label-secondary)]">
      {t("settings.myComputer.statusPending")}
    </span>
  );
}

function SliderRow({
  label, description, min, max, step, value, suffix, onChange,
}: {
  label: string; description: string; min: number; max: number;
  step: number; value: number; suffix: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-[color:var(--foreground)]">{label}</span>
        <span className="tabular-nums text-[13px] font-semibold text-[color:var(--accent)]">
          {value} {suffix}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={sliderCls}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">{description}</p>
    </div>
  );
}

export default function MyComputerSettingsPage() {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [disk, setDisk] = useState<DiskStats>({ totalGiB: 0, freeGiB: 0, usedGiB: 0 });
  const [indexStats, setIndexStats] = useState<IndexStats>({ usedMiB: 0, limitGiB: 24 });
  const [prefs, setPrefs] = useState<IndexPrefs>({ storageLimitGiB: 24, maxFileMiB: 32 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Directory browser state
  const [showBrowser, setShowBrowser] = useState(false);
  const [browsePath, setBrowsePath] = useState("/");
  const [browseDirs, setBrowseDirs] = useState<{ name: string; path: string }[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState("");
  const [browseHistory, setBrowseHistory] = useState<string[]>([]);

  const prefsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/computer/status");
      if (!res.ok) return;
      const data = await res.json();
      if (data.disk) setDisk(data.disk);
      if (data.index) setIndexStats((s) => ({ ...s, usedMiB: data.index.usedMiB }));
    } catch { /* non-fatal */ }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/computer/folders");
      if (!res.ok) return;
      const data = await res.json();
      setFolders(data.folders ?? []);
    } catch { /* non-fatal */ }
  }, []);

  const loadPrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/computer/index-prefs");
      if (!res.ok) return;
      const data = await res.json();
      setPrefs({ storageLimitGiB: data.storageLimitGiB ?? 24, maxFileMiB: data.maxFileMiB ?? 32 });
      setIndexStats((s) => ({ ...s, limitGiB: data.storageLimitGiB ?? 24 }));
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    loadStatus(); loadFolders(); loadPrefs();
  }, [loadStatus, loadFolders, loadPrefs]);

  const pollTickRef = useRef(0);

  // poll while indexing — folders 每 2s，status 每 8s，避免大目录索引时拖慢 API
  useEffect(() => {
    const hasActive = folders.some((f) => f.status === "indexing" || f.status === "pending");
    if (hasActive && !pollTimerRef.current) {
      pollTickRef.current = 0;
      pollTimerRef.current = setInterval(() => {
        pollTickRef.current += 1;
        loadFolders();
        if (pollTickRef.current % 4 === 0) loadStatus();
      }, 2000);
    } else if (!hasActive && pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      loadStatus();
    }
  }, [folders, loadFolders, loadStatus]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (prefsSaveTimerRef.current) clearTimeout(prefsSaveTimerRef.current);
    };
  }, []);

  const loadBrowseDirs = useCallback(async (path: string) => {
    setBrowseLoading(true);
    setBrowseError("");
    try {
      const res = await fetch(`/api/computer/browse?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setBrowseError(data.detail || data.error || t("settings.myComputer.errReadDir"));
        return;
      }
      setBrowsePath(data.current);
      setBrowseDirs(data.directories || []);
    } catch (e: unknown) {
      setBrowseError(e instanceof Error ? e.message : t("settings.myComputer.errLoadDir"));
    } finally {
      setBrowseLoading(false);
    }
  }, [t]);

  const openBrowser = useCallback(() => {
    setShowBrowser(true);
    const start = draftPath.trim() || "/";
    setBrowsePath(start);
    setBrowseHistory([]);
    loadBrowseDirs(start);
  }, [draftPath, loadBrowseDirs]);

  const enterBrowseDir = useCallback((path: string) => {
    setBrowseHistory((prev) => [...prev, browsePath]);
    loadBrowseDirs(path);
  }, [browsePath, loadBrowseDirs]);

  const browseGoBack = useCallback(() => {
    setBrowseHistory((prev) => {
      const next = [...prev];
      const parent = next.pop() ?? "/";
      loadBrowseDirs(parent);
      return next;
    });
  }, [loadBrowseDirs]);

  const confirmBrowse = useCallback(() => {
    setDraftPath(browsePath);
    setShowBrowser(false);
    setBrowseError("");
  }, [browsePath]);

  const submitAddFolder = useCallback(async () => {
    const path = draftPath.trim();
    if (!path) return;
    setAddLoading(true);
    setAddError("");
    try {
      const res = await fetch("/api/computer/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draftName.trim() || path.split("/").filter(Boolean).pop() || "folder",
          path,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAddError(data.detail || data.error || t("settings.myComputer.errAdd"));
        return;
      }
      setFolders((prev) => [...prev, data.folder]);
      setDraftName(""); setDraftPath(""); setShowAdd(false);
      showToast(t("settings.myComputer.toastAdded"));
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : t("settings.myComputer.errUnknown"));
    } finally {
      setAddLoading(false);
    }
  }, [draftName, draftPath, t]);

  const removeFolder = useCallback(async (id: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setExpandedId((e) => (e === id ? null : e));
    try {
      await fetch(`/api/computer/folders/${id}`, { method: "DELETE" });
      showToast(t("settings.myComputer.toastRemoved"));
    } catch {
      showToast(t("settings.myComputer.toastRemoveFailed"), false);
      loadFolders();
    }
  }, [loadFolders, t]);

  const reindexFolder = useCallback(async (id: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: "pending" as FolderStatus } : f))
    );
    try {
      const res = await fetch(`/api/computer/folders/${id}/reindex`, { method: "POST" });
      if (!res.ok) throw new Error(t("settings.myComputer.errReindexRequest"));
      showToast(t("settings.myComputer.toastReindexing"));
      loadFolders();
    } catch {
      showToast(t("settings.myComputer.toastReindexFailed"), false);
      loadFolders();
    }
  }, [loadFolders, t]);

  const pauseIndex = useCallback(async (id: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: "paused" as FolderStatus } : f))
    );
    try {
      const res = await fetch(`/api/computer/folders/${id}/pause`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || data.error);
      showToast(t("settings.myComputer.toastPaused"));
      loadFolders();
    } catch {
      showToast(t("settings.myComputer.toastPauseFailed"), false);
      loadFolders();
    }
  }, [loadFolders, t]);

  const resumeIndex = useCallback(async (id: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: "indexing" as FolderStatus } : f))
    );
    try {
      const res = await fetch(`/api/computer/folders/${id}/resume`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || data.error);
      showToast(t("settings.myComputer.toastResumed"));
      loadFolders();
    } catch {
      showToast(t("settings.myComputer.toastResumeFailed"), false);
      loadFolders();
    }
  }, [loadFolders, t]);

  const cancelIndex = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/computer/folders/${id}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.detail || data.error);
      showToast(t("settings.myComputer.toastCancelled"));
      loadFolders();
    } catch {
      showToast(t("settings.myComputer.toastCancelFailed"), false);
      loadFolders();
    }
  }, [loadFolders, t]);

  const handlePrefsChange = (key: keyof IndexPrefs, value: number) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    if (key === "storageLimitGiB") setIndexStats((s) => ({ ...s, limitGiB: value }));
    if (prefsSaveTimerRef.current) clearTimeout(prefsSaveTimerRef.current);
    prefsSaveTimerRef.current = setTimeout(async () => {
      try {
        await fetch("/api/computer/index-prefs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated),
        });
      } catch { /* ignore */ }
    }, 500);
  };

  const diskFreePct = disk.totalGiB > 0 ? (disk.freeGiB / disk.totalGiB) * 100 : 0;
  const diskUsedPct = 100 - diskFreePct;
  const indexPoolPct =
    indexStats.limitGiB > 0
      ? Math.min(100, (indexStats.usedMiB / 1024 / indexStats.limitGiB) * 100)
      : 0;

  return (
    <div className="page-canvas min-h-full">
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[100] flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-white shadow-lg ${
            toast.ok ? "bg-emerald-500" : "bg-red-500"
          }`}
        >
          {toast.ok ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <AlertCircle className="h-4 w-4" strokeWidth={2.5} />}
          {toast.msg}
        </div>
      )}

      <div className="mx-auto max-w-5xl px-5 py-8 pb-16 md:px-8">
        <header className="mb-6 flex gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white shadow-sm shadow-black/15">
            <Monitor className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 pt-0.5">
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)] md:text-[22px]">
              {t("settings.myComputer.title")}
            </h1>
            <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--label-secondary)]">
              {t("settings.myComputer.subtitle")}
            </p>
          </div>
        </header>

        <div className="card-surface mb-6 flex items-center gap-3 rounded-xl px-3 py-2.5">
          <HardDrive className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)]" strokeWidth={1.75} />
          <span className="text-[13px] font-medium text-[color:var(--foreground)]">{t("settings.myComputer.chipTitle")}</span>
          <span className="text-[12px] font-semibold text-[color:var(--status-success-text)]">
            {t("settings.myComputer.connected")}
          </span>
          <span className="relative ml-auto">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-lg p-1.5 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
            >
              <MoreVertical className="h-4 w-4" strokeWidth={2} />
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label={t("settings.myComputer.closeMenuAria")}
                  className="fixed inset-0 z-40 cursor-default bg-transparent"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="popover-vibrant absolute right-0 top-full z-50 mt-1 min-w-[168px] rounded-xl py-1">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                    onClick={() => { loadStatus(); loadFolders(); setMenuOpen(false); }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t("settings.myComputer.refreshConnection")}
                  </button>
                  <Link
                    href="/computer-use"
                    className="flex items-center gap-2 px-3 py-2 text-[12px] text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                    onClick={() => setMenuOpen(false)}
                  >
                    {t("settings.myComputer.openComputerUse")}
                  </Link>
                </div>
              </>
            )}
          </span>
        </div>

        {/* Local folders */}
        <section className="card-surface mb-5 rounded-2xl p-5 md:p-6">
          <div className="mb-4 flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--nav-active-fill)] text-[color:var(--accent)] ring-1 ring-[color:var(--separator-subtle)]">
              <Shield className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[color:var(--foreground)]">{t("settings.myComputer.localFolders")}</h2>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[color:var(--label-secondary)]">
                {t("settings.myComputer.localFoldersDesc")}
              </p>
            </div>
          </div>

          <ul className="space-y-2">
            {folders.map((f) => {
              const open = expandedId === f.id;
              return (
                <li key={f.id} className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)]">
                  <div className="flex items-center gap-2 px-2 py-2.5 md:gap-3 md:px-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId((e) => (e === f.id ? null : f.id))}
                      className="shrink-0 rounded-md p-1 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
                      aria-expanded={open}
                    >
                      {open ? (
                        <ChevronDown className="h-4 w-4" strokeWidth={2} />
                      ) : (
                        <ChevronRight className="h-4 w-4" strokeWidth={2} />
                      )}
                    </button>
                    <Folder className="h-[18px] w-[18px] shrink-0 text-[color:var(--accent)]" strokeWidth={1.75} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[color:var(--foreground)]">{f.name}</p>
                      <p className="truncate font-mono text-[11px] text-[color:var(--label-secondary)]">{f.path}</p>
                    </div>
                    <div className="hidden shrink-0 items-center gap-2 sm:flex">
                      <span className="text-[11px] text-[color:var(--label-secondary)]">
                        {formatRelative(f.last_indexed_at ?? f.added_at, t)}
                      </span>
                      <ScanSearch className="h-3.5 w-3.5 text-[color:var(--separator-subtle)]" strokeWidth={2} />
                      <Zap className="h-3.5 w-3.5 text-[color:var(--separator-subtle)]" strokeWidth={2} />
                      <Sparkles className="h-3.5 w-3.5 text-[color:var(--separator-subtle)]" strokeWidth={2} />
                      <span className="rounded-md border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2 py-0.5 text-[11px] tabular-nums text-[color:var(--label-secondary)]">
                        {(f.status === "indexing" || f.status === "pending" || f.status === "paused" || f.status === "partial") && folderProgress(f).total > 0
                          ? t("settings.myComputer.indexProgress", {
                              done: folderProgress(f).done,
                              total: folderProgress(f).total,
                            })
                          : t("settings.myComputer.files", { count: f.file_count })}
                      </span>
                      <StatusBadge status={f.status} />
                    </div>
                    {(f.status === "indexing" || f.status === "pending") && (
                      <>
                        <button
                          type="button"
                          title={t("settings.myComputer.pauseIndexTitle")}
                          onClick={() => pauseIndex(f.id)}
                          className="shrink-0 rounded-lg p-1.5 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--accent)]"
                        >
                          <Pause className="h-4 w-4" strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          title={t("settings.myComputer.cancelIndexTitle")}
                          onClick={() => cancelIndex(f.id)}
                          className="shrink-0 rounded-lg p-1.5 text-[color:var(--label-secondary)] hover:bg-[var(--status-danger-bg)] hover:text-[color:var(--status-danger-text)]"
                        >
                          <Square className="h-4 w-4" strokeWidth={2} />
                        </button>
                      </>
                    )}
                    {(f.status === "paused" || f.status === "partial") && (
                      <>
                        <button
                          type="button"
                          title={t("settings.myComputer.resumeIndexTitle")}
                          onClick={() => resumeIndex(f.id)}
                          className="shrink-0 rounded-lg p-1.5 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--accent)]"
                        >
                          <Play className="h-4 w-4" strokeWidth={2} />
                        </button>
                        {f.status === "paused" && (
                          <button
                            type="button"
                            title={t("settings.myComputer.cancelIndexTitle")}
                            onClick={() => cancelIndex(f.id)}
                            className="shrink-0 rounded-lg p-1.5 text-[color:var(--label-secondary)] hover:bg-[var(--status-danger-bg)] hover:text-[color:var(--status-danger-text)]"
                          >
                            <Square className="h-4 w-4" strokeWidth={2} />
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      title={t("settings.myComputer.reindexTitle")}
                      onClick={() => reindexFolder(f.id)}
                      disabled={f.status === "indexing" || f.status === "pending" || f.status === "paused"}
                      className="shrink-0 rounded-lg p-1.5 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--accent)] disabled:opacity-30"
                    >
                      <RefreshCw className="h-4 w-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFolder(f.id)}
                      className="shrink-0 rounded-lg p-1.5 text-[color:var(--label-secondary)] hover:bg-[var(--status-danger-bg)] hover:text-[color:var(--status-danger-text)]"
                      aria-label={t("settings.myComputer.removeFolderAria")}
                    >
                      <X className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </div>
                  {open && (
                    <div className="border-t border-[color:var(--separator-subtle)] bg-[color-mix(in_srgb,var(--card-bg)_92%,transparent)] px-4 py-3 text-[12px] text-[color:var(--label-secondary)]">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span>
                          <span className="text-[color:var(--label-secondary)] opacity-80">{t("settings.myComputer.added")}:</span>{" "}
                          {new Date(f.added_at).toLocaleString()}
                        </span>
                        {f.last_indexed_at && (
                          <span>
                            <span className="text-[color:var(--label-secondary)] opacity-80">{t("settings.myComputer.lastIndexed")}:</span>{" "}
                            {new Date(f.last_indexed_at).toLocaleString()}
                          </span>
                        )}
                        <span>
                          <span className="text-[color:var(--label-secondary)] opacity-80">{t("settings.myComputer.docsInRag")}:</span>{" "}
                          {folderProgress(f).indexed}
                        </span>
                      </div>
                      {(f.status === "indexing" || f.status === "pending" || f.status === "paused" || f.status === "partial") && folderProgress(f).total > 0 && (
                        <div className="mt-3">
                          <div className="mb-1 flex items-center justify-between text-[11px] text-[color:var(--label-secondary)]">
                            <span>{t("settings.myComputer.indexProgressDetail", {
                              done: folderProgress(f).done,
                              total: folderProgress(f).total,
                              indexed: folderProgress(f).indexed,
                            })}</span>
                            <span className="tabular-nums">{folderProgress(f).pct}%</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--separator-subtle)]">
                            <div
                              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
                              style={{ width: `${folderProgress(f).pct}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {f.error_msg && (
                        <div className="mt-2 flex gap-2 rounded-lg border border-[color:var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-2">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--status-danger-text)]" strokeWidth={2} />
                          <p className="min-w-0 flex-1 break-words font-mono text-[11px] leading-relaxed text-[color:var(--status-danger-text)]">
                            {f.error_msg}
                          </p>
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-2 sm:hidden">
                        <StatusBadge status={f.status} />
                        <span className="text-[11px] text-[color:var(--label-secondary)]">{t("settings.myComputer.files", { count: f.file_count })}</span>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={() => { setShowAdd(true); setAddError(""); }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--separator-subtle)] bg-transparent py-3 text-[13px] font-medium text-[color:var(--label-secondary)] transition-colors hover:border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            {t("settings.myComputer.addFolder")}
          </button>
        </section>

        {/* Search indexing */}
        <section className="card-surface rounded-2xl p-5 md:p-6">
          <div className="mb-5 flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--nav-active-fill)] text-[color:var(--accent)] ring-1 ring-[color:var(--separator-subtle)]">
              <Search className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-[color:var(--foreground)]">{t("settings.myComputer.searchIndexing")}</h2>
              <p className="mt-0.5 text-[12px] text-[color:var(--label-secondary)]">{t("settings.myComputer.searchIndexingDesc")}</p>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <div className="mb-2 flex justify-between text-[11px] text-[color:var(--label-secondary)]">
                <span>{t("settings.myComputer.diskFree", { free: disk.freeGiB.toFixed(1) })}</span>
                <span className="tabular-nums text-[color:var(--label-secondary)]">{t("settings.myComputer.diskTotal", { total: disk.totalGiB.toFixed(1) })}</span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-[var(--separator-subtle)]">
                <div className="rounded-l-full bg-emerald-500" style={{ width: `${diskFreePct}%` }} />
                <div className="rounded-r-full bg-[color-mix(in_srgb,var(--foreground)_18%,transparent)]" style={{ width: `${diskUsedPct}%` }} />
              </div>
            </div>

            <div>
              <div className="mb-2 flex justify-between text-[11px] text-[color:var(--label-secondary)]">
                <span className="font-medium text-[color:var(--accent)]">
                  {t("settings.myComputer.indexUsed", { used: indexStats.usedMiB.toFixed(1) })}
                </span>
                <span className="tabular-nums text-[color:var(--label-secondary)]">{t("settings.myComputer.indexPool", { limit: indexStats.limitGiB })}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--separator-subtle)]">
                <div
                  className="h-full rounded-full bg-[color-mix(in_srgb,var(--accent)_72%,transparent)] transition-all duration-500"
                  style={{ width: `${Math.max(indexPoolPct, indexStats.usedMiB > 0 ? 1 : 0)}%` }}
                />
              </div>
            </div>

            <SliderRow
              label={t("settings.myComputer.sliderStorageLimit")}
              description={t("settings.myComputer.sliderStorageLimitDesc")}
              min={1} max={64} step={1}
              value={prefs.storageLimitGiB} suffix="GiB"
              onChange={(v) => handlePrefsChange("storageLimitGiB", v)}
            />
            <SliderRow
              label={t("settings.myComputer.sliderMaxFile")}
              description={t("settings.myComputer.sliderMaxFileDesc")}
              min={4} max={128} step={4}
              value={prefs.maxFileMiB} suffix="MiB"
              onChange={(v) => handlePrefsChange("maxFileMiB", v)}
            />
          </div>
        </section>

        <p className="mt-8 text-center text-[12px] text-[color:var(--label-secondary)]">
          <Link href="/computer-use" className="font-semibold text-[color:var(--accent)] hover:underline">
            {t("settings.myComputer.computerUseLink")}
          </Link>
        </p>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 backdrop-blur-[1px] sm:items-center">
          <div
            role="dialog"
            aria-labelledby="add-folder-title"
            className="card-surface w-full max-w-md rounded-2xl p-5 shadow-xl"
          >
            <h3 id="add-folder-title" className="text-[15px] font-semibold text-[color:var(--foreground)]">
              {t("settings.myComputer.addFolderTitle")}
            </h3>
            <p className="mt-1 text-[12px] text-[color:var(--label-secondary)]">
              {t("settings.myComputer.addFolderHint")}
            </p>
            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
              {t("settings.myComputer.displayName")}
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={t("settings.myComputer.displayNamePlaceholder")}
                className="mt-1 w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-[13px] text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--label-secondary)] focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_38%,transparent)]"
              />
            </label>
            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
              {t("settings.myComputer.path")}
              <div className="mt-1 flex gap-2">
                <input
                  value={draftPath}
                  onChange={(e) => setDraftPath(e.target.value)}
                  placeholder="/Users/you/Documents/project"
                  className="flex-1 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 font-mono text-[13px] text-[color:var(--foreground)] outline-none placeholder:text-[color:var(--label-secondary)] focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_38%,transparent)]"
                  onKeyDown={(e) => { if (e.key === "Enter" && draftPath.trim()) submitAddFolder(); }}
                />
                <button
                  type="button"
                  onClick={openBrowser}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-[12px] font-medium text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] hover:border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t("settings.myComputer.browse")}
                </button>
              </div>
            </label>
            {addError && (
              <div className="mt-2 flex gap-2 rounded-lg border border-[color:var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-2">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--status-danger-text)]" strokeWidth={2} />
                <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-[color:var(--status-danger-text)]">
                  {addError}
                </p>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowAdd(false); setDraftName(""); setDraftPath(""); setAddError(""); }}
                className="rounded-xl px-4 py-2 text-[13px] text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
              >
                {t("settings.myComputer.cancel")}
              </button>
              <button
                type="button"
                onClick={submitAddFolder}
                disabled={!draftPath.trim() || addLoading}
                className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-40"
              >
                {addLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("settings.myComputer.add")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Directory browser modal */}
      {showBrowser && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 backdrop-blur-[1px] sm:items-center">
          <div
            role="dialog"
            aria-labelledby="browse-title"
            className="flex h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[color:var(--separator-subtle)] px-5 py-4">
              <div>
                <h3 id="browse-title" className="text-[15px] font-semibold text-[color:var(--foreground)]">
                  {t("settings.myComputer.selectFolder")}
                </h3>
                <p className="mt-0.5 text-[12px] text-[color:var(--label-secondary)]">
                  {t("settings.myComputer.selectFolderHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setShowBrowser(false); setBrowseError(""); }}
                className="rounded-lg p-1.5 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Breadcrumb / path bar */}
            <div className="flex items-center gap-2 border-b border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-4 py-2.5">
              <button
                type="button"
                onClick={browseGoBack}
                disabled={browseHistory.length === 0}
                className="rounded-md p-1 text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)] disabled:opacity-30"
                title={t("settings.myComputer.back")}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1 truncate rounded-md bg-[var(--card-bg)] px-2 py-1 text-[12px] font-mono text-[color:var(--foreground)] ring-1 ring-[color:var(--separator-subtle)]">
                {browsePath}
              </div>
            </div>

            {/* Directory list */}
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {browseLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-[13px] text-[color:var(--label-secondary)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("settings.myComputer.loading")}
                </div>
              ) : browseError ? (
                <div className="mx-3 flex flex-col items-center justify-center gap-2 rounded-lg border border-[color:var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-4 text-center text-[13px] leading-relaxed text-[color:var(--status-danger-text)]">
                  <AlertCircle className="h-5 w-5 shrink-0" strokeWidth={2} />
                  {browseError}
                </div>
              ) : browseDirs.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-[13px] text-[color:var(--label-secondary)]">
                  <Folder className="mb-2 h-8 w-8 text-[color:var(--separator-subtle)]" />
                  {t("settings.myComputer.noSubdirs")}
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {browseDirs.map((d) => (
                    <li key={d.path}>
                      <button
                        type="button"
                        onClick={() => enterBrowseDir(d.path)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                      >
                        <Folder className="h-4 w-4 shrink-0 text-[color:var(--accent)]" />
                        <span className="min-w-0 flex-1 truncate">{d.name}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--separator-subtle)]" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-[color:var(--separator-subtle)] px-5 py-4">
              <span className="text-[12px] text-[color:var(--label-secondary)]">
                {t("settings.myComputer.folderCount", { count: browseDirs.length })}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowBrowser(false); setBrowseError(""); }}
                  className="rounded-xl px-4 py-2 text-[13px] text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                >
                  {t("settings.myComputer.cancel")}
                </button>
                <button
                  type="button"
                  onClick={confirmBrowse}
                  className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" />
                  {t("settings.myComputer.select")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
