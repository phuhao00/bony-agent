"use client";

import { useTranslation } from "@/hooks/useTranslation";
import { useCallback, useEffect, useRef, useState } from "react";

interface Skill {
  id: string;
  name: string;
  display_name: string;
  description: string;
  category: string;
  version: string;
  has_skill_md: boolean;
  enabled: boolean;
}

const CATEGORY_EMOJI: Record<string, string> = {
  Content: "✍️",
  content: "✍️",
  Media: "🎬",
  media: "🎬",
  Publishing: "📤",
  publishing: "📤",
  Review: "🔍",
  review: "🔍",
  Dev: "💻",
  dev: "💻",
  General: "⚙️",
  general: "⚙️",
};

const CATEGORIES = [
  "General",
  "Content",
  "Media",
  "Publishing",
  "Review",
  "Dev",
];

const BLANK_FORM = {
  skill_id: "",
  display_name: "",
  description: "",
  category: "General",
  version: "1.0.0",
  allowed_tools: "",
};

const SKILL_CATEGORY_I18N: Record<string, string> = {
  General: "settings.skills.categoryGeneral",
  Content: "settings.skills.categoryContent",
  Media: "settings.skills.categoryMedia",
  Publishing: "settings.skills.categoryPublishing",
  Review: "settings.skills.categoryReview",
  Dev: "settings.skills.categoryDev",
};

