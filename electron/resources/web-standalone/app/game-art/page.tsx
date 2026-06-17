"use client";

import { Palette, Target } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantPageFooterHint } from "@/app/components/AssistantPageFooterHint";
import { VisualStudioLayout } from "@/app/components/AssistantLayoutVariants";
import { extractReportFromResult } from "@/app/components/assistantTextParsing";
import { useAssistantPageSession } from "@/app/hooks/useAssistantPageSession";
import { GameArtActionPanel } from "./components/GameArtActionPanel";
import { GameArtComposer } from "./components/GameArtComposer";
import { GameArtMoodboard } from "./components/GameArtMoodboard";
import { GameArtResultPanel } from "./components/GameArtResultPanel";
import { useGameArtRunner } from "./hooks/useGameArtRunner";

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export default function GameArtPage() {
  const runner = useGameArtRunner();
  const {
    loading,
    initLoading,
    error,
    task,
    environment,
    suggestions,
    runRecipe,
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
  const [projectInput, setProjectInput] = useState("二次元 RPG");
  const [subjectInput, setSubjectInput] = useState("");

  useEffect(() => {
    void fetch("/api/game-art/recipes")
      .then((r) => r.json())
      .then((d) => setRecipes(d.recipes || []));
  }, []);

  const envBadge = useMemo(() => {
    const count = environment?.recipe_count ?? 0;
    const areas = environment?.focus_areas?.length ?? 0;
    return `${count} 个工作流 · ${areas} 大能力域`;
  }, [environment]);

  const handleRunRecipe = useCallback(
    async (recipeId: string, params: Record<string, unknown> = {}) => {
      try {
        const data = await runRecipe(recipeId, params);
        setLastResult(data);
      } catch {
        /* error handled in hook */
      }
    },
    [runRecipe, setLastResult],
  );

  const reportText = extractReportFromResult(task, lastResult) || streamText;

  return (
    <VisualStudioLayout
      icon={Palette}
      title="游戏美术助手"
      subtitle="选模板 · 填 Brief · 一键出规范"
      badge={
        <span className="inline-flex items-center gap-1">
          <Target className="h-3 w-3" />
          {envBadge}
        </span>
      }
      initLoading={initLoading}
      error={error}
      pinFooter
      sidebar={
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="mb-3 shrink-0 text-sm font-semibold text-[color:var(--foreground)]">开始创作</div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <GameArtActionPanel
          category={category}
          onCategoryChange={setCategory}
          recipes={recipes}
          suggestions={suggestions}
          loading={loading}
          onRunRecipe={handleRunRecipe}
          projectInput={projectInput}
          onProjectInputChange={setProjectInput}
          subjectInput={subjectInput}
          onSubjectInputChange={setSubjectInput}
          onValidationError={setError}
            />
          </div>
        </div>
      }
      moodboard={
        <GameArtMoodboard
          reportText={reportText}
          projectName={projectInput}
          loading={loading}
        />
      }
      main={
        <GameArtResultPanel
          task={task}
          streamText={streamText}
          lastResult={lastResult}
          loading={loading}
          recipes={recipes}
        />
      }
      footer={
        <>
          <GameArtComposer
            key={composerKey}
            loading={loading}
            onStreamText={setStreamText}
            onError={setError}
            composerKey={composerKey}
            onReset={resetConversation}
            showReset={Boolean(streamText.trim() || lastResult || task)}
          />
          <AssistantPageFooterHint toolKey="gameArt" />
        </>
      }
    />
  );
}
