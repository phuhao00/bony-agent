"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopApp } from "../hooks/useDesktopOperatorRunner";
import { filterAppsFuzzy } from "../lib/fuzzyAppMatch";

const inputClass =
  "w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--page-canvas)] px-3 py-2 text-sm text-[color:var(--foreground)] outline-none transition-colors focus:border-[color:var(--accent)]";

export function DesktopAppPicker({
  apps,
  query,
  onQueryChange,
  onSearch,
  selectedId,
  onSelect,
  loading = false,
  label = "搜索已安装应用",
  placeholder = "输入应用名模糊搜索，如 vscode / 微信 / Claude",
}: {
  apps: DesktopApp[];
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: (query: string) => void;
  selectedId?: string;
  onSelect: (app: DesktopApp) => void;
  loading?: boolean;
  label?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onSearch(query);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query, onSearch]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => filterAppsFuzzy(apps, query, 100), [apps, query]);
  const installedCount = useMemo(
    () => apps.filter((app) => app.source === "installed").length,
    [apps],
  );

  return (
    <div ref={rootRef} className="space-y-2">
      <label className="block text-xs font-medium text-[color:var(--label-secondary)]">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--label-tertiary)]" />
        <input
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={`${inputClass} pl-9 pr-9`}
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[color:var(--label-tertiary)]" />
        ) : null}
      </div>
      <p className="text-[11px] text-[color:var(--label-tertiary)]">
        已扫描 {apps.length} 个应用
        {installedCount > 0 ? `（本机安装 ${installedCount} 个）` : ""}
        {query.trim() ? ` · 匹配 ${filtered.length} 个` : ""}
      </p>
      {open && (
        <div className="max-h-64 overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--card-surface)] shadow-sm">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-sm text-[color:var(--label-secondary)]">
              {query.trim() ? "没有匹配的应用，请换个关键词" : "暂无应用列表，请稍后重试"}
            </p>
          ) : (
            filtered.map((app) => {
              const active = selectedId === app.id;
              return (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => {
                    onSelect(app);
                    onQueryChange(app.name);
                    setOpen(false);
                  }}
                  className={`flex w-full flex-col border-b border-[var(--border-subtle)] px-3 py-2.5 text-left last:border-0 hover:bg-[var(--nav-active-fill)] ${
                    active ? "bg-[var(--nav-active-fill)]" : ""
                  }`}
                >
                  <span className="text-sm font-medium text-[color:var(--foreground)]">{app.name}</span>
                  <span className="text-[11px] text-[color:var(--label-secondary)]">
                    {app.id}
                    {app.source ? ` · ${app.source}` : ""}
                    {app.category ? ` · ${app.category}` : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
