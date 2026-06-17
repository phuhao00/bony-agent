"use client";

import { usePrefs } from "@/contexts/PrefsContext";
import { translate, type Locale } from "@/lib/i18n";
import { useCallback, useMemo } from "react";

export function useTranslation() {
  const { prefs } = usePrefs();
  const locale = (prefs.language === "en" ? "en" : "zh") as Locale;

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
    [locale],
  );

  return useMemo(() => ({ t, locale }), [t, locale]);
}
