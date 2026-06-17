import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, timestamp } = body;

    // Convert the conversation to the format the backend expects
    const lastUser = (messages as { role: string; content: string }[])
      .filter((m) => m.role === "user")
      .pop();
    const lastAssistant = (messages as { role: string; content: string }[])
      .filter((m) => m.role === "assistant")
      .pop();

    if (!lastUser) return NextResponse.json({ ok: true });

    const response = await fetch(`${BACKEND_URL}/chat/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "chat",
        prompt: lastUser.content,
        result: lastAssistant?.content ?? "",
        metadata: { timestamp },
      }),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    // best-effort: silently discard errors
    return NextResponse.json({ ok: true });
  }
}
