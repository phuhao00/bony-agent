"use client";

import { launchDesktopPet, mapLaunchError } from "@/lib/desktop-pet-launch";

// Web Speech API types (not in standard TS DOM lib)
interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  readonly length: number;
  [index: number]: SpeechRecognitionResultItem;
  isFinal: boolean;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
  _token?: symbol;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

import { ChatAttachmentMenu } from "@/components/ChatAttachmentMenu";
import { ChatWorkspaceContextStrip } from "@/components/ChatWorkspaceContextStrip";
import { MarkdownSummaryPreview } from "@/components/MarkdownSummaryPreview";
import {
    MoodPermissionDropdown,
    normalizeMoodPermission,
    patchCompanionMoodPermission,
    type MoodPermission,
} from "@/components/MoodPermissionDropdown";
import MultimodalInput, {
    type AttachedFile,
    type MultimodalInputHandle,
} from "@/components/MultimodalInput";
import OfficeBackground from "@/components/OfficeBackground";
import { usePrefs } from "@/contexts/PrefsContext";
import { useTranslation } from "@/hooks/useTranslation";
import { AnimatePresence, motion } from "framer-motion";
import {
    ArrowUp,
    ChevronLeft,
    Mic,
    MicOff,
    Volume2,
    VolumeX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

type MultiAgentTraceEvent = {
  type: string;
  next_agent?: string;
  agent_id?: string;
  guidance?: string;
  content?: string;
  response?: string;
  provider?: string;
  model?: string;
  trace_id?: string;
  completed_agents?: string[];
  detail?: string;
  media_url?: string;
};

type CompanionMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/** /companion/state 与后端 schema 对齐的子集 */
type CompanionStatePayload = {
  persona?: { name?: string; traits?: string; tone?: string };
  growth?: { level?: number; total_xp?: number; title?: string };
  mood?: { label?: string; note?: string; permission?: MoodPermission };
  pet?: {
    name?: string;
    species?: string;
    stage?: string;
    care_score?: number;
  };
  recent_feedback?: { at: number; kind: string; text: string }[];
};

const parseSseChunk = (
  chunk: string,
  onEvent: (event: MultiAgentTraceEvent) => void,
) => {
  const blocks = chunk.split("\n\n");
  const rest = blocks.pop() || "";

  for (const block of blocks) {
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6));
    if (!dataLines.length) continue;
    let parsed: MultiAgentTraceEvent;
    try {
      parsed = JSON.parse(dataLines.join("\n"));
    } catch {
      continue;
    }
    onEvent(parsed);
  }

  return rest;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** 从 Agent/工具返回文案中解析媒体 URL（长视频常用 `![…](/media/…mp4)` 或外链） */
