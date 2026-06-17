"use client";

import type { ReactNode } from "react";

/** 餐费 H5（上传 / 历史）移动端外壳：安全区、窄屏内边距、限宽卡片 */
export function MealMobileShell({
  children,
  maxWidth = "md",
}: {
  children: ReactNode;
  maxWidth?: "md" | "lg";
}) {
  const maxClass = maxWidth === "lg" ? "max-w-lg" : "max-w-md";

  return (
    <div className="meal-mobile-page page-canvas min-h-[100dvh] w-full flex justify-center">
      <div
        className={`w-full ${maxClass} flex flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 sm:pb-8`}
      >
        <div className="card-surface rounded-2xl p-4 sm:p-6 md:p-8 w-full mt-2 sm:mt-8 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

/** 餐费页主操作按钮（≥48px 触控高度） */
export function mealTouchButtonClass(primary?: boolean): string {
  const base =
    "w-full min-h-12 py-3 px-4 rounded-xl text-base sm:text-sm font-medium touch-manipulation active:scale-[0.98] transition-transform disabled:opacity-50 disabled:active:scale-100";
  if (primary) {
    return `${base} text-white bg-indigo-600 hover:bg-indigo-700`;
  }
  return `${base} border hover:opacity-90`;
}
