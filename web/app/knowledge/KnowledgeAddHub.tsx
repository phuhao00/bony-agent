"use client";

import { useState } from "react";
import { FilePlus2, HelpCircle, Link2, Sparkles, Upload } from "lucide-react";
import { KnowledgeUploadDropzone } from "./KnowledgeUploadDropzone";
import type { FileUploadItem } from "@/lib/knowledge-upload-client";

type Category = { id: string; name: string; icon: string };

type AddTab = "upload" | "link" | "note" | "faq";

type Props = {
  categories: Category[];
  categoryId: string;
  onCategoryChange: (id: string) => void;
  uploadLoading: boolean;
  uploadItems: FileUploadItem[];
  onFilesReady: (files: File[]) => void | Promise<void>;
  noteTitle: string;
  noteContent: string;
  noteLoading: boolean;
  onNoteTitleChange: (v: string) => void;
  onNoteContentChange: (v: string) => void;
  onCreateNote: () => void;
  faqTitle: string;
  faqLoading: boolean;
  onFaqTitleChange: (v: string) => void;
  onCreateFaq: () => void;
  linkUrl: string;
  linkTitle: string;
  linkLoading: boolean;
  onLinkUrlChange: (v: string) => void;
  onLinkTitleChange: (v: string) => void;
  onImportLink: () => void;
};

const TABS: { id: AddTab; label: string; icon: typeof Upload; hint: string }[] = [
  {
    id: "upload",
    label: "上传文件",
    icon: Upload,
    hint: "拖拽或选择文件/文件夹，自动解析转化为知识条目",
  },
  {
    id: "link",
    label: "添加链接",
    icon: Link2,
    hint: "抓取公开网页正文，自动转为 Markdown 知识条目",
  },
  {
    id: "note",
    label: "新建笔记",
    icon: FilePlus2,
    hint: "直接输入 Markdown 文本",
  },
  {
    id: "faq",
    label: "新建 FAQ",
    icon: HelpCircle,
    hint: "创建问答列表，或上传 Excel/JSON",
  },
];

export function KnowledgeAddHub({
  categories,
  categoryId,
  onCategoryChange,
  uploadLoading,
  uploadItems,
  onFilesReady,
  noteTitle,
  noteContent,
  noteLoading,
  onNoteTitleChange,
  onNoteContentChange,
  onCreateNote,
  faqTitle,
  faqLoading,
  onFaqTitleChange,
  onCreateFaq,
  linkUrl,
  linkTitle,
  linkLoading,
  onLinkUrlChange,
  onLinkTitleChange,
  onImportLink,
}: Props) {
  const [tab, setTab] = useState<AddTab>("upload");
  const categoryName =
    categories.find((c) => c.id === categoryId)?.name || categoryId;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--foreground)] lg:text-lg">
            新增知识
          </h2>
          <p className="mt-0.5 text-[12px] text-[color:var(--label-secondary)] lg:text-[13px]">
            {tab === "upload"
              ? "上传后系统将自动分析内容并归入合适分类"
              : tab === "link"
                ? "抓取网页正文并自动转化为可检索的知识条目"
                : "选择一种方式导入内容"}
          </p>
        </div>

        {tab !== "upload" && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[12px] font-medium text-[color:var(--label-secondary)]">
              归入分类
            </label>
            <select
              value={categoryId}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="min-w-[140px] rounded-lg border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-2.5 py-1.5 text-[12px] text-[color:var(--foreground)]"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TABS.map(({ id, label, icon: Icon, hint }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                active
                  ? "border-[color:color-mix(in_srgb,var(--accent)_40%,var(--separator-subtle))] bg-[color:color-mix(in_srgb,var(--accent)_12%,var(--card-bg))]"
                  : "border-[color:var(--separator-subtle)] bg-[var(--card-bg)] hover:bg-[var(--nav-active-fill)]"
              }`}
            >
              <Icon
                className={`mb-1.5 h-4 w-4 ${active ? "text-[color:var(--accent)]" : "text-[color:var(--label-secondary)]"}`}
              />
              <div className="text-[12px] font-semibold text-[color:var(--foreground)] lg:text-[13px]">
                {label}
              </div>
              <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-[color:var(--label-secondary)] lg:text-[11px]">
                {hint}
              </div>
            </button>
          );
        })}
      </div>

      <div className="card-surface flex min-h-0 flex-1 flex-col rounded-xl p-4 lg:rounded-2xl lg:p-5">
        {tab === "upload" && (
          <>
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--accent)_25%,var(--separator-subtle))] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--card-bg))] px-3 py-2">
              <Sparkles className="h-4 w-4 shrink-0 text-[color:var(--accent)]" />
              <p className="text-[12px] text-[color:var(--foreground)]">
                智能分类已开启：上传后自动解析源文件、转化为 Markdown 知识条目并匹配分类
              </p>
            </div>
            <KnowledgeUploadDropzone
              disabled={uploadLoading}
              uploadItems={uploadItems}
              onFilesReady={onFilesReady}
            />
          </>
        )}

        {tab === "link" && (
          <div className="space-y-3">
            <input
              value={linkUrl}
              onChange={(e) => onLinkUrlChange(e.target.value)}
              placeholder="https://example.com/article"
              className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5 text-[13px]"
            />
            <input
              value={linkTitle}
              onChange={(e) => onLinkTitleChange(e.target.value)}
              placeholder="自定义标题（可选，默认使用网页标题）"
              className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5 text-[13px]"
            />
            <p className="text-[12px] leading-relaxed text-[color:var(--label-secondary)]">
              支持公开可访问的网页链接；需登录、强 JS 渲染或内网地址无法抓取。同一链接不会重复导入。
            </p>
            <button
              type="button"
              onClick={onImportLink}
              disabled={linkLoading || !linkUrl.trim()}
              className="w-full rounded-xl bg-[color:color-mix(in_srgb,var(--accent)_85%,#000)] py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {linkLoading ? "抓取并导入中…" : `导入链接到「${categoryName}」`}
            </button>
          </div>
        )}

        {tab === "note" && (
          <div className="space-y-3">
            <input
              value={noteTitle}
              onChange={(e) => onNoteTitleChange(e.target.value)}
              placeholder="标题（可选）"
              className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5 text-[13px]"
            />
            <textarea
              value={noteContent}
              onChange={(e) => onNoteContentChange(e.target.value)}
              rows={12}
              placeholder="输入知识内容…"
              className="min-h-[240px] w-full resize-y rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5 text-[13px] leading-relaxed"
            />
            <button
              type="button"
              onClick={onCreateNote}
              disabled={noteLoading || !noteContent.trim()}
              className="w-full rounded-xl bg-[color:color-mix(in_srgb,var(--accent)_85%,#000)] py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {noteLoading ? "创建中…" : `创建笔记到「${categoryName}」`}
            </button>
          </div>
        )}

        {tab === "faq" && (
          <div className="space-y-3">
            <input
              value={faqTitle}
              onChange={(e) => onFaqTitleChange(e.target.value)}
              placeholder="FAQ 标题，如：产品常见问题"
              className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2.5 text-[13px]"
            />
            <p className="text-[12px] leading-relaxed text-[color:var(--label-secondary)]">
              创建后可逐条编辑问答。若已有 Excel（问题/答案列）或 JSON FAQ
              文件，请切换到「上传文件」。
            </p>
            <button
              type="button"
              onClick={onCreateFaq}
              disabled={faqLoading}
              className="w-full rounded-xl bg-amber-600 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {faqLoading ? "创建中…" : "创建 FAQ 并开始编辑"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
