import { NextRequest, NextResponse } from "next/server";
import { fetchBackend, getBackendBaseUrl } from "@/lib/server/backend-proxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const res = await fetchBackend(`/users/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: request.headers.get("authorization") || "",
        Accept: "application/json",
      },
    }, { retries: 4, timeoutMs: 30000 });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Backend unreachable";
    console.error("[api/users/:id GET] proxy error:", msg);
    return NextResponse.json(
      { detail: `无法连接后端 (${getBackendBaseUrl()})。请确认 FastAPI 已在 8000 端口运行。` },
      { status: 502 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await request.text();
    const res = await fetchBackend(`/users/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        Authorization: request.headers.get("authorization") || "",
        "Content-Type": request.headers.get("content-type") || "application/json",
      },
      body: body || undefined,
    }, { retries: 4, timeoutMs: 30000 });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Backend unreachable";
    console.error("[api/users/:id PUT] proxy error:", msg);
    return NextResponse.json(
      { detail: `无法连接后端 (${getBackendBaseUrl()})。请确认 FastAPI 已在 8000 端口运行。` },
      { status: 502 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const res = await fetchBackend(`/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {
        Authorization: request.headers.get("authorization") || "",
        Accept: "application/json",
      },
    }, { retries: 4, timeoutMs: 30000 });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Backend unreachable";
    console.error("[api/users/:id DELETE] proxy error:", msg);
    return NextResponse.json(
      { detail: `无法连接后端 (${getBackendBaseUrl()})。请确认 FastAPI 已在 8000 端口运行。` },
      { status: 502 },
    );
  }
}
