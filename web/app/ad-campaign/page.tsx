"use client";

import { Megaphone, Target } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AssistantPageFooterHint } from "@/app/components/AssistantPageFooterHint";
import { CampaignCommandLayout } from "@/app/components/AssistantLayoutVariants";
import { useAssistantPageSession } from "@/app/hooks/useAssistantPageSession";
import { AdCampaignActionPanel } from "./components/AdCampaignActionPanel";
import { AdCampaignComposer } from "./components/AdCampaignComposer";
import { AdCampaignKpiBar } from "./components/AdCampaignKpiBar";
import { AdCampaignResultPanel } from "./components/AdCampaignResultPanel";
import { useAdCampaignRunner } from "./hooks/useAdCampaignRunner";

type Recipe = {
  id: string;
  name: string;
  category: string;
  description: string;
};

const CHANNEL_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  wechat: "微信",
  google: "Google",
};

export default function AdCampaignPage() {
  const runner = useAdCampaignRunner();
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
  const [productInput, setProductInput] = useState("SaaS 协作工具");
  const [campaignInput, setCampaignInput] = useState("");
  const [budgetK, setBudgetK] = useState(100);
  const [channels, setChannels] = useState<string[]>(["douyin", "xiaohongshu"]);
  const [audience, setAudience] = useState("25-34 职场");

  useEffect(() => {
    void fetch("/api/ad-campaign/recipes")
      .then((r) => r.json())
      .then((d) => setRecipes(d.recipes || []));
  }, []);

  const envBadge = useMemo(() => {
    const count = environment?.recipe_count ?? 0;
    const areas = environment?.focus_areas?.length ?? 0;
    return `${count} 个工作流 · ${areas} 大能力域`;
  }, [environment]);

  const budgetLabel = budgetK >= 100 ? `月 ${(budgetK / 10).toFixed(0)} 万` : `月 ${budgetK} 千`;

  const toggleChannel = useCallback((id: string) => {
    setChannels((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }, []);

  const handleRunRecipe = useCallback(
    async (recipeId: string, params: Record<string, unknown> = {}) => {
      const enriched = {
        ...params,
        channels: channels.map((c) => CHANNEL_LABELS[c] || c).join("、"),
        audience,
        budget_hint: budgetLabel,
      };
      try {
        const data = await runRecipe(recipeId, enriched);
        setLastResult(data);
      } catch {
        /* error handled in hook */
      }
    },
    [audience, budgetLabel, channels, runRecipe, setLastResult],
  );

  return (
    <CampaignCommandLayout
      icon={Megaphone}
      title="广告投放助手"
      subtitle="配战役 · 选模板 · 一键出方案"
      badge={
        <span className="inline-flex items-center gap-1">
          <Target className="h-3 w-3" />
          {envBadge}
        </span>
      }
      initLoading={initLoading}
      error={error}
      kpiBar={
        <AdCampaignKpiBar
          budgetK={budgetK}
          onBudgetKChange={setBudgetK}
          channels={channels}
          onToggleChannel={toggleChannel}
          audience={audience}
          onAudienceChange={setAudience}
          productName={productInput}
        />
      }
      controls={
        <AdCampaignActionPanel
          category={category}
          onCategoryChange={setCategory}
          recipes={recipes}
          suggestions={suggestions}
          loading={loading}
          onRunRecipe={handleRunRecipe}
          productInput={productInput}
          onProductInputChange={setProductInput}
          campaignInput={campaignInput}
          onCampaignInputChange={setCampaignInput}
          onValidationError={setError}
        />
      }
      results={
        <AdCampaignResultPanel
          task={task}
          streamText={streamText}
          lastResult={lastResult}
          loading={loading}
          channels={channels.map((c) => CHANNEL_LABELS[c] || c)}
          budgetLabel={budgetLabel}
          recipes={recipes}
        />
      }
      footer={
        <>
          <AdCampaignComposer
            key={composerKey}
            loading={loading}
            onStreamText={setStreamText}
            onError={setError}
            composerKey={composerKey}
            onReset={resetConversation}
            showReset={Boolean(streamText.trim() || lastResult || task)}
          />
          <AssistantPageFooterHint toolKey="adCampaign" />
        </>
      }
    />
  );
}
