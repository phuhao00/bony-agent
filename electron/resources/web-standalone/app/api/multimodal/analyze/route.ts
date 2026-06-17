import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * POST /api/multimodal/analyze
 * 代理到后端 POST /multimodal/analyze
 * 接受 multipart/form-data: file + task_type + options
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const res = await fetch(`${BACKEND}/multimodal/analyze`, {
      method: "POST",
      body: formData,
      // Note: do NOT set Content-Type — fetch sets it with correct boundary
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      return NextResponse.json(err, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
