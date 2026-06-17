/** Instant local wake greeting — no network required. */

import type { PetAnimation } from "./api";

export interface InstantWake {
  text: string;
  action: PetAnimation;
}

const CACHE_KEY = "ama_pet_companion_v1";

export function loadCachedCompanionName(): string {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return "波尼";
    const data = JSON.parse(raw) as { pet?: { name?: string }; persona?: { name?: string } };
    return (data.pet?.name || data.persona?.name || "波尼").trim() || "波尼";
  } catch {
    return "波尼";
  }
}

export function saveCachedCompanion(companion: unknown): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(companion));
  } catch {
    /* ignore quota */
  }
}

export function loadCachedCompanion(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function instantWakeGreeting(name = loadCachedCompanionName()): InstantWake {
  const hour = new Date().getHours();
  const n = name || "波尼";

  if (hour < 12) {
    return { text: `早安，${n}！我醒来啦～`, action: "cheer_up" };
  }
  if (hour >= 22) {
    return { text: `夜深了，${n} 还在陪你。`, action: "idle" };
  }
  return { text: `嗨，我是${n}，随时都可以聊～`, action: "talking" };
}
