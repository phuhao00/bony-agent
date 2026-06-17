import http from "http";
import https from "https";
import { Readable } from "stream";

import { NextRequest } from "next/server";

import type { AgentChatRequestBody } from "@/lib/agent-chat-types";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

export const runtime = "nodejs";
export const maxDuration = 800;

const LOG = "[api/agent/chat/stream]";

function postBackendSseStream(payload: AgentChatRequestBody, backendPath = "/agent/chat/stream") {
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
    req.on("error", reject);
    req.setTimeout(0);
    req.write(body, "utf8");
    req.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AgentChatRequestBody;
    if (
      !body.messages?.length &&
      !(typeof body.input === "string" && body.input.trim())
    ) {
      return new Response(
        JSON.stringify({ error: "Missing messages or input" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let resp = await postBackendSseStream(body);
    if (resp.status === 404) {
      console.warn(`${LOG} /agent/chat/stream 404 — falling back to /multi-agent/stream`);
      const lastUser = [...(body.messages || [])]
        .reverse()
        .find((m) => m.role === "user")?.content;
      const legacyPayload = {
        input: (body.input?.trim() || lastUser || "").trim(),
        agent_id: body.agent_id,
        messages:
          body.messages && body.messages.length > 0
            ? body.messages
            : lastUser || body.input?.trim()
              ? [{ role: "user", content: (body.input?.trim() || lastUser || "").trim() }]
              : [],
      };
      resp = await postBackendSseStream(
        legacyPayload as AgentChatRequestBody,
        "/multi-agent/stream",
      );
    }
    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => "Unknown error");
      return new Response(
        JSON.stringify({ error: `Backend error: ${resp.status}`, detail: errText }),
        { status: resp.status, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(resp.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    console.error(`${LOG} route_error`, error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
