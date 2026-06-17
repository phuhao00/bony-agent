"use client";

import { Loader2, Volume2, Video, Image as ImageIcon } from "lucide-react";
import type { CanvasNode } from "@/hooks/useCanvas";
import { MarkdownContent } from "./MarkdownContent";

interface NodeMarkdownProps {
  node: CanvasNode;
  topic?: string;
  params?: any;
}

export function NodeMarkdown({ node, topic, params }: NodeMarkdownProps) {
  if (node.type === "cover") return <CoverContent node={node} />;
  if (node.type === "voiceover") return <VoiceoverContent node={node} />;
  if (node.type === "video") return <VideoContent node={node} />;

  const md = buildNodeMarkdown(node, topic, params);
  return (
    <div className="max-h-[420px] overflow-y-auto pr-1">
      <MarkdownContent markdown={md} />
    </div>
  );
}

function CoverContent({ node }: { node: CanvasNode }) {
  const data = node.data || {};
  const imageUrl = data.image_url;
  const isGenerating = node.status === "generating" && !imageUrl;

  return (
    <div className="space-y-3">
      {isGenerating ? (
        <div className="aspect-square rounded-xl bg-[var(--nav-active-fill)] flex flex-col items-center justify-center gap-2 text-[color:var(--label-secondary)]">
          <Loader2 className="w-6 h-6 animate-spin text-[color:var(--accent)]" />
          <span className="text-xs">正在生成封面图片...</span>
        </div>
      ) : imageUrl ? (
        <div className="space-y-2">
          <img
            src={imageUrl}
            alt="封面"
            className="w-full aspect-square rounded-xl object-cover border border-[var(--border-subtle)]"
          />
          <p className="text-xs text-[color:var(--label-secondary)] line-clamp-2">{data.visual_concept}</p>
        </div>
      ) : (
        <div className="aspect-square rounded-xl bg-[var(--nav-active-fill)] flex flex-col items-center justify-center gap-2 text-[color:var(--label-secondary)]">
          <ImageIcon className="w-8 h-8 opacity-30" />
          <span className="text-xs text-center px-4">{data.visual_concept || data.chinese_prompt || "封面提示词待生成"}</span>
        </div>
      )}
      {(data.english_prompt || data.chinese_prompt) && !imageUrl && !isGenerating && (
        <div className="text-[10px] text-[color:var(--label-secondary)]/70 bg-[var(--nav-active-fill)] rounded-lg p-2 font-mono leading-relaxed line-clamp-3">
          {data.english_prompt || data.chinese_prompt}
        </div>
      )}
    </div>
  );
}

function VoiceoverContent({ node }: { node: CanvasNode }) {
  const data = node.data || {};
  const audioUrl = data.audio_url;
  const isGenerating = node.status === "generating" && !audioUrl;

  return (
    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
      {isGenerating ? (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]">
          <Loader2 className="w-4 h-4 animate-spin text-[color:var(--accent)]" />
          <span className="text-xs">正在生成 TTS 语音...</span>
        </div>
      ) : audioUrl ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--nav-active-fill)] border border-[var(--border-subtle)]">
            <Volume2 className="w-4 h-4 text-[color:var(--accent)] shrink-0" />
            <audio
              controls
              src={audioUrl}
              className="flex-1 h-8"
              style={{ minWidth: 0 }}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]">
          <Volume2 className="w-4 h-4 opacity-40" />
          <span className="text-xs">语音待生成</span>
        </div>
      )}
      {(data.segments || []).slice(0, 6).map((seg: any, idx: number) => (
        <div key={idx} className="p-2 rounded-lg bg-[var(--nav-active-fill)] text-xs">
          <span className="font-medium text-[color:var(--accent)]">{seg.speaker}</span>
          <p className="text-[color:var(--label-secondary)] mt-0.5 line-clamp-2">{seg.text}</p>
        </div>
      ))}
    </div>
  );
}

function VideoContent({ node }: { node: CanvasNode }) {
  const data = node.data || {};
  const videoUrl = data.video_url;
  const isGenerating = node.status === "generating";

  return (
    <div className="space-y-2">
      {isGenerating ? (
        <div className="aspect-video rounded-xl bg-[var(--nav-active-fill)] flex flex-col items-center justify-center gap-2 text-[color:var(--label-secondary)]">
          <Loader2 className="w-6 h-6 animate-spin text-[color:var(--accent)]" />
          <span className="text-xs">正在合成播客视频...</span>
          <span className="text-[10px] opacity-60">通常需要 1-3 分钟</span>
        </div>
      ) : videoUrl ? (
        <div className="space-y-2">
          <video
            controls
            src={videoUrl}
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-black"
            style={{ maxHeight: 260 }}
          />
          {data.title && <p className="text-xs font-medium truncate">{data.title}</p>}
        </div>
      ) : (
        <div className="aspect-video rounded-xl bg-[var(--nav-active-fill)] flex flex-col items-center justify-center gap-2 text-[color:var(--label-secondary)]">
          <Video className="w-8 h-8 opacity-30" />
          <span className="text-xs">播客视频待生成</span>
          {data.error && <p className="text-[10px] text-red-400 px-4 text-center">{data.error}</p>}
        </div>
      )}
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
