"use client";

import { Target, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantPageFooterHint } from "@/app/components/AssistantPageFooterHint";
import { AssistantRecipeShell } from "@/app/components/AssistantRecipeShell";
import { useAssistantPageSession } from "@/app/hooks/useAssistantPageSession";
import { GameDesignActionPanel } from "./components/GameDesignActionPanel";
import { GameDesignComposer } from "./components/GameDesignComposer";
import { GameDesignResultPanel } from "./components/GameDesignResultPanel";
import { useGameDesignRunner } from "./hooks/useGameDesignRunner";

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export default function GameDesignPage() {
  const runner = useGameDesignRunner();
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
  const [ideaInput, setIdeaInput] = useState("Roguelike 卡牌");
  const [scopeInput, setScopeInput] = useState("");

  useEffect(() => {
    void fetch("/api/game-design/recipes")
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

  return (
    <AssistantRecipeShell
      icon={Workflow}
      title="游戏策划助手"
      subtitle="选模板 · 填创意 · 一键出文档"
      badge={
        <span className="inline-flex items-center gap-1">
          <Target className="h-3 w-3" />
          {envBadge}
        </span>
      }
      panelTitle="开始策划"
      controlsWidthClass="lg:w-[min(100%,400px)] xl:w-[420px]"
      pinFooter
      initLoading={initLoading}
      error={error}
      controls={
        <GameDesignActionPanel
          category={category}
          onCategoryChange={setCategory}
          recipes={recipes}
          suggestions={suggestions}
          loading={loading}
          onRunRecipe={handleRunRecipe}
          ideaInput={ideaInput}
          onIdeaInputChange={setIdeaInput}
          scopeInput={scopeInput}
          onScopeInputChange={setScopeInput}
          onValidationError={setError}
        />
      }
      footer={
        <>
          <GameDesignComposer
            key={composerKey}
            loading={loading}
            onStreamText={setStreamText}
            onError={setError}
            composerKey={composerKey}
            onReset={resetConversation}
            showReset={Boolean(streamText.trim() || lastResult || task)}
          />
          <AssistantPageFooterHint toolKey="gameDesign" />
        </>
      }
      results={
        <GameDesignResultPanel
          task={task}
          streamText={streamText}
          lastResult={lastResult}
          loading={loading}
          recipes={recipes}
        />
      }
    />
  );
}
