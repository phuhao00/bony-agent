import { randomUUID } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { join } from "path";

// 智谱 AI API
const ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/images/generations";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// 确保输出目录存在
const OUTPUT_DIR = join(process.cwd(), "..", "storage/outputs");
if (!existsSync(OUTPUT_DIR)) {
  try {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  } catch (e) {
    console.error("Failed to create output dir:", e);
  }
}

/**
 * 生成单张故事板图片
 * 优先使用后端服务，fallback 到直接调用智谱 AI
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, frameId } = body;

    if (!prompt) {
      return NextResponse.json(
        { error: "缺少图片描述", frameId },
        { status: 400 },
      );
    }

    // 首先尝试使用后端服务
    try {
      const backendResponse = await fetch(`${BACKEND_URL}/tools/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(60000), // 60秒超时
      });

      if (backendResponse.ok) {
        const data = await backendResponse.json();
        // 提取图片 URL
        let imageUrl = extractImageUrl(data.result);

        // 如果没有成功提取到 URL 且 result 中包含失败等字样，视为 error 发给前端
        const isError =
          !imageUrl &&
          (data.result.includes("失败") ||
            data.result.includes("Error") ||
            data.result.includes("❌"));

        return NextResponse.json({
          frameId,
          imageUrl,
          result: data.result,
          error: isError ? data.result : undefined,
        });
      }
    } catch (backendError) {
      console.log("Backend not available, using direct API call");
    }

    // Fallback: 直接调用智谱 AI
    const apiKey = process.env.ZHIPUAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "未配置 API Key", frameId },
        { status: 500 },
      );
    }

    const response = await fetch(ZHIPU_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "cogview-3",
        prompt: prompt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ZhipuAI Image API error:", errorText);
      return NextResponse.json(
        { error: `图片生成失败: ${response.status}`, frameId },
        { status: response.status },
      );
    }

    const data = await response.json();
    const imageData = data.data?.[0];

    if (!imageData?.url) {
      return NextResponse.json(
        { error: "未获取到图片", frameId },
        { status: 500 },
      );
    }

    // 下载并保存图片
    const imageUrl = imageData.url;
    let localUrl = imageUrl;

    try {
      const imageResponse = await fetch(imageUrl);
      if (imageResponse.ok) {
        const imageBuffer = await imageResponse.arrayBuffer();
        const filename = `${randomUUID()}.jpg`;
        const filepath = join(OUTPUT_DIR, filename);
        await writeFile(filepath, Buffer.from(imageBuffer));
        localUrl = `/api/media/${filename}`;
      }
    } catch (downloadError) {
      console.error("Failed to download image:", downloadError);
      // 使用原始 URL
    }

    return NextResponse.json({
      frameId,
      imageUrl: localUrl,
      originalUrl: imageUrl,
      result: `图片已生成: ${localUrl}`,
    });
  } catch (error: any) {
    console.error("Storyboard image generation error:", error);
    return NextResponse.json(
      { error: error.message, result: `生成失败: ${error.message}` },
      { status: 500 },
    );
  }
}

/**
 * 从结果文本中提取图片 URL
 * 与 main.py _extract_video_url_from_result 逻辑保持一致
 */
function extractImageUrl(resultText: string): string | null {
  if (!resultText) return null;

  // 1. 优先: **直接显示:** /abs/path/storage/outputs/<filename>
  //    result 中有 Markdown 加粗标记，用 [^/\n]* 跳过冒号和 ** 等非路径字符
  const directMatch = resultText.match(/直接显示[^/\n]*(\/[^\s]+)/);
  if (directMatch) {
    const absPath = directMatch[1].trim();
    const filename = absPath.split(/[/\\]/).pop();
    if (filename) {
      return `/api/media/${filename}`;
    }
  }

  // 2. 匹配 storage/outputs/<任意文件名>.<图片扩展名>（不限于 UUID）
  const localMatch = resultText.match(
    /storage[/\\]outputs[/\\]([\w\-]+\.(jpg|png|jpeg|gif|webp))/i,
  );
  if (localMatch) {
    return `/api/media/${localMatch[1]}`;
  }

  // 3. 匹配远程 CDN URL
  const urlMatch = resultText.match(
    /https?:\/\/[^\s\n\]"]+\.(jpg|png|jpeg|webp|gif)(\?[^\s\n\]"]*)?/i,
  );
  if (urlMatch) {
    return urlMatch[0];
  }

  return null;
}
