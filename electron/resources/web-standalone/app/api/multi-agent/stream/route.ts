import http from "http";
import https from "https";
import { Readable } from "stream";

import { NextRequest } from "next/server";

import type { AgentChatRequestBody } from "@/lib/agent-chat-types";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

export const runtime = "nodejs";

/**
 * Next 侧用 fetch(undici) 代理后端 SSE 时，默认约 300s 读 body 无数据会 UND_ERR_BODY_TIMEOUT。
 * 长视频等工具可能数分钟不吐分片 → 用原生 http(s).request（无 undici body 计时器）做流式转发。
 */

/** 部署在 Vercel 等环境时提高可执行上限（具体上限依套餐）；本地 dev 不限制 */
export const maxDuration = 800;

const LOG = "[api/multi-agent/stream]";

function postBackendSseStream(payload: AgentChatRequestBody, backendPath = "/multi-agent/stream") {
  const base = getBackendBaseUrl().replace(/\/$/, "");
  const url = new URL(`${base}${backendPath}`);
  const body = JSON.stringify(payload);

  return new Promise<Response>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Content-Length": Buffer.byteLength(body, "utf8"),
        },
        timeout: 0,
      },
      (incoming) => {
        console.info(`${LOG} upstream_headers`, {
          host: url.host,
          statusCode: incoming.statusCode,
        });
        const webStream = Readable.toWeb(incoming as Readable);
        resolve(
          new Response(webStream as BodyInit, {
            status: incoming.statusCode ?? 502,
            statusText: incoming.statusMessage,
            headers: {
              "Content-Type":
                (incoming.headers["content-type"] as string) ||
                "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          }),
        );
      },
    );
    req.on("error", (err: Error) => {
      console.error(`${LOG} upstream_request_error`, err);
      reject(err);
    });
    req.setTimeout(0);
    req.write(body, "utf8");
    req.end();
  });
}

function normalizePayload(body: Record<string, unknown>): AgentChatRequestBody | null {
  const messages = Array.isArray(body.messages)
    ? (body.messages as AgentChatRequestBody["messages"])
    : undefined;
  const input = typeof body.input === "string" ? body.input.trim() : "";
  const lastUser = [...(messages || [])]
    .reverse()
    .find((m) => m?.role === "user" && typeof m.content === "string" && m.content.trim())
    ?.content?.trim();

  const resolvedInput = input || lastUser || "";
  if (!resolvedInput && !(messages && messages.length > 0)) {
    return null;
  }

  return {
    input: resolvedInput || undefined,
    messages:
      messages && messages.length > 0
        ? messages
        : resolvedInput
          ? [{ role: "user", content: resolvedInput }]
          : [],
    agent_id: typeof body.agent_id === "string" ? body.agent_id : undefined,
    preferences: body.preferences as AgentChatRequestBody["preferences"],
    workspace_context: body.workspace_context as AgentChatRequestBody["workspace_context"],
    thread_id: typeof body.thread_id === "string" ? body.thread_id : undefined,
    mode: "multi",
    stream: true,
  };
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const payload = normalizePayload(body);

    if (!payload) {
      return new Response(JSON.stringify({ error: "Missing 'input' or messages" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.info(`${LOG} inbound`, {
      inputLen: payload.input?.length ?? 0,
      messageCount: payload.messages?.length ?? 0,
      agent_id: payload.agent_id ?? null,
    });

    let resp = await postBackendSseStream(payload, "/agent/chat/stream");
    if (resp.status === 404) {
      console.warn(`${LOG} /agent/chat/stream 404 — falling back to /multi-agent/stream`);
      resp = await postBackendSseStream(
        {
          input: payload.input,
          agent_id: payload.agent_id,
          messages: payload.messages,
        },
        "/multi-agent/stream",
      );
    }

    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => "Unknown error");
      console.warn(`${LOG} backend_not_ok`, {
        status: resp.status,
        ms: Date.now() - t0,
        detailPreview: errText.slice(0, 200),
      });
      return new Response(
        JSON.stringify({
          error: `Backend error: ${resp.status}`,
          detail: errText,
        }),
        {
          status: resp.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    console.info(`${LOG} piping_sse`, {
      status: resp.status,
      ms_to_stream: Date.now() - t0,
    });

    return new Response(resp.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    console.error(`${LOG} route_error`, {
      ms: Date.now() - t0,
      message: error instanceof Error ? error.message : String(error),
    });
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
