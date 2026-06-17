import { getBackendBaseUrl } from "@/lib/server/backend-proxy";
import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const chatId = req.nextUrl.searchParams.get("chat_id") || "";
    const qs = chatId ? `?chat_id=${encodeURIComponent(chatId)}` : "";
    const res = await fetch(`${getBackendBaseUrl()}/meal/feishu/chat-members${qs}`, {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, members: [], error: errorMessage(error) },
      { status: 500 },
    );
  }
}
