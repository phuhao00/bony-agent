"use client";

import { AssistantComposer } from "@/app/components/AssistantComposer";

export function SystemAssistantComposer({
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
      agentId="system_assistant"
      loading={loading}
      onStreamText={onStreamText}
      onError={onError}
      description="描述你的系统维护、安装或目录整理需求，Agent 会结合本机环境给出操作建议。"
      placeholder="例如：帮我检查 Docker 和 Node 是否已安装，并整理 Downloads 目录…"
    />
  );
}
