"use client";

import {
  NODE_CATEGORIES,
  NODE_TYPE_REGISTRY,
  type NodeCategory,
  type NodeType,
  type NodeTypeInfo,
} from "@/types/workflow";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const COLLAPSED_STORAGE_KEY = "wf.palette.collapsedCats.v1";

/** 二级分组展示顺序（未列入的按拼音排在后面） */
const SUBGROUP_PRIORITY: string[] = [
  "时间与手动",
  "Webhook 与集成",
  "热点与资讯",
  "剧本与脚本",
  "文案与标题",
  "综合媒体",
  "通用推理",
  "热点与趋势",
  "审核与合规",
  "剪辑与后期",
  "规划与拆解",
  "长视频",
  "架构与设计",
  "媒体生成",
  "发布与分发",
  "知识与记忆",
  "集成与自动化",
  "内容安全",
  "字幕与混剪",
  "热点与检索",
  "数据与模板",
  "分支与合并",
  "并行",
  "迭代",
  "时机控制",
  "交付",
  "归档",
  "通知",
];

interface NodePaletteProps {
  onDragStart: (nodeType: NodeType) => void;
}

const CAT_ACCENT: Record<string, string> = {
  trigger: "#00c37f",
  agent: "#a78bfa",
  tool: "#60a5fa",
  control: "#fbbf24",
  output: "#9ca3af",
};

function loadCollapsedIds(): Set<string> {
  if (typeof window === "undefined") {
    return new Set<NodeCategory>(["tool", "control", "output"]);
  }
  try {
    const raw = sessionStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      return new Set(parsed);
    }
  } catch {
    /* ignore */
  }
  return new Set<NodeCategory>(["tool", "control", "output"]);
}

function subgroupRank(label: string): number {
  const i = SUBGROUP_PRIORITY.indexOf(label);
  return i === -1 ? 1000 + label.charCodeAt(0) : i;
}

function sortSubgroupEntries(a: string, b: string): number {
  return subgroupRank(a) - subgroupRank(b) || a.localeCompare(b, "zh-CN");
}

