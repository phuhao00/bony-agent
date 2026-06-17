import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

function extractImageUrl(result: string): string {
  const localMatch = result.match(
    /storage[/\\]outputs[/\\]([^\s\)\n'"*]+\.(?:jpg|jpeg|png|gif|webp))/i,
  );
  if (localMatch) {
    const filename = localMatch[1].split(/[/\\]/).pop();
    if (filename) return `/api/media/${filename}`;
  }
  const urlMatch = result.match(
    /https?:\/\/[^\s)"'*\n]+\.(?:png|jpg|jpeg|webp|gif)/i,
  );
  return urlMatch ? urlMatch[0] : "";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await fetch(`${BACKEND_URL}/tools/image/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    let imageUrls: string[] = data.image_urls || [];
    const resultText: string = data.result || "";
    if (!imageUrls.length && resultText) {
      imageUrls = extractImageUrl(resultText) ? [extractImageUrl(resultText)] : [];
    }

    return NextResponse.json({ ...data, image_url: imageUrls[0] || "", image_urls: imageUrls });
  } catch (error: unknown) {
    const msg = errorMessage(error);
    console.error("[image/edit] error:", error);
    return NextResponse.json(
      { error: msg, result: `编辑失败: ${msg}` },
      { status: 500 },
    );
  }
}
