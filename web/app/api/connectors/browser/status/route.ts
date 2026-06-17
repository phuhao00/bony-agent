import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const sessionId = body.session_id;
        console.log("[Browser Status Proxy] Checking status for session:", sessionId);

        // ALWAYS proxy to the Python backend to ensure we check the real source of truth (the writable path it owns)
        const res = await fetch(`${BACKEND_URL}/connectors/browser/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            throw new Error(`Backend returned ${res.status}`);
        }

        const data = await res.json();
        return NextResponse.json(data);

    } catch (error: any) {
        console.error("[Browser Status Proxy] Error:", error);
        return NextResponse.json(
            { status: "error", error: error.message || "请求失败" },
            { status: 500 }
        );
    }
}

