"use client";

import { Undo2, Redo2, Save, Film, Plus } from "lucide-react";

interface EditorHeaderProps {
  projectName: string;
  onNameChange?: (name: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onExport?: () => void;
  exporting?: boolean;
}

export default function EditorHeader({
  projectName,
  onNameChange,
  onUndo,
  onRedo,
  onExport,
  exporting,
}: EditorHeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--separator)] bg-[var(--card-bg)] px-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white">
          <Film size={18} />
        </div>
        <input
          type="text"
          value={projectName}
          onChange={(e) => onNameChange?.(e.target.value)}
          className="border-none bg-transparent text-lg font-semibold text-[var(--foreground)] outline-none focus:ring-0"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onUndo}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-[var(--foreground)] hover:bg-[var(--shell-bg)]"
        >
          <Undo2 size={16} />
          撤销
        </button>
        <button
          onClick={onRedo}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-[var(--foreground)] hover:bg-[var(--shell-bg)]"
        >
          <Redo2 size={16} />
          重做
        </button>
        <div className="mx-2 h-5 w-px bg-[var(--separator)]" />
        <button
          onClick={onExport}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {exporting ? "导出中..." : "导出"}
        </button>
      </div>
    </header>
  );
}
