"use client";

import Link from "next/link";
import { ImagePlus, Sparkles } from "lucide-react";
import { extractHexColors } from "@/app/components/assistantTextParsing";

const PLACEHOLDER_TILES = [
  { label: "角色造型", hint: "轮廓 / 服饰 / 表情", gradient: "from-violet-500/18 to-fuchsia-500/18" },
  { label: "场景气氛", hint: "光线 / 空间 / 材质", gradient: "from-sky-500/18 to-cyan-500/18" },
  { label: "UI 语言", hint: "控件 / 图标 / HUD", gradient: "from-amber-500/18 to-orange-500/18" },
  { label: "色彩情绪", hint: "主色 / 强调色 / 对比", gradient: "from-rose-500/18 to-pink-500/18" },
];

export function GameArtMoodboard({
  reportText,
  projectName,
  loading,
}: {
  reportText: string;
  projectName: string;
  loading: boolean;
}) {
  const colors = extractHexColors(reportText);
  const promptSeed = [projectName, reportText.slice(0, 120)].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] bg-[var(--card-surface)] p-4 shadow-sm ring-1 ring-[var(--border-subtle)]">
      <div className="mb-4 shrink-0">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
          <Sparkles className="h-4 w-4 text-[color:var(--accent)]" />
          Moodboard
        </div>
        <Link
          href={`/media/image?prompt=${encodeURIComponent(promptSeed || "游戏概念图")}`}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-2xl bg-[color:var(--accent)] px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          <ImagePlus className="h-3.5 w-3.5" />
          一键生成概念图
        </Link>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <section className="rounded-2xl bg-[var(--page-canvas)] p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--label-tertiary)]">
            色板
          </p>
          {colors.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {colors.slice(0, 6).map((hex) => (
                <div key={hex} className="overflow-hidden rounded-xl bg-[var(--card-surface)] ring-1 ring-[var(--border-subtle)]">
                  <span
                    className="block h-10 border-b border-black/10"
                    style={{ backgroundColor: hex }}
                  />
                  <span className="block px-2 py-1.5 font-mono text-[10px] text-[color:var(--label-secondary)]">
                    {hex}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-[color:var(--label-secondary)]">
              运行风格分析后，会从报告里提取色值并沉淀成可复用色板。
            </p>
          )}
        </section>

        <section className="space-y-2">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--label-tertiary)]">
            视觉维度
          </p>
          {PLACEHOLDER_TILES.map((tile) => (
            <div
              key={tile.label}
              className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${tile.gradient} p-3 ring-1 ring-[var(--border-subtle)]`}
            >
              {loading ? (
                <div className="absolute inset-0 animate-pulse rounded-2xl bg-[var(--nav-active-fill)]/40" />
              ) : null}
              <p className="relative text-sm font-medium text-[color:var(--foreground)]">{tile.label}</p>
              <p className="relative mt-1 text-xs text-[color:var(--label-secondary)]">{tile.hint}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
