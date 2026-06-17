"use client";

import { ShoppingCart, Target } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantPageFooterHint } from "@/app/components/AssistantPageFooterHint";
import { AssistantRecipeShell } from "@/app/components/AssistantRecipeShell";
import { useAssistantPageSession } from "@/app/hooks/useAssistantPageSession";
import { ProcurementActionPanel } from "./components/ProcurementActionPanel";
import { ProcurementComposer } from "./components/ProcurementComposer";
import { ProcurementResultPanel } from "./components/ProcurementResultPanel";
import { useProcurementRunner } from "./hooks/useProcurementRunner";

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export default function ProcurementAssistantPage() {
  const runner = useProcurementRunner();
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
  const [topicInput, setTopicInput] = useState("IT 办公设备");
  const [vendorInput, setVendorInput] = useState("");
  const [quotesInput, setQuotesInput] = useState("");

  useEffect(() => {
    void fetch("/api/procurement-assistant/recipes")
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
      setError(null);
      try {
        const data = await runRecipe(recipeId, params);
        setLastResult(data);
      } catch {
        /* error handled in hook */
      }
    },
    [runRecipe, setError, setLastResult],
  );

  return (
    <AssistantRecipeShell
      icon={ShoppingCart}
      title="采购助手"
      subtitle="选场景 · 录标的 · 一键出分析"
      badge={
        <span className="inline-flex items-center gap-1">
          <Target className="h-3 w-3" />
          {envBadge}
        </span>
      }
      panelTitle="开始采购"
      controlsWidthClass="lg:w-[min(100%,400px)] xl:w-[420px]"
      pinFooter
      initLoading={initLoading}
      error={error}
      controls={
        <ProcurementActionPanel
          category={category}
          onCategoryChange={setCategory}
          recipes={recipes}
          suggestions={suggestions}
          loading={loading}
          onRunRecipe={handleRunRecipe}
          topicInput={topicInput}
          onTopicInputChange={setTopicInput}
          vendorInput={vendorInput}
          onVendorInputChange={setVendorInput}
          quotesInput={quotesInput}
          onQuotesInputChange={setQuotesInput}
          onValidationError={setError}
        />
      }
      footer={
        <>
          <ProcurementComposer
            key={composerKey}
            loading={loading}
            onStreamText={setStreamText}
            onError={setError}
            composerKey={composerKey}
            onReset={resetConversation}
            showReset={Boolean(streamText.trim() || lastResult || task)}
          />
          <AssistantPageFooterHint toolKey="procurementAssistant" />
        </>
      }
      results={
        <ProcurementResultPanel
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
