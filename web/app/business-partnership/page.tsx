"use client";

import { Handshake, Target } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantPageFooterHint } from "@/app/components/AssistantPageFooterHint";
import { AssistantRecipeShell } from "@/app/components/AssistantRecipeShell";
import { useAssistantPageSession } from "@/app/hooks/useAssistantPageSession";
import { BusinessPartnershipActionPanel } from "./components/BusinessPartnershipActionPanel";
import { BusinessPartnershipComposer } from "./components/BusinessPartnershipComposer";
import { BusinessPartnershipResultPanel } from "./components/BusinessPartnershipResultPanel";
import { useBusinessPartnershipRunner } from "./hooks/useBusinessPartnershipRunner";

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export default function BusinessPartnershipPage() {
  const runner = useBusinessPartnershipRunner();
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
  const [ourCompanyInput, setOurCompanyInput] = useState("");
  const [partnerInput, setPartnerInput] = useState("");

  useEffect(() => {
    void fetch("/api/business-partnership/recipes")
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
      icon={Handshake}
      title="商务合作助手"
      subtitle="选类型 · 填背景 · 一键出方案"
      badge={
        <span className="inline-flex items-center gap-1">
          <Target className="h-3 w-3" />
          {envBadge}
        </span>
      }
      panelTitle="开始 BD"
      controlsWidthClass="lg:w-[min(100%,400px)] xl:w-[420px]"
      pinFooter
      initLoading={initLoading}
      error={error}
      controls={
        <BusinessPartnershipActionPanel
          category={category}
          onCategoryChange={setCategory}
          recipes={recipes}
          suggestions={suggestions}
          loading={loading}
          onRunRecipe={handleRunRecipe}
          ourCompanyInput={ourCompanyInput}
          onOurCompanyInputChange={setOurCompanyInput}
          partnerInput={partnerInput}
          onPartnerInputChange={setPartnerInput}
          onValidationError={setError}
        />
      }
      footer={
        <>
          <BusinessPartnershipComposer
            key={composerKey}
            loading={loading}
            onStreamText={setStreamText}
            onError={setError}
            composerKey={composerKey}
            onReset={resetConversation}
            showReset={Boolean(streamText.trim() || lastResult || task)}
          />
          <AssistantPageFooterHint toolKey="businessPartnership" />
        </>
      }
      results={
        <BusinessPartnershipResultPanel
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
