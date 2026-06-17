"use client";

import { usePrefs } from "@/contexts/PrefsContext";
import { useTranslation } from "@/hooks/useTranslation";
import {
  formatKnowledgeScopeLabel,
  type KnowledgeScopeCategory,
  type KnowledgeScopeDoc,
} from "@/lib/knowledge-scope";
import { isFaqDocument } from "@/lib/knowledge-faq";
import {
  Bird,
  BookOpen,
  BookOpenCheck,
  BookMarked,
  BrainCircuit,
  ChevronDown,
  Globe2,
  GlobeLock,
  Library,
  Slash,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

function IconDock({
  children,
  accent,
}: {
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className={`flex size-[2.25rem] shrink-0 items-center justify-center rounded-[10px] border bg-[var(--card-bg)] ${
        accent
          ? "border-[color:color-mix(in_srgb,var(--accent)_32%,var(--separator-subtle))]"
          : "border-[color:var(--separator-subtle)]"
      }`}
    >
      {children}
    </span>
  );
}

function Choice({
  selected,
  onClick,
  title,
  description,
  icon,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
        selected
          ? "bg-[color:color-mix(in_srgb,var(--accent)_14%,var(--chrome-rail-bg))]"
          : "hover:bg-[var(--nav-active-fill)]"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-[color:var(--foreground)]">
          {title}
        </span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-[color:var(--label-secondary)]">
          {description}
        </span>
      </span>
    </button>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--label-secondary)]">
        {heading}
      </h4>
      <div className="card-surface rounded-2xl p-1.5">{children}</div>
    </div>
  );
}

