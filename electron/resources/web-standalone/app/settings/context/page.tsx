"use client";

import { useTranslation } from "@/hooks/useTranslation";
import {
  CONTEXT_NAV_EVENT,
  readContextNav,
  type ContextNavTarget,
  type ContextTab,
} from "@/lib/contextNavigation";
import { loadContextSettings } from "@/lib/contextSettings";
import { Brain, Settings } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import ContextSettingsDialog from "./ContextSettingsDialog";

function KnowledgeGraphLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[400px] items-center justify-center rounded-2xl card-surface text-sm text-[color:var(--label-secondary)]">
      {t("settings.context.loadingGraph")}
    </div>
  );
}

function MemoryLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[200px] items-center justify-center rounded-2xl card-surface text-sm text-[color:var(--label-secondary)]">
      {t("settings.context.loadingMemory")}
    </div>
  );
}

const KnowledgeGraphPanel = dynamic(() => import("./KnowledgeGraphPanel"), {
  ssr: false,
  loading: () => <KnowledgeGraphLoading />,
});

const MemoryPanel = dynamic(() => import("./MemoryPanel"), {
  ssr: false,
  loading: () => <MemoryLoading />,
});

function MemoryGraphLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[400px] items-center justify-center rounded-2xl card-surface text-sm text-[color:var(--label-secondary)]">
      {t("settings.context.loadingMemGraph")}
    </div>
  );
}

function DreamsLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[200px] items-center justify-center rounded-2xl card-surface text-sm text-[color:var(--label-secondary)]">
      {t("settings.context.loadingDreams")}
    </div>
  );
}

function CodeGraphLoading() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[300px] items-center justify-center rounded-2xl card-surface text-sm text-[color:var(--label-secondary)]">
      {t("settings.context.loadingCodegraph")}
    </div>
  );
}

const MemoryGraphPanel = dynamic(
  () => import("./MemoryGraphPanel").then(mod => mod.default ?? mod.MemoryGraphPanel),
  {
    ssr: false,
    loading: () => <MemoryGraphLoading />,
  }
);

const DreamsPanel = dynamic(() => import("./DreamsPanel"), {
  ssr: false,
  loading: () => <DreamsLoading />,
});

const CodeGraphPanel = dynamic(() => import("./CodeGraphPanel"), {
  ssr: false,
  loading: () => <CodeGraphLoading />,
});

const MemoryStatusPanel = dynamic(() => import("./MemoryStatusPanel"), {
  ssr: false,
});

const MemoryWorkspace = dynamic(() => import("./MemoryWorkspace"), {
  ssr: false,
  loading: () => <MemoryLoading />,
});

const SessionHistoryPanel = dynamic(() => import("./SessionHistoryPanel"), {
  ssr: false,
  loading: () => <MemoryLoading />,
});

type MemoryLayout = "list" | "browser";

