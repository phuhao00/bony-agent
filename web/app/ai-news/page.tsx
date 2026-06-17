"use client";

import TopicResearchTab from "@/app/ai-news/TopicResearchTab";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  {
    key: "topic_research",
    label: "🔍 话题调研",
    source: "research",
    sub: null,
  },
  {
    key: "hf_models",
    label: "🤗 HF Models",
    source: "huggingface",
    sub: "models",
  },
  {
    key: "hf_datasets",
    label: "📦 HF Datasets",
    source: "huggingface",
    sub: "datasets",
  },
  {
    key: "hf_spaces",
    label: "🚀 HF Spaces",
    source: "huggingface",
    sub: "spaces",
  },
  { key: "github", label: "⭐ GitHub AI", source: "github", sub: null },
  { key: "x_ai", label: "𝕏 AI 热点", source: "x_ai", sub: null },
  {
    key: "fin_bloomberg",
    label: "📊 Bloomberg",
    source: "finance",
    sub: "bloomberg",
  },
  {
    key: "fin_reuters",
    label: "📰 路透社",
    source: "finance",
    sub: "reuters_news",
  },
  { key: "fin_intl", label: "🌐 国际财经", source: "finance", sub: "reuters" },
  { key: "fin_wind", label: "🇳 A股公告", source: "finance", sub: "wind" },
];

const LANG_COLORS: Record<string, string> = {
  Python: "#3572A5",
  TypeScript: "#2b7489",
  JavaScript: "#f1e05a",
  Rust: "#dea584",
  Go: "#00ADD8",
  C: "#555555",
  "C++": "#f34b7d",
  Java: "#b07219",
  Kotlin: "#A97BFF",
  Swift: "#ffac45",
  Ruby: "#701516",
  Jupyter: "#DA5B0B",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrendItem {
  id: string;
  source: string;
  source_icon: string;
  category: string;
  title: string;
  desc?: string;
  url?: string;
  likes?: string;
  downloads?: string;
  stars?: string;
  stars_today?: string;
  language?: string;
  author?: string;
  full_id?: string;
  published_at?: string;
}

interface MarketQuote {
  id: string;
  name: string;
  label: string;
  price: string;
  change_pct: number;
  change_val: number;
  currency: string;
  arrow: string;
  color: string;
}

interface AiTrendingData {
  fetched_at?: string;
  huggingface?: {
    models: TrendItem[];
    datasets: TrendItem[];
    spaces: TrendItem[];
  };
  github?: TrendItem[];
  x_ai?: TrendItem[];
}

interface FinancialData {
  fetched_at?: string;
  bloomberg?: TrendItem[];
  reuters_news?: TrendItem[];
  reuters?: TrendItem[];
  wind?: TrendItem[];
  market_quotes?: MarketQuote[];
}

interface FinancialData {
  fetched_at?: string;
  bloomberg?: TrendItem[];
  reuters_news?: TrendItem[];
  reuters?: TrendItem[];
  wind?: TrendItem[];
  market_quotes?: MarketQuote[];
}

type GenType = "card" | "poster" | "newscard" | "video";

interface GenResult {
  type: GenType;
  status: "loading" | "background" | "done" | "error";
  imageUrl?: string;
  videoUrl?: string;
  cardItems?: TrendItem[];
  lang?: "zh" | "en";
  error?: string;
}

// ─── Small components ─────────────────────────────────────────────────────────

function LangBadge({ lang }: { lang?: string }) {
  if (!lang) return null;
  const color = LANG_COLORS[lang] || "#8b949e";
  return (
    <span className="flex items-center gap-1 text-[11px] text-slate-400 font-medium">
      <span
        className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
        style={{ background: color }}
      />
      {lang}
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-slate-100 rounded-2xl h-36 animate-pulse border border-slate-100" />
  );
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <div
      className={`absolute -top-2.5 -left-2.5 w-7 h-7 rounded-full flex items-center justify-center font-black text-xs shadow-md border-2 border-white z-10
      ${
        rank === 1
          ? "bg-gradient-to-br from-yellow-400 to-orange-500 text-white"
          : rank === 2
            ? "bg-gradient-to-br from-slate-300 to-slate-400 text-white"
            : rank === 3
              ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white"
              : "bg-slate-100 text-slate-400"
      }`}
    >
      {rank}
    </div>
  );
}

