"use client";

import {
  Clock3,
  Code2,
  Database,
  GitBranch,
  Image as ImageIcon,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Search,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { navigateToMemGraph } from "@/lib/contextNavigation";

// ─── types ────────────────────────────────────────────────────────────────────

type MemType = "fact" | "procedure" | "preference" | "media" | "other";
type SortKey = "recent" | "confidence" | "views";
type ViewMode = "memories" | "hits";
type KnowledgeLayer =
  | "all"
  | "user_profile"
  | "agent_memory"
  | "episodic_session"
  | "procedural_skill"
  | "domain_knowledge_rag"
  | "feedback_signal"
  | "tool_telemetry";

interface MemoryItem {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

interface SignalItem {
  target_type: string;
  target_id: string;
  signal: string;
}

interface EnrichedItem extends MemoryItem {
  memType: MemType;
  knowledgeLayer: KnowledgeLayer;
  category: string;
  confidence: number;
  views: number;
  upvotes: number;
  downvotes: number;
  timestamp: string;
  inferred: boolean;
}

interface MemoryHitRecord {
  id: string;
  created_at: string;
  memory_id: string;
  query: string;
  trace_id: string;
  session_id: string;
  source: string;
  rank: number;
  outcome: string;
  usage_metadata: Record<string, unknown>;
  memory: MemoryItem & {
    missing?: boolean;
    missing_reason?: string;
    current_store_joined?: boolean;
    snapshot_available?: boolean;
    media_refs?: string[];
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function deriveType(item: MemoryItem): MemType {
  const layer = String(item.metadata?.knowledge_layer ?? "").toLowerCase();
  if (layer === "user_profile") return "preference";
  if (layer === "procedural_skill") return "procedure";
  if (layer === "domain_knowledge_rag") return "other";
  const t = String(item.metadata?.type ?? "").toLowerCase();
  const c = item.content.toLowerCase();
  if (t === "image" || t === "video" || t === "audio") return "media";
  if (c.includes("prefer") || c.includes("always") || c.includes("style"))
    return "preference";
  if (c.includes("step") || c.includes("procedure") || c.includes("workflow"))
    return "procedure";
  return "fact";
}

function deriveCategory(item: MemoryItem): string {
  const layer = String(item.metadata?.knowledge_layer ?? "").toLowerCase();
  if (layer === "user_profile") return "profile";
  if (layer === "domain_knowledge_rag") return "rag";
  if (layer === "feedback_signal") return "feedback";
  if (layer === "tool_telemetry") return "telemetry";
  const t = String(item.metadata?.type ?? "").toLowerCase();
  if (t === "image") return "image";
  if (t === "video") return "video";
  if (t === "audio") return "audio";
  const c = item.content.toLowerCase();
  if (c.includes("publish") || c.includes("platform")) return "publishing";
  if (c.includes("script") || c.includes("copy")) return "content";
  return "general";
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 50;
  if (value <= 1) return Math.round(value * 100);
  return Math.max(0, Math.min(100, Math.round(value)));
}

function enrich(item: MemoryItem, signals: SignalItem[] = []): EnrichedItem {
  const upvotes = signals.filter((s) =>
    ["upvote", "thumbs_up", "useful"].includes(s.signal),
  ).length;
  const downvotes = signals.filter((s) =>
    ["downvote", "thumbs_down", "rejected"].includes(s.signal),
  ).length;
  return {
    ...item,
    memType: deriveType(item),
    knowledgeLayer: String(
      item.metadata?.knowledge_layer ?? "agent_memory",
    ) as KnowledgeLayer,
    category: deriveCategory(item),
    confidence: normalizeConfidence(item.metadata?.confidence),
    views: Number(item.metadata?.views ?? item.metadata?.use_count ?? 0),
    upvotes,
    downvotes,
    timestamp: String(item.metadata?.timestamp ?? ""),
    inferred: Boolean(item.metadata?.inferred ?? false),
  };
}

function groupSignals(signals: SignalItem[]): Record<string, SignalItem[]> {
  return signals.reduce<Record<string, SignalItem[]>>((acc, signal) => {
    if (signal.target_type !== "memory") return acc;
    acc[signal.target_id] = [...(acc[signal.target_id] || []), signal];
    return acc;
  }, {});
}

function mediaRefs(item: MemoryItem): string[] {
  const refs: string[] = [];
  for (const key of [
    "media_url",
    "media_urls",
    "image_url",
    "image_urls",
    "thumbnail_url",
    "artifact_ref",
  ]) {
    const value = item.metadata?.[key];
    if (typeof value === "string" && value.trim()) refs.push(value.trim());
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim()) refs.push(entry.trim());
      }
    }
  }
  return Array.from(new Set(refs));
}

function isImageRef(ref: string): boolean {
  return (
    /\.(png|jpe?g|webp|gif)(\?|$)/i.test(ref) || ref.startsWith("data:image/")
  );
}

const TYPE_BADGE_CLS: Record<MemType, string> = {
  fact: "border-[color:var(--separator-subtle)] border-l-[3px] border-l-sky-500 bg-[var(--nav-active-fill)] text-[color:var(--foreground)]",
  procedure:
    "border-[color:var(--separator-subtle)] border-l-[3px] border-l-violet-500 bg-[var(--nav-active-fill)] text-[color:var(--foreground)]",
  preference:
    "border-[color:var(--separator-subtle)] border-l-[3px] border-l-emerald-500 bg-[var(--nav-active-fill)] text-[color:var(--foreground)]",
  media:
    "border-[color:var(--separator-subtle)] border-l-[3px] border-l-amber-500 bg-[var(--nav-active-fill)] text-[color:var(--foreground)]",
  other:
    "border-[color:var(--separator-subtle)] border-l-[3px] border-l-[color:var(--label-secondary)] bg-[var(--nav-active-fill)] text-[color:var(--label-secondary)]",
};

// ─── sub-components ───────────────────────────────────────────────────────────

function Dropdown({
  value,
  options,
  onChange,
  className = "",
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] py-2 pl-3 pr-8 text-[13px] text-[color:var(--foreground)] shadow-sm focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_28%,transparent)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[color:var(--label-secondary)]">
        ▾
      </span>
    </div>
  );
}

