"use client";

import { useTranslation } from "@/hooks/useTranslation";
import { loadContextSettings, saveContextSettings, type ContextSettings } from "@/lib/contextSettings";
import type { MemoryLayout } from "@/lib/contextNavigation";
import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: (settings: ContextSettings) => void;
}

export default function ContextSettingsDialog({ open, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ContextSettings>(loadContextSettings());

  useEffect(() => {
    if (open) setSettings(loadContextSettings());
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    const saved = saveContextSettings(settings);
    onSaved?.(saved);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 backdrop-blur-[1px] sm:items-center">
      <button
        type="button"
        aria-label={t("settings.context.closeAria")}
        className="absolute inset-0 cursor-default bg-transparent"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-labelledby="ctx-settings-title"
        className="popover-vibrant relative z-10 w-full max-w-md rounded-2xl p-5"
      >
        <h2 id="ctx-settings-title" className="text-[15px] font-semibold text-[color:var(--foreground)]">
          {t("settings.context.dialogTitle")}
        </h2>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-[12px] font-medium text-[color:var(--foreground)]">
              {t("settings.context.settingDefaultLayout")}
            </span>
            <select
              value={settings.defaultMemoryLayout}
              onChange={(e) =>
                setSettings((s) => ({ ...s, defaultMemoryLayout: e.target.value as MemoryLayout }))
              }
              className="mt-1.5 w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[13px]"
            >
              <option value="list">{t("settings.context.memoryLayoutList")}</option>
              <option value="browser">{t("settings.context.memoryLayoutBrowser")}</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-[color:var(--foreground)]">
              {t("settings.context.settingGraphRefresh")}
            </span>
            <select
              value={String(settings.graphAutoRefreshSec)}
              onChange={(e) =>
                setSettings((s) => ({ ...s, graphAutoRefreshSec: Number(e.target.value) }))
              }
              className="mt-1.5 w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[13px]"
            >
              <option value="0">{t("settings.context.settingGraphRefreshOff")}</option>
              <option value="15">15s</option>
              <option value="30">30s</option>
              <option value="60">60s</option>
            </select>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-[13px] text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
          >
            {t("settings.context.close")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-xl bg-[color:var(--accent)] px-4 py-2 text-[13px] font-medium text-white shadow-sm hover:opacity-92"
          >
            {t("settings.context.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
