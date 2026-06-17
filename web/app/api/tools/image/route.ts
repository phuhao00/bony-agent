import { errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, quality, reference_image_url } = body;

    const response = await fetch(`${BACKEND_URL}/tools/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, quality, reference_image_url }),
    });

    const data = await response.json();

    // Extract a browser-usable image_url from the backend's result text.
    // The tool returns text like "**直接显示:** /abs/path/storage/outputs/uuid.png"
    // or "**URL:** https://..." — use the same proven regex as a2uiMedia.ts
    let imageUrl: string = data.image_url || "";
    const resultText: string = data.result || "";
    if (!imageUrl && resultText) {
      // 1. Local file saved to storage/outputs/ (absolute or relative path)
      const localMatch = resultText.match(
        /storage[/\\]outputs[/\\]([^\s\)\n'"*]+\.(?:jpg|jpeg|png|gif|webp))/i,
      );
      if (localMatch) {
        const filename = localMatch[1].split(/[/\\]/).pop();
        if (filename) imageUrl = `/api/media/${filename}`;
      }
      // 2. Remote HTTPS URL
      if (!imageUrl) {
        const urlMatch = resultText.match(
          /https?:\/\/[^\s)"'*\n]+\.(?:png|jpg|jpeg|webp|gif)/i,
        );
        if (urlMatch) imageUrl = urlMatch[0];
      }
    }

    if (imageUrl) console.log("[image/route] resolved image_url:", imageUrl);
    else
      console.warn(
        "[image/route] could not extract image_url from result:",
        resultText?.slice(0, 200),
      );

    return NextResponse.json({ ...data, image_url: imageUrl });
  } catch (error: unknown) {
    const msg = errorMessage(error);
    console.error("Image generation error:", error);
    return NextResponse.json(
      { error: msg, result: `生成失败: ${msg}` },
      { status: 500 },
    );
  }
}