function ConfidenceBar({ pct }: { pct: number }) {
  const color =
    pct >= 80 ? "bg-emerald-500" : pct >= 55 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--nav-active-fill)] ring-1 ring-[color:var(--separator-subtle)]">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-medium text-[color:var(--label-secondary)]">
        {pct}%
      </span>
    </div>
  );
}

function TypeBadge({ type }: { type: MemType }) {
  const { t } = useTranslation();
  const labelKey: Record<MemType, string> = {
    fact: "settings.context.memoryPanel.typeFact",
    procedure: "settings.context.memoryPanel.typeProcedure",
    preference: "settings.context.memoryPanel.typePreference",
    media: "settings.context.memoryPanel.typeMedia",
    other: "settings.context.memoryPanel.typeAll",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TYPE_BADGE_CLS[type]}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60" />
      {t(labelKey[type])}
    </span>
  );
}

function CodeEntityChips({ memoryId }: { memoryId: string }) {
  const { t } = useTranslation();
  const [entities, setEntities] = useState<{ kind: string; label: string }[]>([]);

  useEffect(() => {
    fetch(`/api/context/memory/${encodeURIComponent(memoryId)}/code-entities`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setEntities((data?.code_entities ?? []).slice(0, 6)))
      .catch(() => setEntities([]));
  }, [memoryId]);

  if (!entities.length) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
        <Code2 className="h-3 w-3" />
        {t("settings.context.codeEntities")}
      </span>
      {entities.map((ent, i) => (
        <span
          key={`${ent.label}-${i}`}
          className="rounded-md border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] px-2 py-0.5 font-mono text-[10px] text-[color:var(--foreground)]"
        >
          {ent.kind === "file" ? "📄" : "ƒ"} {ent.label}
        </span>
      ))}
    </div>
  );
}

