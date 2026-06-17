"use client";

import { useTranslation } from "@/hooks/useTranslation";
import {
  ChevronLeft,
  FileText,
  Folder,
  Loader2,
  Paperclip,
} from "lucide-react";
import { useEffect, useState } from "react";

const FILES_MAX_ENTRIES = 400;

type FileListEntry = { name: string; kind: "dir" | "file"; relPath: string };

function parentRelPath(rel: string): string {
  const parts = rel.split(/[/\\]/).filter(Boolean);
  parts.pop();
  return parts.join("/");
}

type ChatWorkspaceFilesPanelProps = {
  attachedPaths?: string[];
  onAttachPath?: (relPath: string) => void;
};

/** 右侧栏内嵌：工作区目录浏览（IDE 侧边栏样式，非下拉） */
export function ChatWorkspaceFilesPanel({
  attachedPaths = [],
  onAttachPath,
}: ChatWorkspaceFilesPanelProps) {
  const { t } = useTranslation();
  const [filesPath, setFilesPath] = useState("");
  const [filesEntries, setFilesEntries] = useState<FileListEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filesTruncated, setFilesTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFilesLoading(true);
    setFilesError(null);
    const q = new URLSearchParams();
    q.set("path", filesPath);
    void fetch(`/api/workspace/files?${q.toString()}`)
      .then(async (r) => {
        const data = (await r.json()) as {
          error?: string;
          entries?: FileListEntry[];
          truncated?: boolean;
        };
        if (!r.ok) throw new Error(data.error || `${r.status}`);
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setFilesEntries(Array.isArray(data.entries) ? data.entries : []);
        setFilesTruncated(!!data.truncated);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg =
          e instanceof Error ? e.message : t("chat.workspace.filesLoadError");
        setFilesError(msg);
        setFilesEntries([]);
        setFilesTruncated(false);
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filesPath, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-[color:var(--separator-subtle)] pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--label-secondary)]">
          {t("chat.workspace.filesHeading")}
        </p>
        {filesPath ? (
          <p className="mt-1 truncate font-mono text-[10px] text-[color:var(--label-secondary)]">
            {filesPath.replace(/\\/g, "/")}
          </p>
        ) : null}
      </div>
      {filesPath ? (
        <button
          type="button"
          onClick={() => setFilesPath(parentRelPath(filesPath))}
          className="mt-2 flex shrink-0 items-center gap-2 rounded-lg border border-[color:var(--separator-subtle)] px-3 py-2 text-left text-xs font-medium text-[color:var(--accent)] hover:bg-[var(--nav-active-fill)]"
        >
          <ChevronLeft
            className="h-4 w-4 shrink-0"
            strokeWidth={2}
            aria-hidden
          />
          {t("chat.workspace.filesParentDir")}
        </button>
      ) : null}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {filesLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-[color:var(--label-secondary)]">
            <Loader2
              className="h-5 w-5 shrink-0 animate-spin"
              strokeWidth={2}
              aria-hidden
            />
            <span className="text-xs">{t("chat.workspace.filesLoading")}</span>
          </div>
        ) : filesError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-3 text-xs text-red-600 dark:text-red-400">
            {filesError}
          </div>
        ) : filesEntries.length === 0 ? (
          <div className="py-8 text-center text-xs text-[color:var(--label-secondary)]">
            {t("chat.workspace.filesEmpty")}
          </div>
        ) : (
          <>
            <ul className="space-y-0.5" role="list">
              {filesEntries.map((e) =>
                e.kind === "dir" ? (
                  <li key={e.relPath}>
                    <button
                      type="button"
                      title={e.relPath}
                      onClick={() => setFilesPath(e.relPath)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[color:var(--foreground)] hover:bg-[var(--nav-active-fill)]"
                    >
                      <Folder
                        className="h-4 w-4 shrink-0 text-[color:var(--accent)]"
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {e.name}
                      </span>
                    </button>
                  </li>
                ) : (
                  <li key={e.relPath}>
                    <div
                      className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[color:var(--foreground)] ${
                        attachedPaths.includes(e.relPath)
                          ? "bg-[var(--nav-active-fill)] ring-1 ring-[color:color-mix(in_srgb,var(--accent)_35%,transparent)]"
                          : "hover:bg-[var(--nav-active-fill)]"
                      }`}
                      title={e.relPath}
                    >
                      <FileText
                        className="h-4 w-4 shrink-0 text-[color:var(--label-secondary)]"
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {e.name}
                      </span>
                      {onAttachPath ? (
                        <button
                          type="button"
                          onClick={() => onAttachPath(e.relPath)}
                          className="shrink-0 rounded p-1 text-[color:var(--accent)] opacity-70 transition-opacity hover:opacity-100 group-hover:opacity-100"
                          title={t("chat.workspace.filesAttach")}
                          aria-label={t("chat.workspace.filesAttachAria", {
                            path: e.relPath,
                          })}
                        >
                          <Paperclip
                            className="h-3.5 w-3.5"
                            strokeWidth={2}
                            aria-hidden
                          />
                        </button>
                      ) : null}
                    </div>
                  </li>
                ),
              )}
            </ul>
            {filesTruncated ? (
              <div className="mt-4 border-t border-[color:var(--separator-subtle)] pt-3 text-[10px] text-[color:var(--label-secondary)]">
                {t("chat.workspace.filesTruncated", {
                  max: String(FILES_MAX_ENTRIES),
                })}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
