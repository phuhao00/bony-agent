"use client";

import { useTranslation } from "@/hooks/useTranslation";
import { ArrowRight, Download, FileText, Lightbulb, Plug, Wrench } from "lucide-react";
import Link from "next/link";

interface PluginStatus {
  connected?: boolean;
  bridge_url?: string;
}

interface CreativeAgentSidebarProps {
  appName: string;
  category: string;
  installed?: boolean;
  quickPrompts: { key: string; text: string }[];
  onPromptClick: (text: string) => void;
  docUrl?: string;
  downloadUrl?: string;
  plugin?: PluginStatus | null;
}

export function CreativeAgentSidebar({
  appName,
  category,
  installed,
  quickPrompts,
  onPromptClick,
  docUrl,
  downloadUrl,
  plugin,
}: CreativeAgentSidebarProps) {
  const { t } = useTranslation();

  return (
    <aside className="chrome-rail chrome-rail-edge-left hidden w-[260px] flex-col overflow-y-auto p-4 lg:flex">
      <div className="mb-5">
        <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
          <Lightbulb className="h-3.5 w-3.5" />
          {t("creativeAgent.quickPrompts")}
        </h3>
        <div className="space-y-2">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt.key}
              type="button"
              onClick={() => onPromptClick(prompt.text)}
              className="group flex w-full items-center justify-between rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5 text-left text-[12px] text-[color:var(--foreground)] transition-colors hover:border-[color:var(--accent)]/40 hover:bg-[var(--nav-active-fill)]"
            >
              <span className="line-clamp-2 pr-2">{prompt.text}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--label-secondary)] opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
          <Wrench className="h-3.5 w-3.5" />
          {t("creativeAgent.appInfo")}
        </h3>
        <div className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-3 text-[12px]">
          <div className="mb-2 flex justify-between">
            <span className="text-[color:var(--label-secondary)]">{t("creativeAgent.appName")}</span>
            <span className="font-medium text-[color:var(--foreground)]">{appName}</span>
          </div>
          <div className="mb-2 flex justify-between">
            <span className="text-[color:var(--label-secondary)]">{t("creativeAgent.category")}</span>
            <span className="font-medium text-[color:var(--foreground)]">
              {t(`creativeApps.categories.${category}`, { default: category })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[color:var(--label-secondary)]">{t("creativeAgent.status")}</span>
            <span
              className={`font-medium ${
                installed ? "text-[var(--status-success-text)]" : "text-[var(--status-warning-text)]"
              }`}
            >
              {installed ? t("creativeApps.installed") : t("creativeApps.notInstalled")}
            </span>
          </div>
        </div>
      </div>

      {appName.toLowerCase() === "figma" && (
        <div className="mb-5">
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
            <Plug className="h-3.5 w-3.5" />
            {t("creativeAgent.plugin")}
          </h3>
          <div className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] p-3 text-[12px]">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[color:var(--label-secondary)]">{t("creativeAgent.status")}</span>
              <span
                className={`font-medium ${
                  plugin == null
                    ? "text-[color:var(--label-secondary)]"
                    : plugin.connected
                      ? "text-[var(--status-success-text)]"
                      : "text-[var(--status-warning-text)]"
                }`}
              >
                {plugin == null
                  ? t("creativeAgent.pluginConnecting")
                  : plugin.connected
                    ? t("creativeAgent.pluginConnected")
                    : t("creativeAgent.pluginNotConnected")}
              </span>
            </div>
            {plugin?.bridge_url && (
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="shrink-0 text-[color:var(--label-secondary)]">{t("creativeAgent.pluginBridgeUrl")}</span>
                <code className="truncate rounded bg-[var(--shell-bg)] px-1.5 py-0.5 text-[10px] text-[color:var(--foreground)]">
                  {plugin.bridge_url}
                </code>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
              {t("creativeAgent.pluginInstallHint")}
            </p>
          </div>
        </div>
      )}

      <div className="mt-auto space-y-2">
        {docUrl && (
          <a
            href={docUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[12px] text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
          >
            <FileText className="h-3.5 w-3.5 text-[color:var(--accent)]" />
            {t("creativeAgent.openDocs")}
          </a>
        )}
        {downloadUrl && !installed && (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[12px] text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
          >
            <Download className="h-3.5 w-3.5 text-[color:var(--accent)]" />
            {t("creativeAgent.downloadApp")}
          </a>
        )}
        <Link
          href="/desktop-operator"
          className="flex items-center gap-2 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[12px] text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
        >
          <Wrench className="h-3.5 w-3.5 text-[color:var(--accent)]" />
          {t("creativeAgent.openDesktopOperator")}
        </Link>
      </div>
    </aside>
  );
}