export function NodePalette({ onDragStart }: NodePaletteProps) {
  const [search, setSearch] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(loadCollapsedIds);

  const persistCollapsed = useCallback((next: Set<string>) => {
    try {
      sessionStorage.setItem(
        COLLAPSED_STORAGE_KEY,
        JSON.stringify([...next]),
      );
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCat = useCallback(
    (id: string) => {
      setCollapsedCats((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persistCollapsed(next);
        return next;
      });
    },
    [persistCollapsed],
  );

  const expandAllCats = useCallback(() => {
    const next = new Set<string>();
    setCollapsedCats(next);
    persistCollapsed(next);
  }, [persistCollapsed]);

  const collapseAllCats = useCallback(() => {
    const next = new Set(NODE_CATEGORIES.map((c) => c.id));
    setCollapsedCats(next);
    persistCollapsed(next);
  }, [persistCollapsed]);

  const q = search.trim().toLowerCase();

  const filteredByCat = useMemo(() => {
    const map = new Map<NodeCategory, NodeTypeInfo[]>();
    for (const cat of NODE_CATEGORIES) {
      const nodes = Object.values(NODE_TYPE_REGISTRY).filter(
        (n) =>
          n.category === cat.id &&
          (!q ||
            n.label.toLowerCase().includes(q) ||
            n.description.toLowerCase().includes(q) ||
            (n.paletteGroup?.toLowerCase().includes(q) ?? false)),
      );
      map.set(cat.id, nodes);
    }
    return map;
  }, [q]);

  // 搜索时自动展开含结果的分类
  useEffect(() => {
    if (!q) return;
    queueMicrotask(() => {
      setCollapsedCats((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const cat of NODE_CATEGORIES) {
          const list = filteredByCat.get(cat.id) ?? [];
          if (list.length > 0 && next.has(cat.id)) {
            next.delete(cat.id);
            changed = true;
          }
        }
        if (changed) persistCollapsed(next);
        return changed ? next : prev;
      });
    });
  }, [q, filteredByCat, persistCollapsed]);

  return (
    <aside className="w-[228px] bg-[var(--chrome-rail-bg)] border-r border-[var(--separator-subtle)] flex flex-col overflow-hidden shrink-0">
      <div className="px-3 pt-3 pb-2 border-b border-[var(--separator-subtle)]">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[10px] font-bold text-[var(--label-secondary)] uppercase tracking-[0.12em]">
            节点
          </p>
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={expandAllCats}
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md text-[var(--label-secondary)] hover:bg-[var(--separator-subtle)] hover:text-[var(--foreground)] transition-colors"
            >
              全展开
            </button>
            <button
              type="button"
              onClick={collapseAllCats}
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md text-[var(--label-secondary)] hover:bg-[var(--separator-subtle)] hover:text-[var(--foreground)] transition-colors"
            >
              全收起
            </button>
          </div>
        </div>
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--label-secondary)] pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索节点…"
            className="w-full bg-[var(--separator-subtle)] border border-[var(--separator-subtle)] rounded-lg pl-7 pr-3 py-1.5
                       text-[11px] outline-none focus:border-[var(--accent)]/50 focus:bg-[var(--separator)] transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-[var(--separator)]">
        {NODE_CATEGORIES.map((cat) => {
          const nodes = filteredByCat.get(cat.id) ?? [];
          if (nodes.length === 0) return null;
          const isCollapsed = collapsedCats.has(cat.id);
          const accent = CAT_ACCENT[cat.id] ?? "#9ca3af";

          const bySubgroup = new Map<string, NodeTypeInfo[]>();
          for (const n of nodes) {
            const g = n.paletteGroup ?? "其他";
            const arr = bySubgroup.get(g) ?? [];
            arr.push(n);
            bySubgroup.set(g, arr);
          }
          const subgroupKeys = [...bySubgroup.keys()].sort(sortSubgroupEntries);

          return (
            <div key={cat.id} className="mb-0.5">
              <button
                type="button"
                onClick={() => toggleCat(cat.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--separator-subtle)] transition-colors text-left"
              >
                <span
                  style={{ backgroundColor: accent }}
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                />
                <span
                  style={{ color: accent }}
                  className="text-[10px] font-bold uppercase tracking-[0.08em] flex-1 min-w-0 truncate"
                >
                  {cat.label}
                </span>
                <span className="text-[9px] tabular-nums text-[var(--label-secondary)] opacity-70 shrink-0">
                  {nodes.length}
                </span>
                {isCollapsed ? (
                  <ChevronRight
                    className="w-3.5 h-3.5 shrink-0 text-[var(--label-secondary)]"
                    strokeWidth={2.25}
                  />
                ) : (
                  <ChevronDown
                    className="w-3.5 h-3.5 shrink-0 text-[var(--label-secondary)]"
                    strokeWidth={2.25}
                  />
                )}
              </button>

              {!isCollapsed && (
                <div className="px-2 pb-1 space-y-2">
                  {subgroupKeys.map((subKey) => (
                    <div key={`${cat.id}:${subKey}`}>
                      <p className="text-[9px] font-semibold text-[var(--label-secondary)] opacity-70 px-1 mb-0.5 tracking-wide">
                        {subKey}
                      </p>
                      <div className="space-y-px">
                        {(bySubgroup.get(subKey) ?? []).map((info) => (
                          <PaletteItem
                            key={info.type}
                            info={info}
                            accent={accent}
                            onDragStart={onDragStart}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-3 py-2 border-t border-[var(--separator-subtle)]">
        <p className="text-[9px] text-[var(--label-secondary)] opacity-50 text-center tracking-wide leading-relaxed">
          拖拽到画布 · 分类可收起 · 搜索自动展开匹配分组
        </p>
      </div>
    </aside>
  );
}

function PaletteItem({
  info,
  accent,
  onDragStart,
}: {
  info: NodeTypeInfo;
  accent: string;
  onDragStart: (t: NodeType) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/workflow-node-type", info.type);
        e.dataTransfer.effectAllowed = "copy";
        onDragStart(info.type);
      }}
      className="flex items-center gap-2 px-1.5 py-[6px] rounded-lg cursor-grab active:cursor-grabbing
                 hover:bg-[var(--separator-subtle)] border border-transparent hover:border-[var(--separator-subtle)]
                 transition-all group select-none"
    >
      <div
        style={{ backgroundColor: `${accent}18`, borderColor: `${accent}33` }}
        className="w-[26px] h-[26px] flex items-center justify-center rounded-md text-[12px] shrink-0 border"
      >
        {info.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-medium text-[var(--foreground)] truncate leading-snug">
          {info.label}
        </p>
        <p className="text-[9.5px] text-[var(--label-secondary)] line-clamp-2 leading-snug">
          {info.description}
        </p>
      </div>
      <svg
        className="w-3 h-3 text-[var(--foreground)] opacity-15 group-hover:opacity-40 transition-all shrink-0"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <circle cx="8" cy="6" r="1.5" />
        <circle cx="16" cy="6" r="1.5" />
        <circle cx="8" cy="12" r="1.5" />
        <circle cx="16" cy="12" r="1.5" />
        <circle cx="8" cy="18" r="1.5" />
        <circle cx="16" cy="18" r="1.5" />
      </svg>
    </div>
  );
}
