import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  getLarkCliChildEnv,
  getLarkCliExecutable,
} from "@/lib/server/lark-cli-env";
import { createLarkDocFromMarkdown } from "@/lib/server/lark-cli-docs-create";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_BUFFER = 1024 * 1024 * 4;

interface CliResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type ExecLikeError = {
  code?: number | string;
  stdout?: string;
  stderr?: string;
  message?: string;
};

function isExecLikeError(value: unknown): value is ExecLikeError {
  return typeof value === "object" && value !== null;
}

function tokenizeArgs(input: string): string[] {
  const matches =
    input.match(/"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'|\S+/g) || [];
  return matches.map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function commandToArgs(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) return [];

  if (trimmed === "help") return ["--help"];
  if (trimmed === "version") return ["--version"];

  const tokens = tokenizeArgs(trimmed);
  if (tokens[0] === "lark-cli") {
    return tokens.slice(1);
  }

  return tokens;
}

/** 设置环境变量 LARK_CLI_DEBUG=1 时，对拉群消息命令打印 stdout 头与长度，便于对照终端 */
function logLarkCliDebugIfEnabled(command: string, result: CliResult): void {
  if (process.env.LARK_CLI_DEBUG !== "1") return;
  if (!command.includes("+chat-messages-list")) return;
  console.info("[lark-cli-api][LARK_CLI_DEBUG][+chat-messages-list]", {
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutBytes: result.stdout.length,
    stderrBytes: result.stderr.length,
    stderrTail: result.stderr.trim().slice(-500),
    stdoutHead: result.stdout.slice(0, 2000),
  });
}

async function runLarkCli(
  command: string,
  timeoutMs: number,
): Promise<CliResult> {
  const args = commandToArgs(command);
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(
      getLarkCliExecutable(),
      args,
      {
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: getLarkCliChildEnv(),
      },
    );

    const okResult: CliResult = {
      command: `lark-cli ${args.join(" ")}`.trim(),
      exitCode: 0,
      stdout: stdout || "",
      stderr: stderr || "",
      durationMs: Date.now() - startedAt,
    };
    logLarkCliDebugIfEnabled(command, okResult);
    return okResult;
  } catch (error: unknown) {
    const err = isExecLikeError(error) ? error : {};
    const errResult: CliResult = {
      command: `lark-cli ${args.join(" ")}`.trim(),
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout || "",
      stderr:
        err.code === "ENOENT"
          ? "未找到 lark-cli。请确认已安装并在 PATH 中。"
          : err.stderr || err.message || "执行失败",
      durationMs: Date.now() - startedAt,
    };
    logLarkCliDebugIfEnabled(command, errResult);
    return errResult;
  }
}

export async function GET() {
  const [version, help] = await Promise.all([
    runLarkCli("--version", DEFAULT_TIMEOUT_MS),
    runLarkCli("--help", DEFAULT_TIMEOUT_MS),
  ]);

  return Response.json({
    ok: version.exitCode === 0,
    installed: version.exitCode === 0,
    version,
    help,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { command, commands, timeoutMs, docsCreate } = body as {
      command?: string;
      commands?: string[];
      timeoutMs?: number;
      docsCreate?: { title?: string; markdown?: string };
    };

    const effectiveTimeout =
      typeof timeoutMs === "number" && timeoutMs > 0
        ? Math.min(timeoutMs, 120000)
        : DEFAULT_TIMEOUT_MS;

    if (
      docsCreate &&
      typeof docsCreate.title === "string" &&
      typeof docsCreate.markdown === "string"
    ) {
      const result = await createLarkDocFromMarkdown(
        docsCreate.title,
        docsCreate.markdown,
        effectiveTimeout,
      );
      return Response.json({
        ok: result.exitCode === 0,
        result,
      });
    }

    if (Array.isArray(commands) && commands.length > 0) {
      const results: CliResult[] = [];
      for (const cmd of commands) {
        results.push(await runLarkCli(cmd, effectiveTimeout));
      }

      return Response.json({
        ok: results.every((r) => r.exitCode === 0),
        results,
      });
    }

    if (!command || typeof command !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing 'command' or 'commands'" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const result = await runLarkCli(command, effectiveTimeout);
    return Response.json({
      ok: result.exitCode === 0,
      result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
