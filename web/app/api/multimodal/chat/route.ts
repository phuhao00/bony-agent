import { NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * POST /api/multimodal/chat
 * 代理到后端 POST /multimodal/chat (SSE 流式)
 * 接受 multipart/form-data: message + files[] + session_id
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData();

  const backendRes = await fetch(`${BACKEND}/multimodal/chat`, {
    method: "POST",
    body: formData,
  });

  if (!backendRes.ok || !backendRes.body) {
    const err = await backendRes
      .json()
      .catch(() => ({ detail: backendRes.statusText }));
    return new Response(JSON.stringify(err), {
      status: backendRes.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Pass SSE stream through
  return new Response(backendRes.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