function MemCard({
  item,
  highlighted,
  cardRef,
  onDelete,
  onUpvote,
  onDownvote,
}: {
  item: EnrichedItem;
  highlighted?: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
  onDelete: (id: string) => void;
  onUpvote: (id: string) => void;
  onDownvote: (id: string) => void;
}) {
  const { t } = useTranslation();
  const src = String(item.metadata?.type ?? "source");
  const layer = String(item.knowledgeLayer).replaceAll("_", " ");
  const refs = mediaRefs(item);
  const firstImage = refs.find(isImageRef);

  return (
    <div
      ref={cardRef}
      className={`group rounded-xl border bg-[var(--chrome-rail-bg)] p-4 transition-colors hover:bg-[var(--nav-active-fill)] ${
        highlighted
          ? "border-[color:var(--accent)] ring-2 ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
          : "border-[color:var(--separator-subtle)]"
      }`}
    >
      {/* header row */}
      <div className="flex items-center gap-2">
        <TypeBadge type={item.memType} />
        <span className="rounded-md border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] px-1.5 py-0.5 text-[11px] text-[color:var(--label-secondary)]">
          {src}
        </span>
        <span className="rounded-md border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] px-1.5 py-0.5 text-[11px] text-[color:var(--label-secondary)]">
          {layer}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ConfidenceBar pct={item.confidence} />
          <button
            type="button"
            title={t("settings.context.memoryPanel.viewInGraph")}
            onClick={() => navigateToMemGraph(item.id)}
            className="rounded p-1 text-[color:var(--label-secondary)] transition-colors hover:text-[color:var(--accent)]"
          >
            <GitBranch className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            title={t("settings.context.memoryPanel.upvote")}
            onClick={() => onUpvote(item.id)}
            className="rounded p-1 text-[color:var(--label-secondary)] transition-colors hover:text-emerald-400"
          >
            <ThumbsUp className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            title={t("settings.context.memoryPanel.downvote")}
            onClick={() => onDownvote(item.id)}
            className="rounded p-1 text-[color:var(--label-secondary)] transition-colors hover:text-rose-400"
          >
            <ThumbsDown className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            title={t("settings.context.memoryPanel.delete")}
            onClick={() => onDelete(item.id)}
            className="rounded p-1 text-[color:var(--label-secondary)] transition-colors hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* content */}
      <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-[color:var(--foreground)]">
        {item.content}
      </p>

      <CodeEntityChips memoryId={item.id} />

      {(firstImage || refs.length > 0) && (
        <div className="mt-3 flex gap-3 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] p-2">
          {firstImage ? (
            <div
              className="h-14 w-20 flex-none rounded-md bg-cover bg-center ring-1 ring-[color:var(--separator-subtle)]"
              style={{ backgroundImage: `url(${firstImage})` }}
            />
          ) : (
            <div className="grid h-14 w-20 flex-none place-items-center rounded-md bg-[var(--chrome-rail-bg)] ring-1 ring-[color:var(--separator-subtle)]">
              <ImageIcon
                className="h-4 w-4 text-[color:var(--label-secondary)]"
                strokeWidth={2}
              />
            </div>
          )}
          <div className="min-w-0 py-0.5">
            <div className="text-[11px] font-medium text-[color:var(--foreground)]">
              {t("settings.context.memoryPanel.mediaRef")}
            </div>
            <div className="mt-1 truncate text-[11px] text-[color:var(--label-secondary)]">
              {refs[0]}
            </div>
          </div>
        </div>
      )}

      {/* footer */}
      <div className="mt-2 flex items-center gap-3 text-[11px] text-[color:var(--label-secondary)]">
        <span title={item.id} className="max-w-[9rem] truncate">
          id {item.id.slice(0, 8)}
        </span>
        <span title="Views">👁 {item.views}</span>
        <span title="Upvotes" className="text-emerald-400/90">
          ✓ {item.upvotes}
        </span>
        <span title="Downvotes" className="text-rose-400/90">
          ✕ {item.downvotes}
        </span>
        {item.timestamp && (
          <span className="ml-auto">{item.timestamp.slice(0, 10)}</span>
        )}
      </div>
    </div>
  );
}

