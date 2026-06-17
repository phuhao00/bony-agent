"use client";

/**
 * DreamsPanel — 梦境卡片列表 + act/dismiss + 图 mode 切换
 *
 * 无 mock fallback：数据不可用时直接显示 error state。
 */

import { useEffect, useState } from "react";
import { Sparkles, CheckCircle, XCircle, RefreshCw } from "lucide-react";

// ---------- 类型 ----------

export interface DreamCard {
  id: string;
  title: string;
  body?: string;
  action?: string;
  status: "pending" | "act" | "dismiss";
  created_at?: string;
  memory_refs?: string[];
}

interface DreamsResponse {
  cards: DreamCard[];
  count: number;
}

interface DreamStatus {
  latest?: {
    status: string;
    date?: string;
    duration_s?: number;
    card_count?: number;
    event_count?: number;
    created_at?: string;
  };
  recent_runs?: Array<{
    status: string;
    date?: string;
    card_count?: number;
    duration_s?: number;
  }>;
}

// ---------- API helpers ----------

const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchCards(filter?: "pending" | "act" | "dismiss"): Promise<DreamsResponse> {
  const url = new URL(`${BACKEND}/evolution/dreams`);
  url.searchParams.set("limit", "30");
  if (filter) url.searchParams.set("status", filter);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<DreamsResponse>;
}

