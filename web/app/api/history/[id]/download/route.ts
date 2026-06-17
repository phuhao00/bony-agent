import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;

        // 转发下载请求到后端
        const backendResponse = await fetch(
            `${BACKEND_URL}/history/${id}/download`,
            { cache: "no-store" }
        );

        if (!backendResponse.ok) {
            return NextResponse.json(
                { error: "Download failed" },
                { status: backendResponse.status },
            );
        }

        // 如果是重定向，直接返回重定向响应
        if (backendResponse.status === 302) {
            const redirectUrl = backendResponse.headers.get("location");
            return NextResponse.redirect(redirectUrl!);
        }

        // 否则返回文件流
        const contentType =
            backendResponse.headers.get("content-type") ||
            "application/octet-stream";
        const contentDisposition = backendResponse.headers.get(
            "content-disposition",
        );

        const headers = new Headers();
        if (contentDisposition) {
            headers.set("content-disposition", contentDisposition);
        }
        headers.set("content-type", contentType);

        const buffer = await backendResponse.arrayBuffer();

        return new NextResponse(buffer, {
            status: 200,
            headers,
        });
    } catch (error) {
        console.error("GET download error:", error);
        return NextResponse.json(
            { error: "Failed to download record" },
            { status: 500 },
        );
    }
}
