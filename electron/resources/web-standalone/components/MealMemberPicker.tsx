"use client";

import { parseJsonResponse } from "@/lib/apiJson";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface MealMember {
  open_id: string;
  name: string;
}

interface MealMemberPickerProps {
  value: string;
  onChange: (name: string, member: MealMember | null) => void;
  onSelectMember?: (member: MealMember) => void;
  /** 提醒群 chat_id；变更后会重新拉取成员 */
  chatId?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** 多选场景：选中后保持搜索框，不展示「已选卡片」 */
  multi?: boolean;
}

function memberInitial(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  return t.slice(-1);
}

export function MealMemberPicker({
  value,
  onChange,
  onSelectMember,
  chatId = "",
  placeholder = "输入姓名搜索",
  className = "",
  disabled = false,
  multi = false,
}: MealMemberPickerProps) {
  const [members, setMembers] = useState<MealMember[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const qs = chatId.trim() ? `?chat_id=${encodeURIComponent(chatId.trim())}` : "";
      const res = await fetch(`/api/meal/feishu/chat-members${qs}`, {
        cache: "no-store",
      });
      const d = await parseJsonResponse<{
        ok?: boolean;
        members?: MealMember[];
        error?: string;
        chat_source?: string;
      }>(res);
      if (!d.ok) {
        setMembers([]);
        setLoadError(d.error || "无法加载群成员");
        return;
      }
      setMembers(d.members || []);
      if (d.chat_source === "auto_first_group" && (d.members?.length ?? 0) > 0) {
        setLoadError("");
      }
    } catch (e) {
      setMembers([]);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const selected = useMemo(() => {
    const v = value.trim();
    if (!v) return null;
    return members.find((m) => m.name === v) ?? null;
  }, [members, value]);

  useEffect(() => {
    if (multi) return;
    if (selected && value.trim()) {
      setEditing(false);
      setOpen(false);
    }
  }, [multi, selected, value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.open_id.toLowerCase().includes(q),
    );
  }, [members, value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [value, filtered.length]);

  const pick = (m: MealMember) => {
    onChange(m.name, m);
    onSelectMember?.(m);
    if (multi) {
      setOpen(false);
      setEditing(true);
      return;
    }
    setOpen(false);
    setEditing(false);
  };

  const startEdit = () => {
    onChange("", null);
    setEditing(true);
    setOpen(true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(filtered[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && !loading && filtered.length > 0 && editing;
  const showEmpty =
    open &&
    !loading &&
    !loadError &&
    filtered.length === 0 &&
    value.trim() &&
    editing &&
    members.length > 0;

  return (
    <div ref={wrapRef} className={className}>
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          borderColor: open ? "color-mix(in srgb, #6366f1 45%, var(--separator-subtle))" : "var(--separator-subtle)",
          boxShadow: open ? "0 4px 20px color-mix(in srgb, #6366f1 12%, transparent)" : undefined,
        }}
      >
        {!multi && selected && !editing ? (
          <div className="flex items-center gap-3 px-3 py-3 min-h-11">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white bg-indigo-600"
              aria-hidden
            >
              {memberInitial(selected.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{selected.name}</p>
              <p className="text-[11px] opacity-50">已从群成员中选择</p>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={startEdit}
              className="shrink-0 text-sm text-indigo-600 font-medium px-2 py-1 rounded-lg hover:bg-indigo-500/10 touch-manipulation"
            >
              更换
            </button>
          </div>
        ) : (
          <>
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-3 text-base opacity-40" aria-hidden>
                🔍
              </span>
              <input
                type="text"
                value={value}
                disabled={disabled}
                autoComplete="off"
                placeholder={loading ? "正在加载群成员…" : placeholder}
                className="w-full pl-9 pr-3 py-3 text-base sm:text-sm bg-transparent min-h-11 border-0 outline-none focus:ring-0"
                onFocus={() => setOpen(true)}
                onChange={(e) => {
                  onChange(e.target.value, null);
                  setOpen(true);
                  setEditing(true);
                }}
                onKeyDown={onKeyDown}
              />
            </div>

            {showList && (
              <ul
                className="border-t max-h-44 overflow-y-auto overscroll-contain divide-y"
                style={{
                  borderColor: "var(--separator-subtle)",
                }}
                role="listbox"
              >
                {filtered.map((m, idx) => (
                  <li key={m.open_id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={idx === activeIndex}
                      className={`w-full flex items-center gap-3 px-3 py-3 text-left text-sm touch-manipulation active:bg-indigo-500/15 ${
                        idx === activeIndex ? "bg-indigo-500/10" : "hover:bg-indigo-500/5"
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(m)}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-700">
                        {memberInitial(m.name)}
                      </span>
                      <span className="font-medium">{m.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {showEmpty && (
              <p
                className="border-t px-3 py-3 text-xs opacity-60 leading-relaxed"
                style={{ borderColor: "var(--separator-subtle)" }}
              >
                无匹配成员，请检查姓名；也可直接点「进入」用手动填写的姓名
              </p>
            )}
          </>
        )}
      </div>

      {loadError && (
        <p className="text-xs text-amber-600 mt-2 leading-relaxed">
          {loadError}
          <button
            type="button"
            className="ml-2 underline touch-manipulation"
            onClick={() => loadMembers()}
          >
            重试
          </button>
          <span className="block mt-1 opacity-80">
            也可在下方选好提醒群后点重试，或直接输入姓名点「进入」
          </span>
        </p>
      )}

      {!loadError && !loading && members.length === 0 && (
        <p className="text-xs text-amber-600 mt-2 leading-relaxed">
          暂未加载到群成员。请先在下方「群聊定时提醒」选择群并连接飞书，或手动输入姓名后进入。
          <button
            type="button"
            className="ml-2 underline touch-manipulation"
            onClick={() => loadMembers()}
          >
            重试
          </button>
        </p>
      )}

      {!loadError && !loading && members.length > 0 && (multi || editing || !selected) && (
        <p className="text-[11px] opacity-45 mt-1.5 px-0.5">
          共 {members.length} 人 · 输入可筛选 · 点选填入
        </p>
      )}
    </div>
  );
}
