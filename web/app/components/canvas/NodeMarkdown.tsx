"use client";

import type { CanvasNode } from "@/hooks/useCanvas";
import { MarkdownContent } from "./MarkdownContent";

interface NodeMarkdownProps {
  node: CanvasNode;
  topic?: string;
  params?: any;
}

export function NodeMarkdown({ node, topic, params }: NodeMarkdownProps) {
  const md = buildNodeMarkdown(node, topic, params);
  return (
    <div className="max-h-[420px] overflow-y-auto pr-1">
      <MarkdownContent markdown={md} />
    </div>
  );
}

function buildNodeMarkdown(node: CanvasNode, topic?: string, params?: any): string {
  const data = node.data || {};
  switch (node.type) {
    case "brief": {
      return [
        "## 播客主题",
        "",
        data.text || topic || "未设置主题",
        "",
        "## 参数",
        `- 形式：${params?.format || "-"}`,
        `- 语气：${params?.tone || "-"}`,
        `- 时长：${params?.duration || "-"} 分钟`,
        `- 听众：${params?.audience || "-"}`,
      ].join("\n");
    }
    case "plan": {
      const structure = (data.structure || [])
        .map((s: any) => `- **${s.segment}** (${s.duration_min}min)：${s.content || ""}`)
        .join("\n");
      return [
        `## ${data.title || "节目策划"}`,
        "",
        `**定位**：${data.positioning || ""}`,
        "",
        "### 节目结构",
        structure || "- 暂无结构",
      ].join("\n");
    }
    case "script": {
      const segments = (data.segments || [])
        .map((s: any) => `### ${s.time} · ${s.type}\n\n${s.content || ""}`)
        .join("\n\n");
      return [`## ${data.title || "脚本"}`, "", segments || "- 暂无内容"].join("\n");
    }
    case "cover": {
      return [
        "## 封面设计",
        "",
        `**视觉概念**：${data.visual_concept || ""}`,
        "",
        "**英文提示词**",
        "```",
        data.english_prompt || "",
        "```",
        "",
        "**中文提示词**",
        "```",
        data.chinese_prompt || "",
        "```",
      ].join("\n");
    }
    case "voiceover": {
      const segments = (data.segments || [])
        .map((s: any) => `- **${s.speaker}**：${s.text || ""}`)
        .join("\n");
      return ["## 配音计划", "", segments || "- 暂无内容"].join("\n");
    }
    case "publish": {
      return [
        `## ${data.title || "发布文案"}`,
        "",
        `**简介**：${data.short_description || ""}`,
        "",
        "**Shownotes**",
        "```",
        data.shownotes || "",
        "```",
        "",
        `**标签**：${(data.hashtags || []).join(" ")}`,
      ].join("\n");
    }
    default:
      return "*暂无内容*";
  }
}
