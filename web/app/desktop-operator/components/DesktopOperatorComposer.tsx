"use client";

import { AssistantComposer } from "@/app/components/AssistantComposer";

export function DesktopOperatorComposer({
  loading,
  onStreamText,
  onError,
}: {
  loading: boolean;
  onStreamText: (text: string) => void;
  onError: (msg: string) => void;
}) {
  return (
    <AssistantComposer
      agentId="desktop_operator_agent"
      loading={loading}
      onStreamText={onStreamText}
      onError={onError}
      description="描述你想在本地应用或桌面环境中完成的操作，Agent 会规划执行步骤。"
      placeholder="例如：打开 VS Code 并在当前项目里搜索 TODO 注释…"
    />
  );
}
