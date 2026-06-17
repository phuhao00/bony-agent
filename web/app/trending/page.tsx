"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

const sources = [
  { key: "epic", label: "🎁 Epic 免费游戏" },
  { key: "steam_hot", label: "🎮 Steam 畅销榜" },
  { key: "steam_new", label: "✨ Steam 新品" },
  { key: "taptap", label: "🕹️ TapTap 热门" },
];

const AUTO_REFRESH_OPTIONS = [
  { label: "5 分钟", value: 5 * 60 },
  { label: "10 分钟", value: 10 * 60 },
  { label: "30 分钟", value: 30 * 60 },
];

export default function TrendingPage() {
  const router = useRouter();
  const [trending, setTrending] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("epic");

  // Auto-refresh state
  const [autoInterval, setAutoInterval] = useState<number | null>(null); // seconds, null = off
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadTrending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/trending/gaming");
      const data = await res.json();
      setTrending(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshTrending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/trending/gaming/refresh", {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) setTrending(data.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Start / stop auto-refresh
  useEffect(() => {
    // Clear previous timers
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (!autoInterval) {
      setCountdown(0);
      return;
    }

    setCountdown(autoInterval);

    // Countdown tick
    countdownRef.current = setInterval(() => {
      setCountdown((c) => (c <= 1 ? autoInterval : c - 1));
    }, 1000);

    // Auto-refresh trigger
    autoRefreshRef.current = setInterval(() => {
      refreshTrending();
      setCountdown(autoInterval);
    }, autoInterval * 1000);

    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoInterval, refreshTrending]);

  useEffect(() => {
    loadTrending();
  }, [loadTrending]);

  const switchTab = (key: string) => {
    setActiveTab(key);
    window.dispatchEvent(
      new CustomEvent("trigger-agent-workflow", {
        detail: { workflowId: `trending:${key}` },
      }),
    );
  };

  const activeItems: any[] = trending?.sources?.[activeTab] || [];

  return (
    <div className="h-full overflow-y-auto bg-[#f8fafc] px-6 py-8">
      <div className="max-w-6xl mx-auto">
        {/* ── Page Header ──────────────────────────────────────────── */}
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
              <h1 className="text-2xl font-black text-slate-800 tracking-tight">
                🔥 游戏热点风向标
              </h1>
              <p className="text-slate-400 text-sm mt-1">
                全网各大游戏平台实时热搜与内容趋势
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {trending?.fetched_at && (
              <span className="text-xs text-slate-400 font-medium hidden sm:block">
                更新于 {formatDate(trending.fetched_at)}
              </span>
            )}

            {/* Auto-refresh interval selector */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-1 py-1 shadow-sm">
              <span className="text-[10px] font-semibold text-slate-400 px-1.5 whitespace-nowrap">
                自动刷新
              </span>
              {AUTO_REFRESH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    setAutoInterval((v) => (v === opt.value ? null : opt.value))
                  }
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all ${
                    autoInterval === opt.value
                      ? "bg-indigo-500 text-white shadow-sm"
                      : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              {autoInterval && (
                <span className="text-[11px] font-mono text-indigo-500 pl-1 pr-1.5 tabular-nums whitespace-nowrap">
                  {Math.floor(countdown / 60)
                    .toString()
                    .padStart(2, "0")}
                  :{(countdown % 60).toString().padStart(2, "0")}
                </span>
              )}
            </div>

            {/* Manual refresh */}
            <button
              onClick={refreshTrending}
              disabled={loading}
              className="flex items-center gap-1.5 text-sm px-4 py-2 bg-white hover:bg-slate-50 text-slate-600 font-semibold rounded-xl border border-slate-200 shadow-sm transition-all active:scale-95 disabled:opacity-50"
            >
              <svg
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
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

        {/* ── Tab Bar (Flowith style) ───────────────────────────────── */}
        <div className="flex items-center gap-1.5 mb-6 flex-wrap">
          {sources.map((src) => (
            <button
              key={src.key}
              onClick={() => switchTab(src.key)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                activeTab === src.key
                  ? "bg-slate-800 text-white shadow-sm"
                  : "bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {src.label}
            </button>
          ))}
        </div>

        {/* ── Content Area ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm min-h-[500px] p-6">
          {loading && !trending ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 animate-pulse">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-slate-100 rounded-2xl h-52 border border-slate-100"
                />
              ))}
            </div>
          ) : activeItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
              <span className="text-5xl">🔭</span>
              <p className="font-medium text-sm">该榜单暂无数据，请尝试刷新</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 animate-in fade-in duration-300">
              {activeItems.slice(0, 16).map((item: any) => (
                <a
                  key={`${item.id}-${item.rank}`}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative flex flex-col gap-3 p-4 rounded-2xl border border-slate-100 bg-white hover:border-blue-200 hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-200 hover:-translate-y-0.5"
                >
                  {/* Rank Badge */}
                  <div
                    className={`absolute -top-2.5 -left-2.5 w-7 h-7 rounded-full flex items-center justify-center font-black text-xs shadow-md border-2 border-white z-10 ${
                      item.rank === 1
                        ? "bg-gradient-to-br from-yellow-400 to-orange-500 text-white"
                        : item.rank === 2
                          ? "bg-gradient-to-br from-slate-300 to-slate-400 text-white"
                          : item.rank === 3
                            ? "bg-gradient-to-br from-orange-400 to-orange-600 text-white"
                            : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {item.rank}
                  </div>

                  {item.cover && (
                    <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-100">
                      <img
                        src={item.cover}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
                    <h4 className="text-[14px] font-bold text-slate-800 line-clamp-2 group-hover:text-blue-600 transition-colors leading-tight">
                      {item.title}
                    </h4>

                    <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-50">
                      <div className="flex items-center gap-2">
                        {item.price !== undefined && (
                          <span
                            className={`text-sm font-black ${item.price === 0 ? "text-emerald-500" : "text-slate-600"}`}
                          >
                            {item.price === 0
                              ? "FREE"
                              : `¥${item.price.toFixed(0)}`}
                          </span>
                        )}
                        {item.discount > 0 && (
                          <span className="text-[10px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-md font-black">
                            -{item.discount}%
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium">
                        查看 →
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
