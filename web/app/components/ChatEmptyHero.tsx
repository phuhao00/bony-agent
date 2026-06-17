"use client";

import { ChatAttachmentMenu } from "@/components/ChatAttachmentMenu";
import { ChatWorkspaceContextStrip } from "@/components/ChatWorkspaceContextStrip";
import { ClaudeCodePermissionBanner } from "@/components/ClaudeCodePermissionBanner";
import {
    MoodPermissionDropdown,
    type MoodPermission,
} from "@/components/MoodPermissionDropdown";
import MultimodalInput, {
    type AttachedFile,
    type MultimodalInputHandle,
} from "@/components/MultimodalInput";
import { WorkspaceAttachedChips } from "@/components/WorkspaceAttachedChips";
import {
    ArrowUp,
    Mic,
    MicOff,
    Square,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";

const HERO_PROMPT_KEYS = [
  "chat.heroPromptImage",
  "chat.heroPromptScript",
  "chat.heroPromptPlan",
] as const;

const HERO_CAPABILITY_KEYS = [
  "chat.heroPlan",
  "chat.heroCapabilityTools",
  "chat.heroExecute",
] as const;

type ChatEmptyHeroProps = {
  t: (key: string) => string;
  input: string;
  setInput: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  multimodalRef: RefObject<MultimodalInputHandle | null>;
  attachedFiles: AttachedFile[];
  onFilesChange: React.Dispatch<React.SetStateAction<AttachedFile[]>>;
  workspaceAttachedPaths: string[];
  onDetachWorkspacePath: (path: string) => void;
  placeholder: string;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  moodPermission: MoodPermission;
  onMoodPick: (next: MoodPermission) => void;
  chatPermOpen: boolean;
  onChatPermOpenChange: (open: boolean) => void;
  chatPermRef: RefObject<HTMLDivElement | null>;
  chatVoiceOn: boolean;
  onVoiceToggle: () => void;
  isLoading: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onStop: () => void;
  onApplyPrompt: (text: string) => void;
  chatVoiceTip: string | null;
  claudePermission: {
    permission_id: string;
    tool_name?: string;
    title?: string;
    description?: string;
  } | null;
  claudePermissionBusy: boolean;
  onAllowClaudePermission: () => void;
  onDenyClaudePermission: () => void;
  assistantPicker?: ReactNode;
};

export function ChatEmptyHero({
  t,
  input,
  setInput,
  inputRef,
  multimodalRef,
  attachedFiles,
  onFilesChange,
  workspaceAttachedPaths,
  onDetachWorkspacePath,
  placeholder,
  onKeyDown,
  moodPermission,
  onMoodPick,
  chatPermOpen,
  onChatPermOpenChange,
  chatPermRef,
  chatVoiceOn,
  onVoiceToggle,
  isLoading,
  canSubmit,
  onSubmit,
  onStop,
  onApplyPrompt,
  chatVoiceTip,
  claudePermission,
  claudePermissionBusy,
  onAllowClaudePermission,
  onDenyClaudePermission,
  assistantPicker,
}: ChatEmptyHeroProps) {
  return (
    <div className="relative flex min-h-[calc(100dvh-7.5rem)] w-full flex-col">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute left-1/2 top-[14%] h-[min(28rem,42vh)] w-[min(44rem,88vw)] -translate-x-1/2 rounded-full bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)] blur-3xl" />
        <div className="absolute -right-8 top-[32%] h-56 w-56 rounded-full bg-[color:color-mix(in_srgb,var(--accent)_6%,transparent)] blur-3xl" />
        <div className="absolute -left-12 bottom-[18%] h-48 w-48 rounded-full bg-[color:color-mix(in_srgb,var(--foreground)_4%,transparent)] blur-3xl" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[min(52rem,calc(100%-2rem))] flex-1 flex-col justify-center px-4 pb-[clamp(2rem,8vh,5rem)] pt-[clamp(1.5rem,6vh,4rem)] sm:px-6">
        <div className="text-center">
          <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--label-secondary)]">
            {t("chat.heroEyebrow")}
          </p>
          <h2 className="text-balance text-[clamp(2rem,3.6vw+0.75rem,3.25rem)] font-semibold leading-[1.12] tracking-[-0.03em] text-[color:var(--foreground)]">
            {t("chat.heroTitle")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-[15px] leading-7 text-[color:var(--label-secondary)] sm:text-base">
            {t("chat.heroSubtitleLine")}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            {HERO_CAPABILITY_KEYS.map((key) => (
              <span
                key={key}
                className="inline-flex items-center rounded-full border border-[color:color-mix(in_srgb,var(--accent)_22%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)] px-3.5 py-1.5 text-xs font-medium text-[color:var(--foreground)]"
              >
                {t(key)}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-10 w-full">
          {chatVoiceTip ? (
            <div className="mb-3 rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-800 dark:text-amber-200">
              {chatVoiceTip}
            </div>
          ) : null}
          <ClaudeCodePermissionBanner
            pending={claudePermission}
            busy={claudePermissionBusy}
            onAllow={onAllowClaudePermission}
            onDeny={onDenyClaudePermission}
          />
          <div className="card-surface overflow-visible rounded-[24px] shadow-[0_16px_56px_-18px_rgba(0,0,0,0.12)] ring-1 ring-[color:color-mix(in_srgb,var(--foreground)_7%,transparent)] transition-[box-shadow,ring-color,transform] focus-within:-translate-y-0.5 focus-within:shadow-[0_22px_64px_-16px_rgba(0,0,0,0.16)] focus-within:ring-2 focus-within:ring-[color:rgba(255,149,0,0.26)] dark:shadow-[0_18px_56px_-20px_rgba(0,0,0,0.62)]">
            <WorkspaceAttachedChips
              paths={workspaceAttachedPaths}
              onRemove={onDetachWorkspacePath}
              label={t("chat.workspace.attachedFilesLabel")}
            />
            <MultimodalInput
              ref={multimodalRef}
              inputRef={inputRef}
              rows={2}
              value={input}
              onChange={setInput}
              onKeyDown={onKeyDown}
              files={attachedFiles}
              onFilesChange={onFilesChange}
              placeholder={placeholder}
              className="min-h-[4.5rem] px-5 pt-5 text-[15px] leading-relaxed sm:min-h-[5rem] sm:text-base"
            />
            <div className="flex items-center justify-between gap-2 border-t border-[color:var(--separator-subtle)] px-4 py-3 sm:px-5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <ChatAttachmentMenu multimodalRef={multimodalRef} />
                <MoodPermissionDropdown
                  value={moodPermission}
                  open={chatPermOpen}
                  onOpenChange={onChatPermOpenChange}
                  onPick={onMoodPick}
                  containerRef={chatPermRef}
                  triggerId="hero-mood-trigger"
                  menuId="hero-mood-menu"
                  menuVariant="onTheme"
                  iconOnlyTrigger
                  triggerClassName="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-2.5 text-[color:var(--foreground)] shadow-sm transition-colors hover:bg-[var(--nav-active-fill)]"
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title={t("chat.voiceInputTitle")}
                  aria-label={t("chat.voiceInputAria")}
                  aria-pressed={chatVoiceOn}
                  onClick={onVoiceToggle}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-90 active:scale-[0.97] ${
                    chatVoiceOn
                      ? "bg-[color:var(--accent)] text-white shadow-sm"
                      : "bg-transparent text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                  }`}
                >
                  {chatVoiceOn ? (
                    <MicOff className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
                  ) : (
                    <Mic className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} />
                  )}
                </button>
                {isLoading ? (
                  <button
                    type="button"
                    aria-label={t("chat.stopGenerating")}
                    title={t("chat.stopGenerating")}
                    onClick={onStop}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--chrome-rail-bg)] text-[color:var(--foreground)] shadow-sm ring-1 ring-[color:var(--separator-subtle)] transition hover:opacity-90 active:scale-[0.97]"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={t("chat.start")}
                    title={t("chat.start")}
                    onClick={onSubmit}
                    disabled={isLoading || !canSubmit}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--chrome-rail-bg)] text-[color:var(--foreground)] shadow-sm ring-1 ring-[color:var(--separator-subtle)] transition hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35 disabled:ring-0"
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                  </button>
                )}
              </div>
            </div>
            {assistantPicker ? (
              <div className="border-t border-[color:var(--separator-subtle)] px-4 py-2 sm:px-5">
                {assistantPicker}
              </div>
            ) : null}
            <ChatWorkspaceContextStrip />
          </div>
        </div>

        <div className="mt-8">
          <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--label-tertiary)]">
            {t("chat.heroQuickStart")}
          </p>
          <div className="flex flex-wrap justify-center gap-2.5">
            {HERO_PROMPT_KEYS.map((key) => {
              const label = t(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onApplyPrompt(label)}
                  className="max-w-full rounded-2xl border border-[color:var(--separator-subtle)] bg-[var(--card-surface)] px-4 py-2.5 text-left text-[13px] leading-snug text-[color:var(--foreground)] shadow-sm transition-colors hover:border-[color:color-mix(in_srgb,var(--accent)_30%,transparent)] hover:bg-[var(--nav-active-fill)] sm:max-w-[16rem]"
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
