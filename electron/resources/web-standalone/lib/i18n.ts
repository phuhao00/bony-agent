import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

export type Locale = "zh" | "en";

const dictionaries: Record<Locale, Record<string, unknown>> = {
  zh: zh as Record<string, unknown>,
  en: en as Record<string, unknown>,
};

function lookup(dict: Record<string, unknown>, key: string): unknown {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Resolve a dotted i18n key. Falls back to English, then to the key string.
 * Supports `{name}` placeholders in the resolved string.
 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let raw = lookup(dictionaries[locale], key);
  if (typeof raw !== "string" && locale !== "en") {
    raw = lookup(dictionaries.en, key);
  }
  let s = typeof raw === "string" ? raw : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
