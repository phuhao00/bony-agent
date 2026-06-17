import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

const base = () => getBackendBaseUrl().replace(/\/$/, "");

type Params = { params: Promise<{ workflowId: string }> };

async function safeFetch(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const text = await resp.text().catch(() => "");
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || "Empty response" };
  }
  return { data, status: resp.status };
}

// GET /api/workflows/[workflowId]
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { workflowId } = await params;
    const { data, status } = await safeFetch(
      `${base()}/workflows/${workflowId}`,
      { cache: "no-store" },
    );
    return NextResponse.json(data, { status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

// PUT /api/workflows/[workflowId]
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { workflowId } = await params;
    const body = await req.json();
    const { data, status } = await safeFetch(
      `${base()}/workflows/${workflowId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return NextResponse.json(data, { status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

// DELETE /api/workflows/[workflowId]
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { workflowId } = await params;
    const { data, status } = await safeFetch(
      `${base()}/workflows/${workflowId}`,
      { method: "DELETE" },
    );
    return NextResponse.json(data, { status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
