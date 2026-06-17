"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import { isFaqDocument } from "@/lib/knowledge-faq";

const API_PREFIX = "/api/v1/ai-customer-service";

export type CsTopicGroup = {
  id: string;
  icon: string;
  title: string;
  questions: string[];
};

export type CsWorkspace = {
  id: string;
  name: string;
  description?: string;
  domain?: string;
  system_prompt?: string;
  welcome_message?: string;
  knowledge_doc_ids?: string[];
  knowledge_categories?: string[];
  suggested_questions?: string[];
  topic_groups?: CsTopicGroup[];
  icon?: string;
  slug?: string;
  enabled?: boolean;
  is_default?: boolean;
  is_active?: boolean;
  retrieval_mode?: string;
  top_k?: number;
  temperature?: number;
  faq_item_count?: number;
  knowledge_doc_count?: number;
};

type KnowledgeDoc = {
  id: string;
  filename: string;
  category: string;
  faq_count?: number;
  content_type?: string;
  source_filename?: string;
  converted?: boolean;
};

type KnowledgeCategory = {
  id: string;
  name: string;
  icon?: string;
  document_count?: number;
};

type FormState = {
  name: string;
  domain: string;
  description: string;
  icon: string;
  welcome_message: string;
  system_prompt: string;
  knowledge_doc_ids: string[];
  knowledge_categories: string[];
  suggested_questions: string;
  is_default: boolean;
  retrieval_mode: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  domain: "",
  description: "",
  icon: "✦",
  welcome_message: "",
  system_prompt: "",
  knowledge_doc_ids: [],
  knowledge_categories: [],
  suggested_questions: "",
  is_default: false,
  retrieval_mode: "hybrid",
};

function formFromWorkspace(ws: CsWorkspace): FormState {
  return {
    name: ws.name ?? "",
    domain: ws.domain ?? "",
    description: ws.description ?? "",
    icon: ws.icon ?? "✦",
    welcome_message: ws.welcome_message ?? "",
    system_prompt: ws.system_prompt ?? "",
    knowledge_doc_ids: [...(ws.knowledge_doc_ids ?? [])],
    knowledge_categories: [...(ws.knowledge_categories ?? [])],
    suggested_questions: (ws.suggested_questions ?? []).join("\n"),
    is_default: Boolean(ws.is_default),
    retrieval_mode: ws.retrieval_mode ?? "hybrid",
  };
}

function payloadFromForm(form: FormState) {
  return {
    name: form.name.trim(),
    domain: form.domain.trim(),
    description: form.description.trim(),
    icon: form.icon.trim() || "✦",
    welcome_message: form.welcome_message.trim(),
    system_prompt: form.system_prompt.trim(),
    knowledge_doc_ids: form.knowledge_doc_ids,
    knowledge_categories: form.knowledge_categories,
    suggested_questions: form.suggested_questions
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    is_default: form.is_default,
    retrieval_mode: form.retrieval_mode,
  };
}

type Props = {
  open: boolean;
  onClose: () => void;
  workspaces: CsWorkspace[];
  editingId: string | null;
  onSaved: () => void;
  onDeleted: (id: string) => void;
};

