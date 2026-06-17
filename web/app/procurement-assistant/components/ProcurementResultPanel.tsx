"use client";

import { ShoppingCart } from "lucide-react";
import { AssistantRecipeResultPanel } from "@/app/components/AssistantRecipeResultPanel";
import type { ProcurementTask } from "../hooks/useProcurementRunner";

export function ProcurementResultPanel({
  task,
  streamText,
  lastResult,
  loading,
  recipes = [],
}: {
  task: ProcurementTask | null;
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
      icon={ShoppingCart}
      recipes={recipes}
      labels={{
        emptyTitle: "采购分析与建议",
        emptyDescription:
          "在左侧选择采购场景，录入标的与供应商信息，点「开始采购分析」。结果会固定显示在这里。",
        runningTitle: "正在分析中",
        defaultDocumentTitle: "采购分析报告",
      }}
    />
  );
}
