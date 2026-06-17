import { abortCauseMessage, errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 290_000);

    const response = await fetch(`${BACKEND_URL}/tools/video/happyhorse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || "生成失败", ...data },
        { status: response.status },
      );
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = abortCauseMessage(error) ?? errorMessage(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