async function actOnCard(cardId: string, action: "act" | "dismiss"): Promise<void> {
  const res = await fetch(`${BACKEND}/evolution/dreams/${cardId}/act`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function fetchStatus(): Promise<DreamStatus> {
  const res = await fetch(`${BACKEND}/evolution/dream/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<DreamStatus>;
}

async function triggerDream(): Promise<void> {
  const res = await fetch(`${BACKEND}/evolution/dream/run?force=false`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ---------- Card 组件 ----------

function DreamCardItem({
  card,
  onAct,
  onDismiss,
}: {
  card: DreamCard;
  onAct: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const isPending = card.status === "pending";
  const isActed = card.status === "act";
  const isDismissed = card.status === "dismiss";

  return (
    <div
      className={`rounded-xl p-4 ring-1 transition-all ${
        isDismissed
          ? "opacity-40 ring-[color:var(--separator-subtle)] bg-transparent"
          : isActed
          ? "ring-emerald-400/40 bg-emerald-50/20 dark:bg-emerald-900/10"
          : "ring-[color:var(--separator-subtle)] card-surface hover:ring-[color:var(--accent)]/30"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)]/10">
          <Sparkles className="h-3.5 w-3.5 text-[color:var(--accent)]" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[color:var(--foreground)] leading-snug">
            {card.title}
          </p>
          {card.body && (
            <p className="mt-1 text-[12px] text-[color:var(--label-secondary)] leading-relaxed">
              {card.body}
            </p>
          )}
          {card.action && (
            <p className="mt-2 text-[11px] text-[color:var(--accent)] font-medium">
              💡 {card.action}
            </p>
          )}
          {card.created_at && (
            <p className="mt-1.5 text-[11px] text-[color:var(--label-tertiary)]">
              {card.created_at.slice(0, 10)}
            </p>
          )}
        </div>

        {isPending && (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              title="接受建议 (+3 XP)"
              onClick={() => onAct(card.id)}
              className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              接受
            </button>
            <button
              type="button"
              title="忽略"
              onClick={() => onDismiss(card.id)}
              className="flex items-center gap-1 rounded-lg bg-[var(--nav-active-fill)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] transition-colors"
            >
              <XCircle className="h-3.5 w-3.5" />
              忽略
            </button>
          </div>
        )}

        {isActed && (
          <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            已采纳
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- 状态卡片 ----------

function DreamStatusCard({ status }: { status: DreamStatus }) {
  const latest = status.latest;
  if (!latest) {
    return (
      <div className="rounded-xl card-surface ring-1 ring-[color:var(--separator-subtle)] p-4 text-sm text-[color:var(--label-secondary)]">
        尚未进行过 Dream 整合。每日凌晨 2 点自动运行，或手动触发。
      </div>
    );
  }
  const isOk = latest.status === "ok";
  return (
    <div className={`rounded-xl ring-1 p-4 ${isOk ? "ring-[color:var(--accent)]/30 bg-[color:var(--accent)]/5" : "ring-red-400/30 bg-red-50/10"}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${isOk ? "bg-emerald-400" : "bg-red-400"}`} />
        <p className="text-[13px] font-medium text-[color:var(--foreground)]">
          {isOk ? "上次整合成功" : "上次整合失败"}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-[color:var(--label-secondary)]">
        {latest.date && <span>日期：{latest.date}</span>}
        {latest.card_count !== undefined && <span>卡片：{latest.card_count}</span>}
        {latest.event_count !== undefined && <span>事件：{latest.event_count}</span>}
        {latest.duration_s !== undefined && <span>耗时：{latest.duration_s}s</span>}
      </div>
    </div>
  );
}

// ---------- 主组件 ----------

type FilterMode = "all" | "pending" | "act" | "dismiss";

const FILTER_LABELS: Record<FilterMode, string> = {
  all: "全部",
  pending: "待处理",
  act: "已采纳",
  dismiss: "已忽略",
};

export default function DreamsPanel() {
  const [cards, setCards] = useState<DreamCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("pending");
  const [dreamStatus, setDreamStatus] = useState<DreamStatus | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadCards = () => {
    setLoading(true);
    setError(null);
    fetchCards(filter === "all" ? undefined : filter)
      .then((d) => setCards(d.cards))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const loadStatus = () => {
    fetchStatus().then(setDreamStatus).catch(() => {});
  };

  useEffect(() => {
    loadCards();
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const handleAct = (id: string) => {
    setActionError(null);
    actOnCard(id, "act")
      .then(() => {
        setCards((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: "act" as const } : c))
        );
      })
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)));
  };

  const handleDismiss = (id: string) => {
    setActionError(null);
    actOnCard(id, "dismiss")
      .then(() => {
        setCards((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: "dismiss" as const } : c))
        );
      })
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)));
  };

  const handleTriggerDream = () => {
    setTriggering(true);
    triggerDream()
      .then(() => {
        setTimeout(() => {
          loadCards();
          loadStatus();
        }, 2000);
      })
      .catch(() => {})
      .finally(() => setTriggering(false));
  };

  const pendingCount = cards.filter((c) => c.status === "pending").length;

  return (
    <section className="flex flex-col gap-5">
      {/* 顶部：状态 + 触发按钮 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          {dreamStatus && <DreamStatusCard status={dreamStatus} />}
        </div>
        <button
          type="button"
          disabled={triggering}
          onClick={handleTriggerDream}
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-4 py-2 text-[13px] font-semibold text-[color:var(--foreground)] shadow-sm hover:bg-[var(--nav-active-fill)] disabled:opacity-50 sm:self-center"
        >
          <RefreshCw className={`h-4 w-4 ${triggering ? "animate-spin" : ""}`} />
          {triggering ? "整合中…" : "立即整合"}
        </button>
      </div>

      {/* 筛选 Tab */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {(Object.keys(FILTER_LABELS) as FilterMode[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                filter === f
                  ? "bg-[color:var(--accent)] text-white"
                  : "bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
              }`}
            >
              {FILTER_LABELS[f]}
              {f === "pending" && pendingCount > 0 && (
                <span className="ml-1 rounded-full bg-white/20 px-1.5 text-[10px]">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={loadCards}
          className="ml-auto rounded-lg p-1.5 text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] transition-colors"
          title="刷新"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* action error */}
      {actionError && (
        <p className="text-[12px] text-red-500">{actionError}</p>
      )}

      {/* 卡片列表 */}
      {loading && (
        <div className="flex min-h-[200px] items-center justify-center text-sm text-[color:var(--label-secondary)]">
          加载中…
        </div>
      )}

      {!loading && error && (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-sm">
          <p className="text-red-500 font-medium">加载梦境卡片失败</p>
          <p className="text-[color:var(--label-secondary)] text-xs">{error}</p>
          <button
            type="button"
            onClick={loadCards}
            className="rounded-lg bg-[var(--nav-active-fill)] px-4 py-1.5 text-xs font-medium text-[color:var(--foreground)]"
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && cards.length === 0 && (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-sm text-[color:var(--label-secondary)]">
          <Sparkles className="h-8 w-8 opacity-30" />
          <p>暂无{filter !== "all" ? FILTER_LABELS[filter] : ""}梦境卡片</p>
          {filter === "pending" && (
            <p className="text-xs opacity-70">每日 AI 整合后将生成洞察卡片</p>
          )}
        </div>
      )}

      {!loading && !error && cards.length > 0 && (
        <div className="flex flex-col gap-3">
          {cards.map((card) => (
            <DreamCardItem
              key={card.id}
              card={card}
              onAct={handleAct}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}
    </section>
  );
}
