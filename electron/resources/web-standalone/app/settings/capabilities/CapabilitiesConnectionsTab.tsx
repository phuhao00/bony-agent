"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Platform {
  id: string;
  name: string;
  connected?: boolean;
  status: string;
  credential_state: string;
  deep_link: string;
  channel_count: number;
  home_channel?: { name?: string } | null;
  account_info?: { username?: string; nickname?: string } | null;
}

interface ConnectionsSections {
  platforms: Platform[];
  productivity: Platform[];
  local_runtime: Platform[];
  mcp: Platform[];
}

const PLATFORM_EMOJI: Record<string, string> = {
  douyin: "🎵",
  xiaohongshu: "📕",
  bilibili: "📺",
  kuaishou: "⚡",
  video_channel: "💬",
  tiktok: "🎶",
  twitter: "🐦",
  youtube: "▶️",
  weibo: "🔴",
  github: "🐙",
  meta: "👥",
};

export default function CapabilitiesConnectionsTab() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [sections, setSections] = useState<ConnectionsSections>({
    platforms: [],
    productivity: [],
    local_runtime: [],
    mcp: [],
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/connections/summary");
      const data = await res.json();
      const nextSections = {
        platforms: data.sections?.platforms || [],
        productivity: data.sections?.productivity || [],
        local_runtime: data.sections?.local_runtime || [],
        mcp: data.sections?.mcp || [],
      };
      setSections(nextSections);
      setPlatforms(nextSections.platforms);
    } catch {
      setPlatforms([]);
      setSections({
        platforms: [],
        productivity: [],
        local_runtime: [],
        mcp: [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[color:var(--accent)] border-t-transparent" />
      </div>
    );
  }

  const connected = platforms.filter((p) => p.connected);
  const disconnected = platforms.filter((p) => !p.connected);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <div className="card-surface rounded-2xl p-4 text-center">
          <p className="text-2xl font-semibold text-[color:var(--foreground)]">
            {platforms.length}
          </p>
          <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
            支持平台
          </p>
        </div>
        <div className="card-surface rounded-2xl p-4 text-center">
          <p className="text-2xl font-semibold text-[color:var(--accent)]">
            {connected.length}
          </p>
          <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
            已连接
          </p>
        </div>
        <div className="card-surface rounded-2xl p-4 text-center">
          <p className="text-2xl font-semibold text-[color:var(--label-secondary)]">
            {disconnected.length}
          </p>
          <p className="mt-0.5 text-xs text-[color:var(--label-secondary)]">
            未连接
          </p>
        </div>
      </div>

      {connected.length > 0 && (
        <section>
          <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
            已连接
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {connected.map((p) => (
              <PlatformCard key={p.id} platform={p} />
            ))}
          </div>
        </section>
      )}

      {disconnected.length > 0 && (
        <section>
          <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
            未连接
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {disconnected.map((p) => (
              <PlatformCard key={p.id} platform={p} />
            ))}
          </div>
        </section>
      )}

      <SummarySection title="生产力连接" items={sections.productivity} />
      <SummarySection title="本地运行时" items={sections.local_runtime} />
      <SummarySection title="MCP" items={sections.mcp} />

      <p className="text-center text-xs text-[color:var(--label-secondary)]">
        详细账号绑定与 Cookie 管理请前往{" "}
        <Link
          href="/platforms"
          className="font-medium text-[color:var(--accent)] hover:underline"
        >
          平台管理
        </Link>
      </p>
    </div>
  );
}

function SummarySection({
  title,
  items,
}: {
  title: string;
  items: Platform[];
}) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <PlatformCard key={item.id} platform={item} />
        ))}
      </div>
    </section>
  );
}

function PlatformCard({ platform }: { platform: Platform }) {
  const emoji = PLATFORM_EMOJI[platform.id] || "🔗";
  const accountName =
    platform.account_info?.nickname || platform.account_info?.username || null;

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border p-4 transition-shadow ${
        platform.connected
          ? "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] shadow-sm ring-1 ring-[color:rgba(255,149,0,0.12)]"
          : "card-surface shadow-sm"
      }`}
    >
      <span className="text-2xl">{emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-[color:var(--foreground)]">
          {platform.name}
        </p>
        {platform.connected && accountName ? (
          <p className="truncate text-[11px] text-[color:var(--accent)]">
            @{accountName}
          </p>
        ) : platform.credential_state === "configured" ? (
          <p className="text-[11px] text-[color:var(--label-secondary)]">
            凭证已保存，未验证
          </p>
        ) : platform.channel_count > 0 || platform.home_channel ? (
          <p className="text-[11px] text-[color:var(--label-secondary)]">
            {platform.home_channel?.name ||
              `${platform.channel_count} channels`}
          </p>
        ) : (
          <p className="text-[11px] text-[color:var(--label-secondary)]">
            未配置
          </p>
        )}
      </div>
      <div className="shrink-0">
        {platform.connected || platform.credential_state === "configured" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--nav-active-fill)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--foreground)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
            {platform.connected ? "已连接" : "可用"}
          </span>
        ) : (
          <Link
            href={platform.deep_link || "/platforms"}
            className="inline-flex items-center rounded-full border border-[color:var(--separator-subtle)] bg-[var(--shell-bg)] px-3 py-1 text-[11px] font-semibold text-[color:var(--accent)] transition-colors hover:bg-[var(--nav-active-fill)]"
          >
            去连接
          </Link>
        )}
      </div>
    </div>
  );
}
