"use client";

import {
  BookMarked,
  Check,
  Copy,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  MoreHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  createFeishuDocViaApi,
  downloadMarkdownFile,
  parseFeishuDocCreateCliOutput,
  safeDownloadBasename,
} from "@/app/lark-cli/dev-report-utils";
import { exportHtmlToDocx, exportHtmlToPdf } from "@/lib/larkSummaryExport";
import { saveReportToKnowledge } from "../lib/reportExport";

const MENU_WIDTH = 176;

type MenuItem = {
  id: string;
  label: string;
  icon: typeof Copy;
  action: () => void | Promise<void>;
};

export function ProductManagerShareMenu({
  markdown,
  defaultTitle,
  previewRef,
  disabled,
}: {
  markdown: string;
  defaultTitle: string;
  previewRef: RefObject<HTMLElement | null>;
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [feishuUrl, setFeishuUrl] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const updateMenuPos = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - 8,
    );
    setMenuPos({ top: rect.bottom + 6, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPos();
    window.addEventListener("resize", updateMenuPos);
    window.addEventListener("scroll", updateMenuPos, true);
    return () => {
      window.removeEventListener("resize", updateMenuPos);
      window.removeEventListener("scroll", updateMenuPos, true);
    };
  }, [open, updateMenuPos]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const title = defaultTitle.trim() || "产品分析报告";
  const exportBasename = useMemo(() => safeDownloadBasename(title), [title]);
  const canAct = Boolean(markdown.trim()) && !disabled && !busy;

  const run = useCallback(
    async (fn: () => void | Promise<void>) => {
      if (!canAct) return;
      setBusy(true);
      try {
        await fn();
        setOpen(false);
      } finally {
        setBusy(false);
      }
    },
    [canAct],
  );

  const items: MenuItem[] = [
    {
      id: "copy",
      label: "复制 Markdown",
      icon: Copy,
      action: async () => {
        await navigator.clipboard.writeText(markdown);
        setToast("已复制");
      },
    },
    {
      id: "md",
      label: "下载 .md",
      icon: FileDown,
      action: () => {
        downloadMarkdownFile(`${exportBasename}.md`, markdown);
        setToast("已下载");
      },
    },
    {
      id: "pdf",
      label: "导出 PDF",
      icon: FileText,
      action: async () => {
        const el = previewRef.current;
        if (!el) throw new Error("preview");
        await exportHtmlToPdf(el, `${exportBasename}.pdf`, { documentTitle: title });
        setToast("PDF 已保存");
      },
    },
    {
      id: "word",
      label: "导出 Word",
      icon: FileText,
      action: async () => {
        const el = previewRef.current;
        if (!el) throw new Error("preview");
        await exportHtmlToDocx(el.innerHTML, { title, filename: `${exportBasename}.docx` });
        setToast("Word 已保存");
      },
    },
    {
      id: "feishu",
      label: "保存到飞书",
      icon: ExternalLink,
      action: async () => {
        const cli = await createFeishuDocViaApi(title, markdown);
        const parsed = parseFeishuDocCreateCliOutput(cli, title);
        if (!parsed.ok) throw new Error(parsed.message);
        setFeishuUrl(parsed.url || null);
        setToast(parsed.url ? "飞书文档已创建" : "已保存到飞书");
      },
    },
    {
      id: "kb",
      label: "加入知识库",
      icon: BookMarked,
      action: async () => {
        const result = await saveReportToKnowledge(title, markdown);
        if (!result.success) throw new Error(result.error || "失败");
        setToast("已加入知识库");
      },
    },
  ];

  const menu =
    open && mounted ? (
      <div
        ref={menuRef}
        role="menu"
        style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
        className="card-surface fixed z-[300] isolate overflow-hidden rounded-xl py-1 shadow-lg shadow-black/12"
      >
        <ul className="bg-[var(--card-bg)]">
          {items.map(({ id, label, icon: Icon, action }) => (
            <li key={id} className="bg-[var(--card-bg)]">
              <button
                type="button"
                role="menuitem"
                disabled={!canAct}
                onClick={() =>
                  void run(async () => {
                    try {
                      await action();
                    } catch {
                      setToast("操作失败");
                    }
                  })
                }
                className="flex w-full items-center gap-2 bg-[var(--card-bg)] px-3 py-2 text-left text-[13px] text-[color:var(--foreground)] transition hover:bg-[var(--nav-active-fill)] disabled:opacity-40"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-[color:var(--label-tertiary)]" />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  if (!markdown.trim()) return null;

  return (
    <div ref={triggerRef} className="relative z-20 shrink-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled || busy}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) updateMenuPos();
            return next;
          });
        }}
        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--label-secondary)] transition hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)] disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <MoreHorizontal className="h-3.5 w-3.5" />
        )}
        导出
      </button>

      {menu ? createPortal(menu, document.body) : null}

      {toast && mounted
        ? createPortal(
            <div className="pointer-events-none fixed bottom-24 left-1/2 z-[310] flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[color:var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--card-bg)] shadow-md">
              <Check className="h-3 w-3 shrink-0" />
              {toast}
              {feishuUrl ? (
                <a
                  href={feishuUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="pointer-events-auto ml-1 underline underline-offset-2"
                >
                  打开
                </a>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
