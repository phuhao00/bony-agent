import { NextRequest } from "next/server";
import { spawn } from "node:child_process";

import {
  getLarkCliChildEnv,
  getLarkCliExecutable,
} from "@/lib/server/lark-cli-env";

export const runtime = "nodejs";

// Shared tokenizer (same logic as main route)
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
  const tokens = tokenizeArgs(trimmed);
  if (tokens[0] === "lark-cli") return tokens.slice(1);
  return tokens;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { command?: string; timeoutMs?: number };
  const { command = "", timeoutMs = 180000 } = body;

  const args = commandToArgs(command);
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    start(controller) {
      const child = spawn(getLarkCliExecutable(), args, {
        env: getLarkCliChildEnv(),
      });

      let killed = false;
      const timer = setTimeout(() => {
        if (!killed) {
          killed = true;
          child.kill();
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "timeout" })}\n\n`,
              ),
            );
          } catch {
            /* ignore */
          }
        }
      }, timeoutMs);

      const send = (data: object) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          /* ignore if stream already closed */
        }
      };

      child.stdout.on("data", (chunk: Buffer) =>
        send({ type: "stdout", text: chunk.toString() }),
      );
      child.stderr.on("data", (chunk: Buffer) =>
        send({ type: "stderr", text: chunk.toString() }),
      );

      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        send({ type: "exit", code: code ?? -1 });
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        send({ type: "error", text: err.message });
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
