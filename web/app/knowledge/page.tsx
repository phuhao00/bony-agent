"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  MessageSquareText,
  Plus,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { KnowledgeAddHub } from "./KnowledgeAddHub";
import { KnowledgeDocumentMeta } from "./KnowledgeDocumentMeta";
import { isFaqDocument } from "@/lib/knowledge-faq";
import { partitionKnowledgeFiles } from "@/lib/knowledge-upload";
import {
  createUploadItem,
  isUploadBatchFinished,
  uploadKnowledgeFile,
  type FileUploadItem,
} from "@/lib/knowledge-upload-client";

const KnowledgeAppendPanel = dynamic(
  () => import("./KnowledgeAppendPanel").then((m) => m.KnowledgeAppendPanel),
  { ssr: false },
);
const KnowledgeContentPanel = dynamic(
  () => import("./KnowledgeContentPanel").then((m) => m.KnowledgeContentPanel),
  { ssr: false },
);
const KnowledgeQueryPanel = dynamic(
  () => import("./KnowledgeQueryPanel").then((m) => m.KnowledgeQueryPanel),
  { ssr: false },
);
const KnowledgeFaqPanel = dynamic(
  () => import("./KnowledgeFaqPanel").then((m) => m.KnowledgeFaqPanel),
  { ssr: false },
);

interface QuerySource {
  text: string;
  score: number;
  category?: string;
}

interface QueryResult {
  success: boolean;
  answer?: string;
  error?: string;
  sources?: QuerySource[];
}

interface Document {
  id: string;
  filename: string;
  filepath: string;
  size: number;
  created_at: string;
  updated_at?: string;
  append_count?: number;
  category: string;
  tags: string[];
  description: string;
  content_type?: string;
  faq_count?: number;
  source_filename?: string;
  source_type?: string;
  converted?: boolean;
  char_count?: number;
  content_optimized?: boolean;
  content_optimize_method?: string;
}

interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  document_count: number;
}

interface KnowledgeStatus {
  initialized: boolean;
  document_count: number;
  total_file_size_human: string;
  index_size_human: string;
  category_count: number;
}

