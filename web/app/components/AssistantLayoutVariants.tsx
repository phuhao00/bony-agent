"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type BaseShellProps = {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  badge?: ReactNode;
  backHref?: string;
  initLoading?: boolean;
  initLoadingLabel?: string;
  error?: string | null;
  headerAccent?: string;
  topBanner?: ReactNode;
  children: ReactNode;
};

/** Header + alert fields shared by role-specific assistant layouts (no free-form children slot). */
type AssistantLayoutShellProps = Omit<BaseShellProps, "children" | "topBanner">;

function ShellHeader({
  icon: Icon,
  title,
  subtitle,
  badge,
  backHref = "/labs",
  headerAccent,
}: Pick<BaseShellProps, "icon" | "title" | "subtitle" | "badge" | "backHref" | "headerAccent">) {
  const router = useRouter();
  return (
    <header
      className={`sticky top-0 z-20 shrink-0 border-b border-[color:var(--separator-subtle)] bg-[var(--card-surface)]/95 backdrop-blur-md px-4 py-4 sm:px-6 lg:px-8 ${headerAccent ?? ""}`}
    >
      <div className="mx-auto flex w-full max-w-[min(1680px,calc(100vw-2.5rem))] items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(backHref)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
          aria-label="返回"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
        </button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white shadow-sm">
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
              {title}
            </h1>
            {badge ? (
              <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--nav-active-fill)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--label-secondary)]">
                {badge}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-[color:var(--label-secondary)]">{subtitle}</p>
        </div>
      </div>
    </header>
  );
}

