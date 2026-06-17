<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import {
    getBackendUrl,
    getConsoleUrl,
    initBackendEndpoints,
    checkHealth,
    fetchCompanionState,
    fetchPetBootstrap,
    fetchPetWake,
    getPlatform,
    postPerception,
    streamPetChat,
    type CompanionState,
    type PerceptionContext,
    type PetMediaItem,
  } from "./lib/api";
  import { actionToAnimation, careGlow, stageClass, type PetVisualState } from "./lib/petState";
  import {
    instantWakeGreeting,
    loadCachedCompanion,
    loadCachedCompanionName,
    saveCachedCompanion,
  } from "./lib/wakeGreeting";
  import PetChatPanel from "./components/PetChatPanel.svelte";
  import PetComposeBar from "./components/PetComposeBar.svelte";
  import PetKittyBody from "./components/PetKittyBody.svelte";
  import PetPeppaBody from "./components/PetPeppaBody.svelte";
  import PetXiongErBody from "./components/PetXiongErBody.svelte";
  import PetGgBondBody from "./components/PetGgBondBody.svelte";
  import PetCharacterSwitcher from "./components/PetCharacterSwitcher.svelte";
  import {
    characterShortLabel,
    characterWakeLabel,
    dismissCharacterHint,
    loadPetCharacter,
    savePetCharacter,
    shouldShowCharacterHint,
    type PetCharacterId,
  } from "./lib/petCharacter";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { LogicalSize } from "@tauri-apps/api/dpi";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { open } from "@tauri-apps/plugin-shell";

  let backendOk = $state(false);
  let companion = $state<CompanionState | null>(null);
  let anim = $state<PetVisualState>("idle");
  let bubble = $state("");
  let draft = $state("");
  let chatting = $state(false);
  let showChat = $state(false);
  let streamBuffer = $state("");
  let chatStatus = $state("");
  let messages = $state<{ role: string; content: string; media?: PetMediaItem[] }[]>([]);
  let perception = $state<PerceptionContext>({});
  let clipboardOptIn = $state(false);
  let nudgeText = $state("");
  let isAwake = $state(false);
  let isSleeping = $state(true);
  let wakeHint = $state("");
  let showSettings = $state(false);
  let showContextMenu = $state(false);
  let menuX = $state(0);
  let menuY = $state(0);
  let menuAnchorX = 0;
  let menuAnchorY = 0;
  let contextMenuEl = $state<HTMLDivElement | undefined>();
  let backendChecking = $state(true);
  let backendDisplayUrl = $state("http://127.0.0.1:8000");
  let petCharacter = $state<PetCharacterId>(loadPetCharacter());
  let showCharacterHint = $state(false);
  let characterHintTimer: ReturnType<typeof setTimeout> | undefined;
  let switcherOpen = $state(false);

  let healthTimer: ReturnType<typeof setInterval> | undefined;
  let perceptionTimer: ReturnType<typeof setInterval> | undefined;
  let blinkTimer: ReturnType<typeof setInterval> | undefined;
  let unlistenPerception: (() => void) | undefined;
  let unlistenWake: (() => void) | undefined;

  const petName = $derived(
    companion?.pet?.name || companion?.persona?.name || "小光灵",
  );
  const petStage = $derived(companion?.pet?.stage || "young");
  const careScore = $derived(companion?.pet?.care_score ?? 0);
  const level = $derived(companion?.growth?.level ?? 1);

  const peekText = $derived.by(() => {
    if (showChat || chatting || nudgeText) return "";
    if (bubble.trim()) return bubble.trim();
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].content;
    }
    return "";
  });

  const COMPACT_SIZE = { width: 300, height: 420 };
  const CHAT_SIZE = { width: 300, height: 620 };
  const MAX_CHAT_MESSAGES = 50;
  const CHAT_CONTEXT_LIMIT = 8;

  let coquettishBubble = $state("");
  let coquettishTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPerceptionPosted = "";

  const COQUETTISH_LINES = [
    "主人～",
    "嘿嘿～",
    "摸摸头嘛 ✦",
    "陪我说说话嘛～",
    "人家在呀～",
    "想你了主人～",
  ];

  function trimChatMessages(
    list: { role: string; content: string; media?: PetMediaItem[] }[],
  ) {
    if (list.length <= MAX_CHAT_MESSAGES) return list;
    return list.slice(-MAX_CHAT_MESSAGES);
  }

  function perceptionPostKey(ctx: PerceptionContext): string {
    return [
      ctx.foreground_app ?? "",
      ctx.foreground_title ?? "",
      ctx.clipboard_hash ?? "",
      String(Math.floor((ctx.idle_seconds ?? 0) / 60)),
    ].join("|");
  }

  async function postPerceptionIfChanged(ctx: PerceptionContext) {
    const key = perceptionPostKey(ctx);
    if (key === lastPerceptionPosted) return;
    lastPerceptionPosted = key;
    await postPerception(ctx);
  }

  function clearCharacterHint() {
    if (!showCharacterHint) return;
    showCharacterHint = false;
    dismissCharacterHint();
    if (characterHintTimer) {
      clearTimeout(characterHintTimer);
      characterHintTimer = undefined;
    }
  }

  function selectPetCharacter(id: PetCharacterId) {
    if (petCharacter === id) return;
    petCharacter = id;
    savePetCharacter(id);
    clearCharacterHint();
  }

  async function setWindowLayout(chatOpen: boolean) {
    try {
      const win = getCurrentWindow();
      const size = chatOpen ? CHAT_SIZE : COMPACT_SIZE;
      await win.setSize(new LogicalSize(size.width, size.height));
    } catch (e) {
      console.debug("setWindowLayout", e);
    }
  }

  function clearCoquettishTimer() {
    if (coquettishTimer) {
      clearTimeout(coquettishTimer);
      coquettishTimer = undefined;
    }
  }

  function scheduleCoquettish() {
    clearCoquettishTimer();
    if (!showChat || chatting || isSleeping || !backendOk) return;
    const delay = 9000 + Math.random() * 11000;
    coquettishTimer = setTimeout(() => {
      triggerCoquettish();
    }, delay);
  }

  function triggerCoquettish() {
    if (!showChat || chatting || isSleeping || anim === "thinking" || anim === "talking") {
      scheduleCoquettish();
      return;
    }
    coquettishBubble = COQUETTISH_LINES[Math.floor(Math.random() * COQUETTISH_LINES.length)]!;
    anim = "coquettish";
    clearCoquettishTimer();
    coquettishTimer = setTimeout(() => {
      coquettishBubble = "";
      if (anim === "coquettish") anim = "idle";
      scheduleCoquettish();
    }, 2600);
  }

  async function openChat() {
    if (!backendOk) return;
    showChat = true;
    await setWindowLayout(true);
    anim = "cheer_up";
    clearCoquettishTimer();
    coquettishTimer = setTimeout(() => {
      if (anim === "cheer_up") anim = "idle";
      scheduleCoquettish();
    }, 1400);
  }

  async function closeChat() {
    showChat = false;
    coquettishBubble = "";
    clearCoquettishTimer();
    await setWindowLayout(false);
  }

  async function toggleChat() {
    if (showChat) await closeChat();
    else await openChat();
  }

  async function refreshHealth(forceRediscover = false) {
    if (forceRediscover) {
      await initBackendEndpoints();
      backendDisplayUrl = getBackendUrl();
    }
    let ok = await checkHealth();
    if (!ok && !forceRediscover) {
      await initBackendEndpoints();
      backendDisplayUrl = getBackendUrl();
      ok = await checkHealth();
    }
    backendOk = ok;
    if (backendOk && !companion) {
      companion = await fetchCompanionState();
    }
  }

  async function waitForBackend(maxWaitMs = 12000): Promise<boolean> {
    backendChecking = true;
    const delays = [120, 180, 250, 350, 500, 700, 900, 1200, 1500];
    const started = Date.now();
    let attempt = 0;

    while (Date.now() - started < maxWaitMs) {
      backendOk = await checkHealth(1800);
      if (backendOk) {
        backendChecking = false;
        return true;
      }
      const delay = delays[Math.min(attempt, delays.length - 1)];
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    backendChecking = false;
    return false;
  }

  function applyWakeUi(payload: {
    text: string;
    action?: string;
    companionPatch?: CompanionState | null;
    appendMessage?: boolean;
  }) {
    isSleeping = false;
    isAwake = true;
    bubble = payload.text;
    anim = actionToAnimation(String(payload.action || "cheer_up"));

    if (payload.companionPatch) {
      companion = payload.companionPatch;
      saveCachedCompanion(payload.companionPatch);
    }

    if (payload.appendMessage !== false) {
      const last = messages[messages.length - 1];
      if (!last || last.role !== "assistant" || last.content !== payload.text) {
        messages = [...messages, { role: "assistant", content: payload.text }];
      }
    }
  }

  function applyOptimisticWake() {
    const instant = instantWakeGreeting(loadCachedCompanionName());
    applyWakeUi({ text: instant.text, action: instant.action, appendMessage: false });
  }

  async function syncWakeFromServer(source: string, fast = true) {
    const bootstrap = await fetchPetBootstrap(source, fast);
    if (bootstrap?.companion) {
      companion = bootstrap.companion as CompanionState;
      saveCachedCompanion(bootstrap.companion);
    }

    const wake = bootstrap?.wake ?? (await fetchPetWake(source));
    if (wake?.text) {
      applyWakeUi({
        text: wake.text,
        action: wake.action,
        companionPatch: (wake.companion as CompanionState | undefined) ?? companion,
      });
      return wake;
    }
    return null;
  }

  async function pullRustPerception() {
    try {
      const ctx = (await invoke("get_perception_context", {
        includeClipboardPreview: clipboardOptIn,
      })) as PerceptionContext;
      perception = ctx;
      if (backendOk) {
        await postPerceptionIfChanged(ctx);
        maybeEnterSleep(ctx);
        maybeNudgeFromClipboard(ctx);
      }
    } catch (e) {
      console.debug("perception", e);
    }
  }

  function maybeEnterSleep(ctx: PerceptionContext) {
    const idle = ctx.idle_seconds ?? 0;
    if (idle >= 600 && isAwake && !chatting && !showChat && !bubble && !nudgeText) {
      isSleeping = true;
      anim = "idle";
    }
  }

  async function wakePet(source = "manual") {
    if (chatting) return;

    applyOptimisticWake();

    if (!backendOk) {
      backendOk = await checkHealth(2000);
    }
    if (!backendOk) {
      bubble = `${loadCachedCompanionName()} 已醒来（离线模式，连上后端后会同步）`;
      return;
    }

    void syncWakeFromServer(source, source !== "manual");
  }

  function maybeNudgeFromClipboard(ctx: PerceptionContext) {
    const preview = ctx.clipboard_preview || "";
    const app = (ctx.foreground_app || "").toLowerCase();
    const codeLike = /def |class |function |import |const /.test(preview);
    const inEditor = app.includes("vscode") || app.includes("cursor") || app.includes("code");
    if (codeLike && inEditor && preview.length > 20 && !chatting && !showChat && !nudgeText) {
      nudgeText = "主人，需要我解释这段代码吗？";
      anim = "thinking";
    }
  }

  async function sendMessage(text: string) {
    const input = text.trim();
    if (!input || chatting || !backendOk) return;
    if (!showChat) await openChat();
    chatting = true;
    nudgeText = "";
    streamBuffer = "";
    chatStatus = "";
    anim = "thinking";
    if (!showChat) bubble = "";
    messages = trimChatMessages([...messages, { role: "user", content: input }]);
    draft = "";

    let streamed = "";
    let activeRoute = "";
    let responseReceived = false;
    const historyForApi = trimChatMessages(messages.slice(0, -1)).slice(-CHAT_CONTEXT_LIMIT);
    try {
      await streamPetChat(input, historyForApi, perception, (ev) => {
        const t = ev.type as string;
        if (t === "metadata") {
          activeRoute = String(ev.route || "");
        }
        if (t === "pet_action" && !responseReceived) {
          if (ev.action) anim = actionToAnimation(String(ev.action));
          if (ev.tool) {
            streamBuffer = "";
            streamed = "";
            chatStatus = "正在查…";
          }
        }
        if (t === "token" && ev.content && activeRoute !== "tools" && !responseReceived) {
          streamed += String(ev.content);
          streamBuffer = streamed;
          if (!showChat) bubble = streamed.slice(0, 100);
        }
        if (t === "pet_response") {
          responseReceived = true;
          const reply = String(ev.text || streamed).trim().replace(/\n{3,}/g, "\n\n");
          const media = Array.isArray(ev.media) ? (ev.media as PetMediaItem[]) : undefined;
          streamBuffer = "";
          streamed = "";
          chatStatus = "";
          bubble = reply;
          anim = actionToAnimation(String(ev.action || (media?.length ? "celebrate" : "talking")));
          const last = messages[messages.length - 1];
          if (last?.role === "assistant") {
            messages = trimChatMessages([
              ...messages.slice(0, -1),
              { role: "assistant", content: reply, media },
            ]);
          } else if (reply || media?.length) {
            messages = trimChatMessages([
              ...messages,
              { role: "assistant", content: reply, media },
            ]);
          }
        }
        if ((t === "agent_handoff" || t === "tools_handoff") && !responseReceived) {
          anim = "thinking";
          streamBuffer = "";
          streamed = "";
          chatStatus = String(ev.message || "正在处理…");
          if (!showChat) bubble = chatStatus;
        }
      });
      await refreshHealth();
    } catch (err) {
      bubble = `连接失败：${err instanceof Error ? err.message : String(err)}`;
      anim = "idle";
    } finally {
      chatting = false;
      streamBuffer = "";
      chatStatus = "";
      setTimeout(() => {
        if (!chatting) anim = "idle";
      }, 4000);
      if (showChat && !isSleeping) scheduleCoquettish();
    }
  }

  function onPetClick() {
    if (!backendOk) return;
    if (isSleeping || !isAwake) {
      void wakePet("click");
      return;
    }
    void toggleChat();
  }

  function onComposeFocus() {
    if (!showChat && backendOk && isAwake && !isSleeping) {
      void openChat();
    }
  }

  const showCompose = $derived(backendOk && isAwake && !isSleeping);

  /** 按住星星拖动整个桌宠窗口（系统级拖拽，不影响点击唤醒） */
  async function dragWindow(e: PointerEvent) {
    if (e.button !== 0) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.debug("startDragging", err);
    }
  }

  function estimateContextMenuHeight(): number {
    const actionRows = isSleeping || !isAwake || backendOk ? 2 : 1;
    return actionRows * 34 + 9 + 34 * 2 + 20;
  }

  function syncContextMenuPosition() {
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menuW = contextMenuEl?.offsetWidth ?? 200;
    const menuH = contextMenuEl?.offsetHeight ?? estimateContextMenuHeight();

    let x = menuAnchorX;
    let y = menuAnchorY;

    x = Math.min(Math.max(pad, x), Math.max(pad, vw - menuW - pad));

    const spaceBelow = vh - y - pad;
    const spaceAbove = y - pad;
    if (menuH <= spaceBelow) {
      // 默认在指针下方展开
    } else if (menuH <= spaceAbove) {
      y = y - menuH;
    } else {
      y = Math.max(pad, vh - menuH - pad);
    }
    y = Math.min(Math.max(pad, y), Math.max(pad, vh - menuH - pad));

    menuX = x;
    menuY = y;
  }

  /** 右键打开交互菜单 */
  async function openContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    menuAnchorX = e.clientX;
    menuAnchorY = e.clientY;
    showContextMenu = true;
    showSettings = false;
    await tick();
    syncContextMenuPosition();
  }

  function dismissContextMenu() {
    showContextMenu = false;
  }

  function hidePetWindow() {
    dismissContextMenu();
    showChat = false;
    showSettings = false;
    void invoke("hide_pet_window");
  }

  async function quitPetApp() {
    dismissContextMenu();
    await invoke("quit_pet_app");
  }

  async function menuWakePet() {
    dismissContextMenu();
    await wakePet("menu");
  }

  async function menuOpenConsole() {
    dismissContextMenu();
    await openConsole();
  }

  function menuToggleChat() {
    dismissContextMenu();
    if (!backendOk) return;
    if (isSleeping || !isAwake) {
      void wakePet("menu");
      return;
    }
    void toggleChat();
  }

  async function openConsole() {
    // Prefer opening the companion room inside the AI Media Agent desktop app
    // (Electron window) instead of the system browser. Falls back to browser
    // only when the pet runs standalone (dev / not launched by the app).
    try {
      const openedInApp = await invoke<boolean>("open_app_console");
      if (openedInApp) return;
    } catch (err) {
      console.debug("open_app_console unavailable", err);
    }
    await open(getConsoleUrl());
  }

  async function initSidecars(platform: string) {
    wakeHint =
      platform === "macos"
        ? "⌘⇧B 唤醒"
        : platform === "windows"
          ? "Alt+Shift+B 唤醒"
          : "快捷键唤醒";

    try {
      unlistenWake = await listen<{ source?: string }>("pet-wake", (ev) => {
        void wakePet(ev.payload?.source || "hotkey");
      });
    } catch (e) {
      console.debug("pet-wake listener", e);
    }

    try {
      await invoke("start_perception_loop", { intervalSecs: 45 });
      unlistenPerception = await listen<PerceptionContext>("perception-tick", (ev) => {
        perception = ev.payload;
        if (backendOk) {
          void postPerceptionIfChanged(ev.payload);
          maybeEnterSleep(ev.payload);
          maybeNudgeFromClipboard(ev.payload);
        }
      });
    } catch {
      perceptionTimer = setInterval(pullRustPerception, 45000);
      pullRustPerception();
    }

    blinkTimer = setInterval(() => {
      if (anim === "idle" && !isSleeping && !coquettishBubble) {
        anim = "blink";
        setTimeout(() => {
          if (anim === "blink") anim = "idle";
        }, 180);
      }
    }, 5000);
  }

  $effect(() => {
    if (!showChat || isSleeping || !backendOk) {
      coquettishBubble = "";
      clearCoquettishTimer();
    }
  });

  $effect(() => {
    if (!showContextMenu) return;
    const onLayout = () => syncContextMenuPosition();
    window.addEventListener("resize", onLayout);
    return () => window.removeEventListener("resize", onLayout);
  });

  onMount(async () => {
    const cached = loadCachedCompanion();
    if (cached) {
      companion = cached as CompanionState;
    }

    void setWindowLayout(false);
    applyOptimisticWake();

    if (shouldShowCharacterHint()) {
      showCharacterHint = true;
      characterHintTimer = setTimeout(() => clearCharacterHint(), 8000);
    }

    await initBackendEndpoints();
    backendDisplayUrl = getBackendUrl();

    const [platform, backendReady] = await Promise.all([getPlatform(), waitForBackend()]);
    await initSidecars(platform);

    healthTimer = setInterval(() => void refreshHealth(), 15000);

    if (backendReady) {
      await syncWakeFromServer("startup", true);
    } else {
      void (async () => {
        const ok = await waitForBackend(20000);
        if (ok) {
          backendOk = true;
          await syncWakeFromServer("startup", true);
        }
      })();
    }
  });

  onDestroy(() => {
    if (healthTimer) clearInterval(healthTimer);
    if (perceptionTimer) clearInterval(perceptionTimer);
    if (blinkTimer) clearInterval(blinkTimer);
    clearCoquettishTimer();
    if (characterHintTimer) clearTimeout(characterHintTimer);
    unlistenPerception?.();
    unlistenWake?.();
    invoke("stop_perception_loop").catch(() => {});
  });
