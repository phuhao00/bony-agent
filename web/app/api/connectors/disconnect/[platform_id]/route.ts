import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ platform_id: string }> }
) {
    try {
        const { platform_id } = await context.params;
        const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

        console.log(`[Disconnect Proxy] Requesting disconnect for: ${platform_id}`);

        // Proxy request to the Python backend
        const response = await fetch(`${BACKEND_URL}/connectors/disconnect/${platform_id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });

        if (!response.ok) {
            throw new Error(`Backend returned ${response.status}`);
        }

        const data = await response.json();

        return NextResponse.json({
            success: data.success,
            message: data.success ? `已断开 ${platform_id} 连接` : `断开 ${platform_id} 失败`,
        });

    } catch (error: any) {
        console.error("Disconnect platform error (proxy):", error);
        return NextResponse.json(
            { error: error.message },
            { status: 500 },
        );
    }
}
