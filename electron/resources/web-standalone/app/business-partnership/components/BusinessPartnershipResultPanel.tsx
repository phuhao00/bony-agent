"use client";

import { Handshake } from "lucide-react";
import { AssistantRecipeResultPanel } from "@/app/components/AssistantRecipeResultPanel";
import type { BusinessPartnershipTask } from "../hooks/useBusinessPartnershipRunner";

export function BusinessPartnershipResultPanel({
  task,
  streamText,
  lastResult,
  loading,
  recipes = [],
}: {
  task: BusinessPartnershipTask | null;
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
      icon={Handshake}
      recipes={recipes}
      labels={{
        emptyTitle: "商务合作方案与评估",
        emptyDescription:
          "在左侧选择合作类型，填好公司与伙伴背景，点「开始 BD 分析」。输出会固定显示在这里。",
        runningTitle: "正在整理合作方案",
        defaultDocumentTitle: "商务合作报告",
      }}
      emptyFooter="条款与方案仅供参考，正式合作请法务与业务负责人复核。"
    />
  );
}
