"use client";

import { useTranslation } from "@/hooks/useTranslation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type WorkbenchTool = {
  toolKey: string;
  href: string;
  emoji: string;
  logo?: string;
};

type WorkbenchGroup = {
  id: string;
  tools: WorkbenchTool[];
};

const WORKBENCH_GROUPS: WorkbenchGroup[] = [
  {
    id: "content" as const,
    tools: [
      {
        toolKey: "script" as const,
        href: "/create/script",
        emoji: "📝",
      },
      {
        toolKey: "copywriting" as const,
        href: "/create/copywriting",
        emoji: "✍️",
      },
      {
        toolKey: "article" as const,
        href: "/create/article",
        emoji: "📄",
      },
      {
        toolKey: "podcast" as const,
        href: "/create/podcast",
        emoji: "🎙️",
      },
    ],
  },
  {
    id: "media" as const,
    tools: [
      { toolKey: "image" as const, href: "/media/image", emoji: "🖼️" },
      {
        toolKey: "imageEdit" as const,
        href: "/media/image-edit",
        emoji: "✂️",
      },
      {
        toolKey: "imageToPsd" as const,
        href: "/media/image-to-psd",
        emoji: "🧩",
      },
      { toolKey: "video" as const, href: "/media/video", emoji: "🎬" },
      {
        toolKey: "opencut" as const,
        href: "/media/opencut",
        emoji: "✂️",
      },
      {
        toolKey: "longVideo" as const,
        href: "/media/long-video",
        emoji: "🎞️",
      },
      {
        toolKey: "happyHorse" as const,
        href: "/media/happyhorse",
        emoji: "🐴",
      },
      {
        toolKey: "storyboard" as const,
        href: "/media/storyboard",
        emoji: "📋",
      },
      {
        toolKey: "autoVideo" as const,
        href: "/media/auto-video",
        emoji: "🎞️",
      },
      {
        toolKey: "shortDrama" as const,
        href: "/media/short-drama",
        emoji: "🎭",
      },
      {
        toolKey: "music" as const,
        href: "/media/music",
        emoji: "🎵",
      },
    ],
  },
  {
    id: "publish" as const,
    tools: [
      { toolKey: "workflows" as const, href: "/workflows", emoji: "🔀" },
      { toolKey: "pipeline" as const, href: "/pipeline", emoji: "⚡" },
      { toolKey: "scheduler" as const, href: "/scheduler", emoji: "📅" },
      { toolKey: "platforms" as const, href: "/platforms", emoji: "📱" },
    ],
  },
  {
    id: "ops" as const,
    tools: [
      {
        toolKey: "financialNews" as const,
        href: "/financial-news",
        emoji: "📈",
      },
      { toolKey: "aiNews" as const, href: "/ai-news", emoji: "🤖" },
      { toolKey: "trending" as const, href: "/trending", emoji: "🔥" },
      { toolKey: "knowledge" as const, href: "/knowledge", emoji: "📚" },
      { toolKey: "moderation" as const, href: "/moderation", emoji: "🛡️" },
      { toolKey: "history" as const, href: "/history", emoji: "🕐" },
    ],
  },
  {
    id: "creative" as const,
    tools: [
      { toolKey: "figma" as const, href: "/creative-apps?app=figma", emoji: "🎨", logo: "/logos/figma.svg" },
      { toolKey: "blender" as const, href: "/creative-apps?app=blender", emoji: "🧊", logo: "/logos/blender.svg" },
      { toolKey: "photoshop" as const, href: "/creative-apps?app=photoshop", emoji: "🖌️", logo: "/logos/photoshop.svg" },
      { toolKey: "unity" as const, href: "/creative-apps?app=unity", emoji: "🎮", logo: "/logos/unity.svg" },
      { toolKey: "unreal" as const, href: "/creative-apps?app=unreal", emoji: "🛸", logo: "/logos/unreal.svg" },
    ],
  },
];

type GroupId = (typeof WORKBENCH_GROUPS)[number]["id"];

export default function WorkbenchPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [filter, setFilter] = useState<GroupId | "all">("all");

  const visible =
    filter === "all"
      ? WORKBENCH_GROUPS
      : WORKBENCH_GROUPS.filter((g) => g.id === filter);

  const tabs = useMemo(
    () => [
      { id: "all" as const, label: t("workbench.filterAll") },
      ...WORKBENCH_GROUPS.map((g) => ({
        id: g.id,
        label: t(`workbench.groups.${g.id}`),
      })),
    ],
    [t],
  );

  return (
    <div className="page-canvas px-6 py-8 sm:px-8">
      <div className="mb-8 flex items-start gap-3">
        <button
          onClick={() => router.back()}
          className="mt-1 flex items-center justify-center w-8 h-8 rounded-xl text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)] transition-colors shrink-0"
          aria-label="返回"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
            {t("workbench.title")}
          </h1>
          <p className="text-[13px] text-[color:var(--label-secondary)]">
            {t("workbench.subtitle")}
          </p>
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
                {t(`workbench.groups.${group.id}`)}
              </h2>
              <span className="rounded-full bg-[var(--nav-active-fill)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--label-secondary)]">
                {t("workbench.toolCount", { count: group.tools.length })}
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
                        alt={t(`workbench.tools.${tool.toolKey}.name`)}
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
                      {t(`workbench.tools.${tool.toolKey}.name`)}
                    </p>
                    <p className="line-clamp-2 text-[11.5px] leading-relaxed text-[color:var(--label-secondary)]">
                      {t(`workbench.tools.${tool.toolKey}.desc`)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[color:var(--separator-subtle)] pt-6">
        <span className="text-[12px] text-[color:var(--label-secondary)]">
          {t("workbench.quickLinks")}
        </span>
        <Link
          href="/workflows"
          className="text-[12px] font-medium text-[color:var(--accent)] hover:underline"
        >
          {t("nav.workflows")} →
        </Link>
        <Link
          href="/"
          className="text-[12px] font-medium text-[color:var(--accent)] hover:underline"
        >
          {t("nav.pageTitles.root")} →
        </Link>
        <Link
          href="/companion"
          className="text-[12px] font-medium text-[color:var(--accent)] hover:underline"
        >
          {t("nav.companion")} →
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
