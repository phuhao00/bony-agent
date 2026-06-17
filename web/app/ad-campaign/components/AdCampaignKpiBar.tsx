"use client";

import { DollarSign, Users } from "lucide-react";

const CHANNELS = [
  { id: "douyin", label: "抖音" },
  { id: "xiaohongshu", label: "小红书" },
  { id: "bilibili", label: "B站" },
  { id: "wechat", label: "微信" },
  { id: "google", label: "Google" },
] as const;

const AUDIENCE_PRESETS = [
  "18-24 学生",
  "25-34 职场",
  "宝妈人群",
  "高净值",
  "游戏玩家",
] as const;

export function AdCampaignKpiBar({
  budgetK,
  onBudgetKChange,
  channels,
  onToggleChannel,
  audience,
  onAudienceChange,
  productName,
}: {
  budgetK: number;
  onBudgetKChange: (k: number) => void;
  channels: string[];
  onToggleChannel: (id: string) => void;
  audience: string;
  onAudienceChange: (v: string) => void;
  productName: string;
}) {
  const budgetDisplay = budgetK >= 100 ? `${(budgetK / 10).toFixed(0)} 万` : `${budgetK} 千`;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-surface)] px-3 py-2">
          <DollarSign className="h-4 w-4 text-[color:var(--accent)]" />
          <span className="text-xs text-[color:var(--label-secondary)]">月预算</span>
          <span className="text-sm font-semibold tabular-nums text-[color:var(--foreground)]">
            {budgetDisplay}
          </span>
        </div>
        {productName.trim() ? (
          <span className="rounded-lg bg-[var(--nav-active-fill)] px-2.5 py-1 text-xs font-medium text-[color:var(--foreground)]">
            {productName.trim()}
          </span>
        ) : null}
        <div className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--card-surface)] px-3 py-2">
          <Users className="h-4 w-4 text-[color:var(--label-secondary)]" />
          <select
            value={audience}
            onChange={(e) => onAudienceChange(e.target.value)}
            className="bg-transparent text-xs font-medium text-[color:var(--foreground)] outline-none"
          >
            {AUDIENCE_PRESETS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 lg:max-w-md">
        <input
          type="range"
          min={10}
          max={500}
          step={10}
          value={budgetK}
          onChange={(e) => onBudgetKChange(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer accent-[var(--accent)]"
          aria-label="预算滑块"
        />
        <div className="flex flex-wrap gap-1.5">
          {CHANNELS.map(({ id, label }) => {
            const active = channels.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onToggleChannel(id)}
                className={`rounded-lg border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  active
                    ? "border-[color:var(--accent)] bg-[var(--nav-active-fill)] text-[color:var(--accent)]"
                    : "border-[var(--border-subtle)] text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
