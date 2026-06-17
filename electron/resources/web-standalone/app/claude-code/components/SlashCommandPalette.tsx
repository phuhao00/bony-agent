"use client";

import { Terminal } from "lucide-react";
import { groupSlashCommands, type SlashCommandDef } from "../lib/slash-commands";

type SlashCommandPaletteProps = {
  commands: SlashCommandDef[];
  activeIndex: number;
  onPick: (command: SlashCommandDef) => void;
  onHover: (index: number) => void;
};

export function SlashCommandPalette({
  commands,
  activeIndex,
  onPick,
  onHover,
}: SlashCommandPaletteProps) {
  if (!commands.length) {
    return (
      <div className="absolute bottom-full left-0 right-0 z-20 mb-1 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-xs text-[color:var(--label-secondary)] shadow-lg">
        无匹配命令
      </div>
    );
  }

  const groups = groupSlashCommands(commands);
  let flatIndex = 0;

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-[min(420px,50vh)] overflow-y-auto rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] py-1 shadow-lg"
      role="listbox"
    >
      <div className="sticky top-0 z-10 border-b border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-1.5 text-[10px] text-[color:var(--label-secondary)]">
        {commands.length} 条命令 · 点击/Enter 执行本地命令
      </div>
      {groups.map((group) => (
        <div key={group.category}>
          <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
            {group.label}
            <span className="ml-1 font-normal opacity-60">({group.items.length})</span>
          </div>
          {group.items.map((cmd) => {
            const index = flatIndex++;
            const active = index === activeIndex;
            return (
              <button
                key={`${group.category}-${cmd.name}`}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(cmd);
                }}
                className={[
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition",
                  active
                    ? "bg-[color:color-mix(in_srgb,var(--accent)_12%,transparent)]"
                    : "hover:bg-[var(--nav-active-fill)]",
                ].join(" ")}
              >
                <span className="mt-0.5 shrink-0 font-mono font-semibold text-[color:var(--accent)]">
                  /{cmd.name}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[color:var(--foreground)]">{cmd.description}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[color:var(--label-secondary)]">
                    {cmd.scope === "local" ? (
                      <span className="rounded bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)] px-1 py-0.5">
                        本地
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 rounded border border-[color:var(--separator-subtle)] px-1 py-0.5">
                        <Terminal className="h-2.5 w-2.5" />
                        Claude Code
                      </span>
                    )}
                    {cmd.argumentHint ? <span>{cmd.argumentHint}</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
