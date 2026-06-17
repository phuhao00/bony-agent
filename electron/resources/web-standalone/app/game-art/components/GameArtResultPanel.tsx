"use client";

import { Palette } from "lucide-react";
import { AssistantRecipeResultPanel } from "@/app/components/AssistantRecipeResultPanel";
import type { GameArtTask } from "../hooks/useGameArtRunner";

export function GameArtResultPanel({
  task,
  streamText,
  lastResult,
  loading,
  recipes = [],
}: {
  task: GameArtTask | null;
  streamText: string;
  lastResult: unknown;
  loading: boolean;
  recipes?: { id: string; name: string }[];
}) {
  return (
    <AssistantRecipeResultPanel
      task={task}
      streamText={streamText}
      lastResult={lastResult}
      loading={loading}
      icon={Palette}
      recipes={recipes}
      labels={{
        emptyTitle: "美术 Brief 与规范",
        emptyDescription:
          "在左侧填写项目 Brief，选择美术工作流并点「开始美术分析」。输出与 Moodboard 会显示在这里。",
        runningTitle: "正在生成美术方案",
        defaultDocumentTitle: "美术策划文档",
      }}
    />
  );
}
