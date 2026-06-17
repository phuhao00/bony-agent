import { abortCauseMessage, errorMessage } from "@/lib/server/errors";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// 视频生成耗时较长，设置最大执行时间为 300 秒
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, resolution } = body;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 290_000); // 290s

    const response = await fetch(`${BACKEND_URL}/tools/video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, resolution }),
      signal: controller.signal,
      // @ts-expect-error Node.js undici extension
      dispatcher: undefined,
    });

    clearTimeout(timeoutId);
    const data = await response.json();

    // Extract a browser-usable video_url from the backend result text
    // (backend already does this, but add a frontend safety net just in case)
    let videoUrl: string = data.video_url || "";
    const resultText: string = data.result || "";
    if (!videoUrl && resultText) {
      const localMatch = resultText.match(
        /storage[/\\]outputs[/\\]([^\s\)\n'"*]+\.(?:mp4|webm|mov))/i,
      );
      if (localMatch) {
        const filename = localMatch[1].split(/[/\\]/).pop();
        if (filename) videoUrl = `/api/media/${filename}`;
      }
    }

    if (videoUrl) console.log("[video/route] resolved video_url:", videoUrl);
    else
      console.warn(
        "[video/route] no video_url extracted from result:",
        resultText?.slice(0, 200),
      );

    return NextResponse.json({ ...data, video_url: videoUrl });
  } catch (error: unknown) {
    console.error("Video generation error:", error);
    const msg = abortCauseMessage(error) ?? errorMessage(error);
    return NextResponse.json(
      { error: msg, result: `生成失败: ${msg}` },
      { status: 500 },
    );
  }
}
