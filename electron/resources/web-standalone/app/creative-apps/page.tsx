"use client";

import { useTranslation } from "@/hooks/useTranslation";
import {
  ExternalLink,
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

interface CreativeAppProfile {
  id: string;
  name: string;
  category: string;
  script_languages: string[];
  typical_entrypoints: string[];
  risk_notes: string[];
  capability_id: string;
  doc_urls: string[];
}

interface CreativeAppStatus {
  installed: boolean;
  executable_path?: string | null;
  profile?: CreativeAppProfile;
}

interface DesktopEnvironment {
  platform?: string;
  allowed_roots?: string[];
  creative_apps?: Record<string, CreativeAppStatus>;
  sidecar_available?: boolean;
  sidecar_port?: number | null;
  error?: string;
}

const APP_LOGO: Record<string, string> = {
  figma: "/logos/figma.svg",
  blender: "/logos/blender.svg",
  photoshop: "/logos/photoshop.svg",
  unity: "/logos/unity.svg",
  unreal: "/logos/unreal.svg",
};

function CreativeAppsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  const highlightApp = searchParams.get("app") || "";
  const [profiles, setProfiles] = useState<CreativeAppProfile[]>([]);
  const [environment, setEnvironment] = useState<DesktopEnvironment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccessMessage("");
    try {
      const [profilesRes, envRes] = await Promise.all([
        fetch("/api/creative-apps/profiles", { cache: "no-store" }),
        fetch("/api/desktop/environment", { cache: "no-store" }),
      ]);
      const profilesData = (await profilesRes.json().catch(() => ({}))) as {
        profiles?: CreativeAppProfile[];
      };
      const envData = (await envRes.json().catch(() => ({}))) as DesktopEnvironment;

      if (!profilesRes.ok) {
        const err = (profilesData as { error?: string; detail?: string }).error || (profilesData as { detail?: string }).detail;
        throw new Error(err || t("creativeApps.loadProfilesError"));
      }
      if (!envRes.ok) {
        throw new Error(envData.error || t("creativeApps.loadEnvError"));
      }

      setProfiles(profilesData.profiles || []);
      setEnvironment(envData);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("creativeApps.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (highlightApp && highlightRef.current) {
      const timer = setTimeout(() => {
        highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [highlightApp, loading]);

  const handleOpenApp = useCallback(
    async (profile: CreativeAppProfile) => {
      const installed = environment?.creative_apps?.[profile.id]?.installed ?? false;
      if (profile.id === "figma" && !installed) {
        window.open("https://www.figma.com/downloads", "_blank");
        return;
      }
      setRunningId(profile.id);
      setError("");
      setSuccessMessage("");
      try {
        const res = await fetch("/api/computer/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "launch_app",
            app_id: profile.name,
            metadata: { source: "creative_apps", app_id: profile.id },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          task_id?: string;
          status?: string;
          approval?: { id?: string } | null;
          error?: string;
          detail?: string;
          message?: string;
        };
        if (!res.ok || data.error) {
          throw new Error(data.detail || data.error || t("creativeApps.runFailed"));
        }
        if (data.approval?.id || data.status === "waiting_approval") {
          setSuccessMessage(t("creativeApps.launchPendingApproval", { name: profile.name }));
        } else {
          setSuccessMessage(t("creativeApps.launchSuccess", { name: profile.name }));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t("creativeApps.runFailed"));
      } finally {
        setRunningId(null);
      }
    },
    [environment, t],
  );

  const handleOpenDocs = useCallback((url: string) => {
    if (url) window.open(url, "_blank");
  }, []);

  const sortedProfiles = useMemo(() => {
    const list = [...profiles];
    if (highlightApp) {
      list.sort((a, b) => {
        if (a.id === highlightApp) return -1;
        if (b.id === highlightApp) return 1;
        return 0;
      });
    }
    return list;
  }, [profiles, highlightApp]);

  const getStatus = (profile: CreativeAppProfile): CreativeAppStatus | undefined => {
    return environment?.creative_apps?.[profile.id];
  };

  return (
    <div className="page-canvas px-6 py-8 sm:px-8">
      <div className="mb-8 flex items-start gap-3">
        <button
          onClick={() => router.back()}
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)]"
          aria-label={t("creativeApps.back")}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
            {t("creativeApps.title")}
          </h1>
          <p className="text-[13px] text-[color:var(--label-secondary)]">
            {t("creativeApps.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--label-secondary)] transition-colors hover:text-[color:var(--foreground)] disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("common.refresh")}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-[13px] text-green-700">
          {successMessage}
        </div>
      )}

      {loading && profiles.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-[color:var(--label-secondary)]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {t("creativeApps.loading")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedProfiles.map((profile) => {
            const status = getStatus(profile);
            const isInstalled = status?.installed ?? false;
            const isHighlighted = profile.id === highlightApp;
            const isRunning = runningId === profile.id;

            return (
              <div
                key={profile.id}
                ref={isHighlighted ? highlightRef : undefined}
                className={`card-surface flex flex-col rounded-2xl p-5 transition-[box-shadow,transform] duration-150 ${
                  isHighlighted ? "ring-2 ring-[color:var(--accent)]" : ""
                }`}
              >
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <img
                      src={APP_LOGO[profile.id] || "/logos/figma.svg"}
                      alt={profile.name}
                      className="h-10 w-10 object-contain"
                    />
                    <div>
                      <h2 className="text-[15px] font-semibold text-[color:var(--foreground)]">
                        {profile.name}
                      </h2>
                      <p className="text-[11px] text-[color:var(--label-secondary)]">
                        {t(`creativeApps.categories.${profile.category}`, {
                          default: profile.category,
                        })}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      isInstalled
                        ? "bg-green-100 text-green-700"
                        : "bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]"
                    }`}
                  >
                    {isInstalled ? (
                      <>
                        <ShieldCheck className="h-3 w-3" />
                        {t("creativeApps.installed")}
                      </>
                    ) : (
                      <>
                        <Monitor className="h-3 w-3" />
                        {t("creativeApps.notInstalled")}
                      </>
                    )}
                  </span>
                </div>

                <p className="mb-4 line-clamp-2 text-[12.5px] leading-relaxed text-[color:var(--label-secondary)]">
                  {t(`creativeApps.descriptions.${profile.id}`)}
                </p>

                <div className="mb-4 space-y-2">
                  <div>
                    <span className="text-[11px] font-medium text-[color:var(--foreground)]">
                      {t("creativeApps.scriptLanguages")}
                    </span>
                    <p className="text-[11px] text-[color:var(--label-secondary)]">
                      {profile.script_languages.join(" · ")}
                    </p>
                  </div>
                  {status?.executable_path && (
                    <div>
                      <span className="text-[11px] font-medium text-[color:var(--foreground)]">
                        {t("creativeApps.executablePath")}
                      </span>
                      <p className="line-clamp-1 text-[11px] font-mono text-[color:var(--label-secondary)]">
                        {status.executable_path}
                      </p>
                    </div>
                  )}
                  {profile.risk_notes.length > 0 && (
                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                      <strong>{t("creativeApps.riskNotes")}</strong>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {profile.risk_notes.map((note, idx) => (
                          <li key={idx}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleOpenApp(profile)}
                    disabled={isRunning}
                    className="flex items-center gap-1.5 rounded-lg bg-[color:var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[color:var(--accent)]/90 disabled:opacity-50"
                  >
                    {isRunning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {profile.id === "figma" && !isInstalled
                      ? t("creativeApps.openWeb")
                      : t("creativeApps.launchApp")}
                  </button>
                  <Link
                    href={`/creative-apps/${profile.id}/agent`}
                    className="flex items-center gap-1.5 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    {t("creativeApps.automation")}
                  </Link>
                  {profile.doc_urls[0] && (
                    <button
                      type="button"
                      onClick={() => handleOpenDocs(profile.doc_urls[0])}
                      className="flex items-center gap-1.5 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {t("creativeApps.docs")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[color:var(--separator-subtle)] pt-6">
        <span className="text-[12px] text-[color:var(--label-secondary)]">
          {t("creativeApps.moreTools")}
        </span>
        <Link
          href="/desktop-operator"
          className="text-[12px] font-medium text-[color:var(--accent)] hover:underline"
        >
          {t("nav.pageTitles.desktopOperator")} →
        </Link>
        <Link
          href="/workbench"
          className="text-[12px] font-medium text-[color:var(--accent)] hover:underline"
        >
          {t("nav.pageTitles.workbench")} →
        </Link>
      </div>
    </div>
  );
}

export default function CreativeAppsPage() {
  return (
    <Suspense
      fallback={
        <div className="page-canvas flex h-screen items-center justify-center text-[color:var(--label-secondary)]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading…
        </div>
      }
    >
      <CreativeAppsPageInner />
    </Suspense>
  );
}
