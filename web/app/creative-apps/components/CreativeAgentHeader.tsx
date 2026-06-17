"use client";

import { useTranslation } from "@/hooks/useTranslation";
import { ArrowLeft, BookOpen, ExternalLink, Play, Loader2 } from "lucide-react";
import Link from "next/link";

interface CreativeAgentHeaderProps {
  appName: string;
  logo: string;
  category: string;
  installed?: boolean;
  running?: boolean;
  onLaunch?: () => void;
  docUrl?: string;
}

export function CreativeAgentHeader({
  appName,
  logo,
  category,
  installed,
  running,
  onLaunch,
  docUrl,
}: CreativeAgentHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="chrome-bar sticky top-0 z-20 flex h-14 items-center justify-between px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <Link
          href="/creative-apps"
          className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
          aria-label={t("creativeApps.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2.5">
          <img src={logo} alt={appName} className="h-7 w-7 object-contain" />
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold leading-tight text-[color:var(--foreground)]">
              {appName}
            </span>
            <span className="text-[10px] leading-tight text-[color:var(--label-secondary)]">
              {t(`creativeApps.categories.${category}`, { default: category })}
            </span>
          </div>
        </div>
        {typeof installed === "boolean" && (
          <span
            className={`ml-1 hidden rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline-block ${
              installed
                ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)]"
                : "bg-[var(--status-warning-bg)] text-[var(--status-warning-text)]"
            }`}
          >
            {installed ? t("creativeApps.installed") : t("creativeApps.notInstalled")}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {onLaunch && (
          <button
            type="button"
            onClick={onLaunch}
            disabled={running}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[color:var(--accent)] px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
            <span className="hidden sm:inline">{t("creativeApps.launchApp")}</span>
          </button>
        )}
        {docUrl && (
          <a
            href={docUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 text-[12px] font-medium text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("creativeApps.docs")}</span>
            <ExternalLink className="h-3 w-3 opacity-60 sm:hidden" />
          </a>
        )}
      </div>
    </header>
  );
}
