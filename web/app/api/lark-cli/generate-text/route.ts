import { NextRequest, NextResponse } from "next/server";

import { generateTextOnly, type TextGenerateMessage } from "@/lib/server/text-generate";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      messages?: TextGenerateMessage[];
      system?: string;
      user?: string;
    };

    let messages: TextGenerateMessage[] = [];
    if (Array.isArray(body.messages) && body.messages.length > 0) {
      messages = body.messages.filter(
        (m): m is TextGenerateMessage =>
          Boolean(m?.role && typeof m.content === "string"),
      );
    } else if (typeof body.user === "string" && body.user.trim()) {
      if (typeof body.system === "string" && body.system.trim()) {
        messages.push({ role: "system", content: body.system.trim() });
      }
      messages.push({ role: "user", content: body.user.trim() });
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: "messages_required" }, { status: 400 });
    }

    const content = await generateTextOnly(messages);
    if (!content) {
      return NextResponse.json({ error: "empty_model_response" }, { status: 502 });
    }

    return NextResponse.json({ content });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
