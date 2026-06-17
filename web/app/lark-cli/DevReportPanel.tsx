"use client";

import { MarkdownSummaryPreview } from "@/components/MarkdownSummaryPreview";
import { exportHtmlToDocx, exportHtmlToPdf } from "@/lib/larkSummaryExport";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  askReportAI,
  buildCommitsDigest,
  buildPolishSystemPrompt,
  buildReportSystemPrompt,
  computeReportRange,
  createFeishuDocViaApi,
  downloadMarkdownFile,
  type DevReportKind,
  type FeishuDocCreateResult,
  type GitCommitRecord,
  parseFeishuDocCreateCliOutput,
  formatGitApiError,
  parseRepoPathsInput,
  repoDisplayName,
  reportKindLabel,
  safeDownloadBasename,
  sanitizeReportMarkdown,
} from "./dev-report-utils";

type Props = {
  loading: boolean;
  setLoading: (v: boolean) => void;
};

type GitSummary = {
  gitAvailable: boolean;
  rootPath: string;
  projectLabel?: string;
  branch?: string | null;
};

function Card({
  children,
  className = "",
  fill = false,
}: {
  children: React.ReactNode;
  className?: string;
  fill?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border border-gray-100 bg-white p-5 shadow-sm ${
        fill ? "flex min-h-0 flex-1 flex-col" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  variant = "default",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "ghost";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : variant === "ghost"
        ? "text-gray-600 hover:bg-gray-100"
        : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50";
  return (
    <button
      type="button"
      className={`${base} ${styles} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

type ViewMode = "preview" | "source";

export default function DevReportPanel({
  loading,
  setLoading,
}: Props) {
  const [repoPathRows, setRepoPathRows] = useState<string[]>([""]);
  const [author, setAuthor] = useState("");
  const [authors, setAuthors] = useState<
    { name: string; email: string; label: string }[]
  >([]);
  const [reportKind, setReportKind] = useState<DevReportKind>("weekly");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [status, setStatus] = useState<{
    tone: "info" | "ok" | "err";
    title: string;
    body?: string;
  } | null>(null);
  const [reportMarkdown, setReportMarkdown] = useState("");
  const [reportBeforePolish, setReportBeforePolish] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const previewExportRef = useRef<HTMLDivElement>(null);
  const [commitPreview, setCommitPreview] = useState<GitCommitRecord[]>([]);
  const [gitSummary, setGitSummary] = useState<GitSummary | null>(null);
  const [feishuDocResult, setFeishuDocResult] =
    useState<FeishuDocCreateResult | null>(null);

  const repoPaths = useMemo(
    () => [...new Set(repoPathRows.map((p) => p.trim()).filter(Boolean))],
    [repoPathRows],
  );
  const multiRepo = repoPaths.length > 1;

  const updateRepoPathRow = (index: number, value: string) => {
    setRepoPathRows((rows) =>
      rows.map((row, i) => (i === index ? value : row)),
    );
  };

  const commitRepoPathRow = (index: number, value: string) => {
    const parts = parseRepoPathsInput(value);
    if (parts.length <= 1) {
      updateRepoPathRow(index, value);
      return;
    }
    setRepoPathRows((rows) => {
      const next = [...rows];
      next[index] = parts[0];
      next.splice(index + 1, 0, ...parts.slice(1));
      return next;
    });
  };

  const addRepoPathRow = () => {
    setRepoPathRows((rows) => [...rows, ""]);
  };

  const removeRepoPathRow = (index: number) => {
    setRepoPathRows((rows) =>
      rows.length <= 1 ? [""] : rows.filter((_, i) => i !== index),
    );
  };

  const defaultDocTitle = useMemo(() => {
    const who = author.trim() || "开发者";
    const kind = reportKindLabel(reportKind);
    const date = new Date().toISOString().slice(0, 10);
    return `${who}-${kind}-${date}`;
  }, [author, reportKind]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/workspace/git/summary");
        const data = (await r.json()) as GitSummary;
        if (cancelled) return;
        setGitSummary(data);
        if (data.gitAvailable && data.rootPath) {
          setRepoPathRows((prev) => {
            const hasValue = prev.some((p) => p.trim());
            return hasValue ? prev : [data.rootPath];
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAuthors = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      for (const p of repoPaths) {
        q.append("repoPath", p);
      }
      const r = await fetch(`/api/workspace/git/authors?${q}`);
      const data = (await r.json()) as {
        authors?: { name: string; email: string; label: string }[];
        error?: string;
      };
      if (!r.ok) throw new Error(formatGitApiError(data.error || "加载作者失败"));
      setAuthors(data.authors || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ tone: "err", title: "无法加载提交者列表", body: msg });
    }
  }, [repoPaths]);

  useEffect(() => {
    void loadAuthors();
  }, [loadAuthors]);

  const fetchCommits = async (): Promise<GitCommitRecord[]> => {
    const who = author.trim();
    if (!who) throw new Error("请填写或选择提交者（姓名或邮箱，支持模糊匹配）");
    const range = computeReportRange(reportKind, customStart, customEnd);
    const q = new URLSearchParams({
      author: who,
      since: range.since,
      until: range.until,
      maxCount: "800",
    });
    for (const p of repoPaths) {
      q.append("repoPath", p);
    }
    const r = await fetch(`/api/workspace/git/commits?${q}`);
    const data = (await r.json()) as {
      commits?: GitCommitRecord[];
      total?: number;
      error?: string;
    };
    if (!r.ok) throw new Error(formatGitApiError(data.error || "读取 Git 提交失败"));
    return data.commits || [];
  };

  const runGenerate = async () => {
    if (loading) return;
    setLoading(true);
    setStatus({
      tone: "info",
      title: "正在读取 Git 提交…",
      body: "请稍候",
    });
    setReportMarkdown("");
    setReportBeforePolish("");
    try {
      const range = computeReportRange(reportKind, customStart, customEnd);
      const commits = await fetchCommits();
      setCommitPreview(commits);
      setStatus({
        tone: "info",
        title: `已读取 ${commits.length} 条提交，正在生成${reportKindLabel(reportKind)}…`,
      });
      const digest = buildCommitsDigest(commits);
      const repoLine =
        repoPaths.length > 0
          ? repoPaths.join("\n")
          : gitSummary?.rootPath || "（工作区根目录）";
      const userBlock = [
        `报告类型：${reportKindLabel(reportKind)}`,
        `时间范围：${range.label}`,
        `提交者筛选：${author.trim()}`,
        `仓库路径：${repoLine}`,
        "",
        digest,
      ].join("\n");
      const markdown = await askReportAI(buildReportSystemPrompt(reportKind), userBlock);
      if (!markdown.trim()) {
        throw new Error("模型未返回报告正文，请检查 LLM 配置后重试。");
      }
      setReportMarkdown(markdown);
      setDocTitle((prev) => prev.trim() || defaultDocTitle);
      setStatus({
        tone: "ok",
        title: `${reportKindLabel(reportKind)}已生成`,
        body: `共分析 ${commits.length} 条提交`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ tone: "err", title: "生成失败", body: msg });
    } finally {
      setLoading(false);
    }
  };

  const runPolish = async () => {
    if (loading || !reportMarkdown.trim()) return;
    setLoading(true);
    setStatus({ tone: "info", title: "正在润色报告…", body: "请稍候" });
    try {
      setReportBeforePolish(reportMarkdown);
      const polished = await askReportAI(
        buildPolishSystemPrompt(reportKind),
        [
          `报告类型：${reportKindLabel(reportKind)}`,
          "",
          "待润色正文：",
          reportMarkdown,
        ].join("\n"),
      );
      setReportMarkdown(sanitizeReportMarkdown(polished));
      setStatus({
        tone: "ok",
        title: "润色完成",
        body: "可继续编辑，或点「还原」恢复润色前版本",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setReportBeforePolish("");
      setStatus({ tone: "err", title: "润色失败", body: msg });
    } finally {
      setLoading(false);
    }
  };

  const runRestoreBeforePolish = () => {
    if (!reportBeforePolish.trim()) return;
    setReportMarkdown(reportBeforePolish);
    setReportBeforePolish("");
    setStatus({ tone: "ok", title: "已还原为润色前版本" });
  };

  const exportBasename = useMemo(
    () => safeDownloadBasename(docTitle.trim() || defaultDocTitle),
    [docTitle, defaultDocTitle],
  );

  const handleExportMarkdown = useCallback(() => {
    if (!reportMarkdown.trim()) return;
    downloadMarkdownFile(`${exportBasename}.md`, reportMarkdown);
  }, [exportBasename, reportMarkdown]);

  const handleExportPdf = useCallback(async () => {
    const el = previewExportRef.current;
    if (!el) {
      window.alert("预览区域尚未就绪，请切换到「预览」模式后重试。");
      return;
    }
    try {
      await exportHtmlToPdf(el, `${exportBasename}.pdf`, {
        documentTitle: docTitle.trim() || defaultDocTitle,
      });
    } catch (e) {
      console.error(e);
      window.alert("导出 PDF 失败，请重试。");
    }
  }, [defaultDocTitle, docTitle, exportBasename]);

  const handleExportWord = useCallback(async () => {
    const el = previewExportRef.current;
    if (!el) {
      window.alert("预览区域尚未就绪，请切换到「预览」模式后重试。");
      return;
    }
    try {
      await exportHtmlToDocx(el.innerHTML, {
        title: docTitle.trim() || defaultDocTitle,
        filename: `${exportBasename}.docx`,
      });
    } catch (e) {
      console.error(e);
      window.alert("导出 Word 失败，请重试。");
    }
  }, [defaultDocTitle, docTitle, exportBasename]);

  const runCreateDoc = async () => {
    const body = reportMarkdown.trim();
    if (!body) return;
    if (loading) return;
    if (body.includes("暂时没有生成文字")) {
      setStatus({
        tone: "err",
        title: "报告内容无效",
        body: "当前正文是占位提示而非真实报告，请先重新点击「生成报告」并确认预览区有内容后再保存。",
      });
      return;
    }
    const title = docTitle.trim() || defaultDocTitle;
    setLoading(true);
    setFeishuDocResult(null);
    setStatus({
      tone: "info",
      title: "正在创建飞书文档…",
      body: title,
    });
    try {
      const cli = await createFeishuDocViaApi(title, reportMarkdown);
      const parsed = parseFeishuDocCreateCliOutput(cli, title);
      setFeishuDocResult(parsed);
      if (!parsed.ok) {
        setStatus({
          tone: "err",
          title: parsed.message,
          body: parsed.detail,
        });
        return;
      }
      setStatus({
        tone: "ok",
        title: parsed.message,
        body: parsed.url ? parsed.url : parsed.detail,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ tone: "err", title: "创建飞书文档失败", body: msg });
    } finally {
      setLoading(false);
    }
  };

  const hasReport = Boolean(reportMarkdown);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div
        className={
          hasReport
            ? "flex shrink-0 flex-col gap-4 overflow-y-auto overscroll-contain"
            : "flex shrink-0 flex-col gap-4 overflow-y-auto"
        }
        style={hasReport ? { maxHeight: "min(42vh, 28rem)" } : undefined}
      >
      <Card className="shrink-0">
        <div className="mb-3 flex items-start gap-3">
          <span className="text-xl" aria-hidden>
            👩‍💻
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900">
              开发报告助手
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
              从本地 Git 仓库读取指定人员的提交记录，自动生成日报 / 周报 /
              月报。支持同时选择多个仓库，默认使用当前工作区根目录。
            </p>
          </div>
        </div>

        {gitSummary && (
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            {gitSummary.gitAvailable ? (
              <>
                仓库：<code className="text-slate-800">{gitSummary.rootPath}</code>
                {gitSummary.branch ? (
                  <>
                    {" "}
                    · 分支 <strong>{gitSummary.branch}</strong>
                  </>
                ) : null}
              </>
            ) : (
              <>当前路径不是 Git 仓库，请填写有效仓库路径。</>
            )}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="block sm:col-span-2">
            <span className="text-[11px] font-medium text-slate-600">
              仓库路径
              {repoPaths.length > 1 ? (
                <span className="ml-1 font-normal text-slate-400">
                  （{repoPaths.length} 个）
                </span>
              ) : null}
            </span>
            <div className="mt-1.5 space-y-2">
              {repoPathRows.map((rowPath, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={rowPath}
                    onChange={(e) => updateRepoPathRow(index, e.target.value)}
                    onBlur={(e) => commitRepoPathRow(index, e.target.value)}
                    disabled={loading}
                    placeholder="/Users/you/projects/my-repo"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  {repoPathRows.length > 1 ? (
                    <Btn
                      variant="ghost"
                      disabled={loading}
                      onClick={() => removeRepoPathRow(index)}
                      className="shrink-0 px-2"
                    >
                      移除
                    </Btn>
                  ) : null}
                </div>
              ))}
              <Btn
                variant="ghost"
                disabled={loading}
                onClick={addRepoPathRow}
                className="px-0 text-blue-600 hover:bg-transparent hover:text-blue-800"
              >
                + 添加仓库
              </Btn>
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              填写本机 Git 仓库绝对路径，一行一个；全部留空则使用上方工作区根目录。
            </p>
          </div>

          <label className="block sm:col-span-2">
            <span className="text-[11px] font-medium text-slate-600">
              提交者
            </span>
            <input
              list="dev-report-authors"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              disabled={loading}
              placeholder="姓名或邮箱，如 Zhang / user@company.com"
              className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <datalist id="dev-report-authors">
              {authors.map((a) => (
                <option key={a.label} value={a.name} />
              ))}
              {authors.map((a) => (
                <option key={`${a.label}-email`} value={a.email} />
              ))}
            </datalist>
            <p className="mt-1 text-[10px] text-slate-400">
              对应 git log --author，支持模糊匹配；可从下拉选择历史提交者。
            </p>
          </label>

          <div className="sm:col-span-2">
            <span className="text-[11px] font-medium text-slate-600">
              报告类型
            </span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {(
                [
                  ["daily", "日报"],
                  ["weekly", "周报"],
                  ["monthly", "月报"],
                  ["custom", "自定义"],
                ] as const
              ).map(([id, label]) => (
                <Btn
                  key={id}
                  variant={reportKind === id ? "primary" : "default"}
                  disabled={loading}
                  onClick={() => setReportKind(id)}
                >
                  {label}
                </Btn>
              ))}
            </div>
          </div>

          {reportKind === "custom" && (
            <>
              <label className="block">
                <span className="text-[11px] font-medium text-slate-600">
                  开始日期
                </span>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  disabled={loading}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-slate-600">
                  结束日期
                </span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  disabled={loading}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                />
              </label>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="primary" disabled={loading} onClick={() => void runGenerate()}>
            {loading ? "处理中…" : `生成${reportKindLabel(reportKind)}`}
          </Btn>
          <Btn variant="ghost" disabled={loading} onClick={() => void loadAuthors()}>
            刷新提交者列表
          </Btn>
        </div>
      </Card>

      {status && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs ${
            status.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : status.tone === "err"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-blue-200 bg-blue-50 text-blue-900"
          }`}
        >
          <p className="font-semibold">{status.title}</p>
          {status.body ? (
            <p className="mt-1 whitespace-pre-wrap opacity-90">{status.body}</p>
          ) : null}
        </div>
      )}

      {feishuDocResult?.ok && feishuDocResult.url ? (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <p className="text-xs font-semibold text-emerald-900">飞书文档链接</p>
          <p className="mt-1 text-[11px] text-emerald-800">{feishuDocResult.title}</p>
          <a
            href={feishuDocResult.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 break-all text-xs font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
          >
            {feishuDocResult.url}
          </a>
          <div className="mt-3">
            <Btn
              variant="primary"
              onClick={() => window.open(feishuDocResult.url, "_blank", "noopener,noreferrer")}
            >
              打开飞书文档
            </Btn>
          </div>
        </Card>
      ) : null}

      {commitPreview.length > 0 && (
        <Card>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            提交预览（{commitPreview.length} 条）
          </h4>
          <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px] text-slate-700">
            {commitPreview.slice(0, 30).map((c) => (
              <li key={`${c.repoPath || ""}:${c.hash}`} className="truncate">
                {multiRepo && c.repoPath ? (
                  <span className="mr-1 rounded bg-slate-200/80 px-1 text-[10px] text-slate-600">
                    {repoDisplayName(c.repoPath)}
                  </span>
                ) : null}
                <code className="text-slate-500">{c.shortHash}</code>{" "}
                {c.subject}
              </li>
            ))}
            {commitPreview.length > 30 && (
              <li className="text-slate-400">… 其余 {commitPreview.length - 30} 条已纳入报告</li>
            )}
          </ul>
        </Card>
      )}

      </div>

      {reportMarkdown && (
        <Card fill>
          <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-gray-900">报告预览</h4>
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-[11px]">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setViewMode("preview")}
                  className={`rounded-md px-2.5 py-1 font-medium transition ${
                    viewMode === "preview"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  预览
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setViewMode("source")}
                  className={`rounded-md px-2.5 py-1 font-medium transition ${
                    viewMode === "source"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  源码
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Btn
                variant="default"
                disabled={loading || !reportMarkdown.trim()}
                onClick={() => void runPolish()}
              >
                ✨ 一键润色
              </Btn>
              {reportBeforePolish.trim() ? (
                <Btn
                  variant="ghost"
                  disabled={loading}
                  onClick={runRestoreBeforePolish}
                >
                  还原
                </Btn>
              ) : null}
              <Btn
                variant="ghost"
                disabled={loading || !reportMarkdown.trim()}
                onClick={handleExportMarkdown}
              >
                导出 MD
              </Btn>
              <Btn
                variant="ghost"
                disabled={loading || !reportMarkdown.trim()}
                onClick={() => void handleExportPdf()}
              >
                导出 PDF
              </Btn>
              <Btn
                variant="ghost"
                disabled={loading || !reportMarkdown.trim()}
                onClick={() => void handleExportWord()}
              >
                导出 Word
              </Btn>
              <input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder={defaultDocTitle}
                className="min-w-[10rem] rounded-lg border border-slate-200 px-2 py-1 text-xs"
              />
              <Btn
                variant="primary"
                disabled={loading}
                onClick={() => void runCreateDoc()}
              >
                保存到飞书文档
              </Btn>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-100 bg-slate-50/80">
            <div
              ref={previewExportRef}
              className={`min-h-0 flex-1 overflow-y-auto break-words px-4 py-4 text-slate-900 [overflow-wrap:anywhere] ${
                viewMode === "preview" ? "" : "hidden"
              }`}
            >
              <MarkdownSummaryPreview markdown={reportMarkdown} />
            </div>
            {viewMode === "source" ? (
              <textarea
                value={reportMarkdown}
                onChange={(e) => setReportMarkdown(e.target.value)}
                disabled={loading}
                spellCheck={false}
                className="min-h-0 flex-1 w-full resize-none border-0 bg-transparent px-4 py-4 font-mono text-xs leading-relaxed text-slate-800 focus:outline-none focus:ring-0"
              />
            ) : null}
          </div>
        </Card>
      )}
    </div>
  );
}