export default function CapabilitiesSkillsTab() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Import modal state
  const [showImport, setShowImport] = useState(false);
  const [importTab, setImportTab] = useState<"form" | "file">("form");
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileSkillId, setFileSkillId] = useState("");
  const [fileUploading, setFileUploading] = useState(false);
  const [fileError, setFileError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/skills");
      const data = await res.json();
      setSkills(data.skills || []);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (skillId: string, enabled: boolean) => {
    setToggling(skillId);
    try {
      await fetch("/api/skills/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill_id: skillId, enabled }),
      });
      setSkills((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, enabled } : s)),
      );
    } finally {
      setToggling(null);
    }
  };

  const handleFormImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!form.skill_id.trim() || !form.display_name.trim()) {
      setFormError("技能 ID 和名称不能为空");
      return;
    }
    setFormSaving(true);
    try {
      const res = await fetch("/api/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.success)
        throw new Error(data.detail || data.error || "创建失败");
      setShowImport(false);
      setForm({ ...BLANK_FORM });
      await load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setFormSaving(false);
    }
  };

  const handleFileImport = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setFileError("请选择 SKILL.md 文件");
      return;
    }
    if (!fileSkillId.trim()) {
      setFileError("请填写技能 ID");
      return;
    }
    setFileError("");
    setFileUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("skill_id", fileSkillId.trim());
      const res = await fetch("/api/skills/import-file", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!data.success)
        throw new Error(data.detail || data.error || "上传失败");
      setShowImport(false);
      setFileSkillId("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (err: any) {
      setFileError(err.message);
    } finally {
      setFileUploading(false);
    }
  };

  const filtered = skills.filter(
    (s) =>
      !query ||
      s.display_name.toLowerCase().includes(query.toLowerCase()) ||
      s.description.toLowerCase().includes(query.toLowerCase()) ||
      s.category.toLowerCase().includes(query.toLowerCase()),
  );

  const enabledCount = skills.filter((s) => s.enabled).length;

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[color:var(--accent)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Import modal */}
      {showImport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowImport(false);
          }}
        >
          <div className="popover-vibrant w-full max-w-lg rounded-2xl p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[color:var(--foreground)]">
                导入技能
              </h3>
              <button
                type="button"
                onClick={() => setShowImport(false)}
                className="text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="mb-5 flex gap-1 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-1">
              {(["form", "file"] as const).map((tabMode) => (
                <button
                  key={tabMode}
                  type="button"
                  onClick={() => setImportTab(tabMode)}
                  className={`flex-1 rounded-lg py-1.5 text-[13px] font-medium transition-colors ${
                    importTab === tabMode
                      ? "bg-[var(--card-bg)] text-[color:var(--foreground)] shadow-sm"
                      : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  }`}
                >
                  {tabMode === "form" ? "手动创建" : "上传 SKILL.md"}
                </button>
              ))}
            </div>

            {importTab === "form" ? (
              <form onSubmit={handleFormImport} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[color:var(--label-secondary)]">
                      技能 ID <span className="text-red-400">*</span>
                    </label>
                    <input
                      value={form.skill_id}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, skill_id: e.target.value }))
                      }
                      placeholder="my-skill"
                      className="w-full rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-[13px] focus:border-[color:var(--accent)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[color:var(--label-secondary)]">
                      显示名称 <span className="text-red-400">*</span>
                    </label>
                    <input
                      value={form.display_name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, display_name: e.target.value }))
                      }
                      placeholder="我的技能"
                      className="w-full rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-[13px] focus:border-[color:var(--accent)] focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[color:var(--label-secondary)]">
                    描述
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, description: e.target.value }))
                    }
                    rows={2}
                    placeholder="技能的功能描述…"
                    className="w-full rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-[13px] resize-none focus:border-[color:var(--accent)] focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[color:var(--label-secondary)]">
                      分类
                    </label>
                    <select
                      value={form.category}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, category: e.target.value }))
                      }
                      className="w-full rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-[13px] focus:border-[color:var(--accent)] focus:outline-none"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {SKILL_CATEGORY_I18N[c]
                            ? t(SKILL_CATEGORY_I18N[c])
                            : c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[color:var(--label-secondary)]">
                      版本
                    </label>
                    <input
                      value={form.version}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, version: e.target.value }))
                      }
                      placeholder="1.0.0"
                      className="w-full rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-[13px] focus:border-[color:var(--accent)] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[color:var(--label-secondary)]">
                      {t("settings.skills.allowedToolsLabel")}
                    </label>
                    <input
                      value={form.allowed_tools}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          allowed_tools: e.target.value,
                        }))
                      }
                      placeholder="tool1,tool2"
                      className="w-full rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-[13px] focus:border-[color:var(--accent)] focus:outline-none"
                    />
                  </div>
                </div>
                {formError && (
                  <p className="text-[12px] text-red-500">{formError}</p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowImport(false)}
                    className="rounded-lg border border-[color:var(--separator-subtle)] px-4 py-2 text-[13px] text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={formSaving}
                    className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-92 disabled:opacity-50"
                  >
                    {formSaving ? "创建中…" : "创建技能"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[color:var(--label-secondary)]">
                    技能 ID（目录名）<span className="text-red-400">*</span>
                  </label>
                  <input
                    value={fileSkillId}
                    onChange={(e) => setFileSkillId(e.target.value)}
                    placeholder="my-skill"
                    className="w-full rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-[13px] focus:border-[color:var(--accent)] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[color:var(--label-secondary)]">
                    SKILL.md 文件 <span className="text-red-400">*</span>
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,text/markdown,text/plain"
                    className="block w-full text-[13px] text-[color:var(--foreground)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--nav-active-fill)] file:px-3 file:py-1.5 file:text-[12px] file:font-semibold file:text-[color:var(--accent)]"
                  />
                  <p className="mt-1 text-[11px] text-[color:var(--label-secondary)]">
                    上传含 YAML frontmatter 的 SKILL.md 文件，将写入
                    .agent/skills/&lt;技能ID&gt;/SKILL.md
                  </p>
                </div>
                {fileError && (
                  <p className="text-[12px] text-red-500">{fileError}</p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowImport(false)}
                    className="rounded-lg border border-[color:var(--separator-subtle)] px-4 py-2 text-[13px] text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={fileUploading}
                    onClick={handleFileImport}
                    className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-92 disabled:opacity-50"
                  >
                    {fileUploading ? "上传中…" : "上传导入"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats + search + import btn */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <input
            type="search"
            placeholder="搜索技能…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5 text-[13px] text-[color:var(--foreground)] shadow-sm outline-none placeholder:text-[color:var(--label-secondary)] focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:rgba(255,149,0,0.15)]"
          />
        </div>
        <span className="shrink-0 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] px-3 py-2 text-[13px] text-[color:var(--label-secondary)] shadow-sm">
          {enabledCount} / {skills.length} 启用
        </span>
        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="shrink-0 rounded-xl bg-[color:var(--accent)] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-92"
        >
          + 导入技能
        </button>
      </div>

      {/* Skill cards */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[color:var(--separator-subtle)] py-12 text-center text-[13px] text-[color:var(--label-secondary)]">
          未找到匹配的技能
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((skill) => {
            const emoji = CATEGORY_EMOJI[skill.category] || "⚙️";
            const isToggling = toggling === skill.id;
            return (
              <div
                key={skill.id}
                className={`flex items-center gap-3 rounded-2xl border p-4 shadow-sm transition-all ${
                  skill.enabled
                    ? "border-[color:rgba(255,149,0,0.22)] bg-[var(--nav-active-fill)]"
                    : "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] opacity-70"
                }`}
              >
                <span className="shrink-0 text-xl">{emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-semibold text-[color:var(--foreground)]">
                      {skill.display_name}
                    </p>
                    {skill.version && (
                      <span className="shrink-0 rounded-full bg-[var(--nav-active-fill)] px-1.5 py-0.5 text-[10px] text-[color:var(--label-secondary)]">
                        v{skill.version}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-[color:var(--label-secondary)]">
                    {skill.description || skill.id}
                  </p>
                  <span className="mt-1 inline-block rounded-full bg-[var(--nav-active-fill)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--label-secondary)]">
                    {skill.category
                      ? SKILL_CATEGORY_I18N[skill.category]
                        ? t(SKILL_CATEGORY_I18N[skill.category])
                        : skill.category
                      : t("settings.skills.categoryGeneral")}
                  </span>
                </div>
                {/* Toggle */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={skill.enabled}
                  disabled={isToggling}
                  onClick={() => toggle(skill.id, !skill.enabled)}
                  aria-label={skill.enabled ? "禁用" : "启用"}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                    skill.enabled ? "bg-[color:var(--accent)]" : "bg-[color:var(--separator-subtle)]"
                  } ${isToggling ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
                      skill.enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
