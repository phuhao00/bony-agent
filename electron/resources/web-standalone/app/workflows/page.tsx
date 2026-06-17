"use client";

import { WorkflowSummary } from "@/types/workflow";
import {
  applyWorkflowDisplayTitle,
  removeWorkflowFromRecents,
} from "@/lib/sidebar-recents";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const DEFAULT_WORKFLOW_NAME = "新工作流";

function WorkflowNameDialog({
  title,
  initialName,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  initialName: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialName);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  const submit = () => {
    const n = value.trim() || DEFAULT_WORKFLOW_NAME;
    onConfirm(n);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wf-name-dialog-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="card-surface w-full max-w-md rounded-2xl border border-[var(--separator-subtle)] shadow-xl p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2
          id="wf-name-dialog-title"
          className="text-[15px] font-semibold text-[var(--foreground)] mb-1"
        >
          {title}
        </h2>
        <p className="text-[12px] text-[var(--label-secondary)] mb-4">
          可随时在编辑器顶部再次修改名称。
        </p>
        <label className="sr-only" htmlFor="wf-name-input">
          工作流名称
        </label>
        <input
          ref={inputRef}
          id="wf-name-input"
          type="text"
          maxLength={120}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={DEFAULT_WORKFLOW_NAME}
          className="w-full rounded-xl border border-[var(--separator-subtle)] bg-[var(--background)] px-3 py-2.5 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--accent)] mb-4"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="text-[12px] font-medium px-4 py-2 rounded-xl border border-[var(--separator-subtle)] text-[var(--label-secondary)] hover:bg-[var(--separator-subtle)]/60 disabled:opacity-40 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="text-[12px] font-semibold px-4 py-2 rounded-xl bg-[#ff9500] hover:bg-[#e08600] text-black disabled:opacity-40 transition-colors"
          >
            {busy ? "保存中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WorkflowSummary | null>(
    null,
  );
  const [renameBusy, setRenameBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const resp = await fetch("/api/workflows");
      const { workflows: list } = await resp.json();
      setWorkflows(list ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("确定要删除这个工作流吗？")) return;
    setDeleting(id);
    try {
      const resp = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
      if (resp.ok) {
        removeWorkflowFromRecents(id);
      }
      await load();
    } finally {
      setDeleting(null);
    }
  }

  function handleOpenCreate() {
    setCreateOpen(true);
  }

  function confirmCreate(name: string) {
    setCreateOpen(false);
    router.push(
      `/workflows/new?name=${encodeURIComponent(name)}`,
    );
  }

  async function confirmRename(name: string) {
    if (!renameTarget) return;
    setRenameBusy(true);
    try {
      const resp = await fetch(`/api/workflows/${renameTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!resp.ok) {
        let msg = `保存失败 (${resp.status})`;
        try {
          const body = await resp.json();
          msg =
            (body as { error?: string; detail?: string }).error ??
            (body as { detail?: string }).detail ??
            msg;
        } catch {
          /* noop */
        }
        alert(msg);
        return;
      }
      setRenameTarget(null);
      applyWorkflowDisplayTitle(renameTarget.id, name.trim() || DEFAULT_WORKFLOW_NAME);
      await load();
    } finally {
      setRenameBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-8">
      {createOpen ? (
        <WorkflowNameDialog
          key="create-workflow"
          title="命名工作流"
          initialName={DEFAULT_WORKFLOW_NAME}
          confirmLabel="创建并编排"
          onConfirm={confirmCreate}
          onCancel={() => setCreateOpen(false)}
        />
      ) : null}
      {renameTarget ? (
        <WorkflowNameDialog
          key={`rename-${renameTarget.id}`}
          title="重命名工作流"
          initialName={renameTarget.name}
          confirmLabel="保存名称"
          busy={renameBusy}
          onConfirm={confirmRename}
          onCancel={() => !renameBusy && setRenameTarget(null)}
        />
      ) : null}

      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-[22px] font-bold text-[var(--foreground)]">
              工作流
            </h1>
            <p className="text-[13px] text-[var(--label-secondary)] mt-1">
              可视化编排 AI 内容生产流程
            </p>
          </div>
          <button
            onClick={handleOpenCreate}
            className="bg-[#ff9500] hover:bg-[#e08600] text-black text-[12px] font-bold px-4 py-2 rounded-xl transition-colors flex items-center gap-2"
          >
            <span>+</span> 新建工作流
          </button>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="card-surface rounded-2xl animate-pulse h-36"
              />
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-5xl mb-4">⚡</div>
            <h2 className="text-[17px] font-semibold text-[var(--label-secondary)] mb-2">
              还没有工作流
            </h2>
            <p className="text-[13px] text-[var(--label-secondary)] opacity-70 mb-6">
              创建第一个工作流，开始自动化内容生产
            </p>
            <button
              onClick={handleOpenCreate}
              className="bg-[#ff9500] hover:bg-[#e08600] text-black text-[12px] font-bold px-5 py-2.5 rounded-xl transition-colors"
            >
              立即创建
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {workflows.map((wf) => (
              <WorkflowCard
                key={wf.id}
                workflow={wf}
                onDelete={handleDelete}
                onRename={() => setRenameTarget(wf)}
                isDeleting={deleting === wf.id}
              />
            ))}
            {/* New card */}
            <button
              onClick={handleOpenCreate}
              className="flex flex-col items-center justify-center gap-3
                         bg-transparent border-2 border-dashed border-[var(--separator-subtle)]
                         hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/[0.04]
                         rounded-2xl p-6 transition-colors group min-h-[140px]"
            >
              <span className="text-3xl text-[var(--foreground)] opacity-20 group-hover:opacity-100 group-hover:text-[var(--accent)] transition-all">
                +
              </span>
              <span className="text-[12px] text-[var(--label-secondary)] group-hover:text-[var(--accent)]/70 transition-colors">
                新建工作流
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowCard({
  workflow,
  onDelete,
  onRename,
  isDeleting,
}: {
  workflow: WorkflowSummary;
  onDelete: (id: string) => void;
  onRename: () => void;
  isDeleting: boolean;
}) {
  const updatedAt = new Date(workflow.updated_at * 1000).toLocaleDateString(
    "zh-CN",
    {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  return (
    <div className="card-surface rounded-2xl hover:border-[var(--separator)] transition-all overflow-hidden group">
      <Link href={`/workflows/${workflow.id}`} className="block p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-xl flex items-center justify-center text-xl shrink-0">
            ⚡
          </div>
          <span className="text-[10px] text-[var(--label-secondary)] bg-[var(--separator-subtle)] border border-[var(--separator-subtle)] px-2 py-0.5 rounded-full">
            {workflow.node_count} 个节点
          </span>
        </div>
        <h3 className="font-semibold text-[var(--foreground)] text-[13px] line-clamp-1 mb-1">
          {workflow.name}
        </h3>
        {workflow.description && (
          <p className="text-[11px] text-[var(--label-secondary)] line-clamp-2 mb-3">
            {workflow.description}
          </p>
        )}
        <p className="text-[10px] text-[var(--label-secondary)] opacity-60">
          更新于 {updatedAt}
        </p>
      </Link>

      {/* Actions */}
      <div className="flex border-t border-[var(--separator-subtle)] divide-x divide-[var(--separator-subtle)]">
        <Link
          href={`/workflows/${workflow.id}`}
          className="flex-1 text-center text-[11px] text-[var(--label-secondary)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/[0.05] py-2 transition-colors"
        >
          编辑
        </Link>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRename();
          }}
          className="flex-1 text-[11px] text-[var(--label-secondary)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/[0.05] py-2 transition-colors"
        >
          重命名
        </button>
        <button
          type="button"
          onClick={() => onDelete(workflow.id)}
          disabled={isDeleting}
          className="flex-1 text-[11px] text-[var(--label-secondary)] hover:text-red-500 hover:bg-red-500/[0.06] py-2 transition-colors disabled:opacity-40"
        >
          {isDeleting ? "删除中…" : "删除"}
        </button>
      </div>
    </div>
  );
}