export default function MyContextSettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ContextTab>("graph");
  const [memoryLayout, setMemoryLayout] = useState<MemoryLayout>(
    () => loadContextSettings().defaultMemoryLayout,
  );
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | undefined>();
  const [memGraphMode, setMemGraphMode] = useState<string>("memories");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const applyNav = useCallback((target: ContextNavTarget) => {
    setTab(target.tab);
    if (target.memoryLayout) setMemoryLayout(target.memoryLayout);
    if (target.memoryId) setSelectedMemoryId(target.memoryId);
    if (target.memGraphMode) setMemGraphMode(target.memGraphMode);
  }, []);

  useEffect(() => {
    const pending = readContextNav();
    if (pending) applyNav(pending);

    const onNav = (e: Event) => {
      const detail = (e as CustomEvent<ContextNavTarget>).detail;
      if (detail) applyNav(detail);
    };
    window.addEventListener(CONTEXT_NAV_EVENT, onNav);
    return () => window.removeEventListener(CONTEXT_NAV_EVENT, onNav);
  }, [applyNav]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="page-canvas min-h-full">
      <div className="mx-auto max-w-6xl px-5 py-8 pb-16 md:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--nav-active-fill)] text-[color:var(--accent)] shadow-sm ring-1 ring-[color:var(--separator-subtle)]">
              <Brain className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)] md:text-2xl">
                {t("settings.context.title")}
              </h1>
              <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--label-secondary)]">
                {t("settings.context.subtitle")}
                <span className="opacity-80">
                  {" "}
                  {t("settings.context.subtitleHint")}
                </span>
              </p>
              <nav className="mt-5 flex gap-1 border-b border-[color:var(--separator-subtle)] pb-px">
                <button
                  type="button"
                  onClick={() => setTab("graph")}
                  className={`relative px-3 py-2 text-[13px] font-medium transition-colors ${
                    tab === "graph"
                      ? "text-[color:var(--foreground)] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-[color:var(--accent)]"
                      : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  }`}
                >
                  {t("settings.context.tabGraph")}
                </button>
                <button
                  type="button"
                  onClick={() => setTab("memory")}
                  className={`relative px-3 py-2 text-[13px] font-medium transition-colors ${
                    tab === "memory"
                      ? "text-[color:var(--foreground)] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-[color:var(--accent)]"
                      : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  }`}
                >
                  {t("settings.context.tabMemory")}
                </button>
                <button
                  type="button"
                  onClick={() => setTab("sessions")}
                  className={`relative px-3 py-2 text-[13px] font-medium transition-colors ${
                    tab === "sessions"
                      ? "text-[color:var(--foreground)] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-[color:var(--accent)]"
                      : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  }`}
                >
                  {t("settings.context.tabSessions")}
                </button>
                <button
                  type="button"
                  onClick={() => setTab("memgraph")}
                  className={`relative px-3 py-2 text-[13px] font-medium transition-colors ${
                    tab === "memgraph"
                      ? "text-[color:var(--foreground)] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-[color:var(--accent)]"
                      : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  }`}
                >
                  {t("settings.context.tabMemGraph")}
                </button>
                <button
                  type="button"
                  onClick={() => setTab("codegraph")}
                  className={`relative px-3 py-2 text-[13px] font-medium transition-colors ${
                    tab === "codegraph"
                      ? "text-[color:var(--foreground)] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-[color:var(--accent)]"
                      : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  }`}
                >
                  {t("settings.context.tabCodegraph")}
                </button>
                <button
                  type="button"
                  onClick={() => setTab("dreams")}
                  className={`relative px-3 py-2 text-[13px] font-medium transition-colors ${
                    tab === "dreams"
                      ? "text-[color:var(--foreground)] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-[color:var(--accent)]"
                      : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  }`}
                >
                  {t("settings.context.tabDreams")}
                </button>
              </nav>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-4 py-2 text-[13px] font-semibold text-[color:var(--foreground)] shadow-sm hover:bg-[var(--nav-active-fill)]"
          >
            <Settings className="h-4 w-4 text-[color:var(--label-secondary)]" strokeWidth={2} />
            {t("settings.context.settingsBtn")}
          </button>
        </header>

        <div className={tab === "graph" ? undefined : "hidden"}>
          <KnowledgeGraphPanel />
        </div>

        <div className={tab === "memory" ? undefined : "hidden"}>
          <>
            <MemoryStatusPanel />
            <div className="mb-4 inline-flex rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-0.5">
              <button
                type="button"
                onClick={() => setMemoryLayout("list")}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-medium ${
                  memoryLayout === "list"
                    ? "bg-[var(--nav-active-fill)] text-[color:var(--foreground)]"
                    : "text-[color:var(--label-secondary)]"
                }`}
              >
                {t("settings.context.memoryLayoutList")}
              </button>
              <button
                type="button"
                onClick={() => setMemoryLayout("browser")}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-medium ${
                  memoryLayout === "browser"
                    ? "bg-[var(--nav-active-fill)] text-[color:var(--foreground)]"
                    : "text-[color:var(--label-secondary)]"
                }`}
              >
                {t("settings.context.memoryLayoutBrowser")}
              </button>
            </div>
            {memoryLayout === "browser" ? (
              <MemoryWorkspace
                initialMemoryId={selectedMemoryId}
                onMemoryIdConsumed={() => setSelectedMemoryId(undefined)}
              />
            ) : (
              <MemoryPanel
                highlightMemoryId={selectedMemoryId}
                onHighlightConsumed={() => setSelectedMemoryId(undefined)}
              />
            )}
          </>
        </div>

        <div className={tab === "sessions" ? undefined : "hidden"}>
          <SessionHistoryPanel />
        </div>

        <div className={tab === "memgraph" ? undefined : "hidden"}>
          <MemoryGraphPanel
            highlightMemoryId={selectedMemoryId}
            onHighlightConsumed={() => setSelectedMemoryId(undefined)}
            initialMode={
              memGraphMode === "topics" ||
              memGraphMode === "usage" ||
              memGraphMode === "dreams"
                ? memGraphMode
                : "memories"
            }
            visible={tab === "memgraph"}
          />
        </div>

        <div className={tab === "codegraph" ? undefined : "hidden"}>
          <CodeGraphPanel />
        </div>

        <div className={tab === "dreams" ? undefined : "hidden"}>
          <DreamsPanel />
        </div>
      </div>

      <ContextSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(s) => setMemoryLayout(s.defaultMemoryLayout)}
      />
    </div>
  );
}