function KnowledgeScopePicker({
  scope,
  documents,
  categories,
  loading,
  onScopeChange,
}: {
  scope: string;
  documents: KnowledgeScopeDoc[];
  categories: KnowledgeScopeCategory[];
  loading: boolean;
  onScopeChange: (scope: string) => void;
}) {
  const { t } = useTranslation();
  const categoriesWithDocs = categories.filter(
    (c) => (c.document_count ?? 0) > 0,
  );
  const docsByCategory = (catId: string) =>
    documents.filter((d) => (d.category || "uncategorized") === catId);

  if (loading) {
    return (
      <p className="px-3 py-2 text-[12px] text-[color:var(--label-secondary)]">
        {t("chat.prefKnowledgeScopeLoading")}
      </p>
    );
  }

  if (documents.length === 0) {
    return (
      <p className="px-3 py-2 text-[12px] text-[color:var(--label-secondary)]">
        {t("chat.prefKnowledgeScopeEmpty")}
      </p>
    );
  }

  return (
    <div className="mx-1.5 mb-1.5 mt-0.5 space-y-2 rounded-xl border border-[color:var(--separator-subtle)] bg-[color:color-mix(in_srgb,var(--chrome-rail-bg)_70%,transparent)] p-2">
      <p className="px-1 text-[11px] font-medium text-[color:var(--label-secondary)]">
        {t("chat.prefKnowledgeScopeHint")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {documents.map((doc) => {
          const token = `doc:${doc.id}`;
          const active = scope === token;
          const faq = isFaqDocument(doc);
          return (
            <button
              key={doc.id}
              type="button"
              title={doc.filename}
              onClick={() => onScopeChange(token)}
              className={`max-w-full truncate rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                active
                  ? "border-[color:color-mix(in_srgb,var(--accent)_45%,var(--separator-subtle))] bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--card-bg))] font-medium text-[color:var(--foreground)]"
                  : "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] text-[color:var(--label-secondary)] hover:border-[color:color-mix(in_srgb,var(--accent)_25%,var(--separator-subtle))]"
              }`}
            >
              {faq ? "❓ " : "📄 "}
              {doc.description?.trim() || doc.filename}
              {faq && doc.faq_count != null ? ` (${doc.faq_count})` : ""}
            </button>
          );
        })}
      </div>
      {categoriesWithDocs.length > 0 && (
        <details className="group px-0.5">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-[color:var(--label-secondary)] marker:content-none [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            {t("chat.prefKnowledgeScopeByCategory")}
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {categoriesWithDocs.map((cat) => {
              const token = `cat:${cat.id}`;
              const active = scope === token;
              const count =
                cat.document_count ?? docsByCategory(cat.id).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onScopeChange(token)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                    active
                      ? "border-[color:color-mix(in_srgb,var(--accent)_45%,var(--separator-subtle))] bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--card-bg))] font-medium text-[color:var(--foreground)]"
                      : "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] text-[color:var(--label-secondary)] hover:border-[color:color-mix(in_srgb,var(--accent)_25%,var(--separator-subtle))]"
                  }`}
                >
                  {cat.icon} {cat.name} ({count})
                </button>
              );
            })}
          </div>
        </details>
      )}
      <p className="px-1 text-[10px] text-[color:var(--label-secondary)]">
        {t("chat.prefKnowledgeScopeCurrent")}:{" "}
        <span className="font-medium text-[color:var(--foreground)]">
          {formatKnowledgeScopeLabel(
            scope,
            documents,
            categories,
            t("chat.prefKnowledgeScopeAll"),
          )}
        </span>
      </p>
    </div>
  );
}

export function ChatConversationPrefsCards() {
  const { t } = useTranslation();
  const { prefs, update } = usePrefs();
  const [documents, setDocuments] = useState<KnowledgeScopeDoc[]>([]);
  const [categories, setCategories] = useState<KnowledgeScopeCategory[]>([]);
  const [kbLoading, setKbLoading] = useState(false);

  const loadKnowledgeIndex = useCallback(async () => {
    setKbLoading(true);
    try {
      const [docRes, catRes] = await Promise.all([
        fetch("/api/knowledge/documents"),
        fetch("/api/knowledge/categories"),
      ]);
      const docData = docRes.ok ? await docRes.json() : null;
      const catData = catRes.ok ? await catRes.json() : null;
      const docs = (docData?.documents ?? docData ?? []) as KnowledgeScopeDoc[];
      const cats = (catData?.categories ?? catData ?? []) as KnowledgeScopeCategory[];
      setDocuments(Array.isArray(docs) ? docs : []);
      setCategories(Array.isArray(cats) ? cats : []);
    } catch {
      setDocuments([]);
      setCategories([]);
    } finally {
      setKbLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKnowledgeIndex();
  }, [loadKnowledgeIndex]);

  const pickDefaultScope = useCallback(() => {
    if (documents.length === 0) return "all";
    return `doc:${documents[0].id}`;
  }, [documents]);

  const enableScoped = () => {
    update("chatKnowledgeMode", "scoped");
    const current = prefs.chatKnowledgeScope;
    if (
      !current ||
      current === "all" ||
      (current.startsWith("doc:") &&
        !documents.some((d) => d.id === current.slice(4))) ||
      (current.startsWith("cat:") &&
        !categories.some((c) => c.id === current.slice(4)))
    ) {
      update("chatKnowledgeScope", pickDefaultScope());
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section heading={t("chat.prefSectionOnline")}>
        <Choice
          selected={prefs.chatOnlineSearchMode === "smart"}
          onClick={() => update("chatOnlineSearchMode", "smart")}
          title={t("chat.prefOnlineSmartTitle")}
          description={t("chat.prefOnlineSmartDesc")}
          icon={
            <IconDock accent>
              <Globe2
                className="h-[1.125rem] w-[1.125rem] text-sky-600"
                strokeWidth={2}
                aria-hidden
              />
            </IconDock>
          }
        />
        <Choice
          selected={prefs.chatOnlineSearchMode === "off"}
          onClick={() => update("chatOnlineSearchMode", "off")}
          title={t("chat.prefOnlineOffTitle")}
          description={t("chat.prefOnlineOffDesc")}
          icon={
            <IconDock>
              <GlobeLock
                className="h-[1.125rem] w-[1.125rem] text-[color:var(--foreground)]"
                strokeWidth={2}
                aria-hidden
              />
            </IconDock>
          }
        />
      </Section>

      <Section heading={t("chat.prefSectionUnbound")}>
        <Choice
          selected={prefs.chatUnboundMode}
          onClick={() => update("chatUnboundMode", true)}
          title={t("chat.prefUnboundOnTitle")}
          description={t("chat.prefUnboundOnDesc")}
          icon={
            <IconDock accent>
              <Bird
                className="h-[1.125rem] w-[1.125rem] text-emerald-600"
                strokeWidth={2}
                aria-hidden
              />
            </IconDock>
          }
        />
        <Choice
          selected={!prefs.chatUnboundMode}
          onClick={() => update("chatUnboundMode", false)}
          title={t("chat.prefUnboundOffTitle")}
          description={t("chat.prefUnboundOffDesc")}
          icon={
            <IconDock>
              <span className="relative inline-flex items-center justify-center">
                <Bird
                  className="relative z-0 h-[1.125rem] w-[1.125rem] text-[color:var(--foreground)] opacity-[0.42]"
                  strokeWidth={2}
                  aria-hidden
                />
                <Slash
                  className="pointer-events-none absolute z-10 h-[1.375rem] w-[1.375rem] text-[color:var(--foreground)] opacity-65"
                  strokeWidth={2.25}
                  aria-hidden
                />
              </span>
            </IconDock>
          }
        />
      </Section>

      <div className="flex flex-col gap-1">
        <h4 className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--label-secondary)]">
          {t("chat.prefSectionKnowledge")}
        </h4>
        <div className="card-surface rounded-2xl p-1.5">
          <Choice
            selected={prefs.chatKnowledgeMode === "smart"}
            onClick={() => update("chatKnowledgeMode", "smart")}
            title={t("chat.prefKnowledgeSmartTitle")}
            description={t("chat.prefKnowledgeSmartDesc")}
            icon={
              <IconDock accent={prefs.chatKnowledgeMode === "smart"}>
                <BookOpenCheck
                  className="h-[1.125rem] w-[1.125rem] text-amber-600"
                  strokeWidth={2}
                  aria-hidden
                />
              </IconDock>
            }
          />
          <Choice
            selected={prefs.chatKnowledgeMode === "scoped"}
            onClick={enableScoped}
            title={t("chat.prefKnowledgeScopedTitle")}
            description={t("chat.prefKnowledgeScopedDesc")}
            icon={
              <IconDock accent={prefs.chatKnowledgeMode === "scoped"}>
                <BookMarked
                  className="h-[1.125rem] w-[1.125rem] text-orange-600"
                  strokeWidth={2}
                  aria-hidden
                />
              </IconDock>
            }
          />
          {prefs.chatKnowledgeMode === "scoped" && (
            <KnowledgeScopePicker
              scope={prefs.chatKnowledgeScope}
              documents={documents}
              categories={categories}
              loading={kbLoading}
              onScopeChange={(s) => update("chatKnowledgeScope", s)}
            />
          )}
          <Choice
            selected={prefs.chatKnowledgeMode === "off"}
            onClick={() => update("chatKnowledgeMode", "off")}
            title={t("chat.prefKnowledgeOffTitle")}
            description={t("chat.prefKnowledgeOffDesc")}
            icon={
              <IconDock>
                <BookOpen
                  className="h-[1.125rem] w-[1.125rem] text-[color:var(--foreground)] opacity-60"
                  strokeWidth={2}
                  aria-hidden
                />
              </IconDock>
            }
          />
        </div>
      </div>

      <Section heading={t("chat.prefSectionMemoryRecall")}>
        <Choice
          selected={prefs.chatMemoryRecall}
          onClick={() => update("chatMemoryRecall", true)}
          title={t("chat.prefMemoryRecallOnTitle")}
          description={t("chat.prefMemoryRecallOnDesc")}
          icon={
            <IconDock accent>
              <Library
                className="h-[1.125rem] w-[1.125rem] text-indigo-600"
                strokeWidth={2}
                aria-hidden
              />
            </IconDock>
          }
        />
        <Choice
          selected={!prefs.chatMemoryRecall}
          onClick={() => update("chatMemoryRecall", false)}
          title={t("chat.prefMemoryRecallOffTitle")}
          description={t("chat.prefMemoryRecallOffDesc")}
          icon={
            <IconDock>
              <span className="relative inline-flex items-center justify-center">
                <Library
                  className="relative z-0 h-[1.125rem] w-[1.125rem] text-[color:var(--foreground)] opacity-[0.38]"
                  strokeWidth={2}
                  aria-hidden
                />
                <Slash
                  className="pointer-events-none absolute z-10 h-[1.375rem] w-[1.375rem] text-[color:var(--foreground)] opacity-65"
                  strokeWidth={2.25}
                  aria-hidden
                />
              </span>
            </IconDock>
          }
        />
      </Section>

      <Section heading={t("chat.prefSectionMemory")}>
        <Choice
          selected={prefs.chatMemoryEnabled}
          onClick={() => update("chatMemoryEnabled", true)}
          title={t("chat.prefMemoryOnTitle")}
          description={t("chat.prefMemoryOnDesc")}
          icon={
            <IconDock accent>
              <BrainCircuit
                className="h-[1.125rem] w-[1.125rem] text-violet-600"
                strokeWidth={2}
                aria-hidden
              />
            </IconDock>
          }
        />
        <Choice
          selected={!prefs.chatMemoryEnabled}
          onClick={() => update("chatMemoryEnabled", false)}
          title={t("chat.prefMemoryOffTitle")}
          description={t("chat.prefMemoryOffDesc")}
          icon={
            <IconDock>
              <span className="relative inline-flex items-center justify-center">
                <BrainCircuit
                  className="relative z-0 h-[1.125rem] w-[1.125rem] text-[color:var(--foreground)] opacity-[0.38]"
                  strokeWidth={2}
                  aria-hidden
                />
                <Slash
                  className="pointer-events-none absolute z-10 h-[1.375rem] w-[1.375rem] text-[color:var(--foreground)] opacity-65"
                  strokeWidth={2.25}
                  aria-hidden
                />
              </span>
            </IconDock>
          }
        />
      </Section>
    </div>
  );
}
