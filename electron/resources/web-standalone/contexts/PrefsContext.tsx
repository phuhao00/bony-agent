"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
export const PREFS_STORAGE_KEY = "agent.customization.v1";

export type Theme = "system" | "light" | "dark";
export type SubmitKey = "enter" | "shift+enter" | "cmd+enter";
export type ImageQuality = "standard" | "hd" | "ultra";
export type VideoRes = "720p" | "1080p" | "4k";
export type Language = "zh" | "en";

export type OnlineSearchMode = "smart" | "off";
export type KnowledgeMode = "smart" | "off" | "scoped";

export interface Prefs {
  theme: Theme;
  language: Language;
  desktopNotifications: boolean;
  soundEffects: boolean;
  maxParallelTasks: number;
  streamResponses: boolean;
  autoSaveDrafts: boolean;
  defaultImageQuality: ImageQuality;
  defaultVideoRes: VideoRes;
  submitKey: SubmitKey;
  verboseLogging: boolean;
  /** 联网：smart=结合对话判断是否需查证；off=不引导联网检索表述 */
  chatOnlineSearchMode: OnlineSearchMode;
  /** 知识库：smart=检索全部；scoped=仅检索 chatKnowledgeScope；off=关闭 */
  chatKnowledgeMode: KnowledgeMode;
  /** all | cat:{id} | doc:{id}，scoped 模式下生效 */
  chatKnowledgeScope: string;
  /** 「无界」创作：更易走创意延展；off 时更偏稳妥对齐 */
  chatUnboundMode: boolean;
  /** 向量记忆检索：对话中预取/调用 searchMemory */
  chatMemoryRecall: boolean;
  /** 会话历史归档（影响对话历史写入等）；仅前端与部分 API */
  chatMemoryEnabled: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "light",
  language: "zh",
  desktopNotifications: true,
  soundEffects: false,
  maxParallelTasks: 4,
  streamResponses: true,
  autoSaveDrafts: true,
  defaultImageQuality: "hd",
  defaultVideoRes: "1080p",
  submitKey: "enter",
  verboseLogging: false,
  chatOnlineSearchMode: "smart",
  chatKnowledgeMode: "smart",
  chatKnowledgeScope: "all",
  chatUnboundMode: false,
  chatMemoryRecall: true,
  chatMemoryEnabled: true,
};

function readStoredPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

// ─── Sound helpers ────────────────────────────────────────────────────────────
type SoundEvent = "send" | "complete" | "error";

const SOUND_CONFIGS: Record<
  SoundEvent,
  { freq: number; duration: number; gain: number; type: OscillatorType }
> = {
  send: { freq: 660, duration: 0.08, gain: 0.15, type: "sine" },
  complete: { freq: 880, duration: 0.18, gain: 0.18, type: "sine" },
  error: { freq: 200, duration: 0.28, gain: 0.2, type: "sawtooth" },
};

function playWebAudioBeep(event: SoundEvent) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx() as AudioContext;
    const { freq, duration, gain, type } = SOUND_CONFIGS[event];
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    vol.gain.setValueAtTime(gain, ctx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
    osc.onended = () => ctx.close();
  } catch {
    // AudioContext not available — silently ignore
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface PrefsContextValue {
  prefs: Prefs;
  update: <K extends keyof Prefs>(key: K, val: Prefs[K]) => void;
  resetAll: () => void;
  /** Fire a desktop notification (respects desktopNotifications pref) */
  notify: (title: string, body?: string) => void;
  /** Play a short beep sound (respects soundEffects pref) */
  playSound: (event: SoundEvent) => void;
  /** console.debug wrapper that respects verboseLogging pref */
  verboseLog: (...args: unknown[]) => void;
  /** Save current conversation to backend history (respects autoSaveDrafts pref) */
  saveDraft: (role: string, content: string, assistantContent?: string) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────
export function PrefsProvider({ children }: { children: React.ReactNode }) {
  // Always start with DEFAULT_PREFS on the server so SSR and client first render
  // produce identical HTML (avoids hydration mismatch).  After mount, overlay
  // whatever was saved in localStorage.
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    const stored = readStoredPrefs();
    setPrefs(stored);
  }, []);

  // ── persist ────────────────────────────────────────────────────────────────
  const update = useCallback(<K extends keyof Prefs>(key: K, val: Prefs[K]) => {
    setPrefs((p) => {
      const next = { ...p, [key]: val };
      try {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    localStorage.removeItem(PREFS_STORAGE_KEY);
    setPrefs(DEFAULT_PREFS);
  }, []);

  // ── theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.lang =
      prefs.language === "en" ? "en" : "zh-CN";
  }, [prefs.language]);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove("theme-light", "theme-dark");
    if (prefs.theme === "dark") {
      html.classList.add("theme-dark");
      html.style.colorScheme = "dark";
    } else if (prefs.theme === "light") {
      html.classList.add("theme-light");
      html.style.colorScheme = "light";
    } else {
      html.style.colorScheme = ""; // follow system
    }
  }, [prefs.theme]);

  // ── desktop notifications permission ──────────────────────────────────────
  useEffect(() => {
    if (!prefs.desktopNotifications) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [prefs.desktopNotifications]);

  // ── verbose logging global flag ────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__AGENT_VERBOSE__ = prefs.verboseLogging;
  }, [prefs.verboseLogging]);

  // ── helpers ────────────────────────────────────────────────────────────────
  const notify = useCallback(
    (title: string, body?: string) => {
      if (!prefs.desktopNotifications) return;
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      try {
        new Notification(title, { body, icon: "/favicon.ico", silent: false });
      } catch {
        /* ignore */
      }
    },
    [prefs.desktopNotifications],
  );

  const playSound = useCallback(
    (event: SoundEvent) => {
      if (!prefs.soundEffects) return;
      playWebAudioBeep(event);
    },
    [prefs.soundEffects],
  );

  const verboseLog = useCallback(
    (...args: unknown[]) => {
      if (!prefs.verboseLogging) return;
      console.debug("[Agent verbose]", ...args);
    },
    [prefs.verboseLogging],
  );

  const saveDraft = useCallback(
    (role: string, content: string, assistantContent?: string) => {
      if (!prefs.autoSaveDrafts || !prefs.chatMemoryEnabled) return;
      const messages = [
        { role, content },
        ...(assistantContent
          ? [{ role: "assistant", content: assistantContent }]
          : []),
      ];
      fetch("/api/chat/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, timestamp: new Date().toISOString() }),
      }).catch(() => {
        /* best-effort */
      });
    },
    [prefs.autoSaveDrafts, prefs.chatMemoryEnabled],
  );

  return (
    <PrefsContext.Provider
      value={{
        prefs,
        update,
        resetAll,
        notify,
        playSound,
        verboseLog,
        saveDraft,
      }}
    >
      {children}
    </PrefsContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within <PrefsProvider>");
  return ctx;
}
