"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Undo2, Redo2, Home } from "lucide-react";

interface HeaderProps {
  projectName: string;
  onRename?: (name: string) => void | Promise<void>;
  onUndo?: () => void;
  onRedo?: () => void;
  onExport?: () => void;
  exporting?: boolean;
}

export default function Header({
  projectName,
  onRename,
  onUndo,
  onRedo,
  onExport,
  exporting,
}: HeaderProps) {
  const [name, setName] = useState(projectName);

  useEffect(() => {
    setName(projectName);
  }, [projectName]);

  const commit = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === projectName) {
      setName(projectName);
      return;
    }
    await onRename?.(trimmed);
  };

  return (
    <header className="chrome-bar flex h-11 shrink-0 items-center justify-between">
      <div className="flex items-center gap-3 px-4">
        <Link
          href="/"
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--foreground)] transition hover:bg-[var(--nav-active-fill)]"
          title="返回首页"
          aria-label="返回首页"
        >
          <Home size={16} strokeWidth={1.5} />
        </Link>
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent)] text-white">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setName(projectName);
            }
          }}
          className="w-44 border-none bg-transparent text-sm font-semibold tracking-tight outline-none placeholder:text-[var(--label-secondary)]"
        />
      </div>

      <div className="flex items-center gap-1 px-3">
        <button
          onClick={onUndo}
          className="rounded-md p-2 text-[var(--foreground)] transition hover:bg-[var(--nav-active-fill)]"
          title="撤销"
        >
          <Undo2 size={18} strokeWidth={1.5} />
        </button>
        <button
          onClick={onRedo}
          className="rounded-md p-2 text-[var(--foreground)] transition hover:bg-[var(--nav-active-fill)]"
          title="重做"
        >
          <Redo2 size={18} strokeWidth={1.5} />
        </button>
        <div className="mx-2 h-4 w-px bg-[var(--separator)]" />
        <button
          onClick={onExport}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {exporting ? "导出中" : "Export"}
        </button>
      </div>
    </header>
  );
}