type PageTab = "documents" | "search" | "categories";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Toast({
  message,
  tone,
  onClose,
}: {
  message: string;
  tone: "ok" | "err";
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 3200);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm shadow-lg ${
        tone === "ok"
          ? "border-emerald-500/30 bg-emerald-500/10 text-[color:var(--foreground)]"
          : "border-red-500/30 bg-red-500/10 text-[color:var(--foreground)]"
      }`}
    >
      {message}
    </div>
  );
}

interface DeleteTarget {
  id: string;
  label: string;
  kind: "document" | "category";
}

function DeleteConfirmDialog({
  target,
  loading,
  onCancel,
  onConfirm,
}: {
  target: DeleteTarget;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, onCancel]);

  const isDocument = target.kind === "document";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-delete-title"
        className="card-surface w-full max-w-md rounded-2xl p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
            <Trash2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="knowledge-delete-title"
              className="text-[15px] font-semibold text-[color:var(--foreground)]"
            >
              {isDocument ? "删除文档" : "删除分类"}
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--label-secondary)]">
              {isDocument ? (
                <>
                  确定删除「
                  <span className="font-medium text-[color:var(--foreground)]">
                    {target.label}
                  </span>
                  」？文档与向量索引将被永久移除，此操作不可撤销。
                </>
              ) : (
                <>
                  确定删除分类「
                  <span className="font-medium text-[color:var(--foreground)]">
                    {target.label}
                  </span>
                  」？该分类下的文档将移入「未分类」。
                </>
              )}
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-[13px] font-medium text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className="inline-flex min-w-[88px] items-center justify-center rounded-xl bg-red-500 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-600 disabled:opacity-50"
          >
            {loading ? "删除中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

const TAB_ITEMS: { id: PageTab; label: string; icon: typeof BookOpen }[] = [
  { id: "documents", label: "文档", icon: BookOpen },
  { id: "search", label: "智能检索", icon: MessageSquareText },
  { id: "categories", label: "分类管理", icon: Settings2 },
];

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [pageTab, setPageTab] = useState<PageTab>("documents");
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "err" } | null>(
    null,
  );

  const [appendTitle, setAppendTitle] = useState("");
  const [appendContent, setAppendContent] = useState("");
  const [appendLoading, setAppendLoading] = useState(false);
  const [contentRefreshKey, setContentRefreshKey] = useState(0);
  const [metaSaving, setMetaSaving] = useState(false);

  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);

  const [faqTitle, setFaqTitle] = useState("");
  const [faqLoading, setFaqLoading] = useState(false);

  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);

  const [addCategory, setAddCategory] = useState("uncategorized");
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadItems, setUploadItems] = useState<FileUploadItem[]>([]);
  const uploadSessionRef = useRef(0);

  const [query, setQuery] = useState("");
  const [queryScope, setQueryScope] = useState<string>("all");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  const [newCatId, setNewCatId] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [newCatColor, setNewCatColor] = useState("#6B7280");
  const [newCatIcon, setNewCatIcon] = useState("📁");
  const [catLoading, setCatLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const notify = useCallback((message: string, tone: "ok" | "err" = "ok") => {
    setToast({ message, tone });
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [docsRes, statusRes, catsRes] = await Promise.all([
        fetch("/api/knowledge/documents"),
        fetch("/api/knowledge/status"),
        fetch("/api/knowledge/categories"),
      ]);
      const docsData = await docsRes.json();
      const statusData = await statusRes.json();
      const catsData = await catsRes.json();
      if (Array.isArray(docsData.documents)) {
        setDocuments(docsData.documents);
      } else if (docsData.success) {
        setDocuments(docsData.documents || []);
      }
      if (statusData.success) setStatus(statusData.status);
      if (catsData.success) setCategories(catsData.categories || []);
    } catch (error) {
      console.error("Failed to load knowledge data:", error);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const filteredDocs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return documents.filter((doc) => {
      if (categoryFilter !== "all" && doc.category !== categoryFilter) return false;
      if (!q) return true;
      const hay = [doc.filename, doc.description, ...(doc.tags || [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [documents, categoryFilter, searchTerm]);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) ?? null,
    [documents, selectedDocId],
  );

  const uploadFiles = useCallback(
    async (rawFiles: File[]) => {
      if (uploadLoading) {
        notify("已有文件正在导入，请等待当前任务完成", "err");
        return;
      }

      const { supported, skippedUnsupported, skippedOversized } =
        partitionKnowledgeFiles(rawFiles);
      if (!supported.length) {
        if (skippedUnsupported || skippedOversized) {
          notify(
            `未找到可导入文件（${skippedUnsupported} 个格式不支持，${skippedOversized} 个超过 20MB）`,
            "err",
          );
        }
        return;
      }

      const sessionId = uploadSessionRef.current + 1;
      uploadSessionRef.current = sessionId;

      const items = supported.map(createUploadItem);
      setUploadItems(items);
      setUploadLoading(true);

      const updateItem = (
        id: string,
        patch: Partial<FileUploadItem>,
      ) => {
        setUploadItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        );
      };

      let ok = 0;
      let failed = 0;
      let lastImportedDocId: string | null = null;

      try {
        for (let index = 0; index < supported.length; index += 1) {
          const file = supported[index];
          const item = items[index];
          updateItem(item.id, { stage: "reading", progress: 8 });
          updateItem(item.id, { stage: "analyzing", progress: 15 });

          const result = await uploadKnowledgeFile({
            file,
            autoCategory: true,
            onStage: (stage, progress) => {
              if (uploadSessionRef.current !== sessionId) return;
              updateItem(item.id, { stage, progress });
            },
          });

          if (uploadSessionRef.current !== sessionId) return;

          if (result.success) {
            ok += 1;
            if (result.documentId) lastImportedDocId = result.documentId;
            const catId = result.assignedCategory || "uncategorized";
            const catName = categoryMap[catId]?.name || catId;
            updateItem(item.id, {
              stage: "done",
              progress: 100,
              categoryId: catId,
              categoryName: catName,
              autoAssigned: result.autoAssigned,
            });
          } else {
            failed += 1;
            updateItem(item.id, {
              stage: "error",
              progress: 100,
              error: result.error || "上传失败",
            });
            notify(`${file.name}: ${result.error || "上传失败"}`, "err");
          }
        }

        if (ok > 0) {
          const skipParts: string[] = [];
          if (skippedUnsupported)
            skipParts.push(`${skippedUnsupported} 个格式跳过`);
          if (skippedOversized)
            skipParts.push(`${skippedOversized} 个超限跳过`);
          if (failed) skipParts.push(`${failed} 个失败`);
          notify(
            skipParts.length
              ? `已转化并导入 ${ok} 个知识条目（${skipParts.join("，")}）`
              : `已转化并导入 ${ok} 个知识条目`,
          );
          await loadData();
          if (lastImportedDocId) {
            setSelectedDocId(lastImportedDocId);
            setPageTab("documents");
          }
        }
      } catch (error) {
        notify(`上传出错: ${error}`, "err");
      } finally {
        if (uploadSessionRef.current !== sessionId) return;
        setUploadLoading(false);
        window.setTimeout(() => {
          if (uploadSessionRef.current !== sessionId) return;
          setUploadItems((current) =>
            isUploadBatchFinished(current) ? [] : current,
          );
        }, 5000);
      }
    },
    [categoryMap, loadData, notify, uploadLoading],
  );

  const handleAppend = async () => {
    if (!selectedDocId) {
      notify("请先选择要追加的文档", "err");
      return;
    }
    if (!appendContent.trim()) {
      notify("请输入要追加的内容", "err");
      return;
    }
    setAppendLoading(true);
    try {
      const response = await fetch(
        `/api/knowledge/documents/${encodeURIComponent(selectedDocId)}/append`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: appendContent.trim(),
            section_title: appendTitle.trim(),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        notify(data.detail || data.error || "追加失败", "err");
        return;
      }
      setAppendContent("");
      setAppendTitle("");
      notify("内容已追加并更新索引");
      setContentRefreshKey((k) => k + 1);
      await loadData();
    } catch (error) {
      notify(`追加出错: ${error}`, "err");
    } finally {
      setAppendLoading(false);
    }
  };

  const patchDocumentMeta = useCallback(
    async (patch: { category?: string; description?: string }) => {
      if (!selectedDocId) return false;
      setMetaSaving(true);
      try {
        const response = await fetch(
          `/api/knowledge/documents/${encodeURIComponent(selectedDocId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          },
        );
        const data = await response.json();
        if (!response.ok || data.success === false) {
          notify(data.detail || data.error || "更新失败", "err");
          return false;
        }
        setDocuments((prev) =>
          prev.map((doc) =>
            doc.id === selectedDocId
              ? {
                  ...doc,
                  ...(patch.category !== undefined
                    ? { category: patch.category }
                    : null),
                  ...(patch.description !== undefined
                    ? { description: patch.description }
                    : null),
                }
              : doc,
          ),
        );
        await loadData();
        return true;
      } catch (error) {
        notify(`更新出错: ${error}`, "err");
        return false;
      } finally {
        setMetaSaving(false);
      }
    },
    [loadData, notify, selectedDocId],
  );

  const handleSaveCategory = useCallback(
    async (categoryId: string) => {
      const ok = await patchDocumentMeta({ category: categoryId });
      if (ok) {
        if (categoryFilter !== "all" && categoryFilter !== categoryId) {
          setCategoryFilter(categoryId);
        }
        const name = categoryMap[categoryId]?.name || categoryId;
        notify(`已归入「${name}」`);
      }
    },
    [categoryFilter, categoryMap, notify, patchDocumentMeta],
  );

  const handleSaveDescription = useCallback(
    async (description: string) => {
      const ok = await patchDocumentMeta({ description });
      if (ok) notify("描述已保存");
    },
    [notify, patchDocumentMeta],
  );

  const handleCreateFaq = async () => {
    setFaqLoading(true);
    try {
      const response = await fetch("/api/knowledge/faq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: faqTitle.trim() || "FAQ",
          category: addCategory === "uncategorized" ? "faq" : addCategory,
          items: [],
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        notify(data.detail || data.error || "创建失败", "err");
        return;
      }
      const createdId = data.document?.id as string | undefined;
      setFaqTitle("");
      notify("FAQ 已创建");
      await loadData();
      if (createdId) {
        setSelectedDocId(createdId);
        setPageTab("documents");
      }
    } catch (error) {
      notify(`创建出错: ${error}`, "err");
    } finally {
      setFaqLoading(false);
    }
  };

  const handleCreateNote = async () => {
    if (!noteContent.trim()) {
      notify("请输入笔记内容", "err");
      return;
    }
    setNoteLoading(true);
    try {
      const response = await fetch("/api/knowledge/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: noteTitle.trim() || "未命名笔记",
          content: noteContent.trim(),
          category: addCategory,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        notify(data.detail || data.error || "创建失败", "err");
        return;
      }
      const createdId = data.documents?.[0]?.id as string | undefined;
      setNoteTitle("");
      setNoteContent("");
      notify("笔记已创建");
      await loadData();
      if (createdId) {
        setSelectedDocId(createdId);
        setPageTab("documents");
      }
    } catch (error) {
      notify(`创建出错: ${error}`, "err");
    } finally {
      setNoteLoading(false);
    }
  };

  const handleImportLink = async () => {
    const trimmedUrl = linkUrl.trim();
    if (!trimmedUrl) {
      notify("请输入网页链接", "err");
      return;
    }
    setLinkLoading(true);
    try {
      const response = await fetch("/api/knowledge/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: trimmedUrl,
          title: linkTitle.trim(),
          category: addCategory,
          auto_category: addCategory === "uncategorized",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        notify(data.detail || data.error || "导入失败", "err");
        return;
      }
      const createdId = data.documents?.[0]?.id as string | undefined;
      setLinkUrl("");
      setLinkTitle("");
      notify(data.message || "链接已导入");
      await loadData();
      if (createdId) {
        setSelectedDocId(createdId);
        setPageTab("documents");
      }
    } catch (error) {
      notify(`导入出错: ${error}`, "err");
    } finally {
      setLinkLoading(false);
    }
  };

  const requestDeleteDocument = useCallback((doc: Pick<Document, "id" | "filename">) => {
    setDeleteTarget({
      id: doc.id,
      label: doc.filename,
      kind: "document",
    });
  }, []);

  const requestDeleteCategory = useCallback(
    (categoryId: string) => {
      const category = categories.find((item) => item.id === categoryId);
      setDeleteTarget({
        id: categoryId,
        label: category?.name || categoryId,
        kind: "category",
      });
    },
    [categories],
  );

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    const target = deleteTarget;
    try {
      if (target.kind === "document") {
        const response = await fetch(
          `/api/knowledge/documents/${encodeURIComponent(target.id)}`,
          {
            method: "DELETE",
            signal: AbortSignal.timeout(180_000),
          },
        );
        let data: { success?: boolean; detail?: string; error?: string; hint?: string } =
          {};
        try {
          data = await response.json();
        } catch {
          data = {};
        }
        if (response.ok && data.success !== false) {
          if (selectedDocId === target.id) setSelectedDocId(null);
          setDocuments((prev) => prev.filter((doc) => doc.id !== target.id));
          setDeleteTarget(null);
          notify("文档已删除");
          void loadData();
        } else {
          notify(
            data.detail ||
              data.error ||
              data.hint ||
              `删除失败 (${response.status})`,
            "err",
          );
        }
      } else {
        const response = await fetch(
          `/api/knowledge/categories/${encodeURIComponent(target.id)}`,
          {
            method: "DELETE",
            signal: AbortSignal.timeout(30_000),
          },
        );
        let data: { success?: boolean; error?: string } = {};
        try {
          data = await response.json();
        } catch {
          data = {};
        }
        if (response.ok && data.success !== false) {
          setDeleteTarget(null);
          notify("分类已删除");
          await loadData();
        } else {
          notify(data.error || `删除失败 (${response.status})`, "err");
        }
      }
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "TimeoutError"
          ? "删除超时，请稍后刷新列表确认是否已删除"
          : `删除出错: ${error}`;
      notify(message, "err");
    } finally {
      setDeleteLoading(false);
    }
  };

  useEffect(() => {
    if (pageTab !== "documents" || !selectedDocId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (deleteTarget || deleteLoading) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const doc = documents.find((item) => item.id === selectedDocId);
      if (!doc) return;
      event.preventDefault();
      requestDeleteDocument(doc);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    deleteLoading,
    deleteTarget,
    documents,
    pageTab,
    requestDeleteDocument,
    selectedDocId,
  ]);

  const handleQuery = async () => {
    if (!query.trim()) {
      notify("请输入问题", "err");
      return;
    }
    setQueryLoading(true);
    setQueryResult(null);
    try {
      let category: string | null = null;
      let docId: string | null = null;
      if (queryScope.startsWith("cat:")) {
        category = queryScope.slice(4);
      } else if (queryScope.startsWith("doc:")) {
        docId = queryScope.slice(4);
        const doc = documents.find((d) => d.id === docId);
        if (doc?.category) category = doc.category;
      }

      const response = await fetch("/api/knowledge/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          top_k: 3,
          category,
          doc_id: docId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setQueryResult({
          success: false,
          error:
            (typeof data.detail === "string" ? data.detail : data.error) ||
            `检索失败 (${response.status})`,
        });
        return;
      }
      setQueryResult(data);
    } catch (error) {
      setQueryResult({ success: false, error: String(error) });
    } finally {
      setQueryLoading(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCatId.trim() || !newCatName.trim()) {
      notify("请填写分类 ID 和名称", "err");
      return;
    }
    setCatLoading(true);
    try {
      const response = await fetch("/api/knowledge/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: newCatId.trim(),
          name: newCatName.trim(),
          description: newCatDesc,
          color: newCatColor,
          icon: newCatIcon,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setNewCatId("");
        setNewCatName("");
        setNewCatDesc("");
        notify("分类已创建");
        await loadData();
      } else notify(data.error || "创建失败", "err");
    } catch (error) {
      notify(`创建出错: ${error}`, "err");
    } finally {
      setCatLoading(false);
    }
  };

  const openAddView = () => {
    setSelectedDocId(null);
    setPageTab("documents");
  };

  return (
    <div className="page-canvas flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[color:var(--separator-subtle)] bg-[var(--card-bg)]/80 px-4 py-3 backdrop-blur-sm lg:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-amber-600" strokeWidth={2} />
              <h1 className="text-lg font-semibold text-[color:var(--foreground)]">
                知识库
              </h1>
              {status && (
                <span className="text-[12px] text-[color:var(--label-secondary)]">
                  · {status.document_count} 篇 · {status.category_count} 类
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)] p-1">
              {TAB_ITEMS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPageTab(id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    pageTab === id
                      ? "bg-[var(--card-bg)] text-[color:var(--foreground)] shadow-sm"
                      : "text-[color:var(--label-secondary)] hover:text-[color:var(--foreground)]"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <Link
              href="/"
              className="rounded-lg px-3 py-2 text-[13px] font-medium text-[color:var(--label-secondary)] hover:bg-[var(--nav-active-fill)]"
            >
              返回
            </Link>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
        {pageTab === "documents" && (
          <aside className="flex w-[min(320px,32vw)] shrink-0 flex-col border-r border-[color:var(--separator-subtle)] bg-[var(--chrome-rail-bg)]">
            <div className="space-y-3 border-b border-[color:var(--separator-subtle)] p-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
                  文档列表
                </span>
                <button
                  type="button"
                  onClick={openAddView}
                  className="inline-flex items-center gap-1 rounded-lg bg-[color:color-mix(in_srgb,var(--accent)_85%,#000)] px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  <Plus className="h-3 w-3" />
                  新增
                </button>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--label-secondary)]" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索文档…"
                  className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] py-2 pl-9 pr-3 text-[13px] outline-none focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[12px]"
              >
                <option value="all">全部分类</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.icon} {cat.name} ({cat.document_count})
                  </option>
                ))}
              </select>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {filteredDocs.length === 0 ? (
                <div className="px-3 py-8 text-center text-[12px] leading-relaxed text-[color:var(--label-secondary)]">
                  暂无文档
                  <br />
                  点击上方「新增」导入内容
                </div>
              ) : (
                filteredDocs.map((doc) => {
                  const cat = categoryMap[doc.category];
                  const active = selectedDocId === doc.id;
                  return (
                    <div
                      key={doc.id}
                      className={`group mb-1 flex items-stretch gap-0.5 rounded-xl transition-colors ${
                        active
                          ? "bg-[color:color-mix(in_srgb,var(--accent)_14%,var(--card-bg))]"
                          : "hover:bg-[var(--nav-active-fill)]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedDocId(doc.id)}
                        className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left"
                      >
                        <span
                          className="mt-1 h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: cat?.color || "#6B7280" }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">
                            {doc.filename}
                            {isFaqDocument(doc) && (
                              <span className="ml-1.5 inline-flex rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                FAQ
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-[color:var(--label-secondary)]">
                            {cat?.icon} {cat?.name || doc.category}
                            {" · "}
                            {isFaqDocument(doc)
                              ? `${doc.faq_count ?? 0} 条问答`
                              : doc.converted && doc.char_count
                                ? `${(doc.char_count / 1000).toFixed(1)}k 字`
                                : formatSize(doc.size)}
                            {doc.source_filename
                              ? ` · 来自 ${doc.source_filename}`
                              : ""}
                            {doc.append_count
                              ? ` · 已追加 ${doc.append_count} 次`
                              : ""}
                          </span>
                        </span>
                        <ChevronRight
                          className={`mt-0.5 h-4 w-4 shrink-0 text-[color:var(--label-secondary)] ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDeleteDocument(doc)}
                        className={`my-1.5 mr-1.5 inline-flex shrink-0 items-center justify-center rounded-lg px-2 text-red-500 transition-opacity hover:bg-red-500/10 ${
                          active
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        }`}
                        title={`删除 ${doc.filename}`}
                        aria-label={`删除 ${doc.filename}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        <main className="min-w-0 flex-1 overflow-hidden">
          {pageTab === "search" && (
            <div className="h-full overflow-y-auto p-4 lg:p-5">
              <KnowledgeQueryPanel
              documents={documents}
              categories={categories}
              query={query}
              queryScope={queryScope}
              queryLoading={queryLoading}
              queryResult={queryResult}
              onQueryChange={setQuery}
              onQueryScopeChange={setQueryScope}
              onSearch={handleQuery}
              />
            </div>
          )}

          {pageTab === "categories" && (
            <div className="h-full overflow-y-auto p-4 lg:p-5">
              <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-2">
              <div>
                <h2 className="text-lg font-semibold">分类管理</h2>
                <p className="mt-1 text-[13px] text-[color:var(--label-secondary)]">
                  组织文档结构；删除分类后文档会移入「未分类」
                </p>
              </div>
              <div className="card-surface space-y-2 rounded-2xl p-4 lg:col-span-2">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between rounded-xl border border-[color:var(--separator-subtle)] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-6 w-1 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span>{cat.icon}</span>
                      <div>
                        <div className="text-[13px] font-medium">{cat.name}</div>
                        <div className="text-[11px] text-[color:var(--label-secondary)]">
                          {cat.document_count} 篇
                        </div>
                      </div>
                    </div>
                    {cat.id !== "uncategorized" && (
                      <button
                        type="button"
                        onClick={() => requestDeleteCategory(cat.id)}
                        className="rounded-lg p-1.5 text-red-500 hover:bg-red-500/10"
                        title={`删除分类 ${cat.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="card-surface rounded-2xl p-4">
                <h3 className="mb-3 text-[13px] font-semibold">新建分类</h3>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={newCatId}
                    onChange={(e) =>
                      setNewCatId(
                        e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
                      )
                    }
                    placeholder="ID (my-docs)"
                    className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[12px]"
                  />
                  <input
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="名称"
                    className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[12px]"
                  />
                  <input
                    value={newCatDesc}
                    onChange={(e) => setNewCatDesc(e.target.value)}
                    placeholder="描述（可选）"
                    className="col-span-2 rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[12px]"
                  />
                  <input
                    value={newCatIcon}
                    onChange={(e) => setNewCatIcon(e.target.value)}
                    placeholder="图标"
                    className="rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)] px-3 py-2 text-[12px]"
                  />
                  <input
                    type="color"
                    value={newCatColor}
                    onChange={(e) => setNewCatColor(e.target.value)}
                    className="h-10 w-full cursor-pointer rounded-xl border border-[color:var(--separator-subtle)] bg-[var(--card-bg)]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCreateCategory}
                  disabled={catLoading}
                  className="mt-3 w-full rounded-xl bg-[color:color-mix(in_srgb,var(--accent)_85%,#000)] py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
                >
                  {catLoading ? "创建中…" : "创建分类"}
                </button>
              </div>
              </div>
            </div>
          )}

          {pageTab === "documents" && selectedDoc && (
            <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 lg:p-5">
              <KnowledgeDocumentMeta
                document={selectedDoc}
                categories={categories}
                saving={metaSaving}
                onSaveCategory={handleSaveCategory}
                onSaveDescription={handleSaveDescription}
                onAdd={openAddView}
                onDelete={() => requestDeleteDocument(selectedDoc)}
              />

              {isFaqDocument(selectedDoc) ? (
                <KnowledgeFaqPanel
                  document={selectedDoc}
                  notify={notify}
                  onSaved={loadData}
                />
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                  <KnowledgeContentPanel
                    docId={selectedDoc.id}
                    refreshToken={contentRefreshKey}
                    notify={notify}
                    onSaved={loadData}
                    autoOptimizeOnLoad
                    contentOptimized={Boolean(selectedDoc.content_optimized)}
                    sourceType={selectedDoc.source_type}
                    converted={Boolean(selectedDoc.converted)}
                    sourceFilename={selectedDoc.source_filename}
                  />
                  <details className="card-surface group rounded-xl lg:rounded-2xl">
                    <summary className="cursor-pointer list-none border-b border-[color:var(--separator-subtle)] px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="text-[13px] font-semibold">动态追加</h3>
                          <p className="mt-0.5 text-[12px] text-[color:var(--label-secondary)]">
                            在正文末尾追加新片段（可选）
                          </p>
                        </div>
                        <span className="text-[12px] text-[color:var(--label-secondary)] group-open:hidden">
                          展开
                        </span>
                      </div>
                    </summary>
                    <div className="p-4">
                      <KnowledgeAppendPanel
                        title={appendTitle}
                        content={appendContent}
                        loading={appendLoading}
                        onTitleChange={setAppendTitle}
                        onContentChange={setAppendContent}
                        onSubmit={handleAppend}
                        embedded
                      />
                    </div>
                  </details>
                </div>
              )}
            </div>
          )}

          {pageTab === "documents" && !selectedDoc && (
            <KnowledgeAddHub
              categories={categories}
              categoryId={addCategory}
              onCategoryChange={setAddCategory}
              uploadLoading={uploadLoading}
              uploadItems={uploadItems}
              onFilesReady={uploadFiles}
              noteTitle={noteTitle}
              noteContent={noteContent}
              noteLoading={noteLoading}
              onNoteTitleChange={setNoteTitle}
              onNoteContentChange={setNoteContent}
              onCreateNote={handleCreateNote}
              faqTitle={faqTitle}
              faqLoading={faqLoading}
              onFaqTitleChange={setFaqTitle}
              onCreateFaq={handleCreateFaq}
              linkUrl={linkUrl}
              linkTitle={linkTitle}
              linkLoading={linkLoading}
              onLinkUrlChange={setLinkUrl}
              onLinkTitleChange={setLinkTitle}
              onImportLink={handleImportLink}
            />
          )}
        </main>
      </div>

      {deleteTarget && (
        <DeleteConfirmDialog
          target={deleteTarget}
          loading={deleteLoading}
          onCancel={() => {
            if (!deleteLoading) setDeleteTarget(null);
          }}
          onConfirm={confirmDelete}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
