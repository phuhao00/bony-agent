"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AssistantSplitLayout } from "@/app/components/AssistantLayoutVariants";

type AssistantRecipeShellProps = {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  badge?: ReactNode;
  backHref?: string;
  panelIcon?: LucideIcon;
  panelTitle?: string;
  initLoading?: boolean;
  initLoadingLabel?: string;
  error?: string | null;
  footer?: ReactNode;
  controls: ReactNode;
  results: ReactNode;
  controlsWidthClass?: string;
  /** 顶栏下方横幅（免责声明等） */
  leading?: ReactNode;
  /** 底栏固定，正文区域独立滚动 */
  pinFooter?: boolean;
};

export function AssistantRecipeShell({
  icon: Icon,
  title,
  subtitle,
  badge,
  backHref = "/labs",
  panelIcon: PanelIcon,
  panelTitle = "快捷分析",
  initLoading,
  initLoadingLabel = "加载推荐…",
  error,
  footer,
  controls,
  results,
  controlsWidthClass,
  leading,
  pinFooter,
}: AssistantRecipeShellProps) {
  const QuickIcon = PanelIcon || Icon;

  return (
    <AssistantSplitLayout
      icon={Icon}
      title={title}
      subtitle={subtitle}
      badge={badge}
      backHref={backHref}
      initLoading={initLoading}
      initLoadingLabel={initLoadingLabel}
      error={error}
      footer={footer}
      results={results}
      controlsWidthClass={controlsWidthClass}
      leading={leading}
      pinFooter={pinFooter}
      controls={
        <>
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
            <QuickIcon className="h-4 w-4 text-[color:var(--accent)]" />
            {panelTitle}
          </div>
          {controls}
        </>
      }
    />
  );
}