export function WorkspaceConfigPanel({
  open,
  onClose,
  workspaces,
  editingId,
  onSaved,
  onDeleted,
}: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);

  const isEdit = Boolean(editingId);

  const reloadKnowledge = useCallback(async () => {
    setDocsLoading(true);
    try {
      const [docRes, catRes] = await Promise.all([
        fetch("/api/knowledge/documents", { cache: "no-store" }).then((r) =>
          r.json(),
        ),
        fetch("/api/knowledge/categories", { cache: "no-store" }).then((r) =>
          r.json(),
        ),
      ]);
      const nextDocs = Array.isArray(docRes?.documents)
        ? docRes.documents
        : [];
      const nextCategories = Array.isArray(catRes?.categories)
        ? catRes.categories
        : [];
      setDocs(nextDocs);
      setCategories(nextCategories);
    } catch {
      setDocs([]);
      setCategories([]);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (editingId) {
      const ws = workspaces.find((w) => w.id === editingId);
      setForm(ws ? formFromWorkspace(ws) : EMPTY_FORM);
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editingId, workspaces]);

  useEffect(() => {
    if (!open) return;
    void reloadKnowledge();
  }, [open, reloadKnowledge]);

  const faqDocs = useMemo(
    () => docs.filter((d) => isFaqDocument(d)),
    [docs],
  );

  const regularDocs = useMemo(
    () => docs.filter((d) => !isFaqDocument(d)),
    [docs],
  );

  const toggleDoc = (id: string) => {
    setForm((f) => ({
      ...f,
      knowledge_doc_ids: f.knowledge_doc_ids.includes(id)
        ? f.knowledge_doc_ids.filter((x) => x !== id)
        : [...f.knowledge_doc_ids, id],
    }));
  };

  const toggleCategory = (id: string) => {
    setForm((f) => ({
      ...f,
      knowledge_categories: f.knowledge_categories.includes(id)
        ? f.knowledge_categories.filter((x) => x !== id)
        : [...f.knowledge_categories, id],
    }));
  };

  const save = useCallback(async () => {
    if (!form.name.trim()) {
      setErr("请填写实例名称");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload = payloadFromForm(form);
      const url = isEdit
        ? `${API_PREFIX}/workspaces/${encodeURIComponent(editingId!)}`
        : `${API_PREFIX}/workspaces`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { detail?: string; error?: string };
      if (!res.ok) {
        setErr(data.detail ?? data.error ?? "保存失败");
        return;
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [editingId, form, isEdit, onClose, onSaved]);

  const remove = useCallback(async () => {
    if (!editingId) return;
    if (!window.confirm("确定删除这个客服实例吗？")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `${API_PREFIX}/workspaces/${encodeURIComponent(editingId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json()) as { detail?: string };
        setErr(data.detail ?? "删除失败");
        return;
      }
      onDeleted(editingId);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [editingId, onClose, onDeleted]);

  if (!open) return null;

  return (
    <div className="customer-config-overlay" role="dialog" aria-modal="true">
      <div className="customer-config-panel">
        <header className="customer-config-header">
          <div>
            <h2>{isEdit ? "编辑客服实例" : "新建客服实例"}</h2>
            <p>像创建对象一样配置领域、知识库与欢迎语，切换实例即可服务不同业务。</p>
          </div>
          <button type="button" className="customer-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        {err && <div className="customer-banner customer-banner--error">{err}</div>}

        <div className="customer-config-body">
          <section className="customer-config-section">
            <h3>基础信息</h3>
            <div className="customer-config-grid">
              <label>
                名称 *
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="例如：MOD 客服、电商售后"
                />
              </label>
              <label>
                图标
                <input
                  value={form.icon}
                  onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                  placeholder="✦"
                  maxLength={4}
                />
              </label>
              <label className="customer-config-span2">
                领域
                <input
                  value={form.domain}
                  onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
                  placeholder="例如：游戏 MOD / 会员订阅"
                />
              </label>
              <label className="customer-config-span2">
                简介
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="一句话说明这个客服负责什么"
                />
              </label>
            </div>
          </section>

          <section className="customer-config-section">
            <h3>对话设定</h3>
            <div className="customer-config-grid">
              <label className="customer-config-span2">
                欢迎语
                <textarea
                  rows={2}
                  value={form.welcome_message}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, welcome_message: e.target.value }))
                  }
                  placeholder="用户进入时看到的引导"
                />
              </label>
              <label className="customer-config-span2">
                系统提示词（可选）
                <textarea
                  rows={3}
                  value={form.system_prompt}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, system_prompt: e.target.value }))
                  }
                  placeholder="补充领域规则、禁止事项、回答风格"
                />
              </label>
              <label className="customer-config-span2">
                快捷问题（每行一条）
                <textarea
                  rows={4}
                  value={form.suggested_questions}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, suggested_questions: e.target.value }))
                  }
                  placeholder={"会员有哪些特权？\n如何取消自动续费？"}
                />
              </label>
            </div>
          </section>

          <section className="customer-config-section">
            <div className="customer-config-section__head">
              <h3>知识库绑定</h3>
              <button
                type="button"
                className="customer-icon-btn"
                title="刷新知识库列表"
                disabled={docsLoading}
                onClick={() => void reloadKnowledge()}
              >
                <RefreshCw size={14} className={docsLoading ? "animate-spin" : ""} />
              </button>
            </div>
            <p className="customer-config-hint">
              可指定具体文档，或按分类自动关联该分类下全部文档（PDF、Word、笔记等均支持）。
              {docs.length > 0 ? ` 当前知识库共 ${docs.length} 篇。` : ""}
            </p>

            <div className="customer-config-chips-wrap">
              <p className="customer-config-sub">绑定文档</p>
              <div className="customer-config-chips">
                {docs.length === 0 && (
                  <span className="customer-config-empty">
                    暂无文档，请先在「知识库」页导入 PDF / Word / 笔记等
                  </span>
                )}
                {regularDocs.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    className={`customer-config-chip${form.knowledge_doc_ids.includes(doc.id) ? " is-on" : ""}`}
                    onClick={() => toggleDoc(doc.id)}
                  >
                    📄 {doc.filename}
                    {doc.source_filename ? ` ← ${doc.source_filename}` : ""}
                  </button>
                ))}
                {faqDocs.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    className={`customer-config-chip${form.knowledge_doc_ids.includes(doc.id) ? " is-on" : ""}`}
                    onClick={() => toggleDoc(doc.id)}
                  >
                    ❓ {doc.filename}
                    {(doc.faq_count ?? 0) > 0 ? ` (${doc.faq_count})` : ""}
                  </button>
                ))}
              </div>
            </div>

            {faqDocs.length === 0 && regularDocs.length > 0 && (
              <p className="customer-config-hint">
                已检测到 {regularDocs.length} 篇普通文档；FAQ 问答库需上传 .faq.json 或在知识库创建 FAQ。
              </p>
            )}

            <div className="customer-config-chips-wrap">
              <p className="customer-config-sub">知识库分类（自动绑定）</p>
              <div className="customer-config-chips">
                {categories.length === 0 && (
                  <span className="customer-config-empty">暂无分类</span>
                )}
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`customer-config-chip${form.knowledge_categories.includes(cat.id) ? " is-on" : ""}`}
                    onClick={() => toggleCategory(cat.id)}
                  >
                    {cat.icon ? `${cat.icon} ` : ""}
                    {cat.name}
                    {(cat.document_count ?? 0) > 0
                      ? ` (${cat.document_count})`
                      : ""}
                  </button>
                ))}
              </div>
            </div>
            <label className="customer-config-check">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) =>
                  setForm((f) => ({ ...f, is_default: e.target.checked }))
                }
              />
              设为默认实例（打开客服页时优先使用）
            </label>
          </section>
        </div>

        <footer className="customer-config-footer">
          {isEdit && (
            <button
              type="button"
              className="customer-icon-btn customer-icon-btn--danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              <Trash2 size={16} />
              删除
            </button>
          )}
          <div className="customer-config-footer__right">
            <button type="button" className="customer-icon-btn" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="customer-icon-btn customer-icon-btn--primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "保存中…" : isEdit ? "保存" : "创建实例"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  onSelect,
  onCreate,
  onConfigure,
}: {
  workspaces: CsWorkspace[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onConfigure: (id: string) => void;
}) {
  return (
    <section>
      <div className="customer-ws-head">
        <p className="customer-section-title">客服实例</p>
        <button type="button" className="customer-ws-add" onClick={onCreate} title="新建实例">
          <Plus size={14} />
        </button>
      </div>
      <div className="customer-ws-list">
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className={`customer-ws-item${ws.id === activeId ? " is-active" : ""}`}
          >
            <button
              type="button"
              className="customer-ws-item__main"
              onClick={() => onSelect(ws.id)}
            >
              <span className="customer-ws-item__icon" aria-hidden>
                {ws.icon || "✦"}
              </span>
              <span className="customer-ws-item__text">
                <strong>{ws.name}</strong>
                <span>
                  {ws.domain || "通用"}
                  {(ws.faq_item_count ?? 0) > 0 ? ` · ${ws.faq_item_count} 条 FAQ` : ""}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="customer-ws-item__cfg"
              aria-label={`配置 ${ws.name}`}
              onClick={() => onConfigure(ws.id)}
            >
              <Settings2 size={14} />
            </button>
          </div>
        ))}
        {workspaces.length === 0 && (
          <button type="button" className="customer-ws-empty" onClick={onCreate}>
            <Plus size={16} />
            创建第一个客服实例
          </button>
        )}
      </div>
    </section>
  );
}
