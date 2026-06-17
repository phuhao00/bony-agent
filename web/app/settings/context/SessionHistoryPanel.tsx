"use client";

import { ChevronRight, MessageSquare, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

interface SessionRow {
  session_id: string;
  title?: string;
  preview?: string;
  message_count?: number;
  updated_at?: number;
  created_at?: number;
}

interface DiscoveryResult extends SessionRow {
  snippet?: string;
  window?: { id: number; role: string; content: string }[];
  bookend_start?: { role: string; content: string }[];
}

interface ScrollMessage {
  id: number;
  role: string;
  content: string;
  anchor?: boolean;
}

export default function SessionHistoryPanel() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<DiscoveryResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scrollMessages, setScrollMessages] = useState<ScrollMessage[]>([]);
  const [stats, setStats] = useState<{ session_count?: number; message_count?: number } | null>(null);

  const loadBrowse = useCallback(async () => {
    setLoading(true);
    try {
      const [browseRes, statsRes] = await Promise.all([
        fetch("/api/evolution/session-recall/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "", limit: 20 }),
        }),
        fetch("/api/context/sessions/stats"),
      ]);
      if (browseRes.ok) {
        const data = await browseRes.json();
        setSessions(data.results ?? []);
      }
      if (statsRes.ok) setStats(await statsRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/evolution/session-recall/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), limit: 10 }),
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.results ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [query]);

  const expandSession = useCallback(async (sessionId: string) => {
    if (expandedId === sessionId) {
      setExpandedId(null);
      setScrollMessages([]);
      return;
    }
    setExpandedId(sessionId);
    const res = await fetch("/api/evolution/session-recall/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, window: 8 }),
    });
    if (res.ok) {
      const data = await res.json();
      setScrollMessages(data.messages ?? []);
    }
  }, [expandedId]);

  useEffect(() => {
    void loadBrowse();
  }, [loadBrowse]);

  const formatTime = (ts?: number) => {
    if (!ts) return "—";
    return new Date(ts * 1000).toLocaleString();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
            {t("settings.context.sessionsTitle")}
          </h2>
          <p className="mt-1 text-[13px] text-[color:var(--label-secondary)]">
            {t("settings.context.sessionsSubtitle")}
            {stats ? (
              <span className="ml-2 opacity-80">
                · {stats.session_count ?? 0} {t("settings.context.sessionsCount")} · {stats.message_count ?? 0}{" "}
                {t("settings.context.messagesCount")}
              </span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadBrowse()}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-[color:var(--separator-subtle)] px-3 py-2 text-[13px] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("settings.context.statusRefresh")}
        </button>
      </div>

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--label-secondary)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            placeholder={t("settings.context.sessionsSearchPlaceholder")}
            className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-2.5 pl-10 pr-3 text-[13px] focus:border-[color:var(--accent)] focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={loading}
          className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
        >
          {t("settings.context.sessionsSearch")}
        </button>
      </div>

      <div className="rounded-2xl card-surface divide-y divide-[color:var(--separator-subtle)] overflow-hidden">
        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-[13px] text-[color:var(--label-secondary)]">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            {t("settings.context.sessionsLoading")}
          </div>
        ) : null}

        {!loading && sessions.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-[color:var(--label-secondary)]">
            {t("settings.context.sessionsEmpty")}
          </div>
        ) : null}

        {sessions.map((s) => {
          const sid = s.session_id;
          const open = expandedId === sid;
          return (
            <div key={sid}>
              <button
                type="button"
                onClick={() => void expandSession(sid)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[var(--nav-active-fill)]"
              >
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--accent)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium text-[color:var(--foreground)]">
                      {s.title || sid}
                    </span>
                    <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] text-[color:var(--label-secondary)]">
                    {s.snippet || s.preview || t("settings.context.sessionsNoPreview")}
                  </p>
                  <p className="mt-1 text-[11px] text-[color:var(--label-secondary)] opacity-70">
                    {formatTime(s.updated_at)} · {s.message_count ?? "?"} msgs
                  </p>
                </div>
              </button>
              {open ? (
                <div className="border-t border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)]/40 px-4 py-3">
                  {(scrollMessages.length ? scrollMessages : s.window ?? []).map((m) => (
                    <div
                      key={m.id ?? `${m.role}-${m.content?.slice(0, 20)}`}
                      className={`mb-2 rounded-lg px-3 py-2 text-[12px] ${
                        m.role === "user"
                          ? "bg-[var(--card-bg)] text-[color:var(--foreground)]"
                          : "bg-transparent text-[color:var(--label-secondary)]"
                      } ${"anchor" in m && m.anchor ? "ring-1 ring-[color:var(--accent)]" : ""}`}
                    >
                      <span className="mr-2 font-semibold uppercase text-[10px]">{m.role}</span>
                      {m.content}
                    </div>
                  ))}
                  <p className="mt-2 text-[10px] italic text-[color:var(--label-secondary)]">
                    {t("settings.context.sessionsReferenceNote")}
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
