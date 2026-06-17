"use client";

import { useCallback, useState } from "react";

export type GitProgressFn = (content: string) => void;

type GitActionResult = {
  ok: boolean;
  message: string;
};

type AutoCommitPayload = {
  ok: boolean;
  message?: string;
  source?: string;
  commit?: string;
  branch?: string;
  stagedCount?: number;
  blocked?: string[];
  pushed?: boolean;
  push?: { remote?: string; branch?: string; setUpstream?: boolean };
  analysis?: { fileCount?: number; files?: string[]; stat?: string };
  error?: string;
};

type SuggestPayload = {
  ok: boolean;
  message?: string;
  source?: string;
  fileCount?: number;
  files?: string[];
  blocked?: string[];
  branch?: string;
  error?: string;
};

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(String((data as { error?: string }).error || `HTTP ${res.status}`));
  }
  return data;
}

function formatAutoResult(data: AutoCommitPayload, pushed: boolean): string {
  const lines = [
    "## 自动提交" + (pushed ? "并推送" : ""),
    "",
    `- **说明**: \`${data.message}\``,
    `- **来源**: ${data.source === "llm" ? "AI 分析" : data.source === "heuristic" ? "规则归纳" : "手动"}`,
  ];
  if (data.commit) lines.push(`- **提交**: \`${data.commit}\` · \`${data.branch}\``);
  if (data.stagedCount != null) lines.push(`- **文件数**: ${data.stagedCount}`);
  if (data.analysis?.files?.length) {
    lines.push(
      `- **变更**: ${data.analysis.files.slice(0, 8).join(", ")}${(data.analysis.fileCount || 0) > 8 ? " …" : ""}`,
    );
  }
  if (data.blocked?.length) {
    lines.push(`- **已跳过**: ${data.blocked.join(", ")}`);
  }
  if (pushed && data.push?.remote) {
    const upstream = data.push.setUpstream ? "（已设置 upstream）" : "";
    lines.push(`- **推送**: \`${data.push.remote}/${data.push.branch}\`${upstream}`);
  }
  return lines.join("\n");
}

function mapGitError(err: string): string {
  if (err === "nothing_to_commit") return "没有可提交的变更。";
  if (err === "only_blocked_files") return "变更均为敏感文件（如 .env / 密钥），已拒绝提交。";
  if (err === "not_a_git_repository") return "当前目录不是 Git 仓库。";
  return err;
}

function progressLine(done: string, pending?: string): string {
  return pending ? `${done}\n\n⏳ ${pending}` : done;
}

