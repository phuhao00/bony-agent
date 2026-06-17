"use client";

import { useDragControls } from "framer-motion";
import { motion } from "framer-motion";
import { GripHorizontal, X } from "lucide-react";

interface DraggablePanelProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  className?: string;
}

function classNames(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function DraggablePanel({ title, children, onClose, className }: DraggablePanelProps) {
  const controls = useDragControls();

  return (
    <motion.div
      drag
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      className={classNames(
        "absolute top-16 right-4 z-30 w-64 border border-[var(--border-subtle)] bg-[var(--card-bg)] rounded-2xl flex flex-col shadow-2xl overflow-hidden",
        className
      )}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="p-3 border-b border-[var(--border-subtle)] flex items-center justify-between cursor-move select-none"
        onPointerDown={(e) => controls.start(e)}
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="w-4 h-4 text-[color:var(--label-secondary)]" />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-[var(--nav-active-fill)] transition-colors"
          title="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 max-h-[calc(100vh-200px)]">{children}</div>
    </motion.div>
  );
}
