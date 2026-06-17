<script lang="ts">
  import { resolvePetMediaUrl, type PetMediaItem } from "../lib/api";

  export interface ChatMessage {
    role: string;
    content: string;
    media?: PetMediaItem[];
  }

  import type { Snippet } from "svelte";

  interface Props {
    petName: string;
    messages: ChatMessage[];
    streamBuffer?: string;
    chatStatus?: string;
    chatting?: boolean;
    onClose?: () => void;
    /** 桌宠趴在顶栏时隐藏重复的小头像 */
    hideAvatar?: boolean;
    /** 顶栏右侧扩展区（如形象切换） */
    headerExtra?: Snippet;
  }

  let {
    petName,
    messages,
    streamBuffer = "",
    chatStatus = "",
    chatting = false,
    onClose,
    hideAvatar = false,
    headerExtra,
  }: Props = $props();

  let scrollEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    void messages.length;
    void streamBuffer;
    void chatStatus;
    queueMicrotask(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  function stopDrag(e: PointerEvent) {
    e.stopPropagation();
  }

  let lightbox = $state<PetMediaItem | null>(null);

  function openLightbox(item: PetMediaItem) {
    lightbox = item;
  }

  function closeLightbox() {
    lightbox = null;
  }
</script>

<section class="chat-panel" class:pet-on-top={hideAvatar} aria-label="与桌宠对话" onpointerdown={stopDrag}>
  <header class="chat-header">
    {#if !hideAvatar}
      <div class="chat-avatar" aria-hidden="true">✦</div>
    {/if}
    <div class="chat-title">
      <span class="name">{petName}</span>
      <span class="subtitle">{chatting ? "正在输入…" : "在线陪伴"}</span>
    </div>
    {#if headerExtra}
      <div class="chat-header-extra">
        {@render headerExtra()}
      </div>
    {/if}
    <button type="button" class="btn-icon" aria-label="收起对话" onclick={() => onClose?.()}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </header>

  <div class="chat-scroll" bind:this={scrollEl}>
    {#if messages.length === 0 && !chatting}
      <div class="chat-empty">
        <p>跟 {petName} 说点什么吧～</p>
        <span>天气、新闻、闲聊都可以</span>
      </div>
    {/if}

    {#each messages as msg, i (i + msg.role + msg.content.slice(0, 24))}
      <div class="msg-row" class:user={msg.role === "user"} class:assistant={msg.role !== "user"}>
        {#if msg.role !== "user"}
          <span class="msg-avatar" aria-hidden="true">✦</span>
        {/if}
        <div class="msg-bubble">
          {#if msg.content}<p>{msg.content}</p>{/if}
          {#if msg.media?.length}
            <div class="media-grid" class:single={msg.media.length === 1}>
              {#each msg.media as item, mi (mi + item.url)}
                {#if item.type === "video"}
                  <button
                    type="button"
                    class="media-thumb media-video"
                    onclick={() => openLightbox(item)}
                    aria-label="查看视频"
                  >
                    <video src={resolvePetMediaUrl(item.url)} muted preload="metadata" playsinline>
                      <track kind="captions" />
                    </video>
                    <span class="play-badge" aria-hidden="true">▶</span>
                  </button>
                {:else}
                  <button
                    type="button"
                    class="media-thumb"
                    onclick={() => openLightbox(item)}
                    aria-label="放大查看图片"
                  >
                    <img src={resolvePetMediaUrl(item.url)} alt="生成的图片" loading="lazy" />
                  </button>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/each}

    {#if chatting && streamBuffer}
      <div class="msg-row assistant">
        <span class="msg-avatar" aria-hidden="true">✦</span>
        <div class="msg-bubble streaming">
          <p>{streamBuffer}</p>
          <span class="caret" aria-hidden="true"></span>
        </div>
      </div>
    {:else if chatting && chatStatus}
      <div class="msg-row assistant">
        <span class="msg-avatar" aria-hidden="true">✦</span>
        <div class="msg-bubble status">
          <span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
          <p>{chatStatus}</p>
        </div>
      </div>
    {:else if chatting}
      <div class="msg-row assistant">
        <span class="msg-avatar" aria-hidden="true">✦</span>
        <div class="msg-bubble status">
          <span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span>
        </div>
      </div>
    {/if}
  </div>
</section>

{#if lightbox}
  <div
    class="lightbox"
    role="button"
    tabindex="0"
    aria-label="关闭预览"
    onpointerdown={stopDrag}
    onclick={closeLightbox}
    onkeydown={(e) => (e.key === "Escape" || e.key === "Enter") && closeLightbox()}
  >
    <div class="lightbox-inner">
      {#if lightbox.type === "video"}
        <video src={resolvePetMediaUrl(lightbox.url)} controls autoplay playsinline>
          <track kind="captions" />
        </video>
      {:else}
        <img src={resolvePetMediaUrl(lightbox.url)} alt="生成的图片预览" />
      {/if}
      <button type="button" class="lightbox-close" aria-label="关闭" onclick={closeLightbox}>×</button>
    </div>
  </div>
{/if}

<style>
  .chat-panel {
    width: 100%;
    flex: 0 1 auto;
    min-height: 0;
    max-height: calc(100vh - 250px);
    display: flex;
    flex-direction: column;
    margin-bottom: 0;
    border-radius: 18px 18px 0 0;
    background: #fffaf5;
    border: 1px solid rgba(140, 110, 220, 0.12);
    border-bottom: none;
    box-shadow: 0 8px 24px rgba(88, 62, 160, 0.1);
    animation: panel-in 0.28s cubic-bezier(0.22, 1, 0.36, 1);
    overflow: hidden;
  }

  .chat-panel.pet-on-top .chat-header {
    padding-top: 16px;
    padding-left: 14px;
  }

  .chat-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px 8px;
    border-bottom: 1px solid rgba(120, 90, 180, 0.08);
  }

  .chat-avatar {
    width: 32px;
    height: 32px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    font-size: 14px;
    color: #6b4a10;
    background: linear-gradient(145deg, #ffe566, #ffb830);
    box-shadow: 0 4px 12px rgba(255, 180, 60, 0.35);
    flex-shrink: 0;
  }

  .chat-title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .chat-header-extra {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    pointer-events: auto;
  }

  .chat-title .name {
    font-size: 13px;
    font-weight: 650;
    color: #2a2040;
    letter-spacing: 0.02em;
  }

  .chat-title .subtitle {
    font-size: 10px;
    color: rgba(80, 60, 110, 0.55);
  }

  .btn-icon {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 10px;
    background: rgba(120, 90, 180, 0.08);
    color: rgba(60, 45, 90, 0.7);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background 0.15s ease;
  }

  .btn-icon:hover {
    background: rgba(120, 90, 180, 0.14);
  }

  .chat-scroll {
    flex: 0 1 auto;
    max-height: min(420px, calc(100vh - 300px));
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 10px 10px 8px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: 10px;
    scroll-behavior: smooth;
  }

  .chat-scroll::-webkit-scrollbar {
    width: 4px;
  }

  .chat-scroll::-webkit-scrollbar-thumb {
    background: rgba(120, 90, 180, 0.2);
    border-radius: 4px;
  }

  .chat-empty {
    text-align: center;
    padding: 20px 12px 12px;
    color: rgba(60, 45, 90, 0.45);
  }

  .chat-empty p {
    margin: 0 0 4px;
    font-size: 13px;
    color: rgba(50, 35, 80, 0.65);
  }

  .chat-empty span {
    font-size: 11px;
  }

  .msg-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    max-width: 100%;
    min-width: 0;
  }

  .msg-row.user {
    justify-content: flex-end;
    align-items: flex-end;
  }

  .msg-row.assistant {
    justify-content: flex-start;
  }

  .msg-avatar {
    width: 22px;
    height: 22px;
    border-radius: 8px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    font-size: 10px;
    color: #6b4a10;
    background: linear-gradient(145deg, #ffe566, #ffb830);
    box-shadow: 0 2px 6px rgba(255, 180, 60, 0.25);
    margin-top: 9px;
  }

  .msg-bubble {
    min-width: 0;
    max-width: calc(100% - 28px);
    padding: 9px 12px;
    border-radius: 16px;
    font-size: 13px;
    line-height: 1.5;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .msg-bubble p {
    margin: 0;
    white-space: pre-wrap;
  }

  .media-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
    margin-top: 6px;
    max-width: 200px;
  }

  .media-grid.single {
    grid-template-columns: 1fr;
    max-width: 168px;
  }

  .media-thumb {
    position: relative;
    padding: 0;
    border: 1px solid rgba(120, 90, 180, 0.16);
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    background: rgba(124, 107, 255, 0.06);
    aspect-ratio: 1 / 1;
    transition: transform 0.16s ease, box-shadow 0.16s ease;
  }

  .media-thumb:hover {
    transform: translateY(-1px) scale(1.02);
    box-shadow: 0 6px 16px rgba(88, 62, 160, 0.22);
  }

  .media-thumb img,
  .media-thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .media-thumb .play-badge {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    color: #fff;
    background: rgba(0, 0, 0, 0.28);
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  }

  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    background: rgba(20, 14, 40, 0.62);
    backdrop-filter: blur(4px);
    animation: panel-in 0.18s ease;
  }

  .lightbox-inner {
    position: relative;
    max-width: 100%;
    max-height: 100%;
    display: flex;
  }

  .lightbox-inner img,
  .lightbox-inner video {
    max-width: 100%;
    max-height: calc(100vh - 60px);
    border-radius: 14px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    object-fit: contain;
  }

  .lightbox-close {
    position: absolute;
    top: -10px;
    right: -10px;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 50%;
    background: #fff;
    color: #2a2040;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .msg-row.user .msg-bubble {
    flex-shrink: 1;
    width: fit-content;
    max-width: 82%;
    background: linear-gradient(135deg, #7c6bff 0%, #5b9dff 100%);
    color: #fff;
    border-bottom-right-radius: 6px;
    box-shadow: 0 4px 14px rgba(100, 120, 255, 0.28);
  }

  .msg-row.assistant .msg-bubble {
    width: fit-content;
    max-width: calc(100% - 28px);
    background: rgba(255, 255, 255, 0.95);
    color: #2a2040;
    border: 1px solid rgba(120, 90, 180, 0.1);
    border-bottom-left-radius: 6px;
    box-shadow: 0 2px 10px rgba(80, 50, 120, 0.06);
  }

  .msg-bubble.streaming {
    position: relative;
  }

  .msg-bubble.status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
  }

  .msg-bubble.status p {
    font-size: 12px;
    color: rgba(60, 45, 90, 0.65);
  }

  .caret {
    display: inline-block;
    width: 2px;
    height: 14px;
    margin-left: 2px;
    vertical-align: text-bottom;
    background: rgba(120, 90, 180, 0.5);
    animation: blink-caret 0.9s step-end infinite;
  }

  .typing-dots {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    flex-shrink: 0;
  }

  .typing-dots span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgba(120, 90, 180, 0.45);
    animation: dot-bounce 1.1s ease-in-out infinite;
  }

  .typing-dots span:nth-child(2) {
    animation-delay: 0.15s;
  }

  .typing-dots span:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes panel-in {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes dot-bounce {
    0%,
    60%,
    100% {
      transform: translateY(0);
      opacity: 0.45;
    }
    30% {
      transform: translateY(-4px);
      opacity: 1;
    }
  }

  @keyframes blink-caret {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }
</style>