export function useGitActions(workspaceRoot: string | null) {
  const [busy, setBusy] = useState(false);

  const autoCommit = useCallback(
    async (
      opts?: { hint?: string; message?: string; push?: boolean; onProgress?: GitProgressFn },
    ): Promise<GitActionResult> => {
      const root = workspaceRoot?.trim();
      if (!root) return { ok: false, message: "未绑定工作区，无法提交。" };

      const onProgress = opts?.onProgress;
      setBusy(true);
      try {
        onProgress?.("⏳ 扫描工作区变更…");

        let message = opts?.message?.trim() || "";
        let source = "user";
        let fileCount = 0;
        let files: string[] = [];
        let blocked: string[] = [];
        let branch = "";

        if (!message) {
          onProgress?.("⏳ 分析 diff，生成提交说明…");
          const suggested = await postJson<SuggestPayload>(
            "/api/workspace/git/suggest-message",
            { root, hint: opts?.hint?.trim() || "" },
          );
          message = suggested.message || "";
          source = suggested.source || "heuristic";
          fileCount = suggested.fileCount || 0;
          files = suggested.files || [];
          blocked = suggested.blocked || [];
          branch = suggested.branch || "";
          onProgress?.(
            progressLine(
              `✅ 提交说明：\`${message}\`（${source === "llm" ? "AI" : "规则"} · ${fileCount} 个文件）`,
              "正在提交…",
            ),
          );
        } else {
          onProgress?.(progressLine(`✅ 使用提交说明：\`${message}\``, "正在提交…"));
        }

        const commitData = await postJson<{
          ok: boolean;
          commit?: string;
          branch?: string;
          stagedCount?: number;
          blocked?: string[];
        }>("/api/workspace/git/commit", { root, message });

        branch = commitData.branch || branch;
        blocked = commitData.blocked || blocked;
        const stagedCount = commitData.stagedCount ?? fileCount;

        if (!opts?.push) {
          const result = formatAutoResult(
            {
              ok: true,
              message,
              source,
              commit: commitData.commit,
              branch,
              stagedCount,
              blocked,
              analysis: { fileCount: stagedCount, files },
            },
            false,
          );
          onProgress?.(result);
          return { ok: true, message: result };
        }

        onProgress?.(
          progressLine(
            `✅ 已提交 \`${commitData.commit}\` 到 \`${branch}\`（${stagedCount} 个文件）`,
            "正在推送到远程…",
          ),
        );

        const pushData = await postJson<{
          ok: boolean;
          remote?: string;
          branch?: string;
          setUpstream?: boolean;
        }>("/api/workspace/git/push", { root });

        const upstream = pushData.setUpstream ? "（已设置 upstream）" : "";
        const result = formatAutoResult(
          {
            ok: true,
            message,
            source,
            commit: commitData.commit,
            branch,
            stagedCount,
            blocked,
            pushed: true,
            push: pushData,
            analysis: { fileCount: stagedCount, files },
          },
          true,
        );
        onProgress?.(result);
        return { ok: true, message: result };
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e);
        const msg = `❌ 自动提交失败：${mapGitError(err)}`;
        onProgress?.(msg);
        return { ok: false, message: msg };
      } finally {
        setBusy(false);
      }
    },
    [workspaceRoot],
  );

  const commit = useCallback(
    async (
      message: string,
      opts?: { asHint?: boolean; onProgress?: GitProgressFn },
    ): Promise<GitActionResult> => {
      const root = workspaceRoot?.trim();
      if (!root) return { ok: false, message: "未绑定工作区，无法提交。" };
      const text = message.trim();
      if (!text || opts?.asHint) {
        return autoCommit({ hint: text, push: false, onProgress: opts?.onProgress });
      }

      setBusy(true);
      try {
        opts?.onProgress?.(progressLine(`✅ 提交说明：\`${text}\``, "正在提交…"));
        const data = await postJson<{
          ok: boolean;
          commit?: string;
          branch?: string;
          stagedCount?: number;
          blocked?: string[];
        }>("/api/workspace/git/commit", { root, message: text });

        const blocked =
          data.blocked?.length ? `\n已跳过敏感文件：${data.blocked.join(", ")}` : "";
        const msg = `已提交 \`${data.commit}\` 到 \`${data.branch}\`（${data.stagedCount} 个文件）。${blocked}`;
        opts?.onProgress?.(msg);
        return { ok: true, message: msg };
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e);
        const msg = `提交失败：${mapGitError(err)}`;
        opts?.onProgress?.(msg);
        return { ok: false, message: msg };
      } finally {
        setBusy(false);
      }
    },
    [autoCommit, workspaceRoot],
  );

  const push = useCallback(
    async (remote?: string, onProgress?: GitProgressFn): Promise<GitActionResult> => {
      const root = workspaceRoot?.trim();
      if (!root) return { ok: false, message: "未绑定工作区，无法推送。" };

      setBusy(true);
      try {
        onProgress?.("⏳ 正在推送到远程…");
        const data = await postJson<{
          ok: boolean;
          remote?: string;
          branch?: string;
          setUpstream?: boolean;
        }>("/api/workspace/git/push", {
          root,
          ...(remote?.trim() ? { remote: remote.trim() } : {}),
        });

        const upstream = data.setUpstream ? "（已设置 upstream）" : "";
        const msg = `已推送到 \`${data.remote}/${data.branch}\`${upstream}`;
        onProgress?.(msg);
        return { ok: true, message: msg };
      } catch (e: unknown) {
        const msg = `推送失败：${e instanceof Error ? e.message : String(e)}`;
        onProgress?.(msg);
        return { ok: false, message: msg };
      } finally {
        setBusy(false);
      }
    },
    [workspaceRoot],
  );

  const commitAndPush = useCallback(
    async (
      message: string,
      opts?: { asHint?: boolean; onProgress?: GitProgressFn },
    ): Promise<GitActionResult> => {
      const text = message.trim();
      if (!text || opts?.asHint) {
        return autoCommit({ hint: text, push: true, onProgress: opts?.onProgress });
      }

      const commitRes = await commit(text, { onProgress: opts?.onProgress });
      if (!commitRes.ok) return commitRes;
      const pushRes = await push(undefined, opts?.onProgress);
      if (!pushRes.ok) {
        return {
          ok: false,
          message: `${commitRes.message}\n\n提交成功但推送失败：${pushRes.message}`,
        };
      }
      const msg = `${commitRes.message}\n\n${pushRes.message}`;
      opts?.onProgress?.(msg);
      return { ok: true, message: msg };
    },
    [autoCommit, commit, push],
  );

  return { busy, commit, push, commitAndPush, autoCommit };
}
