"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Hand,
  Shield,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { RefObject } from "react";

export type MoodPermission = "default" | "auto_audit" | "full_access";

export type MoodPermissionMenuVariant = "onDark" | "onLight" | "onTheme";

const MOOD_PERM_OPTIONS: {
  value: MoodPermission;
  label: string;
  Icon: LucideIcon;
}[] = [
  { value: "default", label: "默认权限", Icon: Hand },
  { value: "auto_audit", label: "自动审查", Icon: Shield },
  { value: "full_access", label: "完全访问权限", Icon: ShieldAlert },
];

export function normalizeMoodPermission(
  p: string | undefined,
): MoodPermission {
  if (p === "auto_audit" || p === "full_access") return p;
  return "default";
}

export async function patchCompanionMoodPermission(
  next: MoodPermission,
): Promise<{ ok: boolean; data?: unknown }> {
  try {
    const r = await fetch("/api/companion/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mood: { permission: next } }),
    });
    const data = await r.json();
    if (
      data &&
      typeof data === "object" &&
      !("error" in data && (data as { error?: string }).error)
    ) {
      return { ok: true, data };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export type MoodPermissionDropdownProps = {
  value: MoodPermission;
  onPick: (next: MoodPermission) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  triggerId: string;
  menuId: string;
  triggerClassName: string;
  menuVariant: MoodPermissionMenuVariant;
  /** 仅显示手型/盾牌图标与下拉箭头（文案放入 aria-label / title） */
  iconOnlyTrigger?: boolean;
  /** 贴近屏幕底边时向上展开，避免被裁切 */
  preferMenuAbove?: boolean;
};

export function MoodPermissionDropdown({
  value,
  onPick,
  open,
  onOpenChange,
  containerRef,
  triggerId,
  menuId,
  triggerClassName,
  menuVariant,
  iconOnlyTrigger = false,
  preferMenuAbove = false,
}: MoodPermissionDropdownProps) {
  const cur =
    MOOD_PERM_OPTIONS.find((o) => o.value === value) ?? MOOD_PERM_OPTIONS[0];
  const CurIcon = cur.Icon;

  const menuShell =
    menuVariant === "onTheme"
      ? "rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-1 shadow-xl shadow-black/20"
      : menuVariant === "onLight"
        ? "rounded-xl border border-gray-200 bg-white py-1 shadow-xl shadow-black/15"
        : "rounded-xl border border-white/15 bg-zinc-900/98 py-1 shadow-xl shadow-black/50";

  const itemRow =
    menuVariant === "onTheme"
      ? "text-[12px] text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
      : menuVariant === "onLight"
        ? "text-[12px] text-gray-900 hover:bg-gray-100"
        : "text-[12px] text-zinc-50 hover:bg-white/10";

  const itemIcon =
    menuVariant === "onTheme"
      ? "text-[color:var(--label-secondary)]"
      : menuVariant === "onLight"
        ? "text-gray-600"
        : "text-zinc-300";

  /** 与「新建对话」参考稿一致：选中项右侧勾选偏橙 emphasis */
  const checkClass =
    menuVariant === "onTheme"
      ? "text-orange-500"
      : menuVariant === "onLight"
        ? "text-orange-500"
        : "text-orange-400";

  const chevronClass =
    menuVariant === "onTheme"
      ? "text-[color:var(--label-secondary)]"
      : menuVariant === "onLight"
        ? "text-gray-500"
        : "text-zinc-300";

  /** 菜单展开时蓝色描边 + ring（参考新建对话交互稿） */
  const triggerOpenAccent =
    menuVariant === "onLight"
      ? "!border-blue-400 ring-2 ring-blue-400/35"
      : menuVariant === "onDark"
        ? "!border-sky-400 ring-2 ring-sky-400/35"
        : "!border-blue-500/85 ring-2 ring-blue-500/35";

  const triggerFocusAccent =
    "focus-visible:!border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/35 focus-visible:outline-none";

  const chevronIconCls = `${iconOnlyTrigger ? "h-3.5 w-3.5" : "h-4 w-4"} shrink-0 transition-transform duration-200 ${chevronClass}`;

  return (
    <div className="relative min-w-0" ref={containerRef}>
      <button
        type="button"
        id={triggerId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={iconOnlyTrigger ? `执行权限：${cur.label}` : undefined}
        title={iconOnlyTrigger ? cur.label : undefined}
        onClick={() => onOpenChange(!open)}
        className={`${triggerClassName} outline-none transition-[border-color,box-shadow] ${triggerFocusAccent} ${open ? triggerOpenAccent : ""}`}
      >
        <CurIcon className="h-4 w-4 shrink-0 opacity-90" />
        {iconOnlyTrigger ? null : (
          <span className="min-w-0 flex-1 truncate text-left">{cur.label}</span>
        )}
        {open ? (
          <ChevronUp className={chevronIconCls} aria-hidden />
        ) : (
          <ChevronDown className={chevronIconCls} aria-hidden />
        )}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className={`absolute left-0 z-[90] min-w-[12.5rem] max-w-[min(100vw-2rem,20rem)] ${preferMenuAbove ? "bottom-full mb-1" : "top-full mt-1"} ${menuShell}`}
        >
          {MOOD_PERM_OPTIONS.map(({ value: v, label, Icon }) => (
            <button
              key={v}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(v);
                onOpenChange(false);
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${itemRow}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${itemIcon}`} />
              <span className="min-w-0 flex-1">{label}</span>
              {value === v ? (
                <Check
                  className={`h-4 w-4 shrink-0 ${checkClass}`}
                  aria-hidden
                />
              ) : (
                <span className="h-4 w-4 shrink-0" aria-hidden />
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