function HitCard({ record }: { record: MemoryHitRecord }) {
  const memory = enrich(
    record.memory || { id: record.memory_id, content: "", metadata: {} },
  );
  const refs = record.memory?.media_refs?.length
    ? record.memory.media_refs
    : mediaRefs(record.memory);
  const firstImage = refs.find(isImageRef);
  const traceLabel = record.trace_id ? record.trace_id.slice(0, 8) : "no trace";
  const memoryMissing = Boolean(record.memory?.missing);
  const snapshotAvailable = Boolean(record.memory?.snapshot_available);
  const contentStatus = memoryMissing
    ? snapshotAvailable
      ? "Snapshot from hit time"
      : "Current store missing"
    : "Current memory";
  const missingCopy =
    "This hit references a memory ID that is not present in the current memory store. It may be from an older test run, storage switch, cleanup, or deletion.";

  return (
    <div className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-4 transition-colors hover:bg-[var(--nav-active-fill)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--foreground)]">
          <ListChecks className="h-3 w-3" strokeWidth={2} />
          rank {record.rank || 0}
        </span>
        <TypeBadge type={memory.memType} />
        <span className="rounded-md border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] px-1.5 py-0.5 text-[11px] text-[color:var(--label-secondary)]">
          {String(memory.knowledgeLayer).replaceAll("_", " ")}
        </span>
        {memoryMissing && (
          <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-500">
            {contentStatus}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[color:var(--label-secondary)]">
          <Clock3 className="h-3 w-3" strokeWidth={2} />
          {record.created_at?.slice(0, 19).replace("T", " ") || "recent"}
        </span>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="min-w-0">
          <div className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] p-3">
            <div className="mb-1 text-[11px] font-medium uppercase text-[color:var(--label-secondary)]">
              Query that recalled it
            </div>
            <p className="line-clamp-2 text-[13px] leading-relaxed text-[color:var(--foreground)]">
              {record.query || "No query recorded"}
            </p>
          </div>
          <div className="mt-2 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] p-3">
            <div className="mb-1 text-[11px] font-medium uppercase text-[color:var(--label-secondary)]">
              Memory content
            </div>
            <p className="line-clamp-3 text-[13px] leading-relaxed text-[color:var(--foreground)]">
              {memory.content ||
                (memoryMissing ? missingCopy : "Empty memory body")}
            </p>
            {memoryMissing && memory.content && (
              <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--label-secondary)]">
                {missingCopy}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] p-2">
          {firstImage ? (
            <div
              className="h-28 rounded-md bg-cover bg-center ring-1 ring-[color:var(--separator-subtle)]"
              style={{ backgroundImage: `url(${firstImage})` }}
            />
          ) : (
            <div className="grid h-28 place-items-center rounded-md bg-[var(--chrome-rail-bg)] ring-1 ring-[color:var(--separator-subtle)]">
              <Database
                className="h-5 w-5 text-[color:var(--label-secondary)]"
                strokeWidth={2}
              />
            </div>
          )}
          <div className="mt-2 space-y-1 text-[11px] text-[color:var(--label-secondary)]">
            <div className="truncate" title={record.memory_id}>
              memory {record.memory_id.slice(0, 10)}
            </div>
            <div className="truncate" title={record.trace_id}>
              trace {traceLabel}
            </div>
            {refs[0] && (
              <div className="truncate" title={refs[0]}>
                media {refs[0]}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── main panel ───────────────────────────────────────────────────────────────

interface MemoryPanelProps {
  highlightMemoryId?: string;
  onHighlightConsumed?: () => void;
}

export default function MemoryPanel({
  highlightMemoryId,
  onHighlightConsumed,
}: MemoryPanelProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [hitRecords, setHitRecords] = useState<MemoryHitRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("memories");
  const [typeFilter, setTypeFilter] = useState("all");
  const [layerFilter, setLayerFilter] = useState<KnowledgeLayer>("all");
  const [catFilter, setCatFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [query, setQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [inferred, setInferred] = useState(true);
  const [visibleCount, setVisibleCount] = useState(50);
  const searchRef = useRef<HTMLInputElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const typeOptions = useMemo(
    () => [
      { value: "all", label: t("settings.context.memoryPanel.typeAll") },
      { value: "fact", label: t("settings.context.memoryPanel.typeFact") },
      { value: "procedure", label: t("settings.context.memoryPanel.typeProcedure") },
      { value: "preference", label: t("settings.context.memoryPanel.typePreference") },
      { value: "media", label: t("settings.context.memoryPanel.typeMedia") },
    ],
    [t],
  );

  const catOptions = useMemo(
    () => [
      { value: "all", label: t("settings.context.memoryPanel.catAll") },
      { value: "profile", label: "Profile" },
      { value: "rag", label: "RAG" },
      { value: "feedback", label: "Feedback" },
      { value: "telemetry", label: "Telemetry" },
      { value: "image", label: "Image" },
      { value: "video", label: "Video" },
      { value: "audio", label: "Audio" },
      { value: "content", label: "Content" },
      { value: "publishing", label: "Publishing" },
      { value: "general", label: "General" },
    ],
    [t],
  );

  const sortOptions = useMemo(
    () => [
      { value: "recent", label: t("settings.context.memoryPanel.sortRecent") },
      { value: "confidence", label: t("settings.context.memoryPanel.sortConfidence") },
      { value: "views", label: t("settings.context.memoryPanel.sortViews") },
    ],
    [t],
  );

  const layerOptions = useMemo(
    () => [
      { value: "all", label: t("settings.context.memoryPanel.layerAll") },
      { value: "user_profile", label: t("settings.context.memoryPanel.layerUserProfile") },
      { value: "agent_memory", label: t("settings.context.memoryPanel.layerAgentMemory") },
      { value: "episodic_session", label: t("settings.context.memoryPanel.layerEpisodic") },
      { value: "procedural_skill", label: t("settings.context.memoryPanel.layerProcedural") },
      { value: "domain_knowledge_rag", label: t("settings.context.memoryPanel.layerRag") },
      { value: "feedback_signal", label: t("settings.context.memoryPanel.layerFeedback") },
      { value: "tool_telemetry", label: t("settings.context.memoryPanel.layerTelemetry") },
    ],
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setSearchActive(false);
    setVisibleCount(50);
    try {
      const res = await fetch("/api/context/memory/dashboard", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json();
      const raw: MemoryItem[] = data.memories ?? [];
      const signalsById = groupSignals(data.signals ?? []);
      setItems(raw.map((item) => enrich(item, signalsById[item.id] ?? [])));
      setHitRecords(data.hits ?? []);
    } catch {
      setItems([]);
      setHitRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      load();
      return;
    }
    setLoading(true);
    setSearchActive(true);
    setVisibleCount(50);
    try {
      const res = await fetch("/api/context/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, k: 20 }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json();
      const raw: MemoryItem[] = (data.results ?? []).map(
        (r: {
          id?: string;
          content: string;
          metadata: Record<string, unknown>;
        }) => ({
          id:
            r.id ||
            r.content.slice(0, 8) + Math.random().toString(36).slice(2, 7),
          content: r.content,
          metadata: r.metadata ?? {},
        }),
      );
      const signalRes = await fetch(
        "/api/evolution/signals?target_type=memory&limit=1000",
        { cache: "no-store" },
      );
      const signalData = await signalRes.json().catch(() => ({ signals: [] }));
      const signalsById = groupSignals(signalData.signals ?? []);
      setItems(raw.map((item) => enrich(item, signalsById[item.id] ?? [])));
    } catch {
      /* keep current */
    } finally {
      setLoading(false);
    }
  }, [query, load]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch(`/api/context/memory/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      /* ignore */
    }
  }, []);

  const saveSignal = useCallback(
    async (id: string, signal: "upvote" | "downvote") => {
      await fetch("/api/evolution/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: "memory",
          target_id: id,
          signal,
          source: "memory_panel",
        }),
      });
    },
    [],
  );

  const handleUpvote = useCallback(
    (id: string) => {
      saveSignal(id, "upvote").catch(() => undefined);
      setItems((prev) =>
        prev.map((x) => (x.id === id ? { ...x, upvotes: x.upvotes + 1 } : x)),
      );
    },
    [saveSignal],
  );

  const handleDownvote = useCallback(
    (id: string) => {
      saveSignal(id, "downvote").catch(() => undefined);
      setItems((prev) =>
        prev.map((x) =>
          x.id === id ? { ...x, downvotes: x.downvotes + 1 } : x,
        ),
      );
    },
    [saveSignal],
  );

  const handleReset = useCallback(() => {
    setQuery("");
    setTypeFilter("all");
    setLayerFilter("all");
    setCatFilter("all");
    setSort("recent");
    setSearchActive(false);
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let list = items;
    if (typeFilter !== "all")
      list = list.filter((x) => x.memType === typeFilter);
    if (layerFilter !== "all")
      list = list.filter((x) => x.knowledgeLayer === layerFilter);
    if (catFilter !== "all")
      list = list.filter((x) => x.category === catFilter);
    if (!inferred) list = list.filter((x) => !x.inferred);
    list = [...list].sort((a, b) => {
      if (sort === "confidence") return b.confidence - a.confidence;
      if (sort === "views") return b.views - a.views;
      return (b.timestamp ?? "").localeCompare(a.timestamp ?? "");
    });
    return list;
  }, [items, typeFilter, layerFilter, catFilter, sort, inferred]);

  const visibleItems = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(50);
  }, [typeFilter, layerFilter, catFilter, sort, inferred, viewMode]);

  useEffect(() => {
    if (!highlightMemoryId || loading) return;
    const el = cardRefs.current[highlightMemoryId];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = setTimeout(() => onHighlightConsumed?.(), 900);
    return () => clearTimeout(timer);
  }, [highlightMemoryId, loading, filtered.length, items.length, onHighlightConsumed]);

  const counts = useMemo(
    () => ({
      total: items.length,
      proc: items.filter((x) => x.memType === "procedure").length,
      facts: items.filter((x) => x.memType === "fact").length,
      hits: hitRecords.length,
    }),
    [items, hitRecords.length],
  );

  return (
    <div className="overflow-hidden rounded-2xl card-surface">
      {/* top bar */}
      <div className="flex items-center border-b border-[color:var(--separator-subtle)] px-4 py-2.5">
        <button
          type="button"
          onClick={load}
          disabled={loading}
          title={t("settings.context.memoryPanel.refresh")}
          className="rounded-lg p-1.5 text-[color:var(--label-secondary)] transition-colors hover:bg-[var(--nav-active-fill)] hover:text-[color:var(--foreground)] disabled:opacity-40"
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            strokeWidth={2}
          />
        </button>
        <div className="ml-3 min-w-0 text-[12.5px] text-[color:var(--label-secondary)]">
          {t("settings.context.memoryPanel.subtitle")}
        </div>
        <div className="ml-auto inline-flex rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-0.5 shadow-sm">
          {(["memories", "hits"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                viewMode === mode
                  ? "bg-[var(--nav-active-fill)] text-[color:var(--foreground)]"
                  : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
              }`}
            >
              {mode === "memories"
                ? t("settings.context.memoryPanel.memories")
                : t("settings.context.memoryPanel.hits", { count: counts.hits })}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "memories" && (
        <div className="flex flex-wrap gap-2.5 border-b border-[color:var(--separator-subtle)] px-4 py-3">
          <Dropdown
            value={typeFilter}
            options={typeOptions}
            onChange={setTypeFilter}
            className="min-w-[140px] flex-1"
          />
          <Dropdown
            value={layerFilter}
            options={layerOptions}
            onChange={(value) => setLayerFilter(value as KnowledgeLayer)}
            className="min-w-[190px] flex-1"
          />
          <Dropdown
            value={catFilter}
            options={catOptions}
            onChange={setCatFilter}
            className="min-w-[160px] flex-1"
          />
          <Dropdown
            value={sort}
            options={sortOptions}
            onChange={(v) => setSort(v as SortKey)}
            className="min-w-[160px] flex-1"
          />
        </div>
      )}

      {viewMode === "memories" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--separator-subtle)] px-4 py-3">
          <div className="relative min-w-[min(100%,16rem)] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--label-secondary)]"
              strokeWidth={2}
            />
            <input
              ref={searchRef}
              type="text"
              placeholder={t("settings.context.memoryPanel.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="w-full rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] py-2 pl-9 pr-3 text-[13px] shadow-sm focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_28%,transparent)]"
            />
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={loading}
            className="rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3.5 py-2 text-[13px] font-medium text-[color:var(--foreground)] shadow-sm transition-colors hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
          >
            {t("settings.context.memoryPanel.search")}
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-[color:var(--label-secondary)] select-none">
            <input
              type="checkbox"
              checked={inferred}
              onChange={(e) => setInferred(e.target.checked)}
              className="accent-[color:var(--accent)]"
            />
            {t("settings.context.memoryPanel.inferred")}
          </label>
        </div>
      )}

      {/* stats bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--separator-subtle)] px-4 py-2">
        <span className="text-[12.5px] text-[color:var(--label-secondary)]">
          {t("settings.context.memoryPanel.total", { count: counts.total })}
        </span>
        <span className="rounded-full bg-[var(--nav-active-fill)] px-2 py-0.5 text-[11.5px] font-semibold text-[color:var(--foreground)] ring-1 ring-sky-500/45">
          {t("settings.context.memoryPanel.proc", { count: counts.proc })}
        </span>
        <span className="rounded-full bg-[var(--nav-active-fill)] px-2 py-0.5 text-[11.5px] font-semibold text-[color:var(--foreground)] ring-1 ring-violet-500/45">
          {t("settings.context.memoryPanel.facts", { count: counts.facts })}
        </span>
        <span className="text-[12px] text-[color:var(--label-secondary)]">
          {searchActive
            ? t("settings.context.memoryPanel.searchResults")
            : viewMode === "memories"
              ? t("settings.context.memoryPanel.showing", {
                  shown: visibleItems.length,
                  total: filtered.length,
                })
              : t("settings.context.memoryPanel.showingHits", {
                  count: hitRecords.length,
                })}
        </span>
        <button
          type="button"
          onClick={handleReset}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-1.5 text-[12.5px] text-[color:var(--foreground)] shadow-sm transition-colors hover:bg-[var(--nav-active-fill)]"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={2} />
          {t("settings.context.memoryPanel.reset")}
        </button>
      </div>

      {/* list */}
      <div className="space-y-3 p-4">
        {loading && (
          <div className="flex items-center justify-center py-12 text-[13px] text-[color:var(--label-secondary)]">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" strokeWidth={2} />
            {t("settings.context.memoryPanel.loading")}
          </div>
        )}

        {!loading && viewMode === "memories" && filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] py-10 text-center">
            <p className="text-[13px] text-[color:var(--label-secondary)]">
              {searchActive
                ? t("settings.context.memoryPanel.emptySearch")
                : t("settings.context.memoryPanel.emptyDefault")}
            </p>
          </div>
        )}

        {!loading && viewMode === "hits" && hitRecords.length === 0 && (
          <div className="rounded-xl border border-dashed border-[color:var(--separator-subtle)] bg-[var(--nav-active-fill)] py-10 text-center">
            <p className="text-[13px] text-[color:var(--label-secondary)]">
              {t("settings.context.memoryPanel.emptyHits")}
            </p>
          </div>
        )}

        {!loading &&
          viewMode === "memories" &&
          visibleItems.map((item) => (
            <MemCard
              key={item.id}
              item={item}
              highlighted={highlightMemoryId === item.id}
              cardRef={(el) => {
                cardRefs.current[item.id] = el;
              }}
              onDelete={handleDelete}
              onUpvote={handleUpvote}
              onDownvote={handleDownvote}
            />
          ))}

        {!loading &&
          viewMode === "memories" &&
          filtered.length > visibleCount && (
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + 50)}
              className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] py-2.5 text-[13px] font-medium text-[color:var(--foreground)] transition-colors hover:bg-[var(--nav-active-fill)]"
            >
              {t("settings.context.memoryPanel.loadMore", {
                remaining: filtered.length - visibleCount,
              })}
            </button>
          )}

        {!loading &&
          viewMode === "hits" &&
          hitRecords.map((record) => (
            <HitCard key={record.id} record={record} />
          ))}
      </div>
    </div>
  );
}