function extractCompanionMediaUrlFromText(text: string): string {
  if (!text) return "";
  const mdParen = text.match(/!\[[^\]]*]\(\s*([^)]+)\s*\)/);
  if (mdParen) {
    const u = mdParen[1].trim().replace(/^["']|["']$/g, "");
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("/media/") || u.startsWith("/storage/outputs/")) return u;
  }
  const mdLink = text.match(
    /\[.*?]\(\s*(https?:\/\/[^)]+\.(?:jpg|jpeg|png|gif|webp|mp4|webm)[^)]*)\s*\)/i,
  );
  if (mdLink) return mdLink[1].trim();
  const mediaServe = text.match(/(\/media\/[^\s"'>)]+)/i);
  if (mediaServe) return mediaServe[1];
  const httpUrl = text.match(
    /https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|mp4|webm)(?:\?[^\s"')>]*)*/i,
  );
  if (httpUrl) return httpUrl[0];
  const localUrl = text.match(
    /\.?\/(?:[^/\s]*\/)*storage\/outputs\/([^\s"'>]+\.(?:mp4|webm|jpg|jpeg|png|gif|webp))/i,
  );
  if (localUrl) return `/storage/outputs/${localUrl[1]}`;
  return "";
}

/** Standalone bubble so expand/collapse state is local and survives parent re-renders */
function AssistantBubble({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 280;
  return (
    <div className="max-w-[92%] rounded-2xl border border-white/20 bg-white/10 px-4 py-3 shadow-xl backdrop-blur-2xl [--foreground:255_255_255] [color:rgb(var(--foreground))]">
      <div className={!expanded && isLong ? "max-h-[180px] overflow-hidden pointer-events-none" : ""}>
        <MarkdownSummaryPreview markdown={content} />
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 cursor-pointer text-[11px] text-white/60 transition hover:text-white/90 active:scale-95"
        >
          {expanded ? "收起 ▴" : "展开全文 ▾"}
        </button>
      )}
    </div>
  );
}

export default function CompanionPage() {
  const { prefs } = usePrefs();
  const { t } = useTranslation();
  const [panelOpen, setPanelOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const [isAwake, setIsAwake] = useState(false);
  const [isCompanionReady, setIsCompanionReady] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [, setAudioLevels] = useState<number[]>([0.2, 0.35, 0.5, 0.35, 0.2]);
  const [lastResponse, setLastResponse] = useState("");
  const [, setTraceInfo] = useState("");
  const [error, setError] = useState("");
  const [voiceLogs, setVoiceLogs] = useState<string[]>([]);
  const [showVoiceDebug, setShowVoiceDebug] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const mediaUrlRef = useRef("");
  const [permDenied, setPermDenied] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [companionState, setCompanionState] =
    useState<CompanionStatePayload | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [petLaunchHint, setPetLaunchHint] = useState<string | null>(null);
  const [petLaunching, setPetLaunching] = useState(false);
  const [moodDraft, setMoodDraft] = useState("");
  const [moodPermission, setMoodPermission] =
    useState<MoodPermission>("default");
  const [moodSaveStatus, setMoodSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [moodPermMenuOpen, setMoodPermMenuOpen] = useState(false);
  const moodPermMenuRef = useRef<HTMLDivElement>(null);
  const [composerPermOpen, setComposerPermOpen] = useState(false);
  const composerPermRef = useRef<HTMLDivElement>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const multimodalRef = useRef<MultimodalInputHandle>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const isThinkingRef = useRef(false);
  const isTalkingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const handleSendRef = useRef<(text?: string) => void>(() => {});
  const isListeningRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const startVoiceInputRef = useRef<() => void>(() => {});
  const voiceSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceAccumRef = useRef<string>("");
  /** Mic auto-restart after SR ends/errors — cleared when voice mode is toggled off */
  const micRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const buildWelcomeMessage = useCallback(
    (state: CompanionStatePayload | null) => {
      const name = state?.persona?.name?.trim() || "Nova";
      const title = state?.growth?.title?.trim();
      return t("chat.companionWelcome", {
        name,
        titleSuffix: title
          ? t("chat.companionWelcomeTitleSuffix", { title })
          : "",
      });
    },
    [t],
  );

  useEffect(() => {
    router.prefetch("/");
  }, [router]);

  const composerPlaceholder = useMemo(() => {
    const base = t("chat.companionInputPlaceholder");
    const hint =
      prefs.submitKey === "shift+enter"
        ? t("chat.companionSendHintShift")
        : prefs.submitKey === "cmd+enter"
          ? t("chat.companionSendHintCmd")
          : t("chat.companionSendHintEnter");
    return `${base}\n${hint}`;
  }, [prefs.submitKey, t]);

  useEffect(() => {
    let cancelled = false;

    const wakeCompanion = async () => {
      setIsAwake(false);
      setIsCompanionReady(false);
      setIsThinking(true);
      setLastResponse(t("chat.companionWaking"));

      const minAnimationMs = 900;
      const [stateData] = await Promise.all([
        fetch("/api/companion/state")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/multi-agent")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        new Promise<void>((resolve) => {
          setTimeout(resolve, minAnimationMs);
        }),
      ]);

      if (cancelled) return;

      const state =
        stateData && typeof stateData === "object"
          ? (stateData as CompanionStatePayload)
          : null;
      if (state) setCompanionState(state);

      setIsThinking(false);
      setIsAwake(true);
      setIsCompanionReady(true);
      setLastResponse(buildWelcomeMessage(state));
    };

    void wakeCompanion();
    return () => {
      cancelled = true;
    };
  }, [buildWelcomeMessage, t]);

  useEffect(() => {
    if (!profileOpen) return;
    const note = companionState?.mood?.note;
    setMoodDraft(typeof note === "string" ? note : "");
    setMoodPermission(
      normalizeMoodPermission(companionState?.mood?.permission),
    );
  }, [
    profileOpen,
    companionState?.mood?.note,
    companionState?.mood?.permission,
  ]);

  useEffect(() => {
    if (!profileOpen) setMoodPermMenuOpen(false);
    else setComposerPermOpen(false);
  }, [profileOpen]);

  useEffect(() => {
    if (!moodPermMenuOpen && !composerPermOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moodPermMenuRef.current?.contains(t)) return;
      if (composerPermRef.current?.contains(t)) return;
      setMoodPermMenuOpen(false);
      setComposerPermOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moodPermMenuOpen, composerPermOpen]);

  useEffect(() => {
    if (!companionState?.mood) return;
    setMoodPermission(normalizeMoodPermission(companionState.mood.permission));
  }, [companionState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, panelOpen]);

  useEffect(() => {
    mediaUrlRef.current = mediaUrl;
  }, [mediaUrl]);

  const vlog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const line = `[${ts}] ${msg}`;
    setVoiceLogs((prev) => [...prev.slice(-19), line]);
  }, []);

  const clearMicRestartTimer = useCallback(() => {
    if (micRestartTimerRef.current !== null) {
      clearTimeout(micRestartTimerRef.current);
      micRestartTimerRef.current = null;
    }
  }, []);

  /** Schedule SR restart only while voice mode is on and companion is idle */
  const scheduleMicRestart = useCallback(
    (delayMs: number, reason: string) => {
      clearMicRestartTimer();
      micRestartTimerRef.current = setTimeout(() => {
        micRestartTimerRef.current = null;
        if (!voiceModeRef.current) {
          vlog(`restart skipped (${reason}): voice mode off`);
          return;
        }
        if (mediaUrlRef.current) {
          vlog(`restart skipped (${reason}): media playing`);
          return;
        }
        if (isThinkingRef.current || isTalkingRef.current) {
          vlog(`restart skipped (${reason}): busy`);
          return;
        }
        vlog(`scheduled restart (${reason})`);
        startVoiceInputRef.current();
      }, delayMs);
    },
    [clearMicRestartTimer, vlog],
  );

  const stopAudioVisualizer = () => {
    cancelAnimationFrame(rafRef.current);
    audioStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    audioStreamRef.current = null;
    setAudioLevels([0.2, 0.35, 0.5, 0.35, 0.2]);
  };

  const startAudioVisualizer = async (existingStream?: MediaStream) => {
    try {
      const stream =
        existingStream ??
        (await navigator.mediaDevices.getUserMedia({ audio: true }));
      audioStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const bands = [0, 3, 7, 11, 15].map((i) =>
          Math.max(0.08, (data[i] ?? 0) / 255),
        );
        setAudioLevels(bands);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // fallback: random animation
      const tick = () => {
        setAudioLevels(
          Array.from({ length: 5 }, () => 0.1 + Math.random() * 0.9),
        );
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        window.speechSynthesis.cancel();
        recognitionRef.current?.abort();
        stopAudioVisualizer();
      }
    };
  }, []);

  const speak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    // Slightly slower + warmer pitch sounds much more natural than defaults
    utterance.rate = 0.88;
    utterance.pitch = 1.08;

    // Prefer high-quality Chinese voices (Edge/Windows Xiaoxiao, Google zh-CN, etc.)
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      const zhVoices = voices.filter((v) => v.lang.startsWith("zh"));
      return (
        zhVoices.find((v) => /Xiaoxiao|Xiaoyi|Yunxi|XiaoXiao/i.test(v.name)) ||
        zhVoices.find((v) => /Google/i.test(v.name)) ||
        zhVoices.find((v) => /Female|female/i.test(v.name)) ||
        zhVoices[0] ||
        null
      );
    };

    const chosen = pickVoice();
    if (chosen) utterance.voice = chosen;

    // Chrome bug: speechSynthesis silently stops after ~15 s on long utterances.
    // Fix: pause+resume heartbeat every 10 s keeps the engine alive.
    let keepAlive: ReturnType<typeof setInterval> | null = null;
    const clearKeepAlive = () => {
      if (keepAlive !== null) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
    };

    utterance.onstart = () => {
      isTalkingRef.current = true;
      setIsTalking(true);
      clearMicRestartTimer();
      // Stop mic while TTS is speaking to avoid feedback loop
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      isListeningRef.current = false;
      setIsListening(false);
      stopAudioVisualizer();

      keepAlive = setInterval(() => {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        } else {
          clearKeepAlive();
        }
      }, 10_000);
    };
    utterance.onend = () => {
      clearKeepAlive();
      isTalkingRef.current = false;
      setIsTalking(false);
      // Always re-open mic after TTS finishes (only when voice mode still on)
      if (voiceModeRef.current && !isListeningRef.current) {
        scheduleMicRestart(320, "tts-end");
      }
    };
    utterance.onerror = () => {
      clearKeepAlive();
      isTalkingRef.current = false;
      setIsTalking(false);
      if (voiceModeRef.current && !isListeningRef.current) {
        scheduleMicRestart(320, "tts-error");
      }
    };

    // Voices may not be loaded yet on first call — retry once after voiceschanged fires
    if (!chosen && window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.addEventListener(
        "voiceschanged",
        () => {
          const v = pickVoice();
          if (v) utterance.voice = v;
          window.speechSynthesis.speak(utterance);
        },
        { once: true },
      );
    } else {
      window.speechSynthesis.speak(utterance);
    }
  };

  const updateAssistantMessage = (id: string, content: string) => {
    setMessages((previous) =>
      previous.map((message) =>
        message.id === id ? { ...message, content } : message,
      ),
    );
  };

  const handleSend = async (overrideText?: string) => {
    const userText = (overrideText ?? input).trim();
    if ((!userText && attachedFiles.length === 0) || isThinking || !isCompanionReady)
      return;

    isThinkingRef.current = true;
    setPanelOpen(true);
    setError("");
    setTraceInfo("");

    const userMessage: CompanionMessage = {
      id: createId("user"),
      role: "user",
      content: userText,
    };
    const assistantId = createId("assistant");

    setMessages((previous) => [
      ...previous,
      userMessage,
      { id: assistantId, role: "assistant", content: t("chat.companionThinking") },
    ]);
    setInput("");
    setAttachedFiles([]);
    setIsThinking(true);

    const streamAbortCtrl = new AbortController();
    const streamTimeoutId = setTimeout(
      () => streamAbortCtrl.abort(new Error("Companion stream timed out after 90 seconds")),
      90_000,
    );

    try {
      const response = await fetch("/api/multi-agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: userText,
          messages: [{ role: "user", content: userText }],
          agent_id: undefined,
        }),
        signal: streamAbortCtrl.signal,
      });

      if (!response.ok || !response.body) {
        clearTimeout(streamTimeoutId);
        const errData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        throw new Error(
          errData.detail || errData.error || `Error ${response.status}`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";
      let finalResponse = "";
      // Accumulate ALL streamed text so we can find media URLs from intermediate steps
      let allStreamedText = "";
      let pendingStreamError: Error | undefined;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        buffer += decoder.decode(value || new Uint8Array(), {
          stream: !done,
        });

        buffer = parseSseChunk(buffer, (event) => {
          if (event.type === "metadata") {
            setTraceInfo(
              [event.agent_id, event.model || event.provider, event.trace_id]
                .filter(Boolean)
                .join(" · "),
            );
            return;
          }

          if (event.type === "decision") {
            updateAssistantMessage(
              assistantId,
              `正在分析请求，路由到最合适的 Agent...`,
            );
            return;
          }

          if (event.type === "agent_result") {
            const content = event.content || "";
            allStreamedText += "\n" + content;
            if (event.media_url) {
              setMediaUrl(event.media_url);
            } else {
              const fromText = extractCompanionMediaUrlFromText(content);
              if (fromText) setMediaUrl(fromText);
            }
            updateAssistantMessage(assistantId, content || `Agent 已就绪`);
            return;
          }

          if (event.type === "final") {
            finalResponse = (event.response || "").trim();
            allStreamedText += "\n" + finalResponse;
            if (event.media_url) {
              setMediaUrl(event.media_url);
            } else {
              const fromText = extractCompanionMediaUrlFromText(finalResponse);
              if (fromText) setMediaUrl(fromText);
            }
            updateAssistantMessage(
              assistantId,
              finalResponse || "暂未生成可展示的内容。",
            );
            return;
          }

          if (event.type === "error") {
            // Store the error instead of throwing — throw inside parseSseChunk's
            // callback is silently caught by its own try/catch for JSON parse errors.
            pendingStreamError = new Error(event.detail || "Companion stream failed");
          }
        });

        if (pendingStreamError) throw pendingStreamError;
      }
      clearTimeout(streamTimeoutId);

      const spoken = finalResponse || "我已经准备好了下一步任务。";
      setLastResponse(spoken);
      if (ttsEnabled) {
        speak(spoken.slice(0, 220));
      } else if (!isListeningRef.current) {
        scheduleMicRestart(320, "after-stream-no-tts");
      }
      // Extract generated media URL from ANY streamed event (video gen may come before publish)
      const combined = `${allStreamedText}\n${finalResponse}`;
      const extractedUrl = extractCompanionMediaUrlFromText(combined);
      if (extractedUrl) setMediaUrl(extractedUrl);
      void fetch("/api/companion/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ growth_add_xp: 3 }),
      })
        .then((r) => r.json())
        .then((data: unknown) => {
          if (
            data &&
            typeof data === "object" &&
            !("error" in data && (data as { error?: string }).error)
          ) {
            setCompanionState(data as CompanionStatePayload);
          }
        })
        .catch(() => {});
    } catch (streamError) {
      clearTimeout(streamTimeoutId);
      streamAbortCtrl.abort(); // ensure AbortController is released
      const message =
        streamError instanceof Error ? streamError.message : "请求失败";
      setError(message);
      updateAssistantMessage(assistantId, `请求失败：${message}`);
    } finally {
      isThinkingRef.current = false;
      setIsThinking(false);
    }
  };

  // Keep ref always pointing at latest handleSend (avoids stale closure in voice callback)
  handleSendRef.current = handleSend;

  const startVoiceInput = async () => {
    if (typeof window === "undefined") return;
    if (!voiceModeRef.current) {
      vlog("skip startVoiceInput: voice mode off");
      return;
    }
    if (mediaUrlRef.current) {
      vlog("⛔ Video is playing — voice input blocked");
      return;
    }
    clearMicRestartTimer();
    setShowVoiceDebug(true);
    vlog("startVoiceInput called");
    type SR = SpeechRecognitionConstructor;
    const SpeechRecognitionAPI =
      (window as unknown as Record<string, SR>)["SpeechRecognition"] ??
      (window as unknown as Record<string, SR>)["webkitSpeechRecognition"];

    if (!SpeechRecognitionAPI) {
      vlog("❌ SpeechRecognition API not found");
      setError("当前浏览器不支持语音输入，请使用 Chrome");
      return;
    }
    vlog(
      `✅ API found: ${"SpeechRecognition" in window ? "SpeechRecognition" : "webkitSpeechRecognition"}`,
    );
    if (isListeningRef.current) {
      vlog("Already listening → stopping");
      clearMicRestartTimer();
      isListeningRef.current = false;
      setIsListening(false);
      setInterimText("");
      stopAudioVisualizer();
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      return;
    }
    // Step 1: explicitly request microphone permission via getUserMedia.
    // SpeechRecognition.start() silently gets not-allowed if permission
    // hasn't been granted yet — getUserMedia shows the browser dialog.
    let micStream: MediaStream | undefined;
    try {
      vlog("Requesting getUserMedia permission...");
      const t0 = Date.now();
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      vlog(`✅ getUserMedia granted in ${Date.now() - t0}ms`);
      setPermDenied(false);
    } catch (e: unknown) {
      const name = e instanceof Error ? e.name : String(e);
      vlog(`❌ getUserMedia denied: ${name}`);
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setPermDenied(true);
      } else {
        setError(`麦克风访问失败: ${name}`);
      }
      return;
    }

    const stale = recognitionRef.current;
    if (stale) {
      try {
        stale.onstart = null;
        stale.onend = null;
        stale.onerror = null;
        stale.onresult = null;
        stale.abort();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    }

    const rec = new SpeechRecognitionAPI();
    recognitionRef.current = rec;
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = true; // 持续监听，避免Chrome自行切断造成计时混乱
    vlog(`rec created, lang=${rec.lang}`);
    const sessionToken = Symbol();
    rec._token = sessionToken;
    const isCurrentSession = () =>
      recognitionRef.current === rec && rec._token === sessionToken;
    const setListening = (v: boolean) => {
      isListeningRef.current = v;
      setIsListening(v);
    };
    rec.onstart = () => {
      vlog("onstart fired");
      if (!isCurrentSession()) {
        vlog("onstart: stale session, ignored");
        return;
      }
      setListening(true);
      // Only reset accum/timer on a fresh start (no accumulated text yet).
      // On session restart mid-utterance, preserve the 3s timer and accum.
      if (!voiceAccumRef.current) {
        setInterimText("");
        if (voiceSendTimerRef.current) {
          clearTimeout(voiceSendTimerRef.current);
          voiceSendTimerRef.current = null;
        }
      }
      startAudioVisualizer(micStream);
    };
    rec.onend = () => {
      vlog("onend fired");
      if (!isCurrentSession()) {
        vlog("onend: stale session, ignored");
        return;
      }
      setListening(false);
      // Don't clear interimText here if we still have accumulated text (mid-sentence)
      if (!voiceAccumRef.current) setInterimText("");
      stopAudioVisualizer();
      // Never flush here — let the 3s timer fire naturally.
      if (
        voiceModeRef.current &&
        !isThinkingRef.current &&
        !isTalkingRef.current
      ) {
        scheduleMicRestart(320, "sr-onend");
      }
    };
    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      vlog(`onerror: error="${event.error}" message="${event.message}"`);
      if (!isCurrentSession()) {
        vlog("onerror: stale session, ignored");
        return;
      }

      // User/code intentionally aborted — never auto-restart (was mis-triggered as recoverable)
      if (event.error === "aborted") {
        vlog("onerror: aborted — no auto-restart");
        setListening(false);
        stopAudioVisualizer();
        recognitionRef.current = null;
        if (!voiceModeRef.current) {
          if (voiceSendTimerRef.current) {
            clearTimeout(voiceSendTimerRef.current);
            voiceSendTimerRef.current = null;
          }
          voiceAccumRef.current = "";
        }
        return;
      }

      // Silence / idle timeout — restart without wiping debounce timer or accum
      if (event.error === "no-speech") {
        vlog("onerror: no-speech — scheduling restart");
        setListening(false);
        stopAudioVisualizer();
        scheduleMicRestart(280, "no-speech");
        return;
      }

      // Hard errors — reset voice compose state
      rec._token = undefined;
      setListening(false);
      setInterimText("");
      stopAudioVisualizer();
      if (voiceSendTimerRef.current) {
        clearTimeout(voiceSendTimerRef.current);
        voiceSendTimerRef.current = null;
      }
      voiceAccumRef.current = "";
      recognitionRef.current = null;
      const msg: Record<string, string> = {
        "not-allowed":
          "❌ 麦克风权限被拒绝 → 点地址栏🔒图标 → 麦克风 → 允许 → 刷新",
        network: "❌ 网络错误 → 请检查网络连接后重试，或刷新页面重新授权麦克风",
        "audio-capture": "❌ 找不到麦克风设备，请检查硬件",
        "service-not-allowed": "❌ 服务不可用 → 需要HTTPS或localhost",
      };
      const tip = msg[event.error] ?? `语音识别错误：${event.error}`;
      if (event.error === "not-allowed") {
        setPermDenied(true);
      } else if (tip) {
        setError(tip);
      }
    };
    rec.onresult = (event: SpeechRecognitionEvent) => {
      vlog(
        `onresult: resultIndex=${event.resultIndex} results=${event.results.length}`,
      );
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        vlog(`  result[${i}] isFinal=${event.results[i].isFinal} text="${t}"`);
        if (event.results[i].isFinal) {
          voiceAccumRef.current = (voiceAccumRef.current + " " + t).trim();
        } else {
          interim += t;
        }
      }

      // 显示已确认+进行中文本
      const display = (
        voiceAccumRef.current + (interim ? " " + interim : "")
      ).trim();
      setInterimText(display || interim);
      if (voiceAccumRef.current) setInput(voiceAccumRef.current);

      // 每次收到任何语音片段（包括 interim）都重置3s计时器
      // 只要用户还在说话，计时器就不会触发
      if (voiceSendTimerRef.current) clearTimeout(voiceSendTimerRef.current);

      if (voiceAccumRef.current) {
        vlog(`⏱ 3s timer reset, accum="${voiceAccumRef.current}"`);
        voiceSendTimerRef.current = setTimeout(() => {
          const text = voiceAccumRef.current.trim();
          if (!text) return;
          vlog(`✅ 3s silence → sending: "${text}"`);
          voiceAccumRef.current = "";
          setInterimText("");
          setPanelOpen(true);
          handleSendRef.current(text);
        }, 3000);
      }
    };
    try {
      rec.start();
      vlog("rec.start() called");
    } catch (e) {
      vlog(`❌ rec.start() threw: ${e}`);
      recognitionRef.current = null;
      setListening(false);
      stopAudioVisualizer();
      const msg = e instanceof Error ? e.message : String(e);
      setError(`启动语音识别失败: ${msg}`);
      if (voiceModeRef.current) {
        scheduleMicRestart(450, "rec-start-retry");
      }
    }
  };

  // Keep ref in sync so speak() callback can call it without stale closure
  startVoiceInputRef.current = startVoiceInput;

  const isFirstMediaUrlMount = useRef(true);

  // Stop voice input when video starts; resume when video closes
  useEffect(() => {
    if (isFirstMediaUrlMount.current) {
      isFirstMediaUrlMount.current = false;
      return; // skip initial mount — mediaUrl starts as "" but no video was ever playing
    }
    if (mediaUrl) {
      clearMicRestartTimer();
      // Video opened — kill mic immediately
      if (isListeningRef.current) {
        vlog("⛈ Video started — stopping voice input");
        recognitionRef.current?.abort();
        recognitionRef.current = null;
        isListeningRef.current = false;
        setIsListening(false);
        setInterimText("");
        stopAudioVisualizer();
      }
      // Also cancel any queued TTS so it doesn't compete
      window.speechSynthesis?.cancel();
    } else {
      // Video closed — restart mic after short delay if not already thinking/talking
      vlog("▶ Video closed — restarting voice input");
      scheduleMicRestart(420, "media-closed");
    }
  }, [clearMicRestartTimer, mediaUrl, scheduleMicRestart, vlog]);

  // Keep voiceModeRef in sync with voiceMode state
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  useEffect(() => {
    isTalkingRef.current = isTalking;
  }, [isTalking]);

  const persistMoodPermission = async (next: MoodPermission) => {
    setMoodPermission(next);
    const r = await patchCompanionMoodPermission(next);
    if (r.ok && r.data && typeof r.data === "object") {
      setCompanionState(r.data as CompanionStatePayload);
    }
  };

  const saveProfileMood = async () => {
    if (moodSaveStatus === "saving") return;
    setMoodSaveStatus("saving");
    try {
      const r = await fetch("/api/companion/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mood: { note: moodDraft, permission: moodPermission },
        }),
      });
      const data = await r.json();
      if (
        data &&
        typeof data === "object" &&
        !("error" in data && data.error)
      ) {
        setCompanionState(data as CompanionStatePayload);
        setMoodSaveStatus("saved");
        setTimeout(() => setMoodSaveStatus("idle"), 2000);
      } else {
        setMoodSaveStatus("error");
        setTimeout(() => setMoodSaveStatus("idle"), 2500);
      }
    } catch {
      setMoodSaveStatus("error");
      setTimeout(() => setMoodSaveStatus("idle"), 2500);
    }
  };

  const profileArchiveFeedback = (companionState?.recent_feedback ?? []).filter(
    (fb) => fb.kind !== "reflection",
  );

  const handleLaunchDesktopPet = useCallback(async () => {
    setPetLaunching(true);
    setPetLaunchHint(null);
    try {
      const result = await launchDesktopPet();
      setPetLaunchHint(
        result.message ||
          (result.ok
            ? result.mode === "already_running"
              ? "桌宠已在运行"
              : "桌宠正在启动…"
            : mapLaunchError(result.error) || result.error || "启动失败"),
      );
    } finally {
      setPetLaunching(false);
      window.setTimeout(() => setPetLaunchHint(null), 8000);
    }
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0D1B2A] text-white">
      <OfficeBackground
        mode="script"
        isThinking={isThinking}
        isTalking={isTalking}
        isSummoned={
          isAwake || panelOpen || isThinking || isTalking || !isCompanionReady
        }
        onCharacterClick={() => {
          setIsAwake(true);
          setPanelOpen(true);
        }}
        mediaUrl={mediaUrl}
        onMediaClose={() => setMediaUrl("")}
      />

      {/* Back button */}
      <button
        type="button"
        onClick={() => {
          flushSync(() => setMediaUrl(""));
          window.speechSynthesis?.cancel();
          clearMicRestartTimer();
          recognitionRef.current?.abort();
          recognitionRef.current = null;
          isListeningRef.current = false;
          router.push("/");
        }}
        className="pointer-events-auto absolute left-5 top-5 z-[60] flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-3 py-2 text-[12px] font-medium text-white/80 backdrop-blur-md transition hover:bg-black/45 hover:text-white"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        主界面
      </button>

      <button
        type="button"
        onClick={() => void handleLaunchDesktopPet()}
        disabled={petLaunching}
        title="启动 Boni 桌宠 Sidecar（透明置顶小窗）"
        className="pointer-events-auto absolute right-[5.5rem] top-5 z-[60] rounded-full border border-cyan-400/25 bg-cyan-950/40 px-3 py-2 text-[12px] font-medium text-cyan-100/90 backdrop-blur-md transition hover:bg-cyan-900/50 hover:text-white disabled:opacity-60 sm:right-28"
      >
        {petLaunching ? "启动中…" : "启动桌宠"}
      </button>

      <button
        type="button"
        onClick={() => setProfileOpen((o) => !o)}
        className="pointer-events-auto absolute right-5 top-5 z-[60] rounded-full border border-white/15 bg-black/30 px-3 py-2 text-[12px] font-medium text-white/80 backdrop-blur-md transition hover:bg-black/45 hover:text-white"
      >
        档案
        {companionState?.growth?.level != null ? (
          <span className="ml-1.5 text-violet-300">
            Lv.{companionState.growth.level}
          </span>
        ) : null}
      </button>

      {petLaunchHint ? (
        <p className="pointer-events-none absolute right-5 top-[4.5rem] z-[60] max-w-[14rem] rounded-lg border border-cyan-400/20 bg-black/55 px-2.5 py-1.5 text-[11px] leading-snug text-cyan-100/90 backdrop-blur-md">
          {petLaunchHint}
        </p>
      ) : null}

      <AnimatePresence>
        {profileOpen ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="pointer-events-auto absolute right-5 top-14 z-20 w-[min(100vw-2.5rem,18rem)] rounded-2xl border border-white/18 bg-zinc-950/95 p-4 text-left shadow-xl shadow-black/40 backdrop-blur-xl"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-violet-200">
                伙伴档案
              </span>
              <button
                type="button"
                onClick={() => setProfileOpen(false)}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-zinc-100/95 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white hover:ring-white/20"
              >
                关闭
              </button>
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-zinc-200">
              {companionState?.persona?.name ?? "小助手"}
              {companionState?.growth?.title
                ? ` · ${companionState.growth.title}`
                : ""}
              {companionState?.growth?.total_xp != null
                ? ` · XP ${companionState.growth.total_xp}`
                : ""}
            </p>
            {(companionState?.pet?.name || companionState?.pet?.species) && (
              <p className="mb-3 text-[11px] text-cyan-100">
                宠物
                {companionState?.pet?.name
                  ? `「${companionState.pet.name}」`
                  : ""}
                {companionState?.pet?.species
                  ? ` · ${companionState.pet.species}`
                  : ""}
              </p>
            )}
            <label className="mb-1.5 block text-[11px] font-medium text-zinc-300">
              心情备忘（可审计）
            </label>
            <div className="mb-2">
              <MoodPermissionDropdown
                value={moodPermission}
                open={moodPermMenuOpen}
                onOpenChange={(o) => {
                  setMoodPermMenuOpen(o);
                  if (o) setComposerPermOpen(false);
                }}
                onPick={(next) => void persistMoodPermission(next)}
                containerRef={moodPermMenuRef}
                triggerId="mood-permission-trigger"
                menuId="mood-permission-menu"
                menuVariant="onDark"
                iconOnlyTrigger
                triggerClassName="flex w-fit items-center gap-1 rounded-full border border-white/15 bg-black/35 px-2.5 py-2 text-zinc-50 backdrop-blur-sm transition hover:bg-black/45"
              />
            </div>
            <textarea
              value={moodDraft}
              onChange={(e) => setMoodDraft(e.target.value)}
              rows={3}
              maxLength={2000}
              className="text-on-dark-surface mb-2 w-full resize-none rounded-xl border border-white/18 bg-zinc-900/90 px-3 py-2.5 text-[13px] leading-snug text-zinc-50 caret-violet-400 focus:border-violet-400/60 focus:outline-none focus:ring-1 focus:ring-violet-400/35"
              placeholder="今日状态、提醒、复盘一句…"
            />
            <button
              type="button"
              onClick={() => void saveProfileMood()}
              disabled={moodSaveStatus === "saving"}
              className={[
                "flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-medium text-white transition",
                moodSaveStatus === "saved"
                  ? "bg-emerald-600"
                  : moodSaveStatus === "error"
                    ? "bg-red-600"
                    : "bg-violet-600/90 hover:bg-violet-500 disabled:opacity-60",
              ].join(" ")}
            >
              {moodSaveStatus === "saving" && (
                <svg
                  className="h-3.5 w-3.5 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              )}
              {moodSaveStatus === "saved" && (
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              {moodSaveStatus === "saving"
                ? "保存中…"
                : moodSaveStatus === "saved"
                  ? "已保存"
                  : moodSaveStatus === "error"
                    ? "保存失败，重试"
                    : "保存备忘"}
            </button>
            {profileArchiveFeedback.length > 0 ? (
              <div className="mt-3 max-h-24 overflow-y-auto border-t border-white/10 pt-2">
                <p className="mb-1 text-[11px] font-medium text-zinc-300">
                  档案动态
                </p>
                {profileArchiveFeedback.slice(0, 4).map((fb) => (
                  <p
                    key={`${fb.at}-${fb.text.slice(0, 12)}`}
                    className="mb-1 text-[11px] leading-relaxed text-zinc-200"
                  >
                    {fb.text.slice(0, 120)}
                    {fb.text.length > 120 ? "…" : ""}
                  </p>
                ))}
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Voice debug panel — temporarily disabled */}
      {false && showVoiceDebug && (
        <div className="pointer-events-auto absolute right-4 top-4 z-50 w-80 rounded-2xl border border-white/10 bg-black/80 p-3 backdrop-blur-xl">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              🎙 Voice Debug
            </span>
            <button
              type="button"
              onClick={() => setShowVoiceDebug(false)}
              className="text-white/40 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {voiceLogs.length === 0 ? (
              <p className="text-[10px] text-white/30">点击麦克风开始…</p>
            ) : (
              voiceLogs.map((l, i) => (
                <p
                  key={i}
                  className="text-[10px] leading-4 text-white/70 font-mono break-all"
                >
                  {l}
                </p>
              ))
            )}
          </div>
        </div>
      )}

      {/* Microphone permission guide */}
      <AnimatePresence>
        {permDenied && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <div className="mx-4 w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/20">
                <MicOff className="h-6 w-6 text-rose-400" />
              </div>
              <h3 className="mb-1 text-base font-bold text-white">
                麦克风被系统屏蔽
              </h3>
              <p className="mb-4 text-xs leading-5 text-slate-400">
                Chrome 删掉无效，因为{" "}
                <strong className="text-amber-400">macOS 系统</strong>还没授权
                Chrome 使用麦克风。先做第一步。
              </p>

              {/* Step 1: macOS */}
              <div className="mb-3 rounded-2xl bg-slate-800 p-4">
                <p className="mb-2 text-xs font-bold text-amber-400">
                  ① 先开 macOS 系统权限（最关键）
                </p>
                <ol className="space-y-1.5 text-xs text-slate-300">
                  <li>
                    苹果菜单 <span className="text-slate-400">→</span>{" "}
                    <strong>系统设置</strong>{" "}
                    <span className="text-slate-400">→</span> 隐私与安全性
                  </li>
                  <li>
                    <strong>麦克风</strong>{" "}
                    <span className="text-slate-400">→</span> 找到{" "}
                    <strong className="text-sky-300">Google Chrome</strong>{" "}
                    <span className="text-slate-400">→</span> 开关打开
                  </li>
                  <li>
                    Chrome 会提示退出重启，点
                    <strong className="text-emerald-400">退出并重新打开</strong>
                  </li>
                </ol>
              </div>

              {/* Step 2: Chrome */}
              <div className="mb-4 rounded-2xl bg-slate-800 p-4">
                <p className="mb-2 text-xs font-bold text-slate-400">
                  ② 再清 Chrome 站点权限（如仍不行）
                </p>
                <p className="text-xs text-slate-400">
                  地址栏输入{" "}
                  <code className="select-all rounded bg-slate-700 px-1 text-sky-300">
                    chrome://settings/content/microphone
                  </code>
                  ，删掉 localhost:3000
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPermDenied(false);
                    window.location.reload();
                  }}
                  className="flex-1 rounded-xl bg-sky-500 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-400"
                >
                  完成，刷新重试
                </button>
                <button
                  type="button"
                  onClick={() => setPermDenied(false)}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-400 transition hover:text-white"
                >
                  取消
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating Chat History (bottom-right panel) — hidden while media plays ── */}
      <AnimatePresence>
        {messages.length > 0 && !mediaUrl && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="pointer-events-auto absolute right-4 bottom-28 z-10 w-[340px] max-h-[50vh]"
          >
            {/* Decorative top-fade — pointer-events-none so it never blocks clicks */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 rounded-t-2xl bg-gradient-to-b from-black/0 to-transparent" />
            <div className="flex h-full max-h-[50vh] flex-col-reverse overflow-y-auto">
              <div className="flex flex-col gap-2.5 py-2 px-1">
                {messages.map((message, idx) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: idx * 0.02 }}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {message.role === "user" ? (
                      <div className="max-w-[82%] rounded-2xl border border-slate-200/70 bg-white/90 px-3.5 py-2 text-[13px] leading-6 text-gray-900 shadow-sm backdrop-blur-xl [text-shadow:none]">
                        {message.content}
                      </div>
                    ) : (
                      <AssistantBubble content={message.content} />
                    )}
                  </motion.div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Nova Speech Bubble — hidden while media plays or chat panel has messages ── */}
      <AnimatePresence>
        {lastResponse && !mediaUrl && messages.length === 0 && (
          <motion.div
            key={lastResponse}
            initial={{ opacity: 0, y: 20, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="pointer-events-none absolute left-[8%] top-[22%] z-10 max-w-[38vw]"
          >
            <div className="relative overflow-hidden rounded-[24px] border border-white/15 bg-black/55 px-6 py-4 text-sm leading-7 text-white shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl [overflow-wrap:anywhere]">
              {lastResponse.length > 120
                ? `${lastResponse.slice(0, 120)}…`
                : lastResponse}
              {/* Tail pointing toward character */}
              <div className="absolute -bottom-2.5 left-10 h-5 w-5 rotate-45 border-b border-r border-white/15 bg-black/55" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Interim transcript bubble ── */}
      <AnimatePresence>
        {interimText && (
          <motion.div
            key="interim"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            className="pointer-events-none absolute bottom-36 left-1/2 z-10 -translate-x-1/2 rounded-2xl border border-white/20 bg-black/60 px-5 py-2.5 text-center text-sm leading-6 text-white/90 shadow-lg backdrop-blur-xl"
          >
            {interimText}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-4 pb-[max(14px,calc(env(safe-area-inset-bottom,0px)+10px))]">
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-2 rounded-xl border border-rose-400/20 bg-black/60 px-4 py-2 text-xs text-rose-300 backdrop-blur-xl"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex w-full max-w-[640px] flex-col overflow-visible rounded-[18px] border border-white/50 bg-white/85 shadow-[0_8px_48px_rgba(0,0,0,0.28)] ring-1 ring-black/[0.06] backdrop-blur-xl transition-[box-shadow,ring-color] focus-within:ring-2 focus-within:ring-[color:rgba(255,149,0,0.28)] focus-within:ring-offset-2 focus-within:ring-offset-white/70">
          <MultimodalInput
            ref={multimodalRef}
            value={input}
            onChange={setInput}
            onKeyDown={(e) => {
              const sk = prefs.submitKey;
              const isEnter = e.key === "Enter";
              const triggered =
                (sk === "enter" &&
                  isEnter &&
                  !e.shiftKey &&
                  !e.metaKey &&
                  !e.ctrlKey) ||
                (sk === "shift+enter" && isEnter && e.shiftKey) ||
                (sk === "cmd+enter" &&
                  isEnter &&
                  (e.metaKey || e.ctrlKey));
              if (triggered) {
                e.preventDefault();
                void handleSendRef.current();
              }
            }}
            files={attachedFiles}
            onFilesChange={setAttachedFiles}
            placeholder={composerPlaceholder}
            rows={2}
            className="[&_textarea]:nova-light-composer-input [&_textarea]:min-h-[36px] [&_textarea]:py-0.5 [&_textarea]:text-[13px] [&_textarea]:leading-5 [&_textarea]:px-3 [&_textarea]:pt-2 [&_textarea]:pb-1"
          />
          {/* 与主对话页 ChatInputToolbar 一致：附件为 Plus / 展开为 ChevronUp（避免出现易被误认为「清除会话」的 X） */}
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 sm:gap-3 sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <ChatAttachmentMenu
                multimodalRef={multimodalRef}
                surface="light"
                menuPlacement="auto"
                open={attachMenuOpen}
                onOpenChange={(next) => {
                  setAttachMenuOpen(next);
                  if (next) setComposerPermOpen(false);
                }}
              />
              <MoodPermissionDropdown
                value={moodPermission}
                preferMenuAbove
                open={composerPermOpen}
                onOpenChange={(o) => {
                  setComposerPermOpen(o);
                  if (o) {
                    setMoodPermMenuOpen(false);
                    setAttachMenuOpen(false);
                  }
                }}
                onPick={(next) => void persistMoodPermission(next)}
                containerRef={composerPermRef}
                triggerId="composer-mood-permission-trigger"
                menuId="composer-mood-permission-menu"
                menuVariant="onLight"
                iconOnlyTrigger
                triggerClassName="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 text-gray-900 shadow-sm transition-colors hover:bg-gray-100"
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title={
                  ttsEnabled ? t("chat.ttsOnTitle") : t("chat.ttsOffTitle")
                }
                onClick={() => {
                  const next = !ttsEnabled;
                  setTtsEnabled(next);
                  if (!next) window.speechSynthesis?.cancel();
                }}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:opacity-90 active:scale-[0.97] ${
                  ttsEnabled
                    ? "bg-violet-100 text-violet-600 hover:bg-violet-200"
                    : "bg-transparent text-gray-700 hover:bg-gray-100"
                }`}
              >
                {ttsEnabled ? (
                  <Volume2 className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
                ) : (
                  <VolumeX className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
                )}
              </button>
              <button
                type="button"
                disabled={!!mediaUrl}
                title={t("chat.voiceInputTitle")}
                aria-label={t("chat.voiceInputAria")}
                aria-pressed={voiceMode}
                onClick={() => {
                  if (mediaUrl) return;
                  const next = !voiceMode;
                  setVoiceMode(next);
                  voiceModeRef.current = next;
                  if (next) {
                    startVoiceInputRef.current();
                  } else {
                    clearMicRestartTimer();
                    if (voiceSendTimerRef.current) {
                      clearTimeout(voiceSendTimerRef.current);
                      voiceSendTimerRef.current = null;
                    }
                    voiceAccumRef.current = "";
                    recognitionRef.current?.abort();
                    recognitionRef.current = null;
                    isListeningRef.current = false;
                    setIsListening(false);
                    stopAudioVisualizer();
                  }
                }}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:opacity-90 active:scale-[0.97] ${
                  mediaUrl
                    ? "cursor-not-allowed text-gray-300"
                    : voiceMode
                      ? "bg-violet-600 text-white shadow-sm hover:bg-violet-500"
                      : "bg-transparent text-gray-900 hover:bg-gray-100"
                }`}
              >
                {voiceMode ? (
                  <MicOff className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
                ) : (
                  <Mic className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
                )}
              </button>
              <button
                type="button"
                disabled={
                  isThinking ||
                  !isCompanionReady ||
                  (!input.trim() && attachedFiles.length === 0)
                }
                title={t("chat.send")}
                aria-label={t("chat.send")}
                onClick={() => handleSend()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-900 shadow-sm ring-1 ring-black/10 transition hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:ring-0"
              >
                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
              </button>
            </div>
          </div>
          <ChatWorkspaceContextStrip className="!border-gray-100/90 !bg-white/55 !flex-nowrap !gap-2 !overflow-x-auto !py-1.5 [scrollbar-width:thin]" />
        </div>
      </div>
    </main>
  );
}