</script>

{#snippet petStar(onDialog = false)}
  <button
    type="button"
    class="pet-sprite {stageClass(petStage)} {careGlow(careScore)}"
    class:character-kitty={petCharacter === "hello_kitty"}
    class:character-peppa={petCharacter === "peppa_pig"}
    class:character-xiong={petCharacter === "xiong_er"}
    class:character-gg={petCharacter === "gg_bond"}
    class:character-star={petCharacter === "star"}
    class:on-dialog={onDialog}
    aria-label={`${petName} Lv.${level}，拖动移动，点击互动，右键菜单`}
    onclick={onPetClick}
    onpointerdown={dragWindow}
    ondblclick={openConsole}
  >
    {#if petCharacter === "hello_kitty"}
      <PetKittyBody />
    {:else if petCharacter === "peppa_pig"}
      <PetPeppaBody />
    {:else if petCharacter === "xiong_er"}
      <PetXiongErBody />
    {:else if petCharacter === "gg_bond"}
      <PetGgBondBody />
    {:else}
    <svg class="star-body" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id="starFill" cx="50%" cy="42%" r="58%">
          <stop offset="0%" class="star-stop-light" />
          <stop offset="48%" class="star-stop-mid" />
          <stop offset="100%" class="star-stop-deep" />
        </radialGradient>
        <radialGradient id="starBelly" cx="50%" cy="72%" r="42%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.42)" />
          <stop offset="100%" stop-color="rgba(255,255,255,0)" />
        </radialGradient>
        <filter id="starGlow" x="-45%" y="-45%" width="190%" height="190%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g class="star-chubby">
        <path
          class="star-shape"
          d="M53.5 34.4 Q60 18 66.5 34.4 L71.8 47.8 L86.2 48.7 Q103.7 49.8 90.1 61 L79 70.2 L82.6 84.1 Q87 101.2 72.2 91.7 L60 84 L47.8 91.7 Q33 101.2 37.4 84.1 L41 70.2 L29.9 61 Q16.3 49.8 33.8 48.7 L48.2 47.8 Z"
          fill="url(#starFill)"
          filter="url(#starGlow)"
        />
        <ellipse class="star-belly" cx="60" cy="66" rx="18" ry="16" fill="url(#starBelly)" />
      </g>
      <g class="star-face">
        <ellipse class="eye left" cx="48" cy="54" rx="6.5" ry="7.5" />
        <ellipse class="eye right" cx="72" cy="54" rx="6.5" ry="7.5" />
        <circle class="eye-shine left" cx="50" cy="51.5" r="2" />
        <circle class="eye-shine right" cx="74" cy="51.5" r="2" />
        <ellipse class="blush left" cx="38" cy="64" rx="7.5" ry="5" />
        <ellipse class="blush right" cx="82" cy="64" rx="7.5" ry="5" />
        <path class="mouth" d="M49 68 Q60 77 71 68" />
      </g>
      <circle class="sparkle s1" cx="58" cy="24" r="1.8" />
      <circle class="sparkle s2" cx="94" cy="44" r="1.4" />
      <circle class="sparkle s3" cx="22" cy="46" r="1.2" />
    </svg>
    {/if}
    <span class="pet-shadow"></span>
  </button>
{/snippet}

<main
  class="pet-root"
  data-anim={anim}
  class:offline={!backendOk}
  class:sleeping={isSleeping}
  class:chat-open={showChat}
  class:switcher-open={switcherOpen}
  class:context-menu-open={showContextMenu}
  data-character={petCharacter}
  oncontextmenu={openContextMenu}
>
  {#if !backendOk && !backendChecking}
    <div class="status-banner">
      请先启动 AI Media Agent（{backendDisplayUrl}）
      <button type="button" onclick={refreshHealth}>重试</button>
    </div>
  {:else if backendChecking}
    <div class="status-banner connecting">正在连接后端…</div>
  {/if}

  <div class="pet-column">
    {#if showChat && backendOk}
      <div class="chat-dock">
        <div class="pet-perch" aria-hidden="false">
          {#if coquettishBubble}
            <span class="coquettish-bubble" role="status">{coquettishBubble}</span>
          {/if}
          {@render petStar(true)}
        </div>
        <PetChatPanel
          {petName}
          {messages}
          {streamBuffer}
          {chatStatus}
          {chatting}
          hideAvatar
          onClose={closeChat}
        >
          {#snippet headerExtra()}
            <PetCharacterSwitcher
              value={petCharacter}
              onSelect={selectPetCharacter}
              onOpenChange={(open) => (switcherOpen = open)}
              variant="compact"
            />
          {/snippet}
        </PetChatPanel>
        {#if showCompose}
          <PetComposeBar bind:draft {chatting} attached onSend={sendMessage} onFocus={onComposeFocus} />
        {/if}
      </div>
    {:else}
      <div
        class="pet-scene"
        class:has-banner={!!(peekText || nudgeText)}
      >
        {#if nudgeText}
          <div class="scene-banner peek-bubble nudge" role="status">
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <p class="peek-text" onpointerdown={dragWindow}>{nudgeText}</p>
            <div class="nudge-actions">
              <button type="button" onclick={() => sendMessage("好的，帮我看看")}>好呀</button>
              <button type="button" class="ghost" onclick={() => (nudgeText = "")}>稍后</button>
            </div>
          </div>
        {:else if peekText}
          <button type="button" class="scene-banner peek-bubble" onclick={() => openChat()}>
            <p class="peek-text" onpointerdown={dragWindow}>{peekText}</p>
            <span class="peek-hint">点击展开聊天记录</span>
          </button>
        {/if}

        <div class="scene-stage">
          {@render petStar(false)}
        </div>

        {#if !peekText && !nudgeText}
          <div class="scene-chrome" class:hint-pulse={showCharacterHint}>
            <PetCharacterSwitcher
              value={petCharacter}
              onSelect={selectPetCharacter}
              onOpenChange={(open) => (switcherOpen = open)}
              variant="scene"
              {petName}
              {level}
              {careScore}
              {isSleeping}
            />
          </div>
        {/if}
      </div>
    {/if}

    {#if wakeHint && isSleeping}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <p class="wake-hint" onpointerdown={dragWindow}>
        {wakeHint} · 点击{characterShortLabel(petCharacter)}唤醒
      </p>
    {/if}

    {#if showCompose && !showChat}
      <PetComposeBar bind:draft {chatting} onSend={sendMessage} onFocus={onComposeFocus} />
    {/if}
  </div>

  <button
    type="button"
    class="settings-toggle"
    aria-label="更多设置"
    title="更多设置"
    onclick={() => (showSettings = !showSettings)}
  >
    ⚙
  </button>
  {#if showSettings}
    <div class="settings-panel">
      <p class="settings-title">偏好</p>
      <label class="opt-in">
        <input type="checkbox" bind:checked={clipboardOptIn} />
        剪贴板预览
      </label>
      <p class="settings-hint">点击宠物对话 · 双击打开陪伴室 · 右键快捷操作</p>
    </div>
  {/if}

  {#if showContextMenu}
    <div class="context-menu-layer">
      <button
        type="button"
        class="context-menu-backdrop"
        aria-label="关闭菜单"
        onclick={dismissContextMenu}
      ></button>
      <div
        class="context-menu"
        bind:this={contextMenuEl}
        style:left="{menuX}px"
        style:top="{menuY}px"
        role="menu"
        tabindex="-1"
        onpointerdown={(e) => e.stopPropagation()}
      >
        {#if isSleeping || !isAwake}
          <button type="button" role="menuitem" onclick={menuWakePet}>{characterWakeLabel(petCharacter)}</button>
        {:else if backendOk}
          <button type="button" role="menuitem" onclick={menuToggleChat}>
            {showChat ? "收起对话" : "说说话"}
          </button>
        {/if}
        <button type="button" role="menuitem" onclick={menuOpenConsole}>打开陪伴室</button>
        <div class="context-menu-divider" role="separator"></div>
        <button type="button" role="menuitem" onclick={hidePetWindow}>关闭桌宠</button>
        <button type="button" role="menuitem" class="danger" onclick={quitPetApp}>退出应用</button>
      </div>
    </div>
  {/if}
</main>

<style>
  :global(html, body, #app) {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    overflow: hidden;
    font-family: "PingFang SC", "Segoe UI", system-ui, sans-serif;
    user-select: none;
  }

  .pet-root {
    position: relative;
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    padding: 8px 6px 10px;
    box-sizing: border-box;
    overflow: hidden;
  }

  .pet-root.switcher-open,
  .pet-root.context-menu-open {
    overflow: visible;
  }

  .pet-root.switcher-open .pet-column,
  .pet-root.context-menu-open .pet-column {
    overflow: visible;
  }

  .pet-column {
    width: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .pet-root.chat-open {
    justify-content: flex-start;
    padding: 36px 6px 8px;
    overflow: visible;
  }

  .pet-root.chat-open .pet-column {
    justify-content: stretch;
    overflow: visible;
    height: 100%;
    gap: 0;
  }

  .pet-scene {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    width: min(268px, 92vw);
    padding-bottom: 2px;
  }

  .pet-scene.has-banner {
    gap: 14px;
  }

  .scene-banner {
    width: 100%;
    flex-shrink: 0;
  }

  .scene-stage {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    flex-shrink: 0;
  }

  .scene-chrome {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-shrink: 0;
    pointer-events: none;
  }

  .scene-chrome :global(.switcher-compact) {
    pointer-events: auto;
  }

  .scene-chrome.hint-pulse :global(.scene-trigger) {
    animation: hint-glow 1.6s ease-in-out infinite;
  }

  @keyframes hint-glow {
    0%,
    100% {
      filter: drop-shadow(0 0 0 rgba(255, 180, 60, 0));
    }
    50% {
      filter: drop-shadow(0 0 6px rgba(255, 180, 60, 0.55));
    }
  }

  .pet-root:not(.chat-open) .pet-sprite {
    margin-bottom: 0;
  }

  .chat-dock {
    position: relative;
    flex: 1;
    min-height: 0;
    width: min(292px, 96vw);
    display: flex;
    flex-direction: column;
    overflow: visible;
    margin: 0 auto;
  }

  .chat-dock :global(.chat-panel) {
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;
    border-radius: 18px 18px 0 0;
  }

  .chat-dock :global(.chat-scroll) {
    flex: 1;
    max-height: none;
    padding-bottom: 10px;
  }

  .chat-dock :global(.compose-dock.attached) {
    flex-shrink: 0;
  }

  .pet-perch {
    position: absolute;
    top: 0;
    left: 50%;
    z-index: 16;
    transform: translate(-50%, -52%);
    display: flex;
    justify-content: center;
    align-items: flex-end;
    pointer-events: none;
    overflow: visible;
  }

  .pet-perch .pet-sprite {
    pointer-events: auto;
  }

  .pet-sprite.on-dialog {
    width: 76px;
    height: 82px;
    margin: 0;
  }

  .pet-sprite.on-dialog .star-body,
  .pet-sprite.on-dialog :global(.kitty-body),
  .pet-sprite.on-dialog :global(.peppa-body),
  .pet-sprite.on-dialog :global(.xiong-body),
  .pet-sprite.on-dialog :global(.gg-body) {
    width: 68px;
    height: 68px;
    animation: chubby-bob 3.2s ease-in-out infinite;
  }

  .pet-sprite.on-dialog .pet-shadow {
    display: none;
  }

  .coquettish-bubble {
    position: absolute;
    top: calc(100% + 2px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 10px;
    border-radius: 12px;
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.98) 0%,
      rgba(255, 244, 252, 0.95) 100%
    );
    color: #5c3d78;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
    border: 1px solid rgba(255, 160, 200, 0.35);
    box-shadow: 0 4px 12px rgba(255, 120, 180, 0.16);
    animation: pop 0.28s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
    z-index: 13;
  }

  .coquettish-bubble::after {
    content: "";
    position: absolute;
    top: -4px;
    left: 50%;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    background: rgba(255, 248, 252, 0.98);
    border-left: 1px solid rgba(255, 160, 200, 0.2);
    border-top: 1px solid rgba(255, 160, 200, 0.2);
    transform: rotate(45deg);
    border-radius: 2px 0 0 0;
  }

  .status-banner {
    position: absolute;
    top: 8px;
    left: 8px;
    right: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(20, 20, 30, 0.88);
    color: #f5d0a0;
    font-size: 12px;
    text-align: center;
    z-index: 2;
  }

  .status-banner button {
    margin-left: 8px;
    border: none;
    border-radius: 6px;
    padding: 2px 8px;
    cursor: pointer;
  }

  .status-banner.connecting {
    color: #b8d4ff;
  }

  .peek-bubble {
    position: relative;
    width: 100%;
    padding: 12px 14px 11px;
    border-radius: 16px;
    background: linear-gradient(
      165deg,
      rgba(255, 255, 255, 0.97) 0%,
      rgba(255, 251, 245, 0.94) 100%
    );
    color: #2a2040;
    border: 1px solid rgba(140, 110, 220, 0.1);
    box-shadow:
      0 8px 24px rgba(88, 62, 160, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.95);
    font-size: 13px;
    line-height: 1.5;
    animation: scene-banner-in 0.3s cubic-bezier(0.22, 1, 0.36, 1);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    text-align: left;
    font-family: inherit;
  }

  @keyframes scene-banner-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .peek-bubble:hover {
    transform: translateY(-1px);
    box-shadow:
      0 14px 32px rgba(88, 62, 160, 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 0.95);
  }

  .peek-bubble.nudge {
    cursor: default;
    background: linear-gradient(
      165deg,
      rgba(255, 252, 240, 0.98) 0%,
      rgba(255, 244, 220, 0.94) 100%
    );
    border-color: rgba(255, 200, 120, 0.35);
  }

  .peek-bubble.nudge:hover {
    transform: none;
  }

  .peek-text {
    margin: 0;
    cursor: grab;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }

  .peek-hint {
    display: block;
    margin-top: 6px;
    font-size: 10px;
    color: rgba(100, 80, 140, 0.45);
    letter-spacing: 0.04em;
  }

  .nudge-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .nudge-actions button {
    border: none;
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    background: linear-gradient(135deg, #ffd56b, #ffb347);
    color: #3d2a10;
  }

  .nudge-actions button.ghost {
    background: transparent;
    border: 1px solid rgba(0, 0, 0, 0.12);
  }

  .pet-sprite {
    position: relative;
    width: 140px;
    height: 132px;
    flex-shrink: 0;
    border: none;
    background: transparent;
    cursor: grab;
    padding: 0;
    touch-action: none;
    --star-light: #fff9e6;
    --star-mid: #ffe066;
    --star-deep: #ffb830;
    --star-glow: rgba(255, 210, 80, 0.45);
  }

  .pet-sprite:active {
    cursor: grabbing;
  }

  .star-body,
  :global(.kitty-body),
  :global(.peppa-body),
  :global(.xiong-body),
  :global(.gg-body) {
    width: 126px;
    height: 126px;
    display: block;
    margin: 0 auto;
    animation: chubby-bob 2.8s ease-in-out infinite;
    transform-origin: center 55%;
  }

  .character-kitty :global(.kitty-chubby) {
    transform-origin: 60px 58px;
  }

  .character-kitty :global(.kitty-face-features .eye) {
    fill: #1a1a1a;
  }

  .character-kitty :global(.kitty-face-features .eye-shine) {
    fill: #fff;
  }

  .character-kitty :global(.kitty-face-features .blush) {
    fill: #ffb8d0;
    opacity: 0.45;
  }

  .character-kitty.stage-teen :global(.kitty-bow ellipse),
  .character-kitty.stage-teen :global(.kitty-bow circle) {
    fill: #ff4d8d;
  }

  .character-kitty.stage-evolved :global(.kitty-bow ellipse) {
    fill: #e60026;
  }
  .character-kitty.stage-evolved :global(.kitty-bow circle) {
    fill: #ffd700;
  }

  .character-peppa :global(.peppa-chubby) {
    transform-origin: 48px 52px;
  }

  .character-peppa :global(.peppa-face-features .eye) {
    fill: #fff;
  }

  .character-peppa :global(.peppa-face-features .pupil) {
    fill: #1a1018;
  }

  .character-peppa :global(.peppa-face-features .mouth) {
    fill: none;
    stroke: #3a2830;
    stroke-linecap: round;
  }

  .character-peppa.stage-teen :global(.peppa-dress) {
    fill: #ff5a5a;
  }

  .character-peppa.stage-evolved :global(.peppa-dress) {
    fill: #d62848;
  }

  .character-xiong :global(.xiong-chubby) {
    transform-origin: 50px 58px;
  }

  .character-xiong :global(.xiong-face-features .eye) {
    fill: #1a1018;
  }

  .character-xiong :global(.xiong-face-features .eye-shine) {
    fill: #fff;
  }

  .character-xiong :global(.xiong-face-features .mouth) {
    fill: none;
    stroke: #3a2818;
    stroke-linecap: round;
  }

  .character-xiong.stage-teen :global(.xiong-torso),
  .character-xiong.stage-teen :global(.xiong-head) {
    filter: brightness(1.04);
  }

  .character-xiong.stage-evolved :global(.xiong-belly) {
    fill: #e8c898;
  }

  .character-gg :global(.gg-chubby) {
    transform-origin: 50px 56px;
  }

  .character-gg :global(.gg-face-features .eye) {
    fill: #fff;
  }

  .character-gg :global(.gg-face-features .pupil) {
    fill: #1a1018;
  }

  .character-gg :global(.gg-face-features .mouth) {
    fill: none;
    stroke: #3a2830;
    stroke-linecap: round;
  }

  .character-gg.stage-teen :global(.gg-torso),
  .character-gg.stage-teen :global(.gg-helmet) {
    filter: brightness(1.05);
  }

  .character-gg.stage-evolved :global(.gg-emblem),
  .character-gg.stage-evolved :global(.gg-belt) {
    fill: #ffd040;
  }

  .star-chubby {
    transform-origin: 60px 64px;
  }

  .star-stop-light {
    stop-color: var(--star-light);
  }
  .star-stop-mid {
    stop-color: var(--star-mid);
  }
  .star-stop-deep {
    stop-color: var(--star-deep);
  }

  .star-shape {
    stroke: rgba(255, 255, 255, 0.7);
    stroke-width: 2.8;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .star-belly {
    pointer-events: none;
  }

  .star-face .eye {
    fill: #3d2858;
  }
  .star-face .eye-shine {
    fill: #fff;
  }
  .star-face .blush {
    fill: #ff9ec4;
    opacity: 0.5;
  }
  .star-face .mouth {
    fill: none;
    stroke: #5c3d6e;
    stroke-width: 2.4;
    stroke-linecap: round;
  }

  .sparkle {
    fill: #fff;
    opacity: 0.85;
    animation: twinkle 2s ease-in-out infinite;
  }
  .sparkle.s2 {
    animation-delay: 0.6s;
  }
  .sparkle.s3 {
    animation-delay: 1.1s;
  }

  .pet-shadow {
    position: absolute;
    bottom: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 72px;
    height: 12px;
    border-radius: 50%;
    background: rgba(80, 50, 120, 0.22);
    filter: blur(4px);
    pointer-events: none;
  }

  .stage-teen.pet-sprite {
    --star-light: #fff0f8;
    --star-mid: #ff9ec4;
    --star-deep: #ff6b9d;
    --star-glow: rgba(255, 120, 180, 0.5);
  }

  .stage-evolved.pet-sprite {
    --star-light: #e8fcff;
    --star-mid: #7ee8ff;
    --star-deep: #4ea8de;
    --star-glow: rgba(100, 200, 255, 0.55);
  }

  .glow-mid .star-shape {
    filter: url(#starGlow) drop-shadow(0 0 10px var(--star-glow));
  }
  .glow-high .star-shape {
    filter: url(#starGlow) drop-shadow(0 0 16px var(--star-glow));
  }

  .pet-root[data-anim="thinking"] .star-body,
  .pet-root[data-anim="thinking"] :global(.kitty-body),
  .pet-root[data-anim="thinking"] :global(.peppa-body),
  .pet-root[data-anim="thinking"] :global(.xiong-body),
  .pet-root[data-anim="thinking"] :global(.gg-body) {
    animation: chubby-bob 0.95s ease-in-out infinite;
  }
  .pet-root[data-anim="thinking"] .star-chubby,
  .pet-root[data-anim="thinking"] :global(.kitty-chubby),
  .pet-root[data-anim="thinking"] :global(.peppa-chubby),
  .pet-root[data-anim="thinking"] :global(.xiong-chubby),
  .pet-root[data-anim="thinking"] :global(.gg-chubby) {
    animation: chubby-wobble 1.3s ease-in-out infinite;
  }
  .pet-root[data-anim="thinking"] .sparkle {
    animation-duration: 0.8s;
  }

  .pet-root[data-anim="talking"] .star-body,
  .pet-root[data-anim="talking"] :global(.kitty-body),
  .pet-root[data-anim="talking"] :global(.peppa-body),
  .pet-root[data-anim="talking"] :global(.xiong-body),
  .pet-root[data-anim="talking"] :global(.gg-body) {
    animation: chubby-bob 0.5s ease-in-out infinite;
  }
  .pet-root[data-anim="talking"] .mouth,
  .pet-root[data-anim="talking"] :global(.peppa-face-features .mouth),
  .pet-root[data-anim="talking"] :global(.xiong-face-features .mouth),
  .pet-root[data-anim="talking"] :global(.gg-face-features .mouth) {
    transform: scaleY(1.2);
    transform-origin: 60px 72px;
  }

  .pet-root[data-anim="talking"] :global(.peppa-face-features .mouth) {
    transform-origin: 32px 48px;
  }

  .pet-root[data-anim="talking"] :global(.xiong-face-features .mouth) {
    transform-origin: 50px 52px;
  }

  .pet-root[data-anim="talking"] :global(.gg-face-features .mouth) {
    transform-origin: 50px 50px;
  }

  .pet-root[data-anim="celebrate"] .star-body,
  .pet-root[data-anim="celebrate"] :global(.kitty-body),
  .pet-root[data-anim="celebrate"] :global(.peppa-body),
  .pet-root[data-anim="celebrate"] :global(.xiong-body),
  .pet-root[data-anim="celebrate"] :global(.gg-body),
  .pet-root[data-anim="cheer_up"] .star-body,
  .pet-root[data-anim="cheer_up"] :global(.kitty-body),
  .pet-root[data-anim="cheer_up"] :global(.peppa-body),
  .pet-root[data-anim="cheer_up"] :global(.xiong-body),
  .pet-root[data-anim="cheer_up"] :global(.gg-body) {
    animation: chubby-bounce 0.55s ease infinite;
  }

  .pet-root[data-anim="coquettish"] .star-body,
  .pet-root[data-anim="coquettish"] :global(.kitty-body),
  .pet-root[data-anim="coquettish"] :global(.peppa-body),
  .pet-root[data-anim="coquettish"] :global(.xiong-body),
  .pet-root[data-anim="coquettish"] :global(.gg-body) {
    animation: coquettish-sway 0.48s ease-in-out infinite;
  }

  .pet-root[data-anim="coquettish"] .star-chubby,
  .pet-root[data-anim="coquettish"] :global(.kitty-chubby),
  .pet-root[data-anim="coquettish"] :global(.peppa-chubby),
  .pet-root[data-anim="coquettish"] :global(.xiong-chubby),
  .pet-root[data-anim="coquettish"] :global(.gg-chubby) {
    animation: chubby-wobble 0.52s ease-in-out infinite;
  }

  .pet-root[data-anim="coquettish"] .star-face .blush,
  .pet-root[data-anim="coquettish"] :global(.kitty-face-features .blush),
  .pet-root[data-anim="coquettish"] :global(.peppa-face-features .blush) {
    opacity: 0.78;
    animation: blush-pulse 0.55s ease-in-out infinite;
  }

  .pet-root[data-anim="coquettish"] .star-face .mouth,
  .pet-root[data-anim="coquettish"] :global(.peppa-face-features .mouth),
  .pet-root[data-anim="coquettish"] :global(.xiong-face-features .mouth),
  .pet-root[data-anim="coquettish"] :global(.gg-face-features .mouth) {
    stroke-width: 2.8;
    transform: scale(1.12, 1.08);
    transform-origin: 60px 72px;
  }

  .pet-root[data-anim="coquettish"] :global(.peppa-face-features .mouth) {
    transform-origin: 32px 48px;
  }

  .pet-root[data-anim="coquettish"] :global(.xiong-face-features .mouth) {
    transform-origin: 50px 52px;
  }

  .pet-root[data-anim="coquettish"] :global(.gg-face-features .mouth) {
    transform-origin: 50px 50px;
  }

  .pet-root[data-anim="coquettish"] .star-face .eye,
  .pet-root[data-anim="coquettish"] :global(.kitty-face-features .eye) {
    ry: 6.2;
  }

  .pet-root[data-anim="coquettish"] :global(.peppa-face-features .eye),
  .pet-root[data-anim="coquettish"] :global(.xiong-face-features .eye),
  .pet-root[data-anim="coquettish"] :global(.gg-face-features .eye) {
    ry: 5.6;
  }

  .pet-root[data-anim="blink"] .star-face .eye,
  .pet-root[data-anim="blink"] :global(.kitty-face-features .eye) {
    ry: 1.4;
  }

  .pet-root[data-anim="blink"] :global(.peppa-face-features .eye),
  .pet-root[data-anim="blink"] :global(.xiong-face-features .eye),
  .pet-root[data-anim="blink"] :global(.gg-face-features .eye) {
    ry: 0.8;
  }

  .pet-root[data-anim="blink"] :global(.peppa-face-features .pupil),
  .pet-root[data-anim="blink"] :global(.peppa-face-features .eye-glint),
  .pet-root[data-anim="blink"] :global(.xiong-face-features .eye-shine),
  .pet-root[data-anim="blink"] :global(.gg-face-features .pupil),
  .pet-root[data-anim="blink"] :global(.gg-face-features .eye-glint) {
    opacity: 0;
  }

  .pet-root.sleeping .star-body,
  .pet-root.sleeping :global(.kitty-body),
  .pet-root.sleeping :global(.peppa-body),
  .pet-root.sleeping :global(.xiong-body),
  .pet-root.sleeping :global(.gg-body) {
    animation: none;
    filter: grayscale(0.22) brightness(0.9);
  }

  .pet-root.sleeping[data-character="peppa_pig"] :global(.peppa-body),
  .pet-root.sleeping[data-character="xiong_er"] :global(.xiong-body),
  .pet-root.sleeping[data-character="gg_bond"] :global(.gg-body) {
    filter: grayscale(0.2) brightness(0.9);
  }
  .pet-root.sleeping .star-chubby,
  .pet-root.sleeping :global(.kitty-chubby),
  .pet-root.sleeping :global(.peppa-chubby),
  .pet-root.sleeping :global(.xiong-chubby),
  .pet-root.sleeping :global(.gg-chubby) {
    animation: none;
  }
  .pet-root.sleeping .sparkle {
    opacity: 0.2;
    animation: none;
  }
  .pet-root.sleeping .star-face .eye,
  .pet-root.sleeping :global(.kitty-face-features .eye) {
    ry: 1;
  }

  .pet-root.sleeping :global(.peppa-face-features .eye),
  .pet-root.sleeping :global(.xiong-face-features .eye),
  .pet-root.sleeping :global(.gg-face-features .eye) {
    ry: 0.6;
  }

  .pet-root.sleeping :global(.peppa-face-features .pupil),
  .pet-root.sleeping :global(.peppa-face-features .eye-glint),
  .pet-root.sleeping :global(.xiong-face-features .eye-shine),
  .pet-root.sleeping :global(.gg-face-features .pupil),
  .pet-root.sleeping :global(.gg-face-features .eye-glint) {
    opacity: 0;
  }

  .sleep-tag {
    font-size: 10px;
  }

  .wake-hint {
    margin: 2px 0 0;
    font-size: 10px;
    color: rgba(60, 45, 90, 0.55);
    cursor: grab;
  }

  .settings-toggle {
    position: absolute;
    top: 6px;
    right: 8px;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.55);
    color: rgba(80, 60, 120, 0.7);
    font-size: 10px;
    cursor: pointer;
    line-height: 1;
    opacity: 0.65;
  }
  .settings-toggle:hover {
    opacity: 1;
  }

  .settings-panel {
    position: absolute;
    top: 32px;
    right: 8px;
    min-width: 168px;
    padding: 8px 10px 10px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    font-size: 10px;
    z-index: 3;
  }

  .opt-in {
    display: flex;
    align-items: center;
    gap: 4px;
    color: rgba(40, 40, 50, 0.85);
    cursor: pointer;
  }

  .settings-hint {
    margin: 6px 0 0;
    color: rgba(60, 50, 80, 0.55);
    font-size: 9px;
  }

  .chat-dock :global(.chat-header-extra .compact-trigger) {
    padding: 4px 8px 4px 5px;
    gap: 5px;
  }

  .chat-dock :global(.chat-header-extra .trigger-avatar) {
    width: 24px;
    height: 24px;
  }

  .chat-dock :global(.chat-header-extra .trigger-avatar svg) {
    width: 15px;
    height: 15px;
  }

  .chat-dock :global(.chat-header-extra .trigger-name) {
    font-size: 10px;
    max-width: 56px;
  }

  .settings-title {
    margin: 0 0 6px;
    font-size: 10px;
    font-weight: 600;
    color: rgba(40, 40, 50, 0.9);
  }

  .context-menu-layer {
    position: fixed;
    inset: 0;
    z-index: 20;
  }

  .context-menu-backdrop {
    position: absolute;
    inset: 0;
    border: none;
    padding: 0;
    margin: 0;
    background: transparent;
    cursor: default;
  }

  .context-menu {
    position: absolute;
    min-width: 168px;
    padding: 6px;
    border-radius: 12px;
    background: rgba(22, 18, 36, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(12px);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .context-menu button {
    width: 100%;
    border: none;
    border-radius: 8px;
    padding: 8px 10px;
    background: transparent;
    color: rgba(255, 255, 255, 0.92);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .context-menu button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .context-menu button.danger {
    color: #ffb4b4;
  }

  .context-menu button.danger:hover {
    background: rgba(255, 90, 90, 0.15);
  }

  .context-menu-divider {
    height: 1px;
    margin: 4px 2px;
    background: rgba(255, 255, 255, 0.1);
  }

  @keyframes chubby-bob {
    0%,
    100% {
      transform: translateY(0) scale(1.02, 1.06);
    }
    50% {
      transform: translateY(-6px) scale(1.06, 1.02);
    }
  }

  @keyframes chubby-wobble {
    0%,
    100% {
      transform: rotate(0deg) scale(1);
    }
    25% {
      transform: rotate(-2.5deg) scale(1.02, 0.98);
    }
    75% {
      transform: rotate(2.5deg) scale(1.02, 0.98);
    }
  }

  @keyframes chubby-bounce {
    0%,
    100% {
      transform: translateY(0) scale(1.03, 1.07);
    }
    50% {
      transform: translateY(-11px) scale(1.07, 1.03);
    }
  }

  @keyframes coquettish-sway {
    0%,
    100% {
      transform: translateY(3px) rotate(-5deg) scale(1.04, 1.02);
    }
    50% {
      transform: translateY(0) rotate(5deg) scale(1.04, 1.02);
    }
  }

  @keyframes blush-pulse {
    0%,
    100% {
      opacity: 0.55;
      transform: scale(1);
    }
    50% {
      opacity: 0.85;
      transform: scale(1.08);
    }
  }

  @keyframes twinkle {
    0%,
    100% {
      opacity: 0.35;
      transform: scale(0.85);
    }
    50% {
      opacity: 1;
      transform: scale(1.15);
    }
  }

  @keyframes pulse {
    0%,
    100% {
      filter: brightness(1);
    }
    50% {
      filter: brightness(1.08);
    }
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
