"use client";

import { useTranslation } from "@/hooks/useTranslation";
import {
  ChevronUp,
  FileText,
  FolderUp,
  Image as ImageIcon,
  Plus,
} from "lucide-react";
import type { RefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { MultimodalInputHandle } from "./MultimodalInput";

type MenuPlacement = "below" | "above" | "auto";

type Props = {
  multimodalRef: RefObject<MultimodalInputHandle | null>;
  /** 浅色输入卡片（伴侣页等）：避免 html 深色主题变量与白条冲突 */
  surface?: "theme" | "light";
  /** 受控模式下由父组件管理展开（便于与权限菜单等互斥） */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * below | above | auto（默认 auto）：贴底输入条或父级 overflow 时，auto 会测量视口空间并尽量向上展开。
   */
  menuPlacement?: MenuPlacement;
};

/**
 * 参照常见「胶囊输入条」用法：收起为 Plus，展开为 ChevronUp + 菜单。
 */
const MENU_ESTIMATE_PX = 196;

export function ChatAttachmentMenu({
  multimodalRef,
  surface = "theme",
  open: controlledOpen,
  onOpenChange,
  menuPlacement = "auto",
}: Props) {
  const { t } = useTranslation();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : uncontrolledOpen;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuMeasuredRef = useRef<HTMLDivElement>(null);
  const [openUp, setOpenUp] = useState(false);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, setOpen]);

  useLayoutEffect(() => {
    if (!open) return;
    if (menuPlacement === "above") {
      setOpenUp(true);
      return;
    }
    if (menuPlacement === "below") {
      setOpenUp(false);
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const pad = 20;
    const spaceBelow = globalThis.window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const needAbove =
      spaceBelow < MENU_ESTIMATE_PX + pad && spaceAbove > spaceBelow;
    setOpenUp(needAbove);

    let ro: ResizeObserver | null = null;
    const measure = () => {
      const m = menuMeasuredRef.current;
      const r = rootRef.current;
      if (!r) return;
      const rr = r.getBoundingClientRect();
      const h = m?.offsetHeight ?? MENU_ESTIMATE_PX;
      const sd = globalThis.window.innerHeight - rr.bottom;
      const sa = rr.top;
      setOpenUp(sd < h + pad && sa > sd);
    };
    queueMicrotask(measure);
    if (typeof ResizeObserver !== "undefined" && menuMeasuredRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(menuMeasuredRef.current);
    }
    globalThis.window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      globalThis.window.removeEventListener("resize", measure);
    };
  }, [open, menuPlacement]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const btnTheme =
    surface === "light"
      ? "bg-gray-100 text-gray-900 shadow-sm ring-1 ring-gray-200/90 transition hover:bg-gray-200 hover:ring-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
      : "bg-[color:color-mix(in_srgb,var(--foreground)_06%,transparent)] text-[color:var(--foreground)] shadow-sm ring-1 ring-[color:var(--separator-subtle)] transition hover:bg-[var(--nav-active-fill)] hover:ring-[color:color-mix(in_srgb,var(--accent)_35%,var(--separator-subtle))] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[color:rgba(255,149,0,0.38)]";

  const menuPosBelowLight =
    "left-0 top-full z-[90] mt-2 origin-top animate-in fade-in zoom-in-95 duration-150";
  const menuPosAboveLight =
    "bottom-full left-0 z-[90] mb-2 origin-bottom animate-in fade-in zoom-in-95 duration-150";
  const menuPosBelowTheme =
    "left-0 top-full z-[90] mt-2 origin-top animate-in fade-in zoom-in-95 duration-150";
  const menuPosAboveTheme =
    "bottom-full left-0 z-[90] mb-2 origin-bottom animate-in fade-in zoom-in-95 duration-150";

  const menuChromeLight =
    "min-w-[15rem] overflow-hidden rounded-2xl border border-gray-200 bg-white py-1.5 shadow-lg shadow-black/12";
  const menuChromeTheme =
    "min-w-[15rem] overflow-hidden rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-1.5";

  const menuWrapClassLight = `absolute flex flex-col ${openUp ? menuPosAboveLight : menuPosBelowLight} ${menuChromeLight}`;
  const menuWrapClassTheme = `absolute flex flex-col ${openUp ? menuPosAboveTheme : menuPosBelowTheme} ${menuChromeTheme}`;

  const itemRowTheme = (extra = "") =>
    `flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-[color:var(--foreground)] outline-none transition-colors hover:bg-[var(--nav-active-fill)] focus-visible:bg-[var(--nav-active-fill)] ${extra}`;

  const itemRowLight = (extra = "") =>
    `flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] font-medium text-gray-900 outline-none transition-colors hover:bg-gray-100 focus-visible:bg-gray-100 ${extra}`;

  const iconMuted =
    surface === "light"
      ? "h-[18px] w-[18px] shrink-0 text-gray-500"
      : "h-[18px] w-[18px] shrink-0 text-[color:var(--label-secondary)]";

  const menuShadowStyle =
    surface === "light"
      ? undefined
      : {
          boxShadow:
            "0 4px 6px -1px color-mix(in srgb, var(--foreground) 8%, transparent), 0 12px 24px -6px color-mix(in srgb, var(--foreground) 14%, transparent)",
        };

  const itemRow = surface === "light" ? itemRowLight : itemRowTheme;

  return (
    <div ref={rootRef} className="relative flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("chat.attachMenuAria")}
        className={`flex h-9 w-9 items-center justify-center rounded-full ${btnTheme}`}
      >
        {open ? (
          <ChevronUp
            className="h-[18px] w-[18px]"
            strokeWidth={2.35}
            aria-hidden
          />
        ) : (
          <Plus
            className="h-[18px] w-[18px]"
            strokeWidth={2.35}
            aria-hidden
          />
        )}
      </button>

      {open ? (
        <div
          ref={menuMeasuredRef}
          role="menu"
          aria-orientation="vertical"
          className={surface === "light" ? menuWrapClassLight : menuWrapClassTheme}
          style={menuShadowStyle}
        >
          <button
            type="button"
            role="menuitem"
            className={itemRow()}
            onClick={() =>
              run(() => multimodalRef.current?.openImagePicker())
            }
          >
            <ImageIcon className={iconMuted} strokeWidth={2} />
            <span>{t("chat.attachUploadImage")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemRow()}
            onClick={() => run(() => multimodalRef.current?.openFilePicker())}
          >
            <FileText className={iconMuted} strokeWidth={2} />
            <span>{t("chat.attachUploadFile")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemRow()}
            onClick={() =>
              run(() => multimodalRef.current?.openFolderPicker())
            }
          >
            <FolderUp className={iconMuted} strokeWidth={2} />
            <span>{t("chat.attachUploadFolder")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
