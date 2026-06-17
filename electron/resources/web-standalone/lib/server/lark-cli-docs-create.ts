import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  getLarkCliChildEnv,
  getLarkCliExecutable,
} from "@/lib/server/lark-cli-env";

const execFileAsync = promisify(execFile);

export type LarkDocCreateResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

/** 传给飞书前整理 Markdown，确保标题/列表分段。 */
export function prepareFeishuMarkdown(markdown: string): string {
  let text = markdown.replace(/\r\n/g, "\n").trim();
  if (!text) return text;
  text = text.replace(/\n(#{1,6}\s)/g, "\n\n$1");
  text = text.replace(/([^\n])\n([-*]\s)/g, "$1\n\n$2");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}

export async function createLarkDocFromMarkdown(
  title: string,
  markdown: string,
  timeoutMs = 90000,
): Promise<LarkDocCreateResult> {
  const startedAt = Date.now();
  const body = prepareFeishuMarkdown(markdown);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lark-doc-"));
  const mdPath = path.join(tmpDir, "body.md");
  const args = [
    "docs",
    "+create",
    "--title",
    title,
    "--markdown",
    "@body.md",
  ];

  try {
    await fs.writeFile(mdPath, body, "utf8");
    const { stdout, stderr } = await execFileAsync(
      getLarkCliExecutable(),
      args,
      {
        cwd: tmpDir,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 8,
        windowsHide: true,
        env: getLarkCliChildEnv(),
      },
    );
    return {
      command: `lark-cli ${args.join(" ")}`,
      exitCode: 0,
      stdout: stdout || "",
      stderr: stderr || "",
      durationMs: Date.now() - startedAt,
    };
  } catch (error: unknown) {
    const err = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      command: `lark-cli docs +create --title ${JSON.stringify(title)} --markdown @body.md`,
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout || "",
      stderr:
        err.code === "ENOENT"
          ? "未找到 lark-cli。请确认已安装并在 PATH 中。"
          : err.stderr || err.message || "执行失败",
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
