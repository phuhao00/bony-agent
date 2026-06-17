"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "@/hooks/useTranslation";
import {
  extractWorkflowIdFromPath,
  readRecents,
  reconcileWorkflowRecentsWithApi,
  SIDEBAR_RECENTS_CHANGED,
  type RecentEntry,
  writeRecents,
} from "@/lib/sidebar-recents";
import type { LucideIcon } from "lucide-react";
import {
    ChevronDown,
    ChevronUp,
    Fingerprint,
    FlaskConical,
    FolderOpen,
    GitBranch,
    LayoutDashboard,
    MessageSquare,
    Monitor,
    PanelLeft,
    PanelRight,
    Search,
    Settings as SettingsGear,
    SlidersHorizontal,
    Sparkles,
    Users,
    Wrench,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** pathname → i18n key for recent items */
const PATH_TITLE_KEY: Record<string, string> = {
  "/": "nav.pageTitles.root",
  "/companion": "nav.pageTitles.companion",
  "/workbench": "nav.pageTitles.workbench",
  "/labs": "nav.pageTitles.labs",
  "/pipeline": "nav.pageTitles.pipeline",
  "/scheduler": "nav.pageTitles.scheduler",
  "/financial-news": "nav.pageTitles.financialNews",
  "/ai-news": "nav.pageTitles.aiNews",
  "/trending": "nav.pageTitles.trending",
  "/knowledge": "nav.pageTitles.knowledge",
  "/history": "nav.pageTitles.history",
  "/moderation": "nav.pageTitles.moderation",
  "/create/script": "nav.pageTitles.createScript",
  "/create/copywriting": "nav.pageTitles.createCopywriting",
  "/create/article": "nav.pageTitles.createArticle",
  "/create/podcast": "nav.pageTitles.createPodcast",
  "/media/image": "nav.pageTitles.mediaImage",
  "/media/image-edit": "nav.pageTitles.mediaImageEdit",
  "/media/image-hd": "nav.pageTitles.mediaImageHd",
  "/media/image-to-psd": "nav.pageTitles.mediaImageToPsd",
  "/media/video": "nav.pageTitles.mediaVideo",
  "/media/opencut": "nav.pageTitles.mediaOpenCut",
  "/media/long-video": "nav.pageTitles.mediaLongVideo",
  "/media/happyhorse": "nav.pageTitles.mediaHappyHorse",
  "/media/storyboard": "nav.pageTitles.mediaStoryboard",
  "/media/auto-video": "nav.pageTitles.mediaAutoVideo",
  "/media/short-drama": "nav.pageTitles.mediaShortDrama",
  "/media/music": "nav.pageTitles.mediaMusic",
  "/computer-use": "nav.pageTitles.computerUse",
  "/system-assistant": "nav.pageTitles.systemAssistant",
  "/desktop-operator": "nav.pageTitles.desktopOperator",
  "/programmer": "nav.pageTitles.programmer",
  "/product-manager": "nav.pageTitles.productManager",
  "/legal-advisor": "nav.pageTitles.legalAdvisor",
  "/ad-campaign": "nav.pageTitles.adCampaign",
  "/business-partnership": "nav.pageTitles.businessPartnership",
  "/procurement-assistant": "nav.pageTitles.procurementAssistant",
  "/game-art": "nav.pageTitles.gameArt",
  "/game-design": "nav.pageTitles.gameDesign",
  "/claude-code": "nav.pageTitles.claudeCode",
  "/openclaw": "nav.pageTitles.openclaw",
  "/hermes-agent": "nav.pageTitles.hermesAgent",
  "/platforms": "nav.pageTitles.platforms",
  "/lark-cli": "nav.pageTitles.larkCli",
  "/creative-apps": "nav.pageTitles.creativeApps",
  "/creative-apps/figma/agent": "nav.pageTitles.creativeAppFigma",
  "/creative-apps/blender/agent": "nav.pageTitles.creativeAppBlender",
  "/creative-apps/photoshop/agent": "nav.pageTitles.creativeAppPhotoshop",
  "/creative-apps/unity/agent": "nav.pageTitles.creativeAppUnity",
  "/creative-apps/unreal/agent": "nav.pageTitles.creativeAppUnreal",
  "/architecture": "nav.pageTitles.architecture",
  "/workflows": "nav.pageTitles.workflows",
  "/workflows/new": "nav.pageTitles.workflowNew",
  "/meal": "nav.pageTitles.mealReceipt",
  "/customer-service": "nav.pageTitles.customerService",
};

export type { RecentEntry } from "@/lib/sidebar-recents";

function recentTitle(
  r: RecentEntry,
  t: (key: string) => string,
  pageFallback: string,
): string {
  if (r.titleKey) return t(r.titleKey);
  if (r.title) return r.title;
  const wfId = r.workflowId ?? extractWorkflowIdFromPath(r.href);
  if (wfId) return t("nav.workflowRecentUntitled");
  return pageFallback;
}

// ── Nav structure ──────────────────────────────────────
type NavChild = { nameKey: string; href: string; emoji: string };
type NavGroup = {
  id: string;
  nameKey: string;
  Icon: LucideIcon;
  href?: string;
  children?: NavChild[];
  ownedPaths?: string[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "chat",
    nameKey: "nav.aiChat",
    Icon: MessageSquare,
    href: "/",
  },
  {
    id: "companion",
    nameKey: "nav.companion",
    Icon: Sparkles,
    href: "/companion",
  },
  {
    id: "workbench",
    nameKey: "nav.workbench",
    Icon: LayoutDashboard,
    href: "/workbench",
    ownedPaths: [
      "/create",
      "/create/podcast",
      "/media",
      "/media/short-drama",
      "/media/music",
      "/pipeline",
      "/scheduler",
      "/platforms",
      "/financial-news",
      "/ai-news",
      "/trending",
      "/knowledge",
      "/moderation",
      "/history",
      "/creative-apps",
    ],
  },
  {
    id: "labs",
    nameKey: "nav.labs",
    Icon: FlaskConical,
    href: "/labs",
    ownedPaths: [
      "/customer-service",
      "/computer-use",
      "/system-assistant",
      "/desktop-operator",
      "/programmer",
      "/product-manager",
      "/legal-advisor",
      "/ad-campaign",
      "/business-partnership",
      "/procurement-assistant",
      "/game-art",
      "/game-design",
      "/claude-code",
      "/openclaw",
      "/hermes-agent",
      "/lark-cli",
      "/meal",
    ],
  },
  {
    id: "workflows",
    nameKey: "nav.workflows",
    Icon: GitBranch,
    href: "/workflows",
    ownedPaths: ["/workflows"],
  },
];

// ── Settings items ─────────────────────────────────────
const SETTINGS_MAIN: { nameKey: string; href: string; Icon: LucideIcon }[] = [
  { nameKey: "nav.capabilities", href: "/settings/capabilities", Icon: Wrench },
  { nameKey: "nav.myComputer", href: "/settings/my-computer", Icon: Monitor },
  { nameKey: "nav.myContext", href: "/settings/context", Icon: Fingerprint },
  {
    nameKey: "nav.chatPlatform",
    href: "/settings/chat-platform",
    Icon: MessageSquare,
  },
  {
    nameKey: "nav.customization",
    href: "/settings/customization",
    Icon: SlidersHorizontal,
  },
];

const SETTINGS_ADMIN: {
  nameKey: string;
  href: string;
  Icon: LucideIcon;
  adminOnly?: boolean;
}[] = [
  {
    nameKey: "nav.usersAdmin",
    href: "/settings/users",
    Icon: Users,
    adminOnly: true,
  },
];

// ── Component ──────────────────────────────────────────
export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout, isAdmin } = useAuth();
  const { t } = useTranslation();

  /** 仅控制下方导航/设置/列表的展开文案与密度；不参与顶栏与侧轨宽度 */
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(
    () => pathname?.startsWith("/settings") ?? false,
  );
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const next = new Set<string>();
    for (const group of NAV_GROUPS) {
      if (group.children?.some((child) => pathname?.startsWith(child.href))) {
        next.add(group.id);
      }
    }
    return next;
  });
  // SSR-safe recents: start empty (matches server), populate after mount
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  useEffect(() => {
    queueMicrotask(() => {
      if (
        !pathname ||
        pathname.startsWith("/settings") ||
        pathname === "/login"
      ) {
        setRecents(readRecents());
        return;
      }
      const titleKey = PATH_TITLE_KEY[pathname];
      const fallback =
        pathname.split("/").filter(Boolean).pop() ?? t("common.pageFallback");
      const wfId = extractWorkflowIdFromPath(pathname);

      let entry: RecentEntry;
      if (titleKey) {
        entry = { href: pathname, titleKey };
      } else if (wfId) {
        entry = { href: pathname, workflowId: wfId };
      } else {
        entry = { href: pathname, title: fallback };
      }

      const stored = readRecents();
      const next = [
        entry,
        ...stored.filter((r: RecentEntry) => r.href !== pathname),
      ].slice(0, 7);
      writeRecents(next);
      setRecents(next);
    });
  }, [pathname, t]);

  useEffect(() => {
    const bump = () => setRecents(readRecents());
    window.addEventListener(SIDEBAR_RECENTS_CHANGED, bump);
    return () => window.removeEventListener(SIDEBAR_RECENTS_CHANGED, bump);
  }, []);

  useEffect(() => {
    if (
      !pathname ||
      pathname.startsWith("/settings") ||
      pathname === "/login"
    ) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/workflows", { cache: "no-store" });
        if (!resp.ok || cancelled) return;
        const data = (await resp.json()) as { workflows?: { id: string; name: string }[] };
        const workflows = data.workflows;
        if (!Array.isArray(workflows) || cancelled) return;
        const merged = reconcileWorkflowRecentsWithApi(readRecents(), workflows);
        if (cancelled) return;
        writeRecents(merged);
        setRecents(merged);
      } catch {
        /* offline / backend down — keep local recents */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const isChildActive = useCallback(
    (href: string) => {
      if (!pathname) return false;
      return href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(href + "/");
    },
    [pathname],
  );

  const isGroupActive = useCallback(
    (group: NavGroup) => {
      if (group.href) {
        if (isChildActive(group.href)) return true;
        return (
          group.ownedPaths?.some(
            (p) => pathname === p || pathname?.startsWith(p + "/"),
          ) ?? false
        );
      }
      return (
        group.children?.some((child) => isChildActive(child.href)) ?? false
      );
    },
    [isChildActive, pathname],
  );

  return (
    <>
      <aside
        className={`chrome-rail relative flex h-screen shrink-0 flex-col overflow-x-visible transition-[width] duration-200 ease-out motion-reduce:transition-none ${
          navCollapsed ? "w-[3.625rem]" : "w-56"
        }`}
      >
        {/* 顶栏：与主区顶栏同为 chrome-bar，不收起态「卡片」装饰，避免与内容区顶栏割裂 */}
        <header
          className={`chrome-bar flex h-[58px] shrink-0 items-center gap-2 px-3 ${
            navCollapsed
              ? "pointer-events-none absolute left-0 top-0 z-[35] w-56"
              : "relative z-10 w-full"
          }`}
        >
          <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2">
            <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-lg ring-1 ring-[color:var(--separator-subtle)]">
              <Image
                src="/brand-logo.png"
                alt=""
                width={28}
                height={28}
                className="h-full w-full object-contain"
                priority
              />
            </div>
            <h1 className="min-w-0 flex-1 truncate text-left text-sm font-semibold tracking-tight text-[color:var(--foreground)]">
              {t("common.appName")}
            </h1>
            <button
              type="button"
              id="sidebar-nav-toggle"
              onClick={() => setNavCollapsed((c) => !c)}
              aria-expanded={!navCollapsed}
              aria-controls="sidebar-nav-panel"
              aria-label={
                navCollapsed
                  ? t("common.expandSidebar")
                  : t("common.collapseSidebar")
              }
              title={
                navCollapsed
                  ? t("common.expandSidebar")
                  : t("common.collapseSidebar")
              }
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[color:var(--accent)] transition-colors hover:bg-[var(--nav-active-fill)] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[color:rgba(255,149,0,0.35)]"
            >
              {navCollapsed ? (
                <PanelLeft className="h-5 w-5" strokeWidth={2.25} aria-hidden />
              ) : (
                <PanelRight
                  className="h-5 w-5"
                  strokeWidth={2.25}
                  aria-hidden
                />
              )}
            </button>
          </div>
        </header>

        <div
          className={`flex min-h-0 flex-1 flex-col border-r border-[color:var(--separator-subtle)] ${navCollapsed ? "pt-[58px]" : ""}`}
        >
          <div
            id="sidebar-nav-panel"
            className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
            role="region"
            aria-labelledby="sidebar-nav-toggle"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-2 py-3">
              <ul className="w-full shrink-0 space-y-0.5">
                {NAV_GROUPS.map((group) => {
                  const groupActive = isGroupActive(group);
                  const groupOpen = openGroups.has(group.id);

                  if (group.href) {
                    return (
                      <li key={group.id}>
                        <Link
                          href={group.href}
                          title={navCollapsed ? t(group.nameKey) : undefined}
                          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-150 ${
                            groupActive
                              ? "bg-[var(--nav-active-fill)] font-medium text-[color:var(--foreground)]"
                              : "text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
                          } ${navCollapsed ? "justify-center" : ""}`}
                        >
                          <group.Icon
                            className="h-[18px] w-[18px] shrink-0"
                            strokeWidth={1.75}
                          />
                          {!navCollapsed && (
                            <>
                              <span className="min-w-0 flex-1 truncate text-[13px]">
                                {t(group.nameKey)}
                              </span>
                              {groupActive && (
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
                              )}
                            </>
                          )}
                        </Link>
                      </li>
                    );
                  }

                  return (
                    <li key={group.id}>
                      {navCollapsed ? (
                        <Link
                          href={group.children![0].href}
                          title={t(group.nameKey)}
                          className={`flex items-center justify-center rounded-lg px-2.5 py-2 transition-colors duration-150 ${
                            groupActive
                              ? "bg-[var(--nav-active-fill)] text-[color:var(--foreground)]"
                              : "text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
                          }`}
                        >
                          <group.Icon
                            className="h-[18px] w-[18px] shrink-0"
                            strokeWidth={1.75}
                          />
                        </Link>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.id)}
                            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-150 ${
                              groupActive
                                ? "text-[color:var(--foreground)]"
                                : "text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
                            }`}
                          >
                            <group.Icon
                              className={`h-[18px] w-[18px] shrink-0 ${groupActive ? "text-[color:var(--accent)]" : ""}`}
                              strokeWidth={1.75}
                            />
                            <span
                              className={`min-w-0 flex-1 truncate text-[13px] ${groupActive ? "font-semibold" : ""}`}
                            >
                              {t(group.nameKey)}
                            </span>
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              className={`shrink-0 text-[color:var(--label-secondary)] transition-transform duration-200 ${groupOpen ? "rotate-90" : ""}`}
                            >
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          </button>
                          {groupOpen && (
                            <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-[color:var(--separator-subtle)] pl-2.5">
                              {group.children!.map((child) => {
                                const childActive = isChildActive(child.href);
                                return (
                                  <li key={child.href}>
                                    <Link
                                      href={child.href}
                                      className={`flex items-center gap-2 rounded-md py-1.5 pr-2 text-[12.5px] transition-colors duration-150 ${
                                        childActive
                                          ? "font-medium text-[color:var(--foreground)]"
                                          : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                                      }`}
                                    >
                                      <span className="text-sm leading-none">
                                        {child.emoji}
                                      </span>
                                      <span className="flex-1 truncate">
                                        {t(child.nameKey)}
                                      </span>
                                      {childActive && (
                                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
                                      )}
                                    </Link>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}

              </ul>

              {/* Recents */}
              {!navCollapsed && recents.length > 0 && (
                <div className="mt-5">
                  <div className="mb-1.5 flex items-center justify-between px-1">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                      {t("nav.recent")}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        title={t("nav.organizeFolders")}
                        className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
                      >
                        <FolderOpen
                          className="h-3.5 w-3.5"
                          strokeWidth={1.75}
                        />
                      </button>
                      <button
                        type="button"
                        title={t("nav.searchHistory")}
                        className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
                      >
                        <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                  <ul className="space-y-0.5">
                    {recents.map((r) => (
                      <li key={r.href}>
                        <Link
                          href={r.href}
                          className={`block truncate rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors ${
                            pathname === r.href
                              ? "bg-[var(--nav-active-fill)] font-medium text-[color:var(--foreground)]"
                              : "text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
                          }`}
                        >
                          {recentTitle(r, t, t("common.pageFallback"))}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Settings */}
              <div className="mt-3 border-t border-[color:var(--separator-subtle)] pt-3">
                {navCollapsed ? (
                  <Link
                    href="/settings/capabilities"
                    title={t("nav.settings")}
                    className={`flex w-full items-center justify-center rounded-lg px-2.5 py-2 transition-colors ${
                      pathname?.startsWith("/settings")
                        ? "bg-[var(--nav-active-fill)] text-[color:var(--foreground)]"
                        : "text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
                    }`}
                  >
                    <SettingsGear
                      className="h-[18px] w-[18px]"
                      strokeWidth={1.75}
                    />
                  </Link>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setSettingsOpen((v) => !v)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
                    >
                      <SettingsGear
                        className="h-[18px] w-[18px] shrink-0 text-[color:var(--label-secondary)]"
                        strokeWidth={1.75}
                      />
                      <span className="flex-1 text-[13px] font-medium">
                        {t("nav.settings")}
                      </span>
                      {settingsOpen ? (
                        <ChevronUp
                          className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)]"
                          strokeWidth={2}
                        />
                      ) : (
                        <ChevronDown
                          className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)]"
                          strokeWidth={2}
                        />
                      )}
                    </button>
                    {settingsOpen && (
                      <ul className="ml-3 mt-0.5 space-y-0.5 border-l border-[color:var(--separator-subtle)] pl-3">
                        {SETTINGS_MAIN.map(({ nameKey, href, Icon }) => {
                          const active =
                            pathname === href ||
                            pathname?.startsWith(href + "/");
                          return (
                            <li key={href}>
                              <Link
                                href={href}
                                className={`group flex items-center gap-2.5 rounded-md py-2 pr-2 text-[13px] transition-colors ${
                                  active
                                    ? "font-medium text-[color:var(--foreground)]"
                                    : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                                }`}
                              >
                                <Icon
                                  className={`h-[17px] w-[17px] shrink-0 ${
                                    active
                                      ? "text-[color:var(--accent)]"
                                      : "text-[color:var(--label-secondary)] group-hover:text-[color:var(--foreground)]"
                                  }`}
                                  strokeWidth={1.75}
                                />
                                <span className="truncate">{t(nameKey)}</span>
                                {active && (
                                  <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
                                )}
                              </Link>
                            </li>
                          );
                        })}
                        {SETTINGS_ADMIN.some(
                          (i) => !i.adminOnly || (user && isAdmin),
                        ) && (
                          <li className="list-none py-1">
                            <div className="my-2 h-px bg-[color:var(--separator-subtle)]" />
                          </li>
                        )}
                        {SETTINGS_ADMIN.map((item) => {
                          if (item.adminOnly && (!user || !isAdmin))
                            return null;
                          const active =
                            pathname === item.href ||
                            pathname?.startsWith(item.href + "/");
                          const { Icon } = item;
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                className={`group flex items-center gap-2.5 rounded-md py-2 pr-2 text-[13px] transition-colors ${
                                  active
                                    ? "font-medium text-[color:var(--foreground)]"
                                    : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                                }`}
                              >
                                <Icon
                                  className={`h-[17px] w-[17px] shrink-0 ${
                                    active
                                      ? "text-[color:var(--accent)]"
                                      : "text-[color:var(--label-secondary)] group-hover:text-[color:var(--foreground)]"
                                  }`}
                                  strokeWidth={1.75}
                                />
                                <span className="truncate">
                                  {t(item.nameKey)}
                                </span>
                                {active && (
                                  <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
                                )}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ─── User：轨内全宽，随 aside 宽窄变化 ─── */}
          <div className="relative w-full shrink-0 border-t border-[color:var(--separator-subtle)] p-3 pt-4">
            {navCollapsed ? (
              <button
                type="button"
                onClick={() => setNavCollapsed(false)}
                className="flex w-full items-center justify-center rounded-lg p-2 text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
                title={user?.username ?? t("common.expandSidebar")}
              >
                {user ? (
                  <div className="relative h-7 w-7 rounded-full bg-[color:var(--accent)] ring-2 ring-[color:var(--card-bg)]">
                    <span className="absolute inset-[6px] rounded-full bg-[color:var(--card-bg)]" />
                  </div>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                )}
              </button>
            ) : user ? (
              <>
                <button
                  onClick={() => setShowUserMenu((v) => !v)}
                  className="group flex w-full items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--nav-active-fill)]"
                >
                  <div className="relative h-7 w-7 shrink-0 rounded-full bg-[color:var(--accent)] ring-2 ring-[color:var(--chrome-rail-bg)]">
                    <span className="absolute inset-[6px] rounded-full bg-[color:var(--card-bg)]" />
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[12px] font-semibold text-[color:var(--foreground)]">
                      {user?.username ?? t("nav.notSignedIn")}
                    </p>
                    <p className="truncate text-[10px] text-[color:var(--label-secondary)]">
                      {user?.role === "admin"
                        ? t("nav.roleAdmin")
                        : user?.role === "editor"
                          ? t("nav.roleEditor")
                          : user
                            ? t("nav.roleReadonly")
                            : t("nav.clickToLogin")}
                    </p>
                  </div>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="shrink-0 text-[color:var(--label-secondary)] group-hover:text-[color:var(--foreground)]"
                  >
                    <path d="M6 9l6-6 6 6" />
                  </svg>
                </button>
                {showUserMenu && (
                  <div className="popover-surface absolute bottom-full left-2 right-2 z-50 mb-1 overflow-hidden rounded-xl py-1">
                    {user && isAdmin && (
                      <Link
                        href="/settings/users"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center gap-2.5 px-3 py-2 text-[12px] text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
                      >
                        <span>👥</span>
                        {t("nav.userManagement")}
                      </Link>
                    )}
                    {user && (
                      <Link
                        href="/settings/capabilities"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center gap-2.5 px-3 py-2 text-[12px] text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
                      >
                        <span>⚙️</span>
                        {t("nav.systemSettings")}
                      </Link>
                    )}
                    <div className="my-1 h-px bg-[color:var(--separator-subtle)]" />
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        logout();
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-red-500 transition-colors hover:bg-red-50"
                    >
                      <span>🚪</span>
                      {t("nav.logout")}
                    </button>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </aside>

    </>
  );
}
