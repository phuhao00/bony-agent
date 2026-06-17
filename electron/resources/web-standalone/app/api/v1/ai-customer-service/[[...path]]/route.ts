import type { NextRequest } from "next/server";

import { proxyToAiCustomerBackend } from "@/lib/proxy-ai-customer-upstream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type RouteCtx = { params: Promise<{ path?: string[] }> };

async function handle(req: NextRequest, ctx: RouteCtx) {
  const { path } = await ctx.params;
  return proxyToAiCustomerBackend(req, path);
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx);
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { Allow: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
  });
}
