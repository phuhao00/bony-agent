import http from "http";
import https from "https";
import { Readable } from "stream";

import { NextRequest } from "next/server";
import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

export const runtime = "nodejs";
export const maxDuration = 800;

function postBackendSseStream(body: Record<string, unknown>) {
  const base = getBackendBaseUrl().replace(/\/$/, "");
  const url = new URL(`${base}/claude-code/stream`);
  const payload = JSON.stringify(body);

  return new Promise<Response>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Content-Length": Buffer.byteLength(payload, "utf8"),
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
    req.write(payload, "utf8");
    req.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt 不能为空" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const resp = await postBackendSseStream(body);
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
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
