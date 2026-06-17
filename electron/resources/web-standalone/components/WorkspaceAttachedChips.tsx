"use client";

import { X } from "lucide-react";

type Props = {
  paths: string[];
  onRemove: (path: string) => void;
  label?: string;
};

/** 主聊天输入区上方：已附加的工作区文件路径 chip */
export function WorkspaceAttachedChips({ paths, onRemove, label }: Props) {
  if (paths.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-[color:var(--separator-subtle)] px-3 py-2">
      {label ? (
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-[color:var(--label-secondary)]">
          {label}
        </span>
      ) : null}
      {paths.map((path) => (
        <span
          key={path}
          className="inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--nav-active-fill)] px-2 py-0.5 font-mono text-[10px] text-[color:var(--accent)] ring-1 ring-[color:var(--separator-subtle)]"
          title={path}
        >
          <span className="truncate">@{path}</span>
          <button
            type="button"
            onClick={() => onRemove(path)}
            className="shrink-0 rounded p-0.5 hover:bg-[color:color-mix(in_srgb,var(--foreground)_12%,transparent)]"
            aria-label={`Remove ${path}`}
          >
            <X className="h-3 w-3" strokeWidth={2} aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
