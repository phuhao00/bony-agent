<script lang="ts">
  import { onDestroy } from "svelte";
  import { PET_CHARACTERS, type PetCharacterId } from "../lib/petCharacter";

  interface Props {
    value: PetCharacterId;
    onSelect: (id: PetCharacterId) => void;
    onOpenChange?: (open: boolean) => void;
    /** compact = chat header chip; scene = idle status + switch chip */
    variant?: "compact" | "scene";
    petName?: string;
    level?: number;
    careScore?: number;
    isSleeping?: boolean;
  }

  let {
    value,
    onSelect,
    onOpenChange,
    variant = "compact",
    petName = "",
    level = 1,
    careScore = 0,
    isSleeping = false,
  }: Props = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement | undefined>();
  let popoverEl = $state<HTMLDivElement | undefined>();
  let popoverTop = $state(0);
  let popoverLeft = $state(0);
  let popoverPlacement = $state<"below" | "above">("below");
  let switchedFlash = $state(false);
  let switchReady = false;
  let switchFlashTimer: ReturnType<typeof setTimeout> | undefined;

  const accent: Record<PetCharacterId, string> = {
    star: "#ffb830",
    hello_kitty: "#ff4d6d",
    peppa_pig: "#f05454",
    xiong_er: "#c88850",
    gg_bond: "#e02030",
  };

  const current = $derived(PET_CHARACTERS.find((c) => c.id === value) ?? PET_CHARACTERS[0]);

  $effect(() => {
    void value;
    if (!switchReady) {
      switchReady = true;
      return;
    }
    switchedFlash = true;
    if (switchFlashTimer) clearTimeout(switchFlashTimer);
    switchFlashTimer = setTimeout(() => {
      switchedFlash = false;
      switchFlashTimer = undefined;
    }, 520);
  });

  onDestroy(() => {
    if (switchFlashTimer) clearTimeout(switchFlashTimer);
  });

  function stopDrag(e: PointerEvent) {
    e.stopPropagation();
  }

  function setOpen(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }

  function pick(id: PetCharacterId) {
    if (id !== value) onSelect(id);
    setOpen(false);
  }

  function toggleOpen() {
    setOpen(!open);
  }

  function closePopover() {
    setOpen(false);
  }

  function syncPopoverPosition() {
    if (!triggerEl || !open) return;

    const rect = triggerEl.getBoundingClientRect();
    const margin = 10;
    const gap = 8;
    const popoverWidth = popoverEl?.offsetWidth ?? 268;
    const popoverHeight = popoverEl?.offsetHeight ?? 76;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const preferBelow =
      spaceBelow >= popoverHeight + gap || spaceBelow >= spaceAbove;

    let left = rect.left + rect.width / 2;
    const halfW = popoverWidth / 2;
    left = Math.max(margin + halfW, Math.min(window.innerWidth - margin - halfW, left));
    popoverLeft = left;

    if (preferBelow) {
      popoverPlacement = "below";
      popoverTop = Math.min(
        rect.bottom + gap,
        window.innerHeight - margin - popoverHeight,
      );
    } else {
      popoverPlacement = "above";
      const anchorTop = rect.top - gap;
      popoverTop = Math.max(margin + popoverHeight, anchorTop);
    }
  }

  $effect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => {
      syncPopoverPosition();
      requestAnimationFrame(syncPopoverPosition);
    });

    const onLayout = () => syncPopoverPosition();
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout, true);
    };
  });
</script>

