"use client";

import { useCallback, useState } from "react";

export function OpsCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card-surface rounded-2xl p-4 md:p-5 ${className}`}>{children}</div>
  );
}

export function OpsSectionTitle({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
        {title}
      </h3>
      {hint && (
        <p className="text-xs mt-0.5" style={{ color: "var(--label-secondary)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "error" | "neutral" | "running";
  children: React.ReactNode;
}) {
  const map = {
    ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    warn: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
    error: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    neutral: "bg-black/5 text-[var(--label-secondary)]",
    running: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function OpsTab({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? "bg-[var(--accent)] text-white"
          : "text-[var(--label-secondary)] hover:bg-black/5 dark:hover:bg-white/5"
      }`}
    >
      {children}
      {badge && (
        <span className="ml-1.5 text-[10px] opacity-80">({badge})</span>
      )}
    </button>
  );
}

export type ToastItem = { id: string; tone: "ok" | "error" | "info"; text: string };

const TOAST_TTL_MS = 4500;
const TOAST_MAX = 3;

export function useOpsToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((tone: ToastItem["tone"], text: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((t) => {
      const last = t[t.length - 1];
      if (last?.text === text && last?.tone === tone) return t;
      const next = [...t, { id, tone, text }].slice(-TOAST_MAX);
      return next;
    });
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  const ToastStack = () =>
    toasts.length ? (
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto card-surface rounded-xl px-4 py-3 text-sm shadow-lg border ${
              t.tone === "error"
                ? "border-rose-300/50"
                : t.tone === "ok"
                  ? "border-emerald-300/50"
                  : ""
            }`}
            style={{ color: "var(--foreground)" }}
          >
            {t.text}
          </div>
        ))}
      </div>
    ) : null;

  return { push, ToastStack };
}

export function formatDuration(ms?: number) {
  if (!ms || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function buildResultTone(
  building?: boolean,
  result?: string | null,
): "ok" | "warn" | "error" | "neutral" | "running" {
  if (building) return "running";
  if (result === "SUCCESS") return "ok";
  if (result === "FAILURE" || result === "ABORTED") return "error";
  if (result === "UNSTABLE") return "warn";
  return "neutral";
}
