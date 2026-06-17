import { NextRequest, NextResponse } from "next/server";

import { getBackendBaseUrl } from "@/lib/server/backend-proxy";

export const runtime = "nodejs";

/**
 * Generic backend API proxy for simple JSON routes.
 * Prefer dedicated routes for SSE uploads and special headers.
 * Existing per-path proxies remain for backward compatibility.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, ctx, "GET");
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, ctx, "POST");
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, ctx, "PUT");
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, ctx, "PATCH");
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return proxy(req, ctx, "DELETE");
}

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
  method: string,
) {
  const { path } = await ctx.params;
  const base = getBackendBaseUrl().replace(/\/$/, "");
  const suffix = path.join("/");
  const url = `${base}/${suffix}${req.nextUrl.search}`;

  const headers = new Headers();
  const auth = req.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const init: RequestInit = { method, headers, cache: "no-store" };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(url, init);
  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
    },
  });
}
