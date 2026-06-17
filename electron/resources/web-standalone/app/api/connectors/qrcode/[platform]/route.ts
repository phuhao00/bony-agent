import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ platform: string }> }
) {
    try {
        const { platform } = await params;

        // 请求后端生成二维码
        const response = await fetch(`${BACKEND_URL}/connectors/qrcode/${platform}`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: `Failed to generate QR code for ${platform}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("QR code error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to generate QR code" },
            { status: 500 }
        );
    }
}