function SelectOverlay({ selected }: { selected: boolean }) {
  return (
    <div
      className={`absolute top-2 right-2 z-20 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-150
      ${
        selected
          ? "border-indigo-500 bg-indigo-500 shadow-md shadow-indigo-200"
          : "border-slate-300 bg-white"
      }`}
    >
      {selected && (
        <svg
          className="w-3 h-3 text-white"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
    </div>
  );
}

// ─── Card wrappers (selectable) ───────────────────────────────────────────────

function HFCard({
  item,
  rank,
  selected,
  onToggle,
}: {
  item: TrendItem;
  rank: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className={`group relative flex flex-col gap-2 p-4 rounded-2xl border cursor-pointer transition-all duration-200
        ${
          selected
            ? "border-indigo-400 bg-indigo-50 shadow-md shadow-indigo-100 -translate-y-0.5"
            : "border-slate-100 bg-white hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-500/5 hover:-translate-y-0.5"
        }`}
    >
      <SelectOverlay selected={selected} />
      <RankBadge rank={rank} />
      <div className="flex items-start gap-2 pt-1">
        <span className="text-xl shrink-0">{item.source_icon}</span>
        <div className="min-w-0">
          <p
            className={`text-[13px] font-bold leading-snug line-clamp-2 transition-colors ${selected ? "text-indigo-700" : "text-slate-800 group-hover:text-indigo-600"}`}
          >
            {item.full_id || item.title}
          </p>
          {item.author && (
            <p className="text-[11px] text-slate-400 mt-0.5">{item.author}</p>
          )}
        </div>
      </div>
      {item.desc && (
        <p className="text-[11.5px] text-slate-500 line-clamp-2 leading-relaxed">
          {item.desc}
        </p>
      )}
      <div className="flex items-center gap-3 mt-auto pt-2 border-t border-slate-50">
        {item.likes && (
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            {item.likes}
          </span>
        )}
        {item.downloads && item.downloads !== "0" && (
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" />
            </svg>
            {Number(item.downloads) > 1000
              ? `${(Number(item.downloads) / 1000).toFixed(1)}k`
              : item.downloads}
          </span>
        )}
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-[10px] text-indigo-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
        >
          查看 →
        </a>
      </div>
    </div>
  );
}

function GithubCard({
  item,
  rank,
  selected,
  onToggle,
}: {
  item: TrendItem;
  rank: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className={`group relative flex flex-col gap-2 p-4 rounded-2xl border cursor-pointer transition-all duration-200
        ${
          selected
            ? "border-emerald-400 bg-emerald-50 shadow-md shadow-emerald-100 -translate-y-0.5"
            : "border-slate-100 bg-white hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-500/5 hover:-translate-y-0.5"
        }`}
    >
      <SelectOverlay selected={selected} />
      <RankBadge rank={rank} />
      <div className="flex items-center gap-2 pt-1">
        <span className="text-lg shrink-0">⭐</span>
        <p
          className={`text-[13px] font-bold line-clamp-1 font-mono transition-colors ${selected ? "text-emerald-700" : "text-slate-800 group-hover:text-emerald-600"}`}
        >
          {item.title}
        </p>
      </div>
      {item.desc && (
        <p className="text-[11.5px] text-slate-500 line-clamp-3 leading-relaxed">
          {item.desc}
        </p>
      )}
      <div className="flex items-center gap-3 mt-auto pt-2 border-t border-slate-50">
        <LangBadge lang={item.language} />
        {item.stars && (
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            {item.stars}
          </span>
        )}
        {item.stars_today && (
          <span className="text-[11px] text-emerald-500 font-semibold">
            {item.stars_today}
          </span>
        )}
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-[10px] text-emerald-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
        >
          查看 →
        </a>
      </div>
    </div>
  );
}

function XNewsCard({
  item,
  rank,
  selected,
  onToggle,
}: {
  item: TrendItem;
  rank: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className={`group relative flex flex-col gap-2 p-4 rounded-2xl border cursor-pointer transition-all duration-200
        ${
          selected
            ? "border-sky-400 bg-sky-50 shadow-md shadow-sky-100 -translate-y-0.5"
            : "border-slate-100 bg-white hover:border-sky-200 hover:shadow-lg hover:shadow-sky-500/5 hover:-translate-y-0.5"
        }`}
    >
      <SelectOverlay selected={selected} />
      <RankBadge rank={rank} />
      <div className="flex items-start gap-2 pt-1">
        <span className="text-lg shrink-0 font-black">{item.source_icon}</span>
        <div className="min-w-0">
          <p
            className={`text-[13px] font-bold leading-snug line-clamp-3 transition-colors ${selected ? "text-sky-700" : "text-slate-800 group-hover:text-sky-600"}`}
          >
            {item.title}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">{item.source}</p>
        </div>
      </div>
      {item.desc && (
        <p className="text-[11.5px] text-slate-500 line-clamp-3 leading-relaxed">
          {item.desc}
        </p>
      )}
      <div className="flex items-center mt-auto pt-2 border-t border-slate-50">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-[10px] text-sky-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
        >
          查看 →
        </a>
      </div>
    </div>
  );
}

// ─── Finance News Card ────────────────────────────────────────────────────────

function FinNewsCard({
  item,
  rank,
  selected,
  onToggle,
}: {
  item: TrendItem;
  rank: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const pub = item.published_at
    ? new Date(item.published_at).toLocaleDateString("zh-CN")
    : null;
  return (
    <div
      onClick={onToggle}
      className={`group relative flex flex-col gap-2 p-4 rounded-2xl border cursor-pointer transition-all duration-200
        ${
          selected
            ? "border-amber-400 bg-amber-50 shadow-md shadow-amber-100 -translate-y-0.5"
            : "border-slate-100 bg-white hover:border-amber-200 hover:shadow-lg hover:shadow-amber-500/5 hover:-translate-y-0.5"
        }`}
    >
      <SelectOverlay selected={selected} />
      <RankBadge rank={rank} />
      <div className="flex items-start gap-2 pt-1">
        <span className="text-lg shrink-0">{item.source_icon}</span>
        <div className="min-w-0">
          <p
            className={`text-[13px] font-bold leading-snug line-clamp-3 transition-colors ${selected ? "text-amber-700" : "text-slate-800 group-hover:text-amber-600"}`}
          >
            {item.title}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-slate-400">{item.source}</span>
            {item.category && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100 font-medium">
                {item.category}
              </span>
            )}
          </div>
        </div>
      </div>
      {item.desc && (
        <p className="text-[11.5px] text-slate-500 line-clamp-3 leading-relaxed">
          {item.desc}
        </p>
      )}
      <div className="flex items-center mt-auto pt-2 border-t border-slate-50 gap-2">
        {pub && <span className="text-[10px] text-slate-400">{pub}</span>}
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-[10px] text-amber-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
        >
          查看 →
        </a>
      </div>
    </div>
  );
}

// ─── Market Quotes Ticker ─────────────────────────────────────────────────────

function MarketQuotesTicker({ quotes }: { quotes: MarketQuote[] }) {
  if (!quotes.length) return null;
  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-1 mb-5 scrollbar-none">
      {quotes.map((q) => (
        <div
          key={q.id}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl card-surface border border-[color:var(--separator-subtle)] shrink-0"
        >
          <span className="text-[11px] font-bold text-[color:var(--foreground)] whitespace-nowrap">
            {q.label}
          </span>
          <span className="text-[12px] font-black text-[color:var(--foreground)] tabular-nums">
            {q.price}
          </span>
          <span
            className={`text-[11px] font-semibold tabular-nums whitespace-nowrap ${
              q.color === "green"
                ? "text-emerald-500"
                : q.color === "red"
                  ? "text-red-500"
                  : "text-slate-400"
            }`}
          >
            {q.arrow}{" "}
            {typeof q.change_pct === "number"
              ? `${q.change_pct >= 0 ? "+" : ""}${q.change_pct.toFixed(2)}%`
              : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Card background presets ─────────────────────────────────────────────────

const CARD_BACKGROUNDS = [
  {
    label: "靛蓝",
    value: "linear-gradient(135deg,#312e81 0%,#4338ca 55%,#6366f1 100%)",
  },
  {
    label: "翠绿",
    value: "linear-gradient(135deg,#064e3b 0%,#065f46 55%,#059669 100%)",
  },
  {
    label: "天蓝",
    value: "linear-gradient(135deg,#0c4a6e 0%,#0369a1 55%,#0ea5e9 100%)",
  },
  { label: "深夜", value: "linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%)" },
  {
    label: "玫红",
    value: "linear-gradient(135deg,#4c0519 0%,#be123c 55%,#f43f5e 100%)",
  },
  {
    label: "日落",
    value: "linear-gradient(135deg,#431407 0%,#ea580c 55%,#fbbf24 100%)",
  },
  {
    label: "极光",
    value: "linear-gradient(135deg,#022c22 0%,#134e4a 40%,#0e7490 100%)",
  },
  {
    label: "紫霞",
    value: "linear-gradient(135deg,#2e1065 0%,#7c3aed 55%,#c026d3 100%)",
  },
];

// ─── Poster style presets ─────────────────────────────────────────────────────

interface GenConfig {
  customPrompt: string;
  lang: "zh" | "en";
  // poster-specific
  style: string;
  bgHint: string;
}

const POSTER_STYLES = [
  {
    id: "botanical",
    label: "清新植物",
    emoji: "🌿",
    preview: "linear-gradient(135deg,#f0fdf4 0%,#dcfce7 60%,#ecfdf5 100%)",
    promptHint:
      "bright airy botanical background with leaf and plant decorations, warm whites and sage greens, natural organic feel, light and airy",
  },
  {
    id: "minimal",
    label: "极简白",
    emoji: "⬜",
    preview: "#f8fafc",
    promptHint:
      "pure clean white background, minimal design, no decorations, crisp black and gray typography, maximum whitespace, clean grid layout",
  },
  {
    id: "magazine",
    label: "杂志风",
    emoji: "📰",
    preview: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)",
    promptHint:
      "editorial magazine layout, bold dramatic typography, high contrast, professional print aesthetic, structured column grid",
  },
  {
    id: "tech_dark",
    label: "科技暗色",
    emoji: "💻",
    preview: "linear-gradient(135deg,#0f172a 0%,#1e1b4b 60%,#312e81 100%)",
    promptHint:
      "dark background with blue-purple gradient accents, subtle grid or circuit pattern decorations, sleek tech aesthetic",
  },
  {
    id: "chinese",
    label: "国潮风",
    emoji: "🏮",
    preview: "linear-gradient(135deg,#7f1d1d 0%,#b91c1c 60%,#fbbf24 100%)",
    promptHint:
      "Chinese traditional style, red and gold color palette, subtle auspicious cloud or wave patterns, elegant Chinese aesthetic with modern touch",
  },
  {
    id: "gradient",
    label: "渐变色",
    emoji: "🌈",
    preview: "linear-gradient(135deg,#7c3aed 0%,#2563eb 50%,#06b6d4 100%)",
    promptHint:
      "bold vibrant gradient color blocks, modern geometric shapes, saturated and energetic color palette, contemporary graphic design",
  },
];

function StylePatternOverlay({ id }: { id: string }) {
  const base: React.SVGProps<SVGSVGElement> = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 80 52",
    style: { position: "absolute", inset: 0, width: "100%", height: "100%" },
    "aria-hidden": "true",
  } as React.SVGProps<SVGSVGElement>;

  if (id === "botanical")
    return (
      <svg {...base}>
        {/* large background leaf */}
        <ellipse
          cx="68"
          cy="36"
          rx="28"
          ry="13"
          fill="rgba(22,163,74,0.22)"
          transform="rotate(-40 68 36)"
        />
        {/* mid leaf left */}
        <ellipse
          cx="14"
          cy="44"
          rx="18"
          ry="8"
          fill="rgba(22,163,74,0.18)"
          transform="rotate(35 14 44)"
        />
        {/* top small leaf */}
        <ellipse
          cx="42"
          cy="10"
          rx="15"
          ry="6"
          fill="rgba(16,185,129,0.25)"
          transform="rotate(-18 42 10)"
        />
        {/* tiny accent leaf */}
        <ellipse
          cx="70"
          cy="14"
          rx="10"
          ry="4.5"
          fill="rgba(52,211,153,0.22)"
          transform="rotate(28 70 14)"
        />
        {/* stem lines */}
        <path
          d="M14,52 Q30,34 42,10"
          fill="none"
          stroke="rgba(22,163,74,0.3)"
          strokeWidth="1"
        />
        <path
          d="M68,52 Q58,38 68,14"
          fill="none"
          stroke="rgba(22,163,74,0.2)"
          strokeWidth="0.75"
        />
        {/* berries */}
        <circle cx="28" cy="48" r="2.5" fill="rgba(22,163,74,0.3)" />
        <circle cx="55" cy="50" r="2" fill="rgba(16,185,129,0.25)" />
        <circle cx="74" cy="46" r="1.8" fill="rgba(52,211,153,0.22)" />
      </svg>
    );

  if (id === "minimal")
    return (
      <svg {...base}>
        {/* title bar mock */}
        <rect
          x="10"
          y="10"
          width="60"
          height="5"
          rx="2.5"
          fill="rgba(15,23,42,0.18)"
        />
        {/* subtitle lines */}
        <rect
          x="10"
          y="20"
          width="48"
          height="2.5"
          rx="1"
          fill="rgba(15,23,42,0.1)"
        />
        <rect
          x="10"
          y="25.5"
          width="56"
          height="2.5"
          rx="1"
          fill="rgba(15,23,42,0.1)"
        />
        <rect
          x="10"
          y="31"
          width="40"
          height="2.5"
          rx="1"
          fill="rgba(15,23,42,0.07)"
        />
        {/* divider */}
        <line
          x1="10"
          y1="38"
          x2="70"
          y2="38"
          stroke="rgba(15,23,42,0.08)"
          strokeWidth="0.75"
        />
        {/* cta button */}
        <rect
          x="10"
          y="42"
          width="22"
          height="6"
          rx="3"
          fill="rgba(99,102,241,0.35)"
        />
        <rect
          x="36"
          y="43.5"
          width="14"
          height="3"
          rx="1.5"
          fill="rgba(15,23,42,0.07)"
        />
      </svg>
    );

  if (id === "magazine")
    return (
      <svg {...base}>
        {/* top band */}
        <rect
          x="0"
          y="0"
          width="80"
          height="14"
          fill="rgba(255,255,255,0.09)"
        />
        {/* headline */}
        <rect
          x="8"
          y="18"
          width="64"
          height="5"
          rx="1.5"
          fill="rgba(255,255,255,0.5)"
        />
        {/* sub-lines */}
        <rect
          x="8"
          y="27"
          width="50"
          height="2.5"
          rx="1"
          fill="rgba(255,255,255,0.25)"
        />
        <rect
          x="8"
          y="32"
          width="58"
          height="2.5"
          rx="1"
          fill="rgba(255,255,255,0.22)"
        />
        <rect
          x="8"
          y="37"
          width="42"
          height="2.5"
          rx="1"
          fill="rgba(255,255,255,0.16)"
        />
        {/* red tag + divider */}
        <rect
          x="8"
          y="44"
          width="20"
          height="5.5"
          rx="1.5"
          fill="rgba(239,68,68,0.8)"
        />
        <rect
          x="0"
          y="49"
          width="80"
          height="3"
          fill="rgba(255,255,255,0.05)"
        />
      </svg>
    );

  if (id === "tech_dark")
    return (
      <svg {...base}>
        {/* grid lines */}
        <line
          x1="0"
          y1="13"
          x2="80"
          y2="13"
          stroke="rgba(99,102,241,0.3)"
          strokeWidth="0.5"
        />
        <line
          x1="0"
          y1="26"
          x2="80"
          y2="26"
          stroke="rgba(99,102,241,0.3)"
          strokeWidth="0.5"
        />
        <line
          x1="0"
          y1="39"
          x2="80"
          y2="39"
          stroke="rgba(99,102,241,0.25)"
          strokeWidth="0.5"
        />
        <line
          x1="20"
          y1="0"
          x2="20"
          y2="52"
          stroke="rgba(99,102,241,0.25)"
          strokeWidth="0.5"
        />
        <line
          x1="50"
          y1="0"
          x2="50"
          y2="52"
          stroke="rgba(99,102,241,0.22)"
          strokeWidth="0.5"
        />
        {/* circuit node */}
        <polygon
          points="35,19 46,26 35,33 24,26"
          fill="none"
          stroke="rgba(139,92,246,0.75)"
          strokeWidth="1.5"
        />
        <circle cx="35" cy="26" r="4" fill="rgba(139,92,246,0.9)" />
        <circle
          cx="35"
          cy="26"
          r="8"
          fill="none"
          stroke="rgba(139,92,246,0.3)"
          strokeWidth="0.75"
        />
        {/* corner dots */}
        <circle cx="20" cy="13" r="1.5" fill="rgba(99,102,241,0.6)" />
        <circle cx="50" cy="39" r="1.5" fill="rgba(99,102,241,0.5)" />
        <circle cx="50" cy="13" r="1" fill="rgba(139,92,246,0.4)" />
      </svg>
    );

  if (id === "chinese")
    return (
      <svg {...base}>
        {/* wave / cloud pattern */}
        <path
          d="M0,44 Q10,28 20,44 Q30,60 40,44 Q50,28 60,44 Q70,60 80,44"
          fill="none"
          stroke="rgba(251,191,36,0.5)"
          strokeWidth="2"
        />
        <path
          d="M0,34 Q10,18 20,34 Q30,50 40,34 Q50,18 60,34 Q70,50 80,34"
          fill="none"
          stroke="rgba(251,191,36,0.3)"
          strokeWidth="1.2"
        />
        {/* seal / medallion */}
        <circle
          cx="40"
          cy="22"
          r="12"
          fill="none"
          stroke="rgba(251,191,36,0.55)"
          strokeWidth="1.8"
        />
        <circle cx="40" cy="22" r="5" fill="rgba(251,191,36,0.7)" />
        <circle
          cx="40"
          cy="22"
          r="8.5"
          fill="none"
          stroke="rgba(251,191,36,0.32)"
          strokeWidth="0.8"
        />
        {/* top corner ornament */}
        <path d="M4,4 Q10,0 16,4 Q10,8 4,4" fill="rgba(251,191,36,0.4)" />
        <path d="M64,4 Q70,0 76,4 Q70,8 64,4" fill="rgba(251,191,36,0.4)" />
      </svg>
    );

  // gradient (default)
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="28" fill="rgba(255,255,255,0.09)" />
      <circle cx="70" cy="46" r="24" fill="rgba(255,255,255,0.07)" />
      <rect
        x="22"
        y="24"
        width="32"
        height="32"
        rx="9"
        fill="rgba(255,255,255,0.07)"
        transform="rotate(22 38 40)"
      />
      <circle cx="54" cy="14" r="11" fill="rgba(255,255,255,0.07)" />
      <line
        x1="0"
        y1="26"
        x2="80"
        y2="26"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="0.5"
      />
    </svg>
  );
}

function BgPicker({
  selected,
  onSelect,
  bgImage,
  onBgImage,
}: {
  selected: string;
  onSelect: (v: string) => void;
  bgImage: string;
  onBgImage: (v: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      onBgImage(dataUrl);
      onSelect("__image__");
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-[color:var(--label-secondary)]">
        背景样式
      </p>
      <div className="flex flex-wrap gap-2">
        {CARD_BACKGROUNDS.map((bg) => (
          <button
            key={bg.label}
            onClick={() => {
              onSelect(bg.value);
              onBgImage("");
            }}
            title={bg.label}
            className={`relative w-8 h-8 rounded-lg border-2 transition-all ${selected === bg.value ? "border-white scale-110 shadow-lg" : "border-transparent hover:border-white/50"}`}
            style={{ background: bg.value }}
          >
            {selected === bg.value && (
              <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-black">
                ✓
              </span>
            )}
          </button>
        ))}
        {/* Custom image upload */}
        <button
          onClick={() => fileRef.current?.click()}
          className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all text-sm ${selected === "__image__" ? "border-indigo-400 bg-indigo-50 text-indigo-600 scale-110" : "border-dashed border-slate-300 text-slate-400 hover:border-indigo-300 hover:text-indigo-500"}`}
          title="上传背景图"
        >
          🖼️
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
      </div>
      {selected === "__image__" && bgImage && (
        <p className="text-[11px] text-emerald-600 font-medium">
          ✓ 已使用自定义背景图
        </p>
      )}
    </div>
  );
}

// ─── Info Card Gallery (individual styled card per item) ────────────────────────

function InfoCardItem({
  item,
  idx,
  bgStyle,
  bgImage,
  lang = "zh",
}: {
  item: TrendItem;
  idx: number;
  bgStyle?: string;
  bgImage?: string;
  lang?: "zh" | "en";
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  const isHF =
    item.source.toLowerCase().includes("hugging") ||
    ["models", "datasets", "spaces"].includes(item.category);
  const isGH = item.source.toLowerCase().includes("github");
  const defaultBg = isHF
    ? "linear-gradient(135deg,#312e81 0%,#4338ca 55%,#6366f1 100%)"
    : isGH
      ? "linear-gradient(135deg,#064e3b 0%,#065f46 55%,#059669 100%)"
      : "linear-gradient(135deg,#0c4a6e 0%,#0369a1 55%,#0ea5e9 100%)";

  const resolvedBg =
    bgStyle === "__image__" && bgImage
      ? `url(${bgImage}) center/cover no-repeat`
      : bgStyle && bgStyle !== "__image__"
        ? bgStyle
        : defaultBg;

  const handleDownload = async () => {
    if (!cardRef.current) return;
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement("a");
      link.download = `ai-card-${idx + 1}-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      alert("请手动截图保存");
    }
  };

  const title =
    (item.full_id || item.title).slice(0, 80) +
    ((item.full_id || item.title).length > 80 ? "…" : "");
  const desc = item.desc
    ? item.desc.slice(0, 120) + (item.desc.length > 120 ? "…" : "")
    : null;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={cardRef}
        className="rounded-2xl overflow-hidden"
        style={{
          background: resolvedBg,
          padding: "24px",
          fontFamily: "system-ui,sans-serif",
          minHeight: "160px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "22px", lineHeight: 1 }}>
              {item.source_icon}
            </span>
            <span
              style={{
                fontSize: "11px",
                color: "rgba(255,255,255,0.6)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {item.source}
            </span>
          </div>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>
            #{idx + 1}
          </span>
        </div>
        <div
          style={{
            fontSize: "15px",
            fontWeight: 800,
            color: "#f8fafc",
            lineHeight: 1.35,
            marginBottom: "10px",
          }}
        >
          {title}
        </div>
        {desc && (
          <div
            style={{
              fontSize: "12px",
              color: "rgba(255,255,255,0.65)",
              lineHeight: 1.5,
              marginBottom: "10px",
              flex: 1,
            }}
          >
            {desc}
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            paddingTop: "10px",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            marginTop: "auto",
          }}
        >
          {item.likes && (
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>
              ❤️ {item.likes}
            </span>
          )}
          {item.stars && (
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>
              ⭐ {item.stars}
            </span>
          )}
          {item.stars_today && (
            <span
              style={{
                fontSize: "11px",
                color: "rgba(255,255,255,0.75)",
                fontWeight: 700,
              }}
            >
              +{item.stars_today} today
            </span>
          )}
          {item.language && (
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>
              {item.language}
            </span>
          )}
          <span
            style={{
              marginLeft: "auto",
              fontSize: "10px",
              color: "rgba(255,255,255,0.25)",
            }}
          >
            AI Media Agent
          </span>
        </div>
      </div>
      <button
        onClick={handleDownload}
        className="self-start flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
      >
        <svg
          className="w-3 h-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" />
        </svg>
        {lang === "en" ? "Download" : "下载"}
      </button>
    </div>
  );
}

function InfoCardGallery({
  items,
  lang = "zh",
}: {
  items: TrendItem[];
  lang?: "zh" | "en";
}) {
  const [bgStyle, setBgStyle] = useState(CARD_BACKGROUNDS[0].value);
  const [bgImage, setBgImage] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <BgPicker
        selected={bgStyle}
        onSelect={setBgStyle}
        bgImage={bgImage}
        onBgImage={setBgImage}
      />
      <p className="text-xs text-[color:var(--label-secondary)] font-medium">
        {lang === "en"
          ? `${items.length} cards · click each button to download`
          : `${items.length} 张卡片 · 点击每张下方按钮单独下载`}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {items.map((item, idx) => (
          <InfoCardItem
            key={item.id}
            item={item}
            idx={idx}
            bgStyle={bgStyle}
            bgImage={bgImage}
            lang={lang}
          />
        ))}
      </div>
    </div>
  );
}

// ─── News List Card Preview (pure front-end render) ───────────────────────────

function NewsListCardPreview({
  items,
  lang = "zh",
}: {
  items: TrendItem[];
  lang?: "zh" | "en";
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [bgStyle, setBgStyle] = useState(CARD_BACKGROUNDS[3].value); // "深夜" default
  const [bgImage, setBgImage] = useState("");

  const resolvedBg =
    bgStyle === "__image__" && bgImage
      ? `url(${bgImage}) center/cover no-repeat`
      : bgStyle && bgStyle !== "__image__"
        ? bgStyle
        : "linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%)";

  const handleDownload = async () => {
    if (!cardRef.current) return;
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: bgStyle === "__image__" ? null : "#0f172a",
      });
      const link = document.createElement("a");
      link.download = `ai-news-card-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      alert("请手动截图保存");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <BgPicker
        selected={bgStyle}
        onSelect={setBgStyle}
        bgImage={bgImage}
        onBgImage={setBgImage}
      />
      <div
        ref={cardRef}
        className="rounded-2xl overflow-hidden"
        style={{
          background: resolvedBg,
          padding: "28px",
          fontFamily: "system-ui,sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "20px",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "18px",
                fontWeight: 800,
                color: "#f8fafc",
                letterSpacing: "-0.3px",
              }}
            >
              🤖 {lang === "en" ? "AI News Digest" : "AI 资讯速递"}
            </div>
            <div
              style={{ fontSize: "11px", color: "#94a3b8", marginTop: "3px" }}
            >
              {new Date().toLocaleDateString(lang === "en" ? "en-US" : "zh-CN")}{" "}
              ·{" "}
              {lang === "en"
                ? `Top ${items.length} picks`
                : `精选 ${items.length} 条`}
            </div>
          </div>
          <div style={{ fontSize: "22px" }}>✨</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {items.slice(0, 8).map((item, i) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                padding: "12px",
                borderRadius: "12px",
                background: "rgba(255,255,255,0.06)",
              }}
            >
              <span
                style={{ fontSize: "16px", lineHeight: 1, minWidth: "20px" }}
              >
                {item.source_icon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 700,
                    color: "#e2e8f0",
                    lineHeight: 1.3,
                    marginBottom: "3px",
                  }}
                >
                  {(item.full_id || item.title).slice(0, 60)}
                  {(item.full_id || item.title).length > 60 ? "…" : ""}
                </div>
                {item.desc && (
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: "#64748b",
                      lineHeight: 1.4,
                    }}
                  >
                    {item.desc.slice(0, 80)}
                    {item.desc.length > 80 ? "…" : ""}
                  </div>
                )}
              </div>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#6366f1",
                  minWidth: "18px",
                  textAlign: "right",
                }}
              >
                #{i + 1}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: "16px",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            paddingTop: "12px",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: "10px", color: "#475569" }}>
            AI Media Agent · ai-news
          </span>
          <span style={{ fontSize: "10px", color: "#6366f1" }}>
            {lang === "en"
              ? "HuggingFace · GitHub · X"
              : "HuggingFace · GitHub · X"}
          </span>
        </div>
      </div>
      <button
        onClick={handleDownload}
        className="self-start flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" />
        </svg>
        {lang === "en" ? "Download" : "下载图片"}
      </button>
    </div>
  );
}

// ─── Result Modal ─────────────────────────────────────────────────────────────

function ResultModal({
  result,
  onClose,
  onRetry,
}: {
  result: GenResult;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  // Tick elapsed seconds while loading
  useEffect(() => {
    if (result.status !== "loading") return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [result.status]);

  // Escape key to close (unless loading)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && result.status !== "loading") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [result.status, onClose]);

  const titles: Record<GenType, string> = {
    card: "🃏 信息卡片",
    poster: "🎨 AI 生成海报",
    newscard: "📋 资讯列表图片",
    video: "🎬 AI 生成视频",
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl card-surface rounded-2xl border border-[color:var(--separator-subtle)] shadow-2xl p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-[color:var(--foreground)]">
            {titles[result.type]}
          </h3>
          <button
            onClick={onClose}
            disabled={result.status === "loading"}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[color:var(--nav-active-fill)] text-[color:var(--label-secondary)] transition-colors disabled:opacity-30"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {result.status === "loading" && (
          <div className="flex flex-col items-center gap-4 py-16">
            <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
            <p className="text-[color:var(--label-secondary)] text-sm font-medium">
              {result.type === "video"
                ? "视频生成中，大约需要 3~10 分钟…"
                : "海报生成中，请稍候…"}
            </p>
            {elapsed > 0 && (
              <p className="text-[color:var(--label-secondary)] text-xs opacity-70 tabular-nums">
                已等待 {elapsed} 秒
                {result.type === "video" && elapsed < 90
                  ? ` · ${90 - elapsed} 秒后转后台`
                  : ""}
              </p>
            )}
            {result.type === "video" && (
              <p className="text-[color:var(--label-secondary)] text-xs opacity-50 text-center max-w-xs">
                视频生成耗时较长，90 秒后将自动切换到后台运行，您可继续操作
              </p>
            )}
          </div>
        )}

        {result.status === "background" && (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="text-5xl">🎬</span>
            <p className="text-[color:var(--foreground)] font-bold text-base">
              视频正在后台生成中
            </p>
            <p className="text-[color:var(--label-secondary)] text-sm max-w-xs leading-relaxed">
              视频生成通常需要 3~10 分钟。您可以关闭此对话框继续浏览，完成后请到
              <strong className="text-indigo-500"> 历史记录 </strong>
              查看结果。
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
            >
              关闭，继续浏览
            </button>
          </div>
        )}

        {result.status === "error" && (
          <div className="flex flex-col items-center gap-3 py-12">
            <span className="text-4xl">⚠️</span>
            <p className="text-red-500 text-sm font-medium text-center max-w-xs">
              {result.error}
            </p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-1 px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
              >
                重试
              </button>
            )}
          </div>
        )}

        {result.status === "done" &&
          result.type === "card" &&
          result.cardItems && (
            <InfoCardGallery items={result.cardItems} lang={result.lang} />
          )}

        {result.status === "done" &&
          result.type === "newscard" &&
          result.cardItems && (
            <NewsListCardPreview items={result.cardItems} lang={result.lang} />
          )}

        {result.status === "done" &&
          result.type === "poster" &&
          result.imageUrl && (
            <div className="flex flex-col gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.imageUrl}
                alt="AI 生成海报"
                className="w-full rounded-xl border border-[color:var(--separator-subtle)]"
              />
              <a
                href={result.imageUrl}
                download={result.imageUrl.split("/").pop() || "ai-poster.png"}
                target="_blank"
                rel="noreferrer"
                className="self-start flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" />
                </svg>
                下载海报
              </a>
            </div>
          )}

        {result.status === "done" &&
          result.type === "video" &&
          result.videoUrl && (
            <div className="flex flex-col gap-4">
              <video
                controls
                autoPlay
                muted
                playsInline
                className="w-full rounded-xl border border-[color:var(--separator-subtle)]"
                src={result.videoUrl}
              >
                您的浏览器不支持 video 标签
              </video>
              <a
                href={result.videoUrl}
                download={result.videoUrl.split("/").pop() || "ai-video.mp4"}
                target="_blank"
                rel="noreferrer"
                className="self-start flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" />
                </svg>
                下载视频
              </a>
            </div>
          )}
      </div>
    </div>
  );
}

// ─── Selection Toolbar ────────────────────────────────────────────────────────

const BUTTON_DEFS: {
  type: GenType;
  label: string;
  emoji: string;
  genLabel: string;
}[] = [
  { type: "card", label: "信息卡片", emoji: "🃏", genLabel: "生成卡片" },
  { type: "newscard", label: "列表图片", emoji: "📋", genLabel: "生成图片" },
  { type: "poster", label: "AI 海报", emoji: "🎨", genLabel: "生成海报" },
  { type: "video", label: "生成视频", emoji: "🎬", genLabel: "生成视频" },
];

const PROMPT_PLACEHOLDERS: Record<GenType, string> = {
  card: "补充卡片风格要求，例：简洁明了、突出数字、暗色风格…",
  newscard: "补充列表图片要求，例：杂志排版、色彩丰富、简约黑白…",
  poster: "补充创意要求，例：突出科技感、加入霓虹边框、使用极简版式…",
  video: "补充视频风格要求，例：赛博朋克、手绘动画、慢镜特效…",
};

function SelectionToolbar({
  count,
  generating,
  onClear,
  onGenerate,
  genConfigs,
  onConfigChange,
  genBgPreviews,
  onBgImageChange,
}: {
  count: number;
  generating: boolean;
  onClear: () => void;
  onGenerate: (t: GenType) => void;
  genConfigs: Record<GenType, GenConfig>;
  onConfigChange: (t: GenType, c: GenConfig) => void;
  genBgPreviews: Record<GenType, string | null>;
  onBgImageChange: (
    t: GenType,
    file: File | null,
    preview: string | null,
  ) => void;
}) {
  const [activeSettings, setActiveSettings] = useState<GenType | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeSettings) return;
    const handler = (e: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      )
        setActiveSettings(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activeSettings]);

  if (count === 0) return null;

  const toggleSettings = (type: GenType) =>
    setActiveSettings((v) => (v === type ? null : type));

  const currentPosterStyle =
    POSTER_STYLES.find((s) => s.id === genConfigs.poster.style) ||
    POSTER_STYLES[0];

  return (
    <div
      ref={settingsRef}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2"
    >
      {/* Shared hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (!activeSettings) return;
          const file = e.target.files?.[0] ?? null;
          if (file) {
            onBgImageChange(activeSettings, file, URL.createObjectURL(file));
          } else {
            onBgImageChange(activeSettings, null, null);
          }
          e.target.value = "";
        }}
      />

      {/* Settings popover (renders for whichever type is active) */}
      {activeSettings &&
        (() => {
          const t = activeSettings;
          const cfg = genConfigs[t];
          const bgPreview = genBgPreviews[t];
          const def = BUTTON_DEFS.find((b) => b.type === t)!;
          return (
            <div
              className="popover-surface rounded-2xl p-5 flex flex-col gap-4 max-h-[72vh] overflow-y-auto"
              style={{ width: "320px" }}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[color:var(--foreground)]">
                  {def.emoji} {def.label} 设置
                </span>
                <button
                  onClick={() => setActiveSettings(null)}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[color:var(--label-secondary)] hover:bg-[color:var(--separator-subtle)] transition-colors text-sm"
                >
                  ✕
                </button>
              </div>

              {/* Language toggle */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[color:var(--label-secondary)] uppercase tracking-wide">
                  输出语言
                </label>
                <div className="flex gap-1 p-1 rounded-xl bg-[color:var(--separator-subtle)]">
                  {(["zh", "en"] as const).map((l) => (
                    <button
                      key={l}
                      onClick={() => onConfigChange(t, { ...cfg, lang: l })}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        cfg.lang === l
                          ? "bg-[color:var(--card-bg)] text-[color:var(--foreground)] shadow-sm"
                          : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                      }`}
                    >
                      {l === "zh" ? "🇨🇳 中文" : "🇺🇸 English"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom prompt */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[color:var(--label-secondary)] uppercase tracking-wide">
                  自定义提示词
                </label>
                <textarea
                  value={cfg.customPrompt}
                  onChange={(e) =>
                    onConfigChange(t, { ...cfg, customPrompt: e.target.value })
                  }
                  placeholder={PROMPT_PLACEHOLDERS[t]}
                  rows={2}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[color:var(--separator)] bg-[color:var(--card-bg)] text-[color:var(--foreground)] placeholder:text-[color:var(--placeholder-foreground)] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 resize-none leading-relaxed transition-colors"
                />
              </div>

              {/* Poster-only: style presets + bg hint */}
              {t === "poster" && (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-[color:var(--label-secondary)] uppercase tracking-wide">
                      海报风格
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {POSTER_STYLES.map((s) => (
                        <button
                          key={s.id}
                          onClick={() =>
                            onConfigChange("poster", { ...cfg, style: s.id })
                          }
                          className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                            cfg.style === s.id
                              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 shadow-sm"
                              : "border-[color:var(--separator-subtle)] hover:border-[color:var(--separator)] hover:bg-[color:var(--separator-subtle)]"
                          }`}
                        >
                          <div
                            className="relative w-full h-12 rounded-lg shadow-sm overflow-hidden"
                            style={{ background: s.preview }}
                          >
                            <StylePatternOverlay id={s.id} />
                          </div>
                          <span className="text-[11px] font-semibold text-[color:var(--foreground)]">
                            {s.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[color:var(--label-secondary)] uppercase tracking-wide">
                      背景描述（可选）
                    </label>
                    <input
                      type="text"
                      value={cfg.bgHint}
                      onChange={(e) =>
                        onConfigChange("poster", {
                          ...cfg,
                          bgHint: e.target.value,
                        })
                      }
                      placeholder="例：夜晚城市天际线、抽象水彩、樱花…"
                      className="w-full px-3 py-2 text-sm rounded-xl border border-[color:var(--separator)] bg-[color:var(--card-bg)] text-[color:var(--foreground)] placeholder:text-[color:var(--placeholder-foreground)] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-colors"
                    />
                  </div>
                </>
              )}

              {/* Reference image upload (all types) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[color:var(--label-secondary)] uppercase tracking-wide">
                  {t === "poster" ? "背景图片（可选）" : "参考图片（可选）"}
                </label>
                {bgPreview ? (
                  <div className="flex items-center gap-3">
                    <div
                      className="relative rounded-xl overflow-hidden flex-shrink-0"
                      style={{ width: "72px", height: "52px" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={bgPreview}
                        alt="preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors text-left"
                      >
                        更换图片
                      </button>
                      <button
                        onClick={() => onBgImageChange(t, null, null)}
                        className="text-xs text-[color:var(--label-secondary)] hover:text-red-500 transition-colors text-left"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-3 rounded-xl border border-dashed border-[color:var(--separator)] text-sm text-[color:var(--label-secondary)] hover:border-indigo-500 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all flex items-center justify-center gap-2"
                  >
                    <span>🖼️</span> 点击上传图片
                  </button>
                )}
              </div>

              <div className="border-t border-[color:var(--separator-subtle)]" />

              <button
                disabled={generating}
                onClick={() => {
                  setActiveSettings(null);
                  onGenerate(t);
                }}
                className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 shadow-sm"
              >
                {def.genLabel}
              </button>
            </div>
          );
        })()}

      {/* Main toolbar */}
      <div
        className="flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl border border-white/10 backdrop-blur-md"
        style={{ background: "rgba(15,23,42,0.92)" }}
      >
        <div className="flex items-center gap-2 pr-3 border-r border-white/20">
          <span className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-[11px] font-black text-white">
            {count}
          </span>
          <span className="text-[13px] font-semibold text-white">已选</span>
        </div>

        {BUTTON_DEFS.map(({ type, label, emoji }) => {
          const displayEmoji =
            type === "poster" ? currentPosterStyle.emoji : emoji;
          const isActive = activeSettings === type;
          return (
            <div
              key={type}
              className="flex items-center rounded-xl overflow-hidden border border-white/15"
            >
              <button
                disabled={generating}
                onClick={() => onGenerate(type)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
              >
                <span>{displayEmoji}</span> {label}
              </button>
              <button
                onClick={() => toggleSettings(type)}
                className={`px-2 py-1.5 text-[11px] border-l border-white/15 transition-colors ${
                  isActive
                    ? "bg-indigo-500/40 text-indigo-300"
                    : "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white"
                }`}
                title={`${label}设置`}
              >
                ⚙
              </button>
            </div>
          );
        })}

        <button
          onClick={onClear}
          className="ml-1 pl-3 border-l border-white/20 text-[12px] text-white/50 hover:text-white transition-colors"
        >
          清除
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AiNewsPage() {
  const router = useRouter();
  const [data, setData] = useState<AiTrendingData | null>(null);
  const [financeData, setFinanceData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState(TABS[0].key);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [genResult, setGenResult] = useState<GenResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genConfigs, setGenConfigs] = useState<Record<GenType, GenConfig>>({
    card: { customPrompt: "", lang: "zh", style: "botanical", bgHint: "" },
    newscard: { customPrompt: "", lang: "zh", style: "botanical", bgHint: "" },
    poster: { customPrompt: "", lang: "zh", style: "botanical", bgHint: "" },
    video: { customPrompt: "", lang: "zh", style: "botanical", bgHint: "" },
  });
  const [genBgFiles, setGenBgFiles] = useState<Record<GenType, File | null>>({
    card: null,
    newscard: null,
    poster: null,
    video: null,
  });
  const [genBgPreviews, setGenBgPreviews] = useState<
    Record<GenType, string | null>
  >({
    card: null,
    newscard: null,
    poster: null,
    video: null,
  });

  const updateGenConfig = (type: GenType, cfg: GenConfig) =>
    setGenConfigs((prev) => ({ ...prev, [type]: cfg }));

  const updateGenBgImage = (
    type: GenType,
    file: File | null,
    preview: string | null,
  ) => {
    setGenBgFiles((prev) => ({ ...prev, [type]: file }));
    setGenBgPreviews((prev) => {
      if (prev[type]) URL.revokeObjectURL(prev[type]!);
      return { ...prev, [type]: preview };
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/trending/ai");
      setData(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFinance = useCallback(async () => {
    setFinanceLoading(true);
    try {
      const res = await fetch("/api/trending/finance");
      const json = await res.json();
      if (!json.error) setFinanceData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setFinanceLoading(false);
    }
  }, []);

  const refresh = async () => {
    if (currentTab.source === "finance") {
      setRefreshing(true);
      try {
        const res = await fetch("/api/trending/finance/refresh", {
          method: "POST",
        });
        const json = await res.json();
        if (json.success && json.data) setFinanceData(json.data);
        else await loadFinance();
      } catch (e) {
        console.error(e);
      } finally {
        setRefreshing(false);
      }
      return;
    }
    setRefreshing(true);
    try {
      const res = await fetch("/api/trending/ai/refresh", { method: "POST" });
      const json = await res.json();
      if (json.success && json.data) setData(json.data);
      else await load();
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const currentTab = TABS.find((t) => t.key === activeTab) || TABS[0];

  // Lazy-load finance data on first finance tab visit
  useEffect(() => {
    if (currentTab.source === "finance" && !financeData && !financeLoading) {
      loadFinance();
    }
  }, [currentTab.source, financeData, financeLoading, loadFinance]);

  let items: TrendItem[] = [];
  if (currentTab.source === "finance" && financeData && currentTab.sub) {
    items = (financeData as Record<string, TrendItem[]>)[currentTab.sub] || [];
  } else if (data) {
    if (currentTab.source === "huggingface" && currentTab.sub) {
      items =
        (data.huggingface as Record<string, TrendItem[]>)?.[currentTab.sub] ||
        [];
    } else if (currentTab.source === "github") {
      items = data.github || [];
    } else if (currentTab.source === "x_ai") {
      items = data.x_ai || [];
    }
  }

  const toggleItem = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const clearSelection = () => setSelected(new Set());

  const isAllSelected =
    items.length > 0 && items.every((it) => selected.has(it.id));
  const selectAll = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      items.forEach((it) => n.add(it.id));
      return n;
    });
  const deselectAll = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      items.forEach((it) => n.delete(it.id));
      return n;
    });

  const allItems: TrendItem[] = [
    ...(data?.huggingface?.models || []),
    ...(data?.huggingface?.datasets || []),
    ...(data?.huggingface?.spaces || []),
    ...(data?.github || []),
    ...(data?.x_ai || []),
    ...(financeData?.bloomberg || []),
    ...(financeData?.reuters_news || []),
    ...(financeData?.reuters || []),
    ...(financeData?.wind || []),
  ];
  const selectedItems = allItems.filter((it) => selected.has(it.id));

  const buildPrompt = (type: GenType) => {
    const cfg = genConfigs[type];
    const en = cfg.lang === "en";
    const names = selectedItems
      .map((it) => it.full_id || it.title)
      .join(en ? ", " : "、");
    const descs = selectedItems
      .filter((it) => it.desc)
      .map((it) => `${it.full_id || it.title}: ${it.desc}`)
      .join("; ");
    const getSectionLabel = (it: TrendItem) => {
      if (it.source === "HuggingFace") {
        if (it.category === "Model") return "🤗 HF Models";
        if (it.category === "Dataset") return "📦 HF Datasets";
        if (it.category === "Space") return "🚀 HF Spaces";
      }
      if (it.source === "GitHub") return "⭐ GitHub AI";
      if (it.source === "x_ai") return "𝕏 AI 热点";
      return it.category || it.source;
    };
    const groups: Record<string, TrendItem[]> = {};
    selectedItems.forEach((it) => {
      const label = getSectionLabel(it);
      if (!groups[label]) groups[label] = [];
      groups[label].push(it);
    });
    const itemsWithCategory = Object.entries(groups)
      .map(([label, items]) => {
        const lines = items.map((it) => `- ${it.full_id || it.title}`).join("\n");
        return `${label}:\n${lines}`;
      })
      .join("\n\n");
    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const customExtra = cfg.customPrompt.trim()
      ? en
        ? `\nAdditional instructions: ${cfg.customPrompt.trim()}`
        : `\n额外要求：${cfg.customPrompt.trim()}`
      : "";
    if (type === "poster") {
      const stylePreset =
        POSTER_STYLES.find((s) => s.id === cfg.style) || POSTER_STYLES[0];
      const bgExtra = cfg.bgHint.trim()
        ? ` Background: ${cfg.bgHint.trim()}.`
        : "";
      if (en) {
        return `Design an AI news poster. Layout requirements:
- Main title (large): "Today's AI Highlights"
- Subtitle: "AI Daily Digest"
- Date: ${today}
- Content: Group and display the following model/project names by platform section. Use the section headings exactly as provided (keep names verbatim):
${itemsWithCategory}
${descs ? "- Short description per item: " + descs : ""}
- Footer: "AI Editorial · For reference only"
Style: ${stylePreset.promptHint}.${bgExtra}${customExtra}
Do NOT translate project names.`;
      }
      return `设计一张 AI 资讯海报。版式要求：
- 主标题（中文大字）：「今日 AI 热点」
- 副标题（中文）：「AI 资讯日报」
- 日期栏直接显示：${today}（保持英文数字原样，不要翻译）
- 内容区：按平台分组展示以下模型/项目，每组保留提供的分组标题，名称保持原文不翻译：
${itemsWithCategory}
${descs ? "- 每项附带简短描述（原文）：" + descs : ""}
- 底部署名（中文）：「AI 编辑部 · 仅供参考」
风格：${stylePreset.promptHint}.${bgExtra}${customExtra}
禁止：不要把项目名称翻译成中文。`;
    }
    if (type === "video") {
      if (en)
        return `Create a short AI tech news video showcasing today's AI highlights: ${names}. High-tech aesthetic, dark background, text animations, data-stream effects. Duration: 6 seconds, vertical 9:16.${descs ? " Content: " + descs : ""}${customExtra}`;
      return `生成一段 AI 科技资讯短视频，展示今日 AI 领域热点：${names}。科技感十足，深色背景，文字动画，数据流特效。时长 6 秒，竖版 9:16。${descs ? "内容：" + descs : ""}${customExtra}`;
    }
    return "";
  };

  const handleGenerate = async (type: GenType) => {
    if (!selectedItems.length) return;
    setGenerating(true);
    setGenResult({ type, status: "loading" });
    try {
      if (type === "card" || type === "newscard") {
        await new Promise((r) => setTimeout(r, 300));
        setGenResult({
          type,
          status: "done",
          cardItems: selectedItems,
          lang: genConfigs[type].lang,
        });
        return;
      }
      const endpoint =
        type === "poster" ? "/api/tools/image" : "/api/tools/video";

      // For video: after 90s switch to "background" state so user isn't stuck
      let bgTimer: ReturnType<typeof setTimeout> | null = null;
      if (type === "video") {
        bgTimer = setTimeout(() => {
          setGenResult((prev) =>
            prev?.status === "loading"
              ? { ...prev, status: "background" }
              : prev,
          );
          setGenerating(false);
        }, 90_000);
      }

      // Upload context/reference image if provided (any type)
      let referenceImageUrl = "";
      const bgFile = genBgFiles[type];
      if (bgFile) {
        try {
          const fd = new FormData();
          fd.append("file", bgFile);
          const upRes = await fetch("/api/tools/upload-bg", {
            method: "POST",
            body: fd,
          });
          if (upRes.ok) {
            const upData = await upRes.json();
            referenceImageUrl = upData.url || "";
          }
        } catch {
          // Non-fatal: proceed without reference image
        }
      }

      let res: Response;
      try {
        const reqBody: Record<string, string> = { prompt: buildPrompt(type) };
        if (referenceImageUrl) reqBody.reference_image_url = referenceImageUrl;
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
      } finally {
        if (bgTimer) clearTimeout(bgTimer);
      }

      const json = await res.json();
      // For video, only accept URLs with a real video extension to avoid
      // accidentally using the long result-text as a src.
      const rawVideoUrl: string = json.video_url || "";
      const validVideoUrl = /\.(?:mp4|webm|mov)$/i.test(rawVideoUrl)
        ? rawVideoUrl
        : "";
      const url =
        type === "video"
          ? validVideoUrl
          : json.image_url || json.url || json.result || "";
      if (!url || typeof url !== "string" || url.startsWith("生成失败")) {
        setGenResult({
          type,
          status: "error",
          error:
            json.error ||
            (json.result && !json.result.startsWith("✅")
              ? json.result
              : null) ||
            "生成失败，未能获取视频链接",
        });
      } else {
        setGenResult(
          type === "poster"
            ? { type, status: "done", imageUrl: url }
            : { type, status: "done", videoUrl: url },
        );
      }
    } catch (e: unknown) {
      // If we already moved to "background" state, ignore fetch errors silently
      setGenResult((prev) => {
        if (prev?.status === "background") return prev;
        return {
          type,
          status: "error",
          error: e instanceof Error ? e.message : "未知错误",
        };
      });
    } finally {
      setGenerating(false);
    }
  };

  const isLoading =
    loading ||
    refreshing ||
    (currentTab.source === "finance" && financeLoading);

  return (
    <>
      <div className="h-full overflow-y-auto page-canvas px-6 py-8 pb-24">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.back()}
                className="flex items-center justify-center w-8 h-8 rounded-xl text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] transition-colors shrink-0"
                aria-label="返回"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div>
                <h1 className="text-2xl font-black text-[color:var(--foreground)] tracking-tight">
                  🤖 AI 资讯热榜
                </h1>
                <p className="text-[color:var(--label-secondary)] text-sm mt-1">
                  HuggingFace · GitHub · X · Bloomberg · 路透社 — 实时热点 ·{" "}
                  <span className="text-indigo-500 font-medium">
                    点击卡片多选，生成信息卡片 / 列表图片 / AI海报 / 视频
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {data?.fetched_at && currentTab.source !== "finance" && (
                <span className="text-xs text-[color:var(--label-secondary)] font-medium hidden sm:block">
                  更新于 {formatDate(data.fetched_at)}
                </span>
              )}
              {financeData?.fetched_at && currentTab.source === "finance" && (
                <span className="text-xs text-[color:var(--label-secondary)] font-medium hidden sm:block">
                  更新于 {formatDate(financeData.fetched_at)}
                </span>
              )}
              <button
                onClick={refresh}
                disabled={isLoading || currentTab.source === "research"}
                className="flex items-center gap-1.5 text-sm px-4 py-2 card-surface text-[color:var(--label-secondary)] font-semibold rounded-xl border border-[color:var(--separator-subtle)] shadow-sm transition-all active:scale-95 disabled:opacity-50 hover:text-[color:var(--foreground)]"
              >
                <svg
                  className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
                刷新数据
              </button>
            </div>
          </div>

          {/* Market quotes ticker — finance tabs only */}
          {currentTab.source === "finance" &&
          financeData?.market_quotes?.length ? (
            <MarketQuotesTicker quotes={financeData.market_quotes} />
          ) : null}

          {/* Badges row */}
          {currentTab.source !== "research" && (
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {currentTab.source === "finance"
              ? [
                  "📊 Bloomberg",
                  "📰 路透社",
                  "🌐 Yahoo/CNBC",
                  "🇳 东方财富",
                ].map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-600 bg-amber-50 border border-amber-100 px-3 py-1 rounded-full"
                  >
                    {label}
                  </span>
                ))
              : ["🤗 HuggingFace", "⭐ GitHub Trending", "𝕏 X / AI News"].map(
                  (label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-100 px-3 py-1 rounded-full"
                    >
                      {label}
                    </span>
                  ),
                )}
            {selected.size > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-full animate-in fade-in duration-200">
                ✓ 已选 {selected.size} 条 · 可生成卡片 / 列表图片 / AI海报 /
                视频
              </span>
            )}
          </div>
          )}

          {/* Tabs + 全选 */}
          <div className="flex items-center gap-1.5 mb-6 flex-wrap">
            {TABS.filter((t) => t.source !== "finance").map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === tab.key
                    ? "bg-[color:var(--foreground)] text-[color:var(--shell-bg)] shadow-sm"
                    : "card-surface text-[color:var(--label-secondary)] border border-[color:var(--separator-subtle)] hover:border-[color:var(--separator)] hover:text-[color:var(--foreground)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
            {items.length > 0 && currentTab.source !== "research" && (
              <button
                onClick={isAllSelected ? deselectAll : selectAll}
                className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all card-surface border border-[color:var(--separator-subtle)] text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] hover:border-[color:var(--separator)]"
              >
                <span
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center text-[9px] font-black transition-colors shrink-0 ${
                    isAllSelected
                      ? "border-indigo-500 bg-indigo-500 text-white"
                      : "border-current"
                  }`}
                >
                  {isAllSelected && "✓"}
                </span>
                {isAllSelected ? "取消全选" : `全选当前 (${items.length})`}
              </button>
            )}
          </div>

          {currentTab.source === "research" ? (
            <TopicResearchTab />
          ) : (
          <>
          {/* Section heading with platform name */}
          {items.length > 0 && (
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-base font-bold text-[color:var(--foreground)] tracking-tight">
                {currentTab.label}
                <span className="ml-2 text-xs font-semibold text-[color:var(--label-secondary)] bg-[var(--nav-active-fill)] px-2 py-0.5 rounded-full">
                  TOP {items.length}
                </span>
              </h2>
            </div>
          )}

          {/* Grid */}
          <div className="card-surface rounded-2xl border border-[color:var(--separator-subtle)] shadow-sm min-h-[500px] p-6">
            {isLoading && !data ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-[color:var(--label-secondary)] gap-3">
                <span className="text-5xl">🔭</span>
                <p className="font-medium text-sm">
                  暂无数据，请点击「刷新数据」抓取最新热榜
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {items.slice(0, 20).map((item, idx) => {
                  const rank = idx + 1;
                  const isSel = selected.has(item.id);
                  const toggle = () => toggleItem(item.id);
                  if (currentTab.source === "github")
                    return (
                      <GithubCard
                        key={item.id}
                        item={item}
                        rank={rank}
                        selected={isSel}
                        onToggle={toggle}
                      />
                    );
                  if (currentTab.source === "x_ai")
                    return (
                      <XNewsCard
                        key={item.id}
                        item={item}
                        rank={rank}
                        selected={isSel}
                        onToggle={toggle}
                      />
                    );
                  if (currentTab.source === "finance")
                    return (
                      <FinNewsCard
                        key={item.id}
                        item={item}
                        rank={rank}
                        selected={isSel}
                        onToggle={toggle}
                      />
                    );
                  return (
                    <HFCard
                      key={item.id}
                      item={item}
                      rank={rank}
                      selected={isSel}
                      onToggle={toggle}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {(data || financeData) && !isLoading && (
            <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-[color:var(--label-secondary)]">
              {data && (
                <>
                  <span>
                    🤗 Models: {data.huggingface?.models?.length ?? 0}
                  </span>
                  <span>
                    📦 Datasets: {data.huggingface?.datasets?.length ?? 0}
                  </span>
                  <span>
                    🚀 Spaces: {data.huggingface?.spaces?.length ?? 0}
                  </span>
                  <span>⭐ GitHub AI: {data.github?.length ?? 0}</span>
                  <span>𝕏 AI News: {data.x_ai?.length ?? 0}</span>
                </>
              )}
              {financeData && (
                <>
                  <span>
                    📊 Bloomberg: {financeData.bloomberg?.length ?? 0}
                  </span>
                  <span>
                    📰 路透社: {financeData.reuters_news?.length ?? 0}
                  </span>
                  <span>🌐 国际财经: {financeData.reuters?.length ?? 0}</span>
                  <span>🇳 A股公告: {financeData.wind?.length ?? 0}</span>
                </>
              )}
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {/* Floating toolbar */}
      <SelectionToolbar
        count={selected.size}
        generating={generating}
        onClear={clearSelection}
        onGenerate={handleGenerate}
        genConfigs={genConfigs}
        onConfigChange={updateGenConfig}
        genBgPreviews={genBgPreviews}
        onBgImageChange={updateGenBgImage}
      />

      {/* Result modal */}
      {genResult && (
        <ResultModal
          result={genResult}
          onClose={() => {
            if (genResult.status !== "loading") setGenResult(null);
          }}
          onRetry={() => handleGenerate(genResult.type)}
        />
      )}
    </>
  );
}
