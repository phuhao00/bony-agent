"use client";

import { useTranslation } from "@/hooks/useTranslation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type LabTool = { toolKey: string; href: string; emoji: string; logo?: string };
type LabGroup = { id: "assistants" | "automation" | "dev" | "experimental"; tools: LabTool[] };

type GroupId = LabGroup["id"];

const LABS_GROUPS: LabGroup[] = [
  {
    id: "assistants",
    tools: [
      { toolKey: "customerService" as const, href: "/customer-service", emoji: "💬" },
      { toolKey: "productManager" as const, href: "/product-manager", emoji: "💡" },
      { toolKey: "legalAdvisor" as const, href: "/legal-advisor", emoji: "⚖️" },
      { toolKey: "adCampaign" as const, href: "/ad-campaign", emoji: "📣" },
      { toolKey: "businessPartnership" as const, href: "/business-partnership", emoji: "🤝" },
      { toolKey: "procurementAssistant" as const, href: "/procurement-assistant", emoji: "🛒" },
      { toolKey: "gameArt" as const, href: "/game-art", emoji: "🎨" },
      { toolKey: "gameDesign" as const, href: "/game-design", emoji: "🎮" },
    ],
  },
  {
    id: "automation",
    tools: [
      { toolKey: "computerUse" as const, href: "/computer-use", emoji: "🖱️" },
      { toolKey: "systemAssistant" as const, href: "/system-assistant", emoji: "🛠️" },
      { toolKey: "desktopOperator" as const, href: "/desktop-operator", emoji: "🖥️" },
    ],
  },
  {
    id: "dev",
    tools: [
      { toolKey: "programmer" as const, href: "/programmer", emoji: "👨‍💻" },
      { toolKey: "claudeCode" as const, href: "/claude-code", emoji: "⌨️", logo: "/logos/claude.svg" },
    ],
  },
  {
    id: "experimental",
    tools: [
      { toolKey: "openClaw" as const, href: "/openclaw", emoji: "🦞", logo: "/logos/openclaw.svg" },
      { toolKey: "hermes" as const, href: "/hermes-agent", emoji: "☤", logo: "/logos/hermes.svg" },
      { toolKey: "larkCli" as const, href: "/lark-cli", emoji: "🧪", logo: "/logos/lark.svg" },
    ],
  },
];

export default function LabsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [filter, setFilter] = useState<GroupId | "all">("all");

  const visible =
    filter === "all" ? LABS_GROUPS : LABS_GROUPS.filter((g) => g.id === filter);

  const tabs = useMemo(
    () => [
      { id: "all" as const, label: t("labs.filterAll") },
      ...LABS_GROUPS.map((g) => ({
        id: g.id,
        label: t(`labs.groups.${g.id}`),
      })),
    ],
    [t],
  );

  return (
    <div className="page-canvas px-6 py-8 sm:px-8">
      <div className="mb-8 flex items-start gap-3">
        <button
          onClick={() => router.back()}
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
          aria-label="返回"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
            {t("labs.title")}
          </h1>
          <p className="text-[13px] text-[color:var(--label-secondary)]">{t("labs.subtitle")}</p>
        </div>
      </div>

      <div className="mb-7 flex flex-wrap items-center gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id as GroupId | "all")}
            className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
              filter === tab.id
                ? "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--shell-bg)] shadow-sm"
                : "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] text-[color:var(--label-secondary)] hover:border-[color:var(--separator)] hover:text-[color:var(--foreground)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-10">
        {visible.map((group) => (
          <section key={group.id}>
            <div className="mb-4 flex items-center gap-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[color:var(--accent)]" />
              <h2 className="text-[13px] font-semibold text-[color:var(--foreground)]">
                {t(`labs.groups.${group.id}`)}
              </h2>
              <span className="rounded-full bg-[var(--nav-active-fill)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--label-secondary)]">
                {t("labs.toolCount", { count: group.tools.length })}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {group.tools.map((tool) => (
                <Link
                  key={tool.href}
                  href={tool.href}
                  className="card-surface group flex flex-col gap-3 rounded-2xl p-4 transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-start justify-between">
                    {tool.logo ? (
                      <img
                        src={tool.logo}
                        alt={t(`labs.tools.${tool.toolKey}.name`)}
                        className="h-7 w-7 object-contain"
                      />
                    ) : (
                      <span className="text-2xl leading-none">{tool.emoji}</span>
                    )}
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="mt-0.5 shrink-0 text-[color:var(--label-secondary)] transition-colors group-hover:text-[color:var(--accent)]"
                    >
                      <path d="M7 17L17 7M17 7H7M17 7v10" />
                    </svg>
                  </div>
                  <div>
                    <p className="mb-0.5 text-[13.5px] font-semibold text-[color:var(--foreground)]">
                      {t(`labs.tools.${tool.toolKey}.name`)}
                    </p>
                    <p className="line-clamp-2 text-[11.5px] leading-relaxed text-[color:var(--label-secondary)]">
                      {t(`labs.tools.${tool.toolKey}.desc`)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[color:var(--separator-subtle)] pt-6">
        <span className="text-[12px] text-[color:var(--label-secondary)]">{t("labs.quickLinks")}</span>
        <Link
          href="/workbench"
          className="text-[12px] font-medium text-[color:var(--accent)] hover:underline"
        >
          {t("nav.workbench")} →
        </Link>
        <Link
          href="/workflows"
          className="text-[12px] font-medium text-[color:var(--accent)] hover:underline"
        >
          {t("nav.workflows")} →
        </Link>
        <Link
          href="/settings/capabilities"
          className="text-[12px] font-medium text-[color:var(--accent)] hover:underline"
        >
          {t("nav.capabilities")} →
        </Link>
      </div>
    </div>
  );
}