{#snippet CharacterIcon(id: PetCharacterId)}
  {#if id === "star"}
    <svg viewBox="0 0 24 24" class="char-svg icon-star">
      <path
        d="M12 3.2 L14.2 9.2 L20.5 9.5 L15.5 13.5 L17.2 19.8 L12 16.5 L6.8 19.8 L8.5 13.5 L3.5 9.5 L9.8 9.2 Z"
        fill="currentColor"
      />
    </svg>
  {:else if id === "hello_kitty"}
    <svg viewBox="0 0 24 24" class="char-svg icon-kitty">
      <circle cx="12" cy="13" r="7" fill="currentColor" opacity="0.95" />
      <path d="M6 11 L4 5 L9 8 Z" fill="currentColor" />
      <path d="M18 11 L20 5 L15 8 Z" fill="currentColor" />
      <ellipse cx="9.5" cy="5.5" rx="2.2" ry="1.6" fill="#e60026" />
      <ellipse cx="12.5" cy="5.5" rx="2.2" ry="1.6" fill="#e60026" />
      <circle cx="11" cy="5.5" r="1" fill="#cc0020" />
    </svg>
  {:else if id === "peppa_pig"}
    <svg viewBox="0 0 24 24" class="char-svg icon-peppa">
      <path
        fill="#f8a0b8"
        stroke="#333"
        stroke-width="0.6"
        d="M15 7 L10 7 C8 7 6 6 5 5 C3 4 2 5 2 7 C2 9 4 10 6 10 L10 10 L10 9 L15 9 C16 9 17 8 17 8 C17 7 16 7 15 7 Z"
      />
      <circle cx="6.5" cy="7" r="0.6" fill="#fff" />
      <circle cx="8.5" cy="7" r="0.6" fill="#fff" />
      <path d="M5 10 L9 10 L10 14 L4 14 Z" fill="#f05454" stroke="#333" stroke-width="0.4" />
    </svg>
  {:else if id === "xiong_er"}
    <svg viewBox="0 0 24 24" class="char-svg icon-xiong">
      <circle cx="12" cy="9" r="5.5" fill="#c88850" />
      <circle cx="8" cy="5" r="2" fill="#c88850" />
      <circle cx="16" cy="5" r="2" fill="#c88850" />
      <ellipse cx="12" cy="15" rx="6" ry="5.5" fill="#c88850" />
      <ellipse cx="12" cy="16" rx="3.5" ry="3" fill="#e8c898" />
      <ellipse cx="12" cy="9.5" rx="2" ry="1.5" fill="#2a1810" />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" class="char-svg icon-gg">
      <circle cx="12" cy="10" r="5" fill="#f8a8c0" />
      <path d="M8 6 L6 3 L10 5 Z" fill="#e02030" />
      <path d="M16 6 L18 3 L14 5 Z" fill="#e02030" />
      <rect x="7" y="13" width="10" height="7" rx="1" fill="#e02030" />
      <circle cx="12" cy="15" r="2" fill="#f0c040" />
    </svg>
  {/if}
{/snippet}

{#if variant === "compact" || variant === "scene"}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="switcher-compact"
    class:switcher-scene={variant === "scene"}
    class:open
    onpointerdown={stopDrag}
  >
    {#if open}
      <button type="button" class="popover-backdrop" aria-label="关闭形象选择" onclick={closePopover}></button>
    {/if}

    <button
      type="button"
      class="compact-trigger"
      class:scene-trigger={variant === "scene"}
      class:just-switched={switchedFlash}
      bind:this={triggerEl}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-label={
        variant === "scene"
          ? `${petName} Lv.${level}，当前形象 ${current.label}，点击切换`
          : `当前形象 ${current.label}，点击切换`
      }
      onclick={toggleOpen}
    >
      <span class="trigger-avatar" style="--accent: {accent[value]}">
        {@render CharacterIcon(value)}
      </span>
      {#if variant === "scene"}
        <span class="scene-text">
          <span class="scene-name">{petName}</span>
          <span class="scene-sub">
            Lv.{level}
            {#if isSleeping}
              <span class="scene-care sleep">💤</span>
            {:else}
              <span class="scene-care">✦ {careScore}</span>
            {/if}
          </span>
        </span>
        <span class="trigger-chevron" aria-hidden="true"></span>
      {:else}
        <span class="trigger-name solo">{current.shortLabel}</span>
        <span class="trigger-chevron" aria-hidden="true"></span>
      {/if}
    </button>

    {#if open}
      <div
        class="popover popover-fixed"
        class:above={popoverPlacement === "above"}
        bind:this={popoverEl}
        style="top: {popoverTop}px; left: {popoverLeft}px;"
        role="listbox"
        aria-label="选择桌宠形象"
      >
        <div class="popover-row">
          {#each PET_CHARACTERS as opt (opt.id)}
            <button
              type="button"
              class="char-pill"
              class:selected={value === opt.id}
              role="option"
              aria-selected={value === opt.id}
              aria-label={opt.label}
              title={opt.label}
              style="--accent: {accent[opt.id]}"
              onclick={() => pick(opt.id)}
            >
              <span class="pill-avatar">
                {@render CharacterIcon(opt.id)}
              </span>
              <span class="pill-name">{opt.shortLabel}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .char-svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  /* ── compact: chip + popover ── */
  .switcher-compact {
    position: relative;
    pointer-events: auto;
  }

  .popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 4;
    border: none;
    background: transparent;
    cursor: default;
    padding: 0;
  }

  .compact-trigger {
    position: relative;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px 5px 6px;
    border: none;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow:
      0 2px 14px rgba(50, 35, 90, 0.12),
      0 0 0 1px rgba(255, 255, 255, 0.7) inset;
    cursor: pointer;
    transition:
      box-shadow 0.2s ease,
      transform 0.15s ease;
  }

  .compact-trigger:hover {
    box-shadow:
      0 4px 18px rgba(50, 35, 90, 0.16),
      0 0 0 1px rgba(255, 255, 255, 0.8) inset;
  }

  .compact-trigger:active {
    transform: scale(0.97);
  }

  .open .compact-trigger {
    box-shadow:
      0 4px 20px rgba(50, 35, 90, 0.18),
      0 0 0 2px color-mix(in srgb, var(--accent, #ffb830) 35%, transparent);
  }

  .compact-trigger.just-switched,
  .scene-trigger.just-switched {
    animation: switch-flash 0.52s ease;
  }

  @keyframes switch-flash {
    0% {
      transform: scale(1);
      box-shadow:
        0 2px 14px rgba(50, 35, 90, 0.12),
        0 0 0 1px rgba(255, 255, 255, 0.7) inset;
    }
    35% {
      transform: scale(1.04);
      box-shadow:
        0 4px 18px rgba(50, 35, 90, 0.16),
        0 0 0 2px color-mix(in srgb, var(--accent, #ffb830) 42%, transparent);
    }
    100% {
      transform: scale(1);
      box-shadow:
        0 2px 14px rgba(50, 35, 90, 0.12),
        0 0 0 1px rgba(255, 255, 255, 0.7) inset;
    }
  }

  .trigger-avatar {
    --accent: #ffb830;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 14%, #fff);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
    flex-shrink: 0;
  }

  .trigger-avatar :global(svg) {
    width: 18px;
    height: 18px;
  }

  .trigger-name.solo {
    font-size: 11px;
    font-weight: 700;
    color: rgba(40, 30, 65, 0.92);
    max-width: 72px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.1;
    min-width: 0;
  }

  .scene-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.1;
    min-width: 0;
    flex: 1;
  }

  .scene-name {
    font-size: 11px;
    font-weight: 650;
    color: rgba(40, 30, 65, 0.92);
    max-width: 108px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scene-sub {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 9px;
    font-weight: 600;
    color: rgba(70, 55, 100, 0.72);
  }

  .scene-care {
    font-weight: 600;
    color: rgba(255, 150, 50, 0.9);
  }

  .scene-care.sleep {
    color: rgba(100, 80, 140, 0.7);
  }

  .scene-trigger {
    width: min(248px, 88vw);
    padding: 6px 10px 6px 6px;
    gap: 8px;
  }

  .switcher-scene .trigger-avatar {
    width: 30px;
    height: 30px;
  }

  .switcher-scene .trigger-avatar :global(svg) {
    width: 17px;
    height: 17px;
  }

  .trigger-chevron {
    width: 14px;
    height: 14px;
    margin-left: 2px;
    opacity: 0.45;
    background: currentColor;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")
      center / contain no-repeat;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='black' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")
      center / contain no-repeat;
    transition: transform 0.22s ease;
  }

  .open .trigger-chevron {
    transform: rotate(180deg);
    opacity: 0.7;
  }

  .popover-fixed {
    position: fixed;
    z-index: 10000;
    transform: translateX(-50%);
    width: max-content;
    max-width: min(280px, calc(100vw - 16px));
    padding: 8px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.97);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    box-shadow:
      0 10px 36px rgba(40, 25, 70, 0.2),
      0 0 0 1px rgba(255, 255, 255, 0.85) inset;
    animation: popover-in-below 0.2s cubic-bezier(0.34, 1.2, 0.64, 1);
    pointer-events: auto;
  }

  .popover-fixed.above {
    transform: translate(-50%, -100%);
    animation: popover-in-above 0.2s cubic-bezier(0.34, 1.2, 0.64, 1);
  }

  @keyframes popover-in-below {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-4px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
  }

  @keyframes popover-in-above {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-100% + 4px)) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -100%) scale(1);
    }
  }

  .popover-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: stretch;
    gap: 5px;
    max-width: min(268px, calc(100vw - 20px));
  }

  .char-pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 46px;
    padding: 6px 4px 5px;
    border: none;
    border-radius: 11px;
    background: rgba(120, 90, 160, 0.05);
    cursor: pointer;
    transition:
      background 0.18s ease,
      transform 0.15s ease,
      box-shadow 0.18s ease;
  }

  .char-pill:hover {
    background: color-mix(in srgb, var(--accent) 10%, #fff);
    transform: translateY(-1px);
  }

  .char-pill.selected {
    background: color-mix(in srgb, var(--accent) 16%, #fff);
    box-shadow:
      0 0 0 1.5px color-mix(in srgb, var(--accent) 45%, transparent),
      0 2px 8px color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .char-pill:active {
    transform: scale(0.96);
  }

  .pill-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 12%, #fff);
  }

  .pill-avatar :global(svg) {
    width: 18px;
    height: 18px;
  }

  .pill-name {
    font-size: 8px;
    font-weight: 600;
    color: rgba(45, 35, 70, 0.8);
    line-height: 1;
    max-width: 44px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }

  .icon-star {
    color: #ffb830;
  }

  .icon-kitty {
    color: #f8f4f4;
  }

  .icon-peppa {
    color: #f8a0bc;
  }

  .icon-xiong {
    color: #c88850;
  }

  .icon-gg {
    color: #f8a8c0;
  }
</style>
