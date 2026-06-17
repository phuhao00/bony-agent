<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    isSpeechSupported,
    normalizeTranscript,
    PetSpeechInput,
    speechUsesBackendStt,
    type SpeechStatus,
  } from "../lib/speechInput";

  interface Props {
    draft?: string;
    chatting?: boolean;
    disabled?: boolean;
    attached?: boolean;
    onSend?: (text: string) => void;
    onFocus?: () => void;
  }

  let {
    draft = $bindable(""),
    chatting = false,
    disabled = false,
    attached = false,
    onSend,
    onFocus,
  }: Props = $props();

  let speechStatus = $state<SpeechStatus>(isSpeechSupported() ? "idle" : "unsupported");
  let speechHint = $state("");
  let micVolume = $state(0);
  /** Snapshot of draft when voice session starts — never wiped on mic tap. */
  let anchorDraft = $state("");
  /** Live voice preview; committed to draft only on final. */
  let voicePreview = $state("");
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let inputEl: HTMLInputElement | undefined = $state();
  const speech = new PetSpeechInput("zh-CN");

  const micDisabled = $derived(
    disabled || chatting || speechStatus === "unsupported" || speechStatus === "transcribing",
  );
  const micActive = $derived(speechStatus === "listening");
  const micTranscribing = $derived(speechStatus === "transcribing");
  const voiceBusy = $derived(micActive || micTranscribing);
  const micLevelStyle = $derived(
    micActive ? `transform: scale(${1 + micVolume * 0.12}); opacity: ${0.85 + micVolume * 0.15}` : "",
  );

  const displayText = $derived.by(() => {
    if (!voiceBusy) return draft;
    const merged = mergeDraft(anchorDraft, voicePreview);
    return merged;
  });

  const inputPlaceholder = $derived.by(() => {
    if (micTranscribing) return "云端识别中…";
    if (micActive) {
      if (speechUsesBackendStt()) return "录音中，点麦克风结束";
      if (voicePreview) return "";
      return "正在听你说…";
    }
    return "输入或语音说话…";
  });

  function mergeDraft(before: string, voice: string): string {
    const b = before.trimEnd();
    const v = normalizeTranscript(voice);
    if (!v) return before;
    if (!b) return v;
    return `${b} ${v}`;
  }

  function resetVoiceSession() {
    anchorDraft = "";
    voicePreview = "";
  }

  function clearHintLater(ms = 4500) {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      speechHint = "";
      if (speechStatus === "error") speechStatus = "idle";
    }, ms);
  }

  function mapSpeechError(detail?: string): string {
    switch (detail) {
      case "not-allowed":
        return "请允许麦克风权限";
      case "recording-too-short":
        return "说话时间太短，请多说几个字再结束";
      case "recording-too-quiet":
        return "声音太小，请大声一点或检查麦克风";
      case "no-speech":
        return "没识别到内容，请再说一次";
      case "stt-unconfigured":
        return "请在设置中配置 ALIBABA/DASHSCOPE API Key";
      case "stt-convert-failed":
        return "录音转码失败，请重启应用";
      case "backend-unreachable":
        return "连不上后端，请确认主程序已启动";
      case "stt-failed":
        return "语音识别失败，请重试";
      default:
        if (detail && detail.length <= 80) return detail;
        return "语音识别失败，请重试";
    }
  }

  function commitVoiceResult(text: string) {
    const merged = mergeDraft(anchorDraft, text);
    draft = merged;
    resetVoiceSession();
    queueMicrotask(() => {
      inputEl?.focus();
      if (inputEl) {
        const len = inputEl.value.length;
        inputEl.setSelectionRange(len, len);
      }
    });
  }

  function submit(e: Event) {
    e.preventDefault();
    if (voiceBusy) {
      speech.stop();
      return;
    }
    const text = draft.trim();
    if (!text || chatting || disabled) return;
    onSend?.(text);
  }

  function onInputFocus() {
    onFocus?.();
  }

  function onInputClick() {
    if (micActive) {
      speech.stop();
    }
  }

  function onInputInput(e: Event) {
    if (voiceBusy) return;
    draft = (e.currentTarget as HTMLInputElement).value;
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && voiceBusy) {
      e.preventDefault();
      speech.abort();
      draft = anchorDraft;
      resetVoiceSession();
      speechStatus = "idle";
      speechHint = "";
      micVolume = 0;
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && micActive) {
      e.preventDefault();
      speech.stop();
    }
  }

  async function toggleVoice() {
    if (micDisabled) return;
    if (speech.isListening) {
      speech.stop();
      return;
    }

    speechHint = "";
    micVolume = 0;
    voicePreview = "";
    anchorDraft = draft;
    clearTimeout(hintTimer);

    await speech.start({
      onInterim: (text) => {
        if (speechStatus === "listening" || speechStatus === "transcribing") {
          voicePreview = normalizeTranscript(text);
        }
      },
      onVolume: (level) => {
        if (speechStatus === "listening") micVolume = level;
      },
      onFinal: (text) => {
        commitVoiceResult(text);
        speechHint = "";
        speechStatus = "idle";
        micVolume = 0;
      },
      onStatus: (status, detail) => {
        speechStatus = status;
        if (status === "listening") {
          speechHint = speechUsesBackendStt()
            ? "录音中 · 点麦克风结束 · Esc 取消"
            : "识别中 · 点麦克风结束 · Esc 取消";
        } else if (status === "transcribing") {
          speechHint = "云端识别中…";
          voicePreview = "";
        } else if (status === "error") {
          draft = anchorDraft;
          resetVoiceSession();
          speechHint = mapSpeechError(detail);
          micVolume = 0;
          clearHintLater();
        } else {
          speechHint = "";
          micVolume = 0;
        }
      },
    });
  }

  function stopDrag(e: PointerEvent) {
    e.stopPropagation();
  }

  onDestroy(() => {
    clearTimeout(hintTimer);
    speech.abort();
  });
