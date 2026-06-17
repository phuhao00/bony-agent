"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NewsItem {
  id: string;
  source: string;
  source_icon: string;
  category: string;
  title: string;
  desc?: string;
  url?: string;
  published_at?: string;
  stock_code?: string;
  stock_name?: string;
}

interface MarketQuote {
  id: string;
  name: string;
  price: string | number;
  change_pct: number | string;
  change_val: number | string;
  currency: string;
  arrow: string;
  color: string;
}

interface FinancialData {
  fetched_at?: string;
  bloomberg?: NewsItem[];
  reuters_news?: NewsItem[];
  reuters?: NewsItem[];
  wind?: NewsItem[];
  market_quotes?: MarketQuote[];
  meta?: {
    bloomberg_count: number;
    reuters_news_count: number;
    reuters_count: number;
    wind_count: number;
  };
}

// ─── Gen types ────────────────────────────────────────────────────────────────

type GenType = "card" | "poster" | "newscard" | "video";

interface GenResult {
  type: GenType;
  status: "loading" | "background" | "done" | "error";
  imageUrl?: string;
  videoUrl?: string;
  cardItems?: NewsItem[];
  error?: string;
}

interface GenConfig {
  customPrompt: string;
  style: string;
  bgHint: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

const BUTTON_DEFS: {
  type: GenType;
  label: string;
  emoji: string;
  genLabel: string;
}[] = [
  { type: "card", label: "信息卡片", emoji: "🃏", genLabel: "生成信息卡片" },
  {
    type: "newscard",
    label: "列表图片",
    emoji: "📋",
    genLabel: "生成列表图片",
  },
  { type: "poster", label: "AI海报", emoji: "🎨", genLabel: "生成海报" },
  { type: "video", label: "AI视频", emoji: "🎬", genLabel: "生成视频" },
];

const PROMPT_PLACEHOLDERS: Record<GenType, string> = {
  card: "例：深色背景，金融主题，高端商务风格",
  newscard: "例：极简风格，蓝色调，新闻列表排版",
  poster: "例：金融数据可视化，蓝绿渐变，现代感",
  video: "例：K线图动画，财经播报风格",
};

const TABS = [
  { key: "market", label: "📈 行情总览", description: "全球主要指数实时行情" },
  { key: "bloomberg", label: "📊 彭博社", description: "Bloomberg 财经资讯" },
  {
    key: "reuters_news",
    label: "📰 路透社",
    description: "Reuters 路透社实时资讯",
  },
  {
    key: "reuters",
    label: "🌐 国际财经",
    description: "Yahoo Finance · CNBC · MarketWatch",
  },
  { key: "wind", label: "🌬️ Wind/东财", description: "A股公告与财经快讯" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatDate(s: string | undefined) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return s;
  }
}

function formatChangeColor(color: string) {
  if (color === "green") return "text-emerald-500";
  if (color === "red") return "text-rose-500";
  return "text-slate-400";
}

// ─── Small components ─────────────────────────────────────────────────────────

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
        <ellipse
          cx="68"
          cy="36"
          rx="28"
          ry="13"
          fill="rgba(22,163,74,0.22)"
          transform="rotate(-40 68 36)"
        />
        <ellipse
          cx="14"
          cy="44"
          rx="18"
          ry="8"
          fill="rgba(22,163,74,0.18)"
          transform="rotate(35 14 44)"
        />
        <ellipse
          cx="42"
          cy="10"
          rx="15"
          ry="6"
          fill="rgba(16,185,129,0.25)"
          transform="rotate(-18 42 10)"
        />
        <ellipse
          cx="70"
          cy="14"
          rx="10"
          ry="4.5"
          fill="rgba(52,211,153,0.22)"
          transform="rotate(28 70 14)"
        />
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
        <circle cx="28" cy="48" r="2.5" fill="rgba(22,163,74,0.3)" />
        <circle cx="55" cy="50" r="2" fill="rgba(16,185,129,0.25)" />
        <circle cx="74" cy="46" r="1.8" fill="rgba(52,211,153,0.22)" />
      </svg>
    );

  if (id === "minimal")
    return (
      <svg {...base}>
        <rect
          x="10"
          y="10"
          width="60"
          height="5"
          rx="2.5"
          fill="rgba(15,23,42,0.18)"
        />
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
        <line
          x1="10"
          y1="38"
          x2="70"
          y2="38"
          stroke="rgba(15,23,42,0.08)"
          strokeWidth="0.75"
        />
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
        <rect
          x="0"
          y="0"
          width="80"
          height="14"
          fill="rgba(255,255,255,0.09)"
        />
        <rect
          x="8"
          y="18"
          width="64"
          height="5"
          rx="1.5"
          fill="rgba(255,255,255,0.5)"
        />
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
        <circle cx="20" cy="13" r="1.5" fill="rgba(99,102,241,0.6)" />
        <circle cx="50" cy="39" r="1.5" fill="rgba(99,102,241,0.5)" />
        <circle cx="50" cy="13" r="1" fill="rgba(139,92,246,0.4)" />
      </svg>
    );

  if (id === "chinese")
    return (
      <svg {...base}>
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

function SelectOverlay({ selected }: { selected: boolean }) {
  return (
    <div
      className={`absolute top-2 right-2 z-20 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-150 ${
        selected
          ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] shadow-sm"
          : "border-[color:var(--separator)] bg-[color:var(--card-bg)]/80"
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

function InfoCardGallery({ items }: { items: NewsItem[] }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        <div
          key={`${item.id}-${i}`}
          className="rounded-xl border border-[color:var(--separator-subtle)] bg-[color:var(--card-bg)] p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[color:color-mix(in_srgb,var(--accent)_15%,transparent)] text-[color:var(--accent)]">
              {item.source}
            </span>
            {item.category && (
              <span className="text-[11px] text-[color:var(--label-secondary)]">
                {item.category}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-[color:var(--foreground)] leading-snug">
            {item.title}
          </p>
          {item.desc && (
            <p className="text-xs text-[color:var(--label-secondary)] mt-1 line-clamp-2">
              {stripHtml(item.desc)}
            </p>
          )}
          <p className="text-[11px] text-[color:var(--label-secondary)] mt-2">
            {formatDate(item.published_at)}
          </p>
        </div>
      ))}
    </div>
  );
}

function NewsListCardPreview({ items }: { items: NewsItem[] }) {
  return (
    <div className="rounded-2xl border border-[color:var(--separator-subtle)] bg-[color:var(--card-bg)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[color:var(--separator-subtle)]">
        <span className="text-xs font-bold text-[color:var(--foreground)] uppercase tracking-wide">
          金融资讯快报
        </span>
      </div>
      {items.map((item, i) => (
        <div
          key={`${item.id}-${i}`}
          className="flex items-start gap-3 px-4 py-3 border-b border-[color:var(--separator-subtle)] last:border-0"
        >
          <span className="text-[11px] font-black text-[color:var(--label-secondary)] w-4 shrink-0 mt-0.5">
            #{i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[color:var(--foreground)] line-clamp-2 leading-snug">
              {item.title}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-[color:var(--accent)]">
                {item.source}
              </span>
              <span className="text-[11px] text-[color:var(--label-secondary)]">
                {formatDate(item.published_at)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

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
  useEffect(() => {
    if (result.status !== "loading") return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [result.status]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && result.status !== "loading") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [result.status, onClose]);

  const titles: Record<GenType, string> = {
    card: "🃏 信息卡片",
    poster: "🎨 AI 海报",
    newscard: "📋 资讯列表图片",
    video: "🎬 AI 视频",
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
            <div className="w-10 h-10 border-4 border-[color:var(--separator)] border-t-[color:var(--foreground)] rounded-full animate-spin" />
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
          </div>
        )}

        {result.status === "background" && (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="text-5xl">🎬</span>
            <p className="text-[color:var(--foreground)] font-bold text-base">
              视频正在后台生成中
            </p>
            <p className="text-[color:var(--label-secondary)] text-sm max-w-xs leading-relaxed">
              完成后请到
              <strong className="text-[color:var(--accent)]"> 历史记录 </strong>
              查看结果。
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-5 py-2 bg-[color:var(--foreground)] text-[color:var(--shell-bg)] text-sm font-semibold rounded-xl hover:opacity-90 transition-all active:scale-95"
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
                className="mt-1 px-5 py-2 bg-[color:var(--foreground)] text-[color:var(--shell-bg)] text-sm font-semibold rounded-xl hover:opacity-90 transition-all active:scale-95"
              >
                重试
              </button>
            )}
          </div>
        )}

        {result.status === "done" &&
          result.type === "card" &&
          result.cardItems && <InfoCardGallery items={result.cardItems} />}
        {result.status === "done" &&
          result.type === "newscard" &&
          result.cardItems && <NewsListCardPreview items={result.cardItems} />}
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
                className="self-start flex items-center gap-2 px-4 py-2 bg-[color:var(--foreground)] text-[color:var(--shell-bg)] text-sm font-semibold rounded-xl hover:opacity-90 transition-all active:scale-95"
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
                className="self-start flex items-center gap-2 px-4 py-2 bg-[color:var(--foreground)] text-[color:var(--shell-bg)] text-sm font-semibold rounded-xl hover:opacity-90 transition-all active:scale-95"
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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (!activeSettings) return;
          const file = e.target.files?.[0] ?? null;
          if (file)
            onBgImageChange(activeSettings, file, URL.createObjectURL(file));
          else onBgImageChange(activeSettings, null, null);
          e.target.value = "";
        }}
      />

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
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[color:var(--separator)] bg-[color:var(--card-bg)] text-[color:var(--foreground)] placeholder:text-[color:var(--placeholder-foreground)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30 focus:border-[color:var(--accent)] resize-none leading-relaxed transition-colors"
                />
              </div>
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
                              ? "border-[color:var(--foreground)] bg-[color:var(--nav-active-fill)] shadow-sm"
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
                      placeholder="例：夜晚城市天际线、K线图、金融数据…"
                      className="w-full px-3 py-2 text-sm rounded-xl border border-[color:var(--separator)] bg-[color:var(--card-bg)] text-[color:var(--foreground)] placeholder:text-[color:var(--placeholder-foreground)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30 focus:border-[color:var(--accent)] transition-colors"
                    />
                  </div>
                </>
              )}
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
                        className="text-xs font-medium text-[color:var(--accent)] hover:opacity-80 transition-opacity text-left"
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
                    className="w-full py-3 rounded-xl border border-dashed border-[color:var(--separator)] text-sm text-[color:var(--label-secondary)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] hover:bg-[color:color-mix(in_srgb,var(--accent)_5%,transparent)] transition-all flex items-center justify-center gap-2"
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
                className="w-full py-2.5 rounded-xl bg-[color:var(--foreground)] text-[color:var(--shell-bg)] text-sm font-semibold hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 shadow-sm"
              >
                {def.genLabel}
              </button>
            </div>
          );
        })()}

      <div
        className="flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl border border-white/10 backdrop-blur-md"
        style={{ background: "rgba(15,23,42,0.92)" }}
      >
        <div className="flex items-center gap-2 pr-3 border-r border-white/20">
          <span className="w-6 h-6 rounded-full bg-[color:var(--foreground)] flex items-center justify-center text-[11px] font-black text-[color:var(--shell-bg)]">
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
                    ? "bg-[color:color-mix(in_srgb,var(--foreground)_25%,transparent)] text-white"
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

function SkeletonCard() {
  return <div className="rounded-2xl h-28 animate-pulse card-surface" />;
}

function NewsCard({
  item,
  rank,
  selected,
  onToggle,
}: {
  item: NewsItem;
  rank: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className={`group flex flex-col gap-2.5 p-4 rounded-2xl border cursor-pointer transition-all duration-200 ${
        selected
          ? "border-[color:var(--foreground)] bg-[color:var(--nav-active-fill)] shadow-md -translate-y-0.5"
          : "card-surface hover:border-[color:var(--accent)] hover:shadow-md hover:-translate-y-0.5"
      }`}
    >
      {/* Header: source + category + merged rank/select indicator */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[color:color-mix(in_srgb,var(--accent)_15%,transparent)] text-[color:var(--accent)] shrink-0">
          {item.source}
        </span>
        {item.category && (
          <span className="text-[11px] text-[color:var(--label-secondary)] truncate min-w-0">
            {item.category}
          </span>
        )}
        {/* Rank / selection — single indicator, no overlap */}
        <div
          className={`ml-auto shrink-0 w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all duration-150 ${
            selected
              ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] shadow-sm"
              : "border-[color:var(--separator)] bg-[color:var(--card-bg)]"
          }`}
        >
          {selected ? (
            <svg
              className="w-3 h-3 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <span className="text-[9px] font-bold leading-none text-[color:var(--label-secondary)]">
              {rank}
            </span>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold leading-snug text-[color:var(--foreground)] line-clamp-2 group-hover:text-[color:var(--accent)] transition-colors">
        {item.title || "（无标题）"}
      </h3>

      {/* Excerpt */}
      {item.desc && (
        <p className="text-xs text-[color:var(--label-secondary)] line-clamp-2 leading-relaxed">
          {stripHtml(item.desc)}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 mt-auto pt-1 border-t border-[color:var(--separator-subtle)]">
        {item.stock_name && (
          <span className="text-[11px] font-mono bg-[var(--nav-active-fill)] text-[color:var(--foreground)] px-1.5 py-0.5 rounded">
            {item.stock_code} · {item.stock_name}
          </span>
        )}
        <span className="text-[10px] text-[color:var(--label-secondary)]">
          {formatDate(item.published_at)}
        </span>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] text-[color:var(--accent)] hover:underline ml-auto flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            阅读原文{" "}
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

function MarketQuoteCard({ quote }: { quote: MarketQuote }) {
  const colorClass = formatChangeColor(quote.color);
  const changePct =
    typeof quote.change_pct === "number"
      ? quote.change_pct.toFixed(2)
      : quote.change_pct;
  const changeVal =
    typeof quote.change_val === "number"
      ? quote.change_val.toFixed(2)
      : quote.change_val;

  return (
    <div className="flex flex-col gap-1.5 p-4 rounded-2xl card-surface">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[color:var(--foreground)] leading-tight">
          {quote.name}
        </span>
        <span className="text-[11px] font-medium text-[color:var(--label-secondary)] bg-[var(--nav-active-fill)] px-1.5 py-0.5 rounded">
          {quote.currency}
        </span>
      </div>
      <span className="text-2xl font-black text-[color:var(--foreground)] tracking-tight tabular-nums">
        {quote.price}
      </span>
      <div
        className={`flex items-center gap-1.5 text-sm font-semibold ${colorClass}`}
      >
        <span>{quote.arrow}</span>
        <span>{changePct}%</span>
        <span className="text-xs font-normal opacity-70">({changeVal})</span>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FinancialNewsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("market");
  const [data, setData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(300); // seconds until next auto-refresh

  // ── Selection + generation state ──────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [genResult, setGenResult] = useState<GenResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genConfigs, setGenConfigs] = useState<Record<GenType, GenConfig>>({
    card: { customPrompt: "", style: "finance", bgHint: "" },
    newscard: { customPrompt: "", style: "finance", bgHint: "" },
    poster: { customPrompt: "", style: "finance", bgHint: "" },
    video: { customPrompt: "", style: "finance", bgHint: "" },
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

  const AUTO_REFRESH_INTERVAL = 300; // 5 minutes

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/financial-news", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/financial-news/refresh", {
        method: "POST",
        cache: "no-store",
      });
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    setCountdown(AUTO_REFRESH_INTERVAL);
    const tick = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          handleRefresh();
          return AUTO_REFRESH_INTERVAL;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const countdownLabel =
    countdown >= 60
      ? `${Math.floor(countdown / 60)}m${countdown % 60 > 0 ? `${countdown % 60}s` : ""}`
      : `${countdown}s`;

  const currentItems: NewsItem[] =
    activeTab === "bloomberg"
      ? (data?.bloomberg ?? [])
      : activeTab === "reuters_news"
        ? (data?.reuters_news ?? [])
        : activeTab === "reuters"
          ? (data?.reuters ?? [])
          : activeTab === "wind"
            ? (data?.wind ?? [])
            : [];

  const quotes = data?.market_quotes ?? [];

  // ── Selection helpers ──────────────────────────────────────────────────────
  const selectedItems = currentItems.filter((it) => selected.has(it.id));

  const toggleItem = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const clearSelection = () => setSelected(new Set());

  const isAllSelected =
    currentItems.length > 0 && currentItems.every((it) => selected.has(it.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelected((prev) => {
        const n = new Set(prev);
        currentItems.forEach((it) => n.delete(it.id));
        return n;
      });
    } else {
      setSelected((prev) => {
        const n = new Set(prev);
        currentItems.forEach((it) => n.add(it.id));
        return n;
      });
    }
  };

  const buildPrompt = (type: GenType): string => {
    const cfg = genConfigs[type];
    const getSectionLabel = (it: NewsItem) => {
      if (it.source === "Bloomberg") return "📊 彭博社";
      if (it.source === "Reuters") return "📰 路透社";
      if (["Yahoo Finance", "CNBC", "MarketWatch"].includes(it.source))
        return "🌐 国际财经";
      if (it.source === "Wind/东财") return "🌬️ Wind/东财";
      return it.source;
    };
    const groups: Record<string, NewsItem[]> = {};
    selectedItems.forEach((it) => {
      const label = getSectionLabel(it);
      if (!groups[label]) groups[label] = [];
      groups[label].push(it);
    });
    const headlines = Object.entries(groups)
      .map(([label, items]) => {
        const lines = items.map((it, i) => `${i + 1}. ${it.title}`).join("\n");
        return `${label}:\n${lines}`;
      })
      .join("\n\n");
    if (type === "card")
      return `生成一张金融资讯信息卡片，包含以下 ${selectedItems.length} 条资讯：\n${headlines}\n${cfg.customPrompt}`;
    if (type === "newscard")
      return `生成一张金融资讯列表图片，排版清晰，包含以下资讯：\n${headlines}\n${cfg.customPrompt}`;
    if (type === "poster") {
      const styleDesc =
        POSTER_STYLES.find((s) => s.id === cfg.style)?.label || cfg.style;
      return `生成一张${styleDesc}风格的金融资讯海报。按平台分组展示以下资讯，保留分组标题：\n${headlines}\n${cfg.bgHint ? `背景：${cfg.bgHint}\n` : ""}${cfg.customPrompt}`;
    }
    return `生成一段金融资讯视频，内容聚焦以下资讯：\n${headlines}\n${cfg.customPrompt}`;
  };

  const handleGenerate = async (type: GenType) => {
    if (!selectedItems.length) return;
    setGenerating(true);
    setGenResult({ type, status: "loading" });
    try {
      if (type === "card" || type === "newscard") {
        await new Promise((r) => setTimeout(r, 300));
        setGenResult({ type, status: "done", cardItems: selectedItems });
        return;
      }
      const endpoint =
        type === "poster" ? "/api/tools/image" : "/api/tools/video";
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
          /* non-fatal */
        }
      }
      let res!: Response;
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
          error: json.error || "生成失败，请重试",
        });
      } else {
        setGenResult(
          type === "poster"
            ? { type, status: "done", imageUrl: url }
            : { type, status: "done", videoUrl: url },
        );
      }
    } catch (e: unknown) {
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

  return (
    <div className="page-canvas min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[var(--background)]/90 backdrop-blur-md border-b border-[color:var(--separator-subtle)]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
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
            <div className="flex flex-col gap-0.5">
              <h1 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)]">
                📈 金融资讯
              </h1>
              <p className="text-xs text-[color:var(--label-secondary)]">
                彭博社 · 路透社 · Yahoo Finance · CNBC · Wind · 全球行情实时更新
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {data?.fetched_at && (
              <span className="hidden sm:flex items-center gap-2 text-[11px] text-[color:var(--label-secondary)]">
                更新于 {formatDate(data.fetched_at)}
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--nav-active-fill)] tabular-nums">
                  <svg
                    className="w-3 h-3 opacity-60"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  {countdownLabel}
                </span>
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold card-surface border border-[color:var(--separator-subtle)] text-[color:var(--foreground)] hover:border-[color:var(--separator)] hover:bg-[color:var(--nav-active-fill)] disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
            >
              <svg
                className={`w-3.5 h-3.5 ${refreshing || loading ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              {refreshing ? "刷新中" : "刷新"}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-6 flex gap-1 overflow-x-auto pb-px">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium rounded-t-xl transition-colors border-b-2 ${
                activeTab === tab.key
                  ? "text-[color:var(--accent)] border-[color:var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_8%,transparent)]"
                  : "text-[color:var(--label-secondary)] border-transparent hover:text-[color:var(--foreground)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {error && (
          <div
            className="mb-4 p-4 rounded-xl text-sm font-medium"
            style={{
              backgroundColor: "var(--status-danger-bg)",
              borderColor: "var(--status-danger-border)",
              color: "var(--status-danger-text)",
              border: "1px solid",
            }}
          >
            ⚠️ 加载失败：{error}
            <button onClick={loadData} className="ml-3 underline font-semibold">
              重试
            </button>
          </div>
        )}

        {/* Market Overview Tab */}
        {activeTab === "market" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-widest mb-3 text-[color:var(--label-secondary)]">
                全球主要指数
              </h2>
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <SkeletonCard key={i} />
                  ))}
                </div>
              ) : quotes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[color:var(--separator)] p-10 text-center text-[color:var(--label-secondary)] text-sm">
                  暂无行情数据，请点击刷新
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {quotes.map((q) => (
                    <MarketQuoteCard key={q.id} quote={q} />
                  ))}
                </div>
              )}
            </div>

            {/* Summary stats */}
            {data?.meta && !loading && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    label: "彭博社新闻",
                    count: data.meta.bloomberg_count,
                    dot: "bg-blue-500",
                    tab: "bloomberg",
                  },
                  {
                    label: "路透社",
                    count: data.meta.reuters_news_count,
                    dot: "bg-rose-500",
                    tab: "reuters_news",
                  },
                  {
                    label: "国际财经",
                    count: data.meta.reuters_count,
                    dot: "bg-purple-500",
                    tab: "reuters",
                  },
                  {
                    label: "Wind/东财",
                    count: data.meta.wind_count,
                    dot: "bg-emerald-500",
                    tab: "wind",
                  },
                ].map((s) => (
                  <button
                    key={s.tab}
                    onClick={() => setActiveTab(s.tab)}
                    className="flex flex-col items-center gap-2 p-5 rounded-2xl card-surface hover:border-[color:var(--accent)] hover:shadow-sm transition-all cursor-pointer group"
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
                    <span className="text-3xl font-black text-[color:var(--foreground)] tabular-nums">
                      {s.count}
                    </span>
                    <span className="text-xs font-medium text-[color:var(--label-secondary)] group-hover:text-[color:var(--accent)] transition-colors">
                      {s.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* News Tabs */}
        {activeTab !== "market" && (
          <div>
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 9 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : currentItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[color:var(--separator)] p-12 text-center text-[color:var(--label-secondary)]">
                <div className="text-4xl mb-3">
                  {TABS.find((t) => t.key === activeTab)?.label?.split(" ")[0]}
                </div>
                <p className="text-sm">暂无数据，请点击刷新获取最新资讯</p>
              </div>
            ) : (
              <>
                {/* Section heading with platform name */}
                <div className="flex items-center gap-2 mb-4 px-1">
                  <h2 className="text-base font-bold text-[color:var(--foreground)] tracking-tight">
                    {TABS.find((t) => t.key === activeTab)?.label ?? activeTab}
                    <span className="ml-2 text-xs font-semibold text-[color:var(--label-secondary)] bg-[var(--nav-active-fill)] px-2 py-0.5 rounded-full">
                      TOP {currentItems.length}
                    </span>
                  </h2>
                  <span className="text-[11px] text-[color:var(--label-secondary)] opacity-70">
                    {TABS.find((t) => t.key === activeTab)?.description}
                  </span>
                </div>
                <div className="flex items-center justify-between mb-3 px-1">
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center gap-2 text-xs font-semibold text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] transition-colors"
                  >
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                        isAllSelected
                          ? "border-[color:var(--foreground)] bg-[color:var(--foreground)]"
                          : "border-slate-300"
                      }`}
                    >
                      {isAllSelected && (
                        <svg
                          className="w-2.5 h-2.5 text-white"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                        >
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    {isAllSelected ? "取消全选" : "全选"}
                  </button>
                  <span className="text-xs text-[color:var(--label-secondary)]">
                    {selected.size > 0 ? (
                      <span className="text-[color:var(--accent)] font-medium">
                        已选 {selected.size} 条 · 点击底部工具栏生成海报/视频
                      </span>
                    ) : (
                      "点击卡片可多选，生成信息卡片 / 海报 / 视频"
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {currentItems.map((item, idx) => (
                    <NewsCard
                      key={`${item.id}-${idx}`}
                      item={item}
                      rank={idx + 1}
                      selected={selected.has(item.id)}
                      onToggle={() => toggleItem(item.id)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <SelectionToolbar
        count={selected.size}
        generating={generating}
        onClear={clearSelection}
        onGenerate={handleGenerate}
        genConfigs={genConfigs}
        onConfigChange={(t, c) =>
          setGenConfigs((prev) => ({ ...prev, [t]: c }))
        }
        genBgPreviews={genBgPreviews}
        onBgImageChange={(t, file, preview) => {
          setGenBgFiles((prev) => ({ ...prev, [t]: file }));
          setGenBgPreviews((prev) => ({ ...prev, [t]: preview }));
        }}
      />
      {genResult && (
        <ResultModal
          result={genResult}
          onClose={() => {
            setGenResult(null);
            setGenerating(false);
          }}
          onRetry={() => {
            if (genResult) handleGenerate(genResult.type);
          }}
        />
      )}
    </div>
  );
}
