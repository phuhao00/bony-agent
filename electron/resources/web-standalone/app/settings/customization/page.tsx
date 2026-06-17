"use client";

import { usePrefs, type Prefs } from "@/contexts/PrefsContext";
import { useTranslation } from "@/hooks/useTranslation";
import { useCallback, useState } from "react";

type Theme = Prefs["theme"];

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)] ${
        checked ? "bg-[color:var(--accent)]" : "bg-[color:var(--separator-subtle)]"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Row({
  label,
  desc,
  children,
  border = true,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
  border?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-3 ${
        border ? "border-t border-[color:var(--separator-subtle)]" : ""
      }`}
    >
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-[color:var(--foreground)]">{label}</p>
        {desc && (
          <p className="mt-0.5 text-[12px] leading-relaxed text-[color:var(--label-secondary)]">
            {desc}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SelectDropdown<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] py-1.5 pl-3 pr-8 text-[13px] text-[color:var(--foreground)] shadow-sm focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:rgba(255,149,0,0.2)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[color:var(--label-secondary)]">
        ▾
      </span>
    </div>
  );
}

export default function CustomizationSettingsPage() {
  const { prefs, update, resetAll } = usePrefs();
  const { t } = useTranslation();
  const [cleared, setCleared] = useState(false);

  const handleClearAll = useCallback(() => {
    if (!window.confirm(t("customization.confirmReset"))) return;
    resetAll();
    setCleared(true);
    setTimeout(() => setCleared(false), 2500);
  }, [resetAll, t]);

  const THEMES: { value: Theme; label: string }[] = [
    { value: "system", label: t("customization.themeSystem") },
    { value: "light", label: t("customization.themeLight") },
    { value: "dark", label: t("customization.themeDark") },
  ];

  return (
    <div className="page-canvas min-h-full">
      <div className="mx-auto w-full max-w-[960px] px-5 py-8 pb-24 md:px-8">
        <header className="mb-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-[color:var(--foreground)]">
            {t("customization.title")}
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--label-secondary)]">
            {t("customization.subtitle")}
          </p>
        </header>

        <div className="divide-y divide-[color:var(--separator-subtle)] overflow-hidden rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] shadow-sm">
          <section className="px-6 py-5">
            <h2 className="text-[15px] font-semibold text-[color:var(--foreground)]">
              {t("customization.appearance")}
            </h2>
            <p className="mt-0.5 text-[13px] text-[color:var(--label-secondary)]">
              {t("customization.appearanceDesc")}
            </p>
            <div className="mt-4 space-y-4">
              <Row label={t("customization.theme")} border={false}>
                <div className="flex rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-0.5">
                  {THEMES.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => update("theme", opt.value)}
                      className={`rounded-md px-4 py-1.5 text-[12.5px] font-medium transition-colors ${
                        prefs.theme === opt.value
                          ? "bg-[color:var(--foreground)] text-[color:var(--shell-bg)] shadow-sm"
                          : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row
                label={t("customization.language")}
                desc={t("customization.languageDesc")}
              >
                <SelectDropdown
                  value={prefs.language}
                  options={[
                    { value: "zh", label: t("customization.langZh") },
                    { value: "en", label: t("customization.langEn") },
                  ]}
                  onChange={(v) => update("language", v)}
                />
              </Row>
            </div>
          </section>

          <section className="px-6 py-5">
            <h2 className="text-[15px] font-semibold text-[color:var(--foreground)]">
              {t("customization.notifications")}
            </h2>
            <p className="mt-0.5 text-[13px] text-[color:var(--label-secondary)]">
              {t("customization.notificationsDesc")}
            </p>
            <div className="mt-4 space-y-0">
              <Row
                label={t("customization.desktopNotifications")}
                desc={t("customization.desktopNotificationsDesc")}
                border={false}
              >
                <Toggle
                  checked={prefs.desktopNotifications}
                  onChange={(v) => update("desktopNotifications", v)}
                />
              </Row>
              <Row
                label={t("customization.soundEffects")}
                desc={t("customization.soundEffectsDesc")}
              >
                <Toggle
                  checked={prefs.soundEffects}
                  onChange={(v) => update("soundEffects", v)}
                />
              </Row>
            </div>
          </section>

          <section className="px-6 py-5">
            <h2 className="text-[15px] font-semibold text-[color:var(--foreground)]">
              {t("customization.mediaOutput")}
            </h2>
            <p className="mt-0.5 text-[13px] text-[color:var(--label-secondary)]">
              {t("customization.mediaOutputDesc")}
            </p>
            <div className="mt-4 space-y-0">
              <Row
                label={t("customization.defaultImageQuality")}
                desc={t("customization.defaultImageQualityDesc")}
                border={false}
              >
                <SelectDropdown
                  value={prefs.defaultImageQuality}
                  options={[
                    { value: "standard", label: t("customization.qualityStandard") },
                    { value: "hd", label: t("customization.qualityHd") },
                    { value: "ultra", label: t("customization.qualityUltra") },
                  ]}
                  onChange={(v) => update("defaultImageQuality", v)}
                />
              </Row>
              <Row
                label={t("customization.defaultVideoRes")}
                desc={t("customization.defaultVideoResDesc")}
              >
                <SelectDropdown
                  value={prefs.defaultVideoRes}
                  options={[
                    { value: "720p", label: "720p" },
                    { value: "1080p", label: "1080p" },
                    { value: "4k", label: "4K" },
                  ]}
                  onChange={(v) => update("defaultVideoRes", v)}
                />
              </Row>
            </div>
          </section>

          <section className="px-6 py-5">
            <h2 className="text-[15px] font-semibold text-[color:var(--foreground)]">
              {t("customization.submitKeybinding")}
            </h2>
            <p className="mt-0.5 text-[13px] text-[color:var(--label-secondary)]">
              {t("customization.submitKeybindingDesc")}
            </p>
            <div className="mt-4">
              <Row
                label={t("customization.submitKey")}
                desc={t("customization.submitKeyDescEnter")}
                border={false}
              >
                <SelectDropdown
                  value={prefs.submitKey}
                  options={[
                    { value: "enter", label: t("customization.submitEnterDefault") },
                    { value: "shift+enter", label: t("customization.submitShiftEnter") },
                    { value: "cmd+enter", label: t("customization.submitCmdEnter") },
                  ]}
                  onChange={(v) => update("submitKey", v)}
                />
              </Row>
            </div>
          </section>

          <section className="px-6 py-5">
            <h2 className="text-[15px] font-semibold text-[color:var(--foreground)]">
              {t("customization.performance")}
            </h2>
            <p className="mt-0.5 text-[13px] text-[color:var(--label-secondary)]">
              {t("customization.performanceDesc")}
            </p>
            <div className="mt-4 space-y-0">
              <div className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13.5px] font-medium text-[color:var(--foreground)]">
                      {t("customization.maxParallelTasks")}
                    </p>
                    <p className="mt-0.5 text-[12px] text-[color:var(--label-secondary)]">
                      {t("customization.maxParallelTasksDesc")}
                    </p>
                  </div>
                  <span className="ml-4 w-8 text-right text-[13px] font-semibold text-[color:var(--accent)]">
                    {prefs.maxParallelTasks}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={prefs.maxParallelTasks}
                  onChange={(e) =>
                    update("maxParallelTasks", Number(e.target.value))
                  }
                  className="mt-3 w-full cursor-pointer accent-[color:var(--accent)]"
                />
                <div className="mt-1 flex justify-between text-[11px] text-[color:var(--label-secondary)]">
                  <span>1</span>
                  <span>50</span>
                </div>
              </div>
              <Row
                label={t("customization.streamResponses")}
                desc={t("customization.streamResponsesDesc")}
              >
                <Toggle
                  checked={prefs.streamResponses}
                  onChange={(v) => update("streamResponses", v)}
                />
              </Row>
              <Row
                label={t("customization.verboseLogging")}
                desc={t("customization.verboseLoggingDesc")}
              >
                <Toggle
                  checked={prefs.verboseLogging}
                  onChange={(v) => update("verboseLogging", v)}
                />
              </Row>
            </div>
          </section>

          <section className="px-6 py-5">
            <h2 className="text-[15px] font-semibold text-[color:var(--foreground)]">
              {t("customization.contentGeneration")}
            </h2>
            <p className="mt-0.5 text-[13px] text-[color:var(--label-secondary)]">
              {t("customization.contentGenerationDesc")}
            </p>
            <div className="mt-4">
              <Row
                label={t("customization.autoSaveDrafts")}
                desc={t("customization.autoSaveDraftsDesc")}
                border={false}
              >
                <Toggle
                  checked={prefs.autoSaveDrafts}
                  onChange={(v) => update("autoSaveDrafts", v)}
                />
              </Row>
            </div>
          </section>
        </div>

        <section className="mt-8 rounded-2xl border border-[color:rgba(255,59,48,0.35)] bg-[var(--card-bg)] px-6 py-5 shadow-sm">
          <h2 className="text-[15px] font-semibold text-[color:var(--foreground)]">
            {t("customization.dangerZone")}
          </h2>
          <p className="mt-0.5 text-[13px] text-[color:var(--label-secondary)]">
            {t("customization.dangerZoneDesc")}
          </p>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-[13.5px] font-medium text-[color:var(--foreground)]">
                {t("customization.resetAll")}
              </p>
              <p className="mt-0.5 text-[12px] text-[color:var(--label-secondary)]">
                {t("customization.resetAllDesc")}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClearAll}
              className="shrink-0 rounded-lg border border-[color:rgba(255,59,48,0.45)] bg-[color:rgba(255,59,48,0.08)] px-4 py-2 text-[13px] font-medium text-[color:var(--foreground)] transition-colors hover:bg-[color:rgba(255,59,48,0.14)]"
            >
              {cleared ? t("customization.cleared") : t("customization.clearAll")}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
