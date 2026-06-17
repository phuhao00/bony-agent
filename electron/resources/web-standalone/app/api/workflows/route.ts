import { fetchBackend } from "@/lib/server/backend-proxy";
import { NextRequest, NextResponse } from "next/server";

function safeJson(text: string, fallback: unknown = {}) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return { error: text || "Empty response" };
  }
}

function backendUnavailable(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    {
      error: msg,
      hint: "Backend 未就绪。请确认 ./start_local.sh 或 Electron 已启动，且 curl http://127.0.0.1:8000/health 正常。",
    },
    { status: 502 },
  );
}

// GET /api/workflows — list workflows
export async function GET() {
  try {
    const resp = await fetchBackend("/workflows", { cache: "no-store" });
    const data = safeJson(await resp.text());
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    return backendUnavailable(err);
  }
}

// POST /api/workflows — create workflow
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const resp = await fetchBackend("/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = safeJson(await resp.text());
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    return backendUnavailable(err);
  }
}
