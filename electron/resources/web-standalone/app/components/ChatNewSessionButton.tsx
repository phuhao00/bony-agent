"use client";

import { MessageSquarePlus } from "lucide-react";

type ChatNewSessionButtonProps = {
  onClick: () => void;
  label: string;
  hint?: string;
  /** compact: icon + short label for toolbars; inline: text link style */
  variant?: "compact" | "inline";
  disabled?: boolean;
};

export function ChatNewSessionButton({
  onClick,
  label,
  hint,
  variant = "compact",
  disabled = false,
}: ChatNewSessionButtonProps) {
  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={hint}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--label-secondary)] transition-colors hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" strokeWidth={2} />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <MessageSquarePlus className="h-3.5 w-3.5 text-[color:var(--accent)]" strokeWidth={2} />
      {label}
    </button>
  );
}