</script>

<form
  class="compose-dock"
  class:attached
  class:voice-busy={voiceBusy}
  onsubmit={submit}
  onpointerdown={stopDrag}
>
  <button
    type="button"
    class="btn-mic"
    class:active={micActive}
    class:transcribing={micTranscribing}
    disabled={micDisabled}
    style={micLevelStyle}
    aria-label={micTranscribing ? "识别中" : micActive ? "停止语音" : "语音输入"}
    title={
      speechStatus === "unsupported"
        ? "不支持语音"
        : micTranscribing
          ? "识别中…"
          : micActive
            ? "点击结束识别"
            : "语音输入"
    }
    onclick={toggleVoice}
  >
    {#if micActive}
      <span class="mic-pulse" style="opacity: {0.35 + micVolume * 0.65}" aria-hidden="true"></span>
      <span class="mic-level" style="transform: scaleY({0.15 + micVolume * 0.85})" aria-hidden="true"></span>
    {:else if micTranscribing}
      <span class="mic-spin" aria-hidden="true"></span>
    {/if}
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke-linecap="round" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke-linecap="round" />
    </svg>
  </button>

  <div class="input-wrap" class:listening={micActive} class:transcribing={micTranscribing}>
    {#if micActive && !displayText}
      <span class="listen-dots" aria-hidden="true">
        <span></span><span></span><span></span>
      </span>
    {/if}
    <input
      bind:this={inputEl}
      value={displayText}
      placeholder={inputPlaceholder}
      readonly={voiceBusy}
      disabled={chatting || disabled}
      autocomplete="off"
      aria-label="消息输入"
      aria-busy={voiceBusy}
      onfocus={onInputFocus}
      onclick={onInputClick}
      oninput={onInputInput}
      onkeydown={onInputKeydown}
      onpointerdown={stopDrag}
    />
    {#if speechHint}
      <span class="speech-hint" class:info={micActive || micTranscribing}>{speechHint}</span>
    {/if}
  </div>

  <button
    type="submit"
    class="btn-send"
    disabled={chatting || disabled || (!voiceBusy && !draft.trim())}
    aria-label={voiceBusy ? "结束识别" : "发送"}
    title={voiceBusy ? "结束识别" : "发送"}
  >
    {#if voiceBusy}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    {:else}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M22 2L11 13" stroke-linecap="round" />
        <path d="M22 2L15 22l-4-9-9-4 20-7z" stroke-linejoin="round" />
      </svg>
    {/if}
  </button>
</form>

<style>
  .compose-dock {
    flex-shrink: 0;
    width: min(292px, 96vw);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    margin: 8px auto 0;
    box-sizing: border-box;
    border-radius: 16px;
    background: #ffffff;
    border: 1px solid rgba(140, 110, 220, 0.14);
    box-shadow: 0 6px 18px rgba(88, 62, 160, 0.1);
    z-index: 8;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
  }

  .compose-dock.voice-busy {
    border-color: rgba(255, 100, 120, 0.28);
    box-shadow: 0 6px 20px rgba(255, 90, 110, 0.12);
  }

  .compose-dock.attached {
    width: 100%;
    margin: 0;
    padding: 10px 12px 12px;
    border-radius: 0 0 18px 18px;
    border-top: 1px solid rgba(120, 90, 180, 0.08);
    box-shadow: 0 8px 24px rgba(88, 62, 160, 0.1);
  }

  .input-wrap {
    flex: 1;
    min-width: 0;
    position: relative;
  }

  .input-wrap.listening input {
    border-color: rgba(255, 100, 120, 0.45);
    background: rgba(255, 248, 250, 0.95);
  }

  .input-wrap.transcribing input {
    border-color: rgba(124, 107, 255, 0.45);
    background: rgba(248, 246, 255, 0.98);
  }

  .listen-dots {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    gap: 4px;
    pointer-events: none;
    z-index: 1;
  }

  .listen-dots span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgba(255, 90, 110, 0.75);
    animation: listen-dot 1s ease-in-out infinite;
  }

  .listen-dots span:nth-child(2) {
    animation-delay: 0.15s;
  }

  .listen-dots span:nth-child(3) {
    animation-delay: 0.3s;
  }

  .compose-dock input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid rgba(120, 90, 180, 0.16);
    border-radius: 999px;
    padding: 10px 14px;
    font-size: 13px;
    background: #ffffff;
    color: #2a2040;
    outline: none;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      background 0.15s ease;
  }

  .compose-dock input:read-only {
    cursor: default;
    color: rgba(42, 32, 64, 0.88);
  }

  .compose-dock input:focus {
    border-color: rgba(124, 107, 255, 0.5);
    box-shadow: 0 0 0 3px rgba(124, 107, 255, 0.14);
  }

  .input-wrap.listening input:focus {
    border-color: rgba(255, 100, 120, 0.55);
    box-shadow: 0 0 0 3px rgba(255, 100, 120, 0.12);
  }

  .compose-dock input::placeholder {
    color: rgba(80, 60, 110, 0.4);
  }

  .speech-hint {
    position: absolute;
    left: 14px;
    top: -16px;
    font-size: 10px;
    color: #e25555;
    pointer-events: none;
    white-space: nowrap;
  }

  .speech-hint.info {
    color: rgba(100, 80, 160, 0.85);
  }

  .btn-mic,
  .btn-send {
    width: 38px;
    height: 38px;
    flex-shrink: 0;
    border: none;
    border-radius: 50%;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition:
      transform 0.12s ease,
      opacity 0.12s ease,
      background 0.15s ease;
  }

  .btn-mic {
    position: relative;
    color: rgba(80, 60, 110, 0.75);
    background: rgba(120, 90, 180, 0.1);
  }

  .btn-mic.active {
    color: #fff;
    background: linear-gradient(145deg, #ff6b8a, #ff4757);
    box-shadow: 0 4px 14px rgba(255, 71, 87, 0.4);
  }

  .btn-mic.transcribing {
    color: #fff;
    background: linear-gradient(145deg, #8b7bff, #5b9dff);
    box-shadow: 0 4px 14px rgba(100, 120, 255, 0.35);
  }

  .btn-mic:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .btn-mic:not(:disabled):hover {
    transform: scale(1.04);
  }

  .mic-pulse {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 2px solid rgba(255, 71, 87, 0.45);
    animation: mic-ring 1.2s ease-out infinite;
    pointer-events: none;
  }

  .mic-level {
    position: absolute;
    bottom: 6px;
    left: 50%;
    width: 3px;
    height: 10px;
    margin-left: -1.5px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.9);
    transform-origin: bottom center;
    pointer-events: none;
  }

  .mic-spin {
    position: absolute;
    inset: 8px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #fff;
    animation: mic-rotate 0.8s linear infinite;
    pointer-events: none;
  }

  @keyframes mic-rotate {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes listen-dot {
    0%,
    60%,
    100% {
      transform: translateY(0);
      opacity: 0.45;
    }
    30% {
      transform: translateY(-3px);
      opacity: 1;
    }
  }

  .btn-send {
    color: #fff;
    background: linear-gradient(145deg, #8b7bff, #5b9dff);
    box-shadow: 0 4px 12px rgba(100, 120, 255, 0.35);
  }

  .btn-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }

  .btn-send:not(:disabled):hover {
    transform: scale(1.05);
  }

  @keyframes mic-ring {
    0% {
      transform: scale(0.92);
      opacity: 0.8;
    }
    100% {
      transform: scale(1.2);
      opacity: 0;
    }
  }
</style>
