import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// 媒体文件根目录
// In Electron the STORAGE_DIR env var is injected by main.js pointing to APP_DATA/storage.
// In dev, fall back to the sibling storage/ directory relative to project root.
const UPLOAD_DIR = process.env.STORAGE_DIR
    ? path.join(process.env.STORAGE_DIR, "uploads")
    : process.env.AI_MEDIA_AGENT_HOME
      ? path.join(process.env.AI_MEDIA_AGENT_HOME, "storage", "uploads")
      : path.join(process.cwd(), "..", "storage", "uploads");

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> },
) {
    try {
        const { filename } = await params;

        // Ensure filename is safe (prevent traversal)
        const safeFilename = path.basename(filename);
        const filePath = path.join(UPLOAD_DIR, safeFilename);

        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            console.error(`[Upload Proxy] Not found: ${filePath}`);
            return NextResponse.json({ error: "File not found" }, { status: 404 });
        }

        // 读取文件
        const fileBuffer = fs.readFileSync(filePath);

        // 根据扩展名判断内容类型
        const ext = path.extname(safeFilename).toLowerCase();
        const contentTypeMap: Record<string, string> = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".mp4": "video/mp4",
            ".webm": "video/webm",
            ".mov": "video/quicktime",
            ".txt": "text/plain",
            ".pdf": "application/pdf",
        };
        const contentType = contentTypeMap[ext] || "application/octet-stream";

        // 返回文件
        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=31536000",
            },
        });
    } catch (error) {
        console.error("Upload proxy error:", error);
        return NextResponse.json(
            { error: "Failed to read file" },
            { status: 500 },
        );
    }
}
