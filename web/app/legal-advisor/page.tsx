"use client";

import { Scale, Shield } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantPageFooterHint } from "@/app/components/AssistantPageFooterHint";
import { AssistantRecipeShell } from "@/app/components/AssistantRecipeShell";
import { useAssistantPageSession } from "@/app/hooks/useAssistantPageSession";
import { LegalAdvisorActionPanel } from "./components/LegalAdvisorActionPanel";
import { LegalAdvisorComposer } from "./components/LegalAdvisorComposer";
import { LegalAdvisorResultPanel } from "./components/LegalAdvisorResultPanel";
import { useLegalAdvisorRunner } from "./hooks/useLegalAdvisorRunner";

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export default function LegalAdvisorPage() {
  const runner = useLegalAdvisorRunner();
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
  const [topicInput, setTopicInput] = useState("劳动合同解除与经济补偿");
  const [contextInput, setContextInput] = useState("");

  useEffect(() => {
    void fetch("/api/legal-advisor/recipes")
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
      icon={Scale}
      title="法律顾问助手"
      subtitle="选类型 · 录材料 · 一键出解读"
      badge={
        <span className="inline-flex items-center gap-1">
          <Shield className="h-3 w-3" />
          {envBadge}
        </span>
      }
      panelTitle="开始审阅"
      controlsWidthClass="lg:w-[min(100%,400px)] xl:w-[420px]"
      pinFooter
      leading={
        <p className="shrink-0 border-b border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--label-secondary)_5%,var(--card-surface))] px-4 py-2 text-center text-xs text-[color:var(--label-secondary)] sm:px-6">
          本助手仅供参考，不构成正式法律意见。重大事项请咨询持证律师。
        </p>
      }
      initLoading={initLoading}
      error={error}
      controls={
        <LegalAdvisorActionPanel
          category={category}
          onCategoryChange={setCategory}
          recipes={recipes}
          suggestions={suggestions}
          loading={loading}
          onRunRecipe={handleRunRecipe}
          topicInput={topicInput}
          onTopicInputChange={setTopicInput}
          contextInput={contextInput}
          onContextInputChange={setContextInput}
          onValidationError={setError}
        />
      }
      footer={
        <>
          <LegalAdvisorComposer
            key={composerKey}
            loading={loading}
            onStreamText={setStreamText}
            onError={setError}
            composerKey={composerKey}
            onReset={resetConversation}
            showReset={Boolean(streamText.trim() || lastResult || task)}
          />
          <AssistantPageFooterHint
            toolKey="legalAdvisor"
            extraNoteKey="assistantPage.tools.legalAdvisor.disclaimer"
          />
        </>
      }
      results={
        <LegalAdvisorResultPanel
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
