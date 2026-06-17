/** Voice input — Web Speech (real-time) with MediaRecorder + backend STT fallback. */

import { transcribePetAudio } from "./api";

export type SpeechStatus = "idle" | "listening" | "transcribing" | "unsupported" | "error";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [alt: number]: { transcript: string };
    };
  };
};

const MIN_RECORD_MS = 450;
const MIN_BLOB_BYTES = 280;

function collapseFillerRepeats(text: string): string {
  return text.replace(/(\S)\1{3,}/g, "$1$1");
}

/** Clean up noisy Web Speech / STT output before showing in UI. */
export function normalizeTranscript(text: string): string {
  return collapseFillerRepeats(
    text
      .replace(/([。，！？、；：])\1+/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}

function hasMicApi(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

function isTauriShell(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return w.__TAURI__ != null || w.__TAURI_INTERNALS__ != null;
}

/** Tauri sets TAURI_ENV_PLATFORM to `darwin` on macOS (not `macos`). */
function isMacOsTauri(): boolean {
  const platform = import.meta.env.TAURI_ENV_PLATFORM;
  if (platform === "darwin" || platform === "macos" || platform === "ios") return true;
  if (typeof navigator !== "undefined" && isTauriShell()) {
    const ua = navigator.userAgent || "";
    if (/Mac OS X|Macintosh/i.test(ua)) return true;
  }
  return false;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  // macOS WebKit Web Speech triggers TCC; without Info.plist the process SIGABRTs.
  if (isMacOsTauri()) return null;
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  // macOS WKWebView often records reliably as AAC/mp4; webm/opus can yield empty blobs on stop.
  const candidates = isMacOsTauri()
    ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

function shouldPreferWebSpeech(): boolean {
  if (isMacOsTauri()) return false;
  return getSpeechRecognitionCtor() != null;
}

/** True when STT goes through backend after MediaRecorder (no live Web Speech). */
export function speechUsesBackendStt(): boolean {
  return isMacOsTauri();
}

function micConstraints(): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

export function isSpeechSupported(): boolean {
  if (!hasMicApi()) return false;
  return getSpeechRecognitionCtor() != null || typeof MediaRecorder !== "undefined";
}

export interface SpeechInputCallbacks {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onStatus?: (status: SpeechStatus, detail?: string) => void;
  /** 0–1 microphone level while listening */
  onVolume?: (level: number) => void;
}

export class PetSpeechInput {
  private recognition: SpeechRecognitionLike | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recorderChunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private volumeRaf = 0;
  private listening = false;
  private recordStartedAt = 0;
  private webSpeechText = "";
  private webSpeechInterim = "";
  private webSpeechStopping = false;
  private preferWebSpeech = shouldPreferWebSpeech();
  private callbacks: SpeechInputCallbacks | null = null;
  private recorderMimeType = "audio/webm";

  constructor(private lang = "zh-CN") {}

  get isListening() {
    return this.listening;
  }

  async start(callbacks: SpeechInputCallbacks): Promise<boolean> {
    if (!hasMicApi()) {
      callbacks.onStatus?.("unsupported", "当前环境不支持麦克风");
      return false;
    }

    this.stop(false);
    this.callbacks = callbacks;
    this.webSpeechText = "";
    this.webSpeechInterim = "";
    this.webSpeechStopping = false;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "unknown";
      callbacks.onStatus?.("error", name === "NotAllowedError" ? "not-allowed" : name);
      return false;
    }

    this.startVolumeMonitor(callbacks);

    if (this.preferWebSpeech) {
      const ok = this.startWebSpeech(callbacks);
      if (ok) return true;
      this.preferWebSpeech = false;
    }

    return this.startRecorder(callbacks);
  }

  private startVolumeMonitor(callbacks: SpeechInputCallbacks) {
    if (!this.mediaStream) return;
    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      const buf = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.analyser || !this.listening) return;
        this.analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const level = Math.min(1, sum / buf.length / 96);
        callbacks.onVolume?.(level);
        this.volumeRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* non-fatal */
    }
  }

  private stopVolumeMonitor() {
    cancelAnimationFrame(this.volumeRaf);
    this.volumeRaf = 0;
    this.analyser = null;
    void this.audioContext?.close();
    this.audioContext = null;
  }

  private startRecorder(callbacks: SpeechInputCallbacks): boolean {
    const mimeType = pickRecorderMime();
    if (!this.mediaStream || !mimeType) {
      this.stopVolumeMonitor();
      this.releaseStream();
      callbacks.onStatus?.("unsupported", "无法录制音频");
      return false;
    }

    this.recorderChunks = [];
    this.recordStartedAt = Date.now();
    this.recorderMimeType = mimeType;
    try {
      const rec = new MediaRecorder(this.mediaStream, { mimeType });
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) this.recorderChunks.push(ev.data);
      };
      rec.onerror = () => {
        this.listening = false;
        callbacks.onStatus?.("error", "record-failed");
      };
      rec.onstop = () => {
        void this.finishRecorder(mimeType, callbacks);
      };
      rec.start(100);
      this.mediaRecorder = rec;
      this.listening = true;
      callbacks.onStatus?.("listening");
      callbacks.onInterim?.("");
      return true;
    } catch (err) {
      this.stopVolumeMonitor();
      callbacks.onStatus?.("error", err instanceof Error ? err.message : String(err));
      this.releaseStream();
      return false;
    }
  }

  private async finishRecorder(mimeType: string, callbacks: SpeechInputCallbacks) {
    if (this.callbacks !== callbacks) return;
    this.listening = false;
    this.stopVolumeMonitor();
    this.releaseStream();

    const elapsed = Date.now() - this.recordStartedAt;
    const blob = new Blob(this.recorderChunks, { type: mimeType });
    this.recorderChunks = [];

    if (elapsed < MIN_RECORD_MS) {
      callbacks.onStatus?.("error", "recording-too-short");
      return;
    }
    if (blob.size < MIN_BLOB_BYTES) {
      callbacks.onStatus?.("error", "recording-too-quiet");
      return;
    }

    callbacks.onStatus?.("transcribing");
    try {
      const text = await transcribePetAudio(blob, mimeType, "zh");
      const trimmed = normalizeTranscript(text);
      if (!trimmed) {
        callbacks.onStatus?.("error", "no-speech");
        return;
      }
      callbacks.onInterim?.(trimmed);
      callbacks.onStatus?.("idle");
      callbacks.onFinal?.(trimmed);
    } catch (err) {
      this.handleSttError(err, callbacks);
    }
  }

  private startWebSpeech(callbacks: SpeechInputCallbacks): boolean {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || !this.mediaStream) return false;

    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = "";
      let finals = "";
      for (let i = 0; i < event.results.length; i++) {
        const piece = event.results[i]?.[0]?.transcript || "";
        if (event.results[i]?.isFinal) finals += piece;
        else interim += piece;
      }
      if (finals.trim()) {
        this.webSpeechText = (this.webSpeechText + finals).trim();
      }
      this.webSpeechInterim = interim.trim();
      const display = normalizeTranscript(
        [this.webSpeechText, this.webSpeechInterim].filter(Boolean).join(""),
      );
      if (display) callbacks.onInterim?.(display);
    };

    rec.onerror = (ev) => {
      const code = ev.error || "unknown";
      if (code === "aborted") return;
      if (code === "no-speech" && !this.webSpeechStopping) return;
      if (code === "not-allowed") {
        this.listening = false;
        callbacks.onStatus?.("error", "not-allowed");
        return;
      }
      if (!this.webSpeechStopping && (code === "network" || code === "service-not-allowed")) {
        this.listening = false;
        this.recognition = null;
        this.preferWebSpeech = false;
        void this.startRecorder(callbacks);
        return;
      }
      if (this.webSpeechStopping) return;
      this.listening = false;
      callbacks.onStatus?.("error", code);
    };

    rec.onend = () => {
      this.listening = false;
      this.stopVolumeMonitor();
      this.releaseStream();

      if (this.webSpeechStopping) {
        const text = normalizeTranscript(
          [this.webSpeechText, this.webSpeechInterim].filter(Boolean).join(""),
        );
        this.webSpeechStopping = false;
        if (text) {
          callbacks.onStatus?.("idle");
          callbacks.onFinal?.(text);
        } else {
          callbacks.onStatus?.("error", "no-speech");
        }
      }
    };

    try {
      rec.start();
      this.recognition = rec;
      this.listening = true;
      this.recordStartedAt = Date.now();
      callbacks.onStatus?.("listening");
      callbacks.onInterim?.("");
      return true;
    } catch {
      this.recognition = null;
      return false;
    }
  }

  private handleSttError(err: unknown, callbacks: SpeechInputCallbacks) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("未设置") ||
      msg.includes("未配置") ||
      msg.includes("API_KEY") ||
      msg.includes("DASHSCOPE") ||
      msg.includes("ALIBABA") ||
      msg.includes("ZHIPUAI")
    ) {
      callbacks.onStatus?.("error", "stt-unconfigured");
    } else if (msg.includes("超时") || msg.includes("timeout") || msg.includes("AbortError")) {
      callbacks.onStatus?.("error", "语音识别超时，请重试");
    } else if (msg.includes("转码") || msg.includes("ffmpeg") || msg.includes("imageio")) {
      callbacks.onStatus?.("error", "stt-convert-failed");
    } else if (msg.includes("无法连接") || msg.includes("unreachable") || msg.includes("Failed to fetch")) {
      callbacks.onStatus?.("error", "backend-unreachable");
    } else if (msg.includes("录音太短")) {
      callbacks.onStatus?.("error", "recording-too-short");
    } else if (msg.includes("未识别到") || msg.includes("no speech")) {
      callbacks.onStatus?.("error", "no-speech");
    } else {
      callbacks.onStatus?.("error", msg.slice(0, 120) || "stt-failed");
    }
  }

  private releaseStream() {
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;
  }

  /** Cancel voice session without transcribing or committing partial text. */
  abort() {
    this.webSpeechStopping = false;
    this.callbacks = null;

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* ignore */
      }
      this.recognition = null;
    }

    const recorder = this.mediaRecorder;
    this.mediaRecorder = null;
    this.recorderChunks = [];
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }

    this.stopVolumeMonitor();
    this.releaseStream();
    this.listening = false;
  }

  stop(userInitiated = true) {
    if (this.recognition && this.listening) {
      if (userInitiated) {
        this.webSpeechStopping = true;
        try {
          this.recognition.stop();
        } catch {
          try {
            this.recognition.abort();
          } catch {
            /* ignore */
          }
        }
      } else {
        this.webSpeechStopping = false;
        try {
          this.recognition.abort();
        } catch {
          /* ignore */
        }
      }
      this.recognition = null;
      if (userInitiated) return;
    }

    const recorder = this.mediaRecorder;
    if (recorder && recorder.state !== "inactive") {
      const elapsed = Date.now() - this.recordStartedAt;
      if (elapsed < MIN_RECORD_MS) {
        this.listening = false;
        this.stopVolumeMonitor();
        this.mediaRecorder = null;
        this.releaseStream();
        this.recorderChunks = [];
        this.callbacks?.onStatus?.("error", "recording-too-short");
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
        return;
      }

      this.listening = false;
      this.stopVolumeMonitor();
      this.mediaRecorder = null;
      // onstop → finishRecorder runs async; do not releaseStream or clear recorderChunks here.
      try {
        if (recorder.state === "recording") {
          recorder.requestData();
        }
        recorder.stop();
      } catch {
        const cbs = this.callbacks;
        if (cbs) void this.finishRecorder(this.recorderMimeType, cbs);
      }
      return;
    }

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* ignore */
      }
      this.recognition = null;
    }

    this.stopVolumeMonitor();
    this.releaseStream();
    this.listening = false;
    this.recorderChunks = [];
  }
}
