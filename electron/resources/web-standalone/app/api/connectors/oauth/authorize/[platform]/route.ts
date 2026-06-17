import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * OAuth授权第一步：生成授权URL
 * 用户点击"授权"按钮后调用此接口
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ platform: string }> }
) {
    try {
        // Next.js 15: params is now a Promise
        const { platform } = await params;

        // 调用后端API生成OAuth授权URL
        const response = await fetch(
            `${BACKEND_URL}/connectors/oauth/authorize/${platform}`,
            {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            }
        );

        if (!response.ok) {
            const error = await response.json();
            return NextResponse.json(
                { error: error.message || `Failed to get OAuth URL for ${platform}` },
                { status: response.status }
            );
        }

        const data = await response.json();

        // 返回授权URL给前端
        // 前端会在新窗口打开这个URL
        return NextResponse.json({
            authorization_url: data.authorization_url,
            state: data.state  // 用于防止CSRF攻击
        });
    } catch (error: any) {
        console.error("OAuth authorize error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to initialize OAuth" },
            { status: 500 }
        );
    }
}
