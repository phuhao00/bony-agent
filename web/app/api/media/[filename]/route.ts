import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import type { Readable } from "stream";

/**
 * 将 Node fs ReadStream 桥接到 Web ReadableStream。
 * 客户端断开、浏览器 Range 跳播取消流时，必须 cancel 掉底层读流并在 enqueue 时防护，
 * 否则会出现「Controller is already closed」未捕获异常。
 */
function nodeReadStreamToWebStream(stream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk: string | Buffer) => {
        try {
          const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
          controller.enqueue(new Uint8Array(buf));
        } catch {
          stream.removeAllListeners();
          stream.destroy();
        }
      });
      stream.on("end", () => {
        try {
          controller.close();
        } catch {
          /* consumer already closed */
        }
        stream.removeAllListeners();
      });
      stream.on("error", (err: Error) => {
        try {
          controller.error(err);
        } catch {
          /* already closed or errored */
        }
        stream.removeAllListeners();
      });
    },
    cancel() {
      stream.removeAllListeners();
      stream.destroy();
    },
  });
}

// 媒体文件根目录
// In Electron the STORAGE_DIR env var is injected by main.js pointing to APP_DATA/storage.
// In dev, fall back to the sibling storage/ directory relative to project root.
const OUTPUT_DIR = process.env.STORAGE_DIR
  ? path.join(process.env.STORAGE_DIR, "outputs")
  : process.env.AI_MEDIA_AGENT_HOME
    ? path.join(process.env.AI_MEDIA_AGENT_HOME, "storage", "outputs")
    : path.join(process.cwd(), "..", "storage", "outputs");

const CONTENT_TYPE_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".html": "text/html",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  try {
    const { filename } = await params;

    // Ensure filename is safe (prevent traversal)
    const safeFilename = path.basename(filename);
    const filePath = path.join(OUTPUT_DIR, safeFilename);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      console.error(`[Media Proxy] Not found: ${filePath}`);
      return NextResponse.json({ error: "Media not found" }, { status: 404 });
    }

    const ext = path.extname(safeFilename).toLowerCase();
    const contentType = CONTENT_TYPE_MAP[ext] || "application/octet-stream";
    const isVideo = [".mp4", ".webm", ".mov"].includes(ext);

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    // Video files: support Range requests so browsers can seek and play
    if (isVideo) {
      const rangeHeader = request.headers.get("range");

      if (rangeHeader) {
        const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const stream = fs.createReadStream(filePath, { start, end });
        const webStream = nodeReadStreamToWebStream(stream);

        return new NextResponse(webStream, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunkSize),
            "Cache-Control": "public, max-age=31536000",
          },
        });
      }

      // No Range header: return full file with Accept-Ranges so browser knows it can seek
      const stream = fs.createReadStream(filePath);
      const webStream = nodeReadStreamToWebStream(stream);

      return new NextResponse(webStream, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(fileSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000",
        },
      });
    }

    // Non-video: read entire file into buffer (images etc.)
    const fileBuffer = fs.readFileSync(filePath);
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (error) {
    console.error("Media disk read error:", error);
    return NextResponse.json(
      { error: "Failed to read media" },
      { status: 500 },
    );
  }
}
