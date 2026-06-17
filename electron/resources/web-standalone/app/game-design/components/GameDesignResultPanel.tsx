"use client";

import { Workflow } from "lucide-react";
import { AssistantRecipeResultPanel } from "@/app/components/AssistantRecipeResultPanel";
import type { GameDesignTask } from "../hooks/useGameDesignRunner";

export function GameDesignResultPanel({
  task,
  streamText,
  lastResult,
  loading,
  recipes = [],
}: {
  task: GameDesignTask | null;
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
      icon={Workflow}
      recipes={recipes}
      labels={{
        emptyTitle: "你的下一份策划文档",
        emptyDescription:
          "在左侧选择策划类型，填好创意背景，点「开始策划」。文档会固定显示在这里，对话栏始终在底部。",
        runningTitle: "正在撰写策划案",
        runningMessage: "我在梳理核心循环、系统结构与可落地的策划框架。",
        defaultDocumentTitle: "策划分析报告",
      }}
    />
  );
}
