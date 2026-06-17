import type { NextRequest } from "next/server";

import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

/**
 * Proxy AI customer service API to the main FastAPI backend.
 * SSE must use Route Handler body passthrough — do not use next.config rewrites.
 */

export function getAiCustomerServiceBaseUrl(): string {
  return getBackendBaseUrl();
}

export function forwardProxyRequestHeaders(req: NextRequest): Headers {
  const h = new Headers();
  const allow = ["content-type", "accept", "authorization", "cookie"] as const;
  for (const name of allow) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
  req.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith("x-")) {
      h.set(key, value);
    }
  });
  return h;
}

export function applyStreamPassthroughHeaders(upstream: Headers): Headers {
  const headers = new Headers(upstream);
  const ct = headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream") || ct.includes("event-stream")) {
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("Connection", "keep-alive");
    headers.set("X-Accel-Buffering", "no");
    headers.set("Content-Encoding", "identity");
    headers.delete("content-length");
  }
  return headers;
}

async function requestBodyBuffer(
  req: NextRequest,
): Promise<BodyInit | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const buf = await req.arrayBuffer();
  return buf.byteLength > 0 ? buf : undefined;
}

export async function proxyToAiCustomerBackend(
  req: NextRequest,
  segments: string[] | undefined,
): Promise<Response> {
  const backend = getAiCustomerServiceBaseUrl();
  const suffix = segments?.length ? `/${segments.join("/")}` : "";
  const target = `${backend}/api/v1/ai-customer-service${suffix}${req.nextUrl.search}`;

  const body = await requestBodyBuffer(req);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: forwardProxyRequestHeaders(req),
      body,
      signal: req.signal,
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const payload = JSON.stringify({
      error:
        "无法连接 AI 客服后端。请确认主项目后端已启动（默认 http://127.0.0.1:8000），或检查 BACKEND_URL 配置。",
      detail: msg,
      upstream: target,
    });
    return new Response(payload, {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const ctIn = upstream.headers.get("content-type") ?? "";
  const isEventStream =
    ctIn.includes("text/event-stream") || ctIn.includes("event-stream");

  if (isEventStream && upstream.body) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: applyStreamPassthroughHeaders(upstream.headers),
    });
  }

  const buf = await upstream.arrayBuffer();
  const headersOut = applyStreamPassthroughHeaders(upstream.headers);
  headersOut.delete("transfer-encoding");
  if (buf.byteLength > 0 && !headersOut.has("content-length")) {
    headersOut.set("content-length", String(buf.byteLength));
  }
  return new Response(buf, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: headersOut,
  });
}
