"use client";

import { Lightbulb, Target } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantPageFooterHint } from "@/app/components/AssistantPageFooterHint";
import { AssistantRecipeShell } from "@/app/components/AssistantRecipeShell";
import { useAssistantPageSession } from "@/app/hooks/useAssistantPageSession";
import { ProductManagerActionPanel } from "./components/ProductManagerActionPanel";
import { ProductManagerComposer } from "./components/ProductManagerComposer";
import { ProductManagerResultPanel } from "./components/ProductManagerResultPanel";
import { useProductManagerRunner } from "./hooks/useProductManagerRunner";

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

export default function ProductManagerPage() {
  const runner = useProductManagerRunner();
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
  const [topicInput, setTopicInput] = useState("AI 生产力工具");
  const [productInput, setProductInput] = useState("");

  useEffect(() => {
    void fetch("/api/product-manager/recipes")
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
      icon={Lightbulb}
      title="产品经理助手"
      subtitle="选模板 · 填背景 · 一键出报告"
      badge={
        <span className="inline-flex items-center gap-1">
          <Target className="h-3 w-3" />
          {envBadge}
        </span>
      }
      panelTitle="开始"
      controlsWidthClass="lg:w-[min(100%,400px)] xl:w-[420px]"
      pinFooter
      initLoading={initLoading}
      error={error}
      controls={
        <ProductManagerActionPanel
          category={category}
          onCategoryChange={setCategory}
          recipes={recipes}
          suggestions={suggestions}
          loading={loading}
          onRunRecipe={handleRunRecipe}
          topicInput={topicInput}
          onTopicInputChange={setTopicInput}
          productInput={productInput}
          onProductInputChange={setProductInput}
          onValidationError={setError}
        />
      }
      footer={
        <>
          <ProductManagerComposer
            key={composerKey}
            loading={loading}
            onStreamText={setStreamText}
            onError={setError}
            composerKey={composerKey}
            onReset={resetConversation}
            showReset={Boolean(streamText.trim() || lastResult || task)}
          />
          <AssistantPageFooterHint toolKey="productManager" />
        </>
      }
      results={
        <ProductManagerResultPanel
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