function ShellAlerts({
  initLoading,
  initLoadingLabel = "加载推荐…",
  error,
}: Pick<BaseShellProps, "initLoading" | "initLoadingLabel" | "error">) {
  return (
    <>
      {initLoading ? (
        <div className="flex items-center gap-2 text-sm text-[color:var(--label-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {initLoadingLabel}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : null}
    </>
  );
}

function ShellFooter({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-t border-[color:var(--separator-subtle)] bg-[var(--card-surface)]/95 px-4 py-4 backdrop-blur-md sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[min(1680px,calc(100vw-2.5rem))] space-y-3">{children}</div>
    </div>
  );
}

/** 左配置 + 右结果 + 底栏对话（Labs 通用双栏壳） */
export function AssistantSplitLayout({
  icon,
  title,
  subtitle,
  badge,
  backHref,
  initLoading,
  initLoadingLabel,
  error,
  controls,
  results,
  footer,
  headerAccent,
  leading,
  controlsWidthClass = "lg:w-[min(100%,460px)] xl:w-[480px]",
  pinFooter = false,
}: AssistantLayoutShellProps & {
  controls: ReactNode;
  results: ReactNode;
  footer?: ReactNode;
  headerAccent?: string;
  /** KPI 条、免责声明等顶栏下方内容 */
  leading?: ReactNode;
  controlsWidthClass?: string;
  /** 固定视口高度，主栏与结果区各自滚动，底栏对话不随正文被顶下去 */
  pinFooter?: boolean;
}) {
  return (
    <div
      className={`page-canvas flex flex-col bg-[var(--shell-bg)] ${
        pinFooter ? "h-[calc(100dvh-4rem)] overflow-hidden" : "min-h-[calc(100vh-4rem)]"
      }`}
    >
      <ShellHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        badge={badge}
        backHref={backHref}
        headerAccent={headerAccent}
      />
      {leading}
      <div
        className={`mx-auto flex w-full max-w-[min(1680px,calc(100vw-2.5rem))] flex-1 flex-col gap-6 px-4 py-5 sm:px-6 lg:flex-row lg:gap-8 lg:px-8 lg:py-5 ${
          pinFooter ? "min-h-0 overflow-hidden lg:items-stretch" : "lg:items-start"
        }`}
      >
        <section
          className={`flex w-full shrink-0 flex-col space-y-5 ${controlsWidthClass} ${
            pinFooter ? "min-h-0 overflow-hidden" : ""
          }`}
        >
          <div className={pinFooter ? "shrink-0" : undefined}>
            <ShellAlerts initLoading={initLoading} initLoadingLabel={initLoadingLabel} error={error} />
          </div>
          <div
            className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-surface)] p-5 shadow-sm ${
              pinFooter ? "flex min-h-0 flex-1 flex-col overflow-hidden" : ""
            }`}
          >
            {controls}
          </div>
        </section>
        <section
          className={`min-w-0 flex-1 ${pinFooter ? "flex min-h-0 flex-col overflow-hidden" : "pb-2"}`}
        >
          {results}
        </section>
      </div>
      {footer ? <ShellFooter>{footer}</ShellFooter> : null}
    </div>
  );
}

export function ComplianceReviewLayout({
  icon,
  title,
  subtitle,
  badge,
  backHref,
  initLoading,
  initLoadingLabel,
  error,
  disclaimer,
  sourcePanel,
  interpretationPanel,
  toolbar,
  footer,
}: AssistantLayoutShellProps & {
  disclaimer: ReactNode;
  sourcePanel: ReactNode;
  interpretationPanel: ReactNode;
  toolbar: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="page-canvas flex min-h-[calc(100vh-4rem)] flex-col bg-[var(--shell-bg)]">
      <ShellHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        badge={badge}
        backHref={backHref}
        headerAccent="border-b-slate-500/20"
      />
      {disclaimer}
      <div className="mx-auto flex w-full max-w-[min(1680px,calc(100vw-2.5rem))] flex-1 flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
        <ShellAlerts initLoading={initLoading} initLoadingLabel={initLoadingLabel} error={error} />
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-surface)] p-4 shadow-sm">
          {toolbar}
        </div>
        <div className="grid flex-1 gap-4 lg:grid-cols-2 lg:items-start">
          <section className="flex min-h-[min(420px,50vh)] flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-surface)] shadow-sm">
            {sourcePanel}
          </section>
          <section className="flex min-h-[min(420px,50vh)] flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-surface)] shadow-sm">
            {interpretationPanel}
          </section>
        </div>
      </div>
      {footer ? <ShellFooter>{footer}</ShellFooter> : null}
    </div>
  );
}

/** 视觉工作室：侧栏 Brief + 主区 Moodboard */
export function VisualStudioLayout({
  icon,
  title,
  subtitle,
  badge,
  backHref,
  initLoading,
  initLoadingLabel,
  error,
  sidebar,
  moodboard,
  main,
  footer,
  pinFooter = false,
}: AssistantLayoutShellProps & {
  sidebar: ReactNode;
  moodboard: ReactNode;
  main: ReactNode;
  footer?: ReactNode;
  pinFooter?: boolean;
}) {
  return (
    <div
      className={`page-canvas flex flex-col bg-[var(--shell-bg)] ${
        pinFooter ? "h-[calc(100dvh-4rem)] overflow-hidden" : "min-h-[calc(100vh-4rem)]"
      }`}
    >
      <ShellHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        badge={badge}
        backHref={backHref}
        headerAccent="bg-gradient-to-r from-[var(--card-surface)] via-[color-mix(in_srgb,var(--accent)_8%,var(--card-surface))] to-[var(--card-surface)]"
      />
      <div
        className={`mx-auto grid w-full max-w-[min(1720px,calc(100vw-2.5rem))] flex-1 grid-cols-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-5 lg:px-8 lg:py-5 xl:grid-cols-[380px_minmax(0,1fr)_320px] ${
          pinFooter ? "min-h-0 overflow-hidden" : ""
        }`}
      >
        <aside
          className={`w-full space-y-4 ${
            pinFooter ? "flex min-h-0 flex-col overflow-hidden" : ""
          }`}
        >
          <ShellAlerts initLoading={initLoading} initLoadingLabel={initLoadingLabel} error={error} />
          <div
            className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--card-surface)] p-4 shadow-sm ${
              pinFooter ? "flex min-h-0 flex-1 flex-col overflow-hidden" : ""
            }`}
          >
            {sidebar}
          </div>
        </aside>
        <div
          className={`min-w-0 ${pinFooter ? "min-h-0 overflow-hidden pb-0" : "pb-2"}`}
        >
          <div className={pinFooter ? "h-full min-h-0 overflow-hidden" : undefined}>{main}</div>
        </div>
        <aside
          className={`min-w-0 xl:block ${
            pinFooter ? "min-h-0 overflow-y-auto overscroll-contain" : ""
          }`}
        >
          {moodboard}
        </aside>
      </div>
      {footer ? <ShellFooter>{footer}</ShellFooter> : null}
    </div>
  );
}

/** 战役指挥：KPI 条 + 左配置右结果 + 底栏对话 */
export function CampaignCommandLayout({
  icon,
  title,
  subtitle,
  badge,
  backHref,
  initLoading,
  initLoadingLabel,
  error,
  kpiBar,
  controls,
  results,
  footer,
  pinFooter = true,
}: AssistantLayoutShellProps & {
  kpiBar: ReactNode;
  controls: ReactNode;
  results: ReactNode;
  footer?: ReactNode;
  pinFooter?: boolean;
}) {
  return (
    <AssistantSplitLayout
      icon={icon}
      title={title}
      subtitle={subtitle}
      badge={badge}
      backHref={backHref}
      initLoading={initLoading}
      initLoadingLabel={initLoadingLabel}
      error={error}
      pinFooter={pinFooter}
      controlsWidthClass="lg:w-[min(100%,400px)] xl:w-[420px]"
      leading={
        <div className="shrink-0 border-b border-[color:var(--separator-subtle)] bg-[var(--card-surface)]/80 px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[min(1680px,calc(100vw-2.5rem))]">{kpiBar}</div>
        </div>
      }
      controls={controls}
      results={results}
      footer={footer}
    />
  );
}
