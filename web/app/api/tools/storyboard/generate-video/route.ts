import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

interface VideoGenerateRequest {
  frames: {
    id: string;
    imageUrl: string;
    prompt?: string;
    description: string;
    duration: number;
  }[];
  title?: string;
  addNarration?: boolean;
  narrationText?: string;
  addBgm?: boolean;
}

/** Resolve a storyboard imageUrl to an absolute file path on disk */
function resolveImagePath(url: string, agentRoot: string): string {
  const path = require("path");
  if (!url) return "";

  if (url.startsWith("/api/media/")) {
    return path.join(
      agentRoot,
      "storage",
      "outputs",
      url.replace("/api/media/", ""),
    );
  }
  if (url.startsWith("/api/uploads/")) {
    return path.join(
      agentRoot,
      "storage",
      "uploads",
      url.replace("/api/uploads/", ""),
    );
  }
  if (url.startsWith("/uploads/")) {
    return path.join(
      agentRoot,
      "storage",
      "uploads",
      url.replace("/uploads/", ""),
    );
  }
  if (url.startsWith("/media/")) {
    return path.join(
      agentRoot,
      "storage",
      "outputs",
      url.replace("/media/", ""),
    );
  }
  // Already absolute path
  if (
    url.startsWith("/Users/") ||
    url.startsWith("/home/") ||
    url.startsWith("/tmp/")
  ) {
    return url;
  }
  return url;
}

/** Extract local video path from a backend result string */
function extractVideoPath(result: string): string | null {
  const m = result?.match(/storage\/outputs\/([\w\-]+\.mp4)/i);
  return m ? `/media/${m[1]}` : null;
}

/**
 * 从故事板分镜生成视频
 *
 * 主路径：每帧以分镜图作为参考，独立调用图生视频 (POST /tools/video/from-image)，
 * 生成的视频片段再拼接为完整视频。
 * Fallback：退化到 ai-remix 幻灯片拼接（保障有产出）。
 */
export async function POST(req: NextRequest) {
  try {
    const body: VideoGenerateRequest = await req.json();
    const { frames, addNarration, narrationText, addBgm } = body;

    if (!frames || frames.length === 0) {
      return NextResponse.json({ error: "缺少分镜图片" }, { status: 400 });
    }

    const path = require("path");
    const projectRoot = path.resolve(process.cwd()); // Next.js CWD = web/
    const agentRoot = path.resolve(projectRoot, ".."); // agent/

    const avgDuration = Math.round(
      frames.reduce((s, f) => s + (f.duration || 3), 0) / frames.length,
    );
    const defaultNarration = frames.map((f) => f.description).join("。");

    // ── 主路径：逐帧图生视频 ──────────────────────────────────────────────
    const perFrameVideoPaths: string[] = [];
    let anyFrameFailed = false;

    for (const frame of frames) {
      if (!frame.imageUrl) {
        anyFrameFailed = true;
        break;
      }

      const absImagePath = resolveImagePath(frame.imageUrl, agentRoot);
      const framePrompt = frame.prompt || frame.description || "";

      try {
        const resp = await fetch(`${BACKEND_URL}/tools/video/from-image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: absImagePath,
            prompt: framePrompt,
          }),
          signal: AbortSignal.timeout(300000), // 5 min per frame
        });

        if (!resp.ok) {
          console.error(
            `[StoryboardVideo] frame ${frame.id} from-image HTTP ${resp.status}`,
          );
          anyFrameFailed = true;
          break;
        }

        const data = await resp.json();

        // Extract video path from response
        let videoPath: string | null = null;
        if (data.video_url) {
          // /media/<filename> or storage/outputs/<filename>
          const m = String(data.video_url).match(
            /(?:storage\/outputs\/)?([\w\-]+\.mp4)/i,
          );
          videoPath = m
            ? path.join(agentRoot, "storage", "outputs", m[1])
            : null;
        }
        if (!videoPath && data.result) {
          const m = String(data.result).match(
            /storage\/outputs\/([\w\-]+\.mp4)/i,
          );
          videoPath = m
            ? path.join(agentRoot, "storage", "outputs", m[1])
            : null;
        }

        if (!videoPath) {
          console.error(
            `[StoryboardVideo] frame ${frame.id} — no video path in response`,
            data,
          );
          anyFrameFailed = true;
          break;
        }

        console.log(`[StoryboardVideo] frame ${frame.id} → ${videoPath}`);
        perFrameVideoPaths.push(videoPath);
      } catch (frameErr) {
        console.error(`[StoryboardVideo] frame ${frame.id} error:`, frameErr);
        anyFrameFailed = true;
        break;
      }
    }

    // If all frames succeeded, concatenate the clips
    if (!anyFrameFailed && perFrameVideoPaths.length > 0) {
      try {
        const concatResp = await fetch(`${BACKEND_URL}/tools/video/remix`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_paths: perFrameVideoPaths,
            transition: "fade",
            duration_per_clip: avgDuration,
          }),
          signal: AbortSignal.timeout(120000),
        });

        if (concatResp.ok) {
          const concatData = await concatResp.json();
          const finalPath = extractVideoPath(concatData.result || "");
          return NextResponse.json({
            success: true,
            final_video: finalPath,
            message: concatData.result,
          });
        }
        console.error(
          "[StoryboardVideo] concat remix failed:",
          await concatResp.text(),
        );
      } catch (concatErr) {
        console.error("[StoryboardVideo] concat error:", concatErr);
      }
    }

    // ── Fallback：ai-remix 图片幻灯片拼接 ───────────────────────────────
    console.warn("[StoryboardVideo] 退回到 ai-remix fallback");

    const filePaths = frames
      .map((f) => resolveImagePath(f.imageUrl, agentRoot))
      .filter(Boolean);
    const framePrompts = frames
      .map((f) => f.prompt || f.description)
      .join("; ");

    try {
      const aiRemixResp = await fetch(`${BACKEND_URL}/tools/video/ai-remix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_paths: filePaths,
          user_prompt: framePrompts,
          fusion_mode: true,
          generate_ai_segments: false,
          segment_duration: avgDuration,
          add_narration: addNarration || false,
          narration_text: narrationText || defaultNarration,
          add_bgm: addBgm || false,
          bgm_volume: 0.3,
        }),
        signal: AbortSignal.timeout(300000),
      });

      if (aiRemixResp.ok) {
        const data = await aiRemixResp.json();
        return NextResponse.json(data);
      }
    } catch (aiErr) {
      console.error("[StoryboardVideo] ai-remix fallback error:", aiErr);
    }

    try {
      const simpleResp = await fetch(`${BACKEND_URL}/tools/video/remix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_paths: filePaths,
          transition: "fade",
          duration_per_clip: avgDuration,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (simpleResp.ok) {
        const data = await simpleResp.json();
        const videoPath = extractVideoPath(data.result || "");
        return NextResponse.json({
          success: true,
          final_video: videoPath,
          message: data.result,
        });
      }
    } catch (simpleErr) {
      console.error(
        "[StoryboardVideo] simple remix fallback error:",
        simpleErr,
      );
    }

    return NextResponse.json({
      success: false,
      error: "视频生成服务暂时不可用",
      message: "请确保后端服务已启动 (python server.py)",
      hint: "您可以先保存故事板，稍后再生成视频",
    });
  } catch (error: any) {
    console.error("Storyboard video generation error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
