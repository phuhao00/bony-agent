"use client";

import { GitBranch, Server, ShieldCheck, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantPageFooterHint } from "@/app/components/AssistantPageFooterHint";
import { AssistantRecipeShell } from "@/app/components/AssistantRecipeShell";
import { useAssistantPageSession } from "@/app/hooks/useAssistantPageSession";
import { ProgrammerActionPanel } from "./components/ProgrammerActionPanel";
import { ProgrammerComposer } from "./components/ProgrammerComposer";
import { ProgrammerResultPanel } from "./components/ProgrammerResultPanel";
import { useProgrammerRunner } from "./hooks/useProgrammerRunner";

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
  requires_approval?: boolean;
};

export default function ProgrammerPage() {
  const runner = useProgrammerRunner();
  const {
    loading,
    initLoading,
    error,
    task,
    environment,
    suggestions,
    runRecipe,
    approveAndResume,
    loadSuggestions,
    setError,
  } = runner;
  const {
    lastResult,
    setLastResult,
    streamText,
    setStreamText,
    composerKey,
    resetConversation,
  } = useAssistantPageSession(runner);

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [category, setCategory] = useState("recommended");
  const [selectedComponent, setSelectedComponent] = useState("redis");

  useEffect(() => {
    void fetch("/api/programmer/recipes")
      .then((r) => r.json())
      .then((d) => setRecipes(d.recipes || []));
  }, []);

  const envBadge = useMemo(() => {
    const branch = environment?.git?.branch;
    const running = environment?.infra_summary?.running_count ?? 0;
    const total = environment?.infra_summary?.total ?? 0;
    return branch ? `${branch} · ${running}/${total} 组件运行中` : `${running}/${total} 组件运行中`;
  }, [environment]);

  const components = environment?.components_catalog || [];

  const handleRunRecipe = useCallback(
    async (recipeId: string, params: Record<string, unknown> = {}) => {
      try {
        const data = await runRecipe(recipeId, params);
        setLastResult(data);
        if (data.status === "completed") {
          await loadSuggestions();
        }
      } catch {
        /* error handled in hook */
      }
    },
    [loadSuggestions, runRecipe, setLastResult],
  );

  return (
    <AssistantRecipeShell
      icon={Terminal}
      title="程序员助手"
      subtitle="选任务 · 一键执行 · 审批门控"
      badge={
        <span className="inline-flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          {envBadge}
        </span>
      }
      panelIcon={Server}
      panelTitle="运维任务"
      controlsWidthClass="lg:w-[min(100%,400px)] xl:w-[420px]"
      pinFooter
      initLoading={initLoading}
      initLoadingLabel="加载环境…"
      error={error}
      controls={
        <ProgrammerActionPanel
          category={category}
          onCategoryChange={setCategory}
          recipes={recipes}
          suggestions={suggestions}
          components={components}
          selectedComponent={selectedComponent}
          onSelectComponent={setSelectedComponent}
          loading={loading}
          onRunRecipe={handleRunRecipe}
        />
      }
      footer={
        <>
          <ProgrammerComposer
            key={composerKey}
            loading={loading}
            onStreamText={setStreamText}
            onError={setError}
            composerKey={composerKey}
            onReset={resetConversation}
            showReset={Boolean(streamText.trim() || lastResult || task)}
          />
          <AssistantPageFooterHint toolKey="programmer" />
        </>
      }
      results={
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="shrink-0 flex items-center gap-2 rounded-2xl bg-[var(--page-canvas)] px-4 py-2.5 text-xs text-[color:var(--label-secondary)] ring-1 ring-[var(--border-subtle)]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" />
            启动/停止中间件、跑测试等操作需审批
          </div>
          <div className="min-h-0 flex-1">
            <ProgrammerResultPanel
              task={task}
              streamText={streamText}
              lastResult={lastResult}
              loading={loading}
              onApprove={approveAndResume}
            />
          </div>
        </div>
      }
    />
  );
}
